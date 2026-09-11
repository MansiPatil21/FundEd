import type { RedisClientType } from 'redis'
import { z } from 'zod'

/**
 * Redis cache for the latest observed rate per pair.
 *
 * NFR-4 says the cache is never authoritative. Every read is validated on the way
 * out and a miss, a malformed entry or an unreachable Redis all resolve to "not
 * cached", never to an exception and never to a wrong number. The database remains
 * the record; this only saves a round trip on the hot path.
 */

const cachedSchema = z.object({
  rate: z.number().positive(),
  observedAt: z.coerce.date(),
})

export type CachedRate = z.infer<typeof cachedSchema>

export interface RateCache {
  get(base: string, quote: string): Promise<CachedRate | null>
  put(base: string, quote: string, value: CachedRate): Promise<void>
}

const key = (base: string, quote: string): string => `fx:${base}:${quote}`

export function createRateCache(redis: RedisClientType, ttlSeconds = 300): RateCache {
  return {
    async get(base, quote) {
      let raw: string | null
      try {
        raw = await redis.get(key(base, quote))
      } catch {
        return null // Redis down is a cache miss, not an outage.
      }
      if (!raw) return null

      const parsed = cachedSchema.safeParse(safeJson(raw))
      // A malformed entry is worse than none: drop it rather than let it linger.
      if (!parsed.success) {
        await redis.del(key(base, quote)).catch(() => undefined)
        return null
      }
      return parsed.data
    },

    async put(base, quote, value) {
      try {
        await redis.set(key(base, quote), JSON.stringify(value), { EX: ttlSeconds })
      } catch {
        // Failing to cache must never fail the request that produced the value.
      }
    },
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
