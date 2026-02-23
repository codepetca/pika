import { test, expect, type Locator, type Page } from '@playwright/test'

const TEACHER_STORAGE = '.auth/teacher.json'
const STUDENT_STORAGE = '.auth/student.json'

async function openFirstClassroom(page: Page): Promise<string> {
  await page.goto('/classrooms')
  await page.waitForLoadState('networkidle')

  const classroomCard = page.locator('[data-testid="classroom-card"]').first()
  await expect(classroomCard).toBeVisible({ timeout: 15_000 })
  await classroomCard.click()
  await page.waitForURL('**/classrooms/**', { timeout: 15_000 })

  return new URL(page.url()).pathname
}

async function expectSpellcheckAttributes(editor: Locator): Promise<void> {
  await expect(editor).toHaveJSProperty('spellcheck', true)
  await expect(editor).toHaveAttribute('autocorrect', 'on')
  await expect(editor).toHaveAttribute('autocapitalize', 'sentences')
}

test.describe('editor spellcheck attributes - teacher', () => {
  test.use({ storageState: TEACHER_STORAGE })

  test('class resources editor enables native spellcheck attributes', async ({ page }) => {
    const classroomPath = await openFirstClassroom(page)
    await page.goto(`${classroomPath}?tab=resources&section=class-resources`)

    const editor = page.locator('.tiptap.ProseMirror.simple-editor').first()
    await expect(editor).toBeVisible({ timeout: 15_000 })
    await expectSpellcheckAttributes(editor)
  })
})

test.describe('editor spellcheck attributes - student', () => {
  test.use({ storageState: STUDENT_STORAGE })

  test('student writable editor enables native spellcheck attributes', async ({ page }) => {
    const classroomPath = await openFirstClassroom(page)
    await page.goto(`${classroomPath}?tab=today`)

    const todayEditor = page.locator('.tiptap.ProseMirror.simple-editor').first()

    // Some dates are not class days, so fall back to assignment editor when needed.
    if ((await todayEditor.count()) > 0) {
      await expect(todayEditor).toBeVisible({ timeout: 15_000 })
      await expectSpellcheckAttributes(todayEditor)
      return
    }

    await page.getByRole('link', { name: 'Assignments' }).click()
    await page.waitForLoadState('networkidle')

    const assignmentLink = page.locator('a[href*="/assignments/"]').first()
    if ((await assignmentLink.count()) === 0) {
      test.skip(true, 'No writable student editor found in today or assignments tabs')
      return
    }

    await assignmentLink.click()
    await page.waitForURL('**/assignments/**', { timeout: 15_000 })

    const assignmentEditor = page.locator('.tiptap.ProseMirror.simple-editor').first()
    await expect(assignmentEditor).toBeVisible({ timeout: 15_000 })
    await expectSpellcheckAttributes(assignmentEditor)
  })
})
