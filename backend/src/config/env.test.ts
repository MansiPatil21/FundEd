import { describe, expect, it } from '@jest/globals'
import { loadEnv } from './env.js'

describe('loadEnv', () => {
  const valid = {
    DATABASE_URL: 'mongodb://localhost:27017/funded',
    JWT_SECRET: 'a-secret-long-enough-to-pass-validation',
    FX_WEBHOOK_SECRET: 'webhook-secret-16+',
  }

  it('applies defaults for everything optional', () => {
    const env = loadEnv(valid as NodeJS.ProcessEnv)
    expect(env.PORT).toBe(4000)
    expect(env.NODE_ENV).toBe('development')
    expect(env.REDIS_URL).toBe('redis://localhost:6380')
  })

  it('keeps rate polling off unless it is switched on', () => {
    expect(loadEnv(valid as NodeJS.ProcessEnv).FX_POLL_ENABLED).toBe(false)
    expect(loadEnv({ ...valid, FX_POLL_ENABLED: 'true' } as NodeJS.ProcessEnv).FX_POLL_ENABLED).toBe(true)
  })

  it('coerces PORT from the string the shell actually provides', () => {
    const env = loadEnv({ ...valid, PORT: '8080' } as NodeJS.ProcessEnv)
    expect(env.PORT).toBe(8080)
  })

  it('names the offending variable when one is missing', () => {
    expect(() => loadEnv({} as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/)
  })

  // A signing secret that silently falls back to a known default is worse than one
  // that is absent: the absent one fails at boot, the default one ships.
  it('refuses to start without a JWT secret rather than defaulting one', () => {
    const { JWT_SECRET, ...withoutSecret } = valid
    expect(() => loadEnv(withoutSecret as NodeJS.ProcessEnv)).toThrow(/JWT_SECRET/)
  })

  it('refuses a JWT secret that is too short to be worth having', () => {
    expect(() => loadEnv({ ...valid, JWT_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow(/JWT_SECRET/)
  })

  it('rejects a PORT that is not a positive integer', () => {
    expect(() => loadEnv({ ...valid, PORT: '-1' } as NodeJS.ProcessEnv)).toThrow(/PORT/)
  })
})
