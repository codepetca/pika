/**
 * Auth Setup - Generates storage states for authenticated users
 *
 * This file runs before all tests to create reusable auth sessions.
 * Storage states are saved to .auth/ directory and reused across tests.
 */
import { test as setup, expect } from '@playwright/test'

const TEACHER_EMAIL = process.env.E2E_TEACHER_EMAIL || 'teacher@example.com'
const STUDENT_EMAIL = process.env.E2E_STUDENT_EMAIL || 'student1@example.com'
const PASSWORD = process.env.E2E_PASSWORD || 'test1234'

const TEACHER_STORAGE = '.auth/teacher.json'
const STUDENT_STORAGE = '.auth/student.json'

/**
 * Logs in and saves authentication state
 */
async function authenticate(page: any, email: string, storagePath: string) {
  await page.goto('/login')

  // Fill login form
  await page.getByLabel('School Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)

  // Submit and wait for redirect
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL('**/classrooms**', { timeout: 30_000 })

  // Verify successful login
  await expect(page).toHaveURL(/\/classrooms/)

  // Save authentication state
  await page.context().storageState({ path: storagePath })
}

setup('authenticate as teacher', async ({ page }) => {
  await authenticate(page, TEACHER_EMAIL, TEACHER_STORAGE)
})

setup('authenticate as student', async ({ page }) => {
  await authenticate(page, STUDENT_EMAIL, STUDENT_STORAGE)
})
