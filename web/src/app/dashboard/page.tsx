'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useQuery } from '@apollo/client/react'
import { GraduationCap } from 'lucide-react'
import { DASHBOARD } from '@/lib/queries'
import { useRequireProfile } from '@/lib/useProfile'
import { api, ApiError, UnauthorizedError, chosenName, signOut, type Profile } from '@/lib/session'
import { useFxAlerts } from '@/lib/useFxAlerts'
import { AppShell } from '@/components/AppShell'
import { Button, Card, ErrorScreen, Field, Notice, PageLoader, Spinner, TextInput } from '@/components/ui'
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
  // A name saved from the dashboard applies at once, to the greeting and the header chip,
  // without reloading the profile and flashing the whole page back to a spinner.
  const [savedName, setSavedName] = useState<string | null>(null)

  if (state.status === 'loading') return <PageLoader label="Loading your dashboard…" />
  if (state.status === 'error') return <ErrorScreen message={state.message} onRetry={() => void reload()} />

  const profile = savedName ? { ...state.profile, displayName: savedName } : state.profile
  return (
    <AppShell profile={profile}>
      <Dashboard profile={profile} onNameSaved={setSavedName} />
    </AppShell>
  )
}

function Dashboard({ profile, onNameSaved }: { profile: Profile; onNameSaved: (name: string) => void }) {
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

  // A pushed alert means an alert row just changed on the server. Refetching turns its badge
  // to Fired and updates the notification bell, which reads this same cached query.
  useEffect(() => {
    if (live.length > 0) void refetch()
  }, [live, refetch])

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
  const name = chosenName(profile)
  const firstName = name.split(/\s+/)[0]
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
          <h1 className="text-5xl font-medium tracking-display text-ink" data-testid="greeting">
            {firstName ? `Hello, ${firstName}` : 'Hello there'}
          </h1>
        </div>
        {profile.permit && (
          <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm text-black/60 shadow-sm ring-1 ring-black/5">
            <GraduationCap className="size-4" />
            {profile.permit.institution}
          </span>
        )}
      </div>

      {!name && <NamePrompt onSaved={onNameSaved} />}

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

/** Shown only to an account with no chosen name, typically one created before setup asked for it. */
function NamePrompt({ onSaved }: { onSaved: (name: string) => void }) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = value.trim()

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!trimmed) return
    setSaving(true)
    setError(null)
    try {
      await api<Profile>('/api/me', { method: 'PATCH', body: { displayName: trimmed } })
      onSaved(trimmed)
    } catch (caught) {
      if (caught instanceof UnauthorizedError) {
        signOut()
        return
      }
      setError(caught instanceof ApiError ? caught.message : 'Could not save your name. Try again.')
      setSaving(false)
    }
  }

  return (
    <Card title="What should we call you?" description="We use it to greet you, instead of your email address" testId="name-prompt">
      <form onSubmit={save} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field label="Your name" htmlFor="name-prompt-input">
            <TextInput
              id="name-prompt-input"
              data-testid="name-prompt-input"
              autoComplete="given-name"
              maxLength={120}
              placeholder="Your first name"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </Field>
        </div>
        <Button type="submit" data-testid="name-prompt-save" disabled={!trimmed || saving} className="sm:w-auto">
          {saving ? <Spinner /> : null}
          Save
        </Button>
      </form>
      {error && (
        <div className="mt-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
    </Card>
  )
}
