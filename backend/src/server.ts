import { createServer } from 'node:http'
import { createClient, type RedisClientType } from 'redis'
import { loadEnv } from './config/env.js'
import { createApp } from './http/app.js'
import { prisma, disconnect } from './persistence/prisma.js'
import { createTokenService } from './auth/tokens.js'
import { createShiftRepository } from './shifts/repository.js'
import { createObligationRepository } from './obligations/repository.js'
import { createOptimiserClient } from './optimizer/client.js'
import { createRateCache } from './fx/cache.js'
import { createFxService } from './fx/service.js'
import { attachRealtime } from './realtime/notifier.js'
import { startFxPoller, type PollerHandles } from './jobs/fxPoller.js'
import { parsePairs, redisConnection } from './jobs/pairs.js'
import { createFrankfurterSource } from './fx/sources/frankfurter.js'

/**
 * Composition root. Everything that touches the outside world is constructed here
 * and injected, which is why the app and most of its tests need neither a database
 * nor a broker.
 */
const env = loadEnv()

const db = prisma()
const redis: RedisClientType = createClient({ url: env.REDIS_URL })
redis.on('error', () => {
  // Swallowed deliberately: a connection blip must not crash the process. The
  // health check is what reports the outage.
})

const tokens = createTokenService(env.JWT_SECRET, env.JWT_TTL_SECONDS)
const shifts = createShiftRepository(db)
const obligations = createObligationRepository(db)
const optimiser = createOptimiserClient(env.OPTIMIZER_URL)
const cache = createRateCache(redis)

async function checkHealth(): Promise<Record<string, 'up' | 'down'>> {
  const [mongo, cacheState, solver] = await Promise.all([
    db.$runCommandRaw({ ping: 1 }).then(() => 'up' as const).catch(() => 'down' as const),
    redis.ping().then(() => 'up' as const).catch(() => 'down' as const),
    optimiser.healthy().then((ok) => (ok ? ('up' as const) : ('down' as const))),
  ])
  return { mongo, redis: cacheState, optimiser: solver }
}

async function start(): Promise<void> {
  await redis.connect().catch(() => {
    // Start anyway. /health reports it and the orchestrator decides.
  })

  // The FX service needs the notifier, which needs the HTTP server, which needs the app. The
  // cycle is broken with a notifier that forwards to whichever one is attached by the time an
  // alert fires. One instance serves the webhook, the API and the poller, so an alert cannot
  // fire differently depending on which path delivered the rate.
  const fx = createFxService(db, cache, {
    alertTriggered: (trigger) => realtime?.alertTriggered(trigger),
  })

  const app = await createApp({
    env,
    checkHealth,
    db,
    tokens,
    shifts,
    obligations,
    optimiser,
    fx,
    webhookSecret: env.FX_WEBHOOK_SECRET,
    graphql: { introspection: env.NODE_ENV !== 'production' },
  })

  const server = createServer(app)
  realtime = attachRealtime(server, tokens, env.CORS_ORIGIN)

  server.listen(env.PORT, () => {
    console.log(`funded-api listening on :${env.PORT}`)
  })

  let poller: PollerHandles | undefined
  if (env.FX_POLL_ENABLED) {
    const pairs = parsePairs(env.FX_PAIRS)
    try {
      poller = await startFxPoller(
        redisConnection(env.REDIS_URL),
        fx,
        createFrankfurterSource(env.FX_SOURCE_URL),
        pairs,
        env.FX_POLL_EVERY_MINUTES * 60_000,
        { runNow: true },
      )
      poller.worker.on('completed', (job, result) =>
        console.log(`fx poll ${job.data.base}/${job.data.quote} done, ${result.alertsTriggered} alerts triggered`),
      )
      // A failed poll is logged and retried on the next run. It must never take the API down.
      poller.worker.on('failed', (job, error) =>
        console.warn(`fx poll ${job?.data?.base}/${job?.data?.quote} failed: ${error.message}`),
      )
      console.log(`fx poller started for ${pairs.map((p) => `${p.base}/${p.quote}`).join(', ')} every ${env.FX_POLL_EVERY_MINUTES} min`)
    } catch (error) {
      console.warn(`fx poller not started: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`${signal} received, shutting down`)
    server.close()
    await Promise.allSettled([poller?.close(), realtime?.close(), disconnect(), redis.quit()])
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

let realtime: ReturnType<typeof attachRealtime> | undefined

void start()
