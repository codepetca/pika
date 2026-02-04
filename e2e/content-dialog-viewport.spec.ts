/**
 * ContentDialog Viewport Constraint E2E Test
 *
 * Verifies that ContentDialog stays within viewport bounds when content
 * is tall or the viewport is small. Tests the fix for issue #265.
 */
import { test, expect, type Page } from '@playwright/test'

const STUDENT_STORAGE = '.auth/student.json'

/**
 * Navigate to an assignment and open the instructions modal.
 * Returns the modal locator for further assertions.
 */
async function openInstructionsModal(page: Page) {
  // Navigate to classrooms and enter one
  await page.goto('/classrooms')
  const classroomCard = page.locator('[data-testid="classroom-card"]').first()
  await expect(classroomCard).toBeVisible({ timeout: 15_000 })
  await classroomCard.click()
  await page.waitForURL('**/classrooms/**', { timeout: 15_000 })

  // Go to Assignments tab
  await page.getByRole('link', { name: 'Assignments' }).click()
  await page.waitForLoadState('networkidle')

  // Click the first assignment to open it (navigates via URL params)
  const assignmentCard = page.locator('[data-testid="assignment-card"]').first()
  await expect(assignmentCard).toBeVisible({ timeout: 10_000 })
  await assignmentCard.click()

  // Wait for URL to include assignmentId (indicating we're in edit view)
  await page.waitForURL(/assignmentId=/, { timeout: 10_000 })
  await page.waitForLoadState('networkidle')

  // The modal should auto-open for first-time views, or we click Instructions button
  const modal = page.getByRole('dialog')
  const instructionsButton = page.getByRole('button', { name: 'Instructions' })

  // Wait a moment for potential auto-open
  await page.waitForTimeout(500)

  // If modal didn't auto-open, click the Instructions button
  if (!(await modal.isVisible().catch(() => false))) {
    await expect(instructionsButton).toBeVisible({ timeout: 5000 })
    await instructionsButton.click()
  }

  await expect(modal).toBeVisible({ timeout: 5000 })
  return modal
}

test.describe('ContentDialog viewport constraints', () => {
  test.use({ storageState: STUDENT_STORAGE })

  test('modal stays within viewport on small screen with long content', async ({ page }) => {
    // Use a constrained viewport - wide enough for desktop nav, short to test height constraint
    await page.setViewportSize({ width: 1024, height: 500 })

    const modal = await openInstructionsModal(page)

    // Get viewport and modal dimensions
    const viewport = page.viewportSize()!
    const modalBox = await modal.boundingBox()

    expect(modalBox).not.toBeNull()
    if (modalBox) {
      // Modal should not extend beyond viewport (with some padding tolerance)
      const maxAllowedHeight = viewport.height * 0.9 // 85vh + some tolerance
      const maxAllowedWidth = viewport.width * 0.95 // 90vw + some tolerance

      expect(modalBox.height).toBeLessThanOrEqual(maxAllowedHeight)
      expect(modalBox.width).toBeLessThanOrEqual(maxAllowedWidth)

      // Modal should be fully visible (not cut off at edges)
      expect(modalBox.y).toBeGreaterThanOrEqual(0)
      expect(modalBox.x).toBeGreaterThanOrEqual(0)
      expect(modalBox.y + modalBox.height).toBeLessThanOrEqual(viewport.height)
      expect(modalBox.x + modalBox.width).toBeLessThanOrEqual(viewport.width)
    }
  })

  test('modal content is scrollable when it exceeds available height', async ({ page }) => {
    // Constrained height viewport to force scrolling
    await page.setViewportSize({ width: 1024, height: 400 })

    const modal = await openInstructionsModal(page)

    // Find the scrollable content area (has overflow-y-auto class)
    const contentArea = modal.locator('.overflow-y-auto').first()
    await expect(contentArea).toBeVisible()

    // Verify the Close button in footer is visible (not pushed off screen)
    const closeButton = modal.getByRole('button', { name: 'Close' }).last()
    await expect(closeButton).toBeVisible()
    await expect(closeButton).toBeInViewport()
  })
})
