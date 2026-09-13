'use client'

import { useState, type FormEvent } from 'react'
import { CalendarClock, Check, GraduationCap } from 'lucide-react'
import { useRequireProfile } from '@/lib/useProfile'
import { api, ApiError, UnauthorizedError, signOut, type Profile } from '@/lib/session'
import { CURRENCIES, formatDate, formatMoney, localNoonIso, toDateInput } from '@/lib/format'
import { isCalendarDate } from '@/store/budgetWizard'
import { AppShell } from '@/components/AppShell'
import { MoneyInput } from '@/components/MoneyInput'
import { Amount, Button, Card, ErrorScreen, Field, Notice, PageLoader, Select, Spinner, TextInput } from '@/components/ui'

export default function ProfilePage() {
  const { state, reload, setProfile } = useRequireProfile({ requireOnboarded: true })

  if (state.status === 'loading') return <PageLoader label="Loading your profile…" />
  if (state.status === 'error') return <ErrorScreen message={state.message} onRetry={() => void reload()} />

  return (
    <AppShell profile={state.profile}>
      <ProfileForm profile={state.profile} onSaved={setProfile} />
    </AppShell>
  )
}

function ProfileForm({ profile, onSaved }: { profile: Profile; onSaved: (profile: Profile) => void }) {
  const [displayName, setDisplayName] = useState(profile.displayName)
  const [homeCurrency, setHomeCurrency] = useState(profile.homeCurrency)
  const [institution, setInstitution] = useState(profile.permit?.institution ?? '')
  const [programEndsOn, setProgramEndsOn] = useState(toDateInput(profile.permit?.programEndsOn))
  const [expiresOn, setExpiresOn] = useState(toDateInput(profile.permit?.expiresOn))
  const [weeklyHourCap, setWeeklyHourCap] = useState(profile.permit?.weeklyHourCap ?? 24)
  const [permitNumber, setPermitNumber] = useState(profile.permit?.permitNumber ?? '')
  const [income, setIncome] = useState(profile.budget?.monthlyIncomeMinor ?? 0)
  const [spending, setSpending] = useState(profile.budget?.monthlySpendingMinor ?? 0)
  const [buffer, setBuffer] = useState(profile.budget?.minimumBufferMinor ?? 0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Any edit clears the "saved" confirmation, so it never describes stale values.
  const edit =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value)
      setSaved(false)
    }

  const problem = !displayName.trim()
    ? 'Enter your name'
    : !institution.trim()
      ? 'Enter your institution'
      : !isCalendarDate(programEndsOn) || !isCalendarDate(expiresOn)
        ? 'Enter both permit dates'
        : !(weeklyHourCap >= 1 && weeklyHourCap <= 168)
          ? 'The weekly cap must be between 1 and 168 hours'
          : null

  const initials = profile.displayName
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (problem) return
    setBusy(true)
    setError(null)
    try {
      const updated = await api<Profile>('/api/me', {
        method: 'PATCH',
        body: {
          displayName: displayName.trim(),
          homeCurrency,
          permit: {
            institution: institution.trim(),
            programEndsOn: localNoonIso(programEndsOn),
            expiresOn: localNoonIso(expiresOn),
            weeklyHourCap,
            ...(permitNumber.trim() ? { permitNumber: permitNumber.trim() } : {}),
          },
          budget: { monthlyIncomeMinor: income, monthlySpendingMinor: spending, minimumBufferMinor: buffer },
        },
      })
      onSaved(updated)
      setSaved(true)
    } catch (caught) {
      if (caught instanceof UnauthorizedError) {
        signOut()
        return
      }
      setError(caught instanceof ApiError ? caught.message : 'Could not save your profile. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="mx-auto max-w-4xl space-y-6" data-testid="profile-form">
      <section className="flex flex-wrap items-center gap-6 rounded-[32px] bg-sage-gradient p-7 text-white sm:p-8">
        <span className="grid size-20 place-items-center rounded-full bg-white/25 text-2xl font-semibold ring-4 ring-white/15">
          {initials || '?'}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-4xl font-medium tracking-display sm:text-5xl">{profile.displayName}</h1>
          <p className="mt-1 text-sm text-white/75">{profile.email}</p>
        </div>
        {profile.permit && (
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/20 px-4 py-2 text-sm">
              <GraduationCap className="size-4" /> {profile.permit.institution}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm">
              <CalendarClock className="size-4" /> Permit to {formatDate(profile.permit.expiresOn)}
            </span>
          </div>
        )}
      </section>

      <Card title="Personal details">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Full name" htmlFor="profile-name">
            <TextInput id="profile-name" data-testid="profile-name" value={displayName} onChange={(event) => edit(setDisplayName)(event.target.value)} />
          </Field>
          <Field label="Email" htmlFor="profile-email" hint="Used to sign in">
            <TextInput id="profile-email" value={profile.email} disabled />
          </Field>
          <Field label="Home currency" htmlFor="profile-currency">
            <Select id="profile-currency" value={homeCurrency} onChange={(event) => edit(setHomeCurrency)(event.target.value)}>
              {!CURRENCIES.some((currency) => currency.code === homeCurrency) && <option value={homeCurrency}>{homeCurrency}</option>}
              {CURRENCIES.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code} · {currency.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card title="Study permit" description="Your weekly hour cap comes from here">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Institution" htmlFor="profile-institution">
              <TextInput
                id="profile-institution"
                data-testid="profile-institution"
                value={institution}
                onChange={(event) => edit(setInstitution)(event.target.value)}
              />
            </Field>
          </div>
          <Field label="Program end date" htmlFor="profile-program-ends">
            <TextInput id="profile-program-ends" type="date" value={programEndsOn} onChange={(event) => edit(setProgramEndsOn)(event.target.value)} />
          </Field>
          <Field label="Permit expiry" htmlFor="profile-permit-expires">
            <TextInput id="profile-permit-expires" type="date" value={expiresOn} onChange={(event) => edit(setExpiresOn)(event.target.value)} />
          </Field>
          <Field label="Weekly off-campus hour cap" htmlFor="profile-cap">
            <TextInput
              id="profile-cap"
              data-testid="profile-cap"
              type="number"
              min={1}
              max={168}
              value={weeklyHourCap || ''}
              onChange={(event) => edit(setWeeklyHourCap)(Number(event.target.value))}
            />
          </Field>
          <Field label="Permit number" htmlFor="profile-permit-number" hint="Optional">
            <TextInput id="profile-permit-number" value={permitNumber} onChange={(event) => edit(setPermitNumber)(event.target.value)} />
          </Field>
        </div>
      </Card>

      <Card title="Monthly budget" description="In Canadian dollars">
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Income" htmlFor="profile-income">
            <MoneyInput id="profile-income" testId="profile-income" valueMinor={income} onChange={edit(setIncome)} />
          </Field>
          <Field label="Living costs" htmlFor="profile-spending">
            <MoneyInput id="profile-spending" valueMinor={spending} onChange={edit(setSpending)} />
          </Field>
          <Field label="Minimum buffer" htmlFor="profile-buffer">
            <MoneyInput id="profile-buffer" valueMinor={buffer} onChange={edit(setBuffer)} />
          </Field>
        </div>
        <div className="mt-5 flex flex-wrap items-baseline justify-between gap-3 rounded-3xl bg-tile px-6 py-4">
          <span className="text-sm text-black/55">Left over each month</span>
          <strong className={`text-3xl font-medium tabular-nums tracking-display ${income - spending < 0 ? 'text-red-600' : 'text-ink'}`}>
            <Amount value={formatMoney(income - spending, 'CAD')} />
          </strong>
        </div>
      </Card>

      {error && (
        <Notice tone="danger" testId="profile-error">
          {error}
        </Notice>
      )}

      <div className="flex flex-wrap items-center justify-end gap-4">
        {problem && <p className="text-sm text-black/50">{problem}</p>}
        {saved && !problem && (
          <p className="inline-flex items-center gap-1.5 text-sm font-medium text-sage-700" data-testid="profile-saved">
            <Check className="size-4" /> Profile saved
          </p>
        )}
        <Button type="submit" data-testid="save-profile" disabled={busy || Boolean(problem)} className="px-6">
          {busy && <Spinner />}
          Save changes
        </Button>
      </div>
    </form>
  )
}
