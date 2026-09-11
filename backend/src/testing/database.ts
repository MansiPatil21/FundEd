import { PrismaClient } from '@prisma/client'

/**
 * A dedicated database per test suite.
 *
 * Jest runs suites in parallel workers. Two suites sharing one database delete each
 * other's rows between tests, and the failure looks like a logic bug rather than a
 * fixture collision: a count that should be 1 comes back 0, intermittently, and only
 * when both suites run together.
 *
 * Naming the database after the suite keeps the parallelism and removes the sharing.
 */
export function testDatabase(suite: string): PrismaClient {
  const base = process.env.TEST_MONGO_URL ?? 'mongodb://localhost:27017'
  const url = `${base}/funded_test_${suite}?replicaSet=rs0&directConnection=true`
  return new PrismaClient({ datasources: { db: { url } } })
}
