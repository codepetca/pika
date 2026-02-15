import type { Page } from 'playwright'
import { LOGIN, FRAMES } from './ta-selectors'
import type { TACredentials } from '../types'

/**
 * Log in to TeachAssist using username/password.
 *
 * 1. Navigate to the login page.
 * 2. Fill in credentials.
 * 3. Submit the form.
 * 4. Wait for the frameset page to load (indicating successful login).
 *
 * Throws if login fails (bad credentials, network error, etc.).
 */
export async function loginToTeachAssist(
  page: Page,
  credentials: TACredentials
): Promise<void> {
  // Navigate to the login page
  await page.goto(credentials.baseUrl, { waitUntil: 'domcontentloaded' })

  // Fill in username
  await page.fill(LOGIN.usernameInput, credentials.username)

  // Fill in password
  await page.fill(LOGIN.passwordInput, credentials.password)

  // Click submit
  await page.click(LOGIN.submitButton)

  // Wait for navigation to the frameset page
  // After successful login, TA redirects to adminFrameset.html
  await page.waitForURL(/adminFrameset/, { timeout: 15_000 }).catch(() => {
    throw new Error(
      'Login failed: did not reach the TeachAssist dashboard. Check username/password.'
    )
  })

  // Verify the menu frame exists (confirms we're on the frameset)
  const menuFrame = page.frame(FRAMES.menu)
  if (!menuFrame) {
    throw new Error('Login succeeded but frameset did not load properly.')
  }

  // Wait for at least one course link to appear in the menu
  await menuFrame.waitForSelector('a', { timeout: 10_000 }).catch(() => {
    throw new Error('Login succeeded but no courses found in the sidebar.')
  })
}
