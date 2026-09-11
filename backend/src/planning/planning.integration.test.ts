import { afterAll, beforeEach, describe, expect, it } from '@jest/globals'
import request from 'supertest'
import { testDatabase } from '../testing/database.js'
import { createApp } from '../http/app.js'
import { loadEnv } from '../config/env.js'
import { createTokenService } from '../auth/tokens.js'
import { createShiftRepository } from '../shifts/repository.js'
import { createObligationRepository } from '../obligations/repository.js'
import type { OptimiserClient, PlanOutcome } from '../optimizer/client.js'

/**
 * End-to-end over the planning path, against the real database.
 *
 * The optimiser itself is substituted here, because what these tests are about is
 * how the API behaves when the optimiser answers, refuses, or is not there at all.
 * The optimiser's own correctness is covered by its Python tests, and its transport
 * behaviour by ../optimizer/client.test.ts against real sockets.
 */

const db = testDatabase('planning')
const DATABASE_URL = 'mongodb://localhost:27017/funded_test_planning'
const tokens = createTokenService('planning-test-secret', 3600)
const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL,
  JWT_SECRET: 'a-secret-long-enough-to-pass-validation',
  FX_WEBHOOK_SECRET: 'webhook-secret-16+',
} as NodeJS.ProcessEnv)

const stubOptimiser = (outcome: PlanOutcome): OptimiserClient => ({
  plan: async () => outcome,
  healthy: async () => outcome.kind !== 'unavailable',
})

const appWith = (optimiser: OptimiserClient) =>
  createApp({
    env,
    checkHealth: async () => ({ mongo: 'up' }),
    db,
    tokens,
    shifts: createShiftRepository(db),
    obligations: createObligationRepository(db),
    optimiser,
  })

const plannedOutcome: PlanOutcome = {
  kind: 'planned',
  plan: {
    status: 'OPTIMAL',
    transfers: [
      { send_on: '2027-01-05', amount_minor: 41_000, fee_minor: 499, rate: 61, received_home_minor: 2_501_000 },
    ],
    total_sent_minor: 41_000,
    total_fees_minor: 499,
    total_cost_minor: 41_499,
    closing_balance_minor: 9_000,
  },
}

type TestApp = Awaited<ReturnType<typeof appWith>>

const signIn = async (app: TestApp, email = 'planner@example.com') => {
  const response = await request(app)
    .post('/api/auth/local')
    .send({ email, displayName: 'Planner', homeCurrency: 'INR' })
  return response.body.token as string
}

const addObligation = (app: TestApp, token: string) =>
  request(app)
    .post('/api/obligations')
    .set('Authorization', `Bearer ${token}`)
    .send({
      label: 'family support',
      amountMinor: 2_500_000,
      currency: 'INR',
      cadence: 'MONTHLY',
      nextDueOn: '2027-01-15',
    })

const planBody = {
  horizonDays: 90,
  startOn: '2027-01-01',
  openingBalanceMinor: 500_000,
  minimumBalanceMinor: 50_000,
  minTransferMinor: 10_000,
  incomePerPeriodMinor: 8_000,
  spendingPerPeriodMinor: 6_000,
  fees: { fixedMinor: 499, variableBps: 60 },
  assumedRate: 61,
}

beforeEach(async () => {
  await db.obligation.deleteMany()
  await db.shift.deleteMany()
  await db.user.deleteMany()
})

afterAll(async () => {
  await db.$disconnect()
})

describe('obligations', () => {
  it('stores and lists an obligation for its owner only', async () => {
    const app = await appWith(stubOptimiser(plannedOutcome))
    const mine = await signIn(app, 'mine@example.com')
    const theirs = await signIn(app, 'theirs@example.com')

    const created = await addObligation(app, mine)
    expect(created.status).toBe(201)

    const ours = await request(app).get('/api/obligations').set('Authorization', `Bearer ${mine}`)
    expect(ours.body.obligations).toHaveLength(1)

    const others = await request(app).get('/api/obligations').set('Authorization', `Bearer ${theirs}`)
    expect(others.body.obligations).toHaveLength(0)
  })
})

describe('POST /api/plan', () => {
  it('expands a monthly obligation across the horizon and returns a schedule', async () => {
    const app = await appWith(stubOptimiser(plannedOutcome))
    const token = await signIn(app)
    await addObligation(app, token)

    const response = await request(app)
      .post('/api/plan')
      .set('Authorization', `Bearer ${token}`)
      .send(planBody)

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('OPTIMAL')
    // Jan 15, Feb 15, Mar 15 all fall inside a 90-day horizon from Jan 1.
    expect(response.body.obligationsPlanned).toBe(3)
    expect(response.body.transfers[0].sendOn).toBe('2027-01-05')
    expect(response.body.caveat).toContain('assumed rate')
  })

  it('refuses to plan when no obligation falls inside the horizon', async () => {
    const app = await appWith(stubOptimiser(plannedOutcome))
    const token = await signIn(app)

    const response = await request(app)
      .post('/api/plan')
      .set('Authorization', `Bearer ${token}`)
      .send(planBody)

    expect(response.status).toBe(422)
    expect(response.body.error).toBe('nothing_to_plan')
  })

  it('passes a solver rejection through as 422 with the reason', async () => {
    const app = await appWith(stubOptimiser({ kind: 'rejected', reason: 'no period can fund "tuition"' }))
    const token = await signIn(app)
    await addObligation(app, token)

    const response = await request(app)
      .post('/api/plan')
      .set('Authorization', `Bearer ${token}`)
      .send(planBody)

    expect(response.status).toBe(422)
    expect(response.body.error).toBe('not_schedulable')
    expect(response.body.message).toContain('tuition')
  })

  // NFR-5: the product degrades rather than fails.
  it('returns 503 naming the one unavailable feature, not a 500', async () => {
    const app = await appWith(stubOptimiser({ kind: 'unavailable', reason: 'optimiser unreachable' }))
    const token = await signIn(app)
    await addObligation(app, token)

    const response = await request(app)
      .post('/api/plan')
      .set('Authorization', `Bearer ${token}`)
      .send(planBody)

    expect(response.status).toBe(503)
    expect(response.body.error).toBe('optimiser_unavailable')
    expect(response.body.hint).toContain('obligations are saved')
  })

  it('keeps the rest of the API working while the optimiser is down', async () => {
    const app = await appWith(stubOptimiser({ kind: 'unavailable', reason: 'down' }))
    const token = await signIn(app)
    await addObligation(app, token)

    const obligations = await request(app)
      .get('/api/obligations')
      .set('Authorization', `Bearer ${token}`)
    const compliance = await request(app)
      .get('/api/shifts/compliance')
      .set('Authorization', `Bearer ${token}`)

    expect(obligations.status).toBe(200)
    expect(obligations.body.obligations).toHaveLength(1)
    expect(compliance.status).toBe(200)
  })

  it('requires an explicit rate assumption rather than defaulting one', async () => {
    const app = await appWith(stubOptimiser(plannedOutcome))
    const token = await signIn(app)
    await addObligation(app, token)

    const { assumedRate, ...withoutRate } = planBody
    const response = await request(app)
      .post('/api/plan')
      .set('Authorization', `Bearer ${token}`)
      .send(withoutRate)

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('validation_failed')
  })
})
