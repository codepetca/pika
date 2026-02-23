import { test, expect, request as playwrightRequest, type Locator, type Page } from '@playwright/test'

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

function extractClassroomId(classroomPath: string): string {
  const segments = classroomPath.split('/').filter(Boolean)
  const classroomId = segments.at(-1)
  if (!classroomId) {
    throw new Error(`Unable to parse classroom id from path: ${classroomPath}`)
  }
  return classroomId
}

async function createReleasedAssignment(classroomId: string, title: string): Promise<string> {
  const teacherApi = await playwrightRequest.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    storageState: TEACHER_STORAGE,
  })

  try {
    const dueAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const createResponse = await teacherApi.post('/api/teacher/assignments', {
      data: {
        classroom_id: classroomId,
        title,
        rich_instructions: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Spellcheck verification assignment' }],
            },
          ],
        },
        due_at: dueAt,
      },
    })
    expect(createResponse.ok()).toBeTruthy()

    const createData = (await createResponse.json()) as { assignment?: { id?: string } }
    const assignmentId = createData.assignment?.id
    if (!assignmentId) {
      throw new Error('Assignment creation succeeded but response did not include assignment id')
    }

    const releaseResponse = await teacherApi.post(`/api/teacher/assignments/${assignmentId}/release`)
    expect(releaseResponse.ok()).toBeTruthy()

    return assignmentId
  } finally {
    await teacherApi.dispose()
  }
}

async function deleteAssignment(assignmentId: string): Promise<void> {
  const teacherApi = await playwrightRequest.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    storageState: TEACHER_STORAGE,
  })
  try {
    await teacherApi.delete(`/api/teacher/assignments/${assignmentId}`)
  } finally {
    await teacherApi.dispose()
  }
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
    const classroomId = extractClassroomId(classroomPath)
    const assignmentTitle = `Spellcheck E2E ${Date.now()}`
    const assignmentId = await createReleasedAssignment(classroomId, assignmentTitle)

    try {
      await page.goto(`${classroomPath}?tab=assignments`)
      await page.waitForLoadState('networkidle')

      const assignmentCard = page
        .locator('[data-testid="assignment-card"]')
        .filter({ hasText: assignmentTitle })
        .first()
      await expect(assignmentCard).toBeVisible({ timeout: 15_000 })
      await assignmentCard.click()
      await page.waitForURL(/assignmentId=/, { timeout: 15_000 })

      const instructionsDialog = page.getByRole('dialog').filter({ hasText: 'Instructions' })
      if ((await instructionsDialog.count()) > 0) {
        await instructionsDialog.getByRole('button', { name: 'Close' }).first().click()
      }

      const assignmentEditor = page.locator('.tiptap.ProseMirror.simple-editor').first()
      await expect(assignmentEditor).toBeVisible({ timeout: 15_000 })
      await expectSpellcheckAttributes(assignmentEditor)
    } finally {
      await deleteAssignment(assignmentId)
    }
  })
})
