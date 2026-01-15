/**
 * Verification: Add Students Modal
 *
 * Minimal verification that the "Add Students" functionality exists
 * in the teacher roster view.
 *
 * Checks:
 * 1. Can navigate to roster tab
 * 2. Add Students button is visible
 * 3. Modal opens when button is clicked
 */
import type { VerificationScript, VerificationResult, VerificationCheck } from './types'

export const addStudentsModal: VerificationScript = {
  name: 'add-students-modal',
  description: 'Verify Add Students modal opens from roster tab',
  role: 'teacher',

  async run(page, baseUrl): Promise<VerificationResult> {
    const checks: VerificationCheck[] = []

    // Navigate to classrooms
    await page.goto(`${baseUrl}/classrooms`)
    await page.waitForLoadState('networkidle')

    // Click first classroom card
    const classroomCard = page.locator('.bg-white.dark\\:bg-gray-900 button').first()

    // Wait for card to be visible (with longer timeout)
    try {
      await classroomCard.waitFor({ state: 'visible', timeout: 10000 })
    } catch {
      checks.push({
        name: 'Classroom card visible',
        passed: false,
        message: 'No classroom found. Run pnpm seed first.',
      })
      return { scenario: 'add-students-modal', passed: false, checks }
    }

    checks.push({
      name: 'Classroom card visible',
      passed: true,
    })

    await classroomCard.click()
    // Wait for classroom detail page (URL has a UUID after /classrooms/)
    await page.waitForURL(/\/classrooms\/[a-f0-9-]+/, { timeout: 15000 })

    // Go to Roster tab
    await page.getByRole('button', { name: 'Roster' }).click()
    await page.waitForLoadState('networkidle')

    checks.push({
      name: 'Navigate to roster tab',
      passed: true,
    })

    // Look for Add Students button (may have various names)
    const addButton = page.getByRole('button', { name: /add/i })
    const hasAddButton = await addButton.first().isVisible().catch(() => false)

    checks.push({
      name: 'Add button visible',
      passed: hasAddButton,
      message: hasAddButton ? undefined : 'Could not find add button on roster tab',
    })

    if (!hasAddButton) {
      return { scenario: 'add-students-modal', passed: false, checks }
    }

    // Click to open modal
    await addButton.first().click()
    await page.waitForTimeout(500) // Wait for modal animation

    // Check modal is open (modal has heading "Add Students")
    const modalHeading = page.getByRole('heading', { name: 'Add Students' })
    const modalOpen = await modalHeading.isVisible().catch(() => false)

    checks.push({
      name: 'Modal opens on click',
      passed: modalOpen,
      message: modalOpen ? undefined : 'Modal did not open after clicking add button',
    })

    const passed = checks.every((c) => c.passed)
    return { scenario: 'add-students-modal', passed, checks }
  },
}
