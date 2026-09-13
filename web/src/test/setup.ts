import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

/**
 * Unmount everything rendered by a test before the next one starts.
 *
 * Testing Library only registers this automatically when the test runner exposes a global
 * afterEach, and this project runs Vitest with globals off. Without it, a component from
 * one test stays in the DOM during the next, and queries such as getByRole find two
 * matches and fail for a reason that has nothing to do with the code under test.
 */
afterEach(() => {
  cleanup()
})
