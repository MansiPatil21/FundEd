'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useQuery } from '@apollo/client/react'
import { GraduationCap } from 'lucide-react'
import { DASHBOARD } from '@/lib/queries'
import { useRequireProfile } from '@/lib/useProfile'
import { signOut, type Profile } from '@/lib/session'
import { useFxAlerts } from '@/lib/useFxAlerts'
import { AppShell } from '@/components/AppShell'
import { Button, ErrorScreen, Notice, PageLoader, Spinner } from '@/components/ui'
import { HeroCard } from '@/components/dashboard/HeroCard'
import { Overview } from '@/components/dashboard/Overview'
import { ShiftPanel } from '@/components/dashboard/ShiftPanel'
import { ObligationPanel } from '@/components/dashboard/ObligationPanel'
import { AlertPanel } from '@/components/dashboard/AlertPanel'
import { PlanPanel } from '@/components/dashboard/PlanPanel'
import { DeadlinePanel, describeDue } from '@/components/dashboard/DeadlinePanel'
import type { DashboardData } from '@/components/dashboard/types'

const DAY = 86_400_000

export default function DashboardPage() {
  const { state, reload } = useRequireProfile({ requireOnboarded: true })

  if (state.status === 'loading') return <PageLoader label="Loading your dashboard…" />
  if (state.status === 'error') return <ErrorScreen message={state.message} onRetry={() => void reload()} />

  return (
    <AppShell profile={state.profile}>
      <Dashboard profile={state.profile} />
    </AppShell>
  )
}

function Dashboard({ profile }: { profile: Profile }) {
  const { data, loading, error, refetch } = useQuery<DashboardData>(DASHBOARD, {
    variables: { upcomingDays: 30 },
    fetchPolicy: 'cache-and-network',
  })
  const live = useFxAlerts()
  const refresh = useCallback(() => {
    void refetch()
  }, [refetch])

  // GraphQL reports an expired session inside a successful response rather than as a 401.
  useEffect(() => {
    if (error?.message.includes('Sign in to load')) signOut()
  }, [error])

  const greeting = useMemo(() => {
    const hour = new Date().getHours()
    return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  }, [])

  if (loading && !data) {
    return (
      <div className="flex items-center gap-3 py-24 text-sm text-black/50" data-testid="loading">
        <Spinner /> Loading your numbers…
      </div>
    )
  }

  if (error && !data) {
    return (
      <Notice tone="danger" testId="error">
        Could not load your dashboard. {error.message}
        <Button variant="secondary" onClick={refresh} className="ml-3">
          Retry
        </Button>
      </Notice>
    )
  }

  if (!data) return null

  const { dashboard } = data
  const firstName = profile.displayName.split(/\s+/)[0]
  const attention = dashboard.deadlines
    .filter((deadline) => deadline.status === 'OVERDUE' || deadline.status === 'DUE_SOON')
    .sort((a, b) => a.daysLeft - b.daysLeft)
  const permitDaysLeft = profile.permit
    ? Math.ceil((new Date(profile.permit.expiresOn).getTime() - Date.now()) / DAY)
    : null

  return (
    <div className="space-y-6" data-testid="dashboard">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-black/45">{greeting},</p>
          <h1 className="text-5xl font-medium tracking-display text-ink" data-testid="greeting">
            {firstName}
          </h1>
        </div>
        {profile.permit && (
          <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm text-black/60 shadow-sm ring-1 ring-black/5">
            <GraduationCap className="size-4" />
            {profile.permit.institution}
          </span>
        )}
      </div>

      {live.length > 0 && (
        <Notice tone="success" testId="live-alerts">
          {live.map((alert) => (
            <p key={`${alert.alertId}-${alert.observedAt}`}>
              Rate alert: {alert.pair} reached <strong>{alert.rate.toFixed(2)}</strong> (your target was{' '}
              {alert.targetRate.toFixed(2)})
            </p>
          ))}
        </Notice>
      )}

      {dashboard.compliance.breachedWeeks > 0 && (
        <Notice tone="danger" testId="breach-warning">
          You went over your weekly cap in {dashboard.compliance.breachedWeeks}{' '}
          {dashboard.compliance.breachedWeeks === 1 ? 'week' : 'weeks'}. Working past the cap breaks the conditions of your
          study permit.
        </Notice>
      )}

      {permitDaysLeft !== null && permitDaysLeft <= 90 && (
        <Notice tone="warning" testId="permit-expiry">
          {permitDaysLeft <= 0 ? 'Your study permit has expired.' : `Your study permit expires in ${permitDaysLeft} days.`}{' '}
          Apply for an extension before it lapses.
        </Notice>
      )}

      {attention.length > 0 && (
        <Notice tone="warning" testId="deadline-attention">
          {attention.length === 1
            ? `${attention[0]!.label}: ${describeDue(attention[0]!.daysLeft, attention[0]!.status).toLowerCase()}.`
            : `${attention.length} deadlines need attention. The nearest is ${attention[0]!.label}, ${describeDue(attention[0]!.daysLeft, attention[0]!.status).toLowerCase()}.`}
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <HeroCard dashboard={dashboard} profile={profile} />
        <Overview dashboard={dashboard} profile={profile} />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <ShiftPanel capHours={dashboard.compliance.current.capHours} onChanged={refresh} />
        <div className="space-y-6">
          <AlertPanel alerts={dashboard.alerts} rate={dashboard.rate} homeCurrency={profile.homeCurrency} onChanged={refresh} />
          <DeadlinePanel deadlines={dashboard.deadlines} onChanged={refresh} />
        </div>
      </div>

      <PlanPanel profile={profile} rate={dashboard.rate} obligationsCount={dashboard.obligations.length} />

      <ObligationPanel obligations={dashboard.obligations} homeCurrency={profile.homeCurrency} onChanged={refresh} />
    </div>
  )
}
