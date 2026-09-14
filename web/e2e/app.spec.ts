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

  test('the sign-in form asks for a password', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('email').fill('mansi@example.com')
    await page.getByTestId('sign-in-submit').click()
    await expect(page.getByText('Enter your password')).toBeVisible()
  })

  test('a new visitor can go from sign-in to creating an account and back', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('to-signup').click()
    await expect(page).toHaveURL(/\/signup$/)
    await expect(page.getByTestId('signup-password')).toBeVisible()
    await page.getByTestId('to-login').click()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('sign-up explains a password that breaks the rules, before anything is sent', async ({ page }) => {
    await page.goto('/signup')
    await page.getByTestId('signup-name').fill('Mansi')
    await page.getByTestId('signup-email').fill('mansi@example.com')
    await page.getByTestId('signup-password').fill('short')
    await page.getByTestId('signup-submit').click()
    await expect(page.getByText('Use at least 8 characters')).toBeVisible()

    await page.getByTestId('signup-password').fill('password123')
    await expect(page.getByText('That password is too common. Choose another')).toBeVisible()
    await expect(page).toHaveURL(/\/signup$/)
  })

  test('the password can be shown and hidden', async ({ page }) => {
    await page.goto('/login')
    const field = page.getByTestId('password')
    await field.fill('correct horse battery')
    await expect(field).toHaveAttribute('type', 'password')
    await page.getByRole('button', { name: 'Show password' }).click()
    await expect(field).toHaveAttribute('type', 'text')
    await page.getByRole('button', { name: 'Hide password' }).click()
    await expect(field).toHaveAttribute('type', 'password')
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
