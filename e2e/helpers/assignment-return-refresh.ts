import { expect, type Page, type TestInfo } from '@playwright/test'
import { mockLongTeacherTable, mockTableShellReads, TABLE_CLASSROOM_ID } from './teacher-student-tables'

const assignmentId = '30000000-0000-4000-8000-000000000014'
const studentId = '40000000-0000-4000-8000-000000000001'
const revision = '2026-01-02T12:00:00Z'
const nextRevision = '2026-01-02T13:00:00Z'
const assignment = { id: assignmentId, classroom_id: TABLE_CLASSROOM_ID, title: 'Long roster assignment', instructions_markdown: 'Explain your approach.', due_at: null, is_draft: false, released_at: revision, created_at: revision, updated_at: revision }
const originalDoc = { id: 'fixture-doc', assignment_id: assignmentId, student_id: studentId, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Reviewed assignment work' }] }] }, is_submitted: true, submitted_at: revision, viewed_at: revision, updated_at: revision, score_completion: 7, score_thinking: 8, score_workflow: 9, teacher_feedback_draft: 'Stored comment', graded_at: revision, returned_at: null }

async function shot(page: Page, info: TestInfo, state: string) {
  const path = info.outputPath(state + '.png')
  await page.screenshot({ path, animations: 'disabled' })
  await info.attach(state, { path, contentType: 'image/png' })
}

export async function verifyAssignmentReturnRefresh(page: Page, info: TestInfo) {
  await page.addInitScript(theme => localStorage.setItem('theme', theme), info.project.metadata.theme as string)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockTableShellReads(page, 'teacher')
  await mockLongTeacherTable(page, 'assignment', TABLE_CLASSROOM_ID)
  const f = { pageErrors: [] as string[], consoleErrors: [] as string[],
    writes: [] as Array<{ method: string; url: string; body: Record<string, unknown> }> }
  page.on('pageerror', error => f.pageErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') f.consoleErrors.push(message.text()) })
  // Unknown writes are blocked; all known mutations below are synthetic HTTP replies.
  await page.route('**/api/**', async route => {
    if (route.request().method() === 'GET') return route.fallback()
    f.writes.push({ method: route.request().method(), url: route.request().url(), body: {} })
    await route.abort()
  })
  const comment = 'Comment after Return uses the refreshed revision.'
  const savedRevision = '2026-01-02T14:00:00Z'
  const sentRevision = '2026-01-02T15:00:00Z'
  let serverDoc = { ...originalDoc, graded_by: 'teacher', returned_at: null as string | null,
    teacher_cleared_at: null as string | null, feedback_returned_at: null as string | null }
  let returnAcknowledged = false, postReturnReads = 0
  let acknowledgeReturn!: () => void, releaseRead!: () => void
  const returnGate = new Promise<void>(resolve => { acknowledgeReturn = resolve })
  const readGate = new Promise<void>(resolve => { releaseRead = resolve })
  const record = (request: import('@playwright/test').Request) => {
    expect(request.method()).toBe('POST')
    const body = request.postDataJSON() as Record<string, unknown>
    f.writes.push({ method: request.method(), url: request.url(), body })
    return body
  }
  await page.route('**/api/teacher/assignments/' + assignmentId, route => route.fulfill({ json: {
    assignment, active_ai_grading_run: null,
    students: [{ student_id: studentId, student_email: 'student@example.invalid',
      student_first_name: 'Student 01', student_last_name: 'Alpha01',
      status: returnAcknowledged ? 'returned' : 'submitted_on_time', doc: serverDoc }],
  } }))
  await page.route('**/api/teacher/assignments/' + assignmentId + '/students/' + studentId, async route => {
    if (returnAcknowledged) { postReturnReads += 1; await readGate }
    await route.fulfill({ json: { assignment,
      student: { id: studentId, email: 'student@example.invalid', name: 'Student 01 Alpha01' },
      doc: serverDoc, feedback_entries: [] } })
  })
  await page.route('**/api/teacher/assignments/' + assignmentId + '/return', async route => {
    expect(record(route.request())).toEqual({ student_ids: [studentId] })
    await returnGate
    serverDoc = { ...serverDoc, updated_at: nextRevision, returned_at: nextRevision,
      teacher_cleared_at: nextRevision, feedback_returned_at: nextRevision, teacher_feedback_draft: '' }
    returnAcknowledged = true
    await route.fulfill({ json: { returned_count: 1, cleared_count: 1, created_count: 0,
      returned_student_ids: [studentId], already_returned_count: 0, already_returned_student_ids: [],
      blocked_count: 0, blocked_student_ids: [], missing_count: 0, missing_student_ids: [] } })
  })
  await page.route('**/api/teacher/assignments/' + assignmentId + '/grade', async route => {
    const body = record(route.request())
    if (body.expected_doc_updated_at !== serverDoc.updated_at) {
      return route.fulfill({ status: 409, json: { error: 'Assignment grade changed; reload and retry' } })
    }
    expect(body).toMatchObject({ student_id: studentId, feedback: comment,
      score_completion: 7, score_thinking: 8, score_workflow: 9, save_mode: 'graded' })
    serverDoc = { ...serverDoc, updated_at: savedRevision, teacher_feedback_draft: comment }
    await route.fulfill({ json: { doc: serverDoc } })
  })
  await page.route('**/api/teacher/assignments/' + assignmentId + '/feedback-return', async route => {
    const body = record(route.request())
    expect(body).toEqual({ student_id: studentId, feedback: comment, expected_doc_updated_at: savedRevision })
    serverDoc = { ...serverDoc, updated_at: sentRevision, teacher_feedback_draft: '', feedback_returned_at: sentRevision }
    await route.fulfill({ json: { doc: serverDoc, entry: { id: 'fixture-feedback', assignment_id: assignmentId,
      student_id: studentId, entry_kind: 'teacher_feedback', author_type: 'teacher', body: comment,
      returned_at: sentRevision, created_at: sentRevision, created_by: '30000000-0000-4000-8000-000000000012' } } })
  })
  try {
    await page.goto('/e2e-fixtures/teacher-assignment-grading', { waitUntil: 'domcontentloaded' })
    const composer = page.getByPlaceholder('Leave a comment...', { exact: true })
    await expect(composer).toHaveValue('Stored comment')
    const documentTimeOrigin = await page.evaluate(() => performance.timeOrigin)
    await page.getByRole('button', { name: /^Change assignment layout:/ }).click()
    await page.getByRole('button', { name: /^Student actions for/ }).click()
    await page.getByRole('menuitem', { name: 'Return', exact: true }).click()
    await page.getByRole('dialog', { name: /Return work/ }).getByRole('button', { name: 'Return', exact: true }).click()
    await expect.poll(() => f.writes.length).toBe(1)
    await expect(page.getByRole('dialog', { name: /Return work/ }).getByRole('button', { name: 'Returning...', exact: true })).toBeDisabled()
    await shot(page, info, 'return-pending')
    acknowledgeReturn()
    await expect.poll(() => postReturnReads).toBe(1)
    await expect(page.getByRole('dialog', { name: /Return work/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Send comment', exact: true })).toBeDisabled()
    expect(f.writes).toHaveLength(1)
    await shot(page, info, 'returned-detail-pending')
    releaseRead()
    await expect(composer).toHaveValue('')
    await expect(page.getByLabel('Completion score', { exact: true })).toHaveValue('7')
    await expect(page.getByLabel('Thinking score', { exact: true })).toHaveValue('8')
    await expect(page.getByLabel('Workflow score', { exact: true })).toHaveValue('9')
    await composer.fill(comment)
    await expect.poll(() => f.writes.length).toBe(2)
    expect(f.writes[1].body.expected_doc_updated_at).toBe(nextRevision)
    await expect(page.getByRole('button', { name: /^Student actions for/ })).toBeEnabled()
    await page.getByRole('button', { name: 'Send comment', exact: true }).click()
    await expect(page.getByText(comment, { exact: true })).toBeVisible()
    await expect(composer).toHaveValue('')
    expect(f.writes).toHaveLength(3)
    expect(f.pageErrors).toEqual([])
    expect(f.consoleErrors).toEqual([])
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentTimeOrigin)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.getByText(comment, { exact: true }).scrollIntoViewIfNeeded()
    await shot(page, info, 'comment-sent-without-reload')
    await info.attach('return-revision-receipt', { contentType: 'application/json', body: JSON.stringify({
      theme: info.project.metadata.theme, viewport: page.viewportSize(), postReturnReads,
      dispatchedMethods: f.writes.map(write => write.method), expectedCommentRevision: f.writes[1].body.expected_doc_updated_at,
      expectedSendRevision: f.writes[2].body.expected_doc_updated_at, documentTimeOriginUnchanged: true,
      limits: 'Real parent and grading controller with synthetic intercepted HTTP acknowledgements; no backend, provider or production persistence claim.' }) })
  } finally { acknowledgeReturn(); releaseRead() }
}
