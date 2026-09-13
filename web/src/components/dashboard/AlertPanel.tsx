'use client'

import { useState, type FormEvent } from 'react'
import { Bell, TrendingDown, TrendingUp } from 'lucide-react'
import { api, ApiError, UnauthorizedError, signOut } from '@/lib/session'
import { formatTime } from '@/lib/format'
import { Amount, Badge, Button, Card, Field, IconCircle, Notice, Segmented, Spinner, TextInput, type SegmentOption } from '@/components/ui'
import type { DashboardAlert, DashboardRate } from './types'

type Direction = 'AT_OR_ABOVE' | 'AT_OR_BELOW'

const DIRECTIONS: ReadonlyArray<SegmentOption<Direction>> = [
  { value: 'AT_OR_ABOVE', label: 'Rises to', icon: <TrendingUp /> },
  { value: 'AT_OR_BELOW', label: 'Falls to', icon: <TrendingDown /> },
]

export function AlertPanel({
  alerts,
  rate,
  homeCurrency,
  onChanged,
}: {
  alerts: DashboardAlert[]
  rate: DashboardRate | null
  homeCurrency: string
  onChanged: () => void
}) {
  const [direction, setDirection] = useState<Direction>('AT_OR_ABOVE')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const targetRate = Number(target)
  const valid = target.trim() !== '' && Number.isFinite(targetRate) && targetRate > 0

  const add = async (event: FormEvent) => {
    event.preventDefault()
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/fx/alerts', {
        method: 'POST',
        body: { baseCurrency: 'CAD', quoteCurrency: homeCurrency, targetRate, direction },
      })
      setTarget('')
      onChanged()
    } catch (caught) {
      if (caught instanceof UnauthorizedError) {
        signOut()
        return
      }
      setError(caught instanceof ApiError ? caught.message : 'Could not set the alert. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card id="alerts" title="Rate alerts" description={`Hear the moment CAD/${homeCurrency} reaches your rate`} testId="alerts" padded={false}>
      <div className="px-6 pt-5 sm:px-7">
        <div className="rounded-3xl bg-tile p-5" data-testid="current-rate">
          {rate ? (
            <>
              <p className="text-[13px] text-black/50">1 CAD right now</p>
              <p className="mt-2 text-4xl font-semibold tabular-nums tracking-display text-ink">
                <Amount value={rate.rate.toFixed(2)} />
                <span className="text-base font-medium tracking-normal text-black/40"> {homeCurrency}</span>
              </p>
              <p className="mt-1 text-xs text-black/45">Updated {formatTime(rate.observedAt)}</p>
            </>
          ) : (
            <p className="text-sm text-black/55">No rate observed yet. Alerts still fire as soon as one arrives.</p>
          )}
        </div>

        <form onSubmit={add} className="mt-5 space-y-4" data-testid="alert-form">
          <Segmented label="Alert direction" options={DIRECTIONS} value={direction} onChange={setDirection} />
          <Field label={`Target rate (${homeCurrency})`} htmlFor="alert-target">
            <TextInput
              id="alert-target"
              data-testid="alert-target"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              placeholder={rate ? (rate.rate * 1.02).toFixed(2) : '63.00'}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            />
          </Field>
          <Button type="submit" data-testid="create-alert" disabled={!valid || busy} className="w-full">
            {busy ? <Spinner /> : <Bell />}
            Set alert
          </Button>
        </form>
        {error && (
          <div className="mt-3">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
      </div>

      <div className="mt-6 border-t border-black/5 pb-3 pt-2">
        {alerts.length === 0 ? (
          <p className="px-6 py-5 text-sm text-black/45 sm:px-7">No alerts set.</p>
        ) : (
          <ul data-testid="alert-rows">
            {alerts.map((alert) => (
              <li key={alert.id} className="flex items-center gap-4 px-6 py-3 sm:px-7">
                <IconCircle>{alert.direction === 'AT_OR_ABOVE' ? <TrendingUp /> : <TrendingDown />}</IconCircle>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">
                    {alert.direction === 'AT_OR_ABOVE' ? 'Rises to' : 'Falls to'}{' '}
                    <span className="tabular-nums">{alert.targetRate.toFixed(2)}</span>
                  </p>
                  <p className="text-sm text-black/45">
                    {alert.baseCurrency}/{alert.quoteCurrency}
                  </p>
                </div>
                {alert.spent ? <Badge>Fired</Badge> : <Badge tone="success">Watching</Badge>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}
