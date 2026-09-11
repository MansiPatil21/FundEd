import { describe, expect, it } from '@jest/globals'
import request from 'supertest'
import { createApp } from './app.js'
import { loadEnv } from '../config/env.js'

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'mongodb://localhost:27017/funded_test',
  JWT_SECRET: 'a-secret-long-enough-to-pass-validation',
  FX_WEBHOOK_SECRET: 'webhook-secret-16+',
} as NodeJS.ProcessEnv)

/** No database, no Redis: createApp mounts only what it is given dependencies for. */
const appWith = (services: Record<string, 'up' | 'down'>) =>
  createApp({ env, checkHealth: async () => services })

const healthy = () => appWith({ mongo: 'up', redis: 'up' })

describe('GET /health', () => {
  it('returns 200 when every dependency is up', async () => {
    const response = await request(await healthy()).get('/health')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok', services: { mongo: 'up', redis: 'up' } })
  })

  it('returns 503 when a dependency is down, so traffic is routed away', async () => {
    const response = await request(await appWith({ mongo: 'up', redis: 'down' })).get('/health')
    expect(response.status).toBe(503)
    expect(response.body.status).toBe('degraded')
  })
})

describe('POST /api/compliance/usage', () => {
  it('reports weekly usage and the current week together', async () => {
    const response = await request(await healthy())
      .post('/api/compliance/usage')
      .send({
        shifts: [{ startedAt: '2026-09-08T09:00:00', endedAt: '2026-09-08T17:00:00' }],
        capHours: 24,
        asOf: '2026-09-11T12:00:00',
      })

    expect(response.status).toBe(200)
    expect(response.body.weeks).toHaveLength(1)
    expect(response.body.current.offCampusHours).toBe(8)
    expect(response.body.current.remainingHours).toBe(16)
  })

  it('rejects a shift that ends before it starts, naming the field', async () => {
    const response = await request(await healthy())
      .post('/api/compliance/usage')
      .send({ shifts: [{ startedAt: '2026-09-08T17:00:00', endedAt: '2026-09-08T09:00:00' }] })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('validation_failed')
    expect(response.body.issues[0].path).toContain('endedAt')
  })

  it('rejects a cap outside the hours in a week', async () => {
    const response = await request(await healthy())
      .post('/api/compliance/usage')
      .send({ shifts: [], capHours: 200 })

    expect(response.status).toBe(400)
  })
})

describe('POST /api/compliance/would-breach', () => {
  const existing = [
    { startedAt: '2026-09-08T08:00:00', endedAt: '2026-09-08T18:00:00' },
    { startedAt: '2026-09-09T08:00:00', endedAt: '2026-09-09T18:00:00' },
  ]

  it('answers false when the shift fits', async () => {
    const response = await request(await healthy())
      .post('/api/compliance/would-breach')
      .send({
        shifts: existing,
        proposed: { startedAt: '2026-09-10T09:00:00', endedAt: '2026-09-10T13:00:00' },
      })
    expect(response.body.wouldBreach).toBe(false)
  })

  it('answers true when the shift would push the week over', async () => {
    const response = await request(await healthy())
      .post('/api/compliance/would-breach')
      .send({
        shifts: existing,
        proposed: { startedAt: '2026-09-10T09:00:00', endedAt: '2026-09-10T15:00:00' },
      })
    expect(response.body.wouldBreach).toBe(true)
  })
})

describe('unknown routes', () => {
  it('return 404 as JSON, not an HTML error page', async () => {
    const response = await request(await appWith({ mongo: 'up' })).get('/nope')
    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: 'not_found' })
  })
})

describe('routes that need dependencies', () => {
  it('are simply absent when those dependencies were not supplied', async () => {
    const response = await request(await healthy()).get('/api/shifts')
    expect(response.status).toBe(404)
  })
})
