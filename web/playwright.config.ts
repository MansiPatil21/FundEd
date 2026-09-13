import { defineConfig, devices } from '@playwright/test'

/**
 * These run against a real browser and a real Next.js server.
 *
 * The dev server is started by Playwright itself so the suite is one command from a
 * cold checkout. Only what works without the API is covered here: route guards, the
 * sign-in form's validation, the dark-mode regression and the server-rendered
 * cost-of-living pages, so none of it needs Mongo, Redis or the optimiser running.
 * API-backed flows are covered by the backend's own integration tests.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
  },
  // Three engines, not three brands: Chromium (Chrome, Edge), Gecko (Firefox) and WebKit
  // (Safari). Layout and form-control differences live at the engine level, and date and
  // time inputs in particular render differently in each.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npm run build && npm run start -- --port 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
