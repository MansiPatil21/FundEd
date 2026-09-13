import { z } from 'zod'
import type { RateSource } from '../../jobs/fxPoller.js'

/**
 * Daily reference rates from Frankfurter, which republishes the European Central Bank's
 * rates and needs no API key.
 *
 * These are reference rates published once per working day, not live market quotes. That
 * is the right grain for planning transfers weeks ahead and for the day-to-day changes the
 * uncertainty estimate resamples, and it is the honest limit of a free, keyless source. The
 * poller therefore runs every few hours rather than every minute.
 */

const responseSchema = z.object({
  base: z.string().length(3),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rates: z.record(z.number().positive()),
})

export function createFrankfurterSource(baseUrl: string, timeoutMs = 10_000): RateSource {
  return {
    async fetch(base, quote) {
      const url = `${baseUrl.replace(/\/$/, '')}/latest?from=${encodeURIComponent(base)}&to=${encodeURIComponent(quote)}`
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
      if (!response.ok) throw new Error(`rate source returned ${response.status}`)

      const parsed = responseSchema.safeParse(await response.json().catch(() => null))
      if (!parsed.success) throw new Error('rate source returned an unrecognised shape')

      const rate = parsed.data.rates[quote]
      if (rate === undefined) throw new Error(`rate source has no ${base}/${quote} rate`)

      // The reference rate carries a date, not a time. Stamping every read of one publication
      // at the same instant makes a repeat poll the identical observation, which
      // FxService.record recognises and skips instead of storing a fake "no change" day.
      return { rate, observedAt: new Date(`${parsed.data.date}T15:00:00.000Z`) }
    },
  }
}
