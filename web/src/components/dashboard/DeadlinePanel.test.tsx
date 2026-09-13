import { describe, expect, it } from 'vitest'
import { describeDue } from './DeadlinePanel'

describe('describeDue', () => {
  it('reads naturally around today', () => {
    expect(describeDue(0, 'DUE_SOON')).toBe('Due today')
    expect(describeDue(1, 'DUE_SOON')).toBe('Due tomorrow')
    expect(describeDue(12, 'DUE_SOON')).toBe('In 12 days')
  })

  it('says how late an overdue deadline is, in the singular when it is one day', () => {
    expect(describeDue(-1, 'OVERDUE')).toBe('1 day overdue')
    expect(describeDue(-4, 'OVERDUE')).toBe('4 days overdue')
  })

  it('says done regardless of the date', () => {
    expect(describeDue(-30, 'DONE')).toBe('Done')
  })
})
