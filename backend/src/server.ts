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

  const app = await createApp({
    env,
    checkHealth,
    db,
    tokens,
    shifts,
    obligations,
    optimiser,
    // The FX service needs the notifier, which needs the HTTP server, which needs
    // the app. The cycle is broken by giving the service a notifier that forwards
    // to whichever one is attached by the time an alert actually fires.
    fx: createFxService(db, cache, {
      alertTriggered: (trigger) => realtime?.alertTriggered(trigger),
    }),
    webhookSecret: env.FX_WEBHOOK_SECRET,
    graphql: { introspection: env.NODE_ENV !== 'production' },
  })

  const server = createServer(app)
  realtime = attachRealtime(server, tokens, env.CORS_ORIGIN)

  server.listen(env.PORT, () => {
    console.log(`funded-api listening on :${env.PORT}`)
  })

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`${signal} received, shutting down`)
    server.close()
    await Promise.allSettled([realtime?.close(), disconnect(), redis.quit()])
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

let realtime: ReturnType<typeof attachRealtime> | undefined

void start()
