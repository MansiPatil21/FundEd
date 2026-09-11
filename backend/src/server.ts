import { createClient } from 'redis'
import { PrismaClient } from '@prisma/client'
import { loadEnv } from './config/env.js'
import { createApp } from './http/app.js'

/**
 * Composition root. Everything that touches the outside world is constructed here
 * and injected, which is why the app and its tests need no database.
 */
const env = loadEnv()

const prisma = new PrismaClient()
const redis = createClient({ url: env.REDIS_URL })
redis.on('error', () => {
  // Swallowed deliberately: a connection error must not crash the process, and the
  // health check is what reports the outage.
})

async function checkHealth(): Promise<Record<string, 'up' | 'down'>> {
  const [mongo, cache] = await Promise.all([
    prisma.$runCommandRaw({ ping: 1 }).then(() => 'up' as const).catch(() => 'down' as const),
    redis.ping().then(() => 'up' as const).catch(() => 'down' as const),
  ])
  return { mongo, redis: cache }
}

const app = createApp({ env, checkHealth })

async function start(): Promise<void> {
  await redis.connect().catch(() => {
    // Start anyway. /health reports the outage and the orchestrator decides.
  })

  const server = app.listen(env.PORT, () => {
    console.log(`northbound-api listening on :${env.PORT}`)
  })

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`${signal} received, shutting down`)
    server.close()
    await Promise.allSettled([prisma.$disconnect(), redis.quit()])
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

void start()
