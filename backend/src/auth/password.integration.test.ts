import { afterAll, beforeEach, describe, expect, it } from '@jest/globals'
import request from 'supertest'
import type { Express } from 'express'
import { testDatabase } from '../testing/database.js'
import { createApp } from '../http/app.js'
import { loadEnv } from '../config/env.js'
import { createTokenService } from './tokens.js'

/**
 * Email and password accounts through the real HTTP surface and a real database: sign-up,
 * sign-in, the failure responses an attacker sees, attempt limiting, and changing a password.
 */

const db = testDatabase('password')
const tokens = createTokenService('password-test-secret-long-24', 3600)
const STRONG = 'correct horse battery'

const appFor = (nodeEnv: 'development' | 'production' = 'production') =>
  createApp({
    env: loadEnv({
      NODE_ENV: nodeEnv,
      DATABASE_URL: 'mongodb://localhost:27017/funded_test_password',
      JWT_SECRET: 'a-secret-long-enough-to-pass-validation',
      FX_WEBHOOK_SECRET: 'webhook-secret-16+',
    } as NodeJS.ProcessEnv),
    checkHealth: async () => ({ mongo: 'up' }),
    db,
    tokens,
  })

let app: Express

const register = (body: Record<string, unknown>, target: Express = app) =>
  request(target).post('/api/auth/register').send(body)
const login = (email: string, password: string, target: Express = app) =>
  request(target).post('/api/auth/login').send({ email, password })

beforeEach(async () => {
  await db.user.deleteMany()
  // A fresh app per test is a fresh set of attempt counters, so tests cannot lock each other out.
  app = await appFor()
})

afterAll(async () => {
  await db.$disconnect()
})

describe('sign-up', () => {
  it('creates an account, signs the student in, and stores a hash rather than the password', async () => {
    const response = await register({ email: 'Mansi@Example.com', password: STRONG, displayName: 'Mansi Patil' })

    expect(response.status).toBe(201)
    expect(response.body.user).toMatchObject({ email: 'mansi@example.com', displayName: 'Mansi Patil' })
    expect(response.body.user.passwordHash).toBeUndefined()

    const me = await request(app).get('/api/me').set('authorization', `Bearer ${response.body.token}`)
    expect(me.status).toBe(200)
    expect(me.body).toMatchObject({ displayName: 'Mansi Patil', onboarded: false })
    expect(me.body.passwordHash).toBeUndefined()

    const row = await db.user.findUnique({ where: { email: 'mansi@example.com' } })
    expect(row?.passwordHash).toMatch(/^scrypt\$/)
    expect(row?.passwordHash).not.toContain(STRONG)
  })

  it.each([
    [{ password: 'short1', displayName: 'A' }, 'Use at least 8 characters'],
    [{ password: 'password123', displayName: 'A' }, 'That password is too common. Choose another'],
    [{ password: 'new.student', displayName: 'A' }, 'Do not use your email address as your password'],
  ])('refuses a weak password %#', async (body, message) => {
    const response = await register({ email: 'new.student@example.com', ...body })

    expect(response.status).toBe(400)
    expect(response.body.message).toBe(message)
    expect(await db.user.count()).toBe(0)
  })

  it('requires a name and a valid email', async () => {
    expect((await register({ email: 'a@example.com', password: STRONG, displayName: '  ' })).status).toBe(400)
    expect((await register({ email: 'not-an-email', password: STRONG, displayName: 'A' })).status).toBe(400)
  })

  it('refuses a second account for the same email, and leaves the first password working', async () => {
    await register({ email: 'taken@example.com', password: STRONG, displayName: 'Original' })

    const second = await register({ email: 'TAKEN@example.com', password: 'another strong one', displayName: 'Intruder' })

    expect(second.status).toBe(409)
    expect((await login('taken@example.com', STRONG)).status).toBe(200)
    expect((await login('taken@example.com', 'another strong one')).status).toBe(401)
    expect((await db.user.findUnique({ where: { email: 'taken@example.com' } }))?.displayName).toBe('Original')
  })

  it('cannot claim an existing account that has no password in production', async () => {
    await db.user.create({ data: { email: 'legacy@example.com', displayName: 'Legacy', homeCurrency: 'INR' } })

    const claim = await register({ email: 'legacy@example.com', password: STRONG, displayName: 'Attacker' })

    expect(claim.status).toBe(409)
    expect((await db.user.findUnique({ where: { email: 'legacy@example.com' } }))?.passwordHash ?? null).toBeNull()
  })

  it('lets a development account made by email-only sign-in set a password', async () => {
    const dev = await appFor('development')
    await request(dev).post('/api/auth/local').send({ email: 'dev@example.com' })

    const claim = await register({ email: 'dev@example.com', password: STRONG, displayName: 'Dev' }, dev)

    expect(claim.status).toBe(201)
    expect((await login('dev@example.com', STRONG, dev)).status).toBe(200)
  })
})

describe('sign-in', () => {
  beforeEach(async () => {
    await register({ email: 'student@example.com', password: STRONG, displayName: 'Student' })
    app = await appFor() // registration attempts are counted too; start sign-in tests clean
  })

  it('returns a working token for the right password, whatever the email case', async () => {
    const response = await login('  Student@Example.COM ', STRONG)

    expect(response.status).toBe(200)
    const me = await request(app).get('/api/me').set('authorization', `Bearer ${response.body.token}`)
    expect(me.body.email).toBe('student@example.com')
  })

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrongPassword = await login('student@example.com', 'not the password')
    const unknownEmail = await login('nobody@example.com', 'not the password')

    expect(wrongPassword.status).toBe(401)
    expect(unknownEmail.status).toBe(401)
    expect(wrongPassword.body).toEqual(unknownEmail.body)
    expect(wrongPassword.body.message).toBe('Incorrect email or password')
  })

  it('refuses an account that has no password set', async () => {
    await db.user.create({ data: { email: 'nopass@example.com', displayName: 'No Pass', homeCurrency: 'INR' } })
    expect((await login('nopass@example.com', '')).status).toBe(400)
    expect((await login('nopass@example.com', STRONG)).status).toBe(401)
  })

  it('blocks an email after 5 failures, even with the right password, without blocking other students', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await login('student@example.com', `guess number ${attempt}`)).status).toBe(401)
    }

    const blocked = await login('student@example.com', STRONG)
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
    expect(blocked.body.message).toMatch(/Too many sign-in attempts/)

    await register({ email: 'other@example.com', password: STRONG, displayName: 'Other' })
    expect((await login('other@example.com', STRONG)).status).toBe(200)
  })

  it('clears the failure count after a successful sign-in', async () => {
    for (let attempt = 0; attempt < 4; attempt++) await login('student@example.com', `guess ${attempt}`)
    expect((await login('student@example.com', STRONG)).status).toBe(200)

    for (let attempt = 0; attempt < 4; attempt++) {
      expect((await login('student@example.com', `again ${attempt}`)).status).toBe(401)
    }
    expect((await login('student@example.com', STRONG)).status).toBe(200)
  })
})

describe('changing a password', () => {
  let token: string

  beforeEach(async () => {
    token = (await register({ email: 'change@example.com', password: STRONG, displayName: 'Change' })).body.token
  })

  const change = (body: Record<string, unknown>, bearer: string | null = token) => {
    const call = request(app).post('/api/auth/password').send(body)
    return bearer ? call.set('authorization', `Bearer ${bearer}`) : call
  }

  it('replaces the password once the current one is confirmed', async () => {
    const response = await change({ currentPassword: STRONG, newPassword: 'a brand new passphrase' })

    expect(response.status).toBe(204)
    expect((await login('change@example.com', STRONG)).status).toBe(401)
    expect((await login('change@example.com', 'a brand new passphrase')).status).toBe(200)
  })

  it('refuses a wrong current password without signing the student out', async () => {
    const response = await change({ currentPassword: 'not it at all', newPassword: 'a brand new passphrase' })

    // 400, not 401: the session is valid, and a 401 would make the web app discard it.
    expect(response.status).toBe(400)
    expect(response.body.message).toBe('Your current password is incorrect')
    expect((await login('change@example.com', STRONG)).status).toBe(200)
  })

  it('applies the same rules to the new password, and refuses reusing the current one', async () => {
    expect((await change({ currentPassword: STRONG, newPassword: 'short' })).body.message).toBe('Use at least 8 characters')
    expect((await change({ currentPassword: STRONG, newPassword: STRONG })).body.message).toBe(
      'Choose a password different from your current one',
    )
  })

  it('requires a session', async () => {
    expect((await change({ currentPassword: STRONG, newPassword: 'a brand new passphrase' }, null)).status).toBe(401)
  })
})
