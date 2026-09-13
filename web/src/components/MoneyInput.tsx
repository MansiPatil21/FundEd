'use client'

import { useEffect, useState } from 'react'

/**
 * Parses what a person types into integer minor units, or null if it is not money.
 *
 * Accepts "2500", "2,500", "$2,500.50" and a trailing "1200." mid-typing. Rejects a third
 * decimal place rather than rounding it away silently.
 */
export function parseMoneyToMinor(text: string): number | null {
  const cleaned = text.replace(/[\s,$]/g, '')
  if (cleaned === '' || cleaned === '.') return 0
  if (!/^\d*\.?\d{0,2}$/.test(cleaned)) return null
  const [whole = '', fraction = ''] = cleaned.split('.')
  return Number(whole || '0') * 100 + Number((fraction + '00').slice(0, 2))
}

export function formatMinor(minor: number): string {
  return (minor / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface MoneyInputProps {
  id: string
  valueMinor: number
  onChange: (minor: number) => void
  testId?: string
  placeholder?: string
  /** Shown inside the field: "$" for local money, a currency code such as "INR" otherwise. */
  prefix?: string
}

/**
 * A money field that keeps what was typed as TEXT and derives the number from it.
 *
 * The first version stored only the number and redrew the field from it on every keystroke.
 * Typing "1200." parsed to 1200, the field redrew as "1200", and the decimal point vanished:
 * "1200.50" became 120050, and commas cleared the field. Holding the raw text means the
 * field shows exactly what was typed.
 */
export function MoneyInput({ id, valueMinor, onChange, testId, placeholder = '0.00', prefix = '$' }: MoneyInputProps) {
  const [text, setText] = useState(valueMinor ? formatMinor(valueMinor) : '')

  // Resync only when the value changes from outside, such as a reset or a loaded profile.
  // While someone is typing, the text already matches the value.
  useEffect(() => {
    if (parseMoneyToMinor(text) !== valueMinor) {
      setText(valueMinor ? formatMinor(valueMinor) : '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueMinor])

  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-sm text-black/40">{prefix}</span>
      <input
        id={id}
        data-testid={testId}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        onChange={(event) => {
          const next = event.target.value
          const minor = parseMoneyToMinor(next)
          if (minor === null) return
          setText(next)
          onChange(minor)
        }}
        onBlur={() => setText(valueMinor ? formatMinor(valueMinor) : '')}
        className={`w-full rounded-2xl border-0 bg-tile py-3 pr-4 text-sm text-ink outline-none ring-1 ring-transparent transition placeholder:text-black/35 hover:bg-black/[0.05] focus:bg-white focus:ring-2 focus:ring-sage-500/45 ${
          prefix.length > 1 ? 'pl-[3.75rem]' : 'pl-8'
        }`}
      />
    </div>
  )
}
