import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import type { TokenService } from './tokens.js'

/**
 * Sign-in.
 *
 * Google OAuth is the intended production path. It is wired behind configuration
 * because the flow cannot run without real client credentials, and a developer
 * checking out this repository should still be able to get a token. The local route
 * is refused outright in production rather than merely discouraged.
 */

const signInSchema = z.object({
  email: z.string().email(),
  // Optional. The name is set during profile setup, and a returning student signing in
  // again must not have it silently reset to whatever the sign-in form sent.
  displayName: z.string().trim().min(1).max(120).optional(),
  homeCurrency: z.string().length(3).default('INR'),
})

export interface AuthDeps {
  db: PrismaClient
  tokens: TokenService
  allowLocalSignIn: boolean
}

export function authRouter({ db, tokens, allowLocalSignIn }: AuthDeps): Router {
  const router = Router()

  router.post('/local', async (req, res) => {
    if (!allowLocalSignIn) {
      res.status(404).json({ error: 'not_found' })
      return
    }

    const { email, displayName, homeCurrency } = signInSchema.parse(req.body)

    // Upsert so repeated local sign-ins are idempotent rather than colliding on the
    // unique email index.
    const user = await db.user.upsert({
      where: { email },
      update: {},
      // No name is invented from the email. An empty name makes setup ask for one, instead of
      // greeting a student by the local part of their address.
      create: { email, displayName: displayName ?? '', homeCurrency },
    })

    res.json({
      token: tokens.issue({ sub: user.id, email: user.email }),
      user: { id: user.id, email: user.email, displayName: user.displayName },
    })
  })

  router.get('/me', (req, res) => {
    res.json({ user: req.user ?? null })
  })

  return router
}
