'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { readToken, writeToken } from '@/lib/apollo'
import { api, ApiError, UnauthorizedError, type Profile } from '@/lib/session'
import { AreaChart } from '@/components/charts/AreaChart'
import { Amount, Button, Field, Logo, Notice, PageLoader, Spinner, TextInput } from '@/components/ui'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const SAMPLE = [
  { label: 'Apr', value: 380 },
  { label: 'May', value: 460 },
  { label: 'Jun', value: 420 },
  { label: 'Jul', value: 540 },
  { label: 'Aug', value: 510 },
  { label: 'Sep', value: 650 },
]

export default function LoginPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [email, setEmail] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const continueToApp = async () => {
    const profile = await api<Profile>('/api/me')
    router.replace(profile.onboarded ? '/dashboard' : '/onboarding')
  }

  // Someone already signed in who lands here goes straight on, instead of being asked again
  // for an email they have already given.
  useEffect(() => {
    if (!readToken()) {
      setChecking(false)
      return
    }
    continueToApp().catch(() => setChecking(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const emailValid = EMAIL.test(email.trim())
  const emailError = touched && !emailValid ? 'Enter a valid email address' : null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (!emailValid) return
    setBusy(true)
    setError(null)
    try {
      const { token } = await api<{ token: string }>('/api/auth/local', {
        method: 'POST',
        body: { email: email.trim().toLowerCase() },
      })
      writeToken(token)
      await continueToApp()
    } catch (caught) {
      setError(caught instanceof ApiError || caught instanceof UnauthorizedError ? caught.message : 'Sign-in failed. Try again.')
      setBusy(false)
    }
  }

  if (checking) return <PageLoader label="Checking your session…" />

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="m-4 hidden flex-col justify-between overflow-hidden rounded-[36px] bg-sage-gradient p-10 text-white lg:flex">
        <Link href="/" aria-label="FundEd home">
          <Logo tone="light" />
        </Link>

        <div>
          <span className="inline-flex rounded-full bg-white/20 px-3 py-1 text-sm font-medium">Left over this month</span>
          <p className="mt-4 text-7xl font-medium tabular-nums tracking-display">
            <Amount value="$650.75" fadedClassName="text-white/45" />
          </p>
          <p className="mt-2 max-w-sm text-sm text-white/80">After rent, groceries and the money you send home to family.</p>
          <div className="mt-10">
            <AreaChart
              points={SAMPLE}
              height={150}
              tooltip={
                <div>
                  <p className="text-base font-semibold leading-none tracking-tight">$650.75</p>
                  <p className="mt-1 text-xs text-white/55">for September</p>
                </div>
              }
            />
          </div>
        </div>

        <h2 className="max-w-md text-4xl font-medium leading-[1.02] tracking-display">
          Know your hours, your budget, and the moment to send money home.
        </h2>
      </aside>

      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-9">
          <Link href="/" className="inline-block lg:hidden">
            <Logo />
          </Link>
          <div className="space-y-3">
            <h1 className="text-4xl font-medium tracking-display text-ink">Sign in to FundEd</h1>
            <p className="text-sm text-black/50">New here? The same step creates your account.</p>
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
                onBlur={() => setTouched(true)}
                aria-invalid={Boolean(emailError)}
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
                  Continue <ArrowRight />
                </>
              )}
            </Button>
          </form>

          <p className="rounded-2xl bg-tile px-4 py-3 text-xs leading-relaxed text-black/50">
            This development build signs in with an email address only, without a password. Do not enter real financial details.
          </p>
        </div>
      </main>
    </div>
  )
}
