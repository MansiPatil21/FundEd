import type { NextFunction, Request, Response } from 'express'
import { InvalidTokenError, type Claims, type TokenService } from './tokens.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: Claims
    }
  }
}

/**
 * Rejects a request that carries no valid bearer token.
 *
 * 401 rather than 403 throughout: the caller has not proved who they are, which is
 * an authentication failure. 403 would mean "we know who you are and you may not do
 * this", which is a different situation and would mislead a client.
 */
export function requireUser(tokens: TokenService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header('authorization')
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'missing_token' })
      return
    }

    try {
      req.user = tokens.verify(header.slice('Bearer '.length).trim())
      next()
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        res.status(401).json({ error: 'invalid_token', reason: error.message })
        return
      }
      next(error)
    }
  }
}

/** The authenticated user, or a thrown error if the route was not guarded. */
export function currentUser(req: Request): Claims {
  if (!req.user) {
    throw new Error('currentUser called on a route that is not behind requireUser')
  }
  return req.user
}
