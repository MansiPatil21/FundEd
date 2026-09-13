import { afterAll, beforeEach, describe, expect, it } from '@jest/globals'
import request from 'supertest'
import { testDatabase } from '../testing/database.js'
import { createApp } from '../http/app.js'
import { loadEnv } from '../config/env.js'
import { createTokenService } from '../auth/tokens.js'
import { createShiftRepository } from '../shifts/repository.js'
import { createObligationRepository } from '../obligations/repository.js'
import type { OptimiserClient, OptimiserSaving, PlanOutcome } from '../optimizer/client.js'

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

const stubOptimiser = (outcome: PlanOutcome, overrides: Partial<OptimiserClient> = {}): OptimiserClient => ({
  plan: async () => outcome,
  baseline: async () => outcome,
  saving: async () => ({ kind: 'unavailable', reason: 'saving not stubbed' }),
  healthy: async () => outcome.kind !== 'unavailable',
  ...overrides,
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
  await db.fxRate.deleteMany()
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


const baselineOutcome: PlanOutcome = {
  kind: 'planned',
  plan: {
    status: 'BASELINE',
    transfers: [
      { send_on: '2027-01-01', amount_minor: 14_000, fee_minor: 500, rate: 61, received_home_minor: 854_000 },
      { send_on: '2027-02-01', amount_minor: 14_000, fee_minor: 500, rate: 61, received_home_minor: 854_000 },
      { send_on: '2027-03-01', amount_minor: 14_000, fee_minor: 500, rate: 61, received_home_minor: 854_000 },
    ],
    total_sent_minor: 41_000,
    total_fees_minor: 1_500,
    total_cost_minor: 42_500,
    closing_balance_minor: 9_000,
  },
}

describe('comparison with sending monthly', () => {
  it('reports what the plan saves over fixed monthly transfers', async () => {
    const app = await appWith(stubOptimiser(plannedOutcome, { baseline: async () => baselineOutcome }))
    const token = await signIn(app)
    await addObligation(app, token)

    const response = await request(app).post('/api/plan').set('Authorization', `Bearer ${token}`).send(planBody)

    expect(response.status).toBe(200)
    expect(response.body.baseline).toEqual({ transfers: 3, totalFeesMinor: 1_500, totalCostMinor: 42_500 })
    // 42,500 for monthly transfers against 41,499 for the plan.
    expect(response.body.savingMinor).toBe(1_001)
    expect(response.body.caveat).toContain('fewer transfer fees')
  })

  it('still returns the plan when only the comparison is unavailable', async () => {
    const app = await appWith(
      stubOptimiser(plannedOutcome, { baseline: async () => ({ kind: 'unavailable', reason: 'down' }) }),
    )
    const token = await signIn(app)
    await addObligation(app, token)

    const response = await request(app).post('/api/plan').set('Authorization', `Bearer ${token}`).send(planBody)

    expect(response.status).toBe(200)
    expect(response.body.transfers).toHaveLength(1)
    expect(response.body.baseline).toBeNull()
    expect(response.body.savingMinor).toBeNull()
  })
})

describe('POST /api/plan/saving', () => {
  const estimated: OptimiserSaving = {
    paths: 40,
    feasible_paths: 40,
    mean_saving_minor: 5_650.875,
    median_saving_minor: 5_602.5,
    ci_low_minor: 4_971.306875,
    ci_high_minor: 6_354.4175,
    confidence: 0.95,
    significant: true,
    caveat: 'upper bound on what perfect timing is worth',
  }

  /** Inserted newest first, so the test proves the API returns them oldest first. */
  const seedRates = (rates: number[], quoteCurrency = 'INR') =>
    db.fxRate.createMany({
      data: rates
        .map((rate, day) => ({
          baseCurrency: 'CAD',
          quoteCurrency,
          rate,
          observedAt: new Date(Date.UTC(2026, 7, 1 + day, 14)),
        }))
        .reverse(),
    })

  it('explains that it needs more observed rates instead of guessing', async () => {
    const app = await appWith(stubOptimiser(plannedOutcome))
    const token = await signIn(app)
    await addObligation(app, token)
    await seedRates([61.0, 61.2])

    const response = await request(app).post('/api/plan/saving').set('Authorization', `Bearer ${token}`).send(planBody)

    expect(response.status).toBe(422)
    expect(response.body.error).toBe('not_enough_history')
    expect(response.body.observed).toBe(2)
    expect(response.body.message).toContain('at least 3')
  })

  it("estimates from the student's observed rates, oldest first, in whole minor units", async () => {
    let received: number[] = []
    const app = await appWith(
      stubOptimiser(plannedOutcome, {
        saving: async (_input, history) => {
          received = history
          return { kind: 'estimated', saving: estimated }
        },
      }),
    )
    const token = await signIn(app)
    await addObligation(app, token)
    await seedRates([61.0, 61.2, 61.1, 61.5, 61.4])

    const response = await request(app).post('/api/plan/saving').set('Authorization', `Bearer ${token}`).send(planBody)

    expect(response.status).toBe(200)
    expect(received).toEqual([61.0, 61.2, 61.1, 61.5, 61.4])
    expect(response.body).toMatchObject({
      historyUsed: 5,
      meanSavingMinor: 5_651,
      ciLowMinor: 4_971,
      ciHighMinor: 6_354,
      significant: true,
    })
  })

  it("ignores rates for a currency pair that is not the student's", async () => {
    const app = await appWith(stubOptimiser(plannedOutcome))
    const token = await signIn(app)
    await addObligation(app, token)
    await seedRates([700, 705, 702, 710], 'NGN')

    const response = await request(app).post('/api/plan/saving').set('Authorization', `Bearer ${token}`).send(planBody)

    expect(response.status).toBe(422)
    expect(response.body.observed).toBe(0)
  })

  it('returns 503 naming the unavailable estimate, not a 500', async () => {
    const app = await appWith(stubOptimiser(plannedOutcome))
    const token = await signIn(app)
    await addObligation(app, token)
    await seedRates([61.0, 61.2, 61.1])

    const response = await request(app).post('/api/plan/saving').set('Authorization', `Bearer ${token}`).send(planBody)

    expect(response.status).toBe(503)
    expect(response.body.error).toBe('optimiser_unavailable')
    expect(response.body.hint).toContain('plan still works')
  })

  it('refuses to estimate when nothing falls due in the horizon', async () => {
    const app = await appWith(stubOptimiser(plannedOutcome))
    const token = await signIn(app)
    await seedRates([61.0, 61.2, 61.1])

    const response = await request(app).post('/api/plan/saving').set('Authorization', `Bearer ${token}`).send(planBody)

    expect(response.status).toBe(422)
    expect(response.body.error).toBe('nothing_to_plan')
  })
})
