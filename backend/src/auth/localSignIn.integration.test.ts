import { afterAll, beforeEach, describe, expect, it } from '@jest/globals'
import request from 'supertest'
import { testDatabase } from '../testing/database.js'
import { createApp } from '../http/app.js'
import { loadEnv } from '../config/env.js'
import { createTokenService } from './tokens.js'

const db = testDatabase('auth')
const tokens = createTokenService('auth-test-secret-long-enough-24', 3600)

const appFor = (overrides: Record<string, string>) =>
  createApp({
    env: loadEnv({
      DATABASE_URL: 'mongodb://localhost:27017/funded_test_auth',
      JWT_SECRET: 'a-secret-long-enough-to-pass-validation',
      FX_WEBHOOK_SECRET: 'webhook-secret-16+',
      ...overrides,
    } as NodeJS.ProcessEnv),
    checkHealth: async () => ({ mongo: 'up' }),
    db,
    tokens,
  })

beforeEach(async () => {
  await db.user.deleteMany()
})

afterAll(async () => {
  await db.$disconnect()
})

describe('email-only sign-in', () => {
  it('is available in development', async () => {
    const app = await appFor({ NODE_ENV: 'development' })
    const response = await request(app).post('/api/auth/local').send({ email: 'dev@example.com' })
    expect(response.status).toBe(200)
  })

  // A route that does not exist, not a 403: production should not advertise it at all.
  it('is absent in production by default', async () => {
    const app = await appFor({ NODE_ENV: 'production' })
    const response = await request(app).post('/api/auth/local').send({ email: 'prod@example.com' })
    expect(response.status).toBe(404)
    expect(await db.user.count()).toBe(0)
  })

  it('can be switched on explicitly, for running the production images locally', async () => {
    const app = await appFor({ NODE_ENV: 'production', ALLOW_LOCAL_SIGN_IN: 'true' })
    const response = await request(app).post('/api/auth/local').send({ email: 'local@example.com' })
    expect(response.status).toBe(200)
  })
})
