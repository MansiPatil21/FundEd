import { describe, expect, it } from '@jest/globals'
import { createRateLimiter } from './rateLimiter.js'

describe('createRateLimiter', () => {
  const setup = () => {
    let time = 1_000_000
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => time })
    return { limiter, advance: (ms: number) => (time += ms) }
  }

  it('allows attempts up to the limit, then blocks with the seconds left in the window', () => {
    const { limiter, advance } = setup()
    for (let i = 0; i < 3; i++) {
      expect(limiter.retryAfterSeconds('a')).toBe(0)
      limiter.record('a')
    }
    advance(15_000)

    expect(limiter.retryAfterSeconds('a')).toBe(45)
  })

  it('opens again once the window has passed', () => {
    const { limiter, advance } = setup()
    for (let i = 0; i < 3; i++) limiter.record('a')
    advance(60_000)

    expect(limiter.retryAfterSeconds('a')).toBe(0)
    limiter.record('a')
    expect(limiter.retryAfterSeconds('a')).toBe(0)
  })

  it('counts each key separately', () => {
    const { limiter } = setup()
    for (let i = 0; i < 3; i++) limiter.record('a')

    expect(limiter.retryAfterSeconds('a')).toBeGreaterThan(0)
    expect(limiter.retryAfterSeconds('b')).toBe(0)
  })

  it('forgets a key on reset, as after a successful sign-in', () => {
    const { limiter } = setup()
    for (let i = 0; i < 3; i++) limiter.record('a')
    limiter.reset('a')

    expect(limiter.retryAfterSeconds('a')).toBe(0)
  })

  it('never reports 0 seconds for a blocked key in its final moments', () => {
    const { limiter, advance } = setup()
    for (let i = 0; i < 3; i++) limiter.record('a')
    advance(59_999)

    expect(limiter.retryAfterSeconds('a')).toBe(1)
  })
})
