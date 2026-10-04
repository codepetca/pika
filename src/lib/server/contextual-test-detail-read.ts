import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import type { getServiceRoleClient } from '@/lib/supabase'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { isAllowedTestDocumentType, MAX_TEST_DOCUMENTS, validateTestDocumentsPayload } from '@/lib/test-documents'
import { validateTestDraftContent } from '@/lib/validations/assessment-drafts'
import { getPortableTestQuestionIdentity, getTestDraftIdentityResolutionOptions, projectPortableTestQuestionIds } from '@/lib/test-question-identity'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import {
  TEST_DETAIL_PAGE_SIZE, TEST_DETAIL_COLLECTION_LIMIT, TEST_DETAIL_STATEMENT_LIMIT, TEST_DETAIL_DEADLINE_MS, TEST_DETAIL_DTO_BYTES, TEST_DETAIL_TOTAL_BYTES,
  contextualTestDetailIdentitySchema, contextualTestDetailControlSchema, contextualTestDetailTestSchema, contextualTestDetailQuestionSchema,
  contextualTestDetailDraftSchema, contextualTestDetailReferenceSchema, contextualTestDetailEnvelopeSchema,
  contextualTestDetailStorageInfoSchema, contextualTestDetailPublicBucketSchema,
} from '@/lib/validations/contextual-test-detail-read'
import type { AuthenticatedUser, TestDocument } from '@/types'

type Client = ReturnType<typeof getServiceRoleClient>
type Test = z.infer<typeof contextualTestDetailTestSchema>
type Reference = z.infer<typeof contextualTestDetailReferenceSchema>
const unavailable = () => new ApiError(503, 'Unable to verify test detail')
const classroomFields = 'id,teacher_id,archived_at'
const classroomRelation = 'classrooms!tests_classroom_id_fkey!inner'
const controlFields = `id,classroom_id,${classroomRelation}(${classroomFields})`
const testFields = 'id,classroom_id,title,status,show_results,documents,position,points_possible,include_in_final,created_by,created_at,updated_at'
const payloadFields = `${testFields},${classroomRelation}(${classroomFields})`
const questionFields = 'id,test_id,artifact_id,source_artifact_id,question_type,question_text,options,correct_option,answer_key,sample_solution,points,response_max_chars,response_monospace,position,created_at,updated_at,ai_reference_cache_answers,ai_reference_cache_generated_at,ai_reference_cache_key,ai_reference_cache_model'
const draftRelation = 'drafts:assessment_drafts!assessment_drafts_classroom_id_fkey(id,assessment_id,assessment_type,classroom_id,version,content)'
const referenceRelation = 'refs:managed_storage_json_references!managed_storage_json_references_test_id_fkey(id,test_id,managed_object_id,storage_bucket,storage_path,reference_role,managed_object:managed_storage_objects!managed_storage_json_reference_identity_fkey(id,classroom_id,course_blueprint_id,provisional_owner_id,storage_bucket,storage_path,purpose,status,content_type))'

export async function authorizeSharedTestDetailReadActor(): Promise<{ mode: 'existing' } | { mode: 'shared'; user: AuthenticatedUser }> {
  if (!isClassroomExperienceAdmissionConfigured()) return { mode: 'existing' }
  const user = await requireAuth()
  return resolveClassroomExperienceAdmission(user).status === 'admitted' ? { mode: 'shared', user } : { mode: 'existing' }
}

/** Every data statement proves current Test/Classroom ownership. This is a
 * bounded, revalidated read, not an atomic database snapshot. */
export async function readContextualTestDetail(input: { supabase: Client; actorId: string; testId: string }) {
  const identity = contextualTestDetailIdentitySchema.safeParse({ actorId: input.actorId, testId: input.testId })
  if (!identity.success) throw new ApiError(400, 'Invalid test detail query')
  const { actorId, testId } = identity.data
  const controller = new AbortController(); const deadline = Date.now() + TEST_DETAIL_DEADLINE_MS
  const timer = setTimeout(() => controller.abort(), TEST_DETAIL_DEADLINE_MS)
  let statements = 0; let bytes = 0
  function checkDeadline() { if (controller.signal.aborted || Date.now() >= deadline) throw unavailable() }
  async function execute(query: PromiseLike<unknown> | (() => PromiseLike<unknown>)) {
    checkDeadline()
    if (++statements > TEST_DETAIL_STATEMENT_LIMIT) throw unavailable()
    const pending = typeof query === 'function' ? query() : query
    const result = await new Promise<unknown>((resolve, reject) => {
      const abort = () => reject(unavailable())
      controller.signal.addEventListener('abort', abort, { once: true })
      Promise.resolve(pending).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort))
    })
    checkDeadline()
    if (!boundedAssignmentListJson(result, TEST_DETAIL_DTO_BYTES)) throw unavailable()
    bytes += Buffer.byteLength(JSON.stringify(result), 'utf8')
    if (bytes > TEST_DETAIL_TOTAL_BYTES) throw unavailable()
    return result
  }
  try {
    const preflight = contextualTestDetailEnvelopeSchema(contextualTestDetailControlSchema).safeParse(await execute(input.supabase.from('tests')
      .select(controlFields).eq('id', testId).abortSignal(controller.signal).maybeSingle()))
    if (!preflight.success) throw unavailable()
    const control = preflight.data.data
    if (!control) throw new ApiError(404, 'Test not found')
    if (control.id !== testId || control.classrooms.id !== control.classroom_id) throw unavailable()
    if (control.classrooms.teacher_id !== actorId) throw new ApiError(403, 'Forbidden')
    const classroomId = control.classroom_id
    let frozen: Test | undefined
    function queryFor(select = payloadFields) {
      let query = input.supabase.from('tests').select(select).eq('id', testId).eq('classroom_id', classroomId)
        .eq('classrooms.id', classroomId).eq('classrooms.teacher_id', actorId).abortSignal(controller.signal)
      if (frozen) query = query.eq('status', frozen.status).eq('updated_at', frozen.updated_at)
      return query
    }
    async function decode<T extends z.ZodType<Test>>(query: PromiseLike<unknown>, schema: T): Promise<z.infer<T>> {
      const envelope = contextualTestDetailEnvelopeSchema(z.json()).safeParse(await execute(query))
      if (!envelope.success) throw unavailable()
      if (envelope.data.data === null) throw new ApiError(403, 'Forbidden')
      const decoded = schema.safeParse(envelope.data.data)
      if (!decoded.success) throw unavailable()
      const row = decoded.data
      // Pick only the already decoded control columns; outer schemas remain strict.
      const raw: Test = row
      const base = contextualTestDetailTestSchema.parse({ ...Object.fromEntries(Object.keys(contextualTestDetailTestSchema.shape).map(key => [key, (raw as unknown as Record<string, unknown>)[key]])),
        classrooms: { id: raw.classrooms.id, teacher_id: raw.classrooms.teacher_id, archived_at: raw.classrooms.archived_at } })
      if (base.id !== testId || base.classroom_id !== classroomId || base.classrooms.id !== classroomId || base.classrooms.teacher_id !== actorId
        || (frozen && !isDeepStrictEqual(base, frozen))) throw unavailable()
      return row
    }
    frozen = await decode(queryFor().maybeSingle(), contextualTestDetailTestSchema)
    const documentsResult = validateTestDocumentsPayload(frozen.documents)
    if (!documentsResult.valid) throw unavailable()
    const documents: TestDocument[] = documentsResult.documents.map(doc => {
      if (doc.source !== 'upload') return doc
      const { upload_content_type: _untrustedMime, ...clean } = doc
      return clean
    })
    if (new Set(documents.map(doc => doc.id)).size !== documents.length) throw unavailable()
    const uploads = documents.filter(doc => doc.source === 'upload')
    const paths = [...new Set(uploads.map(doc => doc.storage_path!))]
    for (const path of paths) if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0') || path.split('/').some(segment => !segment || segment === '.' || segment === '..')) throw unavailable()

    const questions: z.infer<typeof contextualTestDetailQuestionSchema>[] = []; const seen = new Set<string>(); let cursor: string | undefined
    const questionRootSchema = contextualTestDetailTestSchema.extend({ questions: z.array(contextualTestDetailQuestionSchema).max(TEST_DETAIL_PAGE_SIZE) }).strict()
    for (;;) {
      let query = queryFor(`${payloadFields},questions:test_questions!test_questions_test_id_fkey(${questionFields})`).eq('questions.test_id', testId)
      if (cursor) query = query.gt('questions.id', cursor)
      const root = await decode(query.order('id', { ascending: true, referencedTable: 'questions' }).limit(TEST_DETAIL_PAGE_SIZE, { referencedTable: 'questions' }).maybeSingle(), questionRootSchema)
      if (!root.questions.length) break
      for (const question of root.questions) {
        if (question.test_id !== testId || seen.has(question.id) || (cursor && question.id <= cursor) || questions.length >= TEST_DETAIL_COLLECTION_LIMIT) throw unavailable()
        seen.add(question.id); questions.push(question); cursor = question.id
      }
    }
    questions.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    const draftRootSchema = contextualTestDetailTestSchema.extend({ classrooms: contextualTestDetailClassroomWithDrafts() }).strict()
    function draftQuery(select: string) { return queryFor(select).eq('classrooms.drafts.assessment_type', 'test').eq('classrooms.drafts.assessment_id', testId)
      .eq('classrooms.drafts.classroom_id', classroomId).limit(2, { referencedTable: 'classrooms.drafts' }) }
    const draftRoot = await decode(draftQuery(`${testFields},${classroomRelation}(${classroomFields},${draftRelation})`).maybeSingle(), draftRootSchema)
    function checkDrafts(drafts: z.infer<typeof contextualTestDetailDraftSchema>[]) {
      if (drafts.length > 1 || drafts.some(d => d.classroom_id !== classroomId || d.assessment_id !== testId || d.assessment_type !== 'test')) throw unavailable()
    }
    checkDrafts(draftRoot.classrooms.drafts)
    const draft = draftRoot.classrooms.drafts[0]
    const refs: Reference[] = []; let refCursor: string | undefined; const seenRefs = new Set<string>()
    const refRootSchema = contextualTestDetailTestSchema.extend({ refs: z.array(contextualTestDetailReferenceSchema).max(TEST_DETAIL_PAGE_SIZE) }).strict()
    function referenceQuery(select: string) { return queryFor(select).eq('refs.test_id', testId).eq('refs.reference_role', 'teacher_document')
      .eq('refs.storage_bucket', 'test-documents').in('refs.storage_path', paths.length ? paths : ['']) }
    for (;;) {
      let query = referenceQuery(`${payloadFields},${referenceRelation}`)
      if (refCursor) query = query.gt('refs.id', refCursor)
      const root = await decode(query.order('id', { ascending: true, referencedTable: 'refs' }).limit(TEST_DETAIL_PAGE_SIZE, { referencedTable: 'refs' }).maybeSingle(), refRootSchema)
      if (!root.refs.length) break
      for (const ref of root.refs) {
        if (seenRefs.has(ref.id) || (refCursor && ref.id <= refCursor) || refs.length >= MAX_TEST_DOCUMENTS) throw unavailable()
        seenRefs.add(ref.id); refs.push(ref); refCursor = ref.id
      }
    }
    function referenceMap(rows: Reference[]) {
      const byPath = new Map<string, Reference>()
      for (const ref of rows) {
        const object = ref.managed_object
        if (ref.test_id !== testId || !paths.includes(ref.storage_path) || byPath.has(ref.storage_path)
          || object.id !== ref.managed_object_id || object.classroom_id !== classroomId || object.storage_path !== ref.storage_path
          || object.storage_bucket !== ref.storage_bucket) throw unavailable()
        // Classroom ownership plus the exact current Test JSON reference is the
        // authority. Legacy/copy/restore objects may retain another resource stamp.
        byPath.set(ref.storage_path, ref)
      }
      for (const doc of uploads) {
        const ref = byPath.get(doc.storage_path!)
        if (doc.managed_object_id && (!ref || ref.managed_object_id !== doc.managed_object_id)) throw unavailable()
      }
      return byPath
    }
    const refsByPath = referenceMap(refs)
    const finalSchema = draftRootSchema.extend({ refs: z.array(contextualTestDetailReferenceSchema).max(MAX_TEST_DOCUMENTS) }).strict()
    async function proveSnapshot() {
      const query = referenceQuery(`${testFields},${classroomRelation}(${classroomFields},${draftRelation}),${referenceRelation}`)
        .eq('classrooms.drafts.assessment_type', 'test').eq('classrooms.drafts.assessment_id', testId).eq('classrooms.drafts.classroom_id', classroomId)
        .limit(2, { referencedTable: 'classrooms.drafts' }).order('id', { ascending: true, referencedTable: 'refs' }).limit(MAX_TEST_DOCUMENTS + 1, { referencedTable: 'refs' })
      const root = await decode(query.maybeSingle(), finalSchema)
      checkDrafts(root.classrooms.drafts); referenceMap(root.refs)
      if (!isDeepStrictEqual(root.classrooms.drafts, draftRoot.classrooms.drafts) || !isDeepStrictEqual(root.refs, refs)) throw unavailable()
    }
    const unmanaged = uploads.some(doc => !refsByPath.has(doc.storage_path!))
    async function provePublicBucket() {
      if (!contextualTestDetailPublicBucketSchema.safeParse(await execute(() => input.supabase.storage.getBucket('test-documents'))).success) throw unavailable()
    }
    if (unmanaged) { await proveSnapshot(); await provePublicBucket() }
    for (const doc of uploads) {
      const registered = refsByPath.get(doc.storage_path!)?.managed_object.content_type?.trim().toLowerCase()
      if (registered) {
        if (isAllowedTestDocumentType(registered)) doc.upload_content_type = registered
        continue
      }
      // A metadata call starts only after a fresh, statement-bound proof of the
      // unchanged document path and (when managed) its exact ready object.
      await proveSnapshot()
      const stored = contextualTestDetailStorageInfoSchema.safeParse(await execute(() => input.supabase.storage.from('test-documents').info(doc.storage_path!)))
      if (!stored.success || stored.data.data.name !== doc.storage_path) throw unavailable()
      const info = stored.data.data
      const contentType = (info.contentType || (typeof info.metadata?.mimetype === 'string' ? info.metadata.mimetype : '')).trim().toLowerCase()
      if (isAllowedTestDocumentType(contentType)) doc.upload_content_type = contentType
    }
    if (unmanaged) await provePublicBucket()
    // Revalidate the frozen JSON, draft, and exact managed identities after any
    // metadata request, including a reference collection that was empty.
    await proveSnapshot()
    checkDeadline()

    let title = frozen.title; let showResults = frozen.show_results
    type ResponseQuestion = Omit<z.infer<typeof contextualTestDetailQuestionSchema>, 'artifact_id' | 'source_artifact_id' | 'ai_reference_cache_answers' | 'ai_reference_cache_generated_at' | 'ai_reference_cache_key' | 'ai_reference_cache_model'>
      & Partial<Pick<z.infer<typeof contextualTestDetailQuestionSchema>, 'ai_reference_cache_answers' | 'ai_reference_cache_generated_at' | 'ai_reference_cache_key' | 'ai_reference_cache_model'>>
    let responseQuestions: ResponseQuestion[] = questions.map(({ artifact_id: artifact, source_artifact_id: source, ...question }) => ({ ...question, id: getPortableTestQuestionIdentity({ ...question, artifact_id: artifact, source_artifact_id: source }) }))
    if (draft && frozen.status === 'draft') {
      const validated = validateTestDraftContent(draft.content, { allowEmptyQuestionText: true })
      if (validated.valid) {
        const projected = projectPortableTestQuestionIds(validated.value, questions, getTestDraftIdentityResolutionOptions(validated.value))
        if (!projected.ok) throw new ApiError(409, 'Test draft question identity is ambiguous')
        title = projected.content.title; showResults = projected.content.show_results
        const { created_at: createdAt, updated_at: updatedAt } = frozen
        responseQuestions = projected.content.questions.map((question, position) => ({ ...question, test_id: testId, position, created_at: createdAt, updated_at: updatedAt }))
      }
    }
    const { classrooms: classroom, ...responseTest } = frozen
    const response = { test: { ...responseTest, title, show_results: showResults, documents, assessment_type: 'test' as const }, questions: responseQuestions,
      draft_version: draft?.version ?? null, classroom }
    if (!boundedAssignmentListJson(response, TEST_DETAIL_DTO_BYTES)) throw unavailable()
    checkDeadline()
    return response
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw unavailable()
  } finally { clearTimeout(timer); controller.abort() }
}

function contextualTestDetailClassroomWithDrafts() {
  return contextualTestDetailControlSchema.shape.classrooms.extend({ drafts: z.array(contextualTestDetailDraftSchema).max(2) }).strict()
}
