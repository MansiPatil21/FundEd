import { describe, expect, it } from '@jest/globals'
import { hashPassword, needsRehash, passwordProblem, verifyPassword } from './passwords.js'

// A lower cost keeps the unit tests fast. The format and the logic are the same.
const FAST = { N: 2 ** 10, r: 8, p: 1 }

describe('hashPassword and verifyPassword', () => {
  it('accepts the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct horse battery', FAST)

    expect(await verifyPassword('correct horse battery', stored)).toBe(true)
    expect(await verifyPassword('correct horse batterx', stored)).toBe(false)
    expect(await verifyPassword('', stored)).toBe(false)
  })

  it('never stores the password, and salts every hash differently', async () => {
    const first = await hashPassword('correct horse battery', FAST)
    const second = await hashPassword('correct horse battery', FAST)

    expect(first).toMatch(/^scrypt\$1024\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
    expect(first).not.toContain('correct')
    expect(first).not.toBe(second)
  })

  it('treats the same password typed with composed or decomposed accents as equal', async () => {
    const stored = await hashPassword('café-au-lait', FAST)
    expect(await verifyPassword('café-au-lait', stored)).toBe(true)
  })

  it('rejects a tampered or malformed hash instead of throwing', async () => {
    const stored = await hashPassword('correct horse battery', FAST)
    const parts = stored.split('$')
    const flipped = Buffer.from(parts[5]!, 'base64')
    flipped[0] = flipped[0]! ^ 0xff
    const tampered = [...parts.slice(0, 5), flipped.toString('base64')].join('$')

    expect(await verifyPassword('correct horse battery', tampered)).toBe(false)
    expect(await verifyPassword('correct horse battery', 'not-a-hash')).toBe(false)
    expect(await verifyPassword('correct horse battery', 'scrypt$1000$8$1$c2FsdA==$a2V5')).toBe(false)
  })

  it('refuses parameters that would make one verification allocate gigabytes', async () => {
    const hostile = `scrypt$${2 ** 24}$8$1$${Buffer.from('salt').toString('base64')}$${Buffer.alloc(64).toString('base64')}`
    expect(await verifyPassword('anything', hostile)).toBe(false)
  })

  it('flags hashes made with other parameters for an upgrade', async () => {
    const stored = await hashPassword('correct horse battery', FAST)
    expect(needsRehash(stored, FAST)).toBe(false)
    expect(needsRehash(stored)).toBe(true)
  })
})

describe('passwordProblem', () => {
  it.each([
    ['short', 'Use at least 8 characters'],
    ['        ', 'Use more than just spaces'],
    ['x'.repeat(129), 'Use 128 characters or fewer'],
    ['Password123', 'That password is too common. Choose another'],
    ['12345678', 'That password is too common. Choose another'],
  ])('rejects %j', (password, message) => {
    expect(passwordProblem(password)).toBe(message)
  })

  it('rejects the email address or its local part', () => {
    expect(passwordProblem('mansican908', 'mansican908@gmail.com')).toBe('Do not use your email address as your password')
    expect(passwordProblem('Mansican908@Gmail.com', 'mansican908@gmail.com')).toBe('Do not use your email address as your password')
  })

  it('counts characters, not bytes, so an 8-character non-Latin password is long enough', () => {
    expect(passwordProblem('पासवर्डसुरक्षि')).toBeNull()
    expect(passwordProblem('😀😀😀😀😀😀😀')).toBe('Use at least 8 characters')
  })

  it('accepts a long passphrase without demanding symbols or digits', () => {
    expect(passwordProblem('correct horse battery staple', 'mansi@example.com')).toBeNull()
  })
})
