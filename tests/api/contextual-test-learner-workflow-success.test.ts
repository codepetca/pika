import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { requireAuth } from '@/lib/auth'
import { GET as detail } from '@/app/api/student/tests/[id]/route'
import { POST as start } from '@/app/api/student/tests/[id]/start/route'
import { GET as recover, PATCH as save } from '@/app/api/student/tests/[id]/attempt/route'
import { POST as submit } from '@/app/api/student/tests/[id]/respond/route'
import { GET as session } from '@/app/api/student/tests/[id]/session-status/route'
import { GET as history } from '@/app/api/student/tests/[id]/history/route'
import { POST as focus } from '@/app/api/student/tests/[id]/focus-events/route'
import { GET as results } from '@/app/api/student/tests/[id]/results/route'
import { GET as file } from '@/app/api/student/tests/[id]/documents/[docId]/file/route'
import { GET as snapshot } from '@/app/api/student/tests/[id]/documents/[docId]/snapshot/route'
import { resolveTestDocumentUploadContentTypes } from '@/lib/server/test-document-content-types'
import { buildPrivateStorageRedirect, buildPublicStorageCompatibilityRedirect } from '@/lib/server/direct-storage-delivery'
import { buildSnapshotResponse } from '@/lib/server/test-document-snapshots'
import type { TestLearnerOperation } from '@/lib/validations/contextual-test-learner-workflow'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }))
const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => ({ rpc })) }))
vi.mock('@/lib/server/test-document-content-types', () => ({ resolveTestDocumentUploadContentTypes: vi.fn(async documents => documents) }))
vi.mock('@/lib/server/direct-storage-delivery', () => ({ getPrivateStorageContentType: vi.fn(async () => 'application/pdf'),
  buildPrivateStorageRedirect: vi.fn(async () => NextResponse.redirect('https://storage.example.test/signed', 302)),
  buildPublicStorageCompatibilityRedirect: vi.fn(async () => NextResponse.redirect('https://storage.example.test/public', 302)) }))
vi.mock('@/lib/server/test-document-snapshots', () => ({ buildSnapshotResponse: vi.fn(async () => new NextResponse('<p>Safe snapshot</p>', { headers: { 'content-security-policy': "default-src 'none'" } })) }))

const actor = '11111111-1111-4111-8111-111111111111', classroom = '22222222-2222-4222-8222-222222222222'
const testId = '33333333-3333-4333-8333-333333333333', docId = '44444444-4444-4444-8444-444444444444'
const attemptId = '55555555-5555-4555-8555-555555555555', questionId = '66666666-6666-4666-8666-666666666666'
const objectId = '77777777-7777-4777-8777-777777777777', historyId = '88888888-8888-4888-8888-888888888888'
const stamp = '2026-10-10T12:00:00Z'
const answers = { [questionId]: { question_type: 'multiple_choice', selected_option: 1 } }
const attempt = { id: attemptId, test_id: testId, student_id: actor, responses: answers, is_submitted: false, submitted_at: null,
  created_at: stamp, updated_at: stamp, draft_revision: 12 }
const question = { id: questionId, test_id: testId, question_type: 'multiple_choice', question_text: 'Q', options: ['A','B'],
  points: 5, response_max_chars: 5000, response_monospace: false, position: 0, created_at: stamp, updated_at: stamp }
const state = { test: { id: testId, classroom_id: classroom, title: 'T', status: 'active', show_results: true, documents: [],
  position: 0, created_at: stamp, updated_at: stamp }, attempt: { id: attemptId, is_submitted: false, returned_at: null,
  closed_for_grading_at: null, draft_revision: 12 }, access_state: null, has_submitted: false }
const historyEntry = { id: historyId, test_attempt_id: attemptId, patch: null, snapshot: answers, word_count: 1,
  char_count: JSON.stringify(answers).length, paste_word_count: 0, keystroke_count: 0, trigger: 'baseline', created_at: stamp }
const path = `classrooms/${classroom}/tests/${testId}/documents/${docId}/${objectId}.pdf`
const document = { id: docId, title: 'PDF', source: 'upload', storage_bucket: 'test-documents', storage_path: path, managed_object_id: objectId }
const material = { document, content_type: 'application/pdf', object: { id: objectId, classroom_id: classroom,
  storage_path: path, status: 'ready', purpose: 'teacher_test_material', content_type: 'application/pdf' } }
const ctx = { params: Promise.resolve({ id: testId, docId }) }
const req = (method = 'GET', body?: unknown) => new NextRequest(`http://localhost/api/student/tests/${testId}`, { method,
  ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
type Args = { p_operation: TestLearnerOperation; p_payload: Record<string, unknown> }
let resultFor: (args: Args) => unknown
let errorFor: (args: Args) => string | undefined
const calls = () => rpc.mock.calls.map(([,args]) => args.p_operation)
describe('contextual learner Test positive dispatcher and dependent boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actor] }))
    vi.mocked(requireAuth).mockResolvedValue({ id: actor, role: 'teacher', email: 'free-member@example.test' })
    errorFor = () => undefined
    resultFor = ({ p_operation }) => ({
      inspect: { access_mode: 'member' }, start: { questions: [question], attempt }, recover: { attempt },
      detail: { state, attempt, questions: [question], submitted_responses: {}, focus_events: [] }, session: { state },
      history: { history: [historyEntry], attemptId }, focus: { event_id: objectId, focus_events: [] },
      save: { created: false, previous_responses: {}, attempt }, submit: { attempt_id: attemptId, submitted_at: stamp, inserted_responses: 1, draft_revision: 12 },
      'history-plan': { attempt, last_history: null }, 'history-write': { historyEntry }, document: material,
      results: { state: { ...state, attempt: { ...state.attempt, returned_at: stamp, is_submitted: true }, access_state: 'closed', has_submitted: true },
        results: [], my_responses: {}, question_results: [], summary: { earned_points: 0, possible_points: 0, percent: 0 } },
    }[p_operation])
    rpc.mockImplementation((_name, args: Args) => ({ abortSignal: async () => {
      const code = errorFor(args)
      // SDK replies are JSON-decoded trees, not aliased fixture object graphs.
      return code ? { data: null, error: { code, message: 'private failure' } } : JSON.parse(JSON.stringify({ error: null, data: { version: 1, actor_id: actor,
        classroom_id: classroom, test_id: testId, subject_id: actor, operation: args.p_operation, result: resultFor(args) } }))
    } }))
  })
  afterEach(() => vi.unstubAllEnvs())
  it('preserves Start, recovery, focus, history and returned-results response envelopes for a free teacher-role member', async () => {
    expect(await (await start(req('POST'),ctx)).json()).toEqual({ started: true, questions: [question], attempt })
    expect(await (await recover(req(),ctx)).json()).toEqual({ attempt })
    expect(await (await history(req(),ctx)).json()).toEqual({ history: [historyEntry], attemptId })
    expect(await (await focus(req('POST',{ session_id: 's', event_type: 'away_start' }),ctx)).json()).toMatchObject({ success: true })
    const returned = await results(req(),ctx)
    expect(returned.status).toBe(200); expect(await returned.json()).toMatchObject({ test: { returned_at: stamp }, results: [], question_results: [] })
  })
  it('returns safe detail only after the MIME enrichment access recheck', async () => {
    const response = await detail(req(),ctx); const value = await response.json()
    expect(response.status).toBe(200); expect(value).toMatchObject({ questions: [question], student_responses: answers, draft_revision: 12 })
    expect(calls()).toEqual(['inspect','detail','detail']); expect(resolveTestDocumentUploadContentTypes).toHaveBeenCalledOnce()
    expect(JSON.stringify(value)).not.toMatch(/correct_option|sample_solution|score|feedback|ai_reference/)
  })
  it('does not disclose enriched detail after membership is revoked during Storage work', async () => {
    let detailCalls = 0; errorFor = ({ p_operation }) => p_operation === 'detail' && ++detailCalls === 2 ? 'PT403' : undefined
    const response = await detail(req(),ctx)
    expect(response.status).toBe(403); expect(await response.json()).not.toHaveProperty('questions')
  })
  it('preserves selected closed-session saved-draft messaging', async () => {
    const base = resultFor; resultFor = args => args.p_operation === 'session' ? { state: { ...state, access_state: 'closed' } } : base(args)
    const response = await session(req(),ctx)
    expect(await response.json()).toMatchObject({ can_continue: false, message: expect.stringContaining('saved draft is preserved') })
  })
  it('separately CAS-writes successful save history at the exact post-save revision', async () => {
    const response = await save(req('PATCH',{ responses: answers, expected_revision: 11 }),ctx)
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ attempt, historyEntry })
    expect(calls()).toEqual(['inspect','save','history-plan','history-write'])
    expect(rpc).toHaveBeenLastCalledWith('test_learner_workflow_v1', expect.objectContaining({ p_payload: expect.objectContaining({
      attempt_id: attemptId, draft_revision: 12, expected_last: null, collapse: false, patch: null, snapshot: answers, trigger: 'baseline' }) }))
  })
  it('stores a compact patch after the collapse window when unchanged content makes a snapshot larger', async () => {
    const previous = { [questionId]: { question_type: 'multiple_choice', selected_option: 0 },
      [objectId]: { question_type: 'open_response', response_text: 'unchanged '.repeat(500) } }
    const next = { ...previous, [questionId]: answers[questionId] }
    const old = { ...historyEntry, snapshot: previous, created_at: new Date(Date.now()-20000).toISOString() }
    const base = resultFor; resultFor = args => args.p_operation === 'save' ? { created: false, previous_responses: previous, attempt: { ...attempt, responses: next } }
      : args.p_operation === 'history-plan' ? { attempt: { ...attempt, responses: next }, last_history: old } : base(args)
    expect((await save(req('PATCH',{ responses: next, expected_revision: 11 }),ctx)).status).toBe(200)
    expect(rpc).toHaveBeenLastCalledWith('test_learner_workflow_v1', expect.objectContaining({ p_payload: expect.objectContaining({
      expected_last: old, collapse: false, snapshot: null, patch: [{ op: 'replace', path: `/${questionId}/selected_option`, value: 1 }], trigger: 'autosave' }) }))
  })
  it('collapses recent non-submit history into a snapshot and accumulates paste/keystroke metrics', async () => {
    const recent = { ...historyEntry, paste_word_count: 3, keystroke_count: 4, created_at: new Date().toISOString(), trigger: 'blur' }
    const base = resultFor; resultFor = args => args.p_operation === 'history-plan' ? { attempt, last_history: recent } : base(args)
    expect((await save(req('PATCH',{ responses: answers, expected_revision: 11, paste_word_count: 2, keystroke_count: 6 }),ctx)).status).toBe(200)
    expect(rpc).toHaveBeenLastCalledWith('test_learner_workflow_v1', expect.objectContaining({ p_payload: expect.objectContaining({
      expected_last: recent, collapse: true, snapshot: answers, patch: null, trigger: 'autosave', paste_word_count: 5, keystroke_count: 10 }) }))
  })
  it('never collapses a prior submit and always writes the final submit snapshot', async () => {
    const recent = { ...historyEntry, created_at: new Date().toISOString(), trigger: 'submit' }
    const base = resultFor; resultFor = args => args.p_operation === 'history-plan' ? { attempt, last_history: recent } : base(args)
    const response = await submit(req('POST',{ responses: answers, expected_revision: 11 }),ctx)
    expect(response.status).toBe(201)
    expect(rpc).toHaveBeenLastCalledWith('test_learner_workflow_v1', expect.objectContaining({ p_payload: expect.objectContaining({
      expected_last: recent, collapse: false, snapshot: answers, patch: null, trigger: 'submit', word_count: 1 }) }))
  })
  it('does not append autosave history when normalized answers did not change', async () => {
    const base = resultFor; resultFor = args => args.p_operation === 'save' ? { created: false, previous_responses: answers, attempt } : base(args)
    const response = await save(req('PATCH',{ responses: answers, expected_revision: 11 }),ctx)
    expect(await response.json()).toEqual({ attempt, historyEntry: null }); expect(calls()).toEqual(['inspect','save','history-plan'])
  })
  it.each(['attempt','revision','responses','last-entry-attempt'])('skips history without rolling back answers after a %s plan mismatch', async mismatch => {
    const base = resultFor; resultFor = args => args.p_operation === 'history-plan' ? { attempt: { ...attempt,
      ...(mismatch === 'attempt' ? { id: objectId } : mismatch === 'revision' ? { draft_revision: 13 } : mismatch === 'responses' ? { responses: {} } : {}) },
    last_history: mismatch === 'last-entry-attempt' ? { ...historyEntry, test_attempt_id: objectId } : null } : base(args)
    const response = await save(req('PATCH',{ responses: answers, expected_revision: 11 }),ctx)
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ attempt, historyEntry: null })
    expect(calls()).toEqual(['inspect','save','history-plan'])
  })
  it.each(['history-plan','history-write'])('preserves successful answers/submission when best-effort %s fails', async failed => {
    errorFor = ({ p_operation }) => p_operation === failed ? 'PT409' : undefined
    const saved = await save(req('PATCH',{ responses: answers, expected_revision: 11 }),ctx)
    expect(saved.status).toBe(200); expect(await saved.json()).toEqual({ attempt, historyEntry: null })
    const submitted = await submit(req('POST',{ responses: answers, expected_revision: 11 }),ctx)
    expect(submitted.status).toBe(201); expect(await submitted.json()).toEqual({ success: true, draft_revision: 12 })
  })
  it('returns a narrow stale-open conflict without history attempts', async () => {
    const base = resultFor; resultFor = args => args.p_operation === 'save' ? { conflict: true, attempt } : base(args)
    const response = await save(req('PATCH',{ responses: answers, expected_revision: 11 }),ctx)
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error_code: 'test_attempt_revision_conflict', attempt })
    expect(calls()).toEqual(['inspect','save'])
  })
  it('delivers an exact private file only after the protected post-Storage tuple recheck', async () => {
    const response = await file(req(),ctx)
    expect(response.status).toBe(302); expect(buildPrivateStorageRedirect).toHaveBeenCalledOnce()
    expect(calls()).toEqual(['inspect','document','document'])
  })
  it.each(['revocation','tuple-swap'])('does not deliver a prepared file after %s', async kind => {
    let documentCalls = 0; const base = resultFor
    if (kind === 'revocation') errorFor = ({ p_operation }) => p_operation === 'document' && ++documentCalls === 2 ? 'PT403' : undefined
    else resultFor = args => args.p_operation === 'document' && ++documentCalls === 2 ? { ...material, document: { ...document, title: 'Changed' } } : base(args)
    const response = await file(req(),ctx)
    expect(response.status).toBe(kind === 'revocation' ? 403 : 409); expect(response.headers.has('location')).toBe(false)
    expect(buildPrivateStorageRedirect).toHaveBeenCalledOnce()
  })
  it('retains current attached unmanaged public-file compatibility with the same recheck', async () => {
    const { managed_object_id: _managedObjectId, ...legacyDocument } = document
    const base = resultFor; resultFor = args => args.p_operation === 'document'
      ? { ...material, object: null, document: legacyDocument } : base(args)
    const response = await file(req(),ctx)
    expect(response.status).toBe(302); expect(buildPublicStorageCompatibilityRedirect).toHaveBeenCalledOnce()
    expect(calls()).toEqual(['inspect','document','document'])
  })
  it('retains link snapshot delivery and its protected after-Storage recheck', async () => {
    const base = resultFor; resultFor = args => args.p_operation === 'document' ? { content_type: 'text/html',
      document: { id: docId, title: 'Link', source: 'link', url: 'https://example.test/ref', snapshot_path: path, snapshot_managed_object_id: objectId },
      object: { ...material.object, content_type: 'text/html', purpose: 'test_execution_snapshot' } } : base(args)
    const response = await snapshot(req(),ctx)
    expect(response.status).toBe(200); expect(response.headers.get('content-security-policy')).toBe("default-src 'none'")
    expect(buildSnapshotResponse).toHaveBeenCalledOnce(); expect(calls()).toEqual(['inspect','document','document'])
  })
})
