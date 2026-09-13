import { Router } from 'express'
import { z } from 'zod'
import { currentUser } from '../auth/middleware.js'
import { currentWeek, weeklyUsage, wouldBreach } from '../compliance/workHours.js'
import type { ShiftRepository } from './repository.js'

/**
 * Shifts, and the compliance view derived from them.
 *
 * Every route is scoped to the authenticated user. The compliance numbers are
 * recomputed from stored shifts on each read rather than cached on the user: a
 * stored total would drift the moment a shift were edited, and a permit breach is
 * not a number worth being approximately right about (NFR-2).
 */

const newShiftSchema = z
  .object({
    startedAt: z.coerce.date(),
    endedAt: z.coerce.date(),
    employer: z.string().min(1).max(200),
    onCampus: z.boolean().default(false),
  })
  .refine((shift) => shift.endedAt > shift.startedAt, {
    message: 'endedAt must be after startedAt',
    path: ['endedAt'],
  })

const proposedSchema = newShiftSchema

/** Resolves a student's weekly cap. 24 until a permit has been recorded. */
export type CapResolver = (userId: string) => Promise<number>

export function shiftsRouter(shifts: ShiftRepository, capFor: CapResolver = async () => 24): Router {
  const router = Router()

  router.post('/', async (req, res) => {
    const user = currentUser(req)
    const shift = newShiftSchema.parse(req.body)
    const created = await shifts.add(user.sub, shift)
    res.status(201).json(created)
  })

  router.get('/', async (req, res) => {
    const user = currentUser(req)
    res.json({ shifts: await shifts.listFor(user.sub) })
  })

  router.delete('/:id', async (req, res) => {
    const user = currentUser(req)
    const removed = await shifts.remove(user.sub, req.params.id!)
    res.status(removed ? 204 : 404).end()
  })

  router.get('/compliance', async (req, res) => {
    const user = currentUser(req)
    const [stored, capHours] = await Promise.all([shifts.listFor(user.sub), capFor(user.sub)])
    res.json({
      capHours,
      weeks: weeklyUsage(stored, capHours),
      current: currentWeek(stored, capHours, new Date()),
    })
  })

  router.post('/compliance/would-breach', async (req, res) => {
    const user = currentUser(req)
    const proposed = proposedSchema.parse(req.body)
    const [stored, capHours] = await Promise.all([shifts.listFor(user.sub), capFor(user.sub)])
    res.json({ wouldBreach: wouldBreach(stored, proposed, capHours), capHours })
  })

  return router
}
