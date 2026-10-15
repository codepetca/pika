/** New, import-safe Playwright carrier for the finite contextual Tests plan.
 * CPU assertions below are contracts, never substitutes for the real UI/API/DB run.
 * Runtime owns authentication, original response tasks, fences and disposal.
 */
import { expect, type Page, type Response } from '@playwright/test'
import { createHash } from 'node:crypto'
import type { ActorLabel, ContextualTestRuntime, RehearsalWitness } from './contextual-test-rehearsal'
import { runContextualTestFontMatrix } from './contextual-test-font-matrix'

const fail = (): never => { throw new Error('Contextual Tests workflow assertion failed') }
const requireThat: (condition: unknown) => asserts condition = condition => { if (!condition) fail() }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const digest = /^[a-f0-9]{64}$/
export const contextualTestWorkflowContract = Object.freeze({
  createdTests: 6, retiredTests: 2, uploadObjects: 2, screenshots: 16, fontShots: 32, automaticRetries: 0,
  stages: Object.freeze(['baseline', 'font-matrix', 'owner-authoring', 'member-participation', 'grading-return', 'scratch-recovery', 'foreign-denials', 'revoke-restore', 'archive-restore', 'visual-matrix', 'final']),
})

type Graph = Pick<RehearsalWitness, 'work_graph_sha256'>
export function assertForbiddenGraphUnchanged(before: Graph, after: Graph): void {
  requireThat(digest.test(before.work_graph_sha256) && before.work_graph_sha256 === after.work_graph_sha256)
}
export function assertWorkflowBaseline(w: Pick<RehearsalWitness, 'tests' | 'attempts' | 'objects' | 'response_count' | 'history_count'>, retired: readonly string[]): void {
  requireThat(w.tests.length === 2 && retired.length === 2 && new Set(retired).size === 2)
  requireThat(w.tests.every(t => retired.includes(t.id) && t.retired && t.status === 'draft'))
  requireThat(w.attempts.length === 0 && w.objects.length === 0 && w.response_count === 0 && w.history_count === 0)
}
/** No raw rejected values are retained or interpolated into an assertion. */
export function assertNondisclosure(value: unknown): void {
  const forbidden = new Set(['answer_key', 'correct_option', 'sample_solution', 'feedback', 'score', 'draft_grade', 'question_results'])
  const seen = new Set<object>(); let visited = 0
  const visit = (v: unknown, depth: number): void => {
    requireThat(++visited <= 8192 && depth <= 32)
    if (v === null || typeof v !== 'object') return
    requireThat(!seen.has(v)); seen.add(v)
    for (const [key, entry] of Object.entries(Object.getOwnPropertyDescriptors(v))) {
      requireThat(!forbidden.has(key) && 'value' in entry)
      visit(entry.value, depth + 1)
    }
  }
  visit(value, 0)
}
export function assertRestoredMembership(before: Pick<RehearsalWitness, 'memberships' | 'generations'>, after: Pick<RehearsalWitness, 'memberships' | 'generations'>, classroom: string, student: string): void {
  const old = before.memberships.filter(m => m.classroom_id === classroom && m.student_id === student)
  const fresh = after.memberships.filter(m => m.classroom_id === classroom && m.student_id === student)
  requireThat(old.length === 1 && fresh.length === 1 && old[0].generation_id !== fresh[0].generation_id && fresh[0].ledger_state === 'active')
  requireThat(after.generations.some(g => g.generation_id === old[0].generation_id && g.state === 'removed'))
  requireThat(after.generations.some(g => g.generation_id === fresh[0].generation_id && g.state === 'active'))
  const otherMemberships = (w: Pick<RehearsalWitness, 'memberships'>) => w.memberships.filter(m => !(m.classroom_id === classroom && m.student_id === student))
  requireThat(JSON.stringify(otherMemberships(before)) === JSON.stringify(otherMemberships(after)))
  const otherGenerations = (w: Pick<RehearsalWitness, 'generations'>) => w.generations.filter(g => ![old[0].generation_id, fresh[0].generation_id].includes(g.generation_id))
  requireThat(JSON.stringify(otherGenerations(before)) === JSON.stringify(otherGenerations(after)))
  requireThat(after.generations.length === before.generations.length + 1 && after.memberships.length === before.memberships.length)
}
export function assertRestoredClass(before: Pick<RehearsalWitness, 'classes'>, after: Pick<RehearsalWitness, 'classes'>, classroom: string): void {
  const old = before.classes.filter(c => c.id === classroom), restored = after.classes.filter(c => c.id === classroom)
  requireThat(old.length === 1 && restored.length === 1 && old[0].archived_at === null && restored[0].archived_at === null)
  requireThat(Number.isFinite(Date.parse(old[0].updated_at)) && Number.isFinite(Date.parse(restored[0].updated_at)) && Date.parse(restored[0].updated_at) >= Date.parse(old[0].updated_at))
  requireThat(JSON.stringify(before.classes.filter(c => c.id !== classroom)) === JSON.stringify(after.classes.filter(c => c.id !== classroom)))
}

type Owner = 'ownerTeacher' | 'ownerStudent'
type Member = 'memberTeacher' | 'memberStudent'
type ReferenceDocument = { id: string; source: string; title: string; managed_object_id?: string; storage_path?: string }
type ReferenceProof = Readonly<{ testId: string; documentId: string; objectId: string; byteSize: number; sha256: string }>
type TestRow = { id: string; classroom_id: string; title: string; status: string; documents?: ReferenceDocument[] }
type Draft = { draft: { version: number; content: Record<string, unknown> } }
type Attempt = { id?: string; responses: Record<string, unknown>; draft_revision: number; is_submitted: boolean }
type Answer = { response_id: string; response_revision: number; score: number | null; feedback?: string | null; selected_option: number | null; response_text: string | null }
type Results = { questions: Array<{ id: string; question_type: string; question_text: string }>; students: Array<{ student_id: string; returned_at: string | null; answers: Record<string, Answer> }> }
type Exam = { id: string; title: string; classroom: string; owner: Owner; openId: string; mcId: string; documentId?: string; referenceProof?: ReferenceProof }
const members: readonly Member[] = ['memberTeacher', 'memberStudent']

/** Serialized directly by page.evaluate; all dependencies are browser-local.
 * One absolute deadline covers headers and the one original binary body read. */
export async function readContextualTestReference(input: { path: string; storagePath: string; apiOrigin: string; expectedBytes: number; deadline: number }): Promise<number[]> {
  const rejected = () => new Error('Reference read failed')
  const valid = /^\/api\/teacher\/tests\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/documents\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/file$/
  const parts = input.path.split('/'), stored = input.storagePath.split('/')
  if (!valid.test(input.path) || input.apiOrigin !== 'http://127.0.0.1:54331' || stored.length !== 7 || stored[0] !== 'classrooms'
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(stored[1])
    || stored[2] !== 'tests' || stored[3] !== parts[4] || stored[4] !== 'documents' || stored[5] !== parts[6]
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.pdf$/.test(stored[6])
    || !Number.isSafeInteger(input.expectedBytes) || input.expectedBytes < 1 || input.expectedBytes > 32768
    || !Number.isSafeInteger(input.deadline) || input.deadline <= Date.now() || input.deadline - Date.now() > 30000
    || location.origin !== 'http://localhost:3117') throw rejected()
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.max(0, input.deadline - Date.now()))
  const aborted = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(rejected()), { once: true }))
  const check = () => { if (controller.signal.aborted || Date.now() >= input.deadline) throw rejected() }
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    check()
    // The existing browser route fence rejects every foreign/unreserved request
    // before dispatch. The frozen app's normal 302 is a private signed read,
    // not another authored GET or a substitute response/body acquisition.
    const response = await Promise.race([fetch(input.path, { credentials: 'same-origin', cache: 'no-store', redirect: 'follow', signal: controller.signal }), aborted])
    check()
    const target = new URL(response.url)
    if (!response.ok || response.status !== 200 || !response.redirected || target.origin !== input.apiOrigin
      || target.pathname !== `/storage/v1/object/sign/test-documents/${input.storagePath}` || target.username || target.password || target.hash
      || Array.from(target.searchParams.keys()).join(',') !== 'token' || !target.searchParams.get('token') || !response.body) throw rejected()
    reader = response.body.getReader()
    const bytes = new Uint8Array(input.expectedBytes); let count = 0
    for (;;) {
      const chunk = await Promise.race([reader.read(), aborted]); check()
      if (chunk.done) break
      if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength > input.expectedBytes - count) throw rejected()
      bytes.set(chunk.value, count); count += chunk.value.byteLength
    }
    check(); if (count !== input.expectedBytes) throw rejected()
    return Array.from(bytes)
  } catch {
    controller.abort()
    if (reader) { try { void reader.cancel().catch(() => {}) } catch { /* original failure remains authoritative */ } }
    throw rejected()
  } finally { clearTimeout(timer); try { reader?.releaseLock() } catch { /* aborted pending read cannot authorize success */ } }
}
export function createContextualTestReferenceProof(testId: string, classroom: string, document: ReferenceDocument, uploaded: Buffer, downloaded: number[]): ReferenceProof {
  requireThat(uuid.test(testId) && uuid.test(classroom) && uuid.test(document.id) && document.source === 'upload' && document.managed_object_id && uuid.test(document.managed_object_id))
  requireThat(document.storage_path === `classrooms/${classroom}/tests/${testId}/documents/${document.id}/${document.managed_object_id}.pdf`)
  requireThat(uploaded.length > 0 && uploaded.length <= 32768 && downloaded.length === uploaded.length
    && downloaded.every(value => Number.isInteger(value) && value >= 0 && value <= 255) && Buffer.from(downloaded).equals(uploaded))
  return Object.freeze({ testId, documentId: document.id, objectId: document.managed_object_id, byteSize: uploaded.length,
    sha256: createHash('sha256').update(uploaded).digest('hex') })
}
export function assertContextualTestReferenceObjects(objects: ReadonlyArray<{ id: string; resource_id: string; purpose: string; status: string; byte_size: number; content_sha256: string | null }>, proofs: readonly ReferenceProof[]): void {
  requireThat(objects.length === proofs.length && new Set(proofs.map(p => p.objectId)).size === proofs.length
    && new Set(proofs.map(p => p.documentId)).size === proofs.length && new Set(proofs.map(p => p.testId)).size === proofs.length)
  for (const proof of proofs) {
    const matches = objects.filter(object => object.id === proof.objectId)
    requireThat(matches.length === 1 && digest.test(proof.sha256))
    const object = matches[0]
    requireThat(object.resource_id === proof.testId && object.purpose === 'teacher_test_material' && object.status === 'ready'
      && object.byte_size === proof.byteSize && object.byte_size > 0 && object.byte_size <= 32768
      && (object.content_sha256 === null || object.content_sha256 === proof.sha256))
  }
}

export async function consumeCreatedTestAcknowledgement(r: Pick<ContextualTestRuntime, 'response'>, page: Page, response: Response, classroom: string): Promise<TestRow> {
  requireThat(response.status() === 201)
  const created = await r.response<{ test: TestRow }>(page, response)
  requireThat(created?.test && uuid.test(created.test.id) && created.test.classroom_id === classroom)
  return created.test
}

function markdown(title: string): string {
  return `# Test\nTitle: ${title}\nShow Results: true\n\n## Questions\n### Question 1\nType: multiple_choice\nPoints: 5\nPrompt:\nChoose the second option.\nOptions:\n- Alpha\n- Beta\nCorrect Option: 2\n\n### Question 2\nType: open_response\nPoints: 5\nMax Chars: 2000\nPrompt:\nExplain **your reasoning**. [Local inert reference](http://localhost:3117/login)\nAnswer Key:\nA reasoned response\nSample Solution:\nA private solution\n\n## Documents\n### Document 1\nSource: text\nTitle: Reference notes\nContent:\nRead the prompt carefully.\n`
}
function tinyPdf(): Buffer {
  const content = 'BT /F1 10 Tf 10 60 Td (Notes) Tj ET\n'
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 120] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`]
  let body = '%PDF-1.4\n'; const offsets = [0]
  for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${object}\nendobj\n` }
  const xref = Buffer.byteLength(body)
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body)
}
async function visit(r: ContextualTestRuntime, page: Page, classroom: string): Promise<void> {
  r.check(); await r.navigate(page, `${r.plan.appOrigin}/classrooms/${classroom}?tab=tests`); r.check()
}
async function ownerEdit(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: title, exact: true }).click()
  await page.getByTestId('test-workspace-trailing-actions').getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Edit Markdown', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Edit test', exact: true })).toBeVisible()
}
async function createExam(r: ContextualTestRuntime, page: Page, owner: Owner, classroom: string, kind: 'main' | 'single' | 'bulk'): Promise<Exam> {
  await visit(r, page, classroom)
  const ack = page.waitForResponse(res => new URL(res.url()).pathname === '/api/teacher/tests' && res.request().method() === 'POST')
  await page.getByRole('button', { name: 'Create test', exact: true }).click()
  const createdResponse = await ack
  // Runtime validates the original response task; the cookie-bound read supplies
  // the acknowledged identity rather than inventing an ID or seeding work.
  const created = await consumeCreatedTestAcknowledgement(r, page, createdResponse, classroom)
  const id = created.id, title = `Contextual ${owner} ${kind}`
  let referenceProof: ReferenceProof | undefined
  const editor = page.getByRole('dialog', { name: 'Edit test', exact: true })
  await expect(editor).toBeVisible()
  await editor.getByRole('button', { name: 'Markdown', exact: true }).click()
  await editor.getByTestId('test-markdown-editor').fill(markdown(title))
  await editor.getByRole('button', { name: 'Apply Markdown', exact: true }).click()
  await expect(editor.getByTestId('teacher-test-authoring-save-status')).toHaveText('Test saved', { timeout: 30_000 })
  await editor.getByRole('button', { name: 'Close test editor', exact: true }).click()
  await r.settle(page)
  await r.reload(page); await visit(r, page, classroom); await ownerEdit(page, title)
  const reloadedMarkdown = await page.getByTestId('test-markdown-editor').inputValue()
  requireThat(reloadedMarkdown.includes(`Title: ${title}`) && reloadedMarkdown.includes('A private solution') && reloadedMarkdown.includes('Explain **your reasoning**.'))
  const saved = await r.api<Draft>(page, 'GET', `/api/teacher/tests/${id}/draft`)
  requireThat(saved.draft.version > 0 && saved.draft.content.title === title)
  if (kind === 'main') {
    await page.getByRole('dialog', { name: 'Edit test', exact: true }).getByRole('button', { name: 'Markdown', exact: true }).click()
    await page.getByRole('button', { name: 'Add reference', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Upload PDF or image', exact: true }).click()
    const upload = page.getByRole('dialog', { name: 'Add Document', exact: true })
    await upload.getByLabel('Document title', { exact: true }).fill('Uploaded reference')
    const bytes = tinyPdf(); requireThat(bytes.length <= r.plan.limits.uploadBytes)
    await upload.locator('input[type=file]').setInputFiles({ name: 'reference.pdf', mimeType: 'application/pdf', buffer: bytes })
    await upload.getByRole('button', { name: 'Upload document', exact: true }).click()
    await expect(upload).toBeHidden()
    await r.settle(page)
    const detail = await r.api<{ test: TestRow }>(page, 'GET', `/api/teacher/tests/${id}`)
    const document = detail.test.documents?.find(d => d.source === 'upload' && d.title === 'Uploaded reference')
    requireThat(document && uuid.test(document.id) && document.managed_object_id && uuid.test(document.managed_object_id)
      && document.storage_path === `classrooms/${classroom}/tests/${id}/documents/${document.id}/${document.managed_object_id}.pdf`)
    // Read through the real same-cookie app endpoint; no signed URL is retained.
    r.check(); const deadline = Math.min(r.deadline, Date.now() + 30000)
    const read = await page.evaluate(readContextualTestReference, { path: `/api/teacher/tests/${id}/documents/${document.id}/file`, storagePath: document.storage_path,
      apiOrigin: r.plan.apiOrigin, expectedBytes: bytes.length, deadline })
    r.check(); referenceProof = createContextualTestReferenceProof(id, classroom, document, bytes, read)
  }
  await page.getByRole('dialog', { name: 'Edit test', exact: true }).getByRole('button', { name: 'Close test editor', exact: true }).click()
  await r.settle(page)
  // Embedded preview is the saved-row UI action, not an unsaved local editor.
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(page.getByTestId('teacher-test-split-container')).toBeVisible()
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Close Preview', exact: true }).click()
  await r.navigate(page, `${r.plan.appOrigin}/classrooms/${classroom}/tests/${id}/preview`)
  await expect(page.getByTestId('teacher-test-split-container')).toBeVisible(); await r.settle(page)
  await visit(r, page, classroom); await ownerEdit(page, title)
  const publishedResponse = page.waitForResponse(res => new URL(res.url()).pathname === `/api/teacher/tests/${id}/publish` && res.request().method() === 'POST')
  await page.getByRole('dialog', { name: 'Edit test', exact: true }).getByRole('button', { name: 'Publish', exact: true }).click()
  await page.getByRole('dialog', { name: 'Publish test?', exact: true }).getByRole('button', { name: 'Publish', exact: true }).click()
  requireThat((await publishedResponse).status() === 200); await r.settle(page)
  const detail = await r.api<{ test: TestRow }>(page, 'GET', `/api/teacher/tests/${id}`)
  requireThat(detail.test.status === 'closed' && detail.test.title === title)
  const results = await r.api<Results>(page, 'GET', `/api/teacher/tests/${id}/results`)
  requireThat(results.questions.length === 2)
  const open = results.questions.find(q => q.question_type === 'open_response'), mc = results.questions.find(q => q.question_type === 'multiple_choice')
  requireThat(open && mc && uuid.test(open.id) && uuid.test(mc.id))
  if (referenceProof) requireThat(detail.test.documents?.some(document => document.source === 'upload' && document.id === referenceProof.documentId
    && document.managed_object_id === referenceProof.objectId
    && document.storage_path === `classrooms/${classroom}/tests/${id}/documents/${referenceProof.documentId}/${referenceProof.objectId}.pdf`))
  return { id, title, classroom, owner, openId: open.id, mcId: mc.id, documentId: detail.test.documents?.find(d => d.source === 'upload')?.id, referenceProof }
}
async function access(r: ContextualTestRuntime, page: Page, exam: Exam, state: 'open' | 'closed', labels: readonly Member[] = members): Promise<void> {
  const ids = labels.map(label => r.plan.actors[label].id)
  const ack = await r.api<{ updated_count: number; skipped_count: number; state: string }>(page, 'POST', `/api/teacher/tests/${exam.id}/student-access`, { student_ids: ids, state })
  requireThat(ack.updated_count === ids.length && ack.skipped_count === 0 && ack.state === state)
}
async function begin(r: ContextualTestRuntime, page: Page, exam: Exam): Promise<void> {
  await visit(r, page, exam.classroom)
  await page.getByRole('button', { name: new RegExp(exam.title) }).first().click()
  await page.getByRole('button', { name: 'Start the Test', exact: true }).click()
  // Actual browser user gesture/fullscreen only. No geometry/capability shims.
  await page.getByRole('dialog', { name: 'Start this test?', exact: true }).getByRole('button', { name: 'Start test', exact: true }).click()
  await expect(page.getByTestId('student-test-split-container')).toBeVisible()
  await expect(page.getByTestId('exam-interaction-blocker')).toBeHidden()
  await r.settle(page)
}
async function answer(r: ContextualTestRuntime, page: Page, exam: Exam, text: string): Promise<void> {
  await page.getByRole('textbox', { name: /Response for question/ }).fill(text)
  await page.getByRole('radio', { name: 'Beta', exact: true }).check()
  await expect(page.getByTestId('student-test-autosave-status')).toHaveText('Saved', { timeout: 30_000 }); await r.settle(page)
  const saved = await r.api<{ attempt: Attempt }>(page, 'GET', `/api/student/tests/${exam.id}/attempt`)
  requireThat(saved.attempt.draft_revision > 0 && saved.attempt.responses[exam.openId] === text && saved.attempt.responses[exam.mcId] === 1 && !saved.attempt.is_submitted)
}
async function submit(r: ContextualTestRuntime, page: Page, exam: Exam): Promise<void> {
  const response = page.waitForResponse(res => new URL(res.url()).pathname === `/api/student/tests/${exam.id}/respond` && res.request().method() === 'POST')
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await page.getByRole('dialog', { name: 'Submit your answers?', exact: true }).getByRole('button', { name: 'Submit', exact: true }).click()
  requireThat((await response).status() === 201); await r.settle(page)
}
async function denialBlock(r: ContextualTestRuntime, label: string, work: () => Promise<void>): Promise<void> {
  const before = await r.witness(`${label}-before`); await work(); const after = await r.witness(`${label}-after`)
  assertForbiddenGraphUnchanged(before, after)
}
async function reorder(r: ContextualTestRuntime, page: Page, classroom: string): Promise<void> {
  const before = await r.witness('reorder-before')
  const ids = before.tests.filter(t => t.classroom_id === classroom).map(t => t.id).reverse()
  requireThat(ids.length === 4 && before.tests.some(t => t.classroom_id === classroom && t.retired))
  const result = await r.api<{ success: boolean }>(page, 'POST', '/api/teacher/tests/reorder/atomic', { classroom_id: classroom, test_ids: ids })
  requireThat(result.success === true)
  const after = await r.witness('reorder-after'), ordered = after.tests.filter(t => t.classroom_id === classroom).sort((a, b) => a.position - b.position)
  requireThat(JSON.stringify(ordered.map(t => t.id)) === JSON.stringify(ids) && ordered.every((t, i) => t.position === i))
}
async function participate(r: ContextualTestRuntime, ownerPage: Page, exam: Exam): Promise<void> {
  await access(r, ownerPage, exam, 'open')
  await r.withActor(exam.owner, async page => {
    await denialBlock(r, 'self-enrolled-owner', async () => { await r.api(page, 'POST', `/api/student/tests/${exam.id}/start`, {}, 403) })
  })
  for (const member of members) await r.withActor(member, async page => {
    await begin(r, page, exam)
    const text = `Reasoned response ${member} ${exam.owner}`
    await answer(r, page, exam, text)
    const before = await r.api<{ attempt: Attempt }>(page, 'GET', `/api/student/tests/${exam.id}/attempt`)
    await r.reload(page); await begin(r, page, exam)
    await expect(page.getByRole('textbox', { name: /Response for question/ })).toHaveValue(text)
    const recovered = await r.api<{ attempt: Attempt }>(page, 'GET', `/api/student/tests/${exam.id}/attempt`)
    requireThat(recovered.attempt.draft_revision >= before.attempt.draft_revision && recovered.attempt.responses[exam.openId] === text)
    await submit(r, page, exam)
    assertNondisclosure(await r.api(page, 'GET', `/api/student/tests/${exam.id}`))
    assertNondisclosure(await r.api(page, 'GET', `/api/student/tests/${exam.id}/history`))
    await r.api(page, 'GET', `/api/student/tests/${exam.id}/results`, undefined, 403)
    await denialBlock(r, 'foreign-learner-history', async () => {
      const other = member === 'memberTeacher' ? 'memberStudent' : 'memberTeacher'
      await r.api(page, 'GET', `/api/student/tests/${exam.id}/history?student_id=${r.plan.actors[other].id}`, undefined, 403)
    })
    const witness = await r.witness('member-submitted')
    requireThat(witness.attempts.some(a => a.test_id === exam.id && a.student_id === r.plan.actors[member].id && a.is_submitted && a.draft_revision > 0) && witness.history_count > 0 && witness.response_count > 0)
  })
}
async function initialGradeThroughUi(r: ContextualTestRuntime, ownerPage: Page, exam: Exam, student: string, original: Answer): Promise<void> {
  r.check(); requireThat(original.score === null)
  await visit(r, ownerPage, exam.classroom)
  await ownerPage.getByRole('button', { name: exam.title, exact: true }).click()
  await ownerPage.getByTestId(`test-grading-student-row-${student}`).click()
  // These are the existing mounted grading inspector controls. No API write,
  // component-state mutation, forced input event or persistence interception.
  const score = ownerPage.getByRole('spinbutton', { name: 'Q2 score', exact: true })
  const feedback = ownerPage.getByPlaceholder('Leave a comment...', { exact: true })
  await expect(score).toBeVisible(); await expect(score).toHaveValue('')
  await expect(feedback).toBeVisible()
  const acknowledgement = ownerPage.waitForResponse(response => {
    if (new URL(response.url()).pathname !== `/api/teacher/tests/${exam.id}/students/${student}/grades` || response.request().method() !== 'PATCH') return false
    const body = response.request().postDataJSON() as { grades?: Array<{ response_id?: string; question_id?: string; expected_response_revision?: number; score?: number; feedback?: string }> }
    return body.grades?.length === 1 && body.grades[0].response_id === original.response_id && body.grades[0].question_id === exam.openId
      && body.grades[0].expected_response_revision === original.response_revision && body.grades[0].score === 4 && body.grades[0].feedback === 'Reviewed manually'
  })
  // Feedback without a score is locally invalid and cannot autosave. Enter the
  // score next, then blur normally to flush the valid combined grading draft.
  await feedback.fill('Reviewed manually'); await score.fill('4'); await score.press('Tab')
  const response = await acknowledgement; requireThat(response.status() === 200)
  const saved = await r.response<{ saved_count: number; responses: Array<{ id: string; revision: number; score: number; feedback: string }> }>(ownerPage, response)
  requireThat(saved.saved_count === 1 && saved.responses.length === 1 && saved.responses[0].id === original.response_id
    && saved.responses[0].revision === original.response_revision + 1 && saved.responses[0].score === 4 && saved.responses[0].feedback === 'Reviewed manually')
  await expect(ownerPage.getByTestId('teacher-test-grading-save-status')).toHaveText('Grades saved', { timeout: 30_000 })
  await r.settle(ownerPage)
}
async function gradeAndReturn(r: ContextualTestRuntime, ownerPage: Page, exam: Exam): Promise<void> {
  await access(r, ownerPage, exam, 'closed')
  const peer = exam.owner === 'ownerTeacher' ? 'ownerTeacherPeer' : 'ownerStudentPeer'
  await r.withActor(peer, async peerPage => {
    for (const member of members) {
      const student = r.plan.actors[member].id
      const results = await r.api<Results>(ownerPage, 'GET', `/api/teacher/tests/${exam.id}/results`)
      const row = results.students.find(s => s.student_id === student); requireThat(row)
      const original = row.answers[exam.openId]; requireThat(original && uuid.test(original.response_id))
      // Both contexts genuinely read the same revision before the first write.
      const peerRead = await r.api<Results>(peerPage, 'GET', `/api/teacher/tests/${exam.id}/results`)
      const stale = peerRead.students.find(s => s.student_id === student)?.answers[exam.openId]; requireThat(stale && stale.response_revision === original.response_revision)
      const grade = (response: Answer, score: number | null) => ({ grades: [{ question_id: exam.openId, response_id: response.response_id, expected_response_revision: response.response_revision, score, feedback: score === null ? '' : 'Reviewed manually' }] })
      await initialGradeThroughUi(r, ownerPage, exam, student, original)
      await denialBlock(r, 'stale-grade', async () => { await r.api(peerPage, 'PATCH', `/api/teacher/tests/${exam.id}/students/${student}/grades`, grade(stale, 1), 409) })
      let fresh = await r.api<Results>(ownerPage, 'GET', `/api/teacher/tests/${exam.id}/results`)
      let current = fresh.students.find(s => s.student_id === student)?.answers[exam.openId]
      requireThat(current && current.score === 4 && current.feedback === 'Reviewed manually' && current.response_id === original.response_id && current.response_revision === original.response_revision + 1)
      await r.api(ownerPage, 'POST', `/api/teacher/tests/${exam.id}/clear-open-grades`, { student_ids: [student], responses: [{ response_id: current.response_id, expected_response_revision: current.response_revision }] })
      fresh = await r.api<Results>(peerPage, 'GET', `/api/teacher/tests/${exam.id}/results`)
      current = fresh.students.find(s => s.student_id === student)?.answers[exam.openId]; requireThat(current && current.score === null)
      await r.api(peerPage, 'PATCH', `/api/teacher/tests/${exam.id}/students/${student}/grades`, grade(current, 4))
    }
  })
  const returned = await r.api<{ returned_count: number; skipped_count: number }>(ownerPage, 'POST', `/api/teacher/tests/${exam.id}/return`, { student_ids: members.map(m => r.plan.actors[m].id) })
  requireThat(returned.returned_count === 2 && returned.skipped_count === 0)
  for (const member of members) await r.withActor(member, async page => {
    const result = await r.api<{ test: { returned_at: string }; question_results: Array<{ question_id: string; score: number; response_text: string | null; selected_option: number | null }>; summary: { earned_points: number; possible_points: number } }>(page, 'GET', `/api/student/tests/${exam.id}/results`)
    requireThat(result.test.returned_at && result.question_results.length === 2 && result.summary.earned_points === 9 && result.summary.possible_points === 10)
    requireThat(result.question_results.some(q => q.question_id === exam.openId && q.score === 4 && q.response_text === `Reasoned response ${member} ${exam.owner}`))
    await visit(r, page, exam.classroom); await page.getByRole('button', { name: new RegExp(exam.title) }).first().click()
    await expect(page.getByText('Reviewed manually', { exact: true }).first()).toBeVisible()
  })
  const roster = await r.api<Results>(ownerPage, 'GET', `/api/teacher/tests/${exam.id}/results`)
  requireThat(members.every(m => roster.students.some(s => s.student_id === r.plan.actors[m].id && s.returned_at)))
}
async function resetScratch(r: ContextualTestRuntime, owner: Page, exam: Exam, bulk: boolean): Promise<void> {
  await access(r, owner, exam, 'open')
  for (const member of members) await r.withActor(member, async page => { await begin(r, page, exam); await answer(r, page, exam, 'Scratch response'); await submit(r, page, exam) })
  await access(r, owner, exam, 'closed')
  const selected = { student_ids: members.map(m => r.plan.actors[m].id) }
  const unsubmitted = await r.api<{ unsubmitted_count: number }>(owner, 'POST', `/api/teacher/tests/${exam.id}/unsubmit`, selected)
  requireThat(unsubmitted.unsubmitted_count === 2)
  const unsubmitWitness = await r.witness('scratch-unsubmitted')
  requireThat(unsubmitWitness.attempts.filter(a => a.test_id === exam.id).length === 2 && unsubmitWitness.attempts.filter(a => a.test_id === exam.id).every(a => !a.is_submitted))
  if (bulk) {
    const result = await r.api<{ success: boolean; deleted_attempts: number }>(owner, 'POST', `/api/teacher/tests/${exam.id}/students/attempts/bulk-delete`, selected)
    requireThat(result.success && result.deleted_attempts === 2)
    const replay = await r.api<{ deleted_attempts: number }>(owner, 'POST', `/api/teacher/tests/${exam.id}/students/attempts/bulk-delete`, selected)
    requireThat(replay.deleted_attempts === 0)
  } else for (const member of members) {
    const result = await r.api<{ deleted_attempts: number }>(owner, 'DELETE', `/api/teacher/tests/${exam.id}/students/${r.plan.actors[member].id}/attempt`)
    requireThat(result.deleted_attempts === 1)
  }
  requireThat(!(await r.witness('scratch-reset')).attempts.some(a => a.test_id === exam.id))
}
async function discardScratch(r: ContextualTestRuntime, page: Page, exam: Exam): Promise<void> {
  const draft = await r.api<{ test: TestRow }>(page, 'POST', `/api/teacher/tests/${exam.id}/unpublish`, {})
  requireThat(draft.test.status === 'draft' && draft.test.id === exam.id)
  await r.api(page, 'DELETE', `/api/teacher/tests/${exam.id}`)
  requireThat(!(await r.witness('scratch-deleted')).tests.some(t => t.id === exam.id))
}
async function matrix(r: ContextualTestRuntime): Promise<void> {
  for (const actor of ['ownerTeacher', 'ownerStudent', 'memberTeacher', 'memberStudent'] as const) await r.withActor(actor, async page => {
    const classroom = actor === 'ownerStudent' ? r.plan.classrooms.classB.id : r.plan.classrooms.classA.id
    for (const view of ['desktop', 'mobile'] as const) for (const theme of ['light', 'dark'] as const) {
      r.check(); await page.setViewportSize(view === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 })
      await page.emulateMedia({ colorScheme: theme })
      // Exercise the actual persisted theme preference, not a DOM class override.
      await page.evaluate(value => localStorage.setItem('theme', value), theme)
      await visit(r, page, classroom)
      await r.capture(`${actor}-${view}-${theme}`, page)
    }
  })
}

export async function runContextualTestWorkflow(r: ContextualTestRuntime): Promise<void> {
  r.check(); const baseline = await r.witness('baseline'); assertWorkflowBaseline(baseline, r.plan.retiredTestIds)
  await runContextualTestFontMatrix(r)
  const referenceProofs: ReferenceProof[] = []
  await r.withActor('ownerTeacher', async ownerA => r.withActor('ownerStudent', async ownerB => {
    const groups: Array<{ owner: Owner; page: Page; main: Exam; single: Exam; bulk: Exam }> = []
    for (const [owner, page, classroom] of [['ownerTeacher', ownerA, r.plan.classrooms.classA.id], ['ownerStudent', ownerB, r.plan.classrooms.classB.id]] as const) {
      const main = await createExam(r, page, owner, classroom, 'main'), single = await createExam(r, page, owner, classroom, 'single'), bulk = await createExam(r, page, owner, classroom, 'bulk')
      groups.push({ owner, page, main, single, bulk }); await reorder(r, page, classroom)
      requireThat(main.referenceProof); referenceProofs.push(main.referenceProof)
    }
    const created = await r.witness('owners-authored')
    requireThat(created.tests.length === 8 && created.question_counts.length === 6 && created.question_counts.every(q => q.count === 2))
    requireThat(referenceProofs.length === 2); assertContextualTestReferenceObjects(created.objects, referenceProofs)
    for (const group of groups) { r.check(); await participate(r, group.page, group.main); await gradeAndReturn(r, group.page, group.main); await resetScratch(r, group.page, group.single, false); await resetScratch(r, group.page, group.bulk, true) }
    const a = groups[0], b = groups[1]
    await denialBlock(r, 'foreign-owner', async () => {
      await r.api(ownerA, 'GET', `/api/teacher/tests/${b.main.id}`, undefined, 403)
      await r.api(ownerA, 'PATCH', `/api/teacher/tests/${b.main.id}`, { title: 'Forbidden title' }, 403)
      await r.api(ownerA, 'POST', '/api/teacher/tests/reorder/atomic', { classroom_id: a.main.classroom, test_ids: [b.main.id] }, 409)
      await r.api(ownerA, 'POST', '/api/teacher/tests/reorder/atomic', { classroom_id: b.main.classroom, test_ids: (await r.witness('foreign-parent-selection')).tests.filter(t => t.classroom_id === b.main.classroom).map(t => t.id) }, 403)
      await r.api(ownerB, 'GET', `/api/teacher/tests/${a.main.id}`, undefined, 403)
      await r.api(ownerB, 'PATCH', `/api/teacher/tests/${a.main.id}`, { title: 'Forbidden reverse title' }, 403)
      await r.api(ownerA, 'POST', `/api/teacher/tests/${a.main.id}/student-access`, { student_ids: [r.plan.actors.nonmember.id], state: 'open' }, 400)
      requireThat(b.main.documentId)
      await r.api(ownerA, 'GET', `/api/teacher/tests/${a.main.id}/documents/${b.main.documentId}/file`, undefined, 404)
      requireThat(a.main.documentId)
      await r.api(ownerB, 'GET', `/api/teacher/tests/${b.main.id}/documents/${a.main.documentId}/file`, undefined, 404)
      const foreign = (await r.api<Results>(ownerB, 'GET', `/api/teacher/tests/${b.main.id}/results`)).students.find(s => s.student_id === r.plan.actors.memberTeacher.id)?.answers[b.main.openId]
      requireThat(foreign)
      await r.api(ownerA, 'PATCH', `/api/teacher/tests/${a.main.id}/students/${r.plan.actors.memberTeacher.id}/grades`, { grades: [{ question_id: b.main.openId, response_id: foreign.response_id, expected_response_revision: foreign.response_revision, score: 3 }] }, 400)
    })
    await r.withActor('nonmember', async page => denialBlock(r, 'nonmember', async () => {
      await r.api(page, 'GET', `/api/student/tests/${a.main.id}`, undefined, 403)
      await r.api(page, 'POST', `/api/student/tests/${a.main.id}/start`, {}, 403)
      await r.api(page, 'PATCH', `/api/student/tests/${a.main.id}/attempt`, { expected_revision: 1, responses: {} }, 403)
      await r.api(page, 'POST', `/api/student/tests/${a.main.id}/respond`, { expected_revision: 1, responses: {} }, 403)
      await r.api(page, 'GET', `/api/student/tests/${a.main.id}/results`, undefined, 403)
      requireThat(a.main.documentId)
      await r.api(page, 'GET', `/api/student/tests/${a.main.id}/documents/${a.main.documentId}/file`, undefined, 403)
    }))
    await access(r, ownerA, a.bulk, 'open', ['memberTeacher'])
    await r.withActor('memberTeacher', async cached => {
      await begin(r, cached, a.bulk); await answer(r, cached, a.bulk, 'Membership pending response')
      const saved = await r.api<{ attempt: Attempt }>(cached, 'GET', `/api/student/tests/${a.bulk.id}/attempt`)
      const membershipBefore = await r.witness('membership-before')
      await r.mutate('revokeMemberTeacherA')
      const revoked = await r.witness('membership-revoked')
      requireThat(!revoked.memberships.some(m => m.classroom_id === a.main.classroom && m.student_id === r.plan.actors.memberTeacher.id))
      await denialBlock(r, 'revoked-cached', async () => {
        await r.api(cached, 'PATCH', `/api/student/tests/${a.bulk.id}/attempt`, { expected_revision: saved.attempt.draft_revision, responses: { [a.bulk.openId]: 'Forbidden replacement' } }, 403)
        await r.api(cached, 'POST', `/api/student/tests/${a.bulk.id}/respond`, { expected_revision: saved.attempt.draft_revision, responses: saved.attempt.responses }, 403)
        await r.api(cached, 'GET', `/api/student/tests/${a.bulk.id}/attempt`, undefined, 403)
      })
      await r.withActor('memberTeacher', async current => denialBlock(r, 'revoked-current', async () => { await r.api(current, 'GET', `/api/student/tests/${a.bulk.id}`, undefined, 403); await r.api(current, 'POST', `/api/student/tests/${a.bulk.id}/start`, {}, 403) }))
      await r.mutate('restoreMemberTeacherA'); const restored = await r.witness('membership-restored')
      assertRestoredMembership(membershipBefore, restored, a.main.classroom, r.plan.actors.memberTeacher.id)
      assertForbiddenGraphUnchanged(revoked, restored)
      const classBefore = await r.witness('class-before-archive')
      await r.mutate('archiveA'); const archived = await r.witness('class-archived')
      requireThat(archived.classes.find(c => c.id === a.main.classroom)?.archived_at)
      await denialBlock(r, 'archived-cached-owner-member', async () => {
        await r.api(ownerA, 'PATCH', `/api/teacher/tests/${a.main.id}`, { title: 'Forbidden archived edit' }, 403)
        await r.api(cached, 'GET', `/api/student/tests/${a.bulk.id}`, undefined, 403)
        await r.api(cached, 'PATCH', `/api/student/tests/${a.bulk.id}/attempt`, { expected_revision: saved.attempt.draft_revision, responses: {} }, 403)
        await r.api(cached, 'POST', `/api/student/tests/${a.bulk.id}/respond`, { expected_revision: saved.attempt.draft_revision, responses: saved.attempt.responses }, 403)
      })
      await r.withActor('memberStudent', async current => denialBlock(r, 'archived-current', async () => { await r.api(current, 'GET', `/api/student/tests/${a.main.id}`, undefined, 403) }))
      await r.withActor('ownerTeacherPeer', async current => denialBlock(r, 'archived-current-owner', async () => { await r.api(current, 'PATCH', `/api/teacher/tests/${a.main.id}`, { title: 'Forbidden current archived edit' }, 403) }))
      await r.mutate('restoreArchiveA'); const unarchived = await r.witness('class-restored')
      requireThat(unarchived.classes.find(c => c.id === a.main.classroom)?.archived_at === null)
      assertRestoredClass(classBefore, unarchived, a.main.classroom)
      assertForbiddenGraphUnchanged(archived, unarchived)
    })
    await access(r, ownerA, a.bulk, 'closed')
    await r.api(ownerA, 'POST', `/api/teacher/tests/${a.bulk.id}/students/attempts/bulk-delete`, { student_ids: [r.plan.actors.memberTeacher.id] })
    for (const group of groups) { await discardScratch(r, group.page, group.single); await discardScratch(r, group.page, group.bulk) }
  }))
  await matrix(r)
  const final = await r.witness('final')
  requireThat(final.tests.length === 4 && final.tests.filter(t => t.retired).length === 2 && final.objects.length === 2)
  assertContextualTestReferenceObjects(final.objects, referenceProofs)
  requireThat(final.attempts.length === 4 && final.attempts.every(a => a.is_submitted && a.returned_at && a.draft_revision > 0))
  requireThat(final.response_count === 8 && final.history_count >= 4 && final.question_counts.length === 2 && final.question_counts.every(q => q.count === 2))
  requireThat(final.classes.every(c => c.archived_at === null) && final.memberships.length === baseline.memberships.length)
  r.check()
}
