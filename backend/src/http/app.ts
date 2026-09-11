import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { pinoHttp } from 'pino-http'
import { ZodError } from 'zod'
import type { Env } from '../config/env.js'
import { complianceRouter } from '../compliance/router.js'

export interface Dependencies {
  env: Env
  /** Reports whether each backing service is reachable. Injected so tests need neither. */
  checkHealth: () => Promise<Record<string, 'up' | 'down'>>
}

export function createApp({ env, checkHealth }: Dependencies): Express {
  const app = express()

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

  app.use('/api/compliance', complianceRouter())

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
