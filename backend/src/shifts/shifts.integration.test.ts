import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals'
import request from 'supertest'
import { testDatabase } from '../testing/database.js'
import { createApp } from '../http/app.js'
import { loadEnv } from '../config/env.js'
import { createTokenService } from '../auth/tokens.js'
import { createShiftRepository } from './repository.js'

/**
 * Integration tests against a real MongoDB.
 *
 * A mocked Prisma client would pass while the query was wrong, so these run against
 * the replica set docker-compose starts, in a separate database that is emptied
 * between tests.
 */

const db = testDatabase('shifts')
const DATABASE_URL = 'mongodb://localhost:27017/funded_test_shifts'
const tokens = createTokenService('integration-test-secret', 3600)
const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL,
  JWT_SECRET: 'a-secret-long-enough-to-pass-validation',
  FX_WEBHOOK_SECRET: 'webhook-secret-16+',
} as NodeJS.ProcessEnv)

let app: Awaited<ReturnType<typeof createApp>>
const buildApp = () => createApp({
  env,
  checkHealth: async () => ({ mongo: 'up' }),
  db,
  tokens,
  shifts: createShiftRepository(db),
})

const signIn = async (email = 'mansi@example.com') => {
  const response = await request(app)
    .post('/api/auth/local')
    .send({ email, displayName: 'Mansi', homeCurrency: 'INR' })
  return response.body.token as string
}

beforeAll(async () => {
  app = await buildApp()
})

beforeEach(async () => {
  await db.shift.deleteMany()
  await db.user.deleteMany()
})

afterAll(async () => {
  await db.$disconnect()
})

describe('authentication', () => {
  it('issues a token and creates the user on first local sign-in', async () => {
    const response = await request(app)
      .post('/api/auth/local')
      .send({ email: 'new@example.com', displayName: 'New', homeCurrency: 'INR' })

    expect(response.status).toBe(200)
    expect(response.body.token).toEqual(expect.any(String))
    expect(await db.user.count()).toBe(1)
  })

  it('is idempotent: signing in twice does not create a second user', async () => {
    await signIn()
    await signIn()
    expect(await db.user.count()).toBe(1)
  })

  it('refuses an unauthenticated request to a guarded route', async () => {
    const response = await request(app).get('/api/shifts')
    expect(response.status).toBe(401)
    expect(response.body.error).toBe('missing_token')
  })

  it('refuses a forged token', async () => {
    const forged = createTokenService('wrong-secret', 3600).issue({
      sub: 'x',
      email: 'a@b.com',
    })
    const response = await request(app).get('/api/shifts').set('Authorization', `Bearer ${forged}`)
    expect(response.status).toBe(401)
    expect(response.body.error).toBe('invalid_token')
  })
})

describe('shifts', () => {
  it('stores a shift and reads it back for its owner', async () => {
    const token = await signIn()

    const created = await request(app)
      .post('/api/shifts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        startedAt: '2026-09-08T09:00:00Z',
        endedAt: '2026-09-08T17:00:00Z',
        employer: 'Campus Library',
        onCampus: true,
      })

    expect(created.status).toBe(201)
    expect(created.body.id).toEqual(expect.any(String))

    const listed = await request(app).get('/api/shifts').set('Authorization', `Bearer ${token}`)
    expect(listed.body.shifts).toHaveLength(1)
    expect(listed.body.shifts[0].employer).toBe('Campus Library')
  })

  it('never shows one user the shifts of another', async () => {
    const mine = await signIn('mine@example.com')
    const theirs = await signIn('theirs@example.com')

    await request(app)
      .post('/api/shifts')
      .set('Authorization', `Bearer ${mine}`)
      .send({
        startedAt: '2026-09-08T09:00:00Z',
        endedAt: '2026-09-08T17:00:00Z',
        employer: 'Mine',
      })

    const listed = await request(app).get('/api/shifts').set('Authorization', `Bearer ${theirs}`)
    expect(listed.body.shifts).toHaveLength(0)
  })

  it('refuses to delete a shift belonging to someone else', async () => {
    const mine = await signIn('mine@example.com')
    const theirs = await signIn('theirs@example.com')

    const created = await request(app)
      .post('/api/shifts')
      .set('Authorization', `Bearer ${mine}`)
      .send({
        startedAt: '2026-09-08T09:00:00Z',
        endedAt: '2026-09-08T17:00:00Z',
        employer: 'Mine',
      })

    const attempt = await request(app)
      .delete(`/api/shifts/${created.body.id}`)
      .set('Authorization', `Bearer ${theirs}`)

    expect(attempt.status).toBe(404)
    expect(await db.shift.count()).toBe(1) // still there
  })

  it('computes compliance from what was actually stored', async () => {
    const token = await signIn()

    for (const day of ['08', '09']) {
      await request(app)
        .post('/api/shifts')
        .set('Authorization', `Bearer ${token}`)
        .send({
          startedAt: `2026-09-${day}T08:00:00`,
          endedAt: `2026-09-${day}T18:00:00`,
          employer: 'Cafe',
        })
    }

    const compliance = await request(app)
      .get('/api/shifts/compliance')
      .set('Authorization', `Bearer ${token}`)

    expect(compliance.status).toBe(200)
    expect(compliance.body.weeks[0].offCampusHours).toBe(20)
    expect(compliance.body.weeks[0].remainingHours).toBe(4)
    expect(compliance.body.weeks[0].breached).toBe(false)
  })

  it('answers would-breach against stored shifts, not just the request body', async () => {
    const token = await signIn()

    for (const day of ['08', '09']) {
      await request(app)
        .post('/api/shifts')
        .set('Authorization', `Bearer ${token}`)
        .send({
          startedAt: `2026-09-${day}T08:00:00`,
          endedAt: `2026-09-${day}T18:00:00`,
          employer: 'Cafe',
        })
    }

    const response = await request(app)
      .post('/api/shifts/compliance/would-breach')
      .set('Authorization', `Bearer ${token}`)
      .send({
        startedAt: '2026-09-10T09:00:00',
        endedAt: '2026-09-10T15:00:00', // 6h on top of 20 exceeds the 24h cap
        employer: 'Cafe',
      })

    expect(response.body.wouldBreach).toBe(true)
  })
})
