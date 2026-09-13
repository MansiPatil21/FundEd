import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { HeroCard, lastWeeks, monthlyShare } from './HeroCard'
import type { Profile } from '@/lib/session'
import type { DashboardData } from './types'

const monday = (iso: string) => new Date(`${iso}T00:00:00`).toISOString()

describe('lastWeeks', () => {
  it('fills weeks without shifts with zero, so the chart does not skip a quiet month', () => {
    const series = lastWeeks([{ weekStart: monday('2026-08-24'), offCampusHours: 12 }], monday('2026-09-07'), 4)
    expect(series.map((point) => point.value)).toEqual([0, 12, 0, 0])
  })

  it('ends with the current week', () => {
    const series = lastWeeks([{ weekStart: monday('2026-09-07'), offCampusHours: 20 }], monday('2026-09-07'), 8)
    expect(series).toHaveLength(8)
    expect(series.at(-1)).toEqual({ label: 'Sep 7', value: 20 })
  })
})

describe('monthlyShare', () => {
  it('spreads longer cadences across months and ignores one-offs', () => {
    expect(monthlyShare({ amountMinor: 3_000, cadence: 'QUARTERLY' })).toBe(1_000)
    expect(monthlyShare({ amountMinor: 12_000, cadence: 'ANNUAL' })).toBe(1_000)
    expect(monthlyShare({ amountMinor: 5_000, cadence: 'ONCE' })).toBe(0)
  })
})

const dashboard: DashboardData['dashboard'] = {
  viewer: { displayName: 'Mansi Patil', email: 'm@example.com', homeCurrency: 'INR' },
  compliance: {
    breachedWeeks: 0,
    weeks: [{ weekStart: monday('2026-09-07'), offCampusHours: 18 }],
    current: { weekStart: monday('2026-09-07'), offCampusHours: 18, onCampusHours: 0, remainingHours: 6, capHours: 24, breached: false },
  },
  obligations: [{ id: 'o1', label: 'Family', amountMinor: 2_500_000, currency: 'INR', cadence: 'MONTHLY', nextDueOn: monday('2026-09-20') }],
  alerts: [],
  rate: { pair: 'CAD/INR', rate: 62.5, observedAt: new Date().toISOString() },
  upcomingObligationsMinor: 2_500_000,
  deadlines: [],
}

const profile: Profile = {
  id: 'u1',
  email: 'm@example.com',
  displayName: 'Mansi Patil',
  homeCurrency: 'INR',
  localCurrency: 'CAD',
  permit: null,
  budget: { monthlyIncomeMinor: 180_000, monthlySpendingMinor: 120_000, minimumBufferMinor: 50_000 },
  onboarded: true,
}

describe('HeroCard', () => {
  it('opens on hours against the cap', () => {
    render(<HeroCard dashboard={dashboard} profile={profile} />)
    expect(screen.getByTestId('hours').textContent).toContain('18 / 24')
    expect(screen.getByText('75% of your weekly cap')).toBeTruthy()
  })

  it('switches to the money view, converting what is sent home at the current rate', () => {
    render(<HeroCard dashboard={dashboard} profile={profile} />)
    fireEvent.click(screen.getByRole('tab', { name: /Money/ }))
    const view = screen.getByTestId('money-view')
    expect(view.textContent).toContain('$600.00')
    // 25,000 INR a month at 62.5 is 400 CAD.
    expect(view.textContent).toContain('$400.00')
  })
})
