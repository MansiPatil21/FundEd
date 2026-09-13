import { Router, type Response } from 'express'
import { z } from 'zod'
import { currentUser } from '../auth/middleware.js'
import type { ObligationRepository } from '../obligations/repository.js'
import type { OptimiserClient, PlanInput } from '../optimizer/client.js'

/**
 * Turns what the student has stored into a question the optimiser can answer, and turns
 * the answer back into something the dashboard can show.
 *
 * The mapping is the interesting part: obligations are stored as rules with a cadence,
 * and the solver needs concrete dated amounts, so cadences are expanded across the
 * horizon before the request is built.
 */

const planSchema = z.object({
  horizonDays: z.number().int().min(7).max(365).default(180),
  startOn: z.coerce.date().optional(),
  openingBalanceMinor: z.number().int().nonnegative(),
  minimumBalanceMinor: z.number().int().nonnegative().default(0),
  minTransferMinor: z.number().int().nonnegative().default(0),
  incomePerPeriodMinor: z.number().int().nonnegative().default(0),
  spendingPerPeriodMinor: z.number().int().nonnegative().default(0),
  fees: z.object({
    fixedMinor: z.number().int().nonnegative(),
    variableBps: z.number().int().min(0).max(10_000),
  }),
  /**
   * A flat assumed rate. Deliberately required rather than silently defaulted: a plan is
   * only as good as its rate assumption, and hiding that assumption behind a default would
   * make the output look more authoritative than it is.
   */
  assumedRate: z.number().positive(),
})

type PlanBody = z.infer<typeof planSchema>

/** A student's observed rates for their currency pair, oldest first. */
export type RateHistory = (userId: string) => Promise<number[]>

const DAY_MS = 86_400_000

/**
 * Simulated rate paths per uncertainty estimate. Measured on a 180-day horizon, 40 paths
 * took about 9 s and 120 took about 41 s while the interval barely narrowed, so tripling
 * the work buys almost nothing a person would notice.
 */
const SAVING_PATHS = 40
/** The bootstrap resamples day-to-day changes, and fewer than 3 rates give at most one. */
const MIN_HISTORY = 3

export function planningRouter(
  obligations: ObligationRepository,
  optimiser: OptimiserClient,
  rateHistory: RateHistory = async () => [],
): Router {
  const router = Router()

  /** The optimiser request for this student and horizon, or null when nothing falls due in it. */
  const prepare = async (userId: string, input: PlanBody) => {
    const start = startOfDay(input.startOn ?? new Date())
    const end = new Date(start.getTime() + (input.horizonDays - 1) * DAY_MS)

    const occurrences = await obligations.occurrencesFor(userId, start, end)
    if (occurrences.length === 0) return null

    const request: PlanInput = {
      periods: Array.from({ length: input.horizonDays }, (_, day) => ({
        on: isoDate(new Date(start.getTime() + day * DAY_MS)),
        rate: input.assumedRate,
        income_minor: input.incomePerPeriodMinor,
        spending_minor: input.spendingPerPeriodMinor,
      })),
      obligations: occurrences.map((o) => ({
        label: o.label,
        due_on: isoDate(o.dueOn),
        amount_minor: o.amountMinor,
      })),
      fees: { fixed_minor: input.fees.fixedMinor, variable_bps: input.fees.variableBps },
      opening_balance_minor: input.openingBalanceMinor,
      minimum_balance_minor: input.minimumBalanceMinor,
      min_transfer_minor: input.minTransferMinor,
    }

    return { start, end, occurrences, request }
  }

  const nothingToPlan = (res: Response) =>
    res.status(422).json({
      error: 'nothing_to_plan',
      message: 'No obligations fall inside this horizon, so there is nothing to schedule.',
    })

  router.post('/', async (req, res) => {
    const user = currentUser(req)
    const input = planSchema.parse(req.body)
    const prepared = await prepare(user.sub, input)
    if (!prepared) {
      nothingToPlan(res)
      return
    }

    // The comparison runs alongside the plan rather than after it: both are cheap, and a
    // saving means nothing without the thing it is being compared against.
    const [outcome, baseline] = await Promise.all([
      optimiser.plan(prepared.request),
      optimiser.baseline(prepared.request),
    ])

    if (outcome.kind === 'rejected') {
      res.status(422).json({ error: 'not_schedulable', message: outcome.reason })
      return
    }

    // NFR-5. The optimiser is optional: say plainly that this one feature is unavailable
    // rather than returning a 500 that implies the whole API is broken.
    if (outcome.kind === 'unavailable') {
      res.status(503).json({
        error: 'optimiser_unavailable',
        message: outcome.reason,
        obligations: prepared.occurrences.length,
        hint: 'Your obligations are saved. Only the suggested schedule is unavailable.',
      })
      return
    }

    // A failed comparison does not sink the plan. The schedule is still useful; the
    // saving is simply not claimed.
    const comparison =
      baseline.kind === 'planned'
        ? {
            transfers: baseline.plan.transfers.length,
            totalFeesMinor: baseline.plan.total_fees_minor,
            totalCostMinor: baseline.plan.total_cost_minor,
          }
        : null

    res.json({
      horizon: { from: isoDate(prepared.start), to: isoDate(prepared.end), days: input.horizonDays },
      assumedRate: input.assumedRate,
      obligationsPlanned: prepared.occurrences.length,
      status: outcome.plan.status,
      transfers: outcome.plan.transfers.map((transfer) => ({
        sendOn: transfer.send_on,
        amountMinor: transfer.amount_minor,
        feeMinor: transfer.fee_minor,
        rate: transfer.rate,
        receivedHomeMinor: transfer.received_home_minor,
      })),
      totalSentMinor: outcome.plan.total_sent_minor,
      totalFeesMinor: outcome.plan.total_fees_minor,
      totalCostMinor: outcome.plan.total_cost_minor,
      closingBalanceMinor: outcome.plan.closing_balance_minor,
      baseline: comparison,
      savingMinor:
        comparison && outcome.plan.transfers.length > 0
          ? comparison.totalCostMinor - outcome.plan.total_cost_minor
          : null,
      caveat:
        'Computed against a single assumed rate. A real rate path will differ, so treat the ' +
        'schedule as guidance rather than a guarantee. At one flat rate, any saving comes ' +
        'from paying fewer transfer fees.',
    })
  })

  router.post('/saving', async (req, res) => {
    const user = currentUser(req)
    const input = planSchema.parse(req.body)
    const prepared = await prepare(user.sub, input)
    if (!prepared) {
      nothingToPlan(res)
      return
    }

    const history = await rateHistory(user.sub)
    if (history.length < MIN_HISTORY) {
      res.status(422).json({
        error: 'not_enough_history',
        observed: history.length,
        message: `Estimating how rates could move needs at least ${MIN_HISTORY} observed exchange rates, and FundEd has ${history.length} so far.`,
      })
      return
    }

    const outcome = await optimiser.saving(prepared.request, history, { paths: SAVING_PATHS, confidence: 0.95 })

    if (outcome.kind === 'rejected') {
      res.status(422).json({ error: 'not_schedulable', message: outcome.reason })
      return
    }
    if (outcome.kind === 'unavailable') {
      res.status(503).json({
        error: 'optimiser_unavailable',
        message: outcome.reason,
        hint: 'Your plan still works. Only the uncertainty estimate is unavailable.',
      })
      return
    }

    const saving = outcome.saving
    res.json({
      paths: saving.paths,
      feasiblePaths: saving.feasible_paths,
      // Money leaves the API in whole minor units, never fractions of a cent.
      meanSavingMinor: Math.round(saving.mean_saving_minor),
      medianSavingMinor: Math.round(saving.median_saving_minor),
      ciLowMinor: Math.round(saving.ci_low_minor),
      ciHighMinor: Math.round(saving.ci_high_minor),
      confidence: saving.confidence,
      significant: saving.significant,
      historyUsed: history.length,
      caveat: saving.caveat,
    })
  })

  return router
}

function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
