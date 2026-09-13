import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals'
import request from 'supertest'
import { createClient, type RedisClientType } from 'redis'
import { testDatabase } from '../testing/database.js'
import { testRedisUrl } from '../testing/redis.js'
import { createApp } from '../http/app.js'
import { loadEnv } from '../config/env.js'
import { createTokenService } from '../auth/tokens.js'
import { createShiftRepository } from '../shifts/repository.js'
import { createObligationRepository } from '../obligations/repository.js'
import { createRateCache } from '../fx/cache.js'
import { createFxService } from '../fx/service.js'
import { silentNotifier } from '../realtime/notifier.js'

const db = testDatabase('graphql')
const tokens = createTokenService('graphql-test-secret', 3600)
const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'mongodb://localhost:27017/funded_test_graphql',
  JWT_SECRET: 'a-secret-long-enough-to-pass-validation',
  FX_WEBHOOK_SECRET: 'webhook-secret-16+',
} as NodeJS.ProcessEnv)

const redis: RedisClientType = createClient({ url: testRedisUrl('graphql') })

let app: Awaited<ReturnType<typeof createApp>>

beforeAll(async () => {
  await redis.connect()
  const shifts = createShiftRepository(db)
  const obligations = createObligationRepository(db)
  const fx = createFxService(db, createRateCache(redis, 60), silentNotifier())

  app = await createApp({
    env,
    checkHealth: async () => ({ mongo: 'up' }),
    db,
    tokens,
    shifts,
    obligations,
    fx,
    graphql: { introspection: true },
  })
})

beforeEach(async () => {
  await db.deadline.deleteMany()
  await db.fxAlert.deleteMany()
  await db.fxRate.deleteMany()
  await db.obligation.deleteMany()
  await db.shift.deleteMany()
  await db.user.deleteMany()
  await redis.flushDb()
})

afterAll(async () => {
  await db.$disconnect()
  await redis.quit()
})

const signIn = async (email = 'graph@example.com') => {
  const response = await request(app)
    .post('/api/auth/local')
    .send({ email, displayName: 'Graph', homeCurrency: 'INR' })
  return response.body.token as string
}

const query = (body: object, token?: string) => {
  const req = request(app).post('/graphql').send(body)
  return token ? req.set('Authorization', `Bearer ${token}`) : req
}

describe('the dashboard query', () => {
  it('returns compliance, obligations, alerts and rate in one round trip', async () => {
    const token = await signIn()

    await request(app)
      .post('/api/shifts')
      .set('Authorization', `Bearer ${token}`)
      .send({ startedAt: '2026-09-08T08:00:00', endedAt: '2026-09-08T18:00:00', employer: 'Cafe' })
    await request(app)
      .post('/api/obligations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        label: 'support',
        amountMinor: 2_500_000,
        currency: 'INR',
        cadence: 'MONTHLY',
        // Tomorrow, so the first occurrence is unambiguously inside the window and
        // the test does not depend on what time of day it runs.
        nextDueOn: new Date(Date.now() + 86_400_000).toISOString(),
      })
    await request(app)
      .post('/api/fx/alerts')
      .set('Authorization', `Bearer ${token}`)
      .send({ baseCurrency: 'CAD', quoteCurrency: 'INR', targetRate: 63, direction: 'AT_OR_ABOVE' })

    const response = await query(
      {
        query: `{
          dashboard {
            viewer { email homeCurrency }
            compliance { breachedWeeks current { offCampusHours remainingHours } }
            obligations { label amountMinor cadence }
            alerts { targetRate direction spent }
            upcomingObligationsMinor(days: 40)
          }
        }`,
      },
      token,
    )

    expect(response.status).toBe(200)
    const dashboard = response.body.data.dashboard
    expect(dashboard.viewer.email).toBe('graph@example.com')
    expect(dashboard.compliance.breachedWeeks).toBe(0)
    expect(dashboard.obligations).toHaveLength(1)
    expect(dashboard.alerts[0].spent).toBe(false)
    // Tomorrow and one month later both fall inside 40 days.
    expect(dashboard.upcomingObligationsMinor).toBe(5_000_000)
  })

  it('fails with UNAUTHENTICATED rather than a bare 401 when no token is sent', async () => {
    const response = await query({ query: '{ dashboard { viewer { email } } }' })

    expect(response.status).toBe(200) // GraphQL reports errors in the body
    expect(response.body.errors[0].extensions.code).toBe('UNAUTHENTICATED')
  })

  it('treats an expired token as unauthenticated, not as a transport failure', async () => {
    const expired = createTokenService('graphql-test-secret', -10).issue({
      sub: 'someone',
      email: 'a@b.com',
    })
    const response = await query({ query: '{ dashboard { viewer { email } } }' }, expired)

    expect(response.body.errors[0].extensions.code).toBe('UNAUTHENTICATED')
  })

  // The reason this is GraphQL rather than one fat REST endpoint.
  it('touches only what was asked for, so a narrow query does no extra work', async () => {
    const token = await signIn()
    const response = await query({ query: '{ dashboard { compliance { breachedWeeks } } }' }, token)

    expect(response.body.data.dashboard).toEqual({ compliance: { breachedWeeks: 0 } })
    expect(response.body.data.dashboard.obligations).toBeUndefined()
  })

  it('returns a null rate rather than failing when the pair has never been observed', async () => {
    const token = await signIn()
    const response = await query({ query: '{ dashboard { rate { rate pair } } }' }, token)

    expect(response.body.errors).toBeUndefined()
    expect(response.body.data.dashboard.rate).toBeNull()
  })

  it('reports the latest observed rate once one exists', async () => {
    const token = await signIn()
    await db.fxRate.create({
      data: { baseCurrency: 'CAD', quoteCurrency: 'INR', rate: 61.8, observedAt: new Date() },
    })

    const response = await query({ query: '{ dashboard { rate { rate pair } } }' }, token)

    expect(response.body.data.dashboard.rate).toMatchObject({ rate: 61.8, pair: 'CAD/INR' })
  })

  it('never exposes another user\'s data', async () => {
    const mine = await signIn('mine@example.com')
    const theirs = await signIn('theirs@example.com')

    await request(app)
      .post('/api/obligations')
      .set('Authorization', `Bearer ${mine}`)
      .send({ label: 'private', amountMinor: 1_000, currency: 'INR', cadence: 'ONCE', nextDueOn: new Date().toISOString() })

    const response = await query({ query: '{ dashboard { obligations { label } } }' }, theirs)

    expect(response.body.data.dashboard.obligations).toHaveLength(0)
  })

  it('marks an alert spent once it has fired', async () => {
    const token = await signIn()
    const user = await db.user.findUnique({ where: { email: 'graph@example.com' } })
    await db.fxAlert.create({
      data: {
        userId: user!.id,
        baseCurrency: 'CAD',
        quoteCurrency: 'INR',
        targetRate: 60,
        direction: 'AT_OR_ABOVE',
        triggeredAt: new Date(),
      },
    })

    const response = await query({ query: '{ dashboard { alerts { spent triggeredAt } } }' }, token)

    expect(response.body.data.dashboard.alerts[0].spent).toBe(true)
    expect(response.body.data.dashboard.alerts[0].triggeredAt).toEqual(expect.any(String))
  })
})


describe('deadlines on the dashboard', () => {
  it('returns deadlines soonest first with their status', async () => {
    const token = await signIn()
    const user = await db.user.findUnique({ where: { email: 'graph@example.com' } })
    const inDays = (days: number) => {
      const date = new Date()
      date.setDate(date.getDate() + days)
      date.setHours(12, 0, 0, 0)
      return date
    }
    await db.deadline.createMany({
      data: [
        { userId: user!.id, label: 'Permit expiry', kind: 'PERMIT_EXPIRY', dueOn: inDays(90) },
        { userId: user!.id, label: 'Tuition', kind: 'TUITION', dueOn: inDays(3) },
      ],
    })

    const response = await query({ query: '{ dashboard { deadlines { label kind daysLeft status } } }' }, token)

    expect(response.body.errors).toBeUndefined()
    expect(response.body.data.dashboard.deadlines).toEqual([
      { label: 'Tuition', kind: 'TUITION', daysLeft: 3, status: 'DUE_SOON' },
      { label: 'Permit expiry', kind: 'PERMIT_EXPIRY', daysLeft: 90, status: 'UPCOMING' },
    ])
  })
})
