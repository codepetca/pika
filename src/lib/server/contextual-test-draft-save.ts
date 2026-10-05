import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import type { getServiceRoleClient } from '@/lib/supabase'
import { buildNextDraftContent, buildTestDraftContentFromRows } from '@/lib/server/assessment-drafts'
import { validateTestDraftContent } from '@/lib/validations/assessment-drafts'
import { getPortableTestQuestionIdentity, getTestDraftIdentityResolutionOptions, projectPortableTestQuestionIds } from '@/lib/test-question-identity'
import { allowsTestQuestionChanges, TEST_CORRECTIONS_MESSAGE } from '@/lib/test-editing-policy'
import { MAX_TEST_DOCUMENTS, stripTestDocumentSnapshots, validateTestDocumentsPayload } from '@/lib/test-documents'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import {
  TEST_DRAFT_SAVE_QUESTION_LIMIT, TEST_DRAFT_SAVE_CONTENT_BYTES, TEST_DRAFT_SAVE_DOCUMENT_BYTES, TEST_DRAFT_SAVE_ENVELOPE_BYTES,
  TEST_DRAFT_SAVE_TOTAL_BYTES, TEST_DRAFT_SAVE_DEADLINE_MS, TEST_DRAFT_SAVE_MAX_VERSION,
  contextualTestDraftSaveContentSchema, contextualTestDraftSaveIdentitySchema,
  contextualTestDraftSaveSnapshotSchema, contextualTestDraftSaveFinalSchema, contextualTestDraftSaveRpcEnvelopeSchema,
  type ContextualTestDraftSaveInput,
} from '@/lib/validations/contextual-test-draft-save'
import type { TestDraftContent } from '@/types'

const unavailable = () => new ApiError(503, 'Unable to verify test draft save')
const ambiguous = () => new ApiError(409, 'Test draft question identity is ambiguous')

/** SQL owns the current owner, fixed parent, source/document CAS, inner writer
 * and post-trigger verification. This helper never performs a table or Storage
 * fallback, including after conflicts or missing transaction capabilities. */
export async function saveContextualTestDraft(input: {
  supabase: ReturnType<typeof getServiceRoleClient>; actorId: string; testId: string; input: ContextualTestDraftSaveInput; deadline?: number;
}) {
  const identity = contextualTestDraftSaveIdentitySchema.safeParse({ actorId: input.actorId, testId: input.testId })
  if (!identity.success) throw new ApiError(400, 'Invalid test draft save identity')
  const { actorId, testId } = identity.data
  const controller = new AbortController()
  const deadline = Math.min(input.deadline ?? Infinity, Date.now() + TEST_DRAFT_SAVE_DEADLINE_MS)
  if (!Number.isFinite(deadline) || deadline <= Date.now()) throw unavailable()
  const deadlineIso = new Date(deadline).toISOString()
  const timer = setTimeout(() => controller.abort(), deadline - Date.now())
  let statements = 0; let bytes = 0
  const checkDeadline = () => { if (controller.signal.aborted || Date.now() >= deadline) throw unavailable() }
  function bound(value: unknown, limit: number, status = 503) {
    checkDeadline()
    if (!boundedAssignmentListJson(value, limit)) throw status === 400 ? new ApiError(400, 'Draft content exceeds save limits') : unavailable()
    bytes += Buffer.byteLength(JSON.stringify(value), 'utf8')
    if (bytes > TEST_DRAFT_SAVE_TOTAL_BYTES) throw status === 400 ? new ApiError(400, 'Draft content exceeds save limits') : unavailable()
    checkDeadline()
  }
  async function execute(query: () => PromiseLike<unknown>, final = false) {
    checkDeadline()
    if (++statements > 2) throw unavailable()
    const pending = query()
    const result = await new Promise<unknown>((resolve, reject) => {
      const abort = () => reject(unavailable())
      controller.signal.addEventListener('abort', abort, { once: true })
      Promise.resolve(pending).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort))
      if (controller.signal.aborted) abort()
    })
    checkDeadline(); bound(result, TEST_DRAFT_SAVE_ENVELOPE_BYTES)
    const decoded = contextualTestDraftSaveRpcEnvelopeSchema.safeParse(result)
    if (!decoded.success) throw unavailable()
    const { data, error, status } = decoded.data
    if (error) {
      if (data !== null) throw unavailable()
      if (error.code === 'PT400') throw new ApiError(400, 'Invalid test draft save')
      if (error.code === 'PT403') throw new ApiError(403, 'Forbidden')
      if (error.code === 'PT404') throw new ApiError(final ? 409 : 404, final ? 'Test draft changed' : 'Test not found')
      if (final && error.code === 'PT409' && error.message === 'test_questions_locked: Only question wording and existing choice text can change after a student starts') {
        throw new ApiError(409, TEST_CORRECTIONS_MESSAGE)
      }
      if (['PT409', '23505', '55P03', '40P01', '40001'].includes(error.code)) throw new ApiError(409, 'Test draft changed')
      throw unavailable()
    }
    if (status !== undefined && (status < 200 || status >= 300)) throw unavailable()
    return data
  }
  try {
    bound(input.input, TEST_DRAFT_SAVE_ENVELOPE_BYTES, 400)
    const parsed = contextualTestDraftSaveSnapshotSchema.safeParse(await execute(() => input.supabase.rpc('snapshot_test_draft_save_for_owner_v1', {
      p_actor_id: actorId, p_test_id: testId, p_deadline: deadlineIso,
    }).abortSignal(controller.signal)))
    if (!parsed.success) throw unavailable()
    checkDeadline()
    const source = parsed.data
    const { classroom, test, draft, questions } = source
    const classroomId = classroom.id
    if (source.actor_id !== actorId || test.id !== testId || test.classroom_id !== classroomId) throw unavailable()
    if (classroom.teacher_id !== actorId || classroom.archived_at !== null || test.blueprint_archived_at !== null) throw new ApiError(403, 'Forbidden')
    if (draft && (draft.assessment_id !== testId || draft.classroom_id !== classroomId || draft.assessment_type !== 'test')) throw unavailable()
    if (source.question_count !== questions.length || new Set(questions.map(q => q.id)).size !== questions.length) throw unavailable()
    for (let index = 0; index < questions.length; index++) {
      const question = questions[index]; const previous = questions[index - 1]
      if (question.test_id !== testId || (previous && (previous.position > question.position || (previous.position === question.position && previous.id >= question.id)))) throw unavailable()
    }
    // The complete raw source remains the CAS authority; normalization cannot
    // rescue oversize or structurally malformed raw documents/content.
    const sourceDocuments = validateTestDocumentsPayload(test.documents)
    if (!sourceDocuments.valid || !Array.isArray(test.documents) || test.documents.length > MAX_TEST_DOCUMENTS
      || new Set(sourceDocuments.documents.map(document => document.id)).size !== test.documents.length) throw unavailable()
    const rawSourceDocuments = test.documents
    if (draft && typeof draft.content === 'object' && draft.content !== null && !Array.isArray(draft.content)
      && Array.isArray(draft.content.questions) && draft.content.questions.length > TEST_DRAFT_SAVE_QUESTION_LIMIT) throw unavailable()
    checkDeadline()
    let baseline: TestDraftContent | null = null
    if (draft) {
      const validated = test.status === 'draft' ? validateTestDraftContent(draft.content, { allowEmptyQuestionText: true, requirePortableQuestionIdentity: true }) : null
      checkDeadline()
      if (validated?.valid) {
        const projected = projectPortableTestQuestionIds(validated.value, questions, getTestDraftIdentityResolutionOptions(validated.value))
        if (!projected.ok) throw ambiguous()
        baseline = projected.content
      } else if (test.status !== 'draft') {
        if (new Set(questions.map(getPortableTestQuestionIdentity)).size !== questions.length) throw ambiguous()
        checkDeadline()
        const rebuilt = buildTestDraftContentFromRows(test, questions)
        bound(rebuilt, TEST_DRAFT_SAVE_CONTENT_BYTES)
        const rebuiltValidation = validateTestDraftContent(rebuilt, { allowEmptyQuestionText: true, requirePortableQuestionIdentity: true })
        if (!rebuiltValidation.valid) throw unavailable()
        baseline = rebuiltValidation.value
      }
    }
    if (baseline) bound(baseline, TEST_DRAFT_SAVE_CONTENT_BYTES)
    const editingPolicy = { structureLocked: test.questions_locked_at !== null }
    let operation: 'inspect' | 'save' = 'inspect'
    let conflict = 'Reload test draft before saving'
    let candidate = baseline
    if (baseline && draft) {
      conflict = 'Draft updated elsewhere'
      if (input.input.version === draft.version) {
        // Apply one decoded operation at a time to bound copy amplification and
        // cumulative work before canonical normalization drops unknown fields.
        let raw: object = baseline
        if (input.input.patch !== undefined) {
          for (const op of input.input.patch) {
            checkDeadline()
            const patched = buildNextDraftContent(raw, { patch: [op] }, value => {
              bound(value, TEST_DRAFT_SAVE_CONTENT_BYTES, 400)
              return value !== null && typeof value === 'object' && !Array.isArray(value)
                ? { valid: true, value } : { valid: false, error: 'Invalid draft content' }
            })
            if (!patched.ok) throw new ApiError(400, patched.error)
            raw = patched.content
          }
        } else raw = input.input.content!
        bound(raw, TEST_DRAFT_SAVE_CONTENT_BYTES, 400)
        if (!contextualTestDraftSaveContentSchema.safeParse(raw).success) throw new ApiError(400, 'Invalid draft content')
        const next = buildNextDraftContent(baseline, { content: raw }, value => validateTestDraftContent(value, {
          allowEmptyQuestionText: test.status === 'draft', requirePortableQuestionIdentity: true,
        }))
        if (!next.ok) throw new ApiError(400, next.error)
        bound(next.content, TEST_DRAFT_SAVE_CONTENT_BYTES, 400)
        if (allowsTestQuestionChanges(baseline.questions, next.content.questions, editingPolicy)) {
          if (draft.version === TEST_DRAFT_SAVE_MAX_VERSION || Date.parse(draft.updated_at) > Date.now() || Date.parse(test.updated_at) > Date.now()) throw unavailable()
          candidate = next.content; operation = 'save'
        } else conflict = TEST_CORRECTIONS_MESSAGE
      }
    }
    const candidateJson = candidate === null ? null : z.json().parse(candidate)
    const updateDocuments = operation === 'save' && input.input.documents !== undefined
    const documents = updateDocuments ? stripTestDocumentSnapshots(input.input.documents).map((document, index) => {
      const proposed = input.input.documents![index]
      // Snapshot stripping is shared legacy code and omits this presentation
      // field. Retain the decoded upload MIME; SQL binds it to the managed
      // object's authoritative content type before persistence.
      if (document.source === 'upload' && proposed.upload_content_type) return { ...document, upload_content_type: proposed.upload_content_type }
      if (document.source !== 'link') return document
      const current = rawSourceDocuments.find(value => value !== null && typeof value === 'object' && !Array.isArray(value)
        && value.id === document.id && value.source === document.source && value.url === document.url)
      if (current === undefined || current === null || typeof current !== 'object' || Array.isArray(current)
        || typeof current.snapshot_path !== 'string' || current.snapshot_path === '') return document
      // Match the raw SQL-bound identity and preserve only its four explicit
      // snapshot fields. Source normalization must not invent a match or alter
      // a bound snapshot path, MIME or stamp.
      if ((Object.hasOwn(current, 'snapshot_managed_object_id') && typeof current.snapshot_managed_object_id !== 'string')
        || (Object.hasOwn(current, 'snapshot_content_type') && typeof current.snapshot_content_type !== 'string')
        || (Object.hasOwn(current, 'synced_at') && current.synced_at !== null && typeof current.synced_at !== 'string')) throw unavailable()
      return { ...document, snapshot_path: current.snapshot_path,
        ...(typeof current.snapshot_managed_object_id === 'string' ? { snapshot_managed_object_id: current.snapshot_managed_object_id } : {}),
        ...(typeof current.snapshot_content_type === 'string' ? { snapshot_content_type: current.snapshot_content_type } : {}),
        ...(current.synced_at === null || typeof current.synced_at === 'string' ? { synced_at: current.synced_at } : {}),
      }
    }) : null
    if (documents) bound(documents, TEST_DRAFT_SAVE_DOCUMENT_BYTES, 400)
    checkDeadline()
    const final = contextualTestDraftSaveFinalSchema.safeParse(await execute(() => input.supabase.rpc('finish_test_draft_save_for_owner_v1', {
      p_actor_id: actorId, p_test_id: testId, p_classroom_id: classroomId, p_expected_source_sha256: source.source_sha256,
      p_expected_version: draft?.version ?? null, p_operation: operation, p_content: candidateJson,
      p_documents: documents === null ? null : z.json().parse(documents), p_update_documents: updateDocuments, p_deadline: deadlineIso,
    }).abortSignal(controller.signal), true))
    if (!final.success) throw unavailable()
    checkDeadline()
    const result = final.data; const row = result.draft
    if (result.actor_id !== actorId || result.classroom_id !== classroomId || result.test_id !== testId || result.operation !== operation
      || result.test.id !== testId || result.test.classroom_id !== classroomId || !isDeepStrictEqual(result.editingPolicy, editingPolicy)) throw unavailable()
    if (operation === 'inspect') {
      if (!isDeepStrictEqual(result.test, test) || !isDeepStrictEqual(row, candidateJson === null ? null : { ...draft!, content: candidateJson })) throw unavailable()
      if (baseline === null) return { status: 409 as const, body: { error: conflict } }
      const body = { error: conflict, draft: { ...row!, content: baseline }, test: result.test, editingPolicy: result.editingPolicy }
      bound(body, TEST_DRAFT_SAVE_ENVELOPE_BYTES); checkDeadline()
      return { status: 409 as const, body }
    }
    if (!draft || !row || !candidate || row.id !== draft.id || row.assessment_id !== testId || row.classroom_id !== classroomId
      || row.created_by !== draft.created_by || row.created_at !== draft.created_at || row.version !== draft.version + 1
      || row.updated_by !== actorId || Date.parse(row.updated_at) < Date.parse(draft.updated_at) || Date.parse(row.updated_at) > deadline
      || !isDeepStrictEqual(row.content, candidateJson)) throw unavailable()
    const expectedTest = { ...test, title: candidate.title, show_results: candidate.show_results, documents: updateDocuments ? documents : test.documents, updated_at: result.test.updated_at }
    if (!isDeepStrictEqual(result.test, expectedTest) || Date.parse(result.test.updated_at) < Date.parse(test.updated_at) || Date.parse(result.test.updated_at) > deadline) throw unavailable()
    const body = { draft: { ...row, content: candidate }, test: result.test, editingPolicy: result.editingPolicy }
    bound(body, TEST_DRAFT_SAVE_ENVELOPE_BYTES); checkDeadline()
    return { status: 200 as const, body }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw unavailable()
  } finally { clearTimeout(timer); controller.abort() }
}
