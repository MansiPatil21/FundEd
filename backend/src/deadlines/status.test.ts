import { describe, expect, it } from '@jest/globals'
import { daysUntil, deadlineStatus, needingAttention } from './status.js'

const at = (iso: string) => new Date(iso)
const NOW = at('2026-09-12T20:30:00')

describe('daysUntil', () => {
  it('counts calendar days, so a time later today is still today', () => {
    expect(daysUntil(at('2026-09-12T23:59:00'), NOW)).toBe(0)
    expect(daysUntil(at('2026-09-13T00:01:00'), NOW)).toBe(1)
  })

  // Clocks go back on 2026-11-01 in Canada. Elapsed time across it is not a whole number
  // of 24-hour days, and dividing milliseconds would get this wrong.
  it('is not thrown off by a daylight-saving change', () => {
    expect(daysUntil(at('2026-11-02T00:30:00'), at('2026-10-30T23:30:00'))).toBe(3)
  })

  it('goes negative once a date has passed', () => {
    expect(daysUntil(at('2026-09-10T12:00:00'), NOW)).toBe(-2)
  })
})

describe('deadlineStatus', () => {
  const open = (iso: string) => ({ dueOn: at(iso), completedAt: null })

  it('calls today and the next two weeks due soon', () => {
    expect(deadlineStatus(open('2026-09-12T12:00:00'), NOW).status).toBe('DUE_SOON')
    expect(deadlineStatus(open('2026-09-26T12:00:00'), NOW)).toEqual({ daysLeft: 14, status: 'DUE_SOON' })
  })

  it('calls anything further out upcoming', () => {
    expect(deadlineStatus(open('2026-09-27T12:00:00'), NOW)).toEqual({ daysLeft: 15, status: 'UPCOMING' })
  })

  it('calls a passed, unfinished deadline overdue', () => {
    expect(deadlineStatus(open('2026-09-11T12:00:00'), NOW)).toEqual({ daysLeft: -1, status: 'OVERDUE' })
  })

  it('calls a completed deadline done, even if its date has passed', () => {
    expect(deadlineStatus({ dueOn: at('2026-08-01T12:00:00'), completedAt: at('2026-07-30T09:00:00') }, NOW).status).toBe('DONE')
  })
})

describe('needingAttention', () => {
  it('lists overdue first, then due soon, and leaves out upcoming and done', () => {
    const result = needingAttention(
      [
        { label: 'soon', dueOn: at('2026-09-20T12:00:00'), completedAt: null },
        { label: 'later', dueOn: at('2026-12-01T12:00:00'), completedAt: null },
        { label: 'late', dueOn: at('2026-09-08T12:00:00'), completedAt: null },
        { label: 'handled', dueOn: at('2026-09-05T12:00:00'), completedAt: at('2026-09-04T12:00:00') },
      ],
      NOW,
    )
    expect(result.map((deadline) => deadline.label)).toEqual(['late', 'soon'])
  })
})
