import type { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import type { getServiceRoleClient } from '@/lib/supabase'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { normalizeClassroomFeatureVisibility } from '@/lib/classroom-feature-visibility'
import { calculateAssignmentStats, calculateStudentAssignmentStatus, isAssignmentVisibleToStudents, sanitizeDocForStudent } from '@/lib/assignments'
import { getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import { courseGuideReadJsonFingerprint } from '@/lib/validations/contextual-course-guide-read'
import {
  ASSIGNMENT_LIST_BATCH_SIZE, ASSIGNMENT_LIST_CHILD_PAGE_SIZE, ASSIGNMENT_LIST_COLLECTION_LIMIT, ASSIGNMENT_LIST_DEADLINE_MS,
  ASSIGNMENT_LIST_DTO_BYTES, ASSIGNMENT_LIST_PAGE_SIZE, ASSIGNMENT_LIST_STATEMENT_LIMIT,
  boundedAssignmentListJson, contextualAssignmentListIdentitySchema, contextualAssignmentListClassroomEnvelopeSchema,
  contextualAssignmentListPayloadEnvelopeSchema, contextualAssignmentListAssignmentSchema, contextualAssignmentListRequirementSchema,
  contextualAssignmentListStatsDocSchema, contextualAssignmentListMemberDocSchema, contextualAssignmentListReturnedGradeSchema,
  contextualAssignmentListReleasedFeedbackSchema,
} from '@/lib/validations/contextual-assignment-list-read'
import type { Assignment, AssignmentDoc, AuthenticatedUser } from '@/types'

type Client = ReturnType<typeof getServiceRoleClient>
type Payload = NonNullable<z.infer<typeof contextualAssignmentListPayloadEnvelopeSchema>['data']>
type ListAssignment = z.infer<typeof contextualAssignmentListAssignmentSchema>
const unavailable = () => new ApiError(503, 'Unable to verify classroom assignments')
const rootFields = 'id,teacher_id,archived_at,feature_visibility'
const membershipFields = 'membership:classroom_enrollments!classroom_enrollments_classroom_id_fkey!inner(classroom_id,student_id)'
const assignmentFields = 'id,classroom_id,title,description,due_at,position,created_by,created_at,updated_at,is_draft,released_at,instructions_markdown,rich_instructions,artifact_id,source_artifact_id,source_blueprint_version_id,blueprint_archived_at,points_possible,gradebook_category_id,gradebook_maximum_override,gradebook_score_scale,gradebook_weight,include_in_final,track_authenticity'
const requirementFields = 'id,assignment_id,artifact_id,type,label,instructions,required,position,created_at,updated_at,source_artifact_id,source_blueprint_version_id,validation_policy_json'
const statsFields = 'id,assignment_id,student_id,is_submitted,submitted_at,returned_at,teacher_cleared_at,participant:users!assignment_docs_student_id_fkey!inner(id,enrollment:classroom_enrollments!classroom_enrollments_student_id_fkey!inner(classroom_id,student_id))'
const memberFields = 'id,assignment_id,student_id,content,content_legacy,is_submitted,submitted_at,returned_at,feedback_returned_at,teacher_cleared_at,created_at,updated_at,viewed_at,github_username,repo_url,save_sequence,save_session_id'
const gradeFields = 'id,assignment_id,student_id,returned_at,score_completion,score_thinking,score_workflow,graded_at,graded_by'
const feedbackFields = 'id,assignment_id,student_id,returned_at,feedback_returned_at,feedback'

/** Present admission is authenticated and decoded before request parameters or discovery. */
export async function authorizeSharedAssignmentListReadActor(): Promise<{ mode: 'existing' } | { mode: 'shared'; user: AuthenticatedUser }> {
  if (!isClassroomExperienceAdmissionConfigured()) return { mode: 'existing' }
  const user = await requireAuth()
  return resolveClassroomExperienceAdmission(user).status === 'admitted' ? { mode: 'shared', user } : { mode: 'existing' }
}

/** Current statement authority, including terminal pages; this does not promise a transaction snapshot. */
export async function readContextualAssignmentList(input: {
  supabase: Client; actorId: string; classroomId: string; permission: 'owner' | 'member'; now?: Date
}) {
  const identity = contextualAssignmentListIdentitySchema.safeParse({ actorId: input.actorId, classroomId: input.classroomId })
  if (!identity.success) throw new ApiError(400, 'Invalid assignment list query')
  const { actorId, classroomId } = identity.data
  const member = input.permission === 'member'
  const capturedNow = new Date((input.now ?? new Date()).getTime())
  let releaseExclusive: string
  try { releaseExclusive = new Date(capturedNow.getTime() + 1).toISOString() } catch { throw unavailable() }
  const controller = new AbortController(); const deadline = Date.now() + ASSIGNMENT_LIST_DEADLINE_MS
  const timer = setTimeout(() => controller.abort(), ASSIGNMENT_LIST_DEADLINE_MS)
  let statements = 0
  const checkDeadline = () => { if (controller.signal.aborted || Date.now() >= deadline) throw unavailable() }
  async function execute(query: PromiseLike<unknown>): Promise<unknown> {
    checkDeadline()
    if (++statements > ASSIGNMENT_LIST_STATEMENT_LIMIT) throw unavailable()
    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        const abort = () => reject(unavailable())
        controller.signal.addEventListener('abort', abort, { once: true })
        Promise.resolve(query).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort))
      })
      checkDeadline()
      if (!boundedAssignmentListJson(result, ASSIGNMENT_LIST_DTO_BYTES)) throw unavailable()
      return result
    } catch { throw unavailable() }
  }
  try {
    const preflight = contextualAssignmentListClassroomEnvelopeSchema.safeParse(await execute(input.supabase.from('classrooms')
      .select('id,teacher_id,archived_at').eq('id', classroomId).abortSignal(controller.signal).maybeSingle()))
    if (!preflight.success) throw unavailable()
    const classroom = preflight.data.data
    if (classroom === null) throw new ApiError(404, 'Classroom not found')
    if (classroom.id !== classroomId) throw unavailable()
    if (member ? classroom.teacher_id === actorId || classroom.archived_at !== null : classroom.teacher_id !== actorId) throw new ApiError(403, 'Forbidden')
    let featureFingerprint: string | undefined
    let featureSnapshot: Payload['feature_visibility']
    function queryFor(extra: string) {
      let query = input.supabase.from('classrooms').select(`${rootFields}${member ? `,${membershipFields}` : ''}${extra ? `,${extra}` : ''}`).eq('id', classroomId)
      query = member ? query.neq('teacher_id', actorId).is('archived_at', null).eq('membership.student_id', actorId).eq('membership.classroom_id', classroomId)
        : query.eq('teacher_id', actorId)
      if (member && featureFingerprint !== undefined) query = query.filter('feature_visibility', 'eq', JSON.stringify(featureSnapshot))
      return query.abortSignal(controller.signal)
    }
    async function decode(query: PromiseLike<unknown>, selected: string[]): Promise<Payload> {
      const result = contextualAssignmentListPayloadEnvelopeSchema.safeParse(await execute(query))
      if (!result.success) throw unavailable()
      const row = result.data.data
      if (row === null) throw new ApiError(403, 'Forbidden')
      const expected = ['id', 'teacher_id', 'archived_at', 'feature_visibility', ...(member ? ['membership'] : []), ...selected].sort()
      if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(expected) || row.id !== classroomId
        || (member ? row.teacher_id === actorId || row.archived_at !== null || row.membership?.length !== 1
          || row.membership.some(m => m.classroom_id !== classroomId || m.student_id !== actorId) : row.teacher_id !== actorId)) throw unavailable()
      if (member && !normalizeClassroomFeatureVisibility(row.feature_visibility).classwork) throw new ApiError(403, 'Classwork is not available')
      if (member && featureFingerprint !== undefined && courseGuideReadJsonFingerprint(row.feature_visibility) !== featureFingerprint) throw unavailable()
      return row
    }
    const control = await decode(queryFor('').maybeSingle(), [])
    featureSnapshot = control.feature_visibility; featureFingerprint = courseGuideReadJsonFingerprint(featureSnapshot)
    function published<Q extends ReturnType<typeof queryFor>>(query: Q): Q {
      return (member ? query.eq('assignments.is_draft', false).or(`released_at.is.null,released_at.lt.${releaseExclusive}`, { referencedTable: 'assignments' }) : query) as Q
    }
    const assignments: ListAssignment[] = []; const assignmentSeen = new Set<string>(); let assignmentCursor: string | undefined
    for (;;) {
      let query = published(queryFor(`assignments:assignments!assignments_classroom_id_fkey(${assignmentFields})`))
      if (assignmentCursor) query = query.gt('assignments.id', assignmentCursor)
      const root = await decode(query.order('id', { ascending: true, referencedTable: 'assignments' }).limit(ASSIGNMENT_LIST_PAGE_SIZE, { referencedTable: 'assignments' }).maybeSingle(), ['assignments'])
      if (!root.assignments) throw unavailable()
      if (root.assignments.length === 0) break
      for (const raw of root.assignments) {
        const parsed = contextualAssignmentListAssignmentSchema.safeParse(raw)
        if (!parsed.success) throw unavailable()
        const row = parsed.data
        if (row.classroom_id !== classroomId || assignmentSeen.has(row.id) || (assignmentCursor && row.id <= assignmentCursor)
          || assignments.length >= ASSIGNMENT_LIST_COLLECTION_LIMIT || (member && !isAssignmentVisibleToStudents(row, capturedNow))) throw unavailable()
        assignments.push(row); assignmentSeen.add(row.id); assignmentCursor = row.id
      }
    }
    let totalStudents = 0
    if (!member) {
      const seen = new Set<string>(); let cursor: string | undefined
      for (;;) {
        let query = queryFor('enrollments:classroom_enrollments!classroom_enrollments_classroom_id_fkey(classroom_id,student_id)').neq('enrollments.student_id', actorId)
        if (cursor) query = query.gt('enrollments.student_id', cursor)
        const root = await decode(query.order('student_id', { ascending: true, referencedTable: 'enrollments' }).limit(ASSIGNMENT_LIST_PAGE_SIZE, { referencedTable: 'enrollments' }).maybeSingle(), ['enrollments'])
        if (!root.enrollments) throw unavailable()
        if (root.enrollments.length === 0) break
        for (const row of root.enrollments) {
          if (row.classroom_id !== classroomId || row.student_id === actorId || seen.has(row.student_id) || (cursor && row.student_id <= cursor)
            || totalStudents >= ASSIGNMENT_LIST_COLLECTION_LIMIT) throw unavailable()
          seen.add(row.student_id); cursor = row.student_id; totalStudents++
        }
      }
    }
    const batches = Array.from({ length: Math.ceil(assignments.length / ASSIGNMENT_LIST_BATCH_SIZE) }, (_, n) => assignments.slice(n * ASSIGNMENT_LIST_BATCH_SIZE, (n + 1) * ASSIGNMENT_LIST_BATCH_SIZE))
    async function collection<T extends z.ZodType<{ id: string; assignment_id: string }>>(
      batch: ListAssignment[], kind: 'docs' | 'requirements', fields: string, schema: T, projection: 'stats' | 'member' | 'grades' | 'feedback' | 'requirements',
    ): Promise<Map<string, z.infer<T>[]>> {
      const output = new Map(batch.map(a => [a.id, [] as z.infer<T>[]])); const ids = batch.map(a => a.id)
      const studentBindings = new Map(batch.map(a => [a.id, new Set<string>()]))
      const seen = new Set<string>(); let cursor: string | undefined
      for (;;) {
        let query = published(queryFor(`assignments:assignments!assignments_classroom_id_fkey!inner(id,classroom_id,is_draft,released_at,${kind}:${kind === 'docs' ? 'assignment_docs!assignment_docs_assignment_id_fkey' : 'assignment_submission_requirements!assignment_submission_requirements_assignment_id_fkey'}(${fields}))`))
          .in('assignments.id', ids).order('id', { ascending: true, referencedTable: 'assignments' }).limit(ASSIGNMENT_LIST_BATCH_SIZE, { referencedTable: 'assignments' })
        const reference = `assignments.${kind}`
        if (cursor) query = query.gt(`${reference}.id`, cursor)
        if (kind === 'docs') {
          if (member) query = query.eq('assignments.docs.student_id', actorId)
          else query = query.neq('assignments.docs.student_id', actorId).eq('assignments.docs.participant.enrollment.classroom_id', classroomId)
          if (projection === 'grades') query = query.not('assignments.docs.returned_at', 'is', null)
          if (projection === 'feedback') query = query.or('returned_at.not.is.null,feedback_returned_at.not.is.null', { referencedTable: 'assignments.docs' })
        }
        const root = await decode(query.order('id', { ascending: true, referencedTable: reference }).limit(ASSIGNMENT_LIST_CHILD_PAGE_SIZE, { referencedTable: reference }).maybeSingle(), ['assignments'])
        if (!root.assignments || root.assignments.length !== batch.length) throw unavailable()
        const parents = new Set<string>(); const candidates: z.infer<T>[] = []; const tails: string[] = []; const statementIds = new Set<string>()
        for (const parent of root.assignments) {
          if (!output.has(parent.id) || parents.has(parent.id) || parent.classroom_id !== classroomId || (member && !isAssignmentVisibleToStudents(parent, capturedNow))) throw unavailable()
          parents.add(parent.id)
          const children = kind === 'docs' ? ('docs' in parent ? parent.docs : undefined) : ('requirements' in parent ? parent.requirements : undefined)
          if (!children || children.length > ASSIGNMENT_LIST_CHILD_PAGE_SIZE) throw unavailable()
          let last = cursor
          for (const raw of children) {
            const parsed = schema.safeParse(raw)
            if (!parsed.success) throw unavailable()
            const child = parsed.data as z.infer<T>
            if (child.assignment_id !== parent.id || statementIds.has(child.id) || (last && child.id <= last)) throw unavailable()
            if ('student_id' in child) {
              if (member ? child.student_id !== actorId : child.student_id === actorId) throw unavailable()
              if (projection === 'stats') {
                const stat = contextualAssignmentListStatsDocSchema.parse(child)
                if (stat.participant.id !== stat.student_id || stat.participant.enrollment.some(e => e.classroom_id !== classroomId || e.student_id !== stat.student_id)) throw unavailable()
              }
            }
            if (projection === 'feedback') {
              const feedback = contextualAssignmentListReleasedFeedbackSchema.parse(child)
              if (!feedback.returned_at && !feedback.feedback_returned_at) throw unavailable()
            }
            statementIds.add(child.id); last = child.id; candidates.push(child)
          }
          if (children.length) tails.push(last!)
        }
        if (!tails.length) return output
        // All parents share a keyset cursor. Advance only as far as the smallest
        // nonempty tail, so a fuller sibling page cannot skip an unseen child.
        const next = tails.sort()[0]
        if (cursor && next <= cursor) throw unavailable()
        for (const child of candidates) {
          if (child.id > next) continue
          const rows = output.get(child.assignment_id)!
          if (seen.has(child.id) || rows.length >= ASSIGNMENT_LIST_COLLECTION_LIMIT) throw unavailable()
          if ('student_id' in child) {
            const students = studentBindings.get(child.assignment_id)!
            if (typeof child.student_id !== 'string' || students.has(child.student_id)) throw unavailable()
            students.add(child.student_id)
          }
          seen.add(child.id); rows.push(child)
        }
        cursor = next
      }
    }
    const result: Array<Record<string, unknown>> = []
    for (const batch of batches) {
      if (!member) {
        const stats = await collection(batch, 'docs', statsFields, contextualAssignmentListStatsDocSchema, 'stats')
        const requirements = await collection(batch, 'requirements', requirementFields, contextualAssignmentListRequirementSchema, 'requirements')
        for (const a of batch) result.push({ ...a, instructions_markdown: getAssignmentInstructionsMarkdown(a).markdown,
          submission_requirements: requirements.get(a.id)!.sort((x, y) => x.position - y.position || Date.parse(x.created_at) - Date.parse(y.created_at) || x.id.localeCompare(y.id)),
          stats: calculateAssignmentStats(a.due_at, stats.get(a.id)!, totalStudents) })
      } else {
        const docs = await collection(batch, 'docs', memberFields, contextualAssignmentListMemberDocSchema, 'member')
        const returned = batch.filter(a => docs.get(a.id)!.some(d => d.returned_at !== null))
        const feedbackEligible = batch.filter(a => docs.get(a.id)!.some(d => d.returned_at !== null || d.feedback_returned_at !== null))
        const grades = returned.length ? await collection(returned, 'docs', gradeFields, contextualAssignmentListReturnedGradeSchema, 'grades') : new Map()
        const feedback = feedbackEligible.length ? await collection(feedbackEligible, 'docs', feedbackFields, contextualAssignmentListReleasedFeedbackSchema, 'feedback') : new Map()
        for (const a of batch) {
          const rows = docs.get(a.id)!
          if (rows.length > 1) throw unavailable()
          const base = rows[0]
          let doc: AssignmentDoc | null = null
          if (base) {
            const gradeRows = grades.get(a.id) ?? []; const feedbackRows = feedback.get(a.id) ?? []
            if (gradeRows.length !== (base.returned_at ? 1 : 0) || feedbackRows.length !== (base.returned_at || base.feedback_returned_at ? 1 : 0)) throw unavailable()
            const grade = gradeRows[0]; const release = feedbackRows[0]
            if ((grade && (grade.id !== base.id || grade.returned_at !== base.returned_at))
              || (release && (release.id !== base.id || release.returned_at !== base.returned_at || release.feedback_returned_at !== base.feedback_returned_at))) throw unavailable()
            doc = sanitizeDocForStudent({ ...base, score_completion: null, score_thinking: null, score_workflow: null, graded_at: null, graded_by: null,
              authenticity_score: null, authenticity_flags: null, feedback: null, ...(grade ?? {}), ...(release ?? {}) }) as AssignmentDoc
          }
          result.push({ ...a, status: calculateStudentAssignmentStatus(a as Assignment, doc), doc })
        }
      }
    }
    await decode(queryFor('').maybeSingle(), [])
    result.sort((a, b) => member ? Date.parse(String(a.due_at)) - Date.parse(String(b.due_at)) || String(a.id).localeCompare(String(b.id))
      : Number(a.position) - Number(b.position) || Date.parse(String(a.due_at)) - Date.parse(String(b.due_at)) || String(a.id).localeCompare(String(b.id)))
    if (!boundedAssignmentListJson({ assignments: result }, ASSIGNMENT_LIST_DTO_BYTES)) throw unavailable()
    checkDeadline()
    return { assignments: result }
  } catch (error) { if (error instanceof ApiError) throw error; throw unavailable() }
  finally { clearTimeout(timer) }
}
