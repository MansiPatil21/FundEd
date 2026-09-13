import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

/**
 * Profile setup for a new account: who the student is, their study permit, money in and
 * out, what they send home, and the buffer they want to keep.
 *
 * Redux rather than component state because a student can step back, lose focus on a
 * phone, or come back to it, and retyping a permit date is how people abandon a form. The
 * rules below stop anyone reaching a later step, or finishing, with data the product
 * cannot use.
 */

export const STEPS = ['profile', 'income', 'obligations', 'buffer'] as const
export type Step = (typeof STEPS)[number]

export const STEP_TITLES: Record<Step, { title: string; description: string }> = {
  profile: { title: 'About you', description: 'Your name, home currency and study permit' },
  income: { title: 'Money in and out', description: 'What arrives and what you spend each month' },
  obligations: { title: 'Money you send home', description: 'Commitments in your home currency' },
  buffer: { title: 'Safety buffer', description: 'The balance you never want to fall below' },
}

export type Cadence = 'ONCE' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL'

export interface ObligationDraft {
  label: string
  amountMinor: number
  currency: string
  cadence: Cadence
  /** YYYY-MM-DD */
  nextDueOn: string
}

export interface BudgetWizardState {
  step: Step
  displayName: string
  homeCurrency: string
  institution: string
  /** YYYY-MM-DD */
  programEndsOn: string
  /** YYYY-MM-DD */
  permitExpiresOn: string
  weeklyHourCap: number
  monthlyIncomeMinor: number
  monthlySpendingMinor: number
  obligations: ObligationDraft[]
  minimumBufferMinor: number
  submitted: boolean
}

export const initialWizardState: BudgetWizardState = {
  step: 'profile',
  displayName: '',
  homeCurrency: '',
  institution: '',
  programEndsOn: '',
  permitExpiresOn: '',
  weeklyHourCap: 24,
  monthlyIncomeMinor: 0,
  monthlySpendingMinor: 0,
  obligations: [],
  minimumBufferMinor: 0,
  submitted: false,
}

const HOURS_IN_A_WEEK = 168

/** A real YYYY-MM-DD date. Rejects 2027-02-30, which Date would silently roll into March. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year!, month! - 1, day!)
  return date.getFullYear() === year && date.getMonth() === month! - 1 && date.getDate() === day
}

/** True when the permit lapses before the program ends, which means an extension is needed. */
export function permitEndsBeforeProgram(state: BudgetWizardState): boolean {
  return (
    isCalendarDate(state.permitExpiresOn) &&
    isCalendarDate(state.programEndsOn) &&
    state.permitExpiresOn < state.programEndsOn
  )
}

export function obligationDraftIsValid(draft: ObligationDraft): boolean {
  return (
    draft.label.trim().length > 0 &&
    draft.amountMinor > 0 &&
    draft.currency.length === 3 &&
    isCalendarDate(draft.nextDueOn)
  )
}

/** Whether a single step has everything it needs. */
export function stepIsComplete(state: BudgetWizardState, step: Step): boolean {
  switch (step) {
    case 'profile':
      return (
        state.displayName.trim().length > 0 &&
        state.homeCurrency.length === 3 &&
        state.institution.trim().length > 0 &&
        isCalendarDate(state.programEndsOn) &&
        isCalendarDate(state.permitExpiresOn) &&
        state.weeklyHourCap >= 1 &&
        state.weeklyHourCap <= HOURS_IN_A_WEEK
      )
    case 'income':
      // Spending may legitimately be zero; income may not, or nothing is plannable.
      return state.monthlyIncomeMinor > 0
    case 'obligations':
      return state.obligations.length > 0
    case 'buffer':
      return state.minimumBufferMinor >= 0
  }
}

/** A step is reachable once every step before it is complete. */
export function canReach(state: BudgetWizardState, step: Step): boolean {
  const target = STEPS.indexOf(step)
  return STEPS.slice(0, target).every((earlier) => stepIsComplete(state, earlier))
}

export function canSubmit(state: BudgetWizardState): boolean {
  return STEPS.every((step) => stepIsComplete(state, step))
}

/** Monthly surplus in local minor units: what is actually available to send home. */
export function surplusMinor(state: BudgetWizardState): number {
  return state.monthlyIncomeMinor - state.monthlySpendingMinor
}

/**
 * Home-currency minor units owed per month, with longer cadences amortised. A quarterly
 * bill is a third of itself every month, which is what makes the comparison with the
 * surplus honest.
 */
export function monthlyObligationsMinor(state: BudgetWizardState): number {
  return state.obligations.reduce((total, obligation) => {
    const perMonth =
      obligation.cadence === 'MONTHLY'
        ? obligation.amountMinor
        : obligation.cadence === 'QUARTERLY'
          ? obligation.amountMinor / 3
          : obligation.cadence === 'ANNUAL'
            ? obligation.amountMinor / 12
            : 0 // a one-off is not a recurring commitment
    return total + perMonth
  }, 0)
}

type Hydratable = Partial<
  Pick<
    BudgetWizardState,
    | 'displayName'
    | 'homeCurrency'
    | 'institution'
    | 'programEndsOn'
    | 'permitExpiresOn'
    | 'weeklyHourCap'
    | 'monthlyIncomeMinor'
    | 'monthlySpendingMinor'
    | 'minimumBufferMinor'
  >
>

const normaliseCurrency = (value: string) =>
  value
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 3)

const wholeMinor = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0)

const slice = createSlice({
  name: 'budgetWizard',
  initialState: initialWizardState,
  reducers: {
    setDisplayName(state, action: PayloadAction<string>) {
      state.displayName = action.payload.slice(0, 120)
    },
    setHomeCurrency(state, action: PayloadAction<string>) {
      state.homeCurrency = normaliseCurrency(action.payload)
    },
    setInstitution(state, action: PayloadAction<string>) {
      state.institution = action.payload.slice(0, 200)
    },
    setProgramEndsOn(state, action: PayloadAction<string>) {
      state.programEndsOn = action.payload
    },
    setPermitExpiresOn(state, action: PayloadAction<string>) {
      state.permitExpiresOn = action.payload
    },
    setWeeklyHourCap(state, action: PayloadAction<number>) {
      const hours = Number.isFinite(action.payload) ? Math.round(action.payload) : 0
      state.weeklyHourCap = Math.min(HOURS_IN_A_WEEK, Math.max(0, hours))
    },
    setIncome(state, action: PayloadAction<number>) {
      state.monthlyIncomeMinor = wholeMinor(action.payload)
    },
    setSpending(state, action: PayloadAction<number>) {
      state.monthlySpendingMinor = wholeMinor(action.payload)
    },
    addObligation(state, action: PayloadAction<ObligationDraft>) {
      // Checked here rather than only in the form, so nothing half-filled can ever be sent.
      if (obligationDraftIsValid(action.payload)) {
        state.obligations.push({ ...action.payload, label: action.payload.label.trim() })
      }
    },
    removeObligation(state, action: PayloadAction<number>) {
      state.obligations.splice(action.payload, 1)
    },
    setBuffer(state, action: PayloadAction<number>) {
      state.minimumBufferMinor = wholeMinor(action.payload)
    },
    /**
     * Prefills from what the server already has. Empty values are ignored so a blank field
     * on the account can never wipe something the student just typed.
     */
    hydrate(state, action: PayloadAction<Hydratable>) {
      for (const [key, value] of Object.entries(action.payload) as Array<[keyof Hydratable, unknown]>) {
        if (value === undefined || value === null || value === '') continue
        if (key === 'homeCurrency') state.homeCurrency = normaliseCurrency(String(value))
        else if (typeof value === 'string' && typeof state[key] === 'string') (state[key] as string) = value
        else if (typeof value === 'number' && typeof state[key] === 'number') (state[key] as number) = value
      }
    },
    goTo(state, action: PayloadAction<Step>) {
      // Guarded in the reducer, so no link or back button can land on a step the data
      // does not support.
      if (canReach(state, action.payload)) {
        state.step = action.payload
      }
    },
    next(state) {
      const upcoming = STEPS[STEPS.indexOf(state.step) + 1]
      if (upcoming && stepIsComplete(state, state.step)) {
        state.step = upcoming
      }
    },
    back(state) {
      const previous = STEPS[STEPS.indexOf(state.step) - 1]
      if (previous) state.step = previous
    },
    submitted(state) {
      if (canSubmit(state)) state.submitted = true
    },
    reset: () => initialWizardState,
  },
})

export const {
  setDisplayName,
  setHomeCurrency,
  setInstitution,
  setProgramEndsOn,
  setPermitExpiresOn,
  setWeeklyHourCap,
  setIncome,
  setSpending,
  addObligation,
  removeObligation,
  setBuffer,
  hydrate,
  goTo,
  next,
  back,
  submitted,
  reset,
} = slice.actions

export default slice.reducer
