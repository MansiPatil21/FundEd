/**
 * Formatting shared by every page. Money is always integer minor units.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Parses "YYYY-MM-DD" as a LOCAL calendar date. `new Date('2026-10-01')` is UTC midnight,
 * which in Halifax is still September 30, so a due date would display a day early.
 */
function toDate(value: string | Date): Date {
  if (value instanceof Date) return value
  if (DATE_ONLY.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    return new Date(year!, month! - 1, day!)
  }
  return new Date(value)
}

export function formatMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).format(minor / 100)
  } catch {
    return `${(minor / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
  }
}

export function formatDate(value: string | Date): string {
  return toDate(value).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatTime(value: string | Date): string {
  return toDate(value).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })
}

/** A value for an `<input type="date">`, in local time. */
export function toDateInput(value: string | Date | null | undefined): string {
  if (!value) return ''
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** A local calendar date and "HH:MM" time, as a Date in the browser's timezone. */
export function combineLocal(date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  return new Date(year!, month! - 1, day!, hours ?? 0, minutes ?? 0)
}

/**
 * A calendar date sent to the API as local NOON. Midnight would sit on a timezone edge
 * and read back as the previous day for anyone west of UTC.
 */
export function localNoonIso(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year!, month! - 1, day!, 12).toISOString()
}

export const CURRENCIES = [
  { code: 'INR', name: 'Indian rupee' },
  { code: 'CNY', name: 'Chinese yuan' },
  { code: 'PHP', name: 'Philippine peso' },
  { code: 'NGN', name: 'Nigerian naira' },
  { code: 'VND', name: 'Vietnamese dong' },
  { code: 'PKR', name: 'Pakistani rupee' },
  { code: 'BDT', name: 'Bangladeshi taka' },
  { code: 'NPR', name: 'Nepalese rupee' },
  { code: 'BRL', name: 'Brazilian real' },
  { code: 'MXN', name: 'Mexican peso' },
  { code: 'COP', name: 'Colombian peso' },
  { code: 'KRW', name: 'South Korean won' },
  { code: 'GHS', name: 'Ghanaian cedi' },
  { code: 'KES', name: 'Kenyan shilling' },
  { code: 'USD', name: 'US dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British pound' },
] as const

export const CADENCES = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Every 3 months' },
  { value: 'ANNUAL', label: 'Yearly' },
  { value: 'ONCE', label: 'One time' },
] as const

export function cadenceLabel(value: string): string {
  return CADENCES.find((cadence) => cadence.value === value)?.label ?? value
}
