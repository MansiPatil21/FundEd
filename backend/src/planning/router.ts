import { Router } from 'express'
import { z } from 'zod'
import { currentUser } from '../auth/middleware.js'
import type { ObligationRepository } from '../obligations/repository.js'
import type { OptimiserClient } from '../optimizer/client.js'

/**
 * Turns what the student has stored into a question the optimiser can answer, and
 * turns the answer back into something the dashboard can show.
 *
 * The mapping is the interesting part: obligations are stored as rules with a
 * cadence, and the solver needs concrete dated amounts, so cadences are expanded
 * across the horizon before the request is built.
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
   * A flat assumed rate. Deliberately required rather than silently defaulted: a
   * plan is only as good as its rate assumption, and hiding that assumption behind
   * a default would make the output look more authoritative than it is.
   */
  assumedRate: z.number().positive(),
})

const DAY_MS = 86_400_000

export function planningRouter(
  obligations: ObligationRepository,
  optimiser: OptimiserClient,
): Router {
  const router = Router()

  router.post('/', async (req, res) => {
    const user = currentUser(req)
    const input = planSchema.parse(req.body)

    const start = startOfDay(input.startOn ?? new Date())
    const end = new Date(start.getTime() + (input.horizonDays - 1) * DAY_MS)

    const occurrences = await obligations.occurrencesFor(user.sub, start, end)
    if (occurrences.length === 0) {
      res.status(422).json({
        error: 'nothing_to_plan',
        message: 'No obligations fall inside this horizon, so there is nothing to schedule.',
      })
      return
    }

    const periods = Array.from({ length: input.horizonDays }, (_, day) => ({
      on: isoDate(new Date(start.getTime() + day * DAY_MS)),
      rate: input.assumedRate,
      income_minor: input.incomePerPeriodMinor,
      spending_minor: input.spendingPerPeriodMinor,
    }))

    const outcome = await optimiser.plan({
      periods,
      obligations: occurrences.map((o) => ({
        label: o.label,
        due_on: isoDate(o.dueOn),
        amount_minor: o.amountMinor,
      })),
      fees: { fixed_minor: input.fees.fixedMinor, variable_bps: input.fees.variableBps },
      opening_balance_minor: input.openingBalanceMinor,
      minimum_balance_minor: input.minimumBalanceMinor,
      min_transfer_minor: input.minTransferMinor,
    })

    if (outcome.kind === 'rejected') {
      res.status(422).json({ error: 'not_schedulable', message: outcome.reason })
      return
    }

    // NFR-5. The optimiser is optional: say plainly that this one feature is
    // unavailable rather than returning a 500 that implies the whole API is broken.
    if (outcome.kind === 'unavailable') {
      res.status(503).json({
        error: 'optimiser_unavailable',
        message: outcome.reason,
        obligations: occurrences.length,
        hint: 'Your obligations are saved. Only the suggested schedule is unavailable.',
      })
      return
    }

    res.json({
      horizon: { from: isoDate(start), to: isoDate(end), days: input.horizonDays },
      assumedRate: input.assumedRate,
      obligationsPlanned: occurrences.length,
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
      caveat:
        'Computed against a single assumed rate. A real rate path will differ, so ' +
        'treat the schedule as guidance rather than a guarantee.',
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
