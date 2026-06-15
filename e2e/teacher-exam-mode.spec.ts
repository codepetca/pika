import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

const TEACHER_STORAGE = '.auth/teacher.json'

interface ClassroomRecord {
  id: string
  title?: string | null
}

interface AssessmentRecord {
  id: string
  title: string
}

interface AssessmentDraftRecord {
  version: number
  content: {
    title: string
    show_results: boolean
    questions: unknown[]
  }
}

interface TestResultsRecord {
  test?: {
    status?: 'draft' | 'active' | 'closed'
  }
  quiz?: {
    status?: 'draft' | 'active' | 'closed'
  }
  students?: Array<{
    student_id: string
    effective_access?: 'open' | 'closed'
  }>
}

function uniqueTitle(): string {
  return `Teacher Exam Mode E2E ${Date.now()}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function loadJson<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (apiPath) => {
    const response = await fetch(apiPath)
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data?.error || `Failed to load ${apiPath}: ${response.status}`)
    }
    return data
  }, path) as Promise<T>
}

async function sendJson<T>(
  page: Page,
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  return page.evaluate(async ({ apiPath, payload, requestMethod }) => {
    const response = await fetch(apiPath, {
      method: requestMethod,
      headers: payload ? { 'Content-Type': 'application/json' } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data?.error || `Failed to ${requestMethod} ${apiPath}: ${response.status}`)
    }
    return data
  }, { apiPath: path, payload: body, requestMethod: method }) as Promise<T>
}

async function createDraftOpenResponseTest(
  page: Page,
  classroomId: string,
  title: string,
): Promise<AssessmentRecord> {
  const created = await sendJson<{ quiz: AssessmentRecord }>(page, 'POST', '/api/teacher/tests', {
    classroom_id: classroomId,
    title,
  })

  const testRecord = created.quiz
  const draft = await loadJson<{ draft: AssessmentDraftRecord }>(
    page,
    `/api/teacher/tests/${testRecord.id}/draft`,
  )

  await sendJson(page, 'PATCH', `/api/teacher/tests/${testRecord.id}/draft`, {
    version: draft.draft.version,
    content: {
      ...draft.draft.content,
      title,
      show_results: false,
      questions: [
        {
          id: randomUUID(),
          question_type: 'open_response',
          question_text: 'Explain how closing exam access affects student test availability.',
          options: [],
          correct_option: null,
          answer_key: 'Closed access should block further test taking while preserving work for grading.',
          sample_solution: null,
          points: 5,
          response_max_chars: 2000,
          response_monospace: false,
        },
      ],
    },
  })

  return testRecord
}

async function createDraftTestInClassroomWithStudents(page: Page, title: string): Promise<{
  classroom: ClassroomRecord
  testRecord: AssessmentRecord
  studentCount: number
}> {
  const data = await loadJson<{ classrooms?: ClassroomRecord[] }>(page, '/api/teacher/classrooms')
  const classrooms = data.classrooms || []

  for (const classroom of classrooms) {
    const testRecord = await createDraftOpenResponseTest(page, classroom.id, title)
    const results = await loadJson<TestResultsRecord>(page, `/api/teacher/tests/${testRecord.id}/results`)
    const studentCount = results.students?.length || 0

    if (studentCount > 0) {
      return { classroom, testRecord, studentCount }
    }

    await sendJson(page, 'DELETE', `/api/teacher/tests/${testRecord.id}`).catch(() => undefined)
  }

  expect(
    classrooms.length,
    'Seed a teacher classroom with at least one enrolled student before running teacher exam-mode e2e tests.',
  ).toBeGreaterThan(0)
  throw new Error('No seeded teacher classroom has enrolled students.')
}

async function cleanupTest(page: Page, testId: string | null): Promise<void> {
  if (!testId) return
  await sendJson(page, 'DELETE', `/api/teacher/tests/${testId}`).catch(() => undefined)
}

function getResultsStatus(results: TestResultsRecord): 'draft' | 'active' | 'closed' | undefined {
  return results.test?.status ?? results.quiz?.status
}

test.describe('teacher exam mode', () => {
  test.use({ storageState: TEACHER_STORAGE })

  test('activates a draft test and closes all student access from the grading workspace', async ({ page }) => {
    test.setTimeout(90_000)
    let testId: string | null = null

    try {
      await page.goto('/classrooms', { waitUntil: 'domcontentloaded' })

      const testTitle = uniqueTitle()
      const { classroom, testRecord, studentCount } = await createDraftTestInClassroomWithStudents(page, testTitle)
      testId = testRecord.id

      await page.goto(`/classrooms/${classroom.id}?tab=tests`, { waitUntil: 'domcontentloaded' })
      const testButton = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(testTitle)}$`) })
      await expect(testButton).toBeVisible({ timeout: 15_000 })

      const testCard = testButton.locator('xpath=ancestor::div[contains(@class, "rounded-card")][1]')
      await expect(testCard.getByText('Draft', { exact: true })).toBeVisible()
      await expect(testCard.getByLabel('0 open')).toBeVisible()
      await expect(testCard.getByLabel(`${studentCount} closed`)).toBeVisible()

      await testButton.click()
      await expect(page.locator('[data-test-grading-student-row]').first()).toBeVisible({ timeout: 15_000 })

      await page.getByRole('button', { name: 'Open All' }).click()
      await expect(page.getByText('Activate test?')).toBeVisible()
      await page.getByRole('button', { name: 'Activate' }).click()

      await expect.poll(async () => {
        const results = await loadJson<TestResultsRecord>(page, `/api/teacher/tests/${testRecord.id}/results`)
        return getResultsStatus(results)
      }).toBe('active')

      await expect(page.getByRole('button', { name: 'Open All' })).toBeVisible()
      await page.getByRole('button', { name: 'Open All' }).click()
      await expect(page.getByText(`Open access for ${studentCount} student(s)?`)).toBeVisible()
      await page.getByRole('button', { name: 'Open Access', exact: true }).click()

      await expect.poll(async () => {
        const results = await loadJson<TestResultsRecord>(page, `/api/teacher/tests/${testRecord.id}/results`)
        const students = results.students || []
        return {
          studentCount: students.length,
          openCount: students.filter((student) => student.effective_access === 'open').length,
        }
      }).toEqual({ studentCount, openCount: studentCount })
      await expect(page.getByRole('button', { name: 'Close All' })).toBeVisible()
      await expect(page.locator('[data-test-grading-student-row]').first().getByRole('button', {
        name: /Access open.*Close access/,
      })).toBeVisible()

      await page.getByRole('button', { name: 'Close All' }).click()
      await expect(page.getByText(`Close access for ${studentCount} student(s)?`)).toBeVisible()
      await page.getByRole('button', { name: 'Close Access', exact: true }).click()

      await expect.poll(async () => {
        const results = await loadJson<TestResultsRecord>(page, `/api/teacher/tests/${testRecord.id}/results`)
        const students = results.students || []
        return {
          studentCount: students.length,
          closedCount: students.filter((student) => student.effective_access === 'closed').length,
        }
      }).toEqual({ studentCount, closedCount: studentCount })
      await expect(page.getByRole('button', { name: 'Open All' })).toBeVisible()
      await expect(page.locator('[data-test-grading-student-row]').first().getByRole('button', {
        name: /Access closed for this student\. Open access/,
      })).toBeVisible()

      await page.getByRole('link', { name: 'Tests' }).click()
      await expect(testCard.getByText('Closed', { exact: true })).toBeVisible()
      await expect(testCard.getByLabel('0 open')).toBeVisible()
      await expect(testCard.getByLabel(`${studentCount} closed`)).toBeVisible()
    } finally {
      await cleanupTest(page, testId)
    }
  })
})
