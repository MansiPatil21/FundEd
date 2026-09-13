'use client'

import { useState, type FormEvent } from 'react'
import { Bell, CalendarClock, Check, GraduationCap, PiggyBank, Plus, ShieldCheck, Trash2, X } from 'lucide-react'
import { api, ApiError, UnauthorizedError, signOut } from '@/lib/session'
import { formatDate, localNoonIso } from '@/lib/format'
import { isCalendarDate } from '@/store/budgetWizard'
import { Badge, Button, Card, Field, IconCircle, Notice, Select, Spinner, TextInput } from '@/components/ui'
import type { DashboardDeadline, DeadlineKind } from './types'

export const KINDS: ReadonlyArray<{ value: DeadlineKind; label: string; icon: typeof Bell }> = [
  { value: 'TUITION', label: 'Tuition', icon: GraduationCap },
  { value: 'GIC_RELEASE', label: 'GIC release', icon: PiggyBank },
  { value: 'PERMIT_EXPIRY', label: 'Permit expiry', icon: ShieldCheck },
  { value: 'TAX_FILING', label: 'Tax filing', icon: CalendarClock },
  { value: 'OTHER', label: 'Other', icon: Bell },
]

/** "Due today", "In 3 days", "2 days overdue", "Done". */
export function describeDue(daysLeft: number, status: DashboardDeadline['status']): string {
  if (status === 'DONE') return 'Done'
  if (daysLeft === 0) return 'Due today'
  if (daysLeft === 1) return 'Due tomorrow'
  if (daysLeft > 1) return `In ${daysLeft} days`
  return daysLeft === -1 ? '1 day overdue' : `${-daysLeft} days overdue`
}

export function DeadlinePanel({ deadlines, onChanged }: { deadlines: DashboardDeadline[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<DeadlineKind>('TUITION')
  const [dueOn, setDueOn] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const valid = label.trim().length > 0 && isCalendarDate(dueOn)

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
      await api('/api/deadlines', { method: 'POST', body: { label: label.trim(), kind, dueOn: localNoonIso(dueOn) } })
      setLabel('')
      setDueOn('')
      setOpen(false)
      onChanged()
    } catch (caught) {
      handle(caught)
    } finally {
      setBusy(false)
    }
  }

  const setCompleted = async (id: string, completed: boolean) => {
    setError(null)
    try {
      await api(`/api/deadlines/${id}`, { method: 'PATCH', body: { completed } })
      onChanged()
    } catch (caught) {
      handle(caught)
    }
  }

  const remove = async (id: string) => {
    setError(null)
    try {
      await api(`/api/deadlines/${id}`, { method: 'DELETE' })
      onChanged()
    } catch (caught) {
      handle(caught)
    }
  }

  // Open deadlines first, soonest at the top; finished ones sink to the bottom.
  const ordered = [...deadlines].sort((a, b) => {
    const doneA = a.status === 'DONE' ? 1 : 0
    const doneB = b.status === 'DONE' ? 1 : 0
    return doneA - doneB || a.daysLeft - b.daysLeft
  })

  return (
    <Card
      id="deadlines"
      title="Deadlines"
      description="Tuition, permit and tax dates"
      testId="deadlines"
      padded={false}
      action={
        <Button variant="soft" data-testid="toggle-deadline-form" onClick={() => setOpen((value) => !value)}>
          {open ? <X /> : <Plus />}
          {open ? 'Close' : 'Add'}
        </Button>
      }
    >
      {open && (
        <form onSubmit={add} className="grid gap-4 px-6 pt-5 sm:grid-cols-2 sm:px-7" data-testid="deadline-form">
          <div className="sm:col-span-2">
            <Field label="What is due?" htmlFor="deadline-label">
              <TextInput
                id="deadline-label"
                data-testid="deadline-label"
                placeholder="Winter term tuition"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </Field>
          </div>
          <Field label="Type" htmlFor="deadline-kind">
            <Select id="deadline-kind" data-testid="deadline-kind" value={kind} onChange={(event) => setKind(event.target.value as DeadlineKind)}>
              {KINDS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due on" htmlFor="deadline-due">
            <TextInput id="deadline-due" data-testid="deadline-due" type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" data-testid="save-deadline" disabled={!valid || busy}>
              {busy && <Spinner />}
              Save deadline
            </Button>
          </div>
        </form>
      )}

      {error && (
        <div className="px-6 pt-4 sm:px-7">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}

      <div className="pb-3 pt-3">
        {ordered.length === 0 ? (
          <p className="px-6 py-5 text-sm text-black/45 sm:px-7">No deadlines recorded.</p>
        ) : (
          <ul data-testid="deadline-rows">
            {ordered.map((deadline) => {
              const Icon = KINDS.find((option) => option.value === deadline.kind)?.icon ?? Bell
              const done = deadline.status === 'DONE'
              return (
                <li key={deadline.id} className="flex items-center gap-3 px-6 py-3 sm:px-7">
                  <button
                    data-testid="complete-deadline"
                    onClick={() => void setCompleted(deadline.id, !done)}
                    aria-label={done ? `Mark ${deadline.label} not done` : `Mark ${deadline.label} done`}
                    className={`grid size-7 shrink-0 place-items-center rounded-full transition ${
                      done ? 'bg-sage-600 text-white' : 'ring-1 ring-black/15 text-transparent hover:text-black/30'
                    }`}
                  >
                    <Check className="size-4" strokeWidth={2.5} />
                  </button>
                  <IconCircle>
                    <Icon />
                  </IconCircle>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate font-medium ${done ? 'text-black/35 line-through' : 'text-ink'}`}>{deadline.label}</p>
                    <p className="text-sm text-black/45">{formatDate(deadline.dueOn)}</p>
                  </div>
                  <StatusBadge deadline={deadline} />
                  <button
                    onClick={() => void remove(deadline.id)}
                    aria-label={`Delete ${deadline.label}`}
                    title="Delete"
                    className="grid size-8 shrink-0 place-items-center rounded-full text-black/30 transition hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Card>
  )
}

function StatusBadge({ deadline }: { deadline: DashboardDeadline }) {
  const text = describeDue(deadline.daysLeft, deadline.status)
  if (deadline.status === 'OVERDUE') {
    return <span className="rounded-full bg-red-600 px-2.5 py-1 text-xs font-medium text-white">{text}</span>
  }
  if (deadline.status === 'DUE_SOON') return <Badge tone="warning">{text}</Badge>
  if (deadline.status === 'DONE') return <Badge>{text}</Badge>
  return <span className="shrink-0 text-xs text-black/45">{text}</span>
}
