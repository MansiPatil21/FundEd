import { describe, expect, it } from '@jest/globals'
import { ratePushSchema, sign, signatureIsValid } from './webhook.js'

const SECRET = 'provider-shared-secret'
const body = JSON.stringify({ base: 'CAD', quote: 'INR', rate: 61.4, observed_at: '2027-01-05T12:00:00Z' })

describe('webhook signatures', () => {
  it('accepts a signature produced from the same raw body', () => {
    expect(signatureIsValid(body, sign(body, SECRET), SECRET)).toBe(true)
  })

  it('rejects a signature made with a different secret', () => {
    expect(signatureIsValid(body, sign(body, 'wrong'), SECRET)).toBe(false)
  })

  it('rejects a body altered after signing', () => {
    const signature = sign(body, SECRET)
    const tampered = body.replace('61.4', '99.9')
    expect(signatureIsValid(tampered, signature, SECRET)).toBe(false)
  })

  // The trap: signing the re-serialised object rather than the bytes received.
  it('is sensitive to key order, which is why the raw body must be used', () => {
    const reordered = JSON.stringify({ quote: 'INR', base: 'CAD', rate: 61.4, observed_at: '2027-01-05T12:00:00Z' })
    expect(sign(reordered, SECRET)).not.toBe(sign(body, SECRET))
  })

  it('returns false rather than throwing on a length mismatch', () => {
    expect(signatureIsValid(body, 'short', SECRET)).toBe(false)
  })

  it('rejects an empty signature', () => {
    expect(signatureIsValid(body, '', SECRET)).toBe(false)
  })
})

describe('rate push payload', () => {
  it('accepts a well-formed push', () => {
    expect(ratePushSchema.parse(JSON.parse(body)).rate).toBe(61.4)
  })

  it('rejects a negative rate', () => {
    expect(() => ratePushSchema.parse({ base: 'CAD', quote: 'INR', rate: -1, observed_at: new Date() })).toThrow()
  })

  it('rejects a currency code that is not three letters', () => {
    expect(() => ratePushSchema.parse({ base: 'CADD', quote: 'INR', rate: 61, observed_at: new Date() })).toThrow()
  })
})
