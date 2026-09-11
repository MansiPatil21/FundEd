import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

/**
 * Inbound webhook from the rate provider.
 *
 * A webhook endpoint is public by definition, so the signature is the only thing
 * separating the provider from anyone who found the URL. Two details matter and are
 * easy to get wrong:
 *
 *   1. The signature is computed over the RAW body. Re-serialising the parsed JSON
 *      produces different bytes (key order, whitespace) and the comparison fails for
 *      reasons that look like a provider bug.
 *
 *   2. The comparison is constant-time. A plain === leaks, through timing, how many
 *      leading bytes were right, which is enough to forge a signature given enough
 *      attempts.
 */

export const ratePushSchema = z.object({
  base: z.string().length(3),
  quote: z.string().length(3),
  rate: z.number().positive(),
  observed_at: z.coerce.date(),
})

export type RatePush = z.infer<typeof ratePushSchema>

export function sign(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

export function signatureIsValid(rawBody: string, provided: string, secret: string): boolean {
  const expected = sign(rawBody, secret)
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(provided, 'utf8')
  // timingSafeEqual throws on a length mismatch, which would itself be a timing
  // signal, so length is checked first and both paths return the same way.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
