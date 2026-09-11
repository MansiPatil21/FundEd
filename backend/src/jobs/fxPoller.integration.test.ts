import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals'
import { createClient, type RedisClientType } from 'redis'
import { Queue } from 'bullmq'
import { testDatabase } from '../testing/database.js'
import { testRedisConnection, testRedisUrl } from '../testing/redis.js'
import { createRateCache } from '../fx/cache.js'
import { createFxService } from '../fx/service.js'
import { silentNotifier } from '../realtime/notifier.js'
import { FX_QUEUE, startFxPoller, type PollerHandles, type RateSource } from './fxPoller.js'
import type { Trigger } from '../fx/alerts.js'

/**
 * The poller against a real Redis and a real MongoDB.
 *
 * BullMQ's whole value is that the schedule survives a restart and does not double
 * up, which only a real broker can demonstrate. An in-memory fake would prove
 * nothing about the thing it was chosen for.
 */

const connection = testRedisConnection('poller')
const db = testDatabase('poller')
const redis: RedisClientType = createClient({ url: testRedisUrl('poller') })

const triggers: Trigger[] = []
let poller: PollerHandles | undefined

const source = (rate: number): RateSource => ({
  fetch: async () => ({ rate, observedAt: new Date('2027-02-01T09:00:00Z') }),
})

beforeAll(async () => {
  await redis.connect()
})

afterEach(async () => {
  await poller?.close()
  poller = undefined
  triggers.length = 0
  await db.fxAlert.deleteMany()
  await db.fxRate.deleteMany()
  await db.user.deleteMany()
  // Clear BullMQ's own keys so one test's scheduler cannot leak into the next.
  const keys = await redis.keys('bull:fx-poll:*')
  if (keys.length) await redis.del(keys)
})

afterAll(async () => {
  await db.$disconnect()
  await redis.quit()
})

const buildService = (rate: number) =>
  createFxService(db, createRateCache(redis, 60), {
    alertTriggered: (trigger) => void triggers.push(trigger),
  })

describe('the scheduled FX poller', () => {
  it('registers a repeatable scheduler for each pair', async () => {
    poller = await startFxPoller(connection, buildService(61), source(61), [
      { base: 'CAD', quote: 'INR' },
      { base: 'CAD', quote: 'NGN' },
    ])

    const queue = new Queue(FX_QUEUE, { connection })
    const schedulers = await queue.getJobSchedulers()
    await queue.close()

    expect(schedulers.map((s) => s.key).sort()).toEqual(
      ['poll:CAD:INR', 'poll:CAD:NGN'].sort(),
    )
  })

  it('does not create a second scheduler when started again with the same key', async () => {
    const pairs = [{ base: 'CAD', quote: 'INR' }]

    poller = await startFxPoller(connection, buildService(61), source(61), pairs)
    await poller.close()
    poller = await startFxPoller(connection, buildService(61), source(61), pairs)

    const queue = new Queue(FX_QUEUE, { connection })
    const schedulers = await queue.getJobSchedulers()
    await queue.close()

    expect(schedulers).toHaveLength(1)
  })

  it('stores the observed rate when a job runs', async () => {
    const fx = buildService(62.5)
    poller = await startFxPoller(connection, fx, source(62.5), [{ base: 'CAD', quote: 'INR' }])

    await poller.queue.add('poll', { base: 'CAD', quote: 'INR' })
    await waitFor(async () => (await db.fxRate.count()) > 0)

    const stored = await db.fxRate.findFirst({ orderBy: { observedAt: 'desc' } })
    expect(stored?.rate).toBe(62.5)
  })

  it('fires an alert the polled rate has crossed', async () => {
    const user = await db.user.create({
      data: { email: 'poll@example.com', displayName: 'Poll', homeCurrency: 'INR' },
    })
    await db.fxAlert.create({
      data: {
        userId: user.id,
        baseCurrency: 'CAD',
        quoteCurrency: 'INR',
        targetRate: 62,
        direction: 'AT_OR_ABOVE',
      },
    })

    poller = await startFxPoller(connection, buildService(63), source(63), [
      { base: 'CAD', quote: 'INR' },
    ])
    await poller.queue.add('poll', { base: 'CAD', quote: 'INR' })

    await waitFor(async () => triggers.length > 0)
    expect(triggers[0]!.rate).toBe(63)
  })
})

/** Polls a condition rather than sleeping a fixed time, so the test is not flaky. */
async function waitFor(condition: () => Promise<boolean>, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`condition not met within ${timeoutMs}ms`)
}
