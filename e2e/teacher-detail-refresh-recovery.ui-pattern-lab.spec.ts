import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { mockLongTeacherTable, mockTableShellReads, TABLE_CLASSROOM_ID } from './helpers/teacher-student-tables'

const assignmentId = '30000000-0000-4000-8000-000000000014'
const studentId = '40000000-0000-4000-8000-000000000001'
const revision = '2026-01-02T12:00:00Z'
const nextRevision = '2026-01-02T13:00:00Z'
const localComment = Array.from({ length: 36 }, (_, i) => `Draft observation ${i + 1}: explain your evidence and reasoning.`).join('\n')
const assignment = { id: assignmentId, classroom_id: TABLE_CLASSROOM_ID, title: 'Long roster assignment', instructions_markdown: 'Explain your approach.', due_at: null, is_draft: false, released_at: revision, created_at: revision, updated_at: revision }
const originalDoc = { id: 'fixture-doc', assignment_id: assignmentId, student_id: studentId, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Reviewed assignment work' }] }] }, is_submitted: true, submitted_at: revision, viewed_at: revision, updated_at: revision, score_completion: 7, score_thinking: 8, score_workflow: 9, teacher_feedback_draft: 'Stored comment', graded_at: revision, returned_at: null }

test.use({ video: 'on', trace: 'retain-on-failure' })

async function shot(page: Page, info: TestInfo, state: string) {
  const path = info.outputPath(`${state}.png`)
  await page.screenshot({ path, animations: 'allow', caret: 'initial' })
  await info.attach(state, { path, contentType: 'image/png' })
}

async function fixture(page: Page, info: TestInfo, motion: 'reduce' | 'no-preference') {
  await page.addInitScript(theme => localStorage.setItem('theme', theme), info.project.metadata.theme as string)
  // Controlled body-read rejection: HTTP stays200; only the selected response's json() rejects once.
  // This verifies feature handling, not a physical interrupted-connection experiment.
  await page.addInitScript(detailPath => {
    const originalJson = Response.prototype.json
    Response.prototype.json = function () {
      if ((window as any).__rejectTeacherDetailBodyOnce && this.url && new URL(this.url).pathname === detailPath) {
        ;(window as any).__rejectTeacherDetailBodyOnce = false
        return Promise.reject(new TypeError('Controlled response-body network failure'))
      }
      return originalJson.call(this)
    }
  }, `/api/teacher/assignments/${assignmentId}/students/${studentId}`)
  await page.emulateMedia({ reducedMotion: motion })
  await mockTableShellReads(page, 'teacher')
  await mockLongTeacherTable(page, 'assignment', TABLE_CLASSROOM_ID)
  const pageErrors: string[] = [], consoleErrors: string[] = []
  const writes: Array<{ method: string; url: string; body: Record<string, unknown> }> = []
  page.on('pageerror', e => pageErrors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  let completed = false, readMode: 'success' | 'held' | 'protected' = 'success', readCount = 0, protectedStatus = 403
  let remoteDoc = originalDoc, releaseRead: (() => void) | undefined
  await page.route(`**/api/teacher/assignments/${assignmentId}`, route => route.fulfill({ json: {
    assignment, students: [{ student_id: studentId, student_email: 'student@example.invalid', student_first_name: 'Student 01', student_last_name: 'Alpha01', status: 'submitted_on_time', doc: originalDoc }],
    active_ai_grading_run: completed ? { id: 'completed-fixture-run', assignment_id: assignmentId, status: 'completed', requested_count: 1, gradable_count: 1, processed_count: 1, completed_count: 1, skipped_missing_count: 0, skipped_empty_count: 0, failed_count: 0, pending_count: 0, error_samples: [], created_at: revision } : null,
  } }))
  await page.route(`**/api/teacher/assignments/${assignmentId}/students/*`, async route => {
    readCount += 1
    if (readMode === 'held') await new Promise<void>(resolve => { releaseRead = resolve })
    if (readMode === 'protected') return route.fulfill({ status: protectedStatus, json: { error: 'Protected diagnostic detail must not appear' } })
    await route.fulfill({ json: { assignment, student: { id: studentId, email: 'student@example.invalid', name: 'Student 01 Alpha01' }, doc: remoteDoc, feedback_entries: [] } })
  })
  await page.route('**/api/**', async route => {
    const request = route.request()
    if (request.method() === 'GET') return route.fallback()
    const body = request.postDataJSON() as Record<string, unknown>
    writes.push({ method: request.method(), url: request.url(), body })
    if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/teacher/assignments/${assignmentId}/grade`) {
      return route.fulfill({ json: { doc: { ...remoteDoc, updated_at: nextRevision, teacher_feedback_draft: body.feedback, score_completion: body.score_completion, score_thinking: body.score_thinking, score_workflow: body.score_workflow } } })
    }
    await route.abort()
  })
  const warmRead = async () => {
    completed = true
    const before = readCount
    await page.evaluate(() => dispatchEvent(new Event('pika-fixture-reactivate-classwork')))
    await page.clock.runFor(32)
    await expect.poll(() => readCount).toBeGreaterThan(before)
  }
  return { pageErrors, consoleErrors, writes, warmRead, reads: () => readCount,
    hold: () => { readMode = 'held' },
    fail: async (status = 503) => { protectedStatus = status; readMode = 'protected'; releaseRead?.(); await expect(page.getByRole('region', { name: 'Student work', exact: true }).getByRole('alert')).toBeVisible() },
    failBody: async () => {
      await page.evaluate(() => { (window as any).__rejectTeacherDetailBodyOnce = true })
      readMode = 'success'
      releaseRead?.()
      await expect(page.getByRole('region', { name: 'Student work', exact: true }).getByRole('alert')).toBeVisible()
    },
    recover: (changed: boolean) => { remoteDoc = changed ? { ...originalDoc, updated_at: nextRevision, teacher_feedback_draft: 'Remote teacher change' } : originalDoc; readMode = 'success'; releaseRead?.() },
    release: () => releaseRead?.(),
    initialFail: (status: number) => { readMode = 'protected'; protectedStatus = status },
  }
}

async function retainDraft(page: Page) {
  const editor = page.getByPlaceholder('Leave a comment...')
  await expect(editor).toBeVisible()
  // Let the existing inspector disclosure finish before pausing the autosave clock.
  await expect.poll(() => editor.evaluate(node => (node.closest('div[aria-hidden]') as HTMLElement | null)?.style.maxHeight)).toBe('none')
  await page.clock.install()
  await page.clock.pauseAt(new Date())
  await editor.fill(localComment)
  await expect.poll(() => editor.evaluate(node => { for (let p = node.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return true; return false })).toBe(true)
  await editor.evaluate((node: HTMLTextAreaElement) => {
    const scroller = (() => { for (let p = node.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p; return null })()
    if (!scroller) throw new Error('Expected a genuinely scrollable inspector')
    scroller.scrollTop = Math.max(40, node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 60)
    node.focus({ preventScroll: true })
    node.setSelectionRange(18, 23)
    Object.assign(window, { __teacherDraft: node, __teacherScroll: scroller, __teacherTop: scroller.scrollTop })
  })
  await expect(editor).toBeFocused()
  expect(await page.evaluate(() => (window as any).__teacherTop)).toBeGreaterThan(0)
  await expect(editor).toBeInViewport()
  return editor
}

async function expectRetained(page: Page, focused: boolean) {
  const state = await page.evaluate(() => {
    const w = window as any, node = w.__teacherDraft as HTMLTextAreaElement
    return { same: document.querySelector('textarea[placeholder="Leave a comment..."]') === node, connected: node.isConnected, value: node.value, focused: document.activeElement === node, selection: [node.selectionStart, node.selectionEnd], scroll: w.__teacherScroll.scrollTop, initialScroll: w.__teacherTop }
  })
  expect(state.same).toBe(true)
  expect(state.connected).toBe(true)
  expect(state.value).toBe(localComment)
  expect(state.scroll).toBe(state.initialScroll)
  if (focused) { expect(state.focused).toBe(true); expect(state.selection).toEqual([18, 23]) }
}

async function receipt(page: Page, info: TestInfo, f: Awaited<ReturnType<typeof fixture>>, extra: Record<string, unknown>) {
  expect(f.pageErrors).toEqual([])
  expect(f.consoleErrors.filter(m => !/^Failed to load resource: the server responded with a status of (401|403|404|503)/.test(m))).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  const path = info.outputPath('teacher-detail-recovery-receipt.json')
  await writeFile(path, JSON.stringify({ ...extra, viewport: page.viewportSize(), theme: info.project.metadata.theme, reads: f.reads(), writes: f.writes, pageErrors: f.pageErrors, consoleErrors: f.consoleErrors, persistedBackendWrites: 0, limits: 'Real TeacherClassroomView parent completed-run refresh and assignment controller. Requests use synthetic intercepted fixtures; autosave clock controlled. Natural user interactions recorded, no live backend/provider mutations or full-product performance claim.' }, null, 2))
  await info.attach('teacher-detail-recovery-receipt', { path, contentType: 'application/json' })
}

for (const failure of ['HTTP503', 'bodyTypeError'] as const) for (const motion of ['no-preference', 'reduce'] as const) for (const changedRevision of [false, true]) {
  test(`warm teacher ${failure} refresh retains draft and ${changedRevision ? 'blocks changed revision' : 'recovers original revision'} (${motion})`, async ({ page }, info) => {
    const f = await fixture(page, info, motion)
    try {
      expect((await page.goto('/e2e-fixtures/teacher-assignment-grading', { waitUntil: 'domcontentloaded' }))?.status()).toBe(200)
      await retainDraft(page)
      const selectedUrl = page.url()
      await shot(page, info, 'dirty-focused')
      f.hold()
      await f.warmRead()
      await expectRetained(page, true)
      await expect(page.getByRole('button', { name: 'Draft', exact: true })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Send comment', exact: true })).toBeDisabled()
      await expect(page.getByPlaceholder('Leave a comment...')).toBeEnabled()
      await shot(page, info, 'warm-pending')
      if (failure === 'bodyTypeError') await f.failBody()
      else await f.fail()
      await expectRetained(page, true)
      await page.clock.runFor(1200)
      expect(f.writes).toEqual([])
      await shot(page, info, 'warm-error')
      // The retry command intentionally takes focus; the existing input and scroll must survive.
      f.hold()
      const before = f.reads()
      await page.getByRole('button', { name: 'Try again', exact: true }).focus()
      await page.keyboard.press('Enter')
      await expect.poll(() => f.reads()).toBe(before + 1)
      await expectRetained(page, false)
      await shot(page, info, 'retry-pending')
      f.recover(changedRevision)
      await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0)
      await expectRetained(page, false)
      expect(page.url()).toBe(selectedUrl)
      if (changedRevision) {
        await expect(page.getByRole('region', { name: 'Student work', exact: true }).getByRole('alert')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Draft', exact: true })).toBeDisabled()
        await expect(page.getByRole('button', { name: 'Send comment', exact: true })).toBeDisabled()
        await page.clock.runFor(1200)
        expect(f.writes).toEqual([])
        await shot(page, info, 'remote-conflict')
      } else {
        await expect(page.getByRole('region', { name: 'Student work', exact: true }).getByRole('alert')).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Draft', exact: true })).toBeEnabled()
        await expect(page.getByRole('button', { name: 'Send comment', exact: true })).toBeEnabled()
        await shot(page, info, 'recovered-draft')
        await page.clock.runFor(1200)
        await expect.poll(() => f.writes.length).toBe(1)
        expect(f.writes[0].body.expected_doc_updated_at).toBe(revision)
        expect(f.writes[0].body.feedback).toBe(localComment)
        await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0)
        await expect(page.getByPlaceholder('Leave a comment...')).toHaveValue(localComment)
      }
      await receipt(page, info, f, { failure, motion, changedRevision, selectedUrl, retainedInputAndNonzeroScroll: true, existingInspectorSectionTransition: await page.getByPlaceholder('Leave a comment...').evaluate(node => getComputedStyle(node.closest('div[aria-hidden]')!).transitionDuration) })
    } finally { f.release() }
  })
}

for (const status of [401, 403, 404]) {
  test(`warm teacher ${status} hides protected inspector and blocks writers`, async ({ page }, info) => {
    const f = await fixture(page, info, 'reduce')
    try {
      await page.goto('/e2e-fixtures/teacher-assignment-grading', { waitUntil: 'domcontentloaded' })
      await retainDraft(page)
      f.hold()
      await f.warmRead()
      await f.fail(status)
      await expect(page.getByPlaceholder('Leave a comment...')).toHaveCount(0)
      await expect(page.getByText('Protected diagnostic detail must not appear', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0)
      await page.clock.runFor(1200)
      expect(f.writes).toEqual([])
      await shot(page, info, 'unavailable')
      await receipt(page, info, f, { protectedStatus: status })
    } finally { f.release() }
  })
}

for (const motion of ['no-preference', 'reduce'] as const) {
  test(`initial teacher failure offers keyboard retry (${motion})`, async ({ page }, info) => {
    const f = await fixture(page, info, motion)
    f.initialFail(503)
    try {
      await page.goto('/e2e-fixtures/teacher-assignment-grading', { waitUntil: 'domcontentloaded' })
      const retry = page.getByRole('button', { name: 'Try again', exact: true })
      await expect(retry).toBeVisible()
      await shot(page, info, 'initial-error')
      f.hold()
      const before = f.reads()
      await retry.focus()
      await page.keyboard.press('Enter')
      await expect.poll(() => f.reads()).toBe(before + 1)
      await expect(page.getByRole('region', { name: 'Student work', exact: true }).getByRole('status')).toBeVisible()
      await expect(page.getByRole('region', { name: 'Student work', exact: true })).toBeFocused()
      if (motion === 'reduce') expect(await page.getByRole('region', { name: 'Student work', exact: true }).locator('[data-page-state="loading"] svg').evaluate(node => getComputedStyle(node).animationName)).toBe('none')
      await shot(page, info, 'initial-retry-pending')
      f.recover(false)
      await expect(page.getByPlaceholder('Leave a comment...')).toHaveValue('Stored comment')
      await expect.poll(() => page.getByPlaceholder('Leave a comment...').evaluate(node => (node.closest('div[aria-hidden]') as HTMLElement | null)?.style.maxHeight)).toBe('none')
      await expect(page.getByRole('region', { name: 'Student work', exact: true })).toBeFocused()
      expect(await page.getByRole('region', { name: 'Student work', exact: true }).evaluate(node => getComputedStyle(node).boxShadow)).toContain('inset')
      expect(f.writes).toEqual([])
      await shot(page, info, 'initial-recovered')
      await receipt(page, info, f, { motion, initialRecovery: true })
    } finally { f.release() }
  })
}

for (const view of ['table', 'individual'] as const) for (const action of ['AI Grade', 'Return'] as const) {
  test(`current teacher read pauses an already-open ${action} confirmation in ${view} view`, async ({ page }, info) => {
    const f = await fixture(page, info, 'no-preference')
    try {
      await page.goto('/e2e-fixtures/teacher-assignment-grading', { waitUntil: 'domcontentloaded' })
      await expect(page.getByPlaceholder('Leave a comment...')).toBeVisible()
      await page.clock.install()
      await page.clock.pauseAt(new Date())
      if (view === 'individual') await page.getByRole('button', { name: /^Change assignment layout:/ }).click()
      else await page.getByTestId('assignment-student-scroll-pane').getByRole('checkbox').nth(1).check()
      const actions = page.getByRole('button', { name: /^Student actions/ })
      await expect(page.getByRole('button', { name: /^Student actions for/ })).toBeVisible()
      await expect(actions).toBeEnabled()
      await actions.click()
      await page.getByRole('menuitem', { name: new RegExp(`^${action}`) }).click()
      const dialog = page.getByRole('dialog', { name: action === 'AI Grade' ? /AI grade/ : /Return work/ })
      const confirm = dialog.getByRole('button', { name: action === 'AI Grade' ? 'AI grade' : 'Return', exact: true })
      await expect(confirm).toBeEnabled()
      f.hold()
      await f.warmRead()
      await expect(confirm).toBeDisabled()
      await shot(page, info, `${view}-${action}-paused-confirmation`)
      const modalExitMs = await dialog.evaluate(node => {
        const token = getComputedStyle(node).getPropertyValue('--motion-duration-standard').trim()
        const match = token.match(/^(\d*\.?\d+)(ms|s)$/)
        return match ? Number(match[1]) * (match[2] === 's' ? 1000 : 1) : 0
      })
      expect(Number.isFinite(modalExitMs)).toBe(true)
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      // The paused autosave clock also owns modal exit presence. Advance its
      // existing token before capturing the settled post-Cancel workspace.
      await page.clock.runFor(modalExitMs + 1)
      await expect(page.locator('[data-modal-state="closing"]')).toHaveCount(0)
      if (view === 'table') {
        // The completed-run refresh intentionally clears batch selection. Select the
        // same student again so the menu pause cannot be explained by an empty batch.
        const selectedStudent = page.getByTestId('assignment-student-scroll-pane').getByRole('checkbox').nth(1)
        await selectedStudent.check()
        await expect(selectedStudent).toBeChecked()
        await expect(page.getByRole('button', { name: /^Student actions for/ })).toBeVisible()
      }
      await expect(actions).toBeDisabled()
      await f.fail()
      await expect(actions).toBeDisabled()
      expect(f.writes).toEqual([])
      await shot(page, info, `${view}-${action}-paused-error`)
      await receipt(page, info, f, { view, action, parentReadPause: true, lateConfirmationRevalidated: true })
    } finally { f.release() }
  })
}
