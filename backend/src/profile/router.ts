import { Router } from 'express'
import type { Prisma, PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { currentUser } from '../auth/middleware.js'

/**
 * The signed-in student's own profile: who they are, their study permit, and the
 * monthly budget from setup.
 *
 * PATCH rather than PUT because setup happens in steps and the profile page edits one
 * section at a time. Every top-level section is optional, but a section that is sent
 * must be complete, so a half-filled permit can never be stored.
 */

const currency = z
  .string()
  .trim()
  .length(3, 'Use a three-letter currency code, such as INR')
  .transform((code) => code.toUpperCase())

const permitSchema = z.object({
  institution: z.string().trim().min(1, 'Enter your institution').max(200),
  programEndsOn: z.coerce.date(),
  expiresOn: z.coerce.date(),
  weeklyHourCap: z.number().int().min(1).max(168).default(24),
  permitNumber: z.string().trim().max(40).optional(),
})

const budgetSchema = z.object({
  monthlyIncomeMinor: z.number().int().min(0),
  monthlySpendingMinor: z.number().int().min(0),
  minimumBufferMinor: z.number().int().min(0),
})

const patchSchema = z
  .object({
    displayName: z.string().trim().min(1, 'Enter your name').max(120),
    homeCurrency: currency,
    permit: permitSchema,
    budget: budgetSchema,
    completeOnboarding: z.literal(true),
  })
  .partial()

export function profileRouter(db: PrismaClient): Router {
  const router = Router()

  router.get('/', async (req, res) => {
    const { sub } = currentUser(req)
    const user = await db.user.findUnique({ where: { id: sub } })
    if (!user) {
      // A valid token for a user who no longer exists. 401 so the client signs in again.
      res.status(401).json({ error: 'unknown_user' })
      return
    }
    res.json(toProfile(user))
  })

  router.patch('/', async (req, res) => {
    const { sub } = currentUser(req)
    const body = patchSchema.parse(req.body)

    const existing = await db.user.findUnique({ where: { id: sub } })
    if (!existing) {
      res.status(401).json({ error: 'unknown_user' })
      return
    }

    // Setup cannot be marked finished without the permit, because the whole
    // compliance feature reads its hour cap from there.
    if (body.completeOnboarding && !body.permit && !existing.permit) {
      res.status(422).json({ error: 'permit_required', message: 'Add your study permit details first' })
      return
    }

    // Built key by key: with exactOptionalPropertyTypes on, passing `undefined` to
    // Prisma would mean "set to undefined", not "leave unchanged".
    const data: Prisma.UserUpdateInput = {}
    if (body.displayName !== undefined) data.displayName = body.displayName
    if (body.homeCurrency !== undefined) data.homeCurrency = body.homeCurrency
    if (body.permit) {
      const { permitNumber, ...rest } = body.permit
      data.permit = { set: { ...rest, ...(permitNumber ? { permitNumber } : {}) } }
    }
    if (body.budget) data.budget = { set: body.budget }
    if (body.completeOnboarding && !existing.onboardedAt) data.onboardedAt = new Date()

    const updated = await db.user.update({ where: { id: sub }, data })
    res.json(toProfile(updated))
  })

  return router
}

type UserRow = NonNullable<Awaited<ReturnType<PrismaClient['user']['findUnique']>>>

function toProfile(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    homeCurrency: user.homeCurrency,
    localCurrency: user.localCurrency,
    permit: user.permit,
    budget: user.budget,
    onboarded: user.onboardedAt != null,
  }
}
