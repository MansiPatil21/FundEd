'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Check, HandCoins, Plus, Trash2 } from 'lucide-react'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import {
  STEPS,
  STEP_TITLES,
  addObligation,
  back,
  canSubmit,
  hydrate,
  monthlyObligationsMinor,
  next,
  obligationDraftIsValid,
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
  type Cadence,
  type ObligationDraft,
} from '@/store/budgetWizard'
import { useRequireProfile } from '@/lib/useProfile'
import { api, ApiError, UnauthorizedError, chosenName, signOut, type Profile } from '@/lib/session'
import { CADENCES, CURRENCIES, cadenceLabel, formatDate, formatMoney, localNoonIso, toDateInput } from '@/lib/format'
import { MoneyInput } from '@/components/MoneyInput'
import { Amount, Button, Card, ErrorScreen, Field, Logo, Notice, PageLoader, Select, Spinner, TextInput } from '@/components/ui'

export default function OnboardingPage() {
  const router = useRouter()
  const { state, reload } = useRequireProfile({ requireOnboarded: false })

  useEffect(() => {
    if (state.status === 'ready' && state.profile.onboarded) router.replace('/dashboard')
  }, [state, router])

  if (state.status === 'loading') return <PageLoader label="Loading your account…" />
  if (state.status === 'error') return <ErrorScreen message={state.message} onRetry={() => void reload()} />
  if (state.profile.onboarded) return <PageLoader label="Taking you to your dashboard…" />
  return <Setup profile={state.profile} />
}

function Setup({ profile }: { profile: Profile }) {
  const router = useRouter()
  const dispatch = useAppDispatch()
  const wizard = useAppSelector((s) => s.budgetWizard)
  const index = STEPS.indexOf(wizard.step)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const postedObligations = useRef(0)
  const hydrated = useRef(false)

  // Prefill once from the account, so anything the server already holds is not asked for again.
  useEffect(() => {
    if (hydrated.current) return
    hydrated.current = true
    dispatch(
      hydrate({
        // Empty for a new account, so the name field asks rather than suggesting the email.
        displayName: chosenName(profile),
        homeCurrency: profile.homeCurrency,
        institution: profile.permit?.institution ?? '',
        programEndsOn: toDateInput(profile.permit?.programEndsOn),
        permitExpiresOn: toDateInput(profile.permit?.expiresOn),
        ...(profile.permit ? { weeklyHourCap: profile.permit.weeklyHourCap } : {}),
        ...(profile.budget ?? {}),
      }),
    )
  }, [dispatch, profile])

  const finish = async () => {
    if (!canSubmit(wizard)) return
    setSaving(true)
    setError(null)
    try {
      await api<Profile>('/api/me', {
        method: 'PATCH',
        body: {
          displayName: wizard.displayName.trim(),
          homeCurrency: wizard.homeCurrency,
          permit: {
            institution: wizard.institution.trim(),
            programEndsOn: localNoonIso(wizard.programEndsOn),
            expiresOn: localNoonIso(wizard.permitExpiresOn),
            weeklyHourCap: wizard.weeklyHourCap,
          },
          budget: {
            monthlyIncomeMinor: wizard.monthlyIncomeMinor,
            monthlySpendingMinor: wizard.monthlySpendingMinor,
            minimumBufferMinor: wizard.minimumBufferMinor,
          },
        },
      })

      // Counted across attempts: if the connection drops after two of three commitments were
      // saved, a retry sends only the third rather than duplicating the first two.
      for (const obligation of wizard.obligations.slice(postedObligations.current)) {
        await api('/api/obligations', {
          method: 'POST',
          body: { ...obligation, nextDueOn: localNoonIso(obligation.nextDueOn) },
        })
        postedObligations.current += 1
      }

      await api<Profile>('/api/me', { method: 'PATCH', body: { completeOnboarding: true } })
      dispatch(submitted())
      router.replace('/dashboard')
    } catch (caught) {
      if (caught instanceof UnauthorizedError) {
        router.replace('/login')
        return
      }
      setError(caught instanceof ApiError ? caught.message : 'Could not save your setup. Try again.')
      setSaving(false)
    }
  }

  const current = STEP_TITLES[wizard.step]

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex h-20 max-w-6xl items-center justify-between px-6">
        <Logo />
        <div className="flex items-center gap-3 text-sm text-black/50">
          <span className="hidden sm:inline">{profile.email}</span>
          <button
            onClick={signOut}
            className="rounded-full bg-white px-4 py-2 text-ink shadow-sm ring-1 ring-black/5 transition hover:ring-black/15"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-6 pb-16 lg:grid-cols-[300px_1fr]">
        <aside className="h-fit rounded-[32px] bg-sage-gradient p-6 text-white lg:sticky lg:top-6">
          <p className="text-sm text-white/70">Set up your account</p>
          <p className="mt-2 text-5xl font-medium tabular-nums tracking-display">
            {index + 1}
            <span className="text-white/45"> / {STEPS.length}</span>
          </p>
          <ol className="mt-8 space-y-1.5" aria-label="Setup progress">
            {STEPS.map((step, position) => {
              const status = position === index ? 'current' : position < index ? 'done' : 'upcoming'
              return (
                <li
                  key={step}
                  data-testid={`step-${step}`}
                  data-state={status}
                  className={`flex items-start gap-3 rounded-2xl px-3 py-3 transition ${status === 'current' ? 'bg-white/20' : ''}`}
                >
                  <span
                    className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                      status === 'done' ? 'bg-white text-sage-700' : status === 'current' ? 'bg-ink text-white' : 'bg-white/15 text-white/70'
                    }`}
                  >
                    {status === 'done' ? <Check className="size-4" strokeWidth={2.5} /> : position + 1}
                  </span>
                  <span>
                    <span className={`block text-sm font-medium ${status === 'upcoming' ? 'text-white/60' : 'text-white'}`}>
                      {STEP_TITLES[step].title}
                    </span>
                    <span className="block text-xs text-white/60">{STEP_TITLES[step].description}</span>
                  </span>
                </li>
              )
            })}
          </ol>
        </aside>

        <section className="space-y-6" data-testid="onboarding">
          <div className="pt-1">
            <p className="text-sm text-black/45">
              Step {index + 1} of {STEPS.length}
            </p>
            <h1 className="mt-1 text-4xl font-medium tracking-display text-ink sm:text-5xl">{current.title}</h1>
            <p className="mt-2 text-sm text-black/50">{current.description}</p>
          </div>

          <Card>
            {wizard.step === 'profile' && <ProfileStep />}
            {wizard.step === 'income' && <IncomeStep />}
            {wizard.step === 'obligations' && <ObligationsStep />}
            {wizard.step === 'buffer' && <BufferStep />}
          </Card>

          {error && (
            <Notice tone="danger" testId="setup-error">
              {error}
            </Notice>
          )}

          <footer className="flex items-center justify-between">
            <Button variant="secondary" data-testid="back" onClick={() => dispatch(back())} disabled={index === 0 || saving}>
              <ArrowLeft /> Back
            </Button>
            {index < STEPS.length - 1 ? (
              <Button data-testid="next" onClick={() => dispatch(next())} disabled={!stepIsComplete(wizard, wizard.step)} className="px-6">
                Continue <ArrowRight />
              </Button>
            ) : (
              <Button data-testid="finish" onClick={() => void finish()} disabled={!canSubmit(wizard) || saving} className="px-6">
                {saving ? (
                  <>
                    <Spinner /> Saving…
                  </>
                ) : (
                  <>
                    Finish setup <Check />
                  </>
                )}
              </Button>
            )}
          </footer>
        </section>
      </main>
    </div>
  )
}

function ProfileStep() {
  const dispatch = useAppDispatch()
  const w = useAppSelector((s) => s.budgetWizard)
  const knownCurrency = CURRENCIES.some((currency) => currency.code === w.homeCurrency)

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="What should we call you?" htmlFor="displayName">
          <TextInput
            id="displayName"
            data-testid="display-name"
            autoComplete="name"
            placeholder="First and last name"
            value={w.displayName}
            onChange={(event) => dispatch(setDisplayName(event.target.value))}
          />
        </Field>
      </div>
      <Field label="Home currency" htmlFor="homeCurrency" hint="The currency you send money home in">
        <Select
          id="homeCurrency"
          data-testid="home-currency"
          value={knownCurrency ? w.homeCurrency : ''}
          onChange={(event) => dispatch(setHomeCurrency(event.target.value))}
        >
          <option value="" disabled>
            Choose a currency
          </option>
          {CURRENCIES.map((currency) => (
            <option key={currency.code} value={currency.code}>
              {currency.code} · {currency.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Weekly off-campus hour cap"
        htmlFor="weeklyHourCap"
        hint="Use the limit in your permit conditions. The rules change, so confirm with IRCC."
      >
        <TextInput
          id="weeklyHourCap"
          data-testid="weekly-cap"
          type="number"
          min={1}
          max={168}
          value={w.weeklyHourCap || ''}
          onChange={(event) => dispatch(setWeeklyHourCap(Number(event.target.value)))}
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Institution" htmlFor="institution">
          <TextInput
            id="institution"
            data-testid="institution"
            placeholder="Dalhousie University"
            value={w.institution}
            onChange={(event) => dispatch(setInstitution(event.target.value))}
          />
        </Field>
      </div>
      <Field label="Program end date" htmlFor="programEndsOn">
        <TextInput
          id="programEndsOn"
          data-testid="program-ends"
          type="date"
          value={w.programEndsOn}
          onChange={(event) => dispatch(setProgramEndsOn(event.target.value))}
        />
      </Field>
      <Field label="Study permit expiry" htmlFor="permitExpiresOn" hint="Printed on your study permit">
        <TextInput
          id="permitExpiresOn"
          data-testid="permit-expires"
          type="date"
          value={w.permitExpiresOn}
          onChange={(event) => dispatch(setPermitExpiresOn(event.target.value))}
        />
      </Field>
      {permitEndsBeforeProgram(w) && (
        <div className="sm:col-span-2">
          <Notice tone="warning" testId="permit-warning">
            Your permit expires before your program ends. Plan to apply for an extension before it lapses.
          </Notice>
        </div>
      )}
    </div>
  )
}

function IncomeStep() {
  const dispatch = useAppDispatch()
  const w = useAppSelector((s) => s.budgetWizard)
  const surplus = surplusMinor(w)

  return (
    <div className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Monthly income" htmlFor="income" hint="Pay, allowances and anything else that arrives each month">
          <MoneyInput id="income" testId="income" valueMinor={w.monthlyIncomeMinor} onChange={(minor) => dispatch(setIncome(minor))} />
        </Field>
        <Field label="Monthly living costs" htmlFor="spending" hint="Rent, groceries, transit, phone">
          <MoneyInput id="spending" testId="spending" valueMinor={w.monthlySpendingMinor} onChange={(minor) => dispatch(setSpending(minor))} />
        </Field>
      </div>
      <div
        data-testid="surplus"
        className={`flex flex-wrap items-baseline justify-between gap-3 rounded-3xl px-6 py-5 ${
          surplus < 0 ? 'bg-red-50 text-red-700' : 'bg-sage-gradient text-white'
        }`}
      >
        <span className="text-sm">{surplus < 0 ? 'You spend more than comes in each month' : 'Left over each month'}</span>
        <strong className="text-4xl font-medium tabular-nums tracking-display">
          <Amount value={formatMoney(Math.abs(surplus), 'CAD')} fadedClassName="opacity-50" />
        </strong>
      </div>
    </div>
  )
}

const blankDraft = (currency: string): ObligationDraft => ({
  label: '',
  amountMinor: 0,
  currency,
  cadence: 'MONTHLY',
  nextDueOn: '',
})

function ObligationsStep() {
  const dispatch = useAppDispatch()
  const w = useAppSelector((s) => s.budgetWizard)
  const [draft, setDraft] = useState<ObligationDraft>(() => blankDraft(w.homeCurrency))
  const candidate = { ...draft, currency: w.homeCurrency }
  const valid = obligationDraftIsValid(candidate)

  const add = (event: FormEvent) => {
    event.preventDefault()
    if (!valid) return
    dispatch(addObligation(candidate))
    setDraft(blankDraft(w.homeCurrency))
  }

  return (
    <div className="space-y-6">
      <form onSubmit={add} className="grid gap-4 sm:grid-cols-2" data-testid="obligation-form">
        <Field label="What is it for?" htmlFor="obligation-label">
          <TextInput
            id="obligation-label"
            data-testid="obligation-label"
            placeholder="Family support"
            value={draft.label}
            onChange={(event) => setDraft({ ...draft, label: event.target.value })}
          />
        </Field>
        <Field label={`Amount (${w.homeCurrency})`} htmlFor="obligation-amount">
          <MoneyInput
            id="obligation-amount"
            testId="obligation-amount"
            prefix={w.homeCurrency}
            valueMinor={draft.amountMinor}
            onChange={(minor) => setDraft({ ...draft, amountMinor: minor })}
          />
        </Field>
        <Field label="How often" htmlFor="obligation-cadence">
          <Select
            id="obligation-cadence"
            data-testid="obligation-cadence"
            value={draft.cadence}
            onChange={(event) => setDraft({ ...draft, cadence: event.target.value as Cadence })}
          >
            {CADENCES.map((cadence) => (
              <option key={cadence.value} value={cadence.value}>
                {cadence.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Next due" htmlFor="obligation-due">
          <TextInput
            id="obligation-due"
            data-testid="obligation-due"
            type="date"
            value={draft.nextDueOn}
            onChange={(event) => setDraft({ ...draft, nextDueOn: event.target.value })}
          />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" variant="soft" data-testid="add-obligation" disabled={!valid}>
            <Plus /> Add commitment
          </Button>
        </div>
      </form>

      {w.obligations.length === 0 ? (
        <p className="rounded-3xl bg-tile px-5 py-8 text-center text-sm text-black/45">
          Add at least one commitment, such as money you send to family each month.
        </p>
      ) : (
        <div className="space-y-3">
          <ul data-testid="obligation-list" className="grid gap-3 sm:grid-cols-2">
            {w.obligations.map((obligation, position) => (
              <li key={`${obligation.label}-${position}`} className="flex min-h-36 flex-col rounded-3xl bg-tile p-5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] text-black/55">{obligation.label}</p>
                  <HandCoins className="size-[18px] text-black/35" />
                </div>
                <p className="mt-auto pt-5 text-2xl font-semibold tabular-nums tracking-tight text-ink">
                  <Amount value={formatMoney(obligation.amountMinor, obligation.currency)} />
                </p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-xs text-black/45">
                    {cadenceLabel(obligation.cadence)} · next {formatDate(obligation.nextDueOn)}
                  </p>
                  <button
                    onClick={() => dispatch(removeObligation(position))}
                    aria-label="Remove"
                    className="grid size-8 place-items-center rounded-full text-black/35 transition hover:bg-white hover:text-red-600"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-sm text-black/55">
            About <strong className="text-ink">{formatMoney(Math.round(monthlyObligationsMinor(w)), w.homeCurrency)}</strong> a month on
            average
          </p>
        </div>
      )}
    </div>
  )
}

function BufferStep() {
  const dispatch = useAppDispatch()
  const w = useAppSelector((s) => s.budgetWizard)

  return (
    <div className="space-y-6">
      <Field label="Never let my Canadian balance fall below" htmlFor="buffer" hint="Transfers home are planned so your balance stays above this">
        <MoneyInput id="buffer" testId="buffer" valueMinor={w.minimumBufferMinor} onChange={(minor) => dispatch(setBuffer(minor))} />
      </Field>

      <div className="rounded-3xl bg-tile p-6">
        <h3 className="text-sm font-semibold text-ink">Review before you finish</h3>
        <dl className="mt-3 grid gap-x-8 text-sm sm:grid-cols-2" data-testid="review">
          <ReviewRow label="Name" value={w.displayName} />
          <ReviewRow label="Institution" value={w.institution} />
          <ReviewRow label="Permit expires" value={formatDate(w.permitExpiresOn)} />
          <ReviewRow label="Weekly hour cap" value={`${w.weeklyHourCap} hours`} />
          <ReviewRow label="Monthly income" value={formatMoney(w.monthlyIncomeMinor, 'CAD')} />
          <ReviewRow label="Left over each month" value={formatMoney(surplusMinor(w), 'CAD')} />
          <ReviewRow label="Commitments" value={String(w.obligations.length)} />
          <ReviewRow label="Sent home monthly" value={formatMoney(Math.round(monthlyObligationsMinor(w)), w.homeCurrency)} />
        </dl>
      </div>
    </div>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-black/5 py-2.5">
      <dt className="text-black/50">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  )
}
