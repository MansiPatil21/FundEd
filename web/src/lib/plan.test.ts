import { describe, expect, it } from 'vitest'
import { buildPlanBody, percentToBps, perDay, type PlanForm } from './plan'

const budget = { monthlyIncomeMinor: 185_075, monthlySpendingMinor: 120_000, minimumBufferMinor: 50_000 }

const form: PlanForm = {
  horizonDays: 180,
  openingBalanceMinor: 300_000,
  fixedFeeMinor: 399,
  variablePercent: '0.50',
  assumedRate: '61.84',
}

describe('perDay', () => {
  // The optimiser plans in days. Sending a monthly figure as a daily one would plan with
  // thirty months of income arriving in a month.
  it('spreads a monthly amount across the days of a year', () => {
    expect(perDay(185_075)).toBe(6_085)
    expect(perDay(120_000)).toBe(3_945)
  })
})

describe('percentToBps', () => {
  it('converts a percentage to basis points', () => {
    expect(percentToBps('0.5')).toBe(50)
    expect(percentToBps('1.25')).toBe(125)
    expect(percentToBps('0')).toBe(0)
  })

  it('rejects what is not a sensible percentage', () => {
    expect(percentToBps('')).toBeNull()
    expect(percentToBps('abc')).toBeNull()
    expect(percentToBps('-1')).toBeNull()
    expect(percentToBps('101')).toBeNull()
  })
})

describe('buildPlanBody', () => {
  it('builds the daily request from the monthly budget', () => {
    expect(buildPlanBody(budget, form)).toEqual({
      horizonDays: 180,
      openingBalanceMinor: 300_000,
      minimumBalanceMinor: 50_000,
      minTransferMinor: 0,
      incomePerPeriodMinor: 6_085,
      spendingPerPeriodMinor: 3_945,
      fees: { fixedMinor: 399, variableBps: 50 },
      assumedRate: 61.84,
    })
  })

  it('waits for a budget, a balance, a real rate and a valid fee', () => {
    expect(buildPlanBody(null, form)).toBeNull()
    expect(buildPlanBody(budget, { ...form, openingBalanceMinor: 0 })).toBeNull()
    expect(buildPlanBody(budget, { ...form, assumedRate: '' })).toBeNull()
    expect(buildPlanBody(budget, { ...form, assumedRate: '-3' })).toBeNull()
    expect(buildPlanBody(budget, { ...form, variablePercent: 'x' })).toBeNull()
  })
})
