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
 * 5. The default flow asks for the actual first day of class
 * 6. Class-day setup cannot be deferred
 * 7. The last day is revealed only after the first day is selected
 * 8. Last-day guidance points teachers to Settings without an inferred weekday-range label
 */
import type { VerificationScript, VerificationResult, VerificationCheck } from './types'
import { TIMEOUTS } from './types'

export const createClassroomWizard: VerificationScript = {
  name: 'create-classroom-wizard',
  description: 'Verify Create Classroom wizard requires first-day class-day setup',
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

    await page.getByRole('button', { name: 'Classroom actions' }).click()
    const createButton = page.getByRole('menuitem', { name: 'New Classroom' })
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

    // Check wizard/modal is open (modal has heading "Create Classroom")
    const modalHeading = page.getByRole('heading', { name: 'Create Classroom' })
    // Wait for modal to appear instead of using fixed timeout
    const wizardOpen = await modalHeading
      .waitFor({ state: 'visible', timeout: TIMEOUTS.ELEMENT_VISIBLE })
      .then(() => true)
      .catch(() => false)

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

    if (hasNameInput) {
      await nameInput.fill('Class Days Verification')
      await page.getByRole('button', { name: 'Next' }).click()
      const firstDayInput = page.getByLabel('First day of class')
      const deferButton = page.getByRole('button', { name: 'Set up class days later' })
      const lastDayInput = page.getByLabel('Last day of class')
      checks.push({
        name: 'First class day is the default setup',
        passed: await firstDayInput.isVisible().catch(() => false),
      })
      checks.push({
        name: 'Class-day setup cannot be deferred',
        passed: !(await deferButton.isVisible().catch(() => false)),
      })
      const lastDayInitiallyHidden = !(await lastDayInput.isVisible().catch(() => false))
      await firstDayInput.fill('2026-11-30')
      checks.push({
        name: 'Last class day is progressively revealed',
        passed:
          lastDayInitiallyHidden &&
          await lastDayInput.isVisible().catch(() => false) &&
          await lastDayInput.inputValue().catch(() => '') === '2027-01-31',
      })
      checks.push({
        name: 'Guidance points teachers to Settings',
        passed:
          await page.getByText('You can modify this later in Settings.').isVisible().catch(() => false) &&
          await page.getByText(/Every Monday-Friday/).count() === 0,
      })
    }

    const passed = checks.every((c) => c.passed)
    return { scenario: 'create-classroom-wizard', passed, checks }
  },
}
