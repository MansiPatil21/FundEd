import { Router } from 'express'
import { z } from 'zod'
import { currentWeek, weeklyUsage, wouldBreach, type Shift } from './workHours.js'

/**
 * Compliance endpoints.
 *
 * These are pure calculations over shifts the caller supplies, deliberately kept
 * free of persistence for now: the rules are the part worth getting right and
 * worth testing, and they should not wait on a database to be exercised.
 */

const shiftSchema = z
  .object({
    startedAt: z.coerce.date(),
    endedAt: z.coerce.date(),
    onCampus: z.boolean().default(false),
  })
  .refine((shift) => shift.endedAt > shift.startedAt, {
    message: 'endedAt must be after startedAt',
    path: ['endedAt'],
  })

const usageSchema = z.object({
  shifts: z.array(shiftSchema).max(500),
  capHours: z.number().int().positive().max(168).default(24),
  asOf: z.coerce.date().optional(),
})

const proposalSchema = usageSchema.extend({
  proposed: shiftSchema,
})

export function complianceRouter(): Router {
  const router = Router()

  router.post('/usage', (req, res) => {
    const { shifts, capHours, asOf } = usageSchema.parse(req.body)
    const typed = shifts as Shift[]
    res.json({
      weeks: weeklyUsage(typed, capHours),
      current: currentWeek(typed, capHours, asOf ?? new Date()),
    })
  })

  router.post('/would-breach', (req, res) => {
    const { shifts, capHours, proposed } = proposalSchema.parse(req.body)
    res.json({
      wouldBreach: wouldBreach(shifts as Shift[], proposed as Shift, capHours),
    })
  })

  return router
}
