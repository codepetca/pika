import { NextResponse } from 'next/server'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { ApiError } from '@/lib/api-error'
import { getServiceRoleClient } from '@/lib/supabase'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { contextualTestDraftGetRpcEnvelopeSchema } from '@/lib/validations/contextual-test-draft-get'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import { getEffectiveStudentTestAccess } from '@/lib/server/tests'
import { getStudentTestStatus, summarizeTestFocusEvents } from '@/lib/tests'
import { normalizeTestResponses, buildTestAttemptHistoryMetrics } from '@/lib/test-attempts'
import { createJsonPatch, shouldStoreSnapshot } from '@/lib/json-patch'
import { normalizeTestDocuments, getTestDocumentStoragePath, isAllowedTestDocumentType, isSupportedLinkSnapshotContentType, normalizeSnapshotContentType } from '@/lib/test-documents'
import { buildSnapshotResponse } from '@/lib/server/test-document-snapshots'
import { resolveTestDocumentUploadContentTypes } from '@/lib/server/test-document-content-types'
import { buildPrivateStorageRedirect, buildPublicStorageCompatibilityRedirect, getPrivateStorageContentType } from '@/lib/server/direct-storage-delivery'
import {
  testLearnerIdentitySchema, testLearnerParamsSchema, testLearnerHistoryQuerySchema, testLearnerWitnessSchema, testLearnerResultSchemas, testLearnerPayloadSchemas, testLearnerQuestionSchema,
  TEST_LEARNER_DEADLINE_MS, TEST_LEARNER_REPLY_BYTES, TEST_LEARNER_TOTAL_BYTES, TEST_LEARNER_RPC_LIMIT,
  resolveTestLearnerParams, readTestLearnerBody, parseTestLearnerPayload, type TestLearnerOperation,
} from '@/lib/validations/contextual-test-learner-workflow'
import type { Json } from '@/types/database.generated'

/** Temporary exact application-owned signature until genuine CLI metadata is
 * supplied. Only this new RPC is adapted; the central Database is not widened. */
export type TestLearnerRpcClient = { rpc(name: 'test_learner_workflow_v1', args: {
  p_actor_id: string; p_test_id: string; p_classroom_id: string | null; p_operation: TestLearnerOperation;
  p_payload: Json; p_deadline: string;
}): { abortSignal(signal: AbortSignal): PromiseLike<unknown> } }
const unavailable = () => new ApiError(503, 'Unable to verify test operation')
type Result<K extends TestLearnerOperation> = z.output<typeof testLearnerResultSchemas[K]>

export function createContextualTestLearnerWorkflow(input: { supabase: TestLearnerRpcClient; actorId: string; testId: string;
  requestedStudentId?: string; deadline?: number; signal?: AbortSignal }) {
  const identity = testLearnerIdentitySchema.parse({ actorId: input.actorId, testId: input.testId })
  // Parse only the actual identity fields, never trust extra transport fields.
  const deadline = Math.min(input.deadline ?? Infinity, Date.now() + TEST_LEARNER_DEADLINE_MS)
  let classroomId: string | null = null; let subjectId: string | null = null; let statements = 0; let bytes = 0
  const query = testLearnerHistoryQuerySchema.parse(input.requestedStudentId ? { requested_student_id: input.requestedStudentId } : {})
  async function within<T>(operation: () => PromiseLike<T>) {
    if (!Number.isFinite(deadline) || Date.now() >= deadline || input.signal?.aborted) throw unavailable()
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort: (() => void) | undefined
    try { return await Promise.race([operation(), new Promise<never>((_, reject) => {
      abort = () => reject(unavailable()); input.signal?.addEventListener('abort', abort, { once: true })
      timer = setTimeout(abort, Math.max(0, deadline - Date.now())); if (input.signal?.aborted) abort()
    })]) } finally { clearTimeout(timer); if (abort) input.signal?.removeEventListener('abort', abort) }
  }
  async function run<K extends TestLearnerOperation>(operation: K, payload: Json = {}): Promise<Result<K>> {
    if (operation !== 'inspect' && classroomId === null) throw unavailable()
    if (++statements > TEST_LEARNER_RPC_LIMIT) throw unavailable()
    const controller = new AbortController(); const abort = () => controller.abort()
    input.signal?.addEventListener('abort', abort, { once: true }); const timer = setTimeout(abort, Math.max(0, deadline - Date.now()))
    try {
      if (!boundedAssignmentListJson(payload, 2 * 1024 * 1024)) throw unavailable()
      const args = testLearnerPayloadSchemas[operation].parse({ ...z.record(z.string(), z.json()).parse(payload), ...query })
      const raw = await within(() => input.supabase.rpc('test_learner_workflow_v1', {
        p_actor_id: identity.actorId, p_test_id: identity.testId, p_classroom_id: classroomId,
        p_operation: operation, p_payload: z.json().parse(args), p_deadline: new Date(deadline).toISOString(),
      }).abortSignal(controller.signal))
      if (controller.signal.aborted || Date.now() >= deadline || !boundedAssignmentListJson(raw, TEST_LEARNER_REPLY_BYTES)) throw unavailable()
      bytes += Buffer.byteLength(JSON.stringify(raw), 'utf8'); if (bytes > TEST_LEARNER_TOTAL_BYTES) throw unavailable()
      const envelope = contextualTestDraftGetRpcEnvelopeSchema.safeParse(raw); if (!envelope.success) throw unavailable()
      if (envelope.data.error) {
        const statuses: Record<string, number> = { PT400: 400, PT403: 403, PT404: 404, PT409: 409 }
        const status = statuses[envelope.data.error.code]
        if (envelope.data.data !== null || !status) throw unavailable()
        throw new ApiError(status, { 400: 'Invalid test operation', 403: 'Forbidden', 404: 'Test not found', 409: 'Test access changed; reload and retry' }[status] ?? 'Unable to verify test operation')
      }
      if (envelope.data.status !== undefined && (envelope.data.status < 200 || envelope.data.status >= 300)) throw unavailable()
      const witness = testLearnerWitnessSchema.safeParse(envelope.data.data); if (!witness.success) throw unavailable()
      const value = witness.data
      if (value.actor_id !== identity.actorId || value.test_id !== identity.testId || value.operation !== operation
        || (classroomId !== null && value.classroom_id !== classroomId)
        || value.subject_id !== (query.requested_student_id ?? identity.actorId) || (subjectId !== null && value.subject_id !== subjectId)) throw unavailable()
      const decoded = testLearnerResultSchemas[operation].safeParse(value.result); if (!decoded.success) throw unavailable()
      classroomId ??= value.classroom_id; subjectId ??= value.subject_id
      const result = decoded.data
      // Every nested resource is independently bound after strict projection.
      if ('attempt' in result && result.attempt && (result.attempt.test_id !== identity.testId || result.attempt.student_id !== subjectId)) throw unavailable()
      if ('state' in result && (result.state.test.id !== identity.testId || result.state.test.classroom_id !== classroomId)) throw unavailable()
      if (operation === 'detail') {
        const detail = testLearnerResultSchemas.detail.parse(result)
        if ((detail.state.attempt?.id ?? null) !== (detail.attempt?.id ?? null)) throw unavailable()
      }
      if ('questions' in result) {
        const questions = z.array(testLearnerQuestionSchema).parse(result.questions)
        if (new Set(questions.map(q => q.id)).size !== questions.length || questions.some(q => q.test_id !== identity.testId)) throw unavailable()
      }
      if ('history' in result && result.history.some(h => h.test_attempt_id !== result.attemptId)) throw unavailable()
      if (operation === 'history-plan') {
        const plan = testLearnerResultSchemas['history-plan'].parse(result)
        if (plan.last_history && plan.last_history.test_attempt_id !== plan.attempt.id) throw unavailable()
      }
      if (operation === 'results') {
        const returned = testLearnerResultSchemas.results.parse(result)
        const { state } = returned
        const effectiveClosed = (state.access_state ?? (state.test.status === 'active' ? 'open' : 'closed')) === 'closed'
        if (!state.attempt?.returned_at || (!(state.has_submitted || state.attempt.closed_for_grading_at) || !effectiveClosed)
          && !(state.test.status === 'closed' && state.has_submitted)) throw unavailable()
        const questions = new Map(returned.question_results.map(question => [question.question_id, question]))
        if (questions.size !== returned.question_results.length || new Set(returned.results.map(row => row.question_id)).size !== returned.results.length
          || Object.keys(returned.my_responses).some(id => !questions.has(id))) throw unavailable()
        for (const aggregate of returned.results) {
          const question = questions.get(aggregate.question_id)
          if (!question || question.question_type !== 'multiple_choice' || question.question_text !== aggregate.question_text
            || !isDeepStrictEqual(question.options, aggregate.options) || aggregate.counts.length !== aggregate.options.length
            || aggregate.counts.reduce((sum, count) => sum + count, 0) !== aggregate.total_responses) throw unavailable()
        }
      }
      if ('attempt_id' in result && typeof payload === 'object' && payload !== null && !Array.isArray(payload)
        && operation === 'submit' && (typeof result.draft_revision !== 'number' || result.draft_revision < 1)) throw unavailable()
      if ('historyEntry' in result && result.historyEntry && typeof payload === 'object' && payload !== null && !Array.isArray(payload)
        && result.historyEntry.test_attempt_id !== payload.attempt_id) throw unavailable()
      return result as Result<K>
    } catch (error) { if (error instanceof ApiError) throw error; throw unavailable() }
    finally { clearTimeout(timer); input.signal?.removeEventListener('abort', abort); controller.abort() }
  }
  return { deadline, within, run, inspect: () => run('inspect'), get classroomId() { return classroomId } }
}

function statePresentation(state: Result<'session'>['state']) {
  const access = getEffectiveStudentTestAccess({ testStatus: state.test.status, accessState: state.access_state,
    hasSubmitted: state.has_submitted, returnedAt: state.attempt?.returned_at, isLockedForGrading: !!state.attempt?.closed_for_grading_at })
  const status = (state.has_submitted || state.attempt?.closed_for_grading_at) && state.attempt?.returned_at && access.effective_access === 'closed'
    ? 'can_view_results' : state.attempt?.closed_for_grading_at ? 'responded' : getStudentTestStatus(state.test, state.has_submitted, state.attempt?.returned_at)
  return { access, status }
}
type Flow = ReturnType<typeof createContextualTestLearnerWorkflow>
async function bestEffortHistory(flow: Flow, input: { attemptId: string; revision: number; responses: unknown;
  previousResponses?: unknown; created?: boolean; trigger: 'autosave' | 'blur' | 'submit'; paste: number; keystrokes: number }) {
  try {
    const plan = await flow.run('history-plan', { attempt_id: input.attemptId, draft_revision: input.revision })
    if (plan.attempt.id !== input.attemptId || plan.attempt.draft_revision !== input.revision
      || !isDeepStrictEqual(normalizeTestResponses(plan.attempt.responses), normalizeTestResponses(input.responses))) throw unavailable()
    const next = normalizeTestResponses(input.responses); const patch = createJsonPatch(normalizeTestResponses(input.previousResponses), next)
    if (input.trigger !== 'submit' && input.created !== true && patch.length === 0) return null
    const last = plan.last_history; const collapse = input.trigger !== 'submit' && last !== null && last.trigger !== 'submit'
      && Date.now() - Date.parse(last.created_at) < 10000
    const baseline = input.created === true || !last || input.trigger === 'submit'
    const snapshot = baseline || collapse || shouldStoreSnapshot(patch, next)
    const metrics = buildTestAttemptHistoryMetrics(next, input.paste, input.keystrokes)
    const written = await flow.run('history-write', z.json().parse({ attempt_id: input.attemptId, draft_revision: input.revision,
      expected_last: last, collapse, patch: snapshot ? null : patch, snapshot: snapshot ? next : null,
      trigger: input.trigger === 'submit' ? 'submit' : baseline ? 'baseline' : input.trigger,
      ...metrics, paste_word_count: metrics.paste_word_count + (collapse ? last!.paste_word_count ?? 0 : 0),
      keystroke_count: metrics.keystroke_count + (collapse ? last!.keystroke_count ?? 0 : 0) }))
    return written.historyEntry
  } catch { return null }
}

export async function handleContextualTestLearnerRequest(operation: Exclude<TestLearnerOperation, 'inspect'|'history-plan'|'history-write'>,
  request: Request, params: Promise<unknown>, source?: 'upload' | 'link'): Promise<NextResponse | null> {
  if (!isClassroomExperienceAdmissionConfigured()) return null
  const actor = await requireAuth()
  if (resolveClassroomExperienceAdmission(actor).status !== 'admitted') return null
  const deadline = Date.now() + TEST_LEARNER_DEADLINE_MS
  const parsedParams = testLearnerParamsSchema.parse(await resolveTestLearnerParams(request, params, deadline))
  const rawSubject = operation === 'history' ? new URL(request.url).searchParams.get('student_id') : null
  const query = testLearnerHistoryQuerySchema.parse(rawSubject === null ? {} : { requested_student_id: rawSubject })
  const client = getServiceRoleClient()
  const flow = createContextualTestLearnerWorkflow({ supabase: client as unknown as TestLearnerRpcClient, actorId: actor.id,
    testId: parsedParams.id, requestedStudentId: query.requested_student_id, deadline, signal: request.signal })
  const payload = ['save','submit','focus'].includes(operation)
    ? z.json().parse(parseTestLearnerPayload(operation, await readTestLearnerBody(request, deadline))) : {}
  await flow.inspect()
  if (operation === 'document') {
    if (!parsedParams.docId || !source) throw new ApiError(400, 'Invalid document request')
    const documentPayload = { document_id: parsedParams.docId, source }
    const before = await flow.run('document', documentPayload)
    const docs = normalizeTestDocuments([before.document]); const doc = docs[0]
    if (docs.length !== 1 || doc.id !== parsedParams.docId || doc.source !== source) throw unavailable()
    const path = source === 'upload' ? getTestDocumentStoragePath(doc) : doc.snapshot_path
    if (!path) throw unavailable()
    const objectId = source === 'upload' ? doc.managed_object_id : doc.snapshot_managed_object_id
    if (before.object && (before.object.classroom_id !== flow.classroomId
      || before.object.storage_path !== path || (objectId && before.object.id !== objectId)
      || before.object.purpose !== (source === 'upload' ? 'teacher_test_material' : 'test_execution_snapshot')
      || before.content_type !== before.object.content_type)) throw unavailable()
    const rawMime = before.content_type ?? await flow.within(() => getPrivateStorageContentType({ supabase: client, bucket: 'test-documents', path }))
    const mime = source === 'link' ? normalizeSnapshotContentType(rawMime) : rawMime
    if (!mime || !(source === 'upload' ? isAllowedTestDocumentType(mime) : isSupportedLinkSnapshotContentType(mime))) throw new ApiError(404, 'Document not found')
    const response = await flow.within(async () => {
      if (source === 'link') return buildSnapshotResponse({ ...doc, snapshot_content_type: mime })
      if (before.object === null) {
        const legacy = await buildPublicStorageCompatibilityRedirect({ supabase: client, bucket: 'test-documents', path })
        if (!legacy) throw new ApiError(404, 'Document not found')
        return legacy
      }
      return buildPrivateStorageRedirect({ supabase: client, bucket: 'test-documents', path })
    })
    const after = await flow.run('document', documentPayload)
    if (!isDeepStrictEqual(before, after)) throw new ApiError(409, 'Test document changed; reload and retry')
    return response
  }
  if (operation === 'start') return NextResponse.json({ started: true, ...await flow.run('start', payload) })
  if (operation === 'recover') return NextResponse.json(await flow.run('recover'))
  if (operation === 'history') return NextResponse.json(await flow.run('history'))
  if (operation === 'save' || operation === 'submit') {
    const result = await flow.run(operation, payload)
    if ('conflict' in result) return NextResponse.json({ error: 'Test answers changed. Reload or reconcile your answers before saving again.',
      error_code: 'test_attempt_revision_conflict', attempt: result.attempt }, { status: 409 })
    const submitted = 'attempt_id' in result
    const body = z.record(z.string(), z.json()).parse(payload)
    const historyEntry = await bestEffortHistory(flow, { attemptId: submitted ? result.attempt_id : result.attempt.id,
      revision: 'draft_revision' in result ? result.draft_revision : result.attempt.draft_revision, responses: body.responses,
      previousResponses: 'previous_responses' in result ? result.previous_responses : undefined, created: 'created' in result ? result.created : undefined,
      trigger: submitted ? 'submit' : body.trigger === 'blur' ? 'blur' : 'autosave', paste: Number(body.paste_word_count ?? 0), keystrokes: Number(body.keystroke_count ?? 0) })
    return submitted ? NextResponse.json({ success: true, draft_revision: result.draft_revision }, { status: 201 })
      : NextResponse.json({ attempt: result.attempt, historyEntry })
  }
  if (operation === 'focus') {
    const result = await flow.run('focus', payload)
    return NextResponse.json({ success: true, focus_summary: summarizeTestFocusEvents(result.focus_events) })
  }
  if (operation === 'detail') {
    const result = await flow.run('detail'); const { access, status } = statePresentation(result.state)
    const documents = await flow.within(() => resolveTestDocumentUploadContentTypes(result.state.test.documents, result.state.test.classroom_id, client))
    // MIME enrichment can consult Storage for historical uploads. Do not expose
    // its result until current access and the complete source have been rechecked.
    if (!isDeepStrictEqual(result, await flow.run('detail'))) throw new ApiError(409, 'Test changed; reload and retry')
    return NextResponse.json({ test: { ...result.state.test, documents, assessment_type: 'test',
      student_status: status, returned_at: result.state.attempt?.returned_at ?? null, access_state: access.access_state, effective_access: access.effective_access },
    questions: result.questions, student_status: status, student_responses: (result.state.has_submitted || result.state.attempt?.closed_for_grading_at)
      && Object.keys(result.submitted_responses).length ? result.submitted_responses : normalizeTestResponses(result.attempt?.responses),
    draft_revision: result.attempt?.draft_revision ?? null, focus_summary: summarizeTestFocusEvents(result.focus_events) })
  }
  if (operation === 'results') {
    const { state, ...result } = await flow.run('results'); const { access } = statePresentation(state)
    return NextResponse.json({ test: { id: state.test.id, title: state.test.title, status: state.test.status, returned_at: state.attempt?.returned_at ?? null,
      access_state: access.access_state, effective_access: access.effective_access }, ...result })
  }
  const { state } = await flow.run('session'); const { access, status } = statePresentation(state)
  const returned = state.attempt?.returned_at ?? null
  const message = access.can_start_or_continue ? null : !state.has_submitted && access.access_source === 'student'
    ? 'Your teacher closed access to this test. Your saved draft is preserved and can continue if your teacher opens it again.'
    : status === 'can_view_results' ? 'Your current work has been submitted. Results are now available from the tests list.'
    : status === 'responded' ? 'Your current work has been submitted.' : null
  return NextResponse.json({ test: { id: state.test.id, status: state.test.status, assessment_type: 'test', student_status: status,
    returned_at: returned, access_state: access.access_state, effective_access: access.effective_access },
    student_status: status, returned_at: returned, can_continue: access.can_start_or_continue, message })
}
