'use client'

import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Clock3, Wallet } from 'lucide-react'
import type { Profile } from '@/lib/session'
import { formatDate, formatMoney } from '@/lib/format'
import { AreaChart, type ChartPoint } from '@/components/charts/AreaChart'
import { Amount, Segmented, type SegmentOption } from '@/components/ui'
import type { DashboardData, DashboardObligation } from './types'

type Mode = 'hours' | 'money'

const MODES: ReadonlyArray<SegmentOption<Mode>> = [
  { value: 'hours', label: 'Hours', icon: <Clock3 /> },
  { value: 'money', label: 'Money', icon: <Wallet /> },
]

const hours = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1))

/**
 * The last `count` weeks ending with the current one, with weeks that had no shifts filled
 * in as zero. The API only returns weeks that contain a shift, and a chart that skips the
 * empty weeks would draw a steady line through a month off.
 */
export function lastWeeks(
  weeks: ReadonlyArray<{ weekStart: string; offCampusHours: number }>,
  currentWeekStart: string,
  count = 8,
): ChartPoint[] {
  const byWeek = new Map(weeks.map((week) => [new Date(week.weekStart).toDateString(), week.offCampusHours]))
  const current = new Date(currentWeekStart)
  return Array.from({ length: count }, (_, index) => {
    const start = new Date(current)
    start.setDate(start.getDate() - (count - 1 - index) * 7)
    return {
      label: start.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }),
      value: byWeek.get(start.toDateString()) ?? 0,
    }
  })
}

/** Home-currency minor units owed per month, with longer cadences spread across months. */
export function monthlyShare(obligation: Pick<DashboardObligation, 'amountMinor' | 'cadence'>): number {
  switch (obligation.cadence) {
    case 'MONTHLY':
      return obligation.amountMinor
    case 'QUARTERLY':
      return obligation.amountMinor / 3
    case 'ANNUAL':
      return obligation.amountMinor / 12
    default:
      return 0
  }
}

export function HeroCard({ dashboard, profile }: { dashboard: DashboardData['dashboard']; profile: Profile }) {
  const [mode, setMode] = useState<Mode>('hours')
  const { current, weeks } = dashboard.compliance
  const series = useMemo(() => lastWeeks(weeks, current.weekStart), [weeks, current.weekStart])

  return (
    <section
      data-testid="hero"
      className="relative flex min-h-[460px] flex-col overflow-hidden rounded-[32px] bg-sage-gradient p-6 text-white shadow-[0_28px_60px_-30px_rgba(58,76,51,0.75)] sm:p-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Dashboard view" tone="dark" options={MODES} value={mode} onChange={setMode} testId="hero-toggle" />
        <span className="text-sm text-white/75">Week of {formatDate(current.weekStart)}</span>
      </div>

      {mode === 'hours' ? (
        <HoursView current={current} series={series} />
      ) : (
        <MoneyView dashboard={dashboard} profile={profile} />
      )}
    </section>
  )
}

function HoursView({
  current,
  series,
}: {
  current: DashboardData['dashboard']['compliance']['current']
  series: ChartPoint[]
}) {
  const used = Math.max(0, current.offCampusHours)
  const share = current.capHours > 0 ? Math.round((used / current.capHours) * 100) : 0
  const previous = series.at(-2)?.value ?? 0
  const change = previous > 0 ? Math.round(((used - previous) / previous) * 100) : null

  return (
    <>
      <div data-testid="hours" className="mt-8">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
            current.breached ? 'bg-red-500/90 text-white' : 'bg-white/20 text-white'
          }`}
        >
          {current.breached ? 'Over your weekly cap' : `${share}% of your weekly cap`}
        </span>
        <p className="mt-4 text-6xl font-medium tabular-nums tracking-display sm:text-7xl">
          {hours(used)}
          <span className="text-white/45"> / {current.capHours}</span>
        </p>
        <p className="mt-2 text-sm text-white/80">
          {current.breached
            ? `${hours(-current.remainingHours)} hours over your cap`
            : `${hours(current.remainingHours)} hours left this week`}
          {current.onCampusHours > 0 && ` · plus ${hours(current.onCampusHours)} on campus, not capped`}
        </p>
      </div>

      <div className="mt-auto pt-10">
        <AreaChart
          testId="hours-chart"
          points={series}
          height={180}
          threshold={{ value: current.capHours, label: `Cap ${current.capHours} h` }}
          tooltip={
            <div className="flex items-center gap-3">
              <div>
                <p className="text-lg font-semibold leading-none tracking-tight">{hours(used)} h</p>
                <p className="mt-1 text-xs text-white/55">this week</p>
              </div>
              {change !== null && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-ink">
                  {/* No arrow for an unchanged week: an up-arrow beside 0% implies a rise that did not happen. */}
                  {change > 0 && <ArrowUpRight className="size-3.5" />}
                  {change < 0 && <ArrowDownRight className="size-3.5" />}
                  {change === 0 ? 'Same as last week' : `${Math.abs(change)}%`}
                </span>
              )}
            </div>
          }
        />
      </div>
    </>
  )
}

function MoneyView({ dashboard, profile }: { dashboard: DashboardData['dashboard']; profile: Profile }) {
  const budget = profile.budget
  if (!budget) {
    return (
      <p data-testid="money-view" className="mt-8 text-white/80">
        Add your monthly budget on your profile to see where your money goes.
      </p>
    )
  }

  const surplus = budget.monthlyIncomeMinor - budget.monthlySpendingMinor
  const monthlyHome = dashboard.obligations.reduce((total, obligation) => total + monthlyShare(obligation), 0)
  const rate = dashboard.rate
  // Converted at today's rate, so the three bars share one currency and can be compared.
  const sentHomeCad = rate ? Math.round(monthlyHome / rate.rate) : null
  const base = Math.max(budget.monthlyIncomeMinor, 1)

  const rows = [
    { label: 'Income', value: budget.monthlyIncomeMinor, bar: 'bg-white' },
    { label: 'Living costs', value: budget.monthlySpendingMinor, bar: 'bg-white/55' },
    ...(sentHomeCad !== null && rate
      ? [{ label: `Sent home, at ${rate.rate.toFixed(2)} ${profile.homeCurrency}`, value: sentHomeCad, bar: 'bg-ink' }]
      : []),
  ]

  return (
    <div data-testid="money-view" className="mt-8 flex flex-1 flex-col">
      <span className="inline-flex w-fit rounded-full bg-white/20 px-3 py-1 text-sm font-medium">Left over each month</span>
      <p className="mt-4 text-6xl font-medium tabular-nums tracking-display sm:text-7xl">
        <Amount value={formatMoney(surplus, 'CAD')} fadedClassName="text-white/45" />
      </p>
      <p className="mt-2 text-sm text-white/80">Keeping a buffer of {formatMoney(budget.minimumBufferMinor, 'CAD')}</p>

      <div className="mt-auto space-y-4 pt-10">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-white/85">{row.label}</span>
              <span className="font-medium tabular-nums">
                <Amount value={formatMoney(row.value, 'CAD')} fadedClassName="text-white/50" />
              </span>
            </div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/15">
              <div className={`h-full rounded-full ${row.bar}`} style={{ width: `${Math.min(100, (row.value / base) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
