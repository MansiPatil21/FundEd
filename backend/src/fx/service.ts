import type { PrismaClient } from '@prisma/client'
import { triggered, type Alert, type Observation, type Trigger } from './alerts.js'
import type { RateCache } from './cache.js'

/**
 * "This alert has not fired yet."
 *
 * On MongoDB, a field that was never written is ABSENT, which is not the same thing
 * as a field explicitly set to null, and Prisma faithfully preserves the difference.
 * A bare `triggeredAt: null` filter therefore matches nothing for a freshly created
 * alert, and the symptom is an alert system that silently never fires. Covering both
 * states is the only reliable form. See ADR 0004.
 */
const NOT_YET_TRIGGERED = [{ triggeredAt: null }, { triggeredAt: { isSet: false } }]

/**
 * Recording an observed rate and firing whatever it triggers.
 *
 * One entry point, used by both the scheduled poller and the provider webhook, so
 * the two paths cannot drift apart. Whichever arrives first wins; the other becomes
 * a no-op because the alert is already marked fired.
 */

export interface Notifier {
  alertTriggered(trigger: Trigger): void
}

export interface FxService {
  record(observation: Observation): Promise<Trigger[]>
  latest(base: string, quote: string): Promise<{ rate: number; observedAt: Date } | null>
}

export function createFxService(
  db: PrismaClient,
  cache: RateCache,
  notifier: Notifier,
): FxService {
  return {
    async record(observation) {
      const previous = await db.fxRate.findFirst({
        where: { baseCurrency: observation.baseCurrency, quoteCurrency: observation.quoteCurrency },
        orderBy: { observedAt: 'desc' },
      })

      await db.fxRate.create({
        data: {
          baseCurrency: observation.baseCurrency,
          quoteCurrency: observation.quoteCurrency,
          rate: observation.rate,
          observedAt: observation.observedAt,
        },
      })

      await cache.put(observation.baseCurrency, observation.quoteCurrency, {
        rate: observation.rate,
        observedAt: observation.observedAt,
      })

      const open = await db.fxAlert.findMany({
        where: {
          baseCurrency: observation.baseCurrency,
          quoteCurrency: observation.quoteCurrency,
          OR: NOT_YET_TRIGGERED,
        },
      })

      const firing = triggered(
        open.map(toAlert),
        observation,
        previous
          ? {
              baseCurrency: previous.baseCurrency,
              quoteCurrency: previous.quoteCurrency,
              rate: previous.rate,
              observedAt: previous.observedAt,
            }
          : undefined,
      )

      for (const trigger of firing) {
        // Conditional on triggeredAt still being null, so a concurrent poller and
        // webhook processing the same crossing cannot both notify. updateMany
        // reports how many rows it actually changed; zero means someone else won.
        const claimed = await db.fxAlert.updateMany({
          where: { id: trigger.alert.id, OR: NOT_YET_TRIGGERED },
          data: { triggeredAt: trigger.observedAt },
        })
        if (claimed.count > 0) {
          notifier.alertTriggered(trigger)
        }
      }

      return firing
    },

    async latest(base, quote) {
      const cached = await cache.get(base, quote)
      if (cached) return cached

      const row = await db.fxRate.findFirst({
        where: { baseCurrency: base, quoteCurrency: quote },
        orderBy: { observedAt: 'desc' },
      })
      if (!row) return null

      const value = { rate: row.rate, observedAt: row.observedAt }
      await cache.put(base, quote, value)
      return value
    },
  }
}

function toAlert(row: {
  id: string
  userId: string
  baseCurrency: string
  quoteCurrency: string
  targetRate: number
  direction: string
  triggeredAt: Date | null
}): Alert {
  return {
    id: row.id,
    userId: row.userId,
    baseCurrency: row.baseCurrency,
    quoteCurrency: row.quoteCurrency,
    targetRate: row.targetRate,
    direction: row.direction as Alert['direction'],
    triggeredAt: row.triggeredAt,
  }
}
