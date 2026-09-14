import { describe, expect, it } from '@jest/globals'
import request from 'supertest'
import { createApp } from './app.js'
import { loadEnv } from '../config/env.js'

const appWith = (services: Record<string, 'up' | 'down'>) =>
  createApp({
    env: loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'mongodb://localhost:27017/unused',
      JWT_SECRET: 'a-secret-long-enough-to-pass-validation',
      FX_WEBHOOK_SECRET: 'webhook-secret-16+',
    } as NodeJS.ProcessEnv),
    checkHealth: async () => services,
  })

describe('health endpoints', () => {
  it('reports a sleeping optimizer on /health, but stays live for the platform', async () => {
    const app = await appWith({ mongo: 'up', redis: 'up', optimiser: 'down' })

    const readiness = await request(app).get('/health')
    const liveness = await request(app).get('/health/live')

    expect(readiness.status).toBe(503)
    expect(readiness.body.services.optimiser).toBe('down')
    expect(liveness.status).toBe(200)
    expect(liveness.body).toEqual({ status: 'ok' })
  })

  it('does not consult dependencies for liveness at all', async () => {
    let consulted = false
    const app = await createApp({
      env: loadEnv({
        NODE_ENV: 'test',
        DATABASE_URL: 'mongodb://localhost:27017/unused',
        JWT_SECRET: 'a-secret-long-enough-to-pass-validation',
        FX_WEBHOOK_SECRET: 'webhook-secret-16+',
      } as NodeJS.ProcessEnv),
      checkHealth: async () => {
        consulted = true
        return { mongo: 'down' }
      },
    })

    expect((await request(app).get('/health/live')).status).toBe(200)
    expect(consulted).toBe(false)
  })
})
