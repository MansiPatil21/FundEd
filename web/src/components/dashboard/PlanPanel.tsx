'use client'

import { useState, type FormEvent } from 'react'
import { Send, ShieldCheck, Sparkles } from 'lucide-react'
import { api, ApiError, UnauthorizedError, signOut, type Profile } from '@/lib/session'
import { formatDate, formatMoney } from '@/lib/format'
import { buildPlanBody, type PlanForm, type PlanResult, type SavingResult } from '@/lib/plan'
import { MoneyInput } from '@/components/MoneyInput'
import { Amount, Badge, Button, Card, Field, IconCircle, Notice, Segmented, Spinner, TextInput, type SegmentOption } from '@/components/ui'
import type { DashboardRate } from './types'

type HorizonChoice = '90' | '180'

const HORIZONS: ReadonlyArray<SegmentOption<HorizonChoice>> = [
  { value: '90', label: '3 months' },
  { value: '180', label: '6 months' },
]

export function PlanPanel({
  profile,
  rate,
  obligationsCount,
}: {
  profile: Profile
  rate: DashboardRate | null
  obligationsCount: number
}) {
  const [horizon, setHorizon] = useState<HorizonChoice>('180')
  const [openingBalanceMinor, setOpeningBalance] = useState(0)
  const [fixedFeeMinor, setFixedFee] = useState(399)
  const [variablePercent, setVariablePercent] = useState('0.50')
  const [assumedRate, setAssumedRate] = useState(rate ? rate.rate.toFixed(2) : '')
  const [plan, setPlan] = useState<{ key: string; result: PlanResult } | null>(null)
  const [saving, setSaving] = useState<{ key: string; result: SavingResult } | null>(null)
  const [savingNote, setSavingNote] = useState<string | null>(null)
  const [busy, setBusy] = useState<'plan' | 'saving' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const form: PlanForm = {
    horizonDays: horizon === '90' ? 90 : 180,
    openingBalanceMinor,
    fixedFeeMinor,
    variablePercent,
    assumedRate,
  }
  const body = buildPlanBody(profile.budget, form)
  // Results are tied to the exact inputs that produced them, so an edited form never sits
  // next to a schedule computed for different numbers.
  const key = body ? JSON.stringify(body) : ''
  const currentPlan = plan && plan.key === key ? plan.result : null
  const stale = plan !== null && plan.key !== key
  const currentSaving = saving && saving.key === key ? saving.result : null

  const handle = (caught: unknown) => {
    if (caught instanceof UnauthorizedError) {
      signOut()
      return
    }
    setError(caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.')
  }

  const build = async (event: FormEvent) => {
    event.preventDefault()
    if (!body) return
    setBusy('plan')
    setError(null)
    setSavingNote(null)
    try {
      const result = await api<PlanResult>('/api/plan', { method: 'POST', body })
      setPlan({ key, result })
    } catch (caught) {
      handle(caught)
    } finally {
      setBusy(null)
    }
  }

  const estimate = async () => {
    if (!body) return
    setBusy('saving')
    setSavingNote(null)
    try {
      const result = await api<SavingResult>('/api/plan/saving', { method: 'POST', body })
      setSaving({ key, result })
    } catch (caught) {
      // A 422 here is an explanation, such as too few observed rates, not a failure.
      if (caught instanceof ApiError && caught.status === 422) setSavingNote(caught.message)
      else handle(caught)
    } finally {
      setBusy(null)
    }
  }

  const months = form.horizonDays === 90 ? 3 : 6

  return (
    <Card
      id="plan"
      title="Plan transfers home"
      description="When and how much to send, so fees cost you as little as possible"
      testId="plan"
      padded={false}
    >
      <div className="px-6 pt-5 sm:px-7">
        {!profile.budget ? (
          <Notice tone="info" testId="plan-needs-budget">
            Add your monthly budget on your profile to plan transfers.
          </Notice>
        ) : obligationsCount === 0 ? (
          <Notice tone="info" testId="plan-needs-obligation">
            Add a commitment below first, so there is something to send home.
          </Notice>
        ) : (
          <form onSubmit={build} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" data-testid="plan-form">
            <Field label="Balance in your account today" htmlFor="plan-balance">
              <MoneyInput id="plan-balance" testId="plan-balance" valueMinor={openingBalanceMinor} onChange={setOpeningBalance} />
            </Field>
            <Field label="Flat fee per transfer" htmlFor="plan-fixed-fee">
              <MoneyInput id="plan-fixed-fee" testId="plan-fixed-fee" valueMinor={fixedFeeMinor} onChange={setFixedFee} />
            </Field>
            <Field label="Fee on the amount (%)" htmlFor="plan-variable-fee">
              <TextInput
                id="plan-variable-fee"
                data-testid="plan-variable-fee"
                inputMode="decimal"
                value={variablePercent}
                onChange={(event) => setVariablePercent(event.target.value)}
              />
            </Field>
            <Field label={`Rate to assume (${profile.homeCurrency})`} htmlFor="plan-rate" hint="Used for every day of the plan">
              <TextInput
                id="plan-rate"
                data-testid="plan-rate"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="61.84"
                value={assumedRate}
                onChange={(event) => setAssumedRate(event.target.value)}
              />
            </Field>
            <div className="space-y-1.5">
              <span className="block text-[13px] font-medium text-black/60">Plan ahead</span>
              <Segmented label="Plan horizon" options={HORIZONS} value={horizon} onChange={setHorizon} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2 lg:col-span-5">
              <p className="text-xs text-black/45">
                Uses your saved income, living costs and {formatMoney(profile.budget.minimumBufferMinor, 'CAD')} buffer.
              </p>
              <Button type="submit" data-testid="build-plan" disabled={!body || busy !== null}>
                {busy === 'plan' ? <Spinner /> : <Send />}
                Build my plan
              </Button>
            </div>
          </form>
        )}

        {error && (
          <div className="mt-4">
            <Notice tone="danger" testId="plan-error">
              {error}
            </Notice>
          </div>
        )}
        {stale && (
          <div className="mt-4">
            <Notice tone="info">Your inputs changed. Build the plan again to update it.</Notice>
          </div>
        )}
      </div>

      {currentPlan &&
        (currentPlan.transfers.length === 0 ? (
          <div className="px-6 pt-5 sm:px-7">
            <Notice tone="warning" testId="plan-infeasible">
              No schedule can cover these commitments with this balance and buffer. Try a higher starting balance, a smaller
              buffer, or a longer horizon.
            </Notice>
          </div>
        ) : (
          <div className="mt-6 grid gap-6 border-t border-black/5 px-6 pb-7 pt-6 sm:px-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="space-y-4">
              <div data-testid="plan-saving" className="rounded-3xl bg-sage-gradient p-6 text-white">
                {currentPlan.savingMinor !== null && currentPlan.baseline ? (
                  <>
                    <span className="inline-flex rounded-full bg-white/20 px-3 py-1 text-sm font-medium">
                      {currentPlan.savingMinor > 0 ? 'You would save' : 'Same cost as sending monthly'}
                    </span>
                    <p className="mt-4 text-5xl font-medium tabular-nums tracking-display">
                      <Amount value={formatMoney(Math.max(0, currentPlan.savingMinor), 'CAD')} fadedClassName="text-white/45" />
                    </p>
                    <p className="mt-2 text-sm text-white/80">
                      {currentPlan.transfers.length} {currentPlan.transfers.length === 1 ? 'transfer' : 'transfers'} instead of{' '}
                      {currentPlan.baseline.transfers} monthly, over the next {months} months
                    </p>
                  </>
                ) : (
                  <>
                    <span className="inline-flex rounded-full bg-white/20 px-3 py-1 text-sm font-medium">Plan ready</span>
                    <p className="mt-3 text-sm text-white/85">The comparison with monthly transfers is unavailable right now.</p>
                  </>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Total label="Sent" value={formatMoney(currentPlan.totalSentMinor, 'CAD')} />
                <Total
                  label="Fees"
                  value={formatMoney(currentPlan.totalFeesMinor, 'CAD')}
                  note={currentPlan.baseline ? `vs ${formatMoney(currentPlan.baseline.totalFeesMinor, 'CAD')}` : undefined}
                />
                <Total label="Balance after" value={formatMoney(currentPlan.closingBalanceMinor, 'CAD')} />
              </div>

              <div className="rounded-3xl bg-ink p-5 text-white" data-testid="uncertainty">
                <div className="flex items-start gap-3">
                  <IconCircle tone="glass">
                    <Sparkles />
                  </IconCircle>
                  <div>
                    <p className="font-semibold">What if rates move?</p>
                    <p className="mt-1 text-sm text-white/60">
                      Replays the plan across 40 simulated rate paths built from the rates FundEd has observed. Can take up to half a minute.
                    </p>
                  </div>
                </div>

                {currentSaving ? (
                  <div className="mt-5" data-testid="uncertainty-result">
                    <p className="text-sm text-white/60">Timing could be worth up to</p>
                    <p className="mt-1 text-4xl font-medium tabular-nums tracking-display">
                      <Amount value={formatMoney(currentSaving.meanSavingMinor, 'CAD')} fadedClassName="text-white/45" />
                    </p>
                    <p className="mt-1 text-sm text-white/70">
                      {Math.round(currentSaving.confidence * 100)}% interval: {formatMoney(currentSaving.ciLowMinor, 'CAD')} to{' '}
                      {formatMoney(currentSaving.ciHighMinor, 'CAD')}
                    </p>
                    <div className="mt-3">
                      {currentSaving.significant ? (
                        <Badge tone="success">
                          <ShieldCheck className="size-3.5" /> Holds up across rate swings
                        </Badge>
                      ) : (
                        <span className="text-xs text-white/60">Not clearly different from zero</span>
                      )}
                    </div>
                    <p className="mt-3 text-xs text-white/45">
                      Based on {currentSaving.historyUsed} observed rates. {currentSaving.caveat}
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    <button
                      type="button"
                      data-testid="estimate-saving"
                      onClick={() => void estimate()}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-ink transition hover:bg-white/90 disabled:opacity-50"
                    >
                      {busy === 'saving' && <Spinner />}
                      {busy === 'saving' ? 'Running 40 simulated rate paths…' : 'Estimate with rate swings'}
                    </button>
                    {savingNote && (
                      <p className="text-sm text-white/70" data-testid="uncertainty-note">
                        {savingNote}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-ink">Suggested schedule</h3>
              <ul className="mt-3 space-y-2" data-testid="plan-transfers">
                {currentPlan.transfers.map((transfer) => (
                  <li key={transfer.sendOn} className="flex items-center gap-4 rounded-2xl bg-tile px-4 py-3">
                    <IconCircle tone="white">
                      <Send />
                    </IconCircle>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink">Send on {formatDate(transfer.sendOn)}</p>
                      <p className="text-sm text-black/45">
                        Fee {formatMoney(transfer.feeMinor, 'CAD')} · about {formatMoney(transfer.receivedHomeMinor, profile.homeCurrency)}{' '}
                        arrives
                      </p>
                    </div>
                    <span className="text-lg font-semibold tabular-nums tracking-tight text-ink">
                      <Amount value={formatMoney(transfer.amountMinor, 'CAD')} />
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs leading-relaxed text-black/45">
                Covers {currentPlan.obligationsPlanned} {currentPlan.obligationsPlanned === 1 ? 'payment' : 'payments'} due by{' '}
                {formatDate(currentPlan.horizon.to)}. {currentPlan.caveat}
              </p>
            </div>
          </div>
        ))}
    </Card>
  )
}

function Total({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <div className="rounded-2xl bg-tile p-4">
      <p className="text-xs text-black/50">{label}</p>
      <p className="mt-1 text-base font-semibold tabular-nums tracking-tight text-ink">
        <Amount value={value} />
      </p>
      {note && <p className="text-xs text-black/40">{note}</p>}
    </div>
  )
}
