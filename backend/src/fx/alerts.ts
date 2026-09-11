/**
 * Deciding when an FX alert fires.
 *
 * The rule sounds trivial: tell me when the rate reaches 63. It is not, because a
 * rate is sampled, not continuous. Between two observations it can cross the target
 * and come back, and a naive "is the current rate past the target" check misses that
 * entirely: poll at 62.8 and again at 62.9 and the user never hears that it touched
 * 63.4 in between.
 *
 * So an alert fires on a CROSSING between consecutive observations, not on the
 * instantaneous value. That is the difference between a watch that works and one
 * that quietly does nothing on the day it mattered.
 */

export type AlertDirection = 'AT_OR_ABOVE' | 'AT_OR_BELOW'

export interface Alert {
  id: string
  userId: string
  baseCurrency: string
  quoteCurrency: string
  targetRate: number
  direction: AlertDirection
  triggeredAt: Date | null
}

export interface Observation {
  baseCurrency: string
  quoteCurrency: string
  rate: number
  observedAt: Date
}

export interface Trigger {
  alert: Alert
  rate: number
  observedAt: Date
}

/**
 * Alerts that should fire given the previous and current observation of a pair.
 *
 * `previous` is undefined on the first ever observation, in which case the current
 * value alone decides: there is no interval to have crossed.
 */
export function triggered(
  alerts: readonly Alert[],
  current: Observation,
  previous?: Observation,
): Trigger[] {
  return alerts
    .filter((alert) => alert.triggeredAt === null)
    .filter((alert) => matchesPair(alert, current))
    .filter((alert) => crossed(alert, current.rate, previous?.rate))
    .map((alert) => ({ alert, rate: current.rate, observedAt: current.observedAt }))
}

function matchesPair(alert: Alert, observation: Observation): boolean {
  return (
    alert.baseCurrency === observation.baseCurrency &&
    alert.quoteCurrency === observation.quoteCurrency
  )
}

function crossed(alert: Alert, now: number, before: number | undefined): boolean {
  if (alert.direction === 'AT_OR_ABOVE') {
    if (now >= alert.targetRate) return true
    // Touched the target between samples and fell back.
    return before !== undefined && before >= alert.targetRate
  }

  if (now <= alert.targetRate) return true
  return before !== undefined && before <= alert.targetRate
}
