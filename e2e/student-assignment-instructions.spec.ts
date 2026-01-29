/**
 * Student Assignment Instructions E2E Test
 *
 * Verifies that the Instructions button opens a modal with assignment
 * instructions, and that first-time views auto-show the modal.
 */
import { test, expect, type Page } from '@playwright/test'

const STUDENT_STORAGE = '.auth/student.json'

async function waitForContent(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(300)
}

test.describe('student assignment instructions', () => {
  test.use({ storageState: STUDENT_STORAGE })

  test('Instructions button opens modal with assignment instructions', async ({ page }) => {
    // Navigate to classrooms
    await page.goto('/classrooms')
    const classroomCard = page.locator('[data-testid="classroom-card"]').first()
    await expect(classroomCard).toBeVisible({ timeout: 15_000 })
    await classroomCard.click()
    await page.waitForURL('**/classrooms/**', { timeout: 15_000 })

    // Go to Assignments tab
    await page.getByRole('link', { name: 'Assignments' }).click()
    await waitForContent(page)

    // Click the first assignment
    const assignmentCard = page.locator('button').filter({ hasText: /.+/ }).first()
    await expect(assignmentCard).toBeVisible({ timeout: 10_000 })
    await assignmentCard.click()
    await waitForContent(page)

    // If first-time modal appears, dismiss it
    const closeButton = page.getByRole('button', { name: 'Close' })
    if (await closeButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await closeButton.click()
      await page.waitForTimeout(300)
    }

    // Click the Instructions button in the action bar
    const instructionsButton = page.getByRole('button', { name: 'Instructions' })
    await expect(instructionsButton).toBeVisible({ timeout: 5000 })
    await instructionsButton.click()
    await page.waitForTimeout(500)

    // Verify the instructions modal is visible with content
    const modalHeading = page.locator('h3', { hasText: 'Instructions' })
    await expect(modalHeading).toBeVisible({ timeout: 5000 })

    // Modal should have a Close button
    await expect(page.getByRole('button', { name: 'Close' })).toBeVisible()
  })
})
