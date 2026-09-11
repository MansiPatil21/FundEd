import { describe, expect, it } from '@jest/globals'
import { triggered, type Alert, type Observation } from './alerts.js'

const alert = (over: Partial<Alert> = {}): Alert => ({
  id: 'a1',
  userId: 'u1',
  baseCurrency: 'CAD',
  quoteCurrency: 'INR',
  targetRate: 63,
  direction: 'AT_OR_ABOVE',
  triggeredAt: null,
  ...over,
})

const at = (rate: number): Observation => ({
  baseCurrency: 'CAD',
  quoteCurrency: 'INR',
  rate,
  observedAt: new Date('2027-01-05T12:00:00Z'),
})

describe('AT_OR_ABOVE alerts', () => {
  it('fires when the current rate reaches the target', () => {
    expect(triggered([alert()], at(63), at(62))).toHaveLength(1)
  })

  it('fires when the rate passes the target', () => {
    expect(triggered([alert()], at(63.5), at(62))).toHaveLength(1)
  })

  it('does not fire while the rate stays below', () => {
    expect(triggered([alert()], at(62.9), at(62.5))).toHaveLength(0)
  })

  // The case a naive implementation misses entirely.
  it('fires when the rate crossed the target and fell back between samples', () => {
    expect(triggered([alert()], at(62.4), at(63.2))).toHaveLength(1)
  })
})

describe('AT_OR_BELOW alerts', () => {
  const below = alert({ direction: 'AT_OR_BELOW', targetRate: 59 })

  it('fires when the rate drops to the target', () => {
    expect(triggered([below], at(59), at(60))).toHaveLength(1)
  })

  it('does not fire while the rate stays above', () => {
    expect(triggered([below], at(59.4), at(60))).toHaveLength(0)
  })

  it('fires when the rate dipped below and recovered between samples', () => {
    expect(triggered([below], at(59.6), at(58.7))).toHaveLength(1)
  })
})

describe('general behaviour', () => {
  it('ignores an alert that has already fired, so it never fires twice', () => {
    const spent = alert({ triggeredAt: new Date('2027-01-01T00:00:00Z') })
    expect(triggered([spent], at(64), at(62))).toHaveLength(0)
  })

  it('ignores alerts for a different currency pair', () => {
    const other = alert({ quoteCurrency: 'NGN' })
    expect(triggered([other], at(64), at(62))).toHaveLength(0)
  })

  it('decides on the current value alone when there is no previous observation', () => {
    expect(triggered([alert()], at(64))).toHaveLength(1)
    expect(triggered([alert()], at(62))).toHaveLength(0)
  })

  it('returns every alert that crossed, not just the first', () => {
    const alerts = [alert({ id: 'a', targetRate: 62 }), alert({ id: 'b', targetRate: 63 })]
    expect(triggered(alerts, at(64), at(61))).toHaveLength(2)
  })

  it('carries the observation onto the trigger so the notification can quote it', () => {
    const [trigger] = triggered([alert()], at(63.7), at(62))
    expect(trigger!.rate).toBe(63.7)
    expect(trigger!.observedAt).toEqual(new Date('2027-01-05T12:00:00Z'))
  })
})
