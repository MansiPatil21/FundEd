import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { pinoHttp } from 'pino-http'
import { ZodError } from 'zod'
import type { Env } from '../config/env.js'
import { complianceRouter } from '../compliance/router.js'
import { requireUser } from '../auth/middleware.js'
import type { TokenService } from '../auth/tokens.js'
import { authRouter } from '../auth/router.js'
import { shiftsRouter } from '../shifts/router.js'
import type { ShiftRepository } from '../shifts/repository.js'
import type { ObligationRepository } from '../obligations/repository.js'
import { obligationsRouter } from '../obligations/router.js'
import { planningRouter } from '../planning/router.js'
import type { OptimiserClient } from '../optimizer/client.js'
import { fxRouter, fxWebhookRouter } from '../fx/router.js'
import type { FxService } from '../fx/service.js'
import { attachGraphql } from '../graphql/server.js'
import type { PrismaClient } from '@prisma/client'

export interface Dependencies {
  env: Env
  /** Reports whether each backing service is reachable. Injected so tests need neither. */
  checkHealth: () => Promise<Record<string, 'up' | 'down'>>
  db?: PrismaClient
  tokens?: TokenService
  shifts?: ShiftRepository
  obligations?: ObligationRepository
  optimiser?: OptimiserClient
  fx?: FxService
  webhookSecret?: string
  /** Mounts /graphql. Omitted by tests that only exercise the REST surface. */
  graphql?: { introspection: boolean }
}



/**
 * Async because Apollo requires `await server.start()` before it can be mounted, and
 * mounting has to happen BEFORE the catch-all 404 below. Express matches routes in
 * registration order, so attaching GraphQL after createApp had returned meant every
 * /graphql request fell through to the fallback and came back 404, with nothing else
 * to indicate why.
 */
export async function createApp({
  env,
  checkHealth,
  db,
  tokens,
  shifts,
  obligations,
  optimiser,
  fx,
  webhookSecret,
  graphql,
}: Dependencies): Promise<Express> {
  const app = express()

  // The webhook is mounted BEFORE the JSON parser, because its signature covers the
  // raw bytes that arrived. Parsing first and re-serialising produces different
  // bytes and the signature would never verify.
  if (fx && webhookSecret) {
    app.use('/webhooks/fx', fxWebhookRouter(fx, webhookSecret))
  }

  app.use(express.json({ limit: '128kb' }))
  app.use(
    pinoHttp({
      level: env.LOG_LEVEL,
      // Request logs are noise in test output and would drown the assertions.
      enabled: env.NODE_ENV !== 'test',
    }),
  )

  /**
   * Liveness and readiness in one place. Returns 503 when any dependency is down so
   * an orchestrator stops routing traffic here, rather than 200 with a sad payload
   * that nothing acts on.
   */
  app.get('/health', async (_req: Request, res: Response) => {
    const services = await checkHealth()
    const healthy = Object.values(services).every((state) => state === 'up')
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      services,
    })
  })

  // Stateless calculators. Useful before sign-up and handy for testing the rules
  // directly, so they stay unauthenticated and take their shifts in the request.
  app.use('/api/compliance', complianceRouter())

  if (db && tokens) {
    app.use('/api/auth', authRouter({ db, tokens, allowLocalSignIn: env.NODE_ENV !== 'production' }))
  }

  if (shifts && tokens) {
    app.use('/api/shifts', requireUser(tokens), shiftsRouter(shifts))
  }

  if (obligations && tokens) {
    app.use('/api/obligations', requireUser(tokens), obligationsRouter(obligations))
  }

  if (fx && db && tokens) {
    app.use('/api/fx', requireUser(tokens), fxRouter(db, fx))
  }

  if (obligations && optimiser && tokens) {
    app.use('/api/plan', requireUser(tokens), planningRouter(obligations, optimiser))
  }

  if (graphql && db && tokens && shifts && obligations && fx) {
    await attachGraphql(app, {
      db,
      tokens,
      shifts,
      obligations,
      fx,
      introspection: graphql.introspection,
    })
  }

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'not_found' })
  })

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'validation_failed',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      })
    }
    res.status(500).json({ error: 'internal_error' })
  })

  return app
}
