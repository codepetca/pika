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

interface StudentTestDetailRecord {
  focus_summary?: {
    route_exit_attempts?: number
  } | null
}

function uniqueTitle(): string {
  return `Exam Mode E2E ${Date.now()}`
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

async function withTeacherPage<T>(
  browser: Browser,
  callback: (page: Page) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext({ storageState: TEACHER_STORAGE })
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
    'Seed teacher and student auth users with at least one shared classroom before running student exam-mode e2e tests.',
  ).toBeTruthy()
  return sharedClassroom!
}

async function createActiveOpenResponseTest(
  teacherPage: Page,
  classroomId: string,
  title: string,
): Promise<AssessmentRecord> {
  const created = await sendJson<{ quiz: AssessmentRecord }>(teacherPage, 'POST', '/api/teacher/tests', {
    classroom_id: classroomId,
    title,
  })

  const testRecord = created.quiz
  const draft = await loadJson<{ draft: AssessmentDraftRecord }>(
    teacherPage,
    `/api/teacher/tests/${testRecord.id}/draft`,
  )

  const questionId = crypto.randomUUID()
  const content = {
    ...draft.draft.content,
    title,
    show_results: false,
    questions: [
      {
        id: questionId,
        question_type: 'open_response',
        question_text: 'Explain how you would preserve draft work during exam-mode lock and restoration.',
        options: [],
        correct_option: null,
        answer_key: 'Draft work should stay mounted or be restored from the saved attempt.',
        sample_solution: null,
        points: 5,
        response_max_chars: 2000,
        response_monospace: false,
      },
    ],
  }

  await sendJson(teacherPage, 'PATCH', `/api/teacher/tests/${testRecord.id}/draft`, {
    version: draft.draft.version,
    content,
  })
  await sendJson(teacherPage, 'PATCH', `/api/teacher/tests/${testRecord.id}`, {
    status: 'active',
  })

  return testRecord
}

async function cleanupTest(browser: Browser, testId: string | null): Promise<void> {
  if (!testId) return
  await withTeacherPage(browser, async (teacherPage) => {
    await sendJson(teacherPage, 'DELETE', `/api/teacher/tests/${testId}`).catch(() => undefined)
  })
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

test.describe('student exam mode', () => {
  test.use({ storageState: STUDENT_STORAGE })

  test('locks content only after sustained window loss and preserves open-response drafts', async ({ browser, page }) => {
    test.setTimeout(90_000)
    let testId: string | null = null

    try {
      await page.goto('/classrooms', { waitUntil: 'domcontentloaded' })

      const testTitle = uniqueTitle()
      const classroom = await withTeacherPage(browser, async (teacherPage) => {
        const shared = await findSharedClassroom(page, teacherPage)
        const testRecord = await createActiveOpenResponseTest(teacherPage, shared.id, testTitle)
        testId = testRecord.id
        return shared
      })

      await page.goto(`/classrooms/${classroom.id}?tab=tests`, { waitUntil: 'domcontentloaded' })
      const testCard = page.getByRole('button', { name: new RegExp(testTitle) }).first()
      await expect(testCard).toBeVisible({ timeout: 15_000 })
      await testCard.click()
      await prepareExamWindowForViewportCompliance(page)

      await page.getByRole('button', { name: 'Start the Test' }).click()
      await page.getByRole('button', { name: 'Start test' }).click()

      const splitShell = page.locator('[data-testid="student-test-split-container"]')
      await expect(splitShell).toBeVisible({ timeout: 15_000 })

      const responseBox = page.locator('textarea[placeholder="Write your response..."]')
      await expect(responseBox).toBeVisible()
      await responseBox.fill('Draft survives exam-mode lock and reload.')
      await expect(page.getByText('Saved')).toBeVisible({ timeout: 20_000 })

      await page.setViewportSize({ width: 900, height: 500 })
      await page.setViewportSize({ width: 1440, height: 900 })
      await expect(page.locator('[data-testid="exam-content-obscurer"]')).toHaveCount(0)
      await expect(responseBox).toHaveValue('Draft survives exam-mode lock and reload.')

      await page.setViewportSize({ width: 900, height: 500 })
      const obscurer = page.locator('[data-testid="exam-content-obscurer"]')
      await expect(obscurer).toBeVisible({ timeout: 5_000 })
      await expect(page.locator('[data-testid="exam-interaction-blocker"]')).toBeVisible()
      await expect(responseBox).toBeHidden()

      await page.setViewportSize({ width: 1440, height: 900 })
      await expect(obscurer).toHaveCount(0)
      await expect(responseBox).toBeVisible()
      await expect(responseBox).toHaveValue('Draft survives exam-mode lock and reload.')

      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: new RegExp(testTitle) }).first().click()
      await prepareExamWindowForViewportCompliance(page)
      await page.getByRole('button', { name: 'Start the Test' }).click()
      await page.getByRole('button', { name: 'Start test' }).click()
      await expect(splitShell).toBeVisible({ timeout: 15_000 })
      await expect(responseBox).toHaveValue('Draft survives exam-mode lock and reload.')
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined)
      await cleanupTest(browser, testId)
    }
  })

  test('blocks home navigation during an active exam and preserves the draft response', async ({ browser, page }) => {
    test.setTimeout(90_000)
    let testId: string | null = null

    try {
      await page.goto('/classrooms', { waitUntil: 'domcontentloaded' })

      const testTitle = uniqueTitle()
      const classroom = await withTeacherPage(browser, async (teacherPage) => {
        const shared = await findSharedClassroom(page, teacherPage)
        const testRecord = await createActiveOpenResponseTest(teacherPage, shared.id, testTitle)
        testId = testRecord.id
        return shared
      })

      await page.goto(`/classrooms/${classroom.id}?tab=tests`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: new RegExp(testTitle) }).first().click()
      await prepareExamWindowForViewportCompliance(page)

      await page.getByRole('button', { name: 'Start the Test' }).click()
      await page.getByRole('button', { name: 'Start test' }).click()

      const splitShell = page.locator('[data-testid="student-test-split-container"]')
      await expect(splitShell).toBeVisible({ timeout: 15_000 })

      const responseBox = page.locator('textarea[placeholder="Write your response..."]')
      await expect(responseBox).toBeVisible()
      await responseBox.fill('Draft remains visible after a blocked route exit.')
      await expect(page.getByText('Saved')).toBeVisible({ timeout: 20_000 })

      await page.getByRole('link', { name: 'Home' }).click()

      await expect(page).toHaveURL(new RegExp(`/classrooms/${escapeRegExp(classroom.id)}\\?tab=tests`))
      await expect(splitShell).toBeVisible()
      await expect(responseBox).toHaveValue('Draft remains visible after a blocked route exit.')

      await expect.poll(async () => {
        if (!testId) return 0
        const detail = await loadJson<StudentTestDetailRecord>(page, `/api/student/tests/${testId}`)
        return detail.focus_summary?.route_exit_attempts ?? 0
      }).toBeGreaterThanOrEqual(1)
      await expect(page.getByLabel(/Exits [1-9]/)).toBeVisible()
    } finally {
      await cleanupTest(browser, testId)
    }
  })
})
