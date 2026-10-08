import type { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import type { getServiceRoleClient } from '@/lib/supabase'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { normalizeTestDocuments } from '@/lib/test-documents'
import { hasMeaningfulTestResponse } from '@/lib/test-responses'
import { getEffectiveStudentTestAccess } from '@/lib/server/tests'
import { validateTestDraftContent } from '@/lib/validations/assessment-drafts'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import {
  TEST_LIST_PAGE_SIZE, TEST_LIST_BATCH_SIZE, TEST_LIST_CHILD_PAGE_SIZE, TEST_LIST_COLLECTION_LIMIT, TEST_LIST_AGGREGATE_LIMIT,
  TEST_LIST_STATEMENT_LIMIT, TEST_LIST_DEADLINE_MS, TEST_LIST_DTO_BYTES, TEST_LIST_TOTAL_BYTES,
  contextualTestListIdentitySchema, contextualTestListClassroomSchema, contextualTestListRootSchema, contextualTestListEnvelopeSchema,
  contextualTestListTestSchema, contextualTestListQuestionSchema, contextualTestListAttemptSchema, contextualTestListResponseSchema,
  contextualTestListAvailabilitySchema, contextualTestListDraftSchema,
} from '@/lib/validations/contextual-test-list-read'
import type { AuthenticatedUser } from '@/types'
import type { Database } from '@/types/database.generated'

type Client = ReturnType<typeof getServiceRoleClient>
type Test = z.infer<typeof contextualTestListTestSchema>
type Root = z.infer<typeof contextualTestListRootSchema>
type ChildKind = 'questions' | 'attempts' | 'responses' | 'availability'
const unavailable = () => new ApiError(503, 'Unable to verify classroom tests')
const rootFields = 'id,teacher_id,archived_at'
const testFields = 'id,classroom_id,title,status,show_results,documents,position,points_possible,include_in_final,created_by,created_at,updated_at,artifact_id,source_artifact_id,source_blueprint_version_id,blueprint_archived_at,gradebook_category_id,gradebook_maximum_override,gradebook_score_scale,gradebook_weight,questions_locked_at'
const controlFields = 'id,classroom_id,status,updated_at'
const testRelation = 'tests:tests!tests_classroom_id_fkey'
const enrollmentRelation = 'enrollments:classroom_enrollments!classroom_enrollments_classroom_id_fkey(classroom_id,student_id)'
const draftRelation = 'drafts:assessment_drafts!assessment_drafts_classroom_id_fkey(id,assessment_id,assessment_type,classroom_id,version,content)'
function participantFields(table: 'test_attempts' | 'test_responses' | 'test_student_availability') {
  return `participant:users!${table}_student_id_fkey!inner(id,enrollment:classroom_enrollments!classroom_enrollments_student_id_fkey!inner(classroom_id,student_id))`
}

/** Present admission is authenticated and decoded before parameters or discovery. */
export async function authorizeSharedTestListReadActor(): Promise<{ mode: 'existing' } | { mode: 'shared'; user: AuthenticatedUser }> {
  if (!isClassroomExperienceAdmissionConfigured()) return { mode: 'existing' }
  const user = await requireAuth()
  return resolveClassroomExperienceAdmission(user).status === 'admitted' ? { mode: 'shared', user } : { mode: 'existing' }
}

/** Each statement proves current owner authority; the read does not promise a transaction snapshot. */
export async function readContextualTestList(input: { supabase: Client; actorId: string; classroomId: string }) {
  const identity = contextualTestListIdentitySchema.safeParse({ actorId: input.actorId, classroomId: input.classroomId })
  if (!identity.success) throw new ApiError(400, 'Invalid test list query')
  const { actorId, classroomId } = identity.data
  const controller = new AbortController(); const deadline = Date.now() + TEST_LIST_DEADLINE_MS
  const timer = setTimeout(() => controller.abort(), TEST_LIST_DEADLINE_MS)
  let statements = 0; let bytes = 0; let aggregate = 0
  function checkDeadline() { if (controller.signal.aborted || Date.now() >= deadline) throw unavailable() }
  function collect() { if (++aggregate > TEST_LIST_AGGREGATE_LIMIT) throw unavailable() }
  async function execute(query: PromiseLike<unknown>) {
    checkDeadline()
    if (++statements > TEST_LIST_STATEMENT_LIMIT) throw unavailable()
    const result = await new Promise<unknown>((resolve, reject) => {
      const abort = () => reject(unavailable())
      controller.signal.addEventListener('abort', abort, { once: true })
      Promise.resolve(query).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort))
    })
    checkDeadline()
    if (!boundedAssignmentListJson(result, TEST_LIST_DTO_BYTES)) throw unavailable()
    bytes += Buffer.byteLength(JSON.stringify(result), 'utf8')
    if (bytes > TEST_LIST_TOTAL_BYTES) throw unavailable()
    return result
  }
  try {
    const preflight = contextualTestListEnvelopeSchema(contextualTestListClassroomSchema).safeParse(await execute(input.supabase.from('classrooms')
      .select(rootFields).eq('id', classroomId).abortSignal(controller.signal).maybeSingle()))
    if (!preflight.success) throw unavailable()
    if (!preflight.data.data) throw new ApiError(404, 'Classroom not found')
    if (preflight.data.data.id !== classroomId) throw unavailable()
    if (preflight.data.data.teacher_id !== actorId) throw new ApiError(403, 'Forbidden')
    function queryFor(extra = '') {
      return input.supabase.from('classrooms').select(`${rootFields}${extra ? `,${extra}` : ''}`)
        .eq('id', classroomId).eq('teacher_id', actorId).abortSignal(controller.signal)
    }
    async function decode(query: PromiseLike<unknown>, selected: string[]): Promise<Root> {
      const result = contextualTestListEnvelopeSchema(contextualTestListRootSchema).safeParse(await execute(query))
      if (!result.success) throw unavailable()
      const row = result.data.data
      if (!row) throw new ApiError(403, 'Forbidden')
      if (row.id !== classroomId || row.teacher_id !== actorId || !sameKeys(row, ['id', 'teacher_id', 'archived_at', ...selected])) throw unavailable()
      return row
    }
    const tests: Test[] = []; const testSeen = new Set<string>(); let testCursor: string | undefined
    for (;;) {
      let query = queryFor(`${testRelation}(${testFields})`).eq('tests.classroom_id', classroomId)
      if (testCursor) query = query.gt('tests.id', testCursor)
      const root = await decode(query.order('id', { ascending: true, referencedTable: 'tests' }).limit(TEST_LIST_PAGE_SIZE, { referencedTable: 'tests' }).maybeSingle(), ['tests'])
      if (!root.tests) throw unavailable()
      if (!root.tests.length) break
      for (const raw of root.tests) {
        const parsed = contextualTestListTestSchema.safeParse(raw)
        if (!parsed.success) throw unavailable()
        const row = parsed.data
        if (row.classroom_id !== classroomId || testSeen.has(row.id) || (testCursor && row.id <= testCursor) || tests.length >= TEST_LIST_COLLECTION_LIMIT) throw unavailable()
        // Generated persisted contract and feature validator stay separate defenses.
        tests.push(row satisfies Database['public']['Tables']['tests']['Row']); testSeen.add(row.id); testCursor = row.id; collect()
      }
    }
    async function roster() {
      const seen = new Set<string>(); let cursor: string | undefined
      for (;;) {
        let query = queryFor(enrollmentRelation).neq('enrollments.student_id', actorId)
        if (cursor) query = query.gt('enrollments.student_id', cursor)
        const root = await decode(query.order('student_id', { ascending: true, referencedTable: 'enrollments' }).limit(TEST_LIST_PAGE_SIZE, { referencedTable: 'enrollments' }).maybeSingle(), ['enrollments'])
        if (!root.enrollments) throw unavailable()
        if (!root.enrollments.length) return seen
        for (const row of root.enrollments) {
          if (row.classroom_id !== classroomId || row.student_id === actorId || seen.has(row.student_id) || (cursor && row.student_id <= cursor) || seen.size >= TEST_LIST_COLLECTION_LIMIT) throw unavailable()
          seen.add(row.student_id); cursor = row.student_id; collect()
        }
      }
    }
    const students = await roster()
    function batchQuery(batch: Test[], extra = '', sibling = '') {
      return queryFor(`${testRelation}!inner(${controlFields}${extra ? `,${extra}` : ''})${sibling ? `,${sibling}` : ''}`)
        .eq('tests.classroom_id', classroomId)
        .in('tests.id', batch.map(t => t.id))
        .or(batch.map(t => `and(id.eq.${t.id},status.eq.${t.status},updated_at.eq.${t.updated_at})`).join(','), { referencedTable: 'tests' })
        .order('id', { ascending: true, referencedTable: 'tests' }).limit(TEST_LIST_BATCH_SIZE, { referencedTable: 'tests' })
    }
    function checkParents(root: Root, batch: Test[], kind?: ChildKind) {
      if (!root.tests || root.tests.length !== batch.length) throw unavailable()
      const expected = new Map(batch.map(t => [t.id, t])); const seen = new Set<string>()
      for (const parent of root.tests) {
        const original = expected.get(parent.id)
        if (!original || seen.has(parent.id) || parent.classroom_id !== classroomId || parent.status !== original.status || parent.updated_at !== original.updated_at
          || !sameKeys(parent, ['id', 'classroom_id', 'status', 'updated_at', ...(kind ? [kind] : [])])) throw unavailable()
        seen.add(parent.id)
      }
      return root.tests
    }
    async function collection<T extends z.ZodType<{ id: string; test_id: string }>>(batch: Test[], kind: ChildKind, fields: string, schema: T, table: 'test_questions' | 'test_attempts' | 'test_responses' | 'test_student_availability') {
      const output = new Map<string, z.output<T>[]>(batch.map(t => [t.id, []])); const seen = new Set<string>(); let cursor: string | undefined
      const reference = `tests.${kind}`
      for (;;) {
        let query = batchQuery(batch, `${kind}:${table}!${table}_test_id_fkey(${fields})`)
        if (cursor) query = query.gt(`${reference}.id`, cursor)
        if (kind !== 'questions') query = query.neq(`${reference}.student_id`, actorId).eq(`${reference}.participant.enrollment.classroom_id`, classroomId)
        const root = await decode(query.order('id', { ascending: true, referencedTable: reference }).limit(TEST_LIST_CHILD_PAGE_SIZE, { referencedTable: reference }).maybeSingle(), ['tests'])
        const parents = checkParents(root, batch, kind); const candidates: z.output<T>[] = []; const tails: string[] = []; const statementSeen = new Set<string>()
        for (const rawParent of parents) {
          // Full row alternatives cannot pass checkParents' exact control projection.
          if (!('questions' in rawParent || 'attempts' in rawParent || 'responses' in rawParent || 'availability' in rawParent)) throw unavailable()
          const children = rawParent[kind]
          if (!children) throw unavailable()
          let last = cursor
          for (const raw of children) {
            const parsed = schema.safeParse(raw)
            if (!parsed.success) throw unavailable()
            const child = parsed.data
            if (child.test_id !== rawParent.id || statementSeen.has(child.id) || (last && child.id <= last)) throw unavailable()
            if ('student_id' in child) {
              if (typeof child.student_id !== 'string' || child.student_id === actorId || !students.has(child.student_id) || !('participant' in child)) throw unavailable()
              const validated = contextualTestListAttemptSchema.pick({ id: true, test_id: true, student_id: true, participant: true }).safeParse({ id: child.id, test_id: child.test_id, student_id: child.student_id, participant: child.participant })
              if (!validated.success || validated.data.participant.id !== child.student_id || validated.data.participant.enrollment.some(e => e.classroom_id !== classroomId || e.student_id !== child.student_id)) throw unavailable()
            }
            statementSeen.add(child.id); last = child.id; candidates.push(child)
          }
          if (children.length && last) tails.push(last)
        }
        if (!tails.length) return output
        // Advancing by the smallest nonempty tail avoids skipping siblings on uneven pages.
        const next = tails.sort()[0]
        if (cursor && next <= cursor) throw unavailable()
        for (const child of candidates) {
          if (child.id > next) continue
          const rows = output.get(child.test_id)
          if (!rows || seen.has(child.id) || rows.length >= TEST_LIST_COLLECTION_LIMIT) throw unavailable()
          seen.add(child.id); rows.push(child); collect()
        }
        cursor = next
      }
    }
    async function drafts(batch: Test[]) {
      const output = new Map<string, z.infer<typeof contextualTestListDraftSchema>>(); const seen = new Set<string>(); let cursor: string | undefined
      for (;;) {
        let query = batchQuery(batch, '', draftRelation).eq('drafts.assessment_type', 'test').eq('drafts.classroom_id', classroomId).in('drafts.assessment_id', batch.map(t => t.id))
        if (cursor) query = query.gt('drafts.id', cursor)
        const root = await decode(query.order('id', { ascending: true, referencedTable: 'drafts' }).limit(TEST_LIST_PAGE_SIZE, { referencedTable: 'drafts' }).maybeSingle(), ['tests', 'drafts'])
        checkParents(root, batch)
        if (!root.drafts) throw unavailable()
        if (!root.drafts.length) return output
        for (const draft of root.drafts) {
          if (draft.classroom_id !== classroomId || !batch.some(t => t.id === draft.assessment_id) || output.has(draft.assessment_id) || seen.has(draft.id) || (cursor && draft.id <= cursor)) throw unavailable()
          output.set(draft.assessment_id, draft); seen.add(draft.id); cursor = draft.id; collect()
        }
      }
    }
    const result = []
    for (let index = 0; index < tests.length; index += TEST_LIST_BATCH_SIZE) {
      const batch = tests.slice(index, index + TEST_LIST_BATCH_SIZE)
      const questions = await collection(batch, 'questions', 'id,test_id', contextualTestListQuestionSchema, 'test_questions')
      const attempts = await collection(batch, 'attempts', `id,test_id,student_id,is_submitted,${participantFields('test_attempts')}`, contextualTestListAttemptSchema, 'test_attempts')
      const responses = await collection(batch, 'responses', `id,test_id,student_id,selected_option,response_text,${participantFields('test_responses')}`, contextualTestListResponseSchema, 'test_responses')
      const availability = await collection(batch, 'availability', `id,test_id,student_id,state,${participantFields('test_student_availability')}`, contextualTestListAvailabilitySchema, 'test_student_availability')
      const overlays = await drafts(batch)
      for (const test of batch) {
        const responded = new Set<string>(); const submitted = new Set<string>(); const states = new Map<string, 'open' | 'closed'>()
        for (const attempt of attempts.get(test.id) ?? []) if (attempt.is_submitted) { submitted.add(attempt.student_id); responded.add(attempt.student_id) }
        for (const response of responses.get(test.id) ?? []) if (hasMeaningfulTestResponse(response)) responded.add(response.student_id)
        for (const row of availability.get(test.id) ?? []) {
          if (states.has(row.student_id)) throw unavailable()
          states.set(row.student_id, row.state)
        }
        let open = 0
        for (const studentId of students) if (getEffectiveStudentTestAccess({ testStatus: test.status, accessState: states.get(studentId) ?? null }).effective_access === 'open') open++
        const draft = overlays.get(test.id)
        const parsed = draft && test.status === 'draft' ? validateTestDraftContent(draft.content, { allowEmptyQuestionText: true }) : undefined
        const overlay = parsed?.valid ? parsed.value : undefined
        result.push({ ...test, title: overlay?.title ?? test.title, show_results: overlay?.show_results ?? test.show_results,
          assessment_type: 'test' as const, documents: normalizeTestDocuments(test.documents),
          stats: { total_students: students.size, responded: responded.size, submitted: submitted.size, open_access: open, closed_access: students.size - open, questions_count: overlay?.questions.length ?? questions.get(test.id)?.length ?? 0 } })
      }
    }
    const currentStudents = await roster()
    if (currentStudents.size !== students.size || [...currentStudents].some(id => !students.has(id))) throw unavailable()
    if (!tests.length) await decode(queryFor().maybeSingle(), [])
    for (let index = 0; index < tests.length; index += TEST_LIST_BATCH_SIZE) {
      const batch = tests.slice(index, index + TEST_LIST_BATCH_SIZE)
      checkParents(await decode(batchQuery(batch).maybeSingle(), ['tests']), batch)
    }
    result.sort((a, b) => b.position - a.position || Date.parse(b.created_at) - Date.parse(a.created_at) || a.id.localeCompare(b.id))
    const response = { tests: result }
    if (!boundedAssignmentListJson(response, TEST_LIST_DTO_BYTES)) throw unavailable()
    checkDeadline()
    return response
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw unavailable()
  } finally { clearTimeout(timer); controller.abort() }
}

function sameKeys(value: object, expected: string[]) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected.sort())
}
