import { expect, test, type Page } from '@playwright/test'

const TEACHER_STORAGE = '.auth/teacher.json'

interface ClassroomRecord {
  id: string
  title?: string | null
}

interface AssessmentRecord {
  id: string
  title: string
  stats?: {
    total_students?: number
    responded?: number
  }
}

interface TestGradingStudentRecord {
  student_id: string
  name: string | null
  email: string
  status: 'not_started' | 'in_progress' | 'submitted' | 'returned'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function loadJson<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (apiPath) => {
    const response = await fetch(apiPath)
    if (!response.ok) {
      throw new Error(`Failed to load ${apiPath}: ${response.status}`)
    }
    return response.json()
  }, path) as Promise<T>
}

async function loadTeacherClassroom(page: Page): Promise<ClassroomRecord> {
  await page.goto('/classrooms', { waitUntil: 'domcontentloaded' })

  const data = await loadJson<{ classrooms?: ClassroomRecord[] }>(page, '/api/teacher/classrooms')
  const classrooms = data.classrooms || []
  const classroom =
    classrooms.find((candidate) => candidate.title?.toLowerCase().includes('test classroom')) ||
    classrooms[0]

  expect(classroom, 'Seed a teacher classroom before running assessment URL-state e2e tests.').toBeTruthy()
  return classroom!
}

async function loadTeacherTestWithStudent(page: Page, classroomId: string): Promise<{
  testRecord: AssessmentRecord
  student: TestGradingStudentRecord
}> {
  const data = await loadJson<{ quizzes?: AssessmentRecord[]; tests?: AssessmentRecord[] }>(
    page,
    `/api/teacher/tests?classroom_id=${encodeURIComponent(classroomId)}`,
  )
  const tests = data.tests || data.quizzes || []
  const preferredTests = [
    ...tests.filter((candidate) => Number(candidate.stats?.responded || 0) > 0),
    ...tests.filter((candidate) => Number(candidate.stats?.responded || 0) <= 0),
  ]

  for (const testRecord of preferredTests) {
    const results = await loadJson<{ students?: TestGradingStudentRecord[] }>(
      page,
      `/api/teacher/tests/${encodeURIComponent(testRecord.id)}/results`,
    )
    const student =
      (results.students || []).find((candidate) => candidate.status !== 'not_started') ||
      (results.students || [])[0]
    if (student) {
      return { testRecord, student }
    }
  }

  throw new Error('Seed a teacher test with enrolled students before running assessment URL-state e2e tests.')
}

async function expectSearchParam(page: Page, name: string, expected: string): Promise<void> {
  await expect.poll(() => new URL(page.url()).searchParams.get(name)).toBe(expected)
}

async function expectNoSearchParam(page: Page, name: string): Promise<void> {
  await expect.poll(() => new URL(page.url()).searchParams.has(name)).toBe(false)
}

async function expectSummaryUrl(page: Page, classroomId: string, tab: 'tests'): Promise<void> {
  await expect.poll(() => {
    const url = new URL(page.url())
    const params = url.searchParams
    return {
      pathname: url.pathname,
      tab: params.get('tab'),
      quizId: params.get('quizId'),
      testId: params.get('testId'),
      testMode: params.get('testMode'),
      testStudentId: params.get('testStudentId'),
    }
  }).toEqual({
    pathname: `/classrooms/${classroomId}`,
    tab,
    quizId: null,
    testId: null,
    testMode: null,
    testStudentId: null,
  })
}

test.describe('teacher assessment URL state', () => {
  test.use({ storageState: TEACHER_STORAGE })

  test('Tests deep links, browser Back, and active-nav reset preserve the work-surface ladder', async ({ page }) => {
    const classroom = await loadTeacherClassroom(page)
    const { testRecord, student } = await loadTeacherTestWithStudent(page, classroom.id)
    const studentLabel = student.name || student.email

    await page.goto(`/classrooms/${classroom.id}?tab=tests&testId=${testRecord.id}`, {
      waitUntil: 'domcontentloaded',
    })

    await expect(page.getByRole('tab', { name: 'Authoring' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText(testRecord.title).first()).toBeVisible()
    await expectSearchParam(page, 'testId', testRecord.id)
    await expectNoSearchParam(page, 'testStudentId')

    await page.goto(`/classrooms/${classroom.id}?tab=tests`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: 'New Test' })).toBeVisible()

    await page.getByRole('button', { name: new RegExp(escapeRegExp(testRecord.title)) }).first().click()
    await expectSearchParam(page, 'testId', testRecord.id)

    await page.getByRole('tab', { name: 'Grading' }).click()
    await expectSearchParam(page, 'testMode', 'grading')
    await expect(page.getByText(studentLabel).first()).toBeVisible({ timeout: 15_000 })

    await page.getByText(studentLabel).first().click()
    await expectSearchParam(page, 'testStudentId', student.student_id)

    await page.goBack()
    await expectSearchParam(page, 'testMode', 'grading')
    await expectNoSearchParam(page, 'testStudentId')
    await expect(page.getByText(studentLabel).first()).toBeVisible()

    await page.goBack()
    await expectSummaryUrl(page, classroom.id, 'tests')
    await expect(page.getByRole('button', { name: 'New Test' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Authoring' })).toHaveCount(0)

    await page.goto(
      `/classrooms/${classroom.id}?tab=tests&testId=${testRecord.id}&testMode=grading&testStudentId=${student.student_id}`,
      { waitUntil: 'domcontentloaded' },
    )
    await expectSearchParam(page, 'testStudentId', student.student_id)

    await page.getByRole('link', { name: 'Tests' }).click()
    await expectSummaryUrl(page, classroom.id, 'tests')
    await expect(page.getByRole('button', { name: 'New Test' })).toBeVisible()
  })
})
