import type { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import type { getServiceRoleClient } from '@/lib/supabase'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { normalizeClassroomFeatureVisibility } from '@/lib/classroom-feature-visibility'
import { courseGuideReadJsonFingerprint } from '@/lib/validations/contextual-course-guide-read'
import { normalizeTestDocuments } from '@/lib/test-documents'
import { hasMeaningfulTestResponse } from '@/lib/test-responses'
import { getStudentTestStatus } from '@/lib/tests'
import { getEffectiveStudentTestAccess } from '@/lib/server/tests'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import { TEST_LIST_PAGE_SIZE, TEST_LIST_BATCH_SIZE, TEST_LIST_CHILD_PAGE_SIZE, TEST_LIST_COLLECTION_LIMIT, TEST_LIST_AGGREGATE_LIMIT,
  TEST_LIST_STATEMENT_LIMIT, TEST_LIST_DEADLINE_MS, TEST_LIST_DTO_BYTES, TEST_LIST_TOTAL_BYTES,
  contextualTestListClassroomSchema, contextualTestListEnvelopeSchema } from '@/lib/validations/contextual-test-list-read'
import { contextualStudentTestListIdentitySchema, contextualStudentTestListTestSchema, contextualStudentTestListEnvelopeSchema,
  contextualStudentTestListAttemptSchema, contextualStudentTestListResponseSchema, contextualStudentTestListAvailabilitySchema,
  contextualStudentTestListParentSchema } from '@/lib/validations/contextual-student-test-list-read'
import type { AuthenticatedUser } from '@/types'

type Client = ReturnType<typeof getServiceRoleClient>
type Test = z.infer<typeof contextualStudentTestListTestSchema>
type Root = NonNullable<z.infer<typeof contextualStudentTestListEnvelopeSchema>['data']>
type Kind = 'attempts' | 'responses' | 'availability'
const rootFields = 'id,teacher_id,archived_at,feature_visibility,membership:classroom_enrollments!classroom_enrollments_classroom_id_fkey!inner(classroom_id,student_id)'
const testFields = 'id,classroom_id,title,status,show_results,documents,position,points_possible,include_in_final,gradebook_weight,created_by,created_at,updated_at'
const controlFields = 'id,classroom_id,status,updated_at'
const relation = 'tests:tests!tests_classroom_id_fkey'

/** Admission is authenticated and decoded before URL access or client construction. */
export async function authorizeSharedStudentTestListReadActor(): Promise<{ mode: 'existing' } | { mode: 'shared'; user: AuthenticatedUser }> {
  if (!isClassroomExperienceAdmissionConfigured()) return { mode: 'existing' }
  const user = await requireAuth()
  return resolveClassroomExperienceAdmission(user).status === 'admitted' ? { mode: 'shared', user } : { mode: 'existing' }
}

/** Every statement proves current membership; final revalidation is not a transaction snapshot. */
export async function readContextualStudentTestList(input: { supabase: Client; actorId: string; classroomId: string }) {
  const safeErrors = new Set<ApiError>()
  function safeApiError(status: number, message: string) { const error = new ApiError(status, message); safeErrors.add(error); return error }
  const unavailable = () => safeApiError(503, 'Unable to verify classroom tests')
  const identity = contextualStudentTestListIdentitySchema.safeParse({ actorId: input.actorId, classroomId: input.classroomId })
  if (!identity.success) throw safeApiError(400, 'Invalid test list query')
  const { actorId, classroomId } = identity.data
  const controller = new AbortController(); const deadline = Date.now() + TEST_LIST_DEADLINE_MS
  const timer = setTimeout(() => controller.abort(), TEST_LIST_DEADLINE_MS)
  let statements = 0; let bytes = 0; let aggregate = 0
  const checkDeadline = () => { if (controller.signal.aborted || Date.now() >= deadline) throw unavailable() }
  const collect = () => { if (++aggregate > TEST_LIST_AGGREGATE_LIMIT) throw unavailable() }
  async function execute(query: PromiseLike<unknown>) {
    checkDeadline()
    if (++statements > TEST_LIST_STATEMENT_LIMIT) throw unavailable()
    // SDK rejections are never allowed to supply a public status/message.
    try {
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
    } catch { throw unavailable() }
  }
  try {
    // One identity-only metadata preflight preserves 404/owner/archive semantics.
    // It carries no Test data and supplies no membership authority; every later
    // control or payload statement independently proves current member access.
    const preflight = contextualTestListEnvelopeSchema(contextualTestListClassroomSchema).safeParse(await execute(input.supabase.from('classrooms')
      .select('id,teacher_id,archived_at').eq('id', classroomId).abortSignal(controller.signal).maybeSingle()))
    if (!preflight.success) throw unavailable()
    const classroom = preflight.data.data
    if (!classroom) throw safeApiError(404, 'Classroom not found')
    if (classroom.id !== classroomId) throw unavailable()
    if (classroom.teacher_id === actorId || classroom.archived_at !== null) throw safeApiError(403, 'Forbidden')
    let featureFingerprint: string | undefined; let featureSnapshot: Root['feature_visibility']
    function queryFor(extra = '') {
      let query = input.supabase.from('classrooms').select(`${rootFields}${extra ? `,${extra}` : ''}`)
        .eq('id', classroomId).neq('teacher_id', actorId).eq('teacher_id', classroom!.teacher_id).is('archived_at', null)
        .eq('membership.classroom_id', classroomId).eq('membership.student_id', actorId)
      if (featureFingerprint !== undefined) query = query.filter('feature_visibility', 'eq', JSON.stringify(featureSnapshot))
      return query.abortSignal(controller.signal)
    }
    async function decode(query: PromiseLike<unknown>, selected: string[]): Promise<Root> {
      const parsed = contextualStudentTestListEnvelopeSchema.safeParse(await execute(query))
      if (!parsed.success) throw unavailable()
      const row = parsed.data.data
      if (!row) throw safeApiError(403, 'Forbidden')
      if (!sameKeys(row, ['id', 'teacher_id', 'archived_at', 'feature_visibility', 'membership', ...selected])
        || row.id !== classroomId || row.teacher_id !== classroom!.teacher_id || row.teacher_id === actorId || row.archived_at !== null
        || row.membership.some(m => m.classroom_id !== classroomId || m.student_id !== actorId)) throw unavailable()
      if (!normalizeClassroomFeatureVisibility(row.feature_visibility).tests) throw safeApiError(403, 'Tests are not available')
      if (featureFingerprint !== undefined && courseGuideReadJsonFingerprint(row.feature_visibility) !== featureFingerprint) throw unavailable()
      return row
    }
    const control = await decode(queryFor().maybeSingle(), [])
    featureSnapshot = control.feature_visibility; featureFingerprint = courseGuideReadJsonFingerprint(featureSnapshot)
    async function discover() {
      const tests: Test[] = []; const seen = new Set<string>(); let cursor: string | undefined
      for (;;) {
        let query = queryFor(`${relation}(${testFields})`).eq('tests.classroom_id', classroomId).in('tests.status', ['active', 'closed'])
        if (cursor) query = query.gt('tests.id', cursor)
        const root = await decode(query.order('id', { ascending: true, referencedTable: 'tests' }).limit(TEST_LIST_PAGE_SIZE, { referencedTable: 'tests' }).maybeSingle(), ['tests'])
        if (!root.tests) throw unavailable()
        if (!root.tests.length) return tests
        for (const raw of root.tests) {
          const parsed = contextualStudentTestListTestSchema.safeParse(raw)
          if (!parsed.success) throw unavailable()
          const row = parsed.data
          if (row.classroom_id !== classroomId || seen.has(row.id) || (cursor && row.id <= cursor) || tests.length >= TEST_LIST_COLLECTION_LIMIT) throw unavailable()
          tests.push(row); seen.add(row.id); cursor = row.id; collect()
        }
      }
    }
    const tests = await discover()
    function batchQuery(batch: Test[], extra = '') {
      return queryFor(`${relation}!inner(${controlFields}${extra ? `,${extra}` : ''})`)
        .eq('tests.classroom_id', classroomId).in('tests.status', ['active', 'closed']).in('tests.id', batch.map(t => t.id))
        .or(batch.map(t => `and(id.eq.${t.id},status.eq.${t.status},updated_at.eq.${t.updated_at})`).join(','), { referencedTable: 'tests' })
        .order('id', { ascending: true, referencedTable: 'tests' }).limit(TEST_LIST_BATCH_SIZE, { referencedTable: 'tests' })
    }
    function parents(root: Root, batch: Test[], kind?: Kind) {
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
    async function collection<T extends z.ZodType<{ id: string; test_id: string; student_id: string }>>(batch: Test[], kind: Kind, table: 'test_attempts' | 'test_responses' | 'test_student_availability', fields: string, schema: T) {
      const output = new Map<string, z.output<T>[]>(batch.map(t => [t.id, []])); const seen = new Set<string>(); let cursor: string | undefined
      const reference = `tests.${kind}`
      for (;;) {
        let query = batchQuery(batch, `${kind}:${table}!${table}_test_id_fkey(${fields})`).eq(`${reference}.student_id`, actorId)
        if (cursor) query = query.gt(`${reference}.id`, cursor)
        const root = await decode(query.order('id', { ascending: true, referencedTable: reference }).limit(TEST_LIST_CHILD_PAGE_SIZE, { referencedTable: reference }).maybeSingle(), ['tests'])
        const candidates: z.output<T>[] = []; const tails: string[] = []; const statementSeen = new Set<string>()
        for (const parent of parents(root, batch, kind)) {
          if (!(kind in parent)) throw unavailable()
          const children = (parent as z.infer<typeof contextualStudentTestListParentSchema>)[kind]
          if (!children) throw unavailable()
          let last = cursor
          for (const raw of children) {
            const parsed = schema.safeParse(raw)
            if (!parsed.success) throw unavailable()
            const child = parsed.data
            if (child.test_id !== parent.id || child.student_id !== actorId || statementSeen.has(child.id) || (last && child.id <= last)) throw unavailable()
            statementSeen.add(child.id); last = child.id; candidates.push(child)
          }
          if (children.length && last) tails.push(last)
        }
        if (!tails.length) return output
        // One cursor across siblings advances only to the smallest nonempty tail.
        const next = tails.sort()[0]
        if (cursor && next <= cursor) throw unavailable()
        for (const child of candidates) {
          if (child.id > next) continue
          const rows = output.get(child.test_id)
          if (!rows || seen.has(child.id) || rows.length >= TEST_LIST_COLLECTION_LIMIT || (kind !== 'responses' && rows.length > 0)) throw unavailable()
          seen.add(child.id); rows.push(child); collect()
        }
        cursor = next
      }
    }
    async function ownState(batch: Test[]) {
      return {
        attempts: await collection(batch, 'attempts', 'test_attempts', 'id,test_id,student_id,is_submitted,returned_at,closed_for_grading_at', contextualStudentTestListAttemptSchema),
        responses: await collection(batch, 'responses', 'test_responses', 'id,test_id,student_id,selected_option,response_text', contextualStudentTestListResponseSchema),
        availability: await collection(batch, 'availability', 'test_student_availability', 'id,test_id,student_id,state', contextualStudentTestListAvailabilitySchema),
      }
    }
    const result = []; const captured: Array<{ batch: Test[]; state: Awaited<ReturnType<typeof ownState>> }> = []
    for (let i = 0; i < tests.length; i += TEST_LIST_BATCH_SIZE) {
      const batch = tests.slice(i, i + TEST_LIST_BATCH_SIZE); const state = await ownState(batch); captured.push({ batch, state })
      for (const test of batch) {
        const attempt = state.attempts.get(test.id)![0]
        const responded = attempt?.is_submitted === true || state.responses.get(test.id)!.some(hasMeaningfulTestResponse)
        const returned = !!attempt?.returned_at; const locked = !!attempt?.closed_for_grading_at
        const access = getEffectiveStudentTestAccess({ testStatus: test.status, accessState: state.availability.get(test.id)![0]?.state ?? null,
          hasSubmitted: responded, returnedAt: returned ? 'returned' : null, isLockedForGrading: locked })
        const studentStatus = (responded || locked) && returned && access.effective_access === 'closed' ? 'can_view_results'
          : locked ? 'responded' : getStudentTestStatus(test, responded, returned)
        result.push({ ...test, assessment_type: 'test' as const,
          documents: access.can_start_or_continue || access.can_view_submitted ? normalizeTestDocuments(test.documents) : [],
          student_status: studentStatus, access_state: access.access_state, effective_access: access.effective_access })
      }
    }
    // Validate the complete Test collection and own state again, including absence
    // and terminal pages. This catches access/return revocation and insertions;
    // each statement is authorized, but changes after the final guard remain possible.
    if (JSON.stringify(await discover()) !== JSON.stringify(tests)) throw unavailable()
    for (const { batch, state } of captured) {
      const current = await ownState(batch)
      for (const kind of ['attempts', 'responses', 'availability'] as const) {
        if (JSON.stringify([...current[kind]]) !== JSON.stringify([...state[kind]])) throw unavailable()
      }
      parents(await decode(batchQuery(batch).maybeSingle(), ['tests']), batch)
    }
    await decode(queryFor().maybeSingle(), [])
    result.sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1) || b.position - a.position || Date.parse(b.created_at) - Date.parse(a.created_at) || a.id.localeCompare(b.id))
    const response = { tests: result }
    if (!boundedAssignmentListJson(response, TEST_LIST_DTO_BYTES)) throw unavailable()
    checkDeadline()
    return response
  } catch (error) {
    if (error instanceof ApiError && safeErrors.has(error)) throw error
    throw unavailable()
  } finally { clearTimeout(timer); controller.abort() }
}

function sameKeys(value: object, expected: string[]) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected.sort())
}
