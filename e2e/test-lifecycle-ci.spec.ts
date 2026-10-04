import { randomUUID } from 'node:crypto'
import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test'
import { createIsolatedLifecycleFixture } from './helpers/isolated-test-lifecycle'

type OwnedFixture = Awaited<ReturnType<typeof createIsolatedLifecycleFixture>>
type Attempt = { responses: Record<string, unknown>; draft_revision: number; is_submitted: boolean }
type Answer = { response_id: string; response_revision: number; score: number | null; selected_option: number | null; response_text: string | null }
type Results = { students: Array<{ student_id: string; returned_at: string | null; answers: Record<string, Answer>; focus_summary: { route_exit_attempts: number; window_unmaximize_attempts: number } | null }> }
const test = base.extend<{ owned: OwnedFixture }>({
  owned: async ({}, runFixture) => {
    const owned = await createIsolatedLifecycleFixture()
    try { await runFixture(owned) } finally { await owned.cleanup() }
  },
})
async function json<T>(request: APIRequestContext, method: string, path: string, data?: unknown, status = 200): Promise<T> {
  const response = await request.fetch(path, { method, data })
  const body: unknown = await response.json()
  expect(response.status(), `${method} ${path} failed`).toBe(status)
  return body as T
}
async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('School Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await expect(page).toHaveURL(/\/classrooms/)
}
async function createTest(request: APIRequestContext, owned: OwnedFixture, mixed: boolean) {
  const title = `Lifecycle smoke ${randomUUID()}`
  const created = await json<{ test: { id: string } }>(request, 'POST', '/api/teacher/tests', { classroom_id: owned.classroomId, title }, 201)
  const id = created.test.id
  const draft = await json<{ draft: { version: number; content: Record<string, unknown> } }>(request, 'GET', `/api/teacher/tests/${id}/draft`)
  const openId = randomUUID(), mcId = randomUUID()
  const open = { id: openId, question_type: 'open_response', question_text: 'Explain your reasoning.', options: [], correct_option: null, answer_key: 'A reasoned response', sample_solution: null, points: 5, response_max_chars: 2000, response_monospace: false }
  const mc = { id: mcId, question_type: 'multiple_choice', question_text: 'Choose the correct answer.', options: ['Alpha', 'Beta'], correct_option: 1, answer_key: null, sample_solution: null, points: 5, response_max_chars: 2000, response_monospace: false }
  await json(request, 'PATCH', `/api/teacher/tests/${id}/draft`, { version: draft.draft.version, content: { ...draft.draft.content, title, show_results: false, questions: mixed ? [mc, open] : [open] } })
  await json(request, 'PATCH', `/api/teacher/tests/${id}`, { status: 'active' })
  return { id, title, openId, mcId }
}
async function start(page: Page, classroomId: string, title: string) {
  await page.goto(`/classrooms/${classroomId}?tab=tests`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: new RegExp(title) }).first().click()
  // Headless Chromium has no physical desktop/fullscreen window. Only screen
  // geometry/fullscreen capability are controlled; APIs and persisted data are real.
  await page.evaluate(() => {
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: () => Promise.resolve() })
    Object.defineProperty(window.screen, 'availWidth', { configurable: true, value: 1440 })
    Object.defineProperty(window.screen, 'availHeight', { configurable: true, value: 900 })
  })
  await page.getByRole('button', { name: 'Start the Test', exact: true }).click()
  await page.getByRole('button', { name: 'Start test', exact: true }).click()
  await expect(page.getByTestId('student-test-split-container')).toBeVisible()
}
async function saveText(page: Page, value: string) {
  await page.getByRole('textbox', { name: /Response for question/ }).fill(value)
  await expect(page.getByTestId('student-test-autosave-status')).toHaveText('Unsaved changes')
  await expect(page.getByTestId('student-test-autosave-status')).toHaveText('Saved', { timeout: 25_000 })
}
async function teacherResults(request: APIRequestContext, id: string, studentId: string) {
  const result = await json<Results>(request, 'GET', `/api/teacher/tests/${id}/results`)
  const student = result.students.find((row) => row.student_id === studentId)
  expect(student).toBeDefined()
  return student!
}

test('real desktop exam: revision saves, lock/restore, reload and teacher telemetry', async ({ browser, owned }) => {
  test.setTimeout(120_000)
  const teacherContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const studentContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  try {
    const teacher = await teacherContext.newPage(), student = await studentContext.newPage()
    await login(teacher, owned.teacherEmail, owned.password)
    await login(student, owned.studentEmail, owned.password)
    const exam = await createTest(teacherContext.request, owned, false)
    await start(student, owned.classroomId, exam.title)
    const initial = await json<{ attempt: Attempt }>(studentContext.request, 'GET', `/api/student/tests/${exam.id}/attempt`)
    expect(initial.attempt.draft_revision).toBeGreaterThan(0)
    await saveText(student, 'Saved reasoning survives exam interruption.')
    const current = await json<{ attempt: Attempt }>(studentContext.request, 'GET', `/api/student/tests/${exam.id}/attempt`)
    expect(current.attempt.draft_revision).toBeGreaterThan(initial.attempt.draft_revision)
    const stale = await json<{ error_code: string; attempt: Attempt }>(studentContext.request, 'PATCH', `/api/student/tests/${exam.id}/attempt`, { expected_revision: initial.attempt.draft_revision, responses: {} }, 409)
    expect(stale.error_code).toBe('test_attempt_revision_conflict')
    expect(stale.attempt).toMatchObject(current.attempt)
    await json(studentContext.request, 'PATCH', `/api/student/tests/${exam.id}/attempt`, { responses: {} }, 400)
    await student.setViewportSize({ width: 900, height: 500 })
    await student.setViewportSize({ width: 1440, height: 900 })
    await expect(student.getByTestId('exam-content-obscurer')).toHaveCount(0)
    await student.setViewportSize({ width: 900, height: 500 })
    await expect(student.getByTestId('exam-content-obscurer')).toBeVisible({ timeout: 10_000 })
    await expect(student.getByTestId('exam-interaction-blocker')).toBeVisible()
    await student.setViewportSize({ width: 1440, height: 900 })
    await expect(student.getByTestId('exam-content-obscurer')).toHaveCount(0)
    await expect(student.getByRole('textbox', { name: /Response for question/ })).toHaveValue('Saved reasoning survives exam interruption.')
    await student.reload({ waitUntil: 'domcontentloaded' })
    await start(student, owned.classroomId, exam.title)
    await expect(student.getByRole('textbox', { name: /Response for question/ })).toHaveValue('Saved reasoning survives exam interruption.')
    await expect.poll(async () => (await teacherResults(teacherContext.request, exam.id, owned.studentId)).focus_summary?.window_unmaximize_attempts ?? 0).toBeGreaterThanOrEqual(1)
    await expect.poll(async () => (await teacherResults(teacherContext.request, exam.id, owned.studentId)).focus_summary?.route_exit_attempts ?? 0).toBeGreaterThanOrEqual(1)
  } finally {
    await studentContext.close()
    await teacherContext.close()
  }
})

test('real desktop lifecycle: closure zero, reopen, submit, grade clear and idempotent Return', async ({ browser, owned }) => {
  test.setTimeout(150_000)
  const teacherContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const studentContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  try {
    const teacher = await teacherContext.newPage(), student = await studentContext.newPage()
    await login(teacher, owned.teacherEmail, owned.password)
    await login(student, owned.studentEmail, owned.password)
    const exam = await createTest(teacherContext.request, owned, true)
    const selected = { student_ids: [owned.studentId] }
    await start(student, owned.classroomId, exam.title)
    await saveText(student, 'Draft survives teacher closure.')
    await json(teacherContext.request, 'POST', `/api/teacher/tests/${exam.id}/student-access`, { ...selected, state: 'closed' })
    await student.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(student.getByText('This test is closed.', { exact: true })).toBeVisible()
    await expect(student.getByRole('textbox', { name: /Response for question/ })).toBeHidden()
    const closed = await teacherResults(teacherContext.request, exam.id, owned.studentId)
    expect(closed.answers[exam.mcId]).toMatchObject({ selected_option: null, score: 0 })
    expect(closed.answers[exam.openId].score).toBeNull()
    expect(await json(teacherContext.request, 'POST', `/api/teacher/tests/${exam.id}/return`, selected)).toMatchObject({ returned_count: 0, skipped_count: 1 })
    await json(studentContext.request, 'GET', `/api/student/tests/${exam.id}/results`, undefined, 403)
    await json(teacherContext.request, 'POST', `/api/teacher/tests/${exam.id}/student-access`, { ...selected, state: 'open' })
    await start(student, owned.classroomId, exam.title)
    await expect(student.getByRole('textbox', { name: /Response for question/ })).toHaveValue('Draft survives teacher closure.')
    await student.getByRole('radio', { name: 'Beta', exact: true }).check()
    await expect(student.getByTestId('student-test-autosave-status')).toHaveText('Unsaved changes')
    await expect(student.getByTestId('student-test-autosave-status')).toHaveText('Saved', { timeout: 25_000 })
    const submitted = student.waitForResponse((response) => response.url().endsWith(`/api/student/tests/${exam.id}/respond`) && response.request().method() === 'POST')
    await student.getByRole('button', { name: 'Submit', exact: true }).click()
    await student.getByRole('dialog', { name: 'Submit your answers?' }).getByRole('button', { name: 'Submit', exact: true }).click()
    expect((await submitted).status()).toBe(201)
    await json(teacherContext.request, 'POST', `/api/teacher/tests/${exam.id}/student-access`, { ...selected, state: 'closed' })
    const ungraded = await teacherResults(teacherContext.request, exam.id, owned.studentId)
    const open = ungraded.answers[exam.openId]
    await json(teacherContext.request, 'PATCH', `/api/teacher/tests/${exam.id}/students/${owned.studentId}/grades`, { grades: [{ question_id: exam.openId, response_id: open.response_id, expected_response_revision: open.response_revision, score: 4, feedback: 'Reviewed' }] })
    expect(await json(teacherContext.request, 'POST', `/api/teacher/tests/${exam.id}/return`, selected)).toMatchObject({ returned_count: 1, skipped_count: 0 })
    const published = await json<{ test: { returned_at: string }; my_responses: unknown[] }>(studentContext.request, 'GET', `/api/student/tests/${exam.id}/results`)
    expect(published.test.returned_at).toBeTruthy()
    expect(published.my_responses).toHaveLength(2)
    expect(await json(teacherContext.request, 'POST', `/api/teacher/tests/${exam.id}/return`, selected)).toMatchObject({ returned_count: 0, already_returned_count: 1 })
    const graded = await teacherResults(teacherContext.request, exam.id, owned.studentId)
    await json(teacherContext.request, 'POST', `/api/teacher/tests/${exam.id}/clear-open-grades`, { ...selected, responses: [{ response_id: graded.answers[exam.openId].response_id, expected_response_revision: graded.answers[exam.openId].response_revision }] })
    expect((await teacherResults(teacherContext.request, exam.id, owned.studentId)).returned_at).toBeNull()
    await json(studentContext.request, 'GET', `/api/student/tests/${exam.id}/results`, undefined, 403)
    expect(await json(teacherContext.request, 'POST', `/api/teacher/tests/${exam.id}/return`, selected)).toMatchObject({ returned_count: 0, skipped_count: 1 })
  } finally {
    await studentContext.close()
    await teacherContext.close()
  }
})
