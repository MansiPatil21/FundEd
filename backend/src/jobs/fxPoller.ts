import { Queue, Worker, type ConnectionOptions } from 'bullmq'
import type { FxService } from '../fx/service.js'

/**
 * Scheduled rate polling.
 *
 * The webhook is the fast path but it is not guaranteed: providers drop deliveries,
 * and a webhook that never arrived is indistinguishable from a rate that never moved.
 * Polling is the backstop. Both paths converge on FxService.record, so an alert
 * cannot fire differently depending on which one got there first.
 *
 * BullMQ rather than setInterval, because the schedule must survive a restart and
 * must not double up when a second instance starts. A repeatable job keyed by name
 * gives both; setInterval gives neither.
 */

export interface RateSource {
  fetch(base: string, quote: string): Promise<{ rate: number; observedAt: Date }>
}

export const FX_QUEUE = 'fx-poll'

export interface PollerHandles {
  queue: Queue
  worker: Worker
  close(): Promise<void>
}

export async function startFxPoller(
  connection: ConnectionOptions,
  fx: FxService,
  source: RateSource,
  pairs: Array<{ base: string; quote: string }>,
  everyMs = 15 * 60_000,
  options: { runNow?: boolean } = {},
): Promise<PollerHandles> {
  const queue = new Queue(FX_QUEUE, { connection })

  for (const pair of pairs) {
    await queue.upsertJobScheduler(
      `poll:${pair.base}:${pair.quote}`,
      { every: everyMs },
      { name: 'poll', data: pair },
    )
  }

  // A schedule's first run waits a whole interval. At startup the latest rate is wanted now.
  if (options.runNow) {
    for (const pair of pairs) await queue.add('poll', pair)
  }

  const worker = new Worker(
    FX_QUEUE,
    async (job) => {
      const { base, quote } = job.data as { base: string; quote: string }
      const observation = await source.fetch(base, quote)
      const fired = await fx.record({
        baseCurrency: base,
        quoteCurrency: quote,
        rate: observation.rate,
        observedAt: observation.observedAt,
      })
      return { alertsTriggered: fired.length }
    },
    { connection, concurrency: 2 },
  )

  return {
    queue,
    worker,
    async close() {
      await worker.close()
      await queue.close()
    },
  }
}
