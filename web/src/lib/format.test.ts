import { describe, expect, it } from 'vitest'
import { cadenceLabel, combineLocal, formatDate, formatMoney, localNoonIso, toDateInput } from './format'

describe('dates', () => {
  // A date-only string parsed as UTC shows the previous day anywhere west of UTC.
  it('shows a due date on the day it was entered, not the day before', () => {
    expect(formatDate('2026-10-01')).toContain('Oct 1')
  })

  it('round-trips a calendar date through the API format without drifting a day', () => {
    expect(toDateInput(localNoonIso('2026-10-01'))).toBe('2026-10-01')
    expect(toDateInput(localNoonIso('2027-01-01'))).toBe('2027-01-01')
  })

  it('builds a local date and time', () => {
    const at = combineLocal('2026-09-08', '17:30')
    expect([at.getDate(), at.getHours(), at.getMinutes()]).toEqual([8, 17, 30])
  })

  it('returns an empty input value for nothing or garbage', () => {
    expect(toDateInput(null)).toBe('')
    expect(toDateInput('not a date')).toBe('')
  })
})

describe('money', () => {
  it('formats minor units with the currency symbol', () => {
    expect(formatMoney(40_000, 'CAD')).toBe('$400.00')
    expect(formatMoney(2_500_000, 'INR')).toBe('₹25,000.00')
  })

  it('still shows something for an unknown currency code', () => {
    expect(formatMoney(1_000, 'ZZZ')).toContain('10')
  })
})

describe('cadence labels', () => {
  it('reads naturally', () => {
    expect(cadenceLabel('QUARTERLY')).toBe('Every 3 months')
  })
})
