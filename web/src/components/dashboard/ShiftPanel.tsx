'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { BriefcaseBusiness, GraduationCap, Plus, Trash2 } from 'lucide-react'
import { api, ApiError, UnauthorizedError, signOut } from '@/lib/session'
import { combineLocal, formatDate, formatTime, toDateInput } from '@/lib/format'
import { Badge, Button, Card, Field, IconCircle, Notice, Spinner, TextInput } from '@/components/ui'

interface ShiftRecord {
  id: string
  startedAt: string
  endedAt: string
  employer: string
  onCampus: boolean
}

interface ShiftPayload {
  startedAt: string
  endedAt: string
  employer: string
  onCampus: boolean
}

const HOUR = 3_600_000
const RECENT = 5
const hours = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1))

export function ShiftPanel({ capHours, onChanged }: { capHours: number; onChanged: () => void }) {
  const [shifts, setShifts] = useState<ShiftRecord[] | null>(null)
  const [employer, setEmployer] = useState('')
  const [date, setDate] = useState(() => toDateInput(new Date()))
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('17:00')
  const [onCampus, setOnCampus] = useState(false)
  const [pending, setPending] = useState<ShiftPayload | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handle = useCallback((caught: unknown) => {
    if (caught instanceof UnauthorizedError) {
      signOut()
      return
    }
    setError(caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.')
  }, [])

  const load = useCallback(async () => {
    try {
      const { shifts: rows } = await api<{ shifts: ShiftRecord[] }>('/api/shifts')
      setShifts(rows)
    } catch (caught) {
      handle(caught)
    }
  }, [handle])

  useEffect(() => {
    void load()
  }, [load])

  const startedAt = date && start ? combineLocal(date, start) : null
  let endedAt = date && end ? combineLocal(date, end) : null
  // An end time at or before the start means the shift ran past midnight. The API splits it
  // across the week boundary if it crosses one.
  const overnight = Boolean(startedAt && endedAt && endedAt <= startedAt)
  if (startedAt && endedAt && overnight) endedAt = new Date(endedAt.getTime() + 24 * HOUR)
  const length = startedAt && endedAt ? (endedAt.getTime() - startedAt.getTime()) / HOUR : 0
  const tooLong = length > 16

  const save = async (payload: ShiftPayload) => {
    await api('/api/shifts', { method: 'POST', body: payload })
    setPending(null)
    await load()
    onChanged()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!employer.trim() || tooLong || !startedAt || !endedAt) return
    setBusy(true)
    setError(null)
    const payload: ShiftPayload = {
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      employer: employer.trim(),
      onCampus,
    }
    try {
      // Checked before saving, because going over the cap is a permit matter the student
      // should decide on knowingly, not discover afterwards.
      const { wouldBreach } = await api<{ wouldBreach: boolean }>('/api/shifts/compliance/would-breach', {
        method: 'POST',
        body: payload,
      })
      if (wouldBreach) setPending(payload)
      else await save(payload)
    } catch (caught) {
      handle(caught)
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!pending) return
    setBusy(true)
    try {
      await save(pending)
    } catch (caught) {
      handle(caught)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setError(null)
    try {
      await api(`/api/shifts/${id}`, { method: 'DELETE' })
      await load()
      onChanged()
    } catch (caught) {
      handle(caught)
    }
  }

  const sorted = shifts ? [...shifts].sort((a, b) => b.startedAt.localeCompare(a.startedAt)) : []
  const visible = showAll ? sorted : sorted.slice(0, RECENT)

  return (
    <Card id="shifts" title="Work shifts" description="Off-campus hours count toward your weekly cap" testId="shifts" padded={false}>
      <form onSubmit={submit} className="grid gap-4 px-6 pt-5 sm:grid-cols-6 sm:px-7" data-testid="shift-form">
        <div className="sm:col-span-6">
          <Field label="Employer" htmlFor="shift-employer">
            <TextInput
              id="shift-employer"
              data-testid="shift-employer"
              placeholder="Tim Hortons"
              value={employer}
              onChange={(event) => setEmployer(event.target.value)}
            />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Date" htmlFor="shift-date">
            <TextInput id="shift-date" data-testid="shift-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Start" htmlFor="shift-start">
            <TextInput id="shift-start" data-testid="shift-start" type="time" value={start} onChange={(event) => setStart(event.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="End" htmlFor="shift-end" hint={overnight ? 'Ends the next day' : undefined}>
            <TextInput id="shift-end" data-testid="shift-end" type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
          </Field>
        </div>
        <label className="flex w-fit cursor-pointer items-center gap-2.5 rounded-full bg-tile px-4 py-2.5 text-sm text-black/70 sm:col-span-4">
          <input
            type="checkbox"
            data-testid="shift-on-campus"
            checked={onCampus}
            onChange={(event) => setOnCampus(event.target.checked)}
            className="size-4 accent-[#5c774f]"
          />
          On campus, not counted toward the cap
        </label>
        <div className="flex items-center justify-end gap-3 sm:col-span-2">
          {length > 0 && <span className="text-sm tabular-nums text-black/45">{hours(length)} h</span>}
          <Button type="submit" data-testid="log-shift" disabled={busy || !employer.trim() || tooLong}>
            {busy ? <Spinner /> : <Plus />}
            Log shift
          </Button>
        </div>
        {tooLong && <p className="text-sm font-medium text-red-600 sm:col-span-6">That is over 16 hours. Check the start and end times.</p>}
      </form>

      {pending && (
        <div className="mx-6 mt-5 rounded-3xl bg-ink p-5 text-white sm:mx-7" data-testid="breach-confirm">
          <p className="font-semibold">This shift would put you over your {capHours}-hour weekly cap.</p>
          <p className="mt-1 text-sm text-white/65">
            Working past the cap breaks the conditions of your study permit. Record it only if you actually worked it.
          </p>
          <div className="mt-4 flex gap-2">
            <button onClick={() => setPending(null)} className="rounded-full bg-white/10 px-4 py-2 text-sm transition hover:bg-white/20">
              Cancel
            </button>
            <button
              data-testid="confirm-breach"
              onClick={() => void confirm()}
              disabled={busy}
              className="rounded-full bg-white px-4 py-2 text-sm font-medium text-ink transition hover:bg-white/90 disabled:opacity-50"
            >
              Log it anyway
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="px-6 pt-4 sm:px-7">
          <Notice tone="danger" testId="shift-error">
            {error}
          </Notice>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between border-t border-black/5 px-6 pt-5 sm:px-7">
        <h3 className="text-sm font-semibold text-ink">Recent shifts</h3>
        {sorted.length > RECENT && (
          <button onClick={() => setShowAll((value) => !value)} className="text-sm text-black/45 transition hover:text-ink">
            {showAll ? 'Show less' : 'View all'}
          </button>
        )}
      </div>

      <div className="pb-3 pt-1">
        {shifts === null ? (
          <p className="flex items-center gap-2 px-6 py-6 text-sm text-black/45 sm:px-7">
            <Spinner /> Loading shifts…
          </p>
        ) : visible.length === 0 ? (
          <p className="px-6 py-6 text-sm text-black/45 sm:px-7">No shifts logged yet.</p>
        ) : (
          <ul data-testid="shift-list">
            {visible.map((shift) => {
              const shiftHours = (new Date(shift.endedAt).getTime() - new Date(shift.startedAt).getTime()) / HOUR
              return (
                <li key={shift.id} className="flex items-center gap-4 px-6 py-3 sm:px-7">
                  <IconCircle>{shift.onCampus ? <GraduationCap /> : <BriefcaseBusiness />}</IconCircle>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium text-ink">
                      <span className="truncate">{shift.employer}</span>
                      {shift.onCampus && <Badge tone="success">On campus</Badge>}
                    </p>
                    <p className="text-sm text-black/45">
                      {formatDate(shift.startedAt)} · {formatTime(shift.startedAt)} to {formatTime(shift.endedAt)}
                    </p>
                  </div>
                  <span className="text-lg font-semibold tabular-nums tracking-tight text-ink">{hours(shiftHours)}h</span>
                  <button
                    onClick={() => void remove(shift.id)}
                    aria-label={`Delete shift at ${shift.employer}`}
                    title="Delete"
                    className="grid size-9 place-items-center rounded-full text-black/30 transition hover:bg-red-50 hover:text-red-600"
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
