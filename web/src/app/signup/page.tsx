'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { readToken, writeToken } from '@/lib/apollo'
import { api, ApiError, type Profile } from '@/lib/session'
import { PASSWORD_MIN_LENGTH, passwordProblem } from '@/lib/password'
import { AuthLayout } from '@/components/AuthLayout'
import { PasswordInput } from '@/components/PasswordInput'
import { Button, Field, Notice, Spinner, TextInput } from '@/components/ui'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type FieldName = 'name' | 'email' | 'password'

export default function SignupPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [touched, setTouched] = useState<Record<FieldName, boolean>>({ name: false, email: false, password: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailTaken, setEmailTaken] = useState(false)

  // Someone already signed in is sent on, rather than offered a second account. A stale
  // token fails /api/me, which clears it, and the form simply stays.
  useEffect(() => {
    if (!readToken()) return
    api<Profile>('/api/me')
      .then((profile) => router.replace(profile.onboarded ? '/dashboard' : '/onboarding'))
      .catch(() => {})
  }, [router])

  const problems: Record<FieldName, string | null> = {
    name: name.trim() ? null : 'Enter your name',
    email: EMAIL.test(email.trim()) ? null : 'Enter a valid email address',
    password: passwordProblem(password, email),
  }

  // Leaving a field only shows its error if something was typed. The name field has focus on
  // arrival, so without this, clicking "Sign in" instead flashed "Enter your name" and the
  // re-render swallowed the click. An empty field is reported when the form is submitted.
  const leave = (field: FieldName, value: string) => () => {
    if (value) setTouched((current) => ({ ...current, [field]: true }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setTouched({ name: true, email: true, password: true })
    if (problems.name || problems.email || problems.password) return
    setBusy(true)
    setError(null)
    setEmailTaken(false)
    try {
      const { token } = await api<{ token: string }>('/api/auth/register', {
        method: 'POST',
        body: { displayName: name.trim(), email: email.trim().toLowerCase(), password },
      })
      writeToken(token)
      router.replace('/onboarding')
    } catch (caught) {
      setEmailTaken(caught instanceof ApiError && caught.status === 409)
      setError(caught instanceof ApiError ? caught.message : 'Could not create your account. Try again.')
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <div className="space-y-3">
        <h1 className="text-4xl font-medium tracking-display text-ink">Create your account</h1>
        <p className="text-sm text-black/50">
          Already have one?{' '}
          <Link href="/login" className="font-medium text-ink underline underline-offset-2" data-testid="to-login">
            Sign in
          </Link>
        </p>
      </div>

      <form onSubmit={submit} noValidate className="space-y-5" data-testid="signup-form">
        <Field label="What should we call you?" htmlFor="signup-name" error={touched.name ? problems.name : null}>
          <TextInput
            id="signup-name"
            data-testid="signup-name"
            autoComplete="name"
            autoFocus
            maxLength={120}
            placeholder="Mansi Patil"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={leave('name', name)}
            aria-invalid={Boolean(touched.name && problems.name)}
          />
        </Field>
        <Field label="Email address" htmlFor="signup-email" error={touched.email ? problems.email : null}>
          <TextInput
            id="signup-email"
            data-testid="signup-email"
            type="email"
            autoComplete="email"
            placeholder="you@university.ca"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onBlur={leave('email', email)}
            aria-invalid={Boolean(touched.email && problems.email)}
          />
        </Field>
        <Field
          label="Password"
          htmlFor="signup-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. A few words together works well.`}
          error={touched.password ? problems.password : null}
        >
          <PasswordInput
            id="signup-password"
            data-testid="signup-password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onBlur={leave('password', password)}
            aria-invalid={Boolean(touched.password && problems.password)}
          />
        </Field>

        {error && (
          <Notice tone="danger" testId="signup-error">
            {error}
            {emailTaken && (
              <>
                {' '}
                <Link href="/login" className="font-medium underline underline-offset-2">
                  Go to sign in
                </Link>
              </>
            )}
          </Notice>
        )}

        <Button type="submit" data-testid="signup-submit" disabled={busy} className="h-12 w-full text-[15px]">
          {busy ? (
            <>
              <Spinner /> Creating your account…
            </>
          ) : (
            <>
              Create account <ArrowRight />
            </>
          )}
        </Button>
      </form>
    </AuthLayout>
  )
}
