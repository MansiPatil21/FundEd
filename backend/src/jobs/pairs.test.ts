import { describe, expect, it } from '@jest/globals'
import { parsePairs, redisConnection } from './pairs.js'

describe('parsePairs', () => {
  it('reads a comma-separated list, tolerating spaces and case', () => {
    expect(parsePairs('CAD:INR, cad:php')).toEqual([
      { base: 'CAD', quote: 'INR' },
      { base: 'CAD', quote: 'PHP' },
    ])
  })

  it('refuses a malformed pair instead of silently skipping it', () => {
    expect(() => parsePairs('CAD-INR')).toThrow('expected BASE:QUOTE')
  })

  it('refuses an empty list', () => {
    expect(() => parsePairs(' , ')).toThrow('at least one pair')
  })
})

describe('redisConnection', () => {
  it('takes host, port and database index from the URL', () => {
    expect(redisConnection('redis://localhost:6380/2')).toEqual({ host: 'localhost', port: 6380, db: 2, maxRetriesPerRequest: null })
  })

  it('defaults the port and database', () => {
    expect(redisConnection('redis://cache')).toMatchObject({ host: 'cache', port: 6379, db: 0 })
  })
})
