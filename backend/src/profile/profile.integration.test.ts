import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals'
import request from 'supertest'
import { testDatabase } from '../testing/database.js'
import { createApp } from '../http/app.js'
import { loadEnv } from '../config/env.js'
import { createTokenService } from '../auth/tokens.js'
import { createShiftRepository } from '../shifts/repository.js'

const db = testDatabase('profile')
const tokens = createTokenService('profile-test-secret-long-enough', 3600)
const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'mongodb://localhost:27017/funded_test_profile',
  JWT_SECRET: 'a-secret-long-enough-to-pass-validation',
  FX_WEBHOOK_SECRET: 'webhook-secret-16+',
} as NodeJS.ProcessEnv)

let app: Awaited<ReturnType<typeof createApp>>

beforeAll(async () => {
  app = await createApp({
    env,
    checkHealth: async () => ({ mongo: 'up' }),
    db,
    tokens,
    shifts: createShiftRepository(db),
  })
})

beforeEach(async () => {
  await db.shift.deleteMany()
  await db.user.deleteMany()
})

afterAll(async () => {
  await db.$disconnect()
})

const signIn = async (email = 'profile@example.com') => {
  const response = await request(app).post('/api/auth/local').send({ email })
  return response.body.token as string
}

const permit = {
  institution: 'Dalhousie University',
  programEndsOn: '2027-12-15T12:00:00.000Z',
  expiresOn: '2028-03-31T12:00:00.000Z',
  weeklyHourCap: 20,
}

const me = (token: string) => request(app).get('/api/me').set('Authorization', `Bearer ${token}`)
const patch = (token: string, body: object) =>
  request(app).patch('/api/me').set('Authorization', `Bearer ${token}`).send(body)

describe('the profile endpoint', () => {
  it('starts a new account as not set up, named from its email', async () => {
    const response = await me(await signIn())
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ displayName: '', onboarded: false, permit: null })
  })

  it('saves the profile one section at a time', async () => {
    const token = await signIn()
    const named = await patch(token, { displayName: 'Mansi Patil', homeCurrency: 'inr' })
    expect(named.body).toMatchObject({ displayName: 'Mansi Patil', homeCurrency: 'INR' })

    await patch(token, { permit })
    const reread = await me(token)
    expect(reread.body.displayName).toBe('Mansi Patil')
    expect(reread.body.permit).toMatchObject({ institution: 'Dalhousie University', weeklyHourCap: 20 })
  })

  it('refuses a permit sent half-filled, naming what is missing', async () => {
    const response = await patch(await signIn(), { permit: { institution: 'Dal' } })
    expect(response.status).toBe(400)
    expect(response.body.error).toBe('validation_failed')
  })

  it('will not finish setup before a permit is recorded', async () => {
    const response = await patch(await signIn(), { completeOnboarding: true })
    expect(response.status).toBe(422)
    expect(response.body.error).toBe('permit_required')
  })

  it('finishes setup once the permit is present', async () => {
    const response = await patch(await signIn(), {
      permit,
      budget: { monthlyIncomeMinor: 180_000, monthlySpendingMinor: 120_000, minimumBufferMinor: 50_000 },
      completeOnboarding: true,
    })
    expect(response.status).toBe(200)
    expect(response.body.onboarded).toBe(true)
    expect(response.body.budget.monthlyIncomeMinor).toBe(180_000)
  })

  // The bug this guards: signing in used to overwrite the name with the sign-in form's.
  it('keeps a chosen name when the student signs in again', async () => {
    const first = await signIn()
    await patch(first, { displayName: 'Mansi Patil' })
    const second = await signIn()
    expect((await me(second)).body.displayName).toBe('Mansi Patil')
  })

  it('requires a signed-in student', async () => {
    expect((await request(app).get('/api/me')).status).toBe(401)
  })

  it('only ever returns the caller their own profile', async () => {
    const mine = await signIn('mine@example.com')
    const theirs = await signIn('theirs@example.com')
    await patch(mine, { displayName: 'Mine Only' })
    expect((await me(theirs)).body.displayName).toBe('')
  })
})

describe('compliance uses the permit on file', () => {
  const logTwentyOneHours = async (token: string) => {
    for (const [day, end] of [['08', '18'], ['09', '19']] as const) {
      await request(app)
        .post('/api/shifts')
        .set('Authorization', `Bearer ${token}`)
        .send({ startedAt: `2026-09-${day}T08:00:00`, endedAt: `2026-09-${day}T${end}:00:00`, employer: 'Cafe' })
    }
  }

  it("applies the student's own weekly cap", async () => {
    const token = await signIn()
    await patch(token, { permit })
    await logTwentyOneHours(token)

    const compliance = await request(app).get('/api/shifts/compliance').set('Authorization', `Bearer ${token}`)
    expect(compliance.body.capHours).toBe(20)
    expect(compliance.body.weeks[0].breached).toBe(true)
    expect(compliance.body.weeks[0].remainingHours).toBe(-1)
  })

  it('falls back to 24 hours before any permit exists', async () => {
    const token = await signIn()
    await logTwentyOneHours(token)

    const compliance = await request(app).get('/api/shifts/compliance').set('Authorization', `Bearer ${token}`)
    expect(compliance.body.capHours).toBe(24)
    expect(compliance.body.weeks[0].breached).toBe(false)
  })
})
