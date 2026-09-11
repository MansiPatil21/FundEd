import { describe, expect, it } from '@jest/globals'
import { currentWeek, weekStartOf, weeklyUsage, wouldBreach, type Shift } from './workHours.js'

/** Local-time helper so the tests read as wall-clock, which is how the cap is defined. */
const at = (iso: string) => new Date(iso)

const shift = (start: string, end: string, onCampus = false): Shift => ({
  startedAt: at(start),
  endedAt: at(end),
  onCampus,
})

const CAP = 24

describe('weekStartOf', () => {
  it('returns the Monday that opens the week', () => {
    // 2026-09-11 is a Friday.
    expect(weekStartOf(at('2026-09-11T15:00:00')).toDateString()).toBe('Mon Sep 07 2026')
  })

  it('treats Sunday as the end of the week that began six days earlier, not a new one', () => {
    expect(weekStartOf(at('2026-09-13T23:00:00')).toDateString()).toBe('Mon Sep 07 2026')
  })

  it('is idempotent on a Monday at midnight', () => {
    const monday = at('2026-09-07T00:00:00')
    expect(weekStartOf(monday).getTime()).toBe(monday.getTime())
  })
})

describe('weeklyUsage', () => {
  it('sums off-campus hours within a single week', () => {
    const weeks = weeklyUsage(
      [shift('2026-09-08T09:00:00', '2026-09-08T17:00:00'), shift('2026-09-10T09:00:00', '2026-09-10T14:00:00')],
      CAP,
    )
    expect(weeks).toHaveLength(1)
    expect(weeks[0]!.offCampusHours).toBe(13)
    expect(weeks[0]!.remainingHours).toBe(11)
    expect(weeks[0]!.breached).toBe(false)
  })

  it('excludes on-campus hours from the capped total but still reports them', () => {
    const weeks = weeklyUsage(
      [shift('2026-09-08T09:00:00', '2026-09-08T17:00:00'), shift('2026-09-09T09:00:00', '2026-09-09T19:00:00', true)],
      CAP,
    )
    expect(weeks[0]!.offCampusHours).toBe(8)
    expect(weeks[0]!.onCampusHours).toBe(10)
    expect(weeks[0]!.breached).toBe(false)
  })

  it('flags a breach once off-campus hours exceed the cap', () => {
    const weeks = weeklyUsage(
      [
        shift('2026-09-08T08:00:00', '2026-09-08T18:00:00'), // 10
        shift('2026-09-09T08:00:00', '2026-09-09T18:00:00'), // 10
        shift('2026-09-10T08:00:00', '2026-09-10T14:00:00'), // 6 -> 26
      ],
      CAP,
    )
    expect(weeks[0]!.offCampusHours).toBe(26)
    expect(weeks[0]!.remainingHours).toBe(-2)
    expect(weeks[0]!.breached).toBe(true)
  })

  // The bug the naive implementation has: attribute the whole shift to its start
  // week and a Sunday-night-into-Monday shift never counts against the new week.
  it('splits a shift that crosses midnight into Monday across both weeks', () => {
    const weeks = weeklyUsage([shift('2026-09-13T22:00:00', '2026-09-14T06:00:00')], CAP)

    expect(weeks).toHaveLength(2)
    expect(weeks[0]!.weekStart.toDateString()).toBe('Mon Sep 07 2026')
    expect(weeks[0]!.offCampusHours).toBe(2) // 22:00 -> midnight
    expect(weeks[1]!.weekStart.toDateString()).toBe('Mon Sep 14 2026')
    expect(weeks[1]!.offCampusHours).toBe(6) // midnight -> 06:00
  })

  it('ignores a shift that ends before it starts rather than counting negative hours', () => {
    expect(weeklyUsage([shift('2026-09-10T17:00:00', '2026-09-10T09:00:00')], CAP)).toHaveLength(0)
  })

  it('returns weeks oldest first', () => {
    const weeks = weeklyUsage(
      [shift('2026-09-21T09:00:00', '2026-09-21T12:00:00'), shift('2026-09-08T09:00:00', '2026-09-08T12:00:00')],
      CAP,
    )
    expect(weeks.map((w) => w.weekStart.toDateString())).toEqual(['Mon Sep 07 2026', 'Mon Sep 21 2026'])
  })
})

describe('currentWeek', () => {
  it('reports a full allowance when nothing has been worked', () => {
    const week = currentWeek([], CAP, at('2026-09-11T12:00:00'))
    expect(week.offCampusHours).toBe(0)
    expect(week.remainingHours).toBe(CAP)
    expect(week.breached).toBe(false)
  })

  it('ignores shifts from other weeks', () => {
    const week = currentWeek([shift('2026-09-01T09:00:00', '2026-09-01T17:00:00')], CAP, at('2026-09-11T12:00:00'))
    expect(week.offCampusHours).toBe(0)
  })
})

describe('wouldBreach', () => {
  const existing = [
    shift('2026-09-08T08:00:00', '2026-09-08T18:00:00'), // 10
    shift('2026-09-09T08:00:00', '2026-09-09T18:00:00'), // 10
  ]

  it('permits a shift that fits inside the remaining allowance', () => {
    expect(wouldBreach(existing, shift('2026-09-10T09:00:00', '2026-09-10T13:00:00'), CAP)).toBe(false)
  })

  it('rejects a shift that would push the week over the cap', () => {
    expect(wouldBreach(existing, shift('2026-09-10T09:00:00', '2026-09-10T15:00:00'), CAP)).toBe(true)
  })

  it('permits an identical shift in a later week, where the allowance is fresh', () => {
    expect(wouldBreach(existing, shift('2026-09-17T09:00:00', '2026-09-17T15:00:00'), CAP)).toBe(false)
  })
})
