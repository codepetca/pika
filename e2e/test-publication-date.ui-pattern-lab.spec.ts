import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { mockTableShellReads, TABLE_CLASSROOM_ID } from './helpers/teacher-student-tables'

const id = '30000000-0000-4000-8000-000000000013'
const today = '2026-10-15'
const tomorrow = '2026-10-16'
const question = { id: '60000000-0000-4000-8000-000000000001', test_id: id,
  question_type: 'multiple_choice', question_text: 'Which evidence supports your claim?',
  options: ['Repeated observations', 'A guess'], correct_option: 0, points: 1, position: 0 }
function record(status = 'draft', testDate: string | null = null) {
  return { id, classroom_id: TABLE_CLASSROOM_ID, title: 'Evidence and observations', assessment_type: 'test',
    status, test_date: testDate, questions_locked_at: null, show_results: false, documents: [], position: 0,
    created_by: '30000000-0000-4000-8000-000000000012', created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z',
    stats: { total_students: 0, responded: 0, open_access: 0, questions_count: 1 } }
}
async function capture(page: Page, info: TestInfo, state: string) {
  await page.screenshot({ path: info.outputPath(`${state}.png`), animations: 'disabled' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
}
async function setup(page: Page, info: TestInfo, role: 'teacher' | 'student') {
  await page.clock.setFixedTime(new Date(`${today}T16:00:00Z`))
  await page.addInitScript(theme => localStorage.setItem('theme', theme), info.project.metadata.theme as string)
  await mockTableShellReads(page, role)
}
test.use({ storageState: { cookies: [], origins: [] } })

test('teacher schedules, edits the date, unpublishes and publishes today', async ({ page }, info) => {
  await setup(page, info, 'teacher')
  let saved = record()
  const writes: unknown[] = []
  await page.route('**/api/teacher/tests**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const body = request.method() === 'GET' ? null : request.postDataJSON()
    if (body) writes.push(body)
    if (path === '/api/teacher/tests') return route.fulfill({ json: { tests: [saved] } })
    if (path.endsWith('/results')) return route.fulfill({ json: { test: saved, students: [], questions: [question], active_ai_grading_run: null } })
    if (path.endsWith('/draft')) return route.fulfill({ json: { editingPolicy: { structureLocked: false }, draft: { version: 7, content: { title: saved.title, show_results: false, questions: [question] } } } })
    if (path.endsWith('/unpublish')) saved = { ...saved, status: 'draft' }
    else if (request.method() === 'PATCH') saved = { ...saved, ...body }
    else if (path.endsWith('/publish')) saved = { ...saved, status: 'closed' }
    return route.fulfill({ json: { test: saved, questions: [question], draft_version: 7 } })
  })
  await page.goto('/e2e-fixtures/teacher-student-tables?role=teacher&tab=tests')
  await page.getByText(saved.title, { exact: true }).first().click()
  const publish = page.getByRole('button', { name: 'Publish', exact: true })
  await publish.focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'Publish today' })).toBeFocused()
  await capture(page, info, 'teacher-publish-menu')
  await page.keyboard.press('End')
  await expect(page.getByRole('menuitem', { name: 'Schedule test' })).toBeFocused()
  await page.keyboard.press('Home')
  await expect(page.getByRole('menuitem', { name: 'Publish today' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(publish).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  const picker = page.getByRole('dialog', { name: 'Schedule test', exact: true })
  await expect(picker).toBeVisible()
  await picker.getByLabel('Test date', { exact: true }).fill(tomorrow)
  await capture(page, info, 'teacher-schedule-picker')
  await picker.getByRole('button', { name: 'Schedule', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: 'Publish test?', exact: true })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Publish', exact: true }).click()
  const dateButton = page.getByRole('button', { name: 'Test date: Fri Oct 16', exact: true })
  await expect(dateButton).toBeVisible()
  expect(saved.status).toBe('closed')
  expect(saved.test_date).toBe(tomorrow)
  await capture(page, info, 'teacher-scheduled-date')
  await dateButton.click()
  await expect(page.getByRole('menuitem', { name: 'Unpublish', exact: true })).toBeEnabled()
  await capture(page, info, 'teacher-published-menu')
  await page.getByRole('menuitem', { name: 'Change date', exact: true }).click()
  const change = page.getByRole('dialog', { name: 'Change test date', exact: true })
  await change.getByLabel('Test date', { exact: true }).fill(today)
  await change.getByRole('button', { name: 'Save date', exact: true }).click()
  await page.getByRole('button', { name: 'Test date: Thu Oct 15', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Unpublish', exact: true }).click()
  const unpublish = page.getByRole('dialog', { name: 'Return test to draft?', exact: true })
  await capture(page, info, 'teacher-unpublish-confirm')
  await unpublish.getByRole('button', { name: 'Return to draft', exact: true }).click()
  await expect(publish).toBeVisible()
  await publish.click()
  await page.getByRole('menuitem', { name: 'Publish today', exact: true }).click()
  await confirm.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Test date: Thu Oct 15', exact: true })).toBeVisible()
  expect(saved.test_date).toBe(today)
  await capture(page, info, 'teacher-published-today')
  await page.getByRole('button', { name: `Edit ${saved.title}`, exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Edit test', exact: true })
  await expect(editor.getByRole('button', { name: 'Test date: Thu Oct 15', exact: true })).toBeVisible()
  expect(await editor.getByLabel('Test date', { exact: true }).count()).toBe(0)
  await capture(page, info, 'teacher-editor-date')
  await editor.getByRole('button', { name: 'Test date: Thu Oct 15', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Unpublish', exact: true }).click()
  await unpublish.getByRole('button', { name: 'Return to draft', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(publish).toBeVisible()
  expect(saved.status).toBe('draft')
  await info.attach('synthetic-writes', { body: JSON.stringify(writes), contentType: 'application/json' })
})

test('student keeps a future test on Calendar while hiding it from Tests', async ({ page }, info) => {
  await setup(page, info, 'student')
  const scheduled = { ...record('closed', tomorrow), student_status: 'not_started', effective_access: 'closed', access_state: 'closed' }
  await page.route('**/api/student/tests?**', route => route.fulfill({ json: { tests: [scheduled] } }))
  await page.route('**/api/student/classrooms/*/class-days', route => route.fulfill({ json: { class_days: [12, 13, 14, 15, 16].map(day => ({ id: `day-${day}`, classroom_id: TABLE_CLASSROOM_ID, date: `2026-10-${day}`, is_class_day: true })) } }))
  await page.goto('/e2e-fixtures/teacher-student-tables?role=student&tab=tests')
  await expect(page.getByRole('heading', { name: 'No tests available.', exact: true })).toBeVisible()
  await expect(page.getByText(scheduled.title, { exact: true })).toHaveCount(0)
  await capture(page, info, 'student-tests-hidden')
  await page.goto('/e2e-fixtures/teacher-student-tables?role=student&tab=calendar')
  const calendarTest = page.getByRole('button', { name: `Test: ${scheduled.title}`, exact: true }).first()
  await expect(calendarTest).toBeVisible()
  await capture(page, info, 'student-calendar-future-test')
  await calendarTest.click()
  await expect(page.getByText(`This test is scheduled for ${tomorrow}. Your teacher will open access.`, { exact: true })).toBeVisible()
  await capture(page, info, 'student-scheduled-feedback')
})
