import { Router } from 'express'
import { z } from 'zod'
import { currentUser } from '../auth/middleware.js'
import type { ObligationRepository } from './repository.js'

const newObligationSchema = z.object({
  label: z.string().min(1).max(200),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3),
  cadence: z.enum(['ONCE', 'MONTHLY', 'QUARTERLY', 'ANNUAL']),
  nextDueOn: z.coerce.date(),
})

export function obligationsRouter(obligations: ObligationRepository): Router {
  const router = Router()

  router.post('/', async (req, res) => {
    const user = currentUser(req)
    const created = await obligations.add(user.sub, newObligationSchema.parse(req.body))
    res.status(201).json(created)
  })

  router.get('/', async (req, res) => {
    const user = currentUser(req)
    res.json({ obligations: await obligations.listFor(user.sub) })
  })

  router.delete('/:id', async (req, res) => {
    const user = currentUser(req)
    const removed = await obligations.remove(user.sub, req.params.id!)
    res.status(removed ? 204 : 404).end()
  })

  return router
}
