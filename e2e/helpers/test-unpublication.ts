import { expect, type Page, type TestInfo } from '@playwright/test'

/** Browser contract uses the real teacher/student components; SQL eligibility is
 * exercised separately against the complete disposable migration schema. */
export async function verifyTestUnpublication(page: Page, info: TestInfo) {
  const testId = '30000000-0000-4000-8000-000000000013'
  const classroomId = '30000000-0000-4000-8000-000000000011'
  let status = 'closed'
  let calls = 0
  let release: (() => void) | undefined
  const currentTest = () => ({
    id: testId, classroom_id: classroomId, title: 'Functions and Graphs Test',
    status, assessment_type: 'test', show_results: false, questions_locked_at: null, documents: [],
    position: 0, created_at: '2026-08-27T12:00:00.000Z', updated_at: '2026-08-27T12:00:00.000Z',
    stats: { total_students: 0, responded: 0, submitted: 0, open_access: 0, closed_access: 0, questions_count: 1 },
  })
  const question = { id: '30000000-0000-4000-8000-000000000014', question_type: 'multiple_choice',
    question_text: 'Latest published question?', options: ['Yes', 'No'], correct_option: 0,
    answer_key: null, sample_solution: null, points: 1, response_max_chars: 5000, response_monospace: false }
  await page.route('**/api/teacher/tests**', async route => {
    const url = new URL(route.request().url())
    const json = (body: unknown, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname.endsWith('/unpublish')) {
      expect(route.request().method()).toBe('POST')
      expect(route.request().postDataJSON()).toEqual({})
      calls += 1
      if (calls === 1) return json({ error: 'Test cannot return to draft' }, 409)
      await new Promise<void>(resolve => { release = resolve })
      status = 'draft'
      return json({ test: currentTest(), draft_version: 8 })
    }
    if (url.pathname.endsWith('/results')) return json({ test: currentTest(), questions: [question], students: [], active_ai_grading_run: null })
    if (url.pathname.endsWith('/draft')) return json({ editingPolicy: { structureLocked: false }, draft: { id: 'draft-1', version: 8,
      content: { title: currentTest().title, show_results: false, question_identity_version: 1, questions: [question] } } })
    if (url.pathname === `/api/teacher/tests/${testId}`) return json({ test: currentTest(), questions: [question], draft_version: 8, editingPolicy: { structureLocked: false } })
    if (url.pathname === '/api/teacher/tests') return json({ tests: [currentTest()] })
    return json({ error: 'Unexpected unpublication fixture request' }, 404)
  })
  await page.goto('/e2e-fixtures/teacher-test-grading', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'Edit Functions and Graphs Test' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No student rows yet' })).toBeVisible()
  await page.getByRole('button', { name: 'More actions' }).click()
  await expect(page.getByRole('menuitem', { name: 'Return to draft' })).toBeEnabled()
  await page.getByRole('menuitem', { name: 'Return to draft' }).click()
  const dialog = page.getByRole('dialog', { name: 'Return test to draft?' })
  await expect(dialog).toContainText('Students will no longer see this test.')
  await page.screenshot({ path: info.outputPath('test-return-to-draft-confirmation.png'), animations: 'disabled' })
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  expect(calls).toBe(0)
  await page.getByRole('button', { name: 'More actions' }).click()
  await expect(page.getByRole('menuitem', { name: 'Return to draft' })).toBeEnabled()
  await page.getByRole('menuitem', { name: 'Return to draft' }).click()
  await dialog.getByRole('button', { name: 'Return to draft' }).click()
  await expect(dialog).toContainText('Test cannot return to draft')
  await page.screenshot({ path: info.outputPath('test-return-to-draft-error.png'), animations: 'disabled' })
  await dialog.getByRole('button', { name: 'Return to draft' }).click()
  await expect(dialog.getByRole('button', { name: 'Returning…' })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await page.screenshot({ path: info.outputPath('test-return-to-draft-pending.png'), animations: 'disabled' })
  expect(release).toBeDefined()
  release!()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByText('Test returned to draft', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'More actions' }).click()
  await expect(page.getByRole('menuitem', { name: 'Return to draft' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Edit Test' }).click()
  const editor = page.getByRole('dialog', { name: 'Edit test' })
  await expect(editor.getByRole('button', { name: 'Publish' })).toBeVisible()
  await expect(editor.getByText(question.question_text, { exact: true })).toBeVisible()
  await expect(editor.getByText(/A student has started/)).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('test-return-to-draft-authoring.png'), animations: 'disabled' })

  await page.route('**/api/student/**', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ tests: [], notifications: [], unread_count: 0, count: 0 }) }))
  await page.goto('/e2e-fixtures/student-test-list', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('No tests available.', { exact: true })).toBeVisible()
  await expect(page.getByText(currentTest().title, { exact: true })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('test-return-to-draft-student.png'), animations: 'disabled' })
}
