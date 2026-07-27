import { randomUUID } from 'node:crypto'
import { expect, test, type Browser, type Page } from '@playwright/test'

const TEACHER_STORAGE = '.auth/teacher.json'
const STUDENT_STORAGE = '.auth/student.json'

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
  students?: Array<{
    student_id: string
    effective_access?: 'open' | 'closed'
    focus_summary?: TestFocusSummary | null
  }>
}

interface AuthMeRecord {
  user: {
    id: string
    email: string
    role: string
  }
}

interface TestFocusSummary {
  away_count?: number
  away_total_seconds?: number
  route_exit_attempts?: number
  window_unmaximize_attempts?: number
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
  const created = await sendJson<{ test: AssessmentRecord }>(page, 'POST', '/api/teacher/tests', {
    classroom_id: classroomId,
    title,
  })

  const testRecord = created.test
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

async function createActiveOpenResponseTest(
  page: Page,
  classroomId: string,
  title: string,
): Promise<AssessmentRecord> {
  const testRecord = await createDraftOpenResponseTest(page, classroomId, title)
  await sendJson(page, 'PATCH', `/api/teacher/tests/${testRecord.id}`, {
    status: 'active',
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

async function withStudentPage<T>(
  browser: Browser,
  callback: (page: Page) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext({ storageState: STUDENT_STORAGE })
  const page = await context.newPage()
  try {
    await page.goto('/classrooms', { waitUntil: 'domcontentloaded' })
    return await callback(page)
  } finally {
    await context.close()
  }
}

async function findSharedClassroom(studentPage: Page, teacherPage: Page): Promise<ClassroomRecord> {
  const [studentData, teacherData] = await Promise.all([
    loadJson<{ classrooms?: ClassroomRecord[] }>(studentPage, '/api/student/classrooms'),
    loadJson<{ classrooms?: ClassroomRecord[] }>(teacherPage, '/api/teacher/classrooms'),
  ])

  const teacherClassroomIds = new Set((teacherData.classrooms || []).map((classroom) => classroom.id))
  const sharedClassroom = (studentData.classrooms || []).find((classroom) =>
    teacherClassroomIds.has(classroom.id)
  )

  expect(
    sharedClassroom,
    'Seed teacher and student auth users with at least one shared classroom before running teacher telemetry e2e tests.',
  ).toBeTruthy()
  return sharedClassroom!
}

async function cleanupTest(page: Page, testId: string | null): Promise<void> {
  if (!testId) return
  await sendJson(page, 'DELETE', `/api/teacher/tests/${testId}`).catch(() => undefined)
}

async function prepareExamWindowForViewportCompliance(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: () => Promise.resolve(),
    })
    Object.defineProperty(window.screen, 'availWidth', {
      configurable: true,
      value: 1440,
    })
    Object.defineProperty(window.screen, 'availHeight', {
      configurable: true,
      value: 900,
    })
  })
}

function getResultsStatus(results: TestResultsRecord): 'draft' | 'active' | 'closed' | undefined {
  return results.test?.status
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

  test('shows student route, window, and away telemetry in the grading row', async ({ browser, page }) => {
    test.setTimeout(120_000)
    let testId: string | null = null

    try {
      await page.goto('/classrooms', { waitUntil: 'domcontentloaded' })

      const testTitle = uniqueTitle()
      const { classroom, studentId } = await withStudentPage(browser, async (studentPage) => {
        const shared = await findSharedClassroom(studentPage, page)
        const testRecord = await createActiveOpenResponseTest(page, shared.id, testTitle)
        testId = testRecord.id

        const currentStudent = await loadJson<AuthMeRecord>(studentPage, '/api/auth/me')

        await studentPage.goto(`/classrooms/${shared.id}?tab=tests`, { waitUntil: 'domcontentloaded' })
        await studentPage.getByRole('button', { name: new RegExp(escapeRegExp(testTitle)) }).first().click()
        await prepareExamWindowForViewportCompliance(studentPage)

        await studentPage.getByRole('button', { name: 'Start the Test' }).click()
        await studentPage.getByRole('button', { name: 'Start test' }).click()

        const splitShell = studentPage.locator('[data-testid="student-test-split-container"]')
        await expect(splitShell).toBeVisible({ timeout: 15_000 })

        const responseBox = studentPage.locator('textarea[placeholder="Write your response..."]')
        await expect(responseBox).toBeVisible()
        await responseBox.fill('Teacher telemetry should distinguish route, window, and focus events.')
        await expect(studentPage.getByText('Saved')).toBeVisible({ timeout: 20_000 })

        await studentPage.getByRole('link', { name: 'Home' }).click()
        await expect(studentPage).toHaveURL(new RegExp(`/classrooms/${escapeRegExp(shared.id)}\\?tab=tests`))

        await studentPage.setViewportSize({ width: 900, height: 500 })
        await expect(studentPage.locator('[data-testid="exam-content-obscurer"]')).toBeVisible({ timeout: 5_000 })
        await studentPage.setViewportSize({ width: 1440, height: 900 })
        await expect(studentPage.locator('[data-testid="exam-content-obscurer"]')).toHaveCount(0)

        await studentPage.evaluate(() => window.dispatchEvent(new Event('blur')))
        await studentPage.waitForTimeout(1100)
        await studentPage.evaluate(() => window.dispatchEvent(new Event('focus')))

        await expect.poll(async () => {
          if (!testId) return { awayCount: 0, awaySeconds: 0, routeExits: 0, windowExits: 0 }
          const results = await loadJson<TestResultsRecord>(page, `/api/teacher/tests/${testId}/results`)
          const student = (results.students || []).find((candidate) => candidate.student_id === currentStudent.user.id)
          return {
            awayCount: student?.focus_summary?.away_count ?? 0,
            awaySeconds: student?.focus_summary?.away_total_seconds ?? 0,
            routeExits: student?.focus_summary?.route_exit_attempts ?? 0,
            windowExits: student?.focus_summary?.window_unmaximize_attempts ?? 0,
          }
        }).toEqual({
          awayCount: 1,
          awaySeconds: expect.any(Number),
          routeExits: 1,
          windowExits: 1,
        })

        await expect.poll(async () => {
          if (!testId) return 0
          const results = await loadJson<TestResultsRecord>(page, `/api/teacher/tests/${testId}/results`)
          const student = (results.students || []).find((candidate) => candidate.student_id === currentStudent.user.id)
          return student?.focus_summary?.away_total_seconds ?? 0
        }).toBeGreaterThanOrEqual(1)

        return { classroom: shared, studentId: currentStudent.user.id }
      })

      await page.goto(`/classrooms/${classroom.id}?tab=tests&testId=${testId}&testMode=grading`, {
        waitUntil: 'domcontentloaded',
      })

      const gradingRow = page.getByTestId(`test-grading-student-row-${studentId}`)
      await expect(gradingRow).toBeVisible({ timeout: 15_000 })
      await expect(
        gradingRow.getByLabel(/Exits [1-9]\. Away\/focus 1, in-app exits 1, window\/full-screen exits 1\./),
      ).toBeVisible()
      const positiveAwayDurationPattern = '(?:0:0[1-9]|0:[1-5]\\d|[1-9]\\d*:[0-5]\\d)'
      await expect(
        gradingRow.getByLabel(
          new RegExp(
            `Away time ${positiveAwayDurationPattern}\\. ` +
              `Away from test route for ${positiveAwayDurationPattern} total\\.`,
          ),
        ),
      ).toBeVisible()
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined)
      await cleanupTest(page, testId)
    }
  })
})
