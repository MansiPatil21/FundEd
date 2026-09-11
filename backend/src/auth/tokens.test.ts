import { describe, expect, it } from '@jest/globals'
import jwt from 'jsonwebtoken'
import { createTokenService, InvalidTokenError } from './tokens.js'

const SECRET = 'test-secret-not-used-anywhere-real'
const service = createTokenService(SECRET, 3600)
const claims = { sub: '507f1f77bcf86cd799439011', email: 'mansi@example.com' }

describe('token service', () => {
  it('round-trips the claims it was given', () => {
    expect(service.verify(service.issue(claims))).toMatchObject(claims)
  })

  it('rejects a token signed with a different secret', () => {
    const forged = jwt.sign(claims, 'someone-elses-secret', { algorithm: 'HS256' })
    expect(() => service.verify(forged)).toThrow(InvalidTokenError)
  })

  it('rejects an expired token and says so', () => {
    const expired = createTokenService(SECRET, -1).issue(claims)
    expect(() => service.verify(expired)).toThrow(/expired/)
  })

  // The classic JWT footgun: a library that does not pin the algorithm will accept
  // an unsigned token whose header claims alg "none".
  it('rejects an unsigned token claiming algorithm none', () => {
    const unsigned = jwt.sign(claims, '', { algorithm: 'none' })
    expect(() => service.verify(unsigned)).toThrow(InvalidTokenError)
  })

  it('rejects a validly signed token whose claims are the wrong shape', () => {
    const wrongShape = jwt.sign({ sub: 'abc' }, SECRET, { algorithm: 'HS256' })
    expect(() => service.verify(wrongShape)).toThrow(/shape/)
  })

  it('rejects a token whose email is not an email', () => {
    const bad = jwt.sign({ sub: 'abc', email: 'not-an-email' }, SECRET, { algorithm: 'HS256' })
    expect(() => service.verify(bad)).toThrow(/shape/)
  })
})
