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
import { TIMEOUTS } from './types'

export const addStudentsModal: VerificationScript = {
  name: 'add-students-modal',
  description: 'Verify Add Students modal opens from roster tab',
  role: 'teacher',

  async run(page, baseUrl): Promise<VerificationResult> {
    const checks: VerificationCheck[] = []

    // Navigate to classrooms
    await page.goto(`${baseUrl}/classrooms`)
    await page.waitForLoadState('domcontentloaded')

    // Click first classroom card
    const classroomCard = page.locator('[data-testid="classroom-card"]').first()

    // Wait for card to be visible
    try {
      await classroomCard.waitFor({ state: 'visible', timeout: TIMEOUTS.ELEMENT_VISIBLE })
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
    await page.waitForURL(/\/classrooms\/[a-f0-9-]+/, { timeout: TIMEOUTS.NAVIGATION })

    // Go to Roster tab
    await page.getByRole('link', { name: 'Roster' }).click()
    await page.waitForLoadState('domcontentloaded')

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

    // Check modal is open (modal has heading "Add Students")
    const modalHeading = page.getByRole('heading', { name: 'Add Students' })
    // Wait for modal to appear instead of using fixed timeout
    const modalOpen = await modalHeading
      .waitFor({ state: 'visible', timeout: TIMEOUTS.ELEMENT_VISIBLE })
      .then(() => true)
      .catch(() => false)

    checks.push({
      name: 'Modal opens on click',
      passed: modalOpen,
      message: modalOpen ? undefined : 'Modal did not open after clicking add button',
    })

    const passed = checks.every((c) => c.passed)
    return { scenario: 'add-students-modal', passed, checks }
  },
}
