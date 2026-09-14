import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { requireUser, currentUser } from './middleware.js'
import { burnVerification, hashPassword, needsRehash, passwordProblem, verifyPassword } from './passwords.js'
import { createRateLimiter, type RateLimiter } from './rateLimiter.js'
import type { TokenService } from './tokens.js'

/**
 * Accounts and sessions.
 *
 * Email and password is the sign-in path: POST /register creates an account, POST /login
 * exchanges credentials for a token, POST /password changes the password of a signed-in
 * student. The email-only /local route predates passwords and survives only for development
 * and the test suite; it is a 404 in production unless explicitly switched on.
 *
 * What an attacker learns from these routes is kept to a minimum: a wrong password and an
 * unknown email return the same 401 with the same body, and take the same time, because an
 * unknown email still runs a full scrypt verification against a throwaway hash. Sign-up does
 * reveal that an email is registered (409), which no sign-up form can avoid without email
 * verification, so sign-up attempts are limited per address instead.
 */

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254)

const localSignInSchema = z.object({
  email,
  displayName: z.string().trim().min(1).max(120).optional(),
  homeCurrency: z.string().length(3).default('INR'),
})

const registerSchema = z.object({
  email,
  // Checked separately with passwordProblem, so the response can say what is wrong in words.
  password: z.string().max(1024),
  displayName: z.string().trim().min(1, 'Enter your name').max(120),
  homeCurrency: z
    .string()
    .trim()
    .length(3)
    .transform((code) => code.toUpperCase())
    .default('INR'),
})

const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password').max(1024),
})

const changePasswordSchema = z.object({
  currentPassword: z.string().max(1024),
  newPassword: z.string().max(1024),
})

const FIFTEEN_MINUTES = 15 * 60_000

export interface AuthDeps {
  db: PrismaClient
  tokens: TokenService
  allowLocalSignIn: boolean
}

export function authRouter({ db, tokens, allowLocalSignIn }: AuthDeps): Router {
  const router = Router()

  // Failures per email stop guessing at one account. Failures per address stop one machine
  // guessing across many accounts. Created per router, so each app instance counts alone.
  const loginFailuresByEmail = createRateLimiter({ limit: 5, windowMs: FIFTEEN_MINUTES })
  const loginFailuresByIp = createRateLimiter({ limit: 30, windowMs: FIFTEEN_MINUTES })
  const signUpsByIp = createRateLimiter({ limit: 10, windowMs: 60 * 60_000 })
  const wrongCurrentPasswords = createRateLimiter({ limit: 5, windowMs: FIFTEEN_MINUTES })

  const session = (user: { id: string; email: string; displayName: string }) => ({
    token: tokens.issue({ sub: user.id, email: user.email }),
    user: { id: user.id, email: user.email, displayName: user.displayName },
  })

  router.post('/register', async (req, res) => {
    const ip = clientAddress(req)
    if (tooMany(res, signUpsByIp, ip, 'Too many accounts created from this network. Try again later.')) return
    signUpsByIp.record(ip)

    const body = registerSchema.parse(req.body)
    const problem = passwordProblem(body.password, body.email)
    if (problem) {
      res.status(400).json({ error: 'weak_password', message: problem })
      return
    }

    const taken = () =>
      res.status(409).json({ error: 'email_taken', message: 'An account with this email already exists. Sign in instead.' })

    const passwordHash = await hashPassword(body.password)
    const existing = await db.user.findUnique({ where: { email: body.email } })

    if (existing) {
      // An account made by the development email-only sign-in has no password, and anyone
      // could already sign in as it there, so setting one takes nothing from anybody. In
      // production that same move would be an account takeover, so it is refused.
      if (existing.passwordHash || !allowLocalSignIn) {
        taken()
        return
      }
      const claimed = await db.user.update({
        where: { id: existing.id },
        data: { passwordHash, ...(existing.displayName ? {} : { displayName: body.displayName }) },
      })
      res.status(201).json(session(claimed))
      return
    }

    try {
      const user = await db.user.create({
        data: { email: body.email, displayName: body.displayName, homeCurrency: body.homeCurrency, passwordHash },
      })
      res.status(201).json(session(user))
    } catch (error) {
      // Two sign-ups for the same email racing past findUnique: the unique index decides.
      if ((error as { code?: string }).code === 'P2002') {
        taken()
        return
      }
      throw error
    }
  })

  router.post('/login', async (req, res) => {
    const { email: address, password } = loginSchema.parse(req.body)
    const ip = clientAddress(req)
    const blockedFor = Math.max(loginFailuresByEmail.retryAfterSeconds(address), loginFailuresByIp.retryAfterSeconds(ip))
    if (blockedFor > 0) {
      tooManyResponse(res, blockedFor, 'Too many sign-in attempts')
      return
    }

    const user = await db.user.findUnique({ where: { email: address } })
    let valid = false
    if (user?.passwordHash) {
      valid = await verifyPassword(password, user.passwordHash)
    } else {
      await burnVerification(password)
    }

    if (!user || !valid) {
      loginFailuresByEmail.record(address)
      loginFailuresByIp.record(ip)
      res.status(401).json({ error: 'invalid_credentials', message: 'Incorrect email or password' })
      return
    }

    loginFailuresByEmail.reset(address)
    // Hashes made with older, cheaper parameters are upgraded the moment the password is
    // known, which is the only moment it can be.
    if (user.passwordHash && needsRehash(user.passwordHash)) {
      await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } })
    }
    res.json(session(user))
  })

  router.post('/password', requireUser(tokens), async (req, res) => {
    const { sub } = currentUser(req)
    if (tooMany(res, wrongCurrentPasswords, sub, 'Too many incorrect attempts. Try again later.')) return

    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body)
    const user = await db.user.findUnique({ where: { id: sub } })
    if (!user) {
      res.status(401).json({ error: 'unknown_user' })
      return
    }

    // 400 rather than 401 for a wrong current password: the session itself is valid, and the
    // web app treats any 401 as "signed out" and discards it.
    if (user.passwordHash && !(await verifyPassword(currentPassword, user.passwordHash))) {
      wrongCurrentPasswords.record(sub)
      res.status(400).json({ error: 'wrong_password', message: 'Your current password is incorrect' })
      return
    }
    wrongCurrentPasswords.reset(sub)

    const problem = passwordProblem(newPassword, user.email)
    if (problem) {
      res.status(400).json({ error: 'weak_password', message: problem })
      return
    }
    if (user.passwordHash && newPassword === currentPassword) {
      res.status(400).json({ error: 'same_password', message: 'Choose a password different from your current one' })
      return
    }

    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } })
    res.status(204).end()
  })

  router.post('/local', async (req, res) => {
    if (!allowLocalSignIn) {
      res.status(404).json({ error: 'not_found' })
      return
    }

    const { email: address, displayName, homeCurrency } = localSignInSchema.parse(req.body)

    // Upsert so repeated local sign-ins are idempotent rather than colliding on the
    // unique email index.
    const user = await db.user.upsert({
      where: { email: address },
      update: {},
      // No name is invented from the email. An empty name makes setup ask for one, instead of
      // greeting a student by the local part of their address.
      create: { email: address, displayName: displayName ?? '', homeCurrency },
    })

    res.json(session(user))
  })

  router.get('/me', (req, res) => {
    res.json({ user: req.user ?? null })
  })

  return router
}

function clientAddress(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown'
}

/** Sends a 429 and returns true if the key is currently blocked. */
function tooMany(res: Response, limiter: RateLimiter, key: string, message: string): boolean {
  const seconds = limiter.retryAfterSeconds(key)
  if (seconds === 0) return false
  tooManyResponse(res, seconds, message.replace(/\.$/, ''))
  return true
}

function tooManyResponse(res: Response, seconds: number, message: string): void {
  const minutes = Math.ceil(seconds / 60)
  res
    .status(429)
    .set('Retry-After', String(seconds))
    .json({
      error: 'too_many_attempts',
      message: `${message}. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
    })
}
