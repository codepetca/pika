/**
 * Verification: Create Classroom Wizard
 *
 * Minimal verification that the classroom creation flow exists.
 *
 * Checks:
 * 1. Can navigate to classrooms page
 * 2. Create Classroom button is visible
 * 3. Wizard/modal opens when button is clicked
 * 4. Name input field is present
 */
import type { VerificationScript, VerificationResult, VerificationCheck } from './types'

export const createClassroomWizard: VerificationScript = {
  name: 'create-classroom-wizard',
  description: 'Verify Create Classroom wizard opens with name input',
  role: 'teacher',

  async run(page, baseUrl): Promise<VerificationResult> {
    const checks: VerificationCheck[] = []

    // Navigate to classrooms
    await page.goto(`${baseUrl}/classrooms`)
    await page.waitForLoadState('domcontentloaded')

    checks.push({
      name: 'Navigate to classrooms page',
      passed: true,
    })

    // Look for New Classroom button (aria-label is "New classroom")
    const createButton = page.getByRole('button', { name: /new.*classroom/i })
    const hasCreateButton = await createButton.isVisible().catch(() => false)

    checks.push({
      name: 'Create Classroom button visible',
      passed: hasCreateButton,
      message: hasCreateButton ? undefined : 'Could not find Create Classroom button',
    })

    if (!hasCreateButton) {
      return { scenario: 'create-classroom-wizard', passed: false, checks }
    }

    // Click to open wizard
    await createButton.click()
    await page.waitForTimeout(500) // Wait for modal animation

    // Check wizard/modal is open (modal has heading "Create Classroom")
    const modalHeading = page.getByRole('heading', { name: 'Create Classroom' })
    const wizardOpen = await modalHeading.isVisible().catch(() => false)

    checks.push({
      name: 'Wizard opens on click',
      passed: wizardOpen,
      message: wizardOpen ? undefined : 'Wizard did not open after clicking create button',
    })

    if (!wizardOpen) {
      return { scenario: 'create-classroom-wizard', passed: false, checks }
    }

    // Check for name input (Step 1) - find input with label "Classroom Name"
    const nameInput = page.getByLabel('Classroom Name')
    const hasNameInput = await nameInput.isVisible().catch(() => false)

    checks.push({
      name: 'Name input present in wizard',
      passed: hasNameInput,
      message: hasNameInput ? undefined : 'Could not find name input in wizard',
    })

    const passed = checks.every((c) => c.passed)
    return { scenario: 'create-classroom-wizard', passed, checks }
  },
}
