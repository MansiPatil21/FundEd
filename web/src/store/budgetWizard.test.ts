import { describe, expect, it } from 'vitest'
import reducer, {
  addObligation,
  back,
  canReach,
  canSubmit,
  goTo,
  hydrate,
  isCalendarDate,
  monthlyObligationsMinor,
  next,
  permitEndsBeforeProgram,
  removeObligation,
  setBuffer,
  setDisplayName,
  setHomeCurrency,
  setIncome,
  setInstitution,
  setPermitExpiresOn,
  setProgramEndsOn,
  setSpending,
  setWeeklyHourCap,
  stepIsComplete,
  submitted,
  surplusMinor,
  type BudgetWizardState,
  type ObligationDraft,
} from './budgetWizard'

const initial = reducer(undefined, { type: '@@INIT' })

const obligation = (over: Partial<ObligationDraft> = {}): ObligationDraft => ({
  label: 'Family support',
  amountMinor: 2_500_000,
  currency: 'INR',
  cadence: 'MONTHLY',
  nextDueOn: '2027-01-15',
  ...over,
})

const withProfile = (state: BudgetWizardState = initial): BudgetWizardState => {
  let s = reducer(state, setDisplayName('Mansi Patil'))
  s = reducer(s, setHomeCurrency('INR'))
  s = reducer(s, setInstitution('Dalhousie University'))
  s = reducer(s, setProgramEndsOn('2027-12-15'))
  s = reducer(s, setPermitExpiresOn('2028-03-31'))
  return s
}

const completed = (): BudgetWizardState => {
  let s = withProfile()
  s = reducer(s, setIncome(180_000))
  s = reducer(s, setSpending(120_000))
  s = reducer(s, addObligation(obligation()))
  s = reducer(s, setBuffer(50_000))
  return s
}

describe('field handling', () => {
  it('normalises a currency to three capital letters', () => {
    expect(reducer(initial, setHomeCurrency('inr')).homeCurrency).toBe('INR')
    expect(reducer(initial, setHomeCurrency('in r5')).homeCurrency).toBe('INR')
    expect(reducer(initial, setHomeCurrency('rupees')).homeCurrency).toBe('RUP')
  })

  it('refuses negative money rather than storing it', () => {
    expect(reducer(initial, setIncome(-500)).monthlyIncomeMinor).toBe(0)
    expect(reducer(initial, setBuffer(-1)).minimumBufferMinor).toBe(0)
  })

  it('rounds to whole minor units, because money is never a fraction of a cent', () => {
    expect(reducer(initial, setIncome(1234.7)).monthlyIncomeMinor).toBe(1235)
  })

  it('keeps the weekly cap inside the hours in a week', () => {
    expect(reducer(initial, setWeeklyHourCap(500)).weeklyHourCap).toBe(168)
    expect(reducer(initial, setWeeklyHourCap(-3)).weeklyHourCap).toBe(0)
    expect(reducer(initial, setWeeklyHourCap(20.4)).weeklyHourCap).toBe(20)
    expect(reducer(initial, setWeeklyHourCap(Number.NaN)).weeklyHourCap).toBe(0)
  })

  it('ignores a commitment that is not fully filled in', () => {
    expect(reducer(initial, addObligation(obligation({ label: '   ' }))).obligations).toHaveLength(0)
    expect(reducer(initial, addObligation(obligation({ amountMinor: 0 }))).obligations).toHaveLength(0)
    expect(reducer(initial, addObligation(obligation({ nextDueOn: '2027-02-30' }))).obligations).toHaveLength(0)
  })

  it('adds and removes commitments by position', () => {
    let state = reducer(initial, addObligation(obligation({ label: 'a' })))
    state = reducer(state, addObligation(obligation({ label: 'b' })))
    state = reducer(state, removeObligation(0))
    expect(state.obligations.map((o) => o.label)).toEqual(['b'])
  })
})

describe('calendar dates', () => {
  it('accepts a real date and rejects impossible or malformed ones', () => {
    expect(isCalendarDate('2027-12-15')).toBe(true)
    expect(isCalendarDate('2027-02-30')).toBe(false)
    expect(isCalendarDate('2027-13-01')).toBe(false)
    expect(isCalendarDate('15/12/2027')).toBe(false)
    expect(isCalendarDate('')).toBe(false)
  })

  it('flags a permit that expires before the program ends', () => {
    expect(permitEndsBeforeProgram(withProfile())).toBe(false)
    expect(permitEndsBeforeProgram(reducer(withProfile(), setPermitExpiresOn('2027-06-01')))).toBe(true)
  })
})

describe('step completion', () => {
  it('needs name, currency, institution, both dates and a sensible cap for the profile', () => {
    expect(stepIsComplete(initial, 'profile')).toBe(false)
    expect(stepIsComplete(withProfile(), 'profile')).toBe(true)
    expect(stepIsComplete(reducer(withProfile(), setInstitution('')), 'profile')).toBe(false)
    expect(stepIsComplete(reducer(withProfile(), setWeeklyHourCap(0)), 'profile')).toBe(false)
  })

  it('requires income but allows zero spending', () => {
    expect(stepIsComplete(reducer(initial, setIncome(100_000)), 'income')).toBe(true)
    expect(stepIsComplete(initial, 'income')).toBe(false)
  })

  it('requires at least one commitment, since there is nothing to plan otherwise', () => {
    expect(stepIsComplete(initial, 'obligations')).toBe(false)
    expect(stepIsComplete(reducer(initial, addObligation(obligation())), 'obligations')).toBe(true)
  })
})

describe('navigation', () => {
  it('advances only when the current step is complete', () => {
    expect(reducer(initial, next()).step).toBe('profile')
    expect(reducer(withProfile(), next()).step).toBe('income')
  })

  it('goes back freely, because returning to fix something must never be blocked', () => {
    expect(reducer({ ...completed(), step: 'buffer' }, back()).step).toBe('obligations')
  })

  it('does not go back past the first step', () => {
    expect(reducer(initial, back()).step).toBe('profile')
  })

  it('refuses a jump to a step whose prerequisites are missing', () => {
    expect(canReach(initial, 'buffer')).toBe(false)
    expect(reducer(initial, goTo('buffer')).step).toBe('profile')
  })

  it('allows a jump once everything before it is complete', () => {
    expect(reducer(completed(), goTo('buffer')).step).toBe('buffer')
  })
})

describe('prefilling from the account', () => {
  it('fills saved details without moving the step or clearing commitments', () => {
    let state = reducer(completed(), goTo('buffer'))
    state = reducer(state, hydrate({ displayName: 'Saved Name', weeklyHourCap: 20 }))
    expect(state.step).toBe('buffer')
    expect(state.displayName).toBe('Saved Name')
    expect(state.weeklyHourCap).toBe(20)
    expect(state.obligations).toHaveLength(1)
  })

  it('ignores empty values, so a blank field on the account never wipes typed input', () => {
    const state = reducer(withProfile(), hydrate({ institution: '', programEndsOn: '' }))
    expect(state.institution).toBe('Dalhousie University')
    expect(state.programEndsOn).toBe('2027-12-15')
  })
})

describe('submission', () => {
  it('refuses to submit an incomplete setup', () => {
    expect(canSubmit(initial)).toBe(false)
    expect(reducer(initial, submitted()).submitted).toBe(false)
  })

  it('submits once every step is satisfied', () => {
    expect(canSubmit(completed())).toBe(true)
    expect(reducer(completed(), submitted()).submitted).toBe(true)
  })
})

describe('derived figures', () => {
  it('reports the monthly surplus, which is what is actually sendable', () => {
    expect(surplusMinor(completed())).toBe(60_000)
  })

  it('amortises a quarterly bill across the months it covers', () => {
    const state = reducer(initial, addObligation(obligation({ amountMinor: 3_000, cadence: 'QUARTERLY' })))
    expect(monthlyObligationsMinor(state)).toBe(1_000)
  })

  it('amortises an annual bill across twelve months', () => {
    const state = reducer(initial, addObligation(obligation({ amountMinor: 12_000, cadence: 'ANNUAL' })))
    expect(monthlyObligationsMinor(state)).toBe(1_000)
  })

  it('excludes a one-off from the recurring total', () => {
    const state = reducer(initial, addObligation(obligation({ amountMinor: 99_999, cadence: 'ONCE' })))
    expect(monthlyObligationsMinor(state)).toBe(0)
  })

  it('sums several cadences together', () => {
    let state = reducer(initial, addObligation(obligation({ amountMinor: 1_000, cadence: 'MONTHLY' })))
    state = reducer(state, addObligation(obligation({ amountMinor: 3_000, cadence: 'QUARTERLY' })))
    expect(monthlyObligationsMinor(state)).toBe(2_000)
  })
})
