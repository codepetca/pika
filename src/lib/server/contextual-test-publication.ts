import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { isGeneratedAssessmentTitle } from '@/lib/assessment-titles'
import { canActivateTest } from '@/lib/tests'
import { normalizeTestDocuments } from '@/lib/test-documents'
import { getPortableTestQuestionIdentity, getTestDraftIdentityResolutionOptions, projectPortableTestQuestionIds } from '@/lib/test-question-identity'
import type { getServiceRoleClient } from '@/lib/supabase'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import { validateTestDraftContent } from '@/lib/validations/assessment-drafts'
import { contextualTestDraftGetSnapshotSchema, TEST_DRAFT_GET_QUESTION_LIMIT } from '@/lib/validations/contextual-test-draft-get'
import {
  TEST_PUBLICATION_BODY_BYTES, TEST_PUBLICATION_ROW_BYTES, TEST_PUBLICATION_CONTENT_BYTES,
  TEST_PUBLICATION_ENVELOPE_BYTES, TEST_PUBLICATION_TOTAL_BYTES, TEST_PUBLICATION_DEADLINE_MS,
  contextualTestPublicationIdentitySchema, contextualTestPublicationResultSchema, contextualTestPublicationRpcEnvelopeSchema,
  type ContextualTestPublicationInput,
} from '@/lib/validations/contextual-test-publication'

const unavailable = () => new ApiError(503, 'Unable to verify test publication')
const changed = () => new ApiError(409, 'Test changed before publication')

/** Read the persisted source without repair, then publish under final SQL locks
 * and source CAS. SQL owns complete unprojected metadata preservation. An
 * unknown acknowledgement never permits retries, cleanup or another path. */
export async function publishContextualTest(input: {
  supabase: ReturnType<typeof getServiceRoleClient>; actorId: string; testId: string; input: ContextualTestPublicationInput;
  deadline?: number; bodyBytes?: number; signal?: AbortSignal;
}) {
  const identity = contextualTestPublicationIdentitySchema.safeParse({ actorId: input.actorId, testId: input.testId })
  if (!identity.success) throw new ApiError(400, 'Invalid test publication identity')
  const { actorId, testId } = identity.data
  if (input.deadline !== undefined && !Number.isFinite(input.deadline)) throw unavailable()
  const deadline = Math.min(input.deadline ?? Infinity, Date.now() + TEST_PUBLICATION_DEADLINE_MS)
  if (!Number.isFinite(deadline) || Date.now() >= deadline || input.signal?.aborted) throw unavailable()
  const deadlineDate = new Date(deadline)
  if (!Number.isFinite(deadlineDate.getTime())) throw unavailable()
  const deadlineIso = deadlineDate.toISOString()
  let bytes = input.bodyBytes ?? 0; let statements = 0
  if (!Number.isInteger(bytes) || bytes < 0 || bytes > TEST_PUBLICATION_BODY_BYTES) throw unavailable()
  const controller = new AbortController()
  const callerAbort = () => controller.abort()
  input.signal?.addEventListener('abort', callerAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), deadline - Date.now())
  const checkDeadline = () => { if (controller.signal.aborted || Date.now() >= deadline) throw unavailable() }
  function bound(value: unknown, limit: number) {
    checkDeadline()
    if (!boundedAssignmentListJson(value, limit)) throw unavailable()
    bytes += Buffer.byteLength(JSON.stringify(value), 'utf8')
    if (bytes > TEST_PUBLICATION_TOTAL_BYTES) throw unavailable()
    checkDeadline()
  }
  async function execute(query: () => PromiseLike<unknown>) {
    checkDeadline(); if (++statements > 2) throw unavailable()
    const pending = query()
    const result = await new Promise<unknown>((resolve, reject) => {
      const abort = () => { controller.signal.removeEventListener('abort', abort); reject(unavailable()) }
      controller.signal.addEventListener('abort', abort, { once: true })
      Promise.resolve(pending).then(value => { controller.signal.removeEventListener('abort', abort); resolve(value) }, error => {
        controller.signal.removeEventListener('abort', abort); reject(error)
      })
      if (controller.signal.aborted) abort()
    })
    bound(result, TEST_PUBLICATION_ENVELOPE_BYTES)
    const envelope = contextualTestPublicationRpcEnvelopeSchema.safeParse(result)
    if (!envelope.success) throw unavailable()
    const { data, error, status } = envelope.data
    if (error) {
      if (data !== null) throw unavailable()
      if (error.code === 'PT400') throw new ApiError(400, 'Invalid test publication request')
      if (error.code === 'PT403') throw new ApiError(403, 'Forbidden')
      if (error.code === 'PT404') throw new ApiError(404, 'Test draft not found')
      if (['PT409', '55P03', '40P01', '40001'].includes(error.code)) throw changed()
      throw unavailable()
    }
    if (status !== undefined && (status < 200 || status >= 300)) throw unavailable()
    return data
  }
  try {
    bound(input.input, TEST_PUBLICATION_BODY_BYTES)
    const snapshotArgs = { p_actor_id: actorId, p_test_id: testId, p_deadline: deadlineIso }
    bound(snapshotArgs, TEST_PUBLICATION_BODY_BYTES)
    const snapshotRaw = await execute(() => input.supabase.rpc('snapshot_test_draft_for_owner_v1', snapshotArgs).abortSignal(controller.signal))
    if (typeof snapshotRaw !== 'object' || snapshotRaw === null || !('test' in snapshotRaw) || !('draft' in snapshotRaw)) throw unavailable()
    bound(snapshotRaw.test, TEST_PUBLICATION_ROW_BYTES)
    if (snapshotRaw.draft !== null) bound(snapshotRaw.draft, TEST_PUBLICATION_ROW_BYTES)
    if ('questions' in snapshotRaw && Array.isArray(snapshotRaw.questions)) {
      if (snapshotRaw.questions.length > TEST_DRAFT_GET_QUESTION_LIMIT) throw unavailable()
      for (const question of snapshotRaw.questions) bound(question, TEST_PUBLICATION_ROW_BYTES)
    }
    const parsed = contextualTestDraftGetSnapshotSchema.safeParse(snapshotRaw)
    if (!parsed.success) throw unavailable()
    const source = parsed.data; const { classroom, test, draft, questions } = source; const classroomId = classroom.id
    if (source.actor_id !== actorId || test.id !== testId || test.classroom_id !== classroomId) throw unavailable()
    if (classroom.teacher_id !== actorId || classroom.archived_at !== null || test.blueprint_archived_at !== null) throw new ApiError(403, 'Forbidden')
    if (test.questions_locked_at !== null) throw changed()
    if (!draft) throw new ApiError(404, 'Test draft not found')
    if (draft.assessment_type !== 'test' || draft.assessment_id !== testId || draft.classroom_id !== classroomId) throw unavailable()
    if (draft.version !== input.input.draft_version) throw changed()
    if (source.question_count !== questions.length || new Set(questions.map(q => q.id)).size !== questions.length
      || new Set(questions.map(getPortableTestQuestionIdentity)).size !== questions.length) throw unavailable()
    for (let index = 0; index < questions.length; index++) {
      const question = questions[index]; const previous = questions[index - 1]
      if (question.test_id !== testId || (previous && (previous.position > question.position || (previous.position === question.position && previous.id >= question.id)))) throw unavailable()
    }
    bound(draft.content, TEST_PUBLICATION_CONTENT_BYTES)
    if (typeof draft.content === 'object' && draft.content !== null && !Array.isArray(draft.content)
      && Array.isArray(draft.content.questions) && draft.content.questions.length > TEST_DRAFT_GET_QUESTION_LIMIT) throw unavailable()
    checkDeadline()
    const validated = validateTestDraftContent(draft.content, { requirePortableQuestionIdentity: true })
    checkDeadline()
    if (!validated.valid) throw new ApiError(400, validated.error)
    if (isGeneratedAssessmentTitle(validated.value.title)) throw new ApiError(400, 'Add a title before publishing this Test')
    const activation = canActivateTest(test, validated.value.questions.length)
    if (!activation.valid) throw new ApiError(400, activation.error ?? 'Unable to publish this Test')
    const projected = projectPortableTestQuestionIds(validated.value, questions, getTestDraftIdentityResolutionOptions(validated.value))
    checkDeadline()
    if (!projected.ok) throw changed()
    // Reject normalization changes rather than saving/repairing the source.
    if (!isDeepStrictEqual(draft.content, validated.value) || !isDeepStrictEqual(projected.content, validated.value)) {
      throw new ApiError(400, 'Save Test draft changes before publishing')
    }
    bound(validated.value, TEST_PUBLICATION_CONTENT_BYTES)
    const canonical = z.json().parse(validated.value)
    const publicationArgs = { p_actor_id: actorId, p_test_id: testId, p_classroom_id: classroomId,
      p_expected_authoring_sha256: source.source_sha256, p_expected_draft_version: input.input.draft_version,
      p_validated_content: canonical, p_deadline: deadlineIso }
    bound(publicationArgs, TEST_PUBLICATION_ENVELOPE_BYTES)
    const completedRaw = await execute(() => input.supabase.rpc('publish_test_from_draft_for_owner_v1', publicationArgs).abortSignal(controller.signal))
    if (typeof completedRaw !== 'object' || completedRaw === null || !('test' in completedRaw)) throw unavailable()
    bound(completedRaw.test, TEST_PUBLICATION_ROW_BYTES)
    const completed = contextualTestPublicationResultSchema.safeParse(completedRaw)
    if (!completed.success) throw unavailable()
    const witness = completed.data; const row = witness.test
    bound(row, TEST_PUBLICATION_ROW_BYTES)
    if (witness.actor_id !== actorId || witness.classroom_id !== classroomId || witness.test_id !== testId
      || witness.source_sha256 !== source.source_sha256 || witness.draft_version !== draft.version
      || row.id !== testId || row.classroom_id !== classroomId || row.status !== 'closed'
      || row.title !== validated.value.title || row.show_results !== validated.value.show_results
      || row.blueprint_archived_at !== null || row.questions_locked_at !== null) throw unavailable()
    const response = { test: { ...row, documents: normalizeTestDocuments(row.documents), assessment_type: 'test' as const } }
    bound(response, TEST_PUBLICATION_ROW_BYTES)
    return response
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw unavailable()
  } finally { clearTimeout(timer); input.signal?.removeEventListener('abort', callerAbort); controller.abort() }
}
