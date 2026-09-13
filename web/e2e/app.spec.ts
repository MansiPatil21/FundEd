import { expect, test } from '@playwright/test'

/**
 * Browser tests for everything that works without the API running: routing guards, the
 * sign-in form's validation, the server-rendered pages, and a regression test for the
 * dark-mode bug. Flows that need the API are covered by the backend's integration tests.
 */

test.describe('getting in', () => {
  test('the home page sends a new visitor to sign in', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('get-started').click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByTestId('email')).toBeVisible()
  })

  test('a signed-out visitor is sent from the dashboard to sign in', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('a signed-out visitor is sent from setup to sign in', async ({ page }) => {
    await page.goto('/onboarding')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('the sign-in form rejects an address that is not an email', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('email').fill('not-an-email')
    await page.getByTestId('sign-in-submit').click()
    await expect(page.getByText('Enter a valid email address')).toBeVisible()
  })
})

test.describe('dark mode', () => {
  test.use({ colorScheme: 'dark' })

  // Regression: the starter stylesheet turned body text near-white in dark mode while every
  // card stayed white, so pages looked completely blank.
  test('keeps dark text on a light page when the system is in dark mode', async ({ page }) => {
    await page.goto('/login')
    const colors = await page.evaluate(() => {
      const style = getComputedStyle(document.body)
      return { background: style.backgroundColor, color: style.color }
    })
    expect(colors.background).not.toBe('rgb(10, 10, 10)')
    expect(colors.color).not.toBe('rgb(237, 237, 237)')
  })
})

test.describe('cost of living', () => {
  test('renders a city from the server with its total', async ({ page }) => {
    await page.goto('/cost-of-living/halifax')
    await expect(page.getByRole('heading', { name: /Studying in Halifax/ })).toBeVisible()
    await expect(page.getByTestId('monthly-total')).toContainText('$1,977')
  })

  test('has the figures in the served HTML, not fetched afterwards', async ({ request }) => {
    const response = await request.get('/cost-of-living/toronto')
    expect(await response.text()).toContain('2,200')
  })

  test('404s for a city that is not covered', async ({ page }) => {
    const response = await page.goto('/cost-of-living/atlantis')
    expect(response?.status()).toBe(404)
  })
})
