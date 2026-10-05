import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import type { getServiceRoleClient } from '@/lib/supabase'
import { buildTestDraftContentFromRows } from '@/lib/server/assessment-drafts'
import { validateTestDraftContent } from '@/lib/validations/assessment-drafts'
import { getPortableTestQuestionIdentity, getTestDraftIdentityResolutionOptions, projectPortableTestQuestionIds } from '@/lib/test-question-identity'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import {
  TEST_DRAFT_GET_QUESTION_LIMIT, TEST_DRAFT_GET_CONTENT_BYTES, TEST_DRAFT_GET_ENVELOPE_BYTES, TEST_DRAFT_GET_TOTAL_BYTES, TEST_DRAFT_GET_DEADLINE_MS,
  contextualTestDraftGetIdentitySchema, contextualTestDraftGetSnapshotSchema, contextualTestDraftGetFinalSchema, contextualTestDraftGetRpcEnvelopeSchema,
} from '@/lib/validations/contextual-test-draft-get'
import type { TestDraftContent } from '@/types'

const unavailable = () => new ApiError(503, 'Unable to verify test draft')
const ambiguous = () => new ApiError(409, 'Test draft question identity is ambiguous')

/** Two bounded service-only transactions. SQL owns the opaque source digest and
 * the final current-owner, lifecycle and compare-and-swap checks. */
export async function getContextualTestDraft(input: { supabase: ReturnType<typeof getServiceRoleClient>; actorId: string; testId: string }) {
  const identity = contextualTestDraftGetIdentitySchema.safeParse({ actorId: input.actorId, testId: input.testId })
  if (!identity.success) throw new ApiError(400, 'Invalid test draft query')
  const { actorId, testId } = identity.data
  const controller = new AbortController()
  const deadline = Date.now() + TEST_DRAFT_GET_DEADLINE_MS
  const deadlineIso = new Date(deadline).toISOString()
  const timer = setTimeout(() => controller.abort(), TEST_DRAFT_GET_DEADLINE_MS)
  let statements = 0; let bytes = 0
  function checkDeadline() { if (controller.signal.aborted || Date.now() >= deadline) throw unavailable() }
  function bound(value: unknown, limit: number) {
    if (!boundedAssignmentListJson(value, limit)) throw unavailable()
    bytes += Buffer.byteLength(JSON.stringify(value), 'utf8')
    if (bytes > TEST_DRAFT_GET_TOTAL_BYTES) throw unavailable()
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
    checkDeadline(); bound(result, TEST_DRAFT_GET_ENVELOPE_BYTES)
    const envelope = contextualTestDraftGetRpcEnvelopeSchema.safeParse(result)
    if (!envelope.success) throw unavailable()
    const { data, error } = envelope.data
    if (error) {
      if (data !== null) throw unavailable()
      if (['42501', 'PT403'].includes(error.code)) throw new ApiError(403, 'Forbidden')
      if (error.code === 'PT404') throw new ApiError(final ? 409 : 404, final ? 'Test draft changed' : 'Test not found')
      if (['PT409', '23505', '55P03', '40P01', '40001'].includes(error.code)) throw new ApiError(409, 'Test draft changed')
      throw unavailable()
    }
    if (envelope.data.status !== undefined && (envelope.data.status < 200 || envelope.data.status >= 300)) throw unavailable()
    return data
  }
  try {
    const parsed = contextualTestDraftGetSnapshotSchema.safeParse(await execute(() => input.supabase.rpc('snapshot_test_draft_for_owner_v1', {
      p_actor_id: actorId, p_test_id: testId, p_deadline: deadlineIso,
    }).abortSignal(controller.signal)))
    if (!parsed.success) throw unavailable()
    const source = parsed.data
    const { classroom, test, draft, questions } = source
    const classroomId = classroom.id
    if (source.actor_id !== actorId || test.id !== testId || test.classroom_id !== classroomId) throw unavailable()
    if (classroom.teacher_id !== actorId || classroom.archived_at !== null) throw new ApiError(403, 'Forbidden')
    if (draft && (draft.assessment_id !== testId || draft.classroom_id !== classroomId || draft.assessment_type !== 'test')) throw unavailable()
    if (source.question_count !== questions.length || new Set(questions.map(q => q.id)).size !== questions.length) throw unavailable()
    for (let index = 0; index < questions.length; index++) {
      const question = questions[index]; const previous = questions[index - 1]
      if (question.test_id !== testId || (previous && (previous.position > question.position || (previous.position === question.position && previous.id >= question.id)))) throw unavailable()
    }
    // Invalid content remains repairable, but oversize raw content never enters
    // canonical validation or gets silently reduced by normalization.
    if (draft && typeof draft.content === 'object' && draft.content !== null && !Array.isArray(draft.content)
      && Array.isArray(draft.content.questions) && draft.content.questions.length > TEST_DRAFT_GET_QUESTION_LIMIT) throw unavailable()
    checkDeadline()
    let operation: 'inspect' | 'create' | 'repair'
    let candidate: TestDraftContent
    const valid = draft && test.status === 'draft' ? validateTestDraftContent(draft.content, { allowEmptyQuestionText: true }) : null
    checkDeadline()
    if (draft && valid?.valid) {
      const projected = projectPortableTestQuestionIds(valid.value, questions, getTestDraftIdentityResolutionOptions(valid.value))
      if (!projected.ok) throw ambiguous()
      candidate = projected.content; operation = 'inspect'
    } else {
      operation = draft ? (test.status === 'draft' ? 'repair' : 'inspect') : 'create'
      if (operation !== 'inspect' && test.blueprint_archived_at !== null) throw new ApiError(403, 'Forbidden')
      if (new Set(questions.map(getPortableTestQuestionIdentity)).size !== questions.length) throw ambiguous()
      checkDeadline()
      const rebuilt = buildTestDraftContentFromRows(test, questions)
      checkDeadline(); bound(rebuilt, TEST_DRAFT_GET_CONTENT_BYTES)
      const validated = validateTestDraftContent(rebuilt, { allowEmptyQuestionText: true, requirePortableQuestionIdentity: true })
      if (!validated.valid) throw unavailable()
      candidate = validated.value
    }
    checkDeadline(); bound(candidate, TEST_DRAFT_GET_CONTENT_BYTES)
    if (candidate.questions.length > TEST_DRAFT_GET_QUESTION_LIMIT) throw unavailable()
    if (operation === 'repair' && draft!.version === Number.MAX_SAFE_INTEGER) throw unavailable()
    const candidateJson = z.json().parse(candidate)
    checkDeadline()
    const completed = contextualTestDraftGetFinalSchema.safeParse(await execute(() => input.supabase.rpc('finish_test_draft_get_for_owner_v1', {
      p_actor_id: actorId, p_test_id: testId, p_classroom_id: classroomId, p_expected_source_sha256: source.source_sha256,
      p_operation: operation, p_content: candidateJson, p_deadline: deadlineIso,
    }).abortSignal(controller.signal), true))
    if (!completed.success) throw unavailable()
    checkDeadline()
    const result = completed.data; const row = result.draft
    if (result.actor_id !== actorId || result.classroom_id !== classroomId || result.test_id !== testId || result.operation !== operation
      || row.classroom_id !== classroomId || row.assessment_id !== testId || row.assessment_type !== 'test'
      || result.editingPolicy.structureLocked !== (test.questions_locked_at !== null) || !isDeepStrictEqual(row.content, candidateJson)) throw unavailable()
    if (operation === 'create') {
      if (draft || row.version !== 1 || row.created_by !== actorId || row.updated_by !== actorId
        || row.created_at !== row.updated_at || Date.parse(row.created_at) > Date.parse(deadlineIso)) throw unavailable()
    } else {
      if (!draft || row.id !== draft.id || row.created_by !== draft.created_by || row.created_at !== draft.created_at) throw unavailable()
      if (operation === 'inspect') {
        if (row.version !== draft.version || row.updated_by !== draft.updated_by || row.updated_at !== draft.updated_at) throw unavailable()
      } else if (row.version !== draft.version + 1 || row.updated_by !== actorId || Date.parse(row.updated_at) < Date.parse(draft.updated_at)
        || Date.parse(row.updated_at) > Date.parse(deadlineIso)) throw unavailable()
    }
    const response = { draft: { ...row, content: candidate }, editingPolicy: result.editingPolicy }
    bound(response, TEST_DRAFT_GET_ENVELOPE_BYTES); checkDeadline()
    return response
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw unavailable()
  } finally { clearTimeout(timer); controller.abort() }
}
