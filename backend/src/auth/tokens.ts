import jwt from 'jsonwebtoken'
import { z } from 'zod'

/**
 * Access tokens.
 *
 * Short-lived and stateless: the API keeps no session table, so a token is valid
 * until it expires and there is no revocation. That is a deliberate trade for a
 * product with no money movement and no admin surface, and it is the first thing
 * that would change if either appeared.
 */

const claimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
})

export type Claims = z.infer<typeof claimsSchema>

export class InvalidTokenError extends Error {
  constructor(reason: string) {
    super(`Invalid token: ${reason}`)
    this.name = 'InvalidTokenError'
  }
}

export interface TokenService {
  issue(claims: Claims): string
  verify(token: string): Claims
}

export function createTokenService(secret: string, ttlSeconds: number): TokenService {
  return {
    issue(claims) {
      return jwt.sign(claims, secret, { expiresIn: ttlSeconds, algorithm: 'HS256' })
    },

    verify(token) {
      let payload: unknown
      try {
        // Pinning the algorithm matters: without it a token signed with "none"
        // would be accepted, which is the classic JWT footgun.
        payload = jwt.verify(token, secret, { algorithms: ['HS256'] })
      } catch (error) {
        throw new InvalidTokenError(
          error instanceof jwt.TokenExpiredError ? 'expired' : 'signature or format',
        )
      }

      const parsed = claimsSchema.safeParse(payload)
      if (!parsed.success) {
        throw new InvalidTokenError('claims do not match the expected shape')
      }
      return parsed.data
    },
  }
}
