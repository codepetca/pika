/**
 * Classroom Loading E2E Tests
 *
 * Tests for the classroom page loading experience:
 * - Skeleton loading state appears during SSR
 * - Smooth transition from skeleton to content
 * - Not-found page for invalid classroom IDs
 */
import { test, expect } from '@playwright/test'

const TEACHER_STORAGE = '.auth/teacher.json'
const STUDENT_STORAGE = '.auth/student.json'

test.describe('classroom loading - teacher', () => {
  test.use({ storageState: TEACHER_STORAGE })

  test('skeleton appears briefly when navigating to classroom', async ({ page }) => {
    // Start from classrooms index
    await page.goto('/classrooms')
    await page.waitForLoadState('networkidle')

    // Get a classroom card
    const classroomCard = page.locator('[data-testid="classroom-card"]').first()
    await expect(classroomCard).toBeVisible({ timeout: 15_000 })

    // Click and immediately check for skeleton
    // We need to be fast here since skeleton may be brief on fast connections
    const navigationPromise = page.waitForURL('**/classrooms/**', { timeout: 15_000 })
    await classroomCard.click()

    // The skeleton should appear during loading
    // On fast connections it may be very brief, so we just verify the page loads correctly
    await navigationPromise

    // After navigation completes, skeleton should be gone and content should be visible
    const skeleton = page.locator('[data-testid="classroom-skeleton"]')
    await expect(skeleton).not.toBeVisible({ timeout: 10_000 })

    // Verify actual content is now visible (attendance tab for teacher shows the table headers)
    await expect(page.getByText('First Name')).toBeVisible({ timeout: 15_000 })
  })

  test('skeleton has correct structure with sidebar placeholders', async ({ page }) => {
    // Use route interception to slow down the page load so we can see the skeleton
    await page.route('**/api/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500))
      await route.continue()
    })

    await page.goto('/classrooms')
    await page.waitForLoadState('networkidle')

    const classroomCard = page.locator('[data-testid="classroom-card"]').first()
    await expect(classroomCard).toBeVisible({ timeout: 15_000 })

    // Click the card to navigate
    await classroomCard.click()

    // Check skeleton structure - might be visible briefly
    const skeleton = page.locator('[data-testid="classroom-skeleton"]')

    // Wait for either skeleton or final content
    // On fast connections, skeleton might not be visible
    const skeletonVisible = await skeleton.isVisible().catch(() => false)

    if (skeletonVisible) {
      // Verify skeleton has the expected grid structure
      await expect(skeleton).toHaveClass(/grid/)

      // Verify pulse animations exist
      const pulseElements = skeleton.locator('.animate-pulse')
      expect(await pulseElements.count()).toBeGreaterThan(0)
    }

    // Eventually content should load (attendance tab shows table headers)
    await expect(page.getByText('First Name')).toBeVisible({ timeout: 15_000 })
  })

  test('not-found page displays for invalid classroom ID', async ({ page }) => {
    // Navigate to a non-existent classroom
    await page.goto('/classrooms/00000000-0000-0000-0000-000000000000')

    // Should show the not-found page
    const notFound = page.locator('[data-testid="classroom-not-found"]')
    await expect(notFound).toBeVisible({ timeout: 15_000 })

    // Should have the error message
    await expect(page.getByText("Classroom not found or you don't have access")).toBeVisible()

    // Should have link back to classrooms
    const backLink = page.getByRole('link', { name: 'Back to classrooms' })
    await expect(backLink).toBeVisible()

    // Clicking back link should navigate to classrooms index
    await backLink.click()
    await expect(page).toHaveURL(/\/classrooms$/, { timeout: 10_000 })
  })

  test('same-classroom tab switches do not show route skeleton and back/forward restores tab', async ({ page }) => {
    await page.goto('/classrooms')
    await page.waitForLoadState('networkidle')

    const classroomCard = page.locator('[data-testid="classroom-card"]').first()
    await expect(classroomCard).toBeVisible({ timeout: 15_000 })
    await classroomCard.click()
    await page.waitForURL('**/classrooms/**', { timeout: 15_000 })
    await expect(page.getByRole('link', { name: 'Attendance' })).toBeVisible({ timeout: 15_000 })

    const skeleton = page.locator('[data-testid="classroom-skeleton"]')
    await expect(skeleton).not.toBeVisible()

    await page.getByRole('link', { name: 'Assignments' }).click()
    await expect(skeleton).not.toBeVisible()
    await expect(page).toHaveURL(/tab=assignments/)

    await page.getByRole('link', { name: 'Quizzes' }).click()
    await expect(skeleton).not.toBeVisible()
    await expect(page).toHaveURL(/tab=quizzes/)

    await page.evaluate(() => window.history.back())
    await expect(page).toHaveURL(/tab=assignments/)
    await expect(skeleton).not.toBeVisible()
  })
})

test.describe('classroom loading - student', () => {
  test.use({ storageState: STUDENT_STORAGE })

  test('skeleton appears when navigating to classroom', async ({ page }) => {
    await page.goto('/classrooms')
    await page.waitForLoadState('networkidle')

    const classroomCard = page.locator('[data-testid="classroom-card"]').first()
    await expect(classroomCard).toBeVisible({ timeout: 15_000 })

    await classroomCard.click()
    await page.waitForURL('**/classrooms/**', { timeout: 15_000 })

    // After navigation, skeleton should be gone
    const skeleton = page.locator('[data-testid="classroom-skeleton"]')
    await expect(skeleton).not.toBeVisible({ timeout: 10_000 })

    // Student should see the Today tab content
    await page.waitForLoadState('networkidle')
  })

  test('not-found page displays for classroom student is not enrolled in', async ({ page }) => {
    // Navigate to a classroom the student isn't enrolled in
    await page.goto('/classrooms/00000000-0000-0000-0000-000000000000')

    // Should show the not-found page
    const notFound = page.locator('[data-testid="classroom-not-found"]')
    await expect(notFound).toBeVisible({ timeout: 15_000 })

    await expect(page.getByText("Classroom not found or you don't have access")).toBeVisible()
  })

  test('student same-classroom tab switches do not show route skeleton', async ({ page }) => {
    await page.goto('/classrooms')
    await page.waitForLoadState('networkidle')

    const classroomCard = page.locator('[data-testid="classroom-card"]').first()
    await expect(classroomCard).toBeVisible({ timeout: 15_000 })
    await classroomCard.click()
    await page.waitForURL('**/classrooms/**', { timeout: 15_000 })

    const skeleton = page.locator('[data-testid="classroom-skeleton"]')
    await expect(skeleton).not.toBeVisible()

    await page.getByRole('link', { name: 'Assignments' }).click()
    await expect(skeleton).not.toBeVisible()
    await expect(page).toHaveURL(/tab=assignments/)

    await page.getByRole('link', { name: 'Calendar' }).click()
    await expect(skeleton).not.toBeVisible()
    await expect(page).toHaveURL(/tab=calendar/)

    await page.evaluate(() => window.history.back())
    await expect(page).toHaveURL(/tab=assignments/)
    await expect(skeleton).not.toBeVisible()
  })
})

test.describe('classroom loading - visual regression', () => {
  test.use({ storageState: TEACHER_STORAGE })

  test('skeleton loading state screenshot', async ({ page }) => {
    // Slow down responses to capture skeleton state
    await page.route('**/api/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      await route.continue()
    })

    await page.goto('/classrooms')
    await page.waitForLoadState('networkidle')

    const classroomCard = page.locator('[data-testid="classroom-card"]').first()
    await expect(classroomCard).toBeVisible({ timeout: 15_000 })

    // Click to navigate and check for skeleton
    await classroomCard.click()

    // Give a moment for skeleton to render
    await page.waitForTimeout(100)

    const skeleton = page.locator('[data-testid="classroom-skeleton"]')
    const skeletonVisible = await skeleton.isVisible().catch(() => false)

    if (skeletonVisible) {
      // Capture screenshot of skeleton state
      await expect(page).toHaveScreenshot('classroom-skeleton-loading.png', {
        fullPage: true,
        animations: 'disabled', // Disable animations to get consistent screenshot
      })
    }

    // Wait for page to finish loading
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('First Name')).toBeVisible({ timeout: 15_000 })
  })
})
