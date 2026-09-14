import { describe, expect, it } from 'vitest'
import { passwordProblem } from './password'

describe('passwordProblem', () => {
  it.each([
    ['short', 'Use at least 8 characters'],
    ['        ', 'Use more than just spaces'],
    ['x'.repeat(129), 'Use 128 characters or fewer'],
    ['Password123', 'That password is too common. Choose another'],
  ])('rejects %j', (password, message) => {
    expect(passwordProblem(password)).toBe(message)
  })

  it('rejects the email address or its local part', () => {
    expect(passwordProblem('mansican908', 'mansican908@gmail.com')).toBe('Do not use your email address as your password')
  })

  it('accepts a long passphrase without demanding symbols or digits', () => {
    expect(passwordProblem('correct horse battery staple', 'mansi@example.com')).toBeNull()
  })

  it('matches the API on character counting, so the form never approves what the server rejects', () => {
    expect(passwordProblem('😀😀😀😀😀😀😀')).toBe('Use at least 8 characters')
    expect(passwordProblem('😀😀😀😀😀😀😀😀')).toBeNull()
  })
})
