/**
 * A dedicated Redis logical database per test suite.
 *
 * The same lesson as testDatabase, learned again on a different store. The FX suite
 * calls flushDb between tests; the poller suite keeps BullMQ's scheduler keys in
 * Redis. Run in parallel against one database, the flush deletes the other suite's
 * queue state and the poller fails intermittently with no obvious cause.
 *
 * Redis numbers its logical databases, so isolation costs an index rather than a
 * separate server.
 */
export const TEST_REDIS_DB = {
  fx: 1,
  poller: 2,
} as const

export function testRedisUrl(suite: keyof typeof TEST_REDIS_DB): string {
  const base = process.env.TEST_REDIS_URL ?? 'redis://localhost:6380'
  return `${base}/${TEST_REDIS_DB[suite]}`
}

export function testRedisConnection(suite: keyof typeof TEST_REDIS_DB): {
  host: string
  port: number
  db: number
} {
  return { host: 'localhost', port: 6380, db: TEST_REDIS_DB[suite] }
}
