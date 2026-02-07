import { test, expect, type Page } from '@playwright/test'

const TEACHER_STORAGE = '.auth/teacher.json'

async function openAssignmentModal(page: Page) {
  await page.goto('/classrooms')
  const classroomCard = page.locator('[data-testid="classroom-card"]').first()
  await expect(classroomCard).toBeVisible({ timeout: 15_000 })
  await classroomCard.click()
  await page.waitForURL('**/classrooms/**', { timeout: 15_000 })

  // Navigate to Assignments tab
  await page.getByRole('link', { name: 'Assignments' }).click()
  await page.waitForLoadState('networkidle')

  // Look for a "New Assignment" button or an existing assignment's edit button
  // First try to click on an existing assignment row to edit
  const assignmentRow = page.locator('[data-testid="assignment-row"]').first()
  const hasAssignments = await assignmentRow.isVisible().catch(() => false)

  if (hasAssignments) {
    // Click the assignment row to open the edit modal
    await assignmentRow.click()
  } else {
    // Click "New Assignment" to create one
    const newButton = page.getByRole('button', { name: /new assignment/i })
    await expect(newButton).toBeVisible({ timeout: 5_000 })
    await newButton.click()
  }

  const modal = page.getByRole('dialog')
  await expect(modal).toBeVisible({ timeout: 5000 })
  return modal
}

test.describe('AssignmentModal viewport constraints', () => {
  test.use({ storageState: TEACHER_STORAGE })

  test('modal stays within viewport on small screen', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 500 })
    const modal = await openAssignmentModal(page)

    const viewport = page.viewportSize()!
    const modalBox = await modal.boundingBox()

    expect(modalBox).not.toBeNull()
    if (modalBox) {
      // Modal should not exceed 90% of viewport height
      expect(modalBox.height).toBeLessThanOrEqual(viewport.height * 0.9)
      // Modal should be fully within viewport
      expect(modalBox.y + modalBox.height).toBeLessThanOrEqual(viewport.height)
    }
  })

  test('modal content is scrollable on small viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 400 })
    const modal = await openAssignmentModal(page)

    // Scrollable content area should exist
    const contentArea = modal.locator('.overflow-y-auto').first()
    await expect(contentArea).toBeVisible()

    // Submit button exists and can be scrolled to
    const submitButton = modal.getByRole('button', { name: /done|save/i })
    await expect(submitButton).toBeVisible()

    // Scroll to the submit button and verify it becomes visible in viewport
    await submitButton.scrollIntoViewIfNeeded()
    await expect(submitButton).toBeInViewport()
  })
})
