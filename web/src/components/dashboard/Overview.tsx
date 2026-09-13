'use client'

import type { ReactNode } from 'react'
import { ArrowLeftRight, CalendarClock, PiggyBank, Send } from 'lucide-react'
import type { Profile } from '@/lib/session'
import { formatDate, formatMoney, formatTime } from '@/lib/format'
import { Amount, Card } from '@/components/ui'
import type { DashboardData } from './types'

const DAY = 86_400_000

export function Overview({ dashboard, profile }: { dashboard: DashboardData['dashboard']; profile: Profile }) {
  const { budget, permit } = profile
  const surplus = budget ? budget.monthlyIncomeMinor - budget.monthlySpendingMinor : null
  const permitDays = permit ? Math.ceil((new Date(permit.expiresOn).getTime() - Date.now()) / DAY) : null
  const count = dashboard.obligations.length

  return (
    <Card title="Overview" description="Where things stand this month" testId="overview">
      <div className="grid grid-cols-2 gap-3">
        <Tile
          testId="upcoming"
          label="Due home in 30 days"
          icon={<Send />}
          value={<Amount value={formatMoney(dashboard.upcomingObligationsMinor, profile.homeCurrency)} />}
          note={`${count} ${count === 1 ? 'commitment' : 'commitments'} recorded`}
        />
        <Tile
          testId="rate"
          label={`CAD to ${profile.homeCurrency}`}
          icon={<ArrowLeftRight />}
          value={dashboard.rate ? <Amount value={dashboard.rate.rate.toFixed(2)} /> : <span className="text-black/25">--</span>}
          note={dashboard.rate ? `Updated ${formatTime(dashboard.rate.observedAt)}` : 'No rate observed yet'}
        />
        <Tile
          testId="surplus"
          label="Left over each month"
          icon={<PiggyBank />}
          value={
            surplus === null ? (
              <span className="text-lg text-black/35">Not set</span>
            ) : (
              <span className={surplus < 0 ? 'text-red-600' : ''}>
                <Amount value={formatMoney(surplus, 'CAD')} />
              </span>
            )
          }
          note={budget ? `Buffer kept: ${formatMoney(budget.minimumBufferMinor, 'CAD')}` : 'Add your budget on your profile'}
        />
        <Tile
          testId="permit"
          label="Study permit"
          icon={<CalendarClock />}
          value={
            permitDays === null ? (
              <span className="text-black/25">--</span>
            ) : permitDays <= 0 ? (
              <span className="text-red-600">Expired</span>
            ) : (
              <span className={permitDays <= 90 ? 'text-amber-700' : ''}>
                {permitDays}
                <span className="text-lg font-medium text-black/35"> days</span>
              </span>
            )
          }
          note={permit ? `Expires ${formatDate(permit.expiresOn)}` : 'Not recorded'}
        />
      </div>
    </Card>
  )
}

function Tile({
  testId,
  label,
  icon,
  value,
  note,
}: {
  testId: string
  label: string
  icon: ReactNode
  value: ReactNode
  note: string
}) {
  return (
    <article data-testid={testId} className="flex min-h-40 flex-col rounded-3xl bg-tile p-4 sm:p-5 lg:min-h-[184px]">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[13px] leading-snug text-black/55">{label}</h3>
        <span className="text-black/35 [&_svg]:size-[18px]">{icon}</span>
      </div>
      <p className="mt-auto pt-6 text-2xl font-semibold tabular-nums tracking-tight text-ink sm:text-[26px]">{value}</p>
      <p className="mt-1 text-xs text-black/45">{note}</p>
    </article>
  )
}
