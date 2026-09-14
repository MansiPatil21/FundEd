'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { readToken, writeToken } from '@/lib/apollo'
import { api, ApiError, UnauthorizedError, type Profile } from '@/lib/session'
import { AuthLayout } from '@/components/AuthLayout'
import { PasswordInput } from '@/components/PasswordInput'
import { Button, Field, Notice, Spinner, TextInput } from '@/components/ui'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Someone already signed in who lands here goes straight on, instead of being asked again.
  // A stale token fails /api/me, which clears it, and the form simply stays.
  useEffect(() => {
    if (!readToken()) return
    api<Profile>('/api/me')
      .then((profile) => router.replace(profile.onboarded ? '/dashboard' : '/onboarding'))
      .catch(() => {})
  }, [router])

  const emailError = touched && !EMAIL.test(email.trim()) ? 'Enter a valid email address' : null
  const passwordError = touched && !password ? 'Enter your password' : null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (!EMAIL.test(email.trim()) || !password) return
    setBusy(true)
    setError(null)
    try {
      const { token } = await api<{ token: string }>('/api/auth/login', {
        method: 'POST',
        body: { email: email.trim().toLowerCase(), password },
      })
      writeToken(token)
      const profile = await api<Profile>('/api/me')
      router.replace(profile.onboarded ? '/dashboard' : '/onboarding')
    } catch (caught) {
      // The API answers a wrong password with 401, which the shared client reports as an
      // ended session. On this page it can only mean the credentials were wrong.
      setError(
        caught instanceof UnauthorizedError
          ? 'Incorrect email or password'
          : caught instanceof ApiError
            ? caught.message
            : 'Sign-in failed. Try again.',
      )
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <div className="space-y-3">
        <h1 className="text-4xl font-medium tracking-display text-ink">Sign in to FundEd</h1>
        <p className="text-sm text-black/50">
          New here?{' '}
          <Link href="/signup" className="font-medium text-ink underline underline-offset-2" data-testid="to-signup">
            Create an account
          </Link>
        </p>
      </div>

      <form onSubmit={submit} noValidate className="space-y-5" data-testid="login-form">
        <Field label="Email address" htmlFor="email" error={emailError}>
          <TextInput
            id="email"
            data-testid="email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@university.ca"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(emailError)}
          />
        </Field>
        <Field label="Password" htmlFor="password" error={passwordError}>
          <PasswordInput
            id="password"
            data-testid="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(passwordError)}
          />
        </Field>
        {error && (
          <Notice tone="danger" testId="login-error">
            {error}
          </Notice>
        )}
        <Button type="submit" data-testid="sign-in-submit" disabled={busy} className="h-12 w-full text-[15px]">
          {busy ? (
            <>
              <Spinner /> Signing in…
            </>
          ) : (
            <>
              Sign in <ArrowRight />
            </>
          )}
        </Button>
      </form>
    </AuthLayout>
  )
}
