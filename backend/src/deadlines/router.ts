import { Router } from 'express'
import { z } from 'zod'
import { currentUser } from '../auth/middleware.js'
import type { DeadlineRecord, DeadlineRepository } from './repository.js'
import { deadlineStatus } from './status.js'

/** MongoDB ObjectIds are 24 hex characters. Anything else cannot name a deadline. */
const OBJECT_ID = /^[a-f0-9]{24}$/i

const newDeadlineSchema = z.object({
  label: z.string().trim().min(1, 'Enter what the deadline is for').max(200),
  kind: z.enum(['TUITION', 'GIC_RELEASE', 'PERMIT_EXPIRY', 'TAX_FILING', 'OTHER']),
  dueOn: z.coerce.date(),
})

const completionSchema = z.object({ completed: z.boolean() })

export function deadlinesRouter(deadlines: DeadlineRepository, clock: () => Date = () => new Date()): Router {
  const router = Router()
  const present = (record: DeadlineRecord) => ({ ...record, ...deadlineStatus(record, clock()) })

  router.post('/', async (req, res) => {
    const user = currentUser(req)
    const created = await deadlines.add(user.sub, newDeadlineSchema.parse(req.body))
    res.status(201).json(present(created))
  })

  router.get('/', async (req, res) => {
    const user = currentUser(req)
    res.json({ deadlines: (await deadlines.listFor(user.sub)).map(present) })
  })

  router.patch('/:id', async (req, res) => {
    const user = currentUser(req)
    const id = req.params.id!
    // A malformed id is a deadline that does not exist. Letting it reach MongoDB would make
    // Prisma throw on the ObjectId cast and turn "not found" into a 500.
    if (!OBJECT_ID.test(id)) {
      res.status(404).json({ error: 'not_found' })
      return
    }
    const { completed } = completionSchema.parse(req.body)
    const updated = await deadlines.setCompleted(user.sub, id, completed)
    if (!updated) {
      res.status(404).json({ error: 'not_found' })
      return
    }
    res.json(present(updated))
  })

  router.delete('/:id', async (req, res) => {
    const user = currentUser(req)
    const id = req.params.id!
    if (!OBJECT_ID.test(id)) {
      res.status(404).json({ error: 'not_found' })
      return
    }
    res.status((await deadlines.remove(user.sub, id)) ? 204 : 404).end()
  })

  return router
}
