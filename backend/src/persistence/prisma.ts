import { PrismaClient } from '@prisma/client'

/**
 * One client per process.
 *
 * Prisma manages its own connection pool, so constructing a second client would
 * quietly double the pool. Tests that need a database import this same instance and
 * clean up after themselves rather than spinning up their own.
 */
let client: PrismaClient | undefined

export function prisma(): PrismaClient {
  client ??= new PrismaClient()
  return client
}

export async function disconnect(): Promise<void> {
  await client?.$disconnect()
  client = undefined
}
