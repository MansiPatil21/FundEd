'use client'

import { useState, type FormEvent } from 'react'
import { Check } from 'lucide-react'
import { api, ApiError, UnauthorizedError, signOut } from '@/lib/session'
import { passwordProblem } from '@/lib/password'
import { PasswordInput } from './PasswordInput'
import { Button, Card, Field, Notice, Spinner } from './ui'

export function ChangePasswordCard({ email }: { email: string }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [changed, setChanged] = useState(false)

  const problem = !current
    ? 'Enter your current password'
    : passwordProblem(next, email) ??
      (next === current
        ? 'Choose a password different from your current one'
        : confirm !== next
          ? 'The new passwords do not match'
          : null)
  const started = Boolean(current || next || confirm)

  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value)
    setChanged(false)
    setError(null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (problem) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/auth/password', { method: 'POST', body: { currentPassword: current, newPassword: next } })
      setCurrent('')
      setNext('')
      setConfirm('')
      setChanged(true)
    } catch (caught) {
      if (caught instanceof UnauthorizedError) {
        signOut()
        return
      }
      setError(caught instanceof ApiError ? caught.message : 'Could not change your password. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Password" description="Change the password you sign in with" testId="change-password">
      <form onSubmit={submit} className="space-y-5" noValidate>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Current password" htmlFor="current-password">
            <PasswordInput
              id="current-password"
              data-testid="current-password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => edit(setCurrent)(event.target.value)}
            />
          </Field>
          <Field label="New password" htmlFor="new-password">
            <PasswordInput
              id="new-password"
              data-testid="new-password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => edit(setNext)(event.target.value)}
            />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm-password">
            <PasswordInput
              id="confirm-password"
              data-testid="confirm-password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => edit(setConfirm)(event.target.value)}
            />
          </Field>
        </div>

        {error && (
          <Notice tone="danger" testId="change-password-error">
            {error}
          </Notice>
        )}

        <div className="flex flex-wrap items-center justify-end gap-4">
          {started && problem && <p className="text-sm text-black/50">{problem}</p>}
          {changed && (
            <p className="inline-flex items-center gap-1.5 text-sm font-medium text-sage-700" data-testid="password-changed">
              <Check className="size-4" /> Password changed
            </p>
          )}
          <Button type="submit" variant="secondary" data-testid="change-password-submit" disabled={busy || Boolean(problem)} className="px-6">
            {busy && <Spinner />}
            Change password
          </Button>
        </div>
      </form>
    </Card>
  )
}
