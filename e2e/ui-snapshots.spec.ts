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

test.setTimeout(60_000)

// Helper to wait for page to be fully loaded and ready for screenshot
async function waitForContent(page: any) {
  // Wait for network to settle
  await page.waitForLoadState('networkidle')
  // Small additional delay to ensure content is rendered
  await page.waitForTimeout(500)
  // Avoid snapshotting tabs while loading placeholders are still visible.
  await page
    .waitForFunction(() => {
      return !Array.from(document.querySelectorAll('.animate-spin, .animate-pulse')).some((element) => {
        if (!(element instanceof HTMLElement)) return false
        const style = window.getComputedStyle(element)
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
      })
    }, undefined, { timeout: 15_000 })
    .catch(() => {})
  // Remove transient fixed-position error toasts that can appear during async refetches
  await page.evaluate(() => {
    const isTransientErrorToast = (element: Element) => {
      const text = (element.textContent || '').trim().toLowerCase()
      if (!/^\d+\s+error(s)?$/.test(text)) return false
      const style = window.getComputedStyle(element)
      return style.position === 'fixed'
    }

    for (const element of Array.from(document.querySelectorAll('div, section, aside'))) {
      if (isTransientErrorToast(element)) {
        element.remove()
      }
    }

    const looksLikeClock = (text: string) =>
      /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s[A-Z][a-z]{2}\s\d{1,2}\s\d{1,2}:\d{2}\s(?:AM|PM)$/.test(text)

    for (const element of Array.from(document.querySelectorAll('div, span, p'))) {
      if (!(element instanceof HTMLElement)) continue
      const text = (element.textContent || '').trim()
      if (looksLikeClock(text)) {
        element.textContent = 'Wed Mar 18 12:00 PM'
      }
    }
  })
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

async function enterFirstClassroom(page: any) {
  await page.goto('/classrooms')
  await waitForContent(page)
  const classroomCard = page.locator('[data-testid="classroom-card"]').first()
  await expect(classroomCard).toBeVisible({ timeout: 15_000 })
  let enteredClassroom = false

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await classroomCard.click({ force: true })

    try {
      await expect
        .poll(() => page.url(), { timeout: 5_000 })
        .toMatch(/\/classrooms\/[^/?#]+/)
      enteredClassroom = true
      break
    } catch {
      // Retry the click when client-side navigation does not fire reliably.
    }
  }

  expect(enteredClassroom).toBe(true)
  await waitForContent(page)
}

async function openClassroomTab(page: any, label: string, options?: { dark?: boolean }) {
  await enterFirstClassroom(page)
  await page.getByRole('link', { name: label }).click()
  await waitForContent(page)
  if (options?.dark) {
    await enableDarkMode(page)
  }
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
    await enterFirstClassroom(page)
    await waitForContent(page)
    await expect(page).toHaveScreenshot('teacher-classroom-attendance.png', { fullPage: true })
  })

  test('classroom roster tab', async ({ page }) => {
    await openClassroomTab(page, 'Roster')
    await expect(page).toHaveScreenshot('teacher-classroom-roster.png', { fullPage: true })
  })

  test('classroom calendar tab', async ({ page }) => {
    await openClassroomTab(page, 'Calendar')
    await expect(page).toHaveScreenshot('teacher-classroom-calendar.png', { fullPage: true })
  })

  test('classroom settings tab', async ({ page }) => {
    await openClassroomTab(page, 'Settings')
    await expect(page).toHaveScreenshot('teacher-classroom-settings.png', { fullPage: true })
  })

  test('classroom assignments tab', async ({ page }) => {
    await openClassroomTab(page, 'Assignments')
    await expect(page).toHaveScreenshot('teacher-classroom-assignments.png', { fullPage: true })
  })

  test('classroom quizzes tab', async ({ page }) => {
    await openClassroomTab(page, 'Quizzes')
    await expect(page).toHaveScreenshot('teacher-classroom-quizzes.png', { fullPage: true })
  })

  test('classroom tests tab', async ({ page }) => {
    await openClassroomTab(page, 'Tests')
    await expect(page).toHaveScreenshot('teacher-classroom-tests.png', { fullPage: true })
  })

  test('classroom gradebook tab', async ({ page }) => {
    await openClassroomTab(page, 'Gradebook')
    await expect(page).toHaveScreenshot('teacher-classroom-gradebook.png', { fullPage: true })
  })

  test('classroom resources tab', async ({ page }) => {
    await openClassroomTab(page, 'Resources')
    await expect(page).toHaveScreenshot('teacher-classroom-resources.png', { fullPage: true })
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
    await enterFirstClassroom(page)
    await waitForContent(page)
    await expect(page).toHaveScreenshot('student-classroom-today.png', { fullPage: true })
  })

  test('classroom assignments tab', async ({ page }) => {
    await openClassroomTab(page, 'Assignments')
    await expect(page).toHaveScreenshot('student-classroom-assignments.png', { fullPage: true })
  })

  test('classroom quizzes tab', async ({ page }) => {
    await openClassroomTab(page, 'Quizzes')
    await expect(page).toHaveScreenshot('student-classroom-quizzes.png', { fullPage: true })
  })

  test('classroom tests tab', async ({ page }) => {
    await openClassroomTab(page, 'Tests')
    await expect(page).toHaveScreenshot('student-classroom-tests.png', { fullPage: true })
  })

  test('classroom calendar tab', async ({ page }) => {
    await openClassroomTab(page, 'Calendar')
    await expect(page).toHaveScreenshot('student-classroom-calendar.png', { fullPage: true })
  })

  test('classroom resources tab', async ({ page }) => {
    await openClassroomTab(page, 'Resources')
    await expect(page).toHaveScreenshot('student-classroom-resources.png', { fullPage: true })
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

  test('classroom quizzes tab', async ({ page }) => {
    await openClassroomTab(page, 'Quizzes', { dark: true })
    await expect(page).toHaveScreenshot('teacher-classroom-quizzes-dark.png', { fullPage: true })
  })

  test('classroom tests tab', async ({ page }) => {
    await openClassroomTab(page, 'Tests', { dark: true })
    await expect(page).toHaveScreenshot('teacher-classroom-tests-dark.png', { fullPage: true })
  })

  test('classroom gradebook tab', async ({ page }) => {
    await openClassroomTab(page, 'Gradebook', { dark: true })
    await expect(page).toHaveScreenshot('teacher-classroom-gradebook-dark.png', { fullPage: true })
  })

  test('classroom resources tab', async ({ page }) => {
    await openClassroomTab(page, 'Resources', { dark: true })
    await expect(page).toHaveScreenshot('teacher-classroom-resources-dark.png', { fullPage: true })
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

  test('classroom quizzes tab', async ({ page }) => {
    await openClassroomTab(page, 'Quizzes', { dark: true })
    await expect(page).toHaveScreenshot('student-classroom-quizzes-dark.png', { fullPage: true })
  })

  test('classroom tests tab', async ({ page }) => {
    await openClassroomTab(page, 'Tests', { dark: true })
    await expect(page).toHaveScreenshot('student-classroom-tests-dark.png', { fullPage: true })
  })

  test('classroom calendar tab', async ({ page }) => {
    await openClassroomTab(page, 'Calendar', { dark: true })
    await expect(page).toHaveScreenshot('student-classroom-calendar-dark.png', { fullPage: true })
  })

  test('classroom resources tab', async ({ page }) => {
    await openClassroomTab(page, 'Resources', { dark: true })
    await expect(page).toHaveScreenshot('student-classroom-resources-dark.png', { fullPage: true })
  })

  test('join classroom page', async ({ page }) => {
    await page.goto('/join')
    await waitForContent(page)
    await enableDarkMode(page)
    await expect(page).toHaveScreenshot('student-join-classroom-dark.png', { fullPage: true })
  })
})
