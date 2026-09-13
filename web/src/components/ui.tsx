'use client'

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'

/** The building blocks every page uses, so the product reads as one design. */

type Variant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-black/80 disabled:bg-black/15 disabled:text-black/35',
  secondary: 'bg-white text-ink ring-1 ring-black/10 hover:ring-black/25 disabled:text-black/30',
  soft: 'bg-tile text-ink hover:bg-black/[0.07] disabled:text-black/30',
  ghost: 'text-black/55 hover:bg-tile hover:text-ink disabled:text-black/25',
  danger: 'text-red-600 hover:bg-red-50 disabled:text-red-300',
}

export function Button({
  variant = 'primary',
  type = 'button',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/50 disabled:cursor-not-allowed [&_svg]:size-4 ${VARIANTS[variant]} ${className}`}
    />
  )
}

export const controlClass =
  'w-full rounded-2xl border-0 bg-tile px-4 py-3 text-sm text-ink outline-none ring-1 ring-transparent transition placeholder:text-black/35 hover:bg-black/[0.05] focus:bg-white focus:ring-2 focus:ring-sage-500/45 disabled:cursor-not-allowed disabled:bg-black/[0.04] disabled:text-black/40'

export function TextInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${controlClass} ${className}`} />
}

export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...props} className={`${controlClass} appearance-none pr-10 ${className}`}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-black/40" />
    </div>
  )
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string
  htmlFor: string
  hint?: ReactNode
  error?: string | null
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-black/60">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs font-medium text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-xs text-black/40">{hint}</p>
      ) : null}
    </div>
  )
}

export function Card({
  id,
  title,
  description,
  action,
  children,
  className = '',
  testId,
  padded = true,
}: {
  id?: string
  title?: string
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  testId?: string
  padded?: boolean
}) {
  return (
    <section
      id={id}
      data-testid={testId}
      className={`scroll-mt-24 rounded-[28px] bg-white shadow-[0_1px_2px_rgba(16,24,16,0.04),0_18px_44px_-24px_rgba(16,24,16,0.22)] ${className}`}
    >
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 px-6 pt-6 sm:px-7 sm:pt-7">
          <div>
            {title && <h2 className="text-xl font-semibold tracking-tight text-ink">{title}</h2>}
            {description && <p className="mt-1 text-sm text-black/45">{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={padded ? 'p-6 sm:p-7' : ''}>{children}</div>
    </section>
  )
}

const TONES = {
  info: 'bg-tile text-black/70',
  success: 'bg-sage-100 text-sage-800',
  warning: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200/70',
  danger: 'bg-red-50 text-red-700 ring-1 ring-red-200/70',
} as const

export function Notice({
  tone = 'info',
  children,
  testId,
}: {
  tone?: keyof typeof TONES
  children: ReactNode
  testId?: string
}) {
  return (
    <div
      data-testid={testId}
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`rounded-2xl px-5 py-3.5 text-sm ${TONES[tone]}`}
    >
      {children}
    </div>
  )
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'dark'
  children: ReactNode
}) {
  const tones = {
    neutral: 'bg-tile text-black/55',
    success: 'bg-sage-100 text-sage-700',
    warning: 'bg-amber-50 text-amber-800',
    dark: 'bg-ink text-white',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  )
}

export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div data-testid="page-loader" className="flex min-h-screen items-center justify-center gap-3 text-sm text-black/50">
      <Spinner /> {label}
    </div>
  )
}

export function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md space-y-4 text-center">
        <Notice tone="danger" testId="load-error">
          {message}
        </Notice>
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  )
}

export function Logo({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  const mark = tone === 'light' ? 'bg-white text-ink' : 'bg-ink text-white'
  const word = tone === 'light' ? 'text-white' : 'text-ink'
  return (
    <span className={`flex items-center gap-2.5 text-[17px] font-semibold tracking-tight ${word}`}>
      <span className={`grid size-9 place-items-center rounded-full text-sm font-bold ${mark}`}>F</span>
      FundEd
    </span>
  )
}

/**
 * A formatted amount with the part after the decimal point faded, the way "$1,842.56"
 * reads in the design: the whole number carries the meaning, the cents recede.
 */
export function Amount({ value, fadedClassName = 'opacity-40' }: { value: string; fadedClassName?: string }) {
  const point = value.lastIndexOf('.')
  if (point === -1 || !/^\.\d/.test(value.slice(point))) return <>{value}</>
  return (
    <>
      {value.slice(0, point)}
      <span className={fadedClassName}>{value.slice(point)}</span>
    </>
  )
}

export interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
}

/** A pill toggle between a few views, like the Income / Expenses switch. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  tone = 'light',
  testId,
}: {
  options: ReadonlyArray<SegmentOption<T>>
  value: T
  onChange: (value: T) => void
  label: string
  tone?: 'light' | 'dark'
  testId?: string
}) {
  const track = tone === 'dark' ? 'bg-white/15 ring-1 ring-white/20 backdrop-blur' : 'bg-tile'
  return (
    <div role="tablist" aria-label={label} data-testid={testId} className={`inline-flex rounded-full p-1 ${track}`}>
      {options.map((option) => {
        const active = option.value === value
        const styles =
          tone === 'dark'
            ? active
              ? 'bg-white/30 text-white shadow-sm'
              : 'text-white/75 hover:text-white'
            : active
              ? 'bg-white text-ink shadow-sm'
              : 'text-black/50 hover:text-ink'
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition [&_svg]:size-4 ${styles}`}
          >
            {option.icon}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function IconCircle({
  children,
  tone = 'tile',
  className = '',
}: {
  children: ReactNode
  tone?: 'tile' | 'white' | 'dark' | 'glass'
  className?: string
}) {
  const tones = {
    tile: 'bg-tile text-ink',
    white: 'bg-white text-ink ring-1 ring-black/5',
    dark: 'bg-ink text-white',
    glass: 'bg-white/20 text-white',
  }
  return (
    <span className={`grid size-10 shrink-0 place-items-center rounded-full [&_svg]:size-[18px] ${tones[tone]} ${className}`}>
      {children}
    </span>
  )
}
