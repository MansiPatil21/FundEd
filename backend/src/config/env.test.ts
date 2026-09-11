import { describe, expect, it } from '@jest/globals'
import { loadEnv } from './env.js'

describe('loadEnv', () => {
  const valid = { DATABASE_URL: 'mongodb://localhost:27017/funded' }

  it('applies defaults for everything optional', () => {
    const env = loadEnv(valid as NodeJS.ProcessEnv)
    expect(env.PORT).toBe(4000)
    expect(env.NODE_ENV).toBe('development')
    expect(env.REDIS_URL).toBe('redis://localhost:6380')
  })

  it('coerces PORT from the string the shell actually provides', () => {
    const env = loadEnv({ ...valid, PORT: '8080' } as NodeJS.ProcessEnv)
    expect(env.PORT).toBe(8080)
  })

  it('names the offending variable when one is missing', () => {
    expect(() => loadEnv({} as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/)
  })

  it('rejects a PORT that is not a positive integer', () => {
    expect(() => loadEnv({ ...valid, PORT: '-1' } as NodeJS.ProcessEnv)).toThrow(/PORT/)
  })
})
