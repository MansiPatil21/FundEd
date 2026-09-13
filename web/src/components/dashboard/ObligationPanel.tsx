'use client'

import { useState, type FormEvent } from 'react'
import { HandCoins, Plus, Trash2, X } from 'lucide-react'
import { api, ApiError, UnauthorizedError, signOut } from '@/lib/session'
import { CADENCES, cadenceLabel, formatDate, formatMoney, localNoonIso } from '@/lib/format'
import { isCalendarDate } from '@/store/budgetWizard'
import { MoneyInput } from '@/components/MoneyInput'
import { Amount, Button, Card, Field, Notice, Select, Spinner, TextInput } from '@/components/ui'
import type { DashboardObligation } from './types'

export function ObligationPanel({
  obligations,
  homeCurrency,
  onChanged,
}: {
  obligations: DashboardObligation[]
  homeCurrency: string
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [amountMinor, setAmountMinor] = useState(0)
  const [cadence, setCadence] = useState<string>('MONTHLY')
  const [nextDueOn, setNextDueOn] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const valid = label.trim().length > 0 && amountMinor > 0 && isCalendarDate(nextDueOn)

  const handle = (caught: unknown) => {
    if (caught instanceof UnauthorizedError) {
      signOut()
      return
    }
    setError(caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.')
  }

  const add = async (event: FormEvent) => {
    event.preventDefault()
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/obligations', {
        method: 'POST',
        body: { label: label.trim(), amountMinor, currency: homeCurrency, cadence, nextDueOn: localNoonIso(nextDueOn) },
      })
      setLabel('')
      setAmountMinor(0)
      setNextDueOn('')
      setOpen(false)
      onChanged()
    } catch (caught) {
      handle(caught)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setError(null)
    try {
      await api(`/api/obligations/${id}`, { method: 'DELETE' })
      onChanged()
    } catch (caught) {
      handle(caught)
    }
  }

  return (
    <Card
      title="Money you send home"
      description={`Commitments in ${homeCurrency}`}
      testId="obligations"
      padded={false}
      action={
        <Button variant="soft" data-testid="toggle-obligation-form" onClick={() => setOpen((value) => !value)}>
          {open ? <X /> : <Plus />}
          {open ? 'Close' : 'Add'}
        </Button>
      }
    >
      {open && (
        <form onSubmit={add} className="grid gap-4 px-6 pt-5 sm:grid-cols-4 sm:px-7" data-testid="obligation-form">
          <Field label="What is it for?" htmlFor="new-obligation-label">
            <TextInput
              id="new-obligation-label"
              data-testid="new-obligation-label"
              placeholder="Family support"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>
          <Field label={`Amount (${homeCurrency})`} htmlFor="new-obligation-amount">
            <MoneyInput
              id="new-obligation-amount"
              testId="new-obligation-amount"
              prefix={homeCurrency}
              valueMinor={amountMinor}
              onChange={setAmountMinor}
            />
          </Field>
          <Field label="How often" htmlFor="new-obligation-cadence">
            <Select id="new-obligation-cadence" value={cadence} onChange={(event) => setCadence(event.target.value)}>
              {CADENCES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Next due" htmlFor="new-obligation-due">
            <TextInput
              id="new-obligation-due"
              data-testid="new-obligation-due"
              type="date"
              value={nextDueOn}
              onChange={(event) => setNextDueOn(event.target.value)}
            />
          </Field>
          <div className="sm:col-span-4">
            <Button type="submit" data-testid="save-obligation" disabled={!valid || busy}>
              {busy && <Spinner />}
              Save commitment
            </Button>
          </div>
        </form>
      )}

      {error && (
        <div className="px-6 pt-4 sm:px-7">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}

      <div className="p-6 sm:p-7 sm:pt-5">
        {obligations.length === 0 ? (
          <p className="rounded-3xl bg-tile px-5 py-8 text-center text-sm text-black/45">Nothing recorded yet.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="obligation-rows">
            {obligations.map((obligation) => (
              <li key={obligation.id} className="flex min-h-44 flex-col rounded-3xl bg-tile p-5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] leading-snug text-black/55">{obligation.label}</p>
                  <HandCoins className="size-[18px] text-black/35" />
                </div>
                <p className="mt-auto pt-6 text-2xl font-semibold tabular-nums tracking-tight text-ink">
                  <Amount value={formatMoney(obligation.amountMinor, obligation.currency)} />
                </p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-xs text-black/45">
                    {cadenceLabel(obligation.cadence)} · next {formatDate(obligation.nextDueOn)}
                  </p>
                  <button
                    onClick={() => void remove(obligation.id)}
                    aria-label={`Delete ${obligation.label}`}
                    title="Delete"
                    className="grid size-8 shrink-0 place-items-center rounded-full text-black/30 transition hover:bg-white hover:text-red-600"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}
