/**
 * UI Snapshot Tests
 *
 * Visual regression testing using Playwright's built-in snapshot system.
 *
 * Usage:
 *   pnpm run e2e:snapshots           # Run tests and compare with baselines
 *   pnpm run e2e:snapshots:update    # Update baselines after UI changes
 *
 * Snapshots are stored in e2e/__snapshots__/
 */
import { test, expect } from '@playwright/test'

const TEACHER_STORAGE = '.auth/teacher.json'
const STUDENT_STORAGE = '.auth/student.json'

// Helper to wait for page to be fully loaded and ready for screenshot
async function waitForContent(page: any) {
  // Wait for network to settle
  await page.waitForLoadState('networkidle')
  // Small additional delay to ensure content is rendered
  await page.waitForTimeout(500)
}

// Helper to enable dark mode by adding the 'dark' class to html element
async function enableDarkMode(page: any) {
  await page.evaluate(() => {
    document.documentElement.classList.add('dark')
    localStorage.setItem('theme', 'dark')
  })
  // Small delay to let dark mode styles apply
  await page.waitForTimeout(200)
}

// ============================================================================
// Logged-out Screens
// ============================================================================

test.describe('logged-out screens', () => {
  test('login page', async ({ page }) => {
    await page.goto('/login')
    await waitForContent(page)
    await expect(page).toHaveScreenshot('auth-login.png', { fullPage: true })
  })

  test('signup page', async ({ page }) => {
    await page.goto('/signup')
    await waitForContent(page)
    await expect(page).toHaveScreenshot('auth-signup.png', { fullPage: true })
  })

  test('forgot password page', async ({ page }) => {
    await page.goto('/forgot-password')
    await waitForContent(page)
    await expect(page).toHaveScreenshot('auth-forgot-password.png', { fullPage: true })
  })

  test('verify signup page', async ({ page }) => {
    await page.goto('/verify-signup?email=test@example.com')
    await waitForContent(page)
    await expect(page).toHaveScreenshot('auth-verify-signup.png', { fullPage: true })
  })

  test('join page', async ({ page }) => {
    await page.goto('/join')
    await waitForContent(page)
    await expect(page).toHaveScreenshot('auth-join.png', { fullPage: true })
  })
})

// ============================================================================
// Logged-out Screens - Dark Mode
// ============================================================================

test.describe('logged-out screens - dark mode', () => {
  test('login page', async ({ page }) => {
    await page.goto('/login')
    await waitForContent(page)
    await enableDarkMode(page)
    await expect(page).toHaveScreenshot('auth-login-dark.png', { fullPage: true })
  })

  test('signup page', async ({ page }) => {
    await page.goto('/signup')
    await waitForContent(page)
    await enableDarkMode(page)
    await expect(page).toHaveScreenshot('auth-signup-dark.png', { fullPage: true })
  })

  test('forgot password page', async ({ page }) => {
    await page.goto('/forgot-password')
    await waitForContent(page)
    await enableDarkMode(page)
    await expect(page).toHaveScreenshot('auth-forgot-password-dark.png', { fullPage: true })
  })

  test('verify signup page', async ({ page }) => {
    await page.goto('/verify-signup?email=test@example.com')
    await waitForContent(page)
    await enableDarkMode(page)
    await expect(page).toHaveScreenshot('auth-verify-signup-dark.png', { fullPage: true })
  })

  test('join page', async ({ page }) => {
    await page.goto('/join')
    await waitForContent(page)
    await enableDarkMode(page)
    await expect(page).toHaveScreenshot('auth-join-dark.png', { fullPage: true })
  })
})

// ============================================================================
// Teacher Screens - Light Mode
// ============================================================================

test.describe('teacher screens - light mode', () => {
  test.use({ storageState: TEACHER_STORAGE })

  test('classrooms index', async ({ page }) => {
    await page.goto('/classrooms')
    await waitForContent(page)
    await expect(page).toHaveScreenshot('teacher-classrooms-index.png', { fullPage: true })
  })

  test('classroom attendance tab', async ({ page }) => {
    await page.goto('/classrooms')
    const classroomCard = page.locator('[data-testid="classroom-card"]').first()
    await expect(classroomCard).toBeVisible({ timeout: 15_000 })
    await classroomCard.click()
    await page.waitForURL('**/classrooms/**', { timeout: 15_000 })

    // Wait for attendance data to load
    await waitForContent(page)

    await expect(page).toHaveScreenshot('teacher-classroom-attendance.png', { fullPage: true })
  })

  test('classroom roster tab', async ({ page }) => {
    await page.goto('/classrooms')
    await page.locator('[data-testid="classroom-card"]').first().click()
    await page.waitForURL('**/classrooms/**')

    await page.getByRole('link', { name: 'Roster' }).click()
    await waitForContent(page)

    await expect(page).toHaveScreenshot('teacher-classroom-roster.png', { fullPage: true })
  })

  test('classroom calendar tab', async ({ page }) => {
    await page.goto('/classrooms')
    await page.locator('[data-testid="classroom-card"]').first().click()
    await page.waitForURL('**/classrooms/**')

    await page.getByRole('link', { name: 'Calendar' }).click()
    await waitForContent(page)

    await expect(page).toHaveScreenshot('teacher-classroom-calendar.png', { fullPage: true })
  })

  test('classroom settings tab', async ({ page }) => {
    await page.goto('/classrooms')
    await page.locator('[data-testid="classroom-card"]').first().click()
    await page.waitForURL('**/classrooms/**')

    await page.getByRole('link', { name: 'Settings' }).click()
    await waitForContent(page)

    await expect(page).toHaveScreenshot('teacher-classroom-settings.png', { fullPage: true })
  })

  test('classroom assignments tab', async ({ page }) => {
    await page.goto('/classrooms')
    await page.locator('[data-testid="classroom-card"]').first().click()
    await page.waitForURL('**/classrooms/**')

    await page.getByRole('link', { name: 'Assignments' }).click()
    await waitForContent(page)

    await expect(page).toHaveScreenshot('teacher-classroom-assignments.png', { fullPage: true })
  })

  test('assignment detail page', async ({ page }) => {
    await page.goto('/classrooms')
    await page.locator('[data-testid="classroom-card"]').first().click()
    await page.waitForURL('**/classrooms/**')

    await page.getByRole('link', { name: 'Assignments' }).click()
    await waitForContent(page)

    // Click first assignment if available
    const assignmentLink = page.locator('a[href*="/assignments/"]').first()
    if ((await assignmentLink.count()) > 0) {
      await assignmentLink.click()
      await page.waitForURL('**/assignments/**', { timeout: 15_000 })
      await waitForContent(page)
      await expect(page).toHaveScreenshot('teacher-assignment-detail.png', { fullPage: true })
    }
  })
})

// ============================================================================
// Student Screens - Light Mode
// ============================================================================

test.describe('student screens - light mode', () => {
  test.use({ storageState: STUDENT_STORAGE })

  test('classrooms index', async ({ page }) => {
    await page.goto('/classrooms')
    await waitForContent(page)
    await expect(page).toHaveScreenshot('student-classrooms-index.png', { fullPage: true })
  })

  test('classroom today tab', async ({ page }) => {
    await page.goto('/classrooms')
    await waitForContent(page)

    // Click on first classroom card to enter
    const classroomCard = page.locator('[data-testid="classroom-card"]').first()
    await expect(classroomCard).toBeVisible({ timeout: 15_000 })
    await classroomCard.click()
    await page.waitForURL('**/classrooms/**', { timeout: 15_000 })

    // Wait for today tab content to load
    await waitForContent(page)

    await expect(page).toHaveScreenshot('student-classroom-today.png', { fullPage: true })
  })

  test('classroom assignments tab', async ({ page }) => {
    await page.goto('/classrooms')
    await waitForContent(page)

    // Click on first classroom card to enter
    await page.locator('[data-testid="classroom-card"]').first().click()
    await page.waitForURL('**/classrooms/**')

    await page.getByRole('link', { name: 'Assignments' }).click()
    await waitForContent(page)

    await expect(page).toHaveScreenshot('student-classroom-assignments.png', { fullPage: true })
  })

  test('assignment editor', async ({ page }) => {
    await page.goto('/classrooms')
    await waitForContent(page)

    // Click on first classroom card to enter
    await page.locator('[data-testid="classroom-card"]').first().click()
    await page.waitForURL('**/classrooms/**')

    await page.getByRole('link', { name: 'Assignments' }).click()
    await waitForContent(page)

    // Click first assignment if available
    const assignmentLink = page.locator('a[href*="/assignments/"]').first()
    if ((await assignmentLink.count()) > 0) {
      await assignmentLink.click()
      await page.waitForURL('**/assignments/**', { timeout: 15_000 })
      await waitForContent(page)
      await expect(page).toHaveScreenshot('student-assignment-editor.png', { fullPage: true })
    }
  })

  test('join classroom page', async ({ page }) => {
    await page.goto('/join')
    await waitForContent(page)
    await expect(page).toHaveScreenshot('student-join-classroom.png', { fullPage: true })
  })
})

// ============================================================================
// Teacher Screens - Dark Mode
// ============================================================================

test.describe('teacher screens - dark mode', () => {
  test.use({ storageState: TEACHER_STORAGE })

  test('classrooms index', async ({ page }) => {
    await page.goto('/classrooms')
    await waitForContent(page)
    await enableDarkMode(page)
    await expect(page).toHaveScreenshot('teacher-classrooms-index-dark.png', { fullPage: true })
  })

  test('classroom attendance tab', async ({ page }) => {
    await page.goto('/classrooms')
    const classroomCard = page.locator('[data-testid="classroom-card"]').first()
    await expect(classroomCard).toBeVisible({ timeout: 15_000 })
    await classroomCard.click()
    await page.waitForURL('**/classrooms/**', { timeout: 15_000 })

    await waitForContent(page)
    await enableDarkMode(page)

    await expect(page).toHaveScreenshot('teacher-classroom-attendance-dark.png', { fullPage: true })
  })

  test('classroom roster tab', async ({ page }) => {
    await page.goto('/classrooms')
    await page.locator('[data-testid="classroom-card"]').first().click()
    await page.waitForURL('**/classrooms/**')

    await page.getByRole('link', { name: 'Roster' }).click()
    await waitForContent(page)
    await enableDarkMode(page)

    await expect(page).toHaveScreenshot('teacher-classroom-roster-dark.png', { fullPage: true })
  })

  test('classroom calendar tab', async ({ page }) => {
    await page.goto('/classrooms')
    await page.locator('[data-testid="classroom-card"]').first().click()
    await page.waitForURL('**/classrooms/**')

    await page.getByRole('link', { name: 'Calendar' }).click()
    await waitForContent(page)
    await enableDarkMode(page)

    await expect(page).toHaveScreenshot('teacher-classroom-calendar-dark.png', { fullPage: true })
  })

  test('classroom assignments tab', async ({ page }) => {
    await page.goto('/classrooms')
    await page.locator('[data-testid="classroom-card"]').first().click()
    await page.waitForURL('**/classrooms/**')

    await page.getByRole('link', { name: 'Assignments' }).click()
    await waitForContent(page)
    await enableDarkMode(page)

    await expect(page).toHaveScreenshot('teacher-classroom-assignments-dark.png', { fullPage: true })
  })

  test('classroom settings tab', async ({ page }) => {
    await page.goto('/classrooms')
    await page.locator('[data-testid="classroom-card"]').first().click()
    await page.waitForURL('**/classrooms/**')

    await page.getByRole('link', { name: 'Settings' }).click()
    await waitForContent(page)
    await enableDarkMode(page)

    await expect(page).toHaveScreenshot('teacher-classroom-settings-dark.png', { fullPage: true })
  })
})

// ============================================================================
// Student Screens - Dark Mode
// ============================================================================

test.describe('student screens - dark mode', () => {
  test.use({ storageState: STUDENT_STORAGE })

  test('classrooms index', async ({ page }) => {
    await page.goto('/classrooms')
    await waitForContent(page)
    await enableDarkMode(page)
    await expect(page).toHaveScreenshot('student-classrooms-index-dark.png', { fullPage: true })
  })

  test('classroom today tab', async ({ page }) => {
    await page.goto('/classrooms')
    await waitForContent(page)

    // Click on first classroom card to enter
    await page.locator('[data-testid="classroom-card"]').first().click()
    await page.waitForURL('**/classrooms/**', { timeout: 15_000 })
    await waitForContent(page)
    await enableDarkMode(page)

    await expect(page).toHaveScreenshot('student-classroom-today-dark.png', { fullPage: true })
  })

  test('classroom assignments tab', async ({ page }) => {
    await page.goto('/classrooms')
    await waitForContent(page)

    // Click on first classroom card to enter
    await page.locator('[data-testid="classroom-card"]').first().click()
    await page.waitForURL('**/classrooms/**')

    await page.getByRole('link', { name: 'Assignments' }).click()
    await waitForContent(page)
    await enableDarkMode(page)

    await expect(page).toHaveScreenshot('student-classroom-assignments-dark.png', { fullPage: true })
  })

  test('join classroom page', async ({ page }) => {
    await page.goto('/join')
    await waitForContent(page)
    await enableDarkMode(page)
    await expect(page).toHaveScreenshot('student-join-classroom-dark.png', { fullPage: true })
  })
})
