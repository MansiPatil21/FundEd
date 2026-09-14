/**
 * Fixed-window attempt counting, kept in memory.
 *
 * Callers decide what counts as an attempt: sign-in records only failures, so a student who
 * types their password correctly is never locked out by their own earlier typos once they
 * get it right, while a guesser burns through the window.
 *
 * In memory rather than Redis because the API runs as one instance. A second instance would
 * give each its own counters, doubling what an attacker gets, and that is the point at which
 * this should move to Redis with INCR and EXPIRE.
 */
export interface RateLimiter {
  /** Seconds until the key may try again, or 0 if it is not blocked. */
  retryAfterSeconds(key: string): number
  record(key: string): void
  reset(key: string): void
}

const MAX_TRACKED_KEYS = 50_000

export function createRateLimiter({
  limit,
  windowMs,
  now = () => Date.now(),
}: {
  limit: number
  windowMs: number
  now?: () => number
}): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>()

  const active = (key: string) => {
    const window = windows.get(key)
    if (window && window.resetAt <= now()) {
      windows.delete(key)
      return undefined
    }
    return window
  }

  // Expired windows are dropped lazily on lookup. The sweep bounds memory when a flood of
  // distinct keys (every possible email, say) would otherwise never be looked up again.
  const sweep = () => {
    const time = now()
    for (const [key, window] of windows) {
      if (window.resetAt <= time) windows.delete(key)
    }
  }

  return {
    retryAfterSeconds(key) {
      const window = active(key)
      return window && window.count >= limit ? Math.max(1, Math.ceil((window.resetAt - now()) / 1000)) : 0
    },

    record(key) {
      const window = active(key)
      if (window) {
        window.count += 1
        return
      }
      if (windows.size >= MAX_TRACKED_KEYS) sweep()
      windows.set(key, { count: 1, resetAt: now() + windowMs })
    },

    reset(key) {
      windows.delete(key)
    },
  }
}
