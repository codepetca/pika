/**
 * Keyboard Shortcuts E2E Tests
 *
 * Tests for panel toggle keyboard shortcuts:
 * - Cmd/Ctrl+B: Toggle left sidebar
 * - Cmd/Ctrl+Shift+B: Toggle right sidebar
 */
import { test, expect } from '@playwright/test'

const TEACHER_STORAGE = '.auth/teacher.json'

// Helper to wait for page to be fully loaded
async function waitForContent(page: any) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(300)
}

// Get the modifier key based on platform
function getModifier(page: any): 'Meta' | 'Control' {
  // Playwright runs on the server, so we check the test config or default to Meta for Mac-like behavior
  return process.platform === 'darwin' ? 'Meta' : 'Control'
}

test.describe('keyboard shortcuts', () => {
  test.use({ storageState: TEACHER_STORAGE })

  test('Cmd/Ctrl+B toggles left sidebar', async ({ page }) => {
    await page.goto('/classrooms')
    const classroomCard = page.locator('[data-testid="classroom-card"]').first()
    await expect(classroomCard).toBeVisible({ timeout: 15_000 })
    await classroomCard.click()
    await page.waitForURL('**/classrooms/**', { timeout: 15_000 })
    await waitForContent(page)

    // Get initial left sidebar state - check if expanded (has nav text visible)
    const navText = page.getByRole('link', { name: 'Attendance' })
    const initiallyExpanded = await navText.isVisible()

    // Press Cmd/Ctrl+B to toggle
    const modifier = getModifier(page)
    await page.keyboard.press(`${modifier}+b`)
    await page.waitForTimeout(300)

    // Verify state changed
    if (initiallyExpanded) {
      // Should now be collapsed - nav text should be hidden
      await expect(navText).not.toBeVisible()
    } else {
      // Should now be expanded - nav text should be visible
      await expect(navText).toBeVisible()
    }

    // Press again to toggle back
    await page.keyboard.press(`${modifier}+b`)
    await page.waitForTimeout(300)

    // Verify back to original state
    if (initiallyExpanded) {
      await expect(navText).toBeVisible()
    } else {
      await expect(navText).not.toBeVisible()
    }
  })

  test('Cmd/Ctrl+Shift+B toggles right sidebar on calendar tab', async ({ page }) => {
    await page.goto('/classrooms')
    const classroomCard = page.locator('[data-testid="classroom-card"]').first()
    await expect(classroomCard).toBeVisible({ timeout: 15_000 })
    await classroomCard.click()
    await page.waitForURL('**/classrooms/**', { timeout: 15_000 })

    // Navigate to calendar tab
    await page.getByRole('link', { name: 'Calendar' }).click()
    await waitForContent(page)

    // Right sidebar should be closed initially
    const sidebarTitle = page.getByText('Calendar').locator('visible=true')

    // Press Cmd/Ctrl+Shift+B to open right sidebar
    const modifier = getModifier(page)
    await page.keyboard.press(`${modifier}+Shift+b`)
    await page.waitForTimeout(500)

    // Verify sidebar opened - look for the Save button in sidebar header
    const saveButton = page.getByRole('button', { name: 'Save' })
    await expect(saveButton).toBeVisible({ timeout: 5000 })

    // Press again to close
    await page.keyboard.press(`${modifier}+Shift+b`)
    await page.waitForTimeout(300)

    // Verify sidebar closed
    await expect(saveButton).not.toBeVisible()
  })

  test('keyboard shortcuts do not trigger when typing in textarea', async ({ page }) => {
    await page.goto('/classrooms')
    const classroomCard = page.locator('[data-testid="classroom-card"]').first()
    await expect(classroomCard).toBeVisible({ timeout: 15_000 })
    await classroomCard.click()
    await page.waitForURL('**/classrooms/**', { timeout: 15_000 })

    // Navigate to calendar tab
    await page.getByRole('link', { name: 'Calendar' }).click()
    await waitForContent(page)

    // Open the sidebar first
    const modifier = getModifier(page)
    await page.keyboard.press(`${modifier}+Shift+b`)
    await page.waitForTimeout(500)

    // Find and focus the textarea
    const textarea = page.locator('textarea')
    await expect(textarea).toBeVisible({ timeout: 5000 })
    await textarea.focus()

    // Get the current sidebar state (should be open)
    const saveButton = page.getByRole('button', { name: 'Save' })
    await expect(saveButton).toBeVisible()

    // Try pressing Cmd/Ctrl+Shift+B while in textarea - should NOT close sidebar
    await page.keyboard.press(`${modifier}+Shift+b`)
    await page.waitForTimeout(300)

    // Sidebar should still be open (shortcut was ignored)
    await expect(saveButton).toBeVisible()
  })
})
