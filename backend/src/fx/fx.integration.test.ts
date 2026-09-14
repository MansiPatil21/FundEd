import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals'
import request from 'supertest'
import { createClient, type RedisClientType } from 'redis'
import { testDatabase } from '../testing/database.js'
import { testRedisUrl } from '../testing/redis.js'
import { createApp } from '../http/app.js'
import { loadEnv } from '../config/env.js'
import { createTokenService } from '../auth/tokens.js'
import { createRateCache } from './cache.js'
import { createFxService } from './service.js'
import { sign } from './webhook.js'
import type { Trigger } from './alerts.js'

/**
 * The FX path end to end: a signed webhook lands, the rate is stored and cached, any
 * crossed alert fires exactly once, and a notification is handed to the notifier.
 *
 * Real MongoDB and real Redis. The notifier is captured rather than a socket server,
 * because what matters here is that the right trigger reaches it for the right user.
 */

const WEBHOOK_SECRET = 'test-provider-secret'
const db = testDatabase('fx')
const tokens = createTokenService('fx-test-secret', 3600)
const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'mongodb://localhost:27017/funded_test_fx',
  JWT_SECRET: 'a-secret-long-enough-to-pass-validation',
  FX_WEBHOOK_SECRET: 'webhook-secret-16+',
} as NodeJS.ProcessEnv)

const redis: RedisClientType = createClient({ url: testRedisUrl('fx') })

const notified: Trigger[] = []
const cache = createRateCache(redis, 60)
const fx = createFxService(db, cache, { alertTriggered: (t) => void notified.push(t) })

let app: Awaited<ReturnType<typeof createApp>>
const buildApp = () => createApp({
  env,
  checkHealth: async () => ({ mongo: 'up', redis: 'up' }),
  db,
  tokens,
  fx,
  webhookSecret: WEBHOOK_SECRET,
})

const push = (rate: number, observedAt = '2027-01-05T12:00:00Z') => {
  const body = JSON.stringify({ base: 'CAD', quote: 'INR', rate, observed_at: observedAt })
  return request(app)
    .post('/webhooks/fx/rates')
    .set('content-type', 'application/json')
    .set('x-provider-signature', sign(body, WEBHOOK_SECRET))
    .send(body)
}

const signIn = async (email = 'fx@example.com') => {
  const response = await request(app)
    .post('/api/auth/local')
    .send({ email, displayName: 'FX', homeCurrency: 'INR' })
  return response.body.token as string
}

beforeAll(async () => {
  await redis.connect()
  app = await buildApp()
})

beforeEach(async () => {
  notified.length = 0
  await db.fxAlert.deleteMany()
  await db.fxRate.deleteMany()
  await db.user.deleteMany()
  await redis.flushDb()
})

afterAll(async () => {
  await db.$disconnect()
  await redis.quit()
})

describe('the provider webhook', () => {
  it('accepts a correctly signed push and stores the rate', async () => {
    const response = await push(61.2)
    expect(response.status).toBe(202)
    expect(await db.fxRate.count()).toBe(1)
  })

  it('rejects an unsigned push', async () => {
    const body = JSON.stringify({ base: 'CAD', quote: 'INR', rate: 61.2, observed_at: '2027-01-05T12:00:00Z' })
    const response = await request(app)
      .post('/webhooks/fx/rates')
      .set('content-type', 'application/json')
      .send(body)

    expect(response.status).toBe(401)
    expect(await db.fxRate.count()).toBe(0)
  })

  it('rejects a push signed with the wrong secret', async () => {
    const body = JSON.stringify({ base: 'CAD', quote: 'INR', rate: 61.2, observed_at: '2027-01-05T12:00:00Z' })
    const response = await request(app)
      .post('/webhooks/fx/rates')
      .set('content-type', 'application/json')
      .set('x-provider-signature', sign(body, 'not-the-secret'))
      .send(body)

    expect(response.status).toBe(401)
  })

  it('rejects a signed push whose payload is malformed', async () => {
    const body = JSON.stringify({ base: 'CAD', rate: 'lots' })
    const response = await request(app)
      .post('/webhooks/fx/rates')
      .set('content-type', 'application/json')
      .set('x-provider-signature', sign(body, WEBHOOK_SECRET))
      .send(body)

    expect(response.status).toBe(400)
  })
})

describe('alerts', () => {
  const createAlert = async (token: string, targetRate: number, direction = 'AT_OR_ABOVE') =>
    request(app)
      .post('/api/fx/alerts')
      .set('Authorization', `Bearer ${token}`)
      .send({ baseCurrency: 'CAD', quoteCurrency: 'INR', targetRate, direction })

  it('fires when an incoming rate crosses the target, and notifies the owner', async () => {
    const token = await signIn()
    await createAlert(token, 63)

    await push(62.0, '2027-01-05T12:00:00Z')
    expect(notified).toHaveLength(0)

    await push(63.4, '2027-01-05T13:00:00Z')
    expect(notified).toHaveLength(1)
    expect(notified[0]!.rate).toBe(63.4)
  })

  it('fires only once, even if the rate stays past the target', async () => {
    const token = await signIn()
    await createAlert(token, 63)

    await push(63.4, '2027-01-05T13:00:00Z')
    await push(63.9, '2027-01-05T14:00:00Z')

    expect(notified).toHaveLength(1)
  })

  it('notifies the owner of the alert and nobody else', async () => {
    const mine = await signIn('mine@example.com')
    await signIn('theirs@example.com')
    await createAlert(mine, 63)

    await push(63.4)

    expect(notified).toHaveLength(1)
    const owner = await db.user.findUnique({ where: { email: 'mine@example.com' } })
    expect(notified[0]!.alert.userId).toBe(owner!.id)
  })

  it('lists only the requesting user\'s alerts', async () => {
    const mine = await signIn('mine@example.com')
    const theirs = await signIn('theirs@example.com')
    await createAlert(mine, 63)

    const ours = await request(app).get('/api/fx/alerts').set('Authorization', `Bearer ${mine}`)
    const others = await request(app).get('/api/fx/alerts').set('Authorization', `Bearer ${theirs}`)

    expect(ours.body.alerts).toHaveLength(1)
    expect(others.body.alerts).toHaveLength(0)
  })
})

describe('the rate cache', () => {
  it('serves the latest rate from Redis after a push', async () => {
    const token = await signIn()
    await push(61.7)

    const cached = await redis.get('fx:CAD:INR')
    expect(cached).toContain('61.7')

    const response = await request(app)
      .get('/api/fx/rate/CAD/INR')
      .set('Authorization', `Bearer ${token}`)
    expect(response.body.rate).toBe(61.7)
  })

  it('falls back to the database and repopulates when the cache is empty', async () => {
    const token = await signIn()
    await push(60.9)
    await redis.flushDb()

    const response = await request(app)
      .get('/api/fx/rate/CAD/INR')
      .set('Authorization', `Bearer ${token}`)

    expect(response.body.rate).toBe(60.9)
    expect(await redis.get('fx:CAD:INR')).toContain('60.9')
  })

  // NFR-4: the cache is never authoritative.
  it('drops a corrupt cache entry rather than serving it', async () => {
    const token = await signIn()
    await push(60.5)
    await redis.set('fx:CAD:INR', 'not json at all')

    const response = await request(app)
      .get('/api/fx/rate/CAD/INR')
      .set('Authorization', `Bearer ${token}`)

    expect(response.body.rate).toBe(60.5) // from the database
  })

  it('404s for a pair that has never been observed', async () => {
    const token = await signIn()
    const response = await request(app)
      .get('/api/fx/rate/CAD/NGN')
      .set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(404)
  })
})


describe('repeated observations', () => {
  // The poller re-reads the same daily reference rate every few hours. Storing each read
  // would fill the history with zero day-to-day changes and understate how rates move.
  it('stores an observation seen twice only once', async () => {
    await push(61.2, '2027-01-05T15:00:00Z')
    const second = await push(61.2, '2027-01-05T15:00:00Z')

    expect(second.status).toBe(202)
    expect(second.body.alertsTriggered).toBe(0)
    expect(await db.fxRate.count()).toBe(1)
  })
})


describe('concurrent repeats', () => {
  // Found running the real poller: a startup run and a hot reload read the same publication
  // at the same moment, both passed the "seen it before?" lookup, and both inserted.
  it('stores one row when the same observation is recorded several times at once', async () => {
    const observation = {
      baseCurrency: 'CAD',
      quoteCurrency: 'INR',
      rate: 68.955,
      observedAt: new Date('2026-09-11T15:00:00Z'),
    }

    const results = await Promise.all([fx.record(observation), fx.record(observation), fx.record(observation)])

    expect(await db.fxRate.count()).toBe(1)
    expect(results.every((fired) => Array.isArray(fired))).toBe(true)
  })
})

describe('deleting an alert', () => {
  const createAlert = async (token: string) => {
    const response = await request(app)
      .post('/api/fx/alerts')
      .set('authorization', `Bearer ${token}`)
      .send({ baseCurrency: 'CAD', quoteCurrency: 'INR', targetRate: 63, direction: 'AT_OR_ABOVE' })
    expect(response.status).toBe(201)
    return response.body.id as string
  }

  it("removes the owner's alert so it can no longer fire", async () => {
    const token = await signIn()
    const id = await createAlert(token)

    const deleted = await request(app).delete(`/api/fx/alerts/${id}`).set('authorization', `Bearer ${token}`)
    expect(deleted.status).toBe(204)

    const listed = await request(app).get('/api/fx/alerts').set('authorization', `Bearer ${token}`)
    expect(listed.body.alerts).toEqual([])

    await push(64)
    expect(notified).toHaveLength(0)
  })

  it("cannot delete another student's alert, and does not reveal that it exists", async () => {
    const owner = await signIn('owner@example.com')
    const intruder = await signIn('intruder@example.com')
    const id = await createAlert(owner)

    const attempt = await request(app).delete(`/api/fx/alerts/${id}`).set('authorization', `Bearer ${intruder}`)

    expect(attempt.status).toBe(404)
    expect(await db.fxAlert.count({ where: { id } })).toBe(1)
  })

  it('answers 404 for an alert that does not exist or an id that is malformed', async () => {
    const token = await signIn()

    const missing = await request(app).delete('/api/fx/alerts/0123456789abcdef01234567').set('authorization', `Bearer ${token}`)
    const malformed = await request(app).delete('/api/fx/alerts/not-an-id').set('authorization', `Bearer ${token}`)

    expect(missing.status).toBe(404)
    expect(malformed.status).toBe(404)
  })

  it('requires a session', async () => {
    const id = await createAlert(await signIn())

    const anonymous = await request(app).delete(`/api/fx/alerts/${id}`)

    expect(anonymous.status).toBe(401)
    expect(await db.fxAlert.count({ where: { id } })).toBe(1)
  })
})
