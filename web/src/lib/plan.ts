import type { Budget } from './session'

/**
 * Turning the planning form and the student's saved budget into the API's request.
 *
 * The optimiser plans in DAILY periods, while a student thinks in months. The conversion
 * lives here, once, rather than scattered across a component where a slip would silently
 * plan with a month's income arriving every day.
 */

export type Horizon = 90 | 180

export interface PlanForm {
  horizonDays: Horizon
  openingBalanceMinor: number
  fixedFeeMinor: number
  /** As typed, e.g. "0.50" for half a percent. */
  variablePercent: string
  /** As typed, e.g. "61.84" home-currency units per CAD. */
  assumedRate: string
}

export interface PlanBody {
  horizonDays: number
  openingBalanceMinor: number
  minimumBalanceMinor: number
  minTransferMinor: number
  incomePerPeriodMinor: number
  spendingPerPeriodMinor: number
  fees: { fixedMinor: number; variableBps: number }
  assumedRate: number
}

export interface PlannedTransfer {
  sendOn: string
  amountMinor: number
  feeMinor: number
  rate: number
  receivedHomeMinor: number
}

export interface PlanResult {
  horizon: { from: string; to: string; days: number }
  assumedRate: number
  obligationsPlanned: number
  status: string
  transfers: PlannedTransfer[]
  totalSentMinor: number
  totalFeesMinor: number
  totalCostMinor: number
  closingBalanceMinor: number
  baseline: { transfers: number; totalFeesMinor: number; totalCostMinor: number } | null
  savingMinor: number | null
  caveat: string
}

export interface SavingResult {
  paths: number
  feasiblePaths: number
  meanSavingMinor: number
  medianSavingMinor: number
  ciLowMinor: number
  ciHighMinor: number
  confidence: number
  significant: boolean
  historyUsed: number
  caveat: string
}

/** A monthly amount spread evenly across days: twelve months over 365 days. */
export function perDay(monthlyMinor: number): number {
  return Math.round((monthlyMinor * 12) / 365)
}

/** "0.5" percent to 50 basis points, or null for anything that is not a sensible percentage. */
export function percentToBps(percent: string): number | null {
  if (percent.trim() === '') return null
  const value = Number(percent)
  if (!Number.isFinite(value) || value < 0 || value > 100) return null
  return Math.round(value * 100)
}

/** The request body, or null when something needed is missing or invalid. */
export function buildPlanBody(budget: Budget | null, form: PlanForm): PlanBody | null {
  const rate = Number(form.assumedRate)
  const variableBps = percentToBps(form.variablePercent)
  if (!budget || !Number.isFinite(rate) || rate <= 0 || variableBps === null || form.openingBalanceMinor <= 0) {
    return null
  }
  return {
    horizonDays: form.horizonDays,
    openingBalanceMinor: form.openingBalanceMinor,
    minimumBalanceMinor: budget.minimumBufferMinor,
    minTransferMinor: 0,
    incomePerPeriodMinor: perDay(budget.monthlyIncomeMinor),
    spendingPerPeriodMinor: perDay(budget.monthlySpendingMinor),
    fees: { fixedMinor: form.fixedFeeMinor, variableBps },
    assumedRate: rate,
  }
}
