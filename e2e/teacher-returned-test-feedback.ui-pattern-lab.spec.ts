import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { mockLongTeacherTable, mockTableShellReads, TABLE_CLASSROOM_ID } from './helpers/teacher-student-tables'

const testId = '30000000-0000-4000-8000-000000000013'
const studentId = '40000000-0000-4000-8000-000000000001'
const revision = '2026-03-08T12:05:00.000Z'
const returnedFeedback = 'Returned feedback stays visible: explain the concentration difference.'
const newComment = 'New local comment: add the direction of water movement.'

async function capture(page: Page, info: TestInfo, state: string) {
  const path = info.outputPath(`${state}.png`)
  await page.screenshot({ path, animations: 'disabled', caret: 'initial' })
  await info.attach(state, { path, contentType: 'image/png' })
}

test.use({ storageState: { cookies: [], origins: [] } })

test('returned Test feedback stays visible beside an empty composer and a new local draft', async ({ page }, info) => {
  await page.addInitScript(theme => localStorage.setItem('theme', theme), info.project.metadata.theme as string)
  await mockTableShellReads(page, 'teacher')
  await mockLongTeacherTable(page, 'test', TABLE_CLASSROOM_ID)
  await page.route(`**/api/teacher/tests/${testId}/results`, route => route.fulfill({ json: {
    test: { id: testId, title: 'Long roster test', status: 'active' },
    questions: [{ id: 'q-open-1', question_text: 'Explain osmosis.', question_type: 'open_response',
      options: [], correct_option: null, points: 5 }],
    students: [{ student_id: studentId, name: 'Student 01 Alpha01', first_name: 'Student 01',
      last_name: 'Alpha01', email: 'student1@example.invalid', status: 'returned',
      submitted_at: revision, returned_at: revision, last_activity_at: revision,
      points_earned: 4, points_possible: 5, percent: 80,
      graded_open_responses: 1, ungraded_open_responses: 0,
      access_state: 'closed', effective_access: 'closed', access_source: 'test', focus_summary: null,
      answers: { 'q-open-1': { response_id: 'response-1', response_revision: 1,
        question_type: 'open_response', selected_option: null,
        response_text: 'Water moves to balance concentration.', score: 4,
        feedback: returnedFeedback, graded_at: revision } } }],
    active_ai_grading_run: null,
  } }))
  const writes: string[] = []
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  // Every GET is synthetic; no write can reach the backend, even if a regression dispatches one.
  await page.route('**/api/**', async route => {
    if (route.request().method() === 'GET') return route.fallback()
    writes.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`)
    await route.abort()
  })
  await page.goto('/e2e-fixtures/teacher-student-tables?role=teacher&tab=tests', { waitUntil: 'domcontentloaded' })
  await page.getByText('Long roster test', { exact: true }).first().click()
  const students = page.getByTestId('test-grading-student-scroll-pane')
  await expect(students).toBeVisible()
  await students.getByText('Student 01', { exact: true }).first().click()
  const inspector = page.getByTestId('test-grading-inspector-scroll-pane')
  const composer = inspector.getByPlaceholder('Leave a comment...', { exact: true })
  await expect(inspector.getByText(returnedFeedback, { exact: true })).toBeVisible()
  await expect(composer).toBeVisible()
  await expect(composer).toHaveValue('')
  await expect(inspector.getByLabel('Q1 score', { exact: true })).toHaveValue('4')
  await composer.scrollIntoViewIfNeeded()
  await capture(page, info, 'returned-feedback-empty-composer')

  // Freeze before editing, after initial data and inspector disclosure settle. Do not blur:
  // blur intentionally flushes autosave independently of its timer.
  await page.clock.install()
  await page.clock.pauseAt(new Date())
  const originalComposer = await composer.elementHandle()
  await composer.focus()
  await page.keyboard.type(newComment)
  await expect(composer).toBeFocused()
  await expect(composer).toHaveValue(newComment)
  await expect(inspector.getByText(returnedFeedback, { exact: true })).toBeVisible()
  await expect(inspector.getByLabel('Q1 score', { exact: true })).toHaveValue('4')
  expect(await composer.evaluate((element, original) => element === original, originalComposer)).toBe(true)
  expect(writes).toEqual([])
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await capture(page, info, 'returned-feedback-focused-local-draft')
  await info.attach('returned-test-feedback-receipt', {
    body: JSON.stringify({ theme: info.project.metadata.theme, viewport: page.viewportSize(),
      writes, pageErrors, consoleErrors, returnedFeedbackVisible: true, initialComposerEmpty: true,
      newLocalDraft: newComment, sameComposer: true, keyboardFocusRetained: true,
      limitations: 'Synthetic intercepted GETs and blocked writes. Clock paused before editing and composer kept focused, preventing timer and blur autosave. This is visual/local-draft evidence, not a backend persistence test.' }, null, 2),
    contentType: 'application/json',
  })
})
