/** "CAD:INR, CAD:PHP" as currency pairs. A malformed entry fails loudly at boot. */
export function parsePairs(value: string): Array<{ base: string; quote: string }> {
  const pairs = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const match = /^([A-Za-z]{3}):([A-Za-z]{3})$/.exec(entry)
      if (!match) throw new Error(`Invalid FX pair "${entry}", expected BASE:QUOTE such as CAD:INR`)
      return { base: match[1]!.toUpperCase(), quote: match[2]!.toUpperCase() }
    })
  if (pairs.length === 0) throw new Error('FX_PAIRS must name at least one pair')
  return pairs
}

export interface RedisConnectionOptions {
  host: string
  port: number
  db: number
  username?: string
  password?: string
  tls?: Record<string, never>
  maxRetriesPerRequest: null
}

/**
 * A redis:// or rediss:// URL as the connection options BullMQ hands to ioredis.
 *
 * ioredis takes an options object here, not the URL, so everything the URL carries must be
 * copied across by hand. Hosted Redis (Upstash, for one) issues rediss://user:password@host
 * URLs: dropping the credentials or the TLS scheme connects to nothing, and the failure only
 * shows up once deployed. maxRetriesPerRequest is null because BullMQ's workers hold blocking
 * connections, and ioredis's default retry limit would abort them during a brief Redis restart.
 */
export function redisConnection(url: string): RedisConnectionOptions {
  const parsed = new URL(url)
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    db: Number(parsed.pathname.replace('/', '') || 0),
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  }
}
