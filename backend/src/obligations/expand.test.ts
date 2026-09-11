import { describe, expect, it } from '@jest/globals'
import { expand, type ObligationRecord } from './repository.js'

const base: ObligationRecord = {
  id: 'x',
  label: 'family support',
  amountMinor: 2_500_000,
  currency: 'INR',
  cadence: 'MONTHLY',
  nextDueOn: new Date('2027-01-15T00:00:00'),
}

const from = new Date('2027-01-01T00:00:00')
const to = new Date('2027-06-30T00:00:00')

describe('expanding a cadence into occurrences', () => {
  it('produces one occurrence per month inside the window', () => {
    const occurrences = expand(base, from, to)
    expect(occurrences).toHaveLength(6) // Jan through Jun
    expect(occurrences[0]!.dueOn.getMonth()).toBe(0)
    expect(occurrences[5]!.dueOn.getMonth()).toBe(5)
  })

  it('produces exactly one for a ONCE obligation', () => {
    expect(expand({ ...base, cadence: 'ONCE' }, from, to)).toHaveLength(1)
  })

  it('steps three months for QUARTERLY', () => {
    const occurrences = expand({ ...base, cadence: 'QUARTERLY' }, from, to)
    expect(occurrences.map((o) => o.dueOn.getMonth())).toEqual([0, 3])
  })

  it('excludes occurrences before the window opens', () => {
    const occurrences = expand(base, new Date('2027-03-01T00:00:00'), to)
    expect(occurrences[0]!.dueOn.getMonth()).toBe(2) // March, not January
  })

  it('returns nothing when the first due date is past the window', () => {
    expect(expand(base, from, new Date('2026-12-01T00:00:00'))).toHaveLength(0)
  })

  // A bill dated the 31st lands on the last day available in a short month, which
  // is what setMonth does and what the real world does.
  it('clamps a month-end date into a shorter month', () => {
    const monthEnd = { ...base, nextDueOn: new Date('2027-01-31T00:00:00') }
    const occurrences = expand(monthEnd, from, new Date('2027-03-31T00:00:00'))
    expect(occurrences[1]!.dueOn.getMonth()).toBe(2) // Feb 31 clamps into March
  })

  it('carries the amount onto every occurrence', () => {
    expect(expand(base, from, to).every((o) => o.amountMinor === 2_500_000)).toBe(true)
  })
})
