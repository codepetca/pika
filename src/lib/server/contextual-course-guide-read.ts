import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { isAssignmentVisibleToStudents } from '@/lib/assignments'
import { normalizeClassroomFeatureVisibility } from '@/lib/classroom-feature-visibility'
import { normalizeActualCourseSiteConfig } from '@/lib/course-site-publishing'
import { toCourseGuideVisibility, type CourseGuideData } from '@/lib/course-guide'
import { isEmpty, parseContentField } from '@/lib/tiptap-content'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  COURSE_GUIDE_READ_PAGE_SIZE, COURSE_GUIDE_READ_COLLECTION_LIMIT, COURSE_GUIDE_READ_PAGE_LIMIT,
  COURSE_GUIDE_READ_DEADLINE_MS, COURSE_GUIDE_READ_DTO_BYTES,
  contextualCourseGuideReadIdentitySchema, contextualCourseGuideReadClassroomEnvelopeSchema,
  contextualCourseGuideReadEnrollmentEnvelopeSchema, contextualCourseGuideReadControlEnvelopeSchema,
  contextualCourseGuideReadPayloadEnvelopeSchema, contextualCourseGuideReadTiptapSchema,
  courseGuideReadJsonFingerprint,
} from '@/lib/validations/contextual-course-guide-read'
import type { AuthenticatedUser } from '@/types'

type Client = ReturnType<typeof getServiceRoleClient>
type Payload = NonNullable<z.infer<typeof contextualCourseGuideReadPayloadEnvelopeSchema>['data']>
const unavailable = () => new ApiError(503, 'Unable to verify classroom course guide')
const relationshipFields = 'id,teacher_id,archived_at'
const controlFields = `${relationshipFields},actual_site_config,feature_visibility`
const membershipFields = 'membership:classroom_enrollments!classroom_enrollments_classroom_id_fkey!inner(classroom_id,student_id)'
const assignmentFields = 'assignments:assignments!assignments_classroom_id_fkey(id,classroom_id,title,position,is_draft,released_at)'
const testFields = 'tests:tests!tests_classroom_id_fkey(id,classroom_id,title,position,status)'

export async function authorizeSharedCourseGuideReadActor(): Promise<{ mode: 'existing' } | { mode: 'shared'; user: AuthenticatedUser }> {
  if (!isClassroomExperienceAdmissionConfigured()) return { mode: 'existing' }
  const user = await requireAuth()
  if (resolveClassroomExperienceAdmission(user).status !== 'admitted') return { mode: 'existing' }
  return { mode: 'shared', user }
}

/** Each statement proves current authority and the exact visibility used to choose its projection. */
export async function readContextualCourseGuide(input: {
  supabase: Client; actorId: string; classroomId: string; now?: Date
}): Promise<CourseGuideData> {
  const identity = contextualCourseGuideReadIdentitySchema.safeParse({ actorId: input.actorId, classroomId: input.classroomId })
  if (!identity.success) throw new ApiError(400, 'Invalid course-guide query')
  const { actorId, classroomId } = identity.data
  // Trusted proof clock only; clone it so external mutation cannot expand publication eligibility.
  const capturedNow = new Date((input.now ?? new Date()).getTime())
  if (!Number.isFinite(capturedNow.getTime())) throw unavailable()
  let releaseExclusive: string
  try { releaseExclusive = new Date(capturedNow.getTime() + 1).toISOString() } catch { throw unavailable() }
  const controller = new AbortController()
  const deadline = Date.now() + COURSE_GUIDE_READ_DEADLINE_MS
  const timer = setTimeout(() => controller.abort(), COURSE_GUIDE_READ_DEADLINE_MS)
  const checkDeadline = () => { if (controller.signal.aborted || Date.now() >= deadline) throw unavailable() }
  async function execute(query: PromiseLike<unknown>): Promise<unknown> {
    checkDeadline()
    try {
      // The signal reaches every SDK query. Racing also bounds a transport ignoring cancellation.
      const result = await new Promise<unknown>((resolve, reject) => {
        const abort = () => reject(unavailable())
        controller.signal.addEventListener('abort', abort, { once: true })
        Promise.resolve(query).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort))
      })
      checkDeadline()
      return result
    } catch { throw unavailable() }
  }
  try {
    const preflight = contextualCourseGuideReadClassroomEnvelopeSchema.safeParse(await execute(input.supabase.from('classrooms')
      .select(relationshipFields).eq('id', classroomId).abortSignal(controller.signal).maybeSingle()))
    if (!preflight.success) throw unavailable()
    const classroom = preflight.data.data
    if (classroom === null) throw new ApiError(404, 'Classroom not found')
    if (classroom.id !== classroomId) throw unavailable()
    const owner = classroom.teacher_id === actorId
    if (!owner) {
      if (classroom.archived_at !== null) throw new ApiError(403, 'Forbidden')
      const enrollment = contextualCourseGuideReadEnrollmentEnvelopeSchema.safeParse(await execute(input.supabase.from('classroom_enrollments')
        .select('classroom_id,student_id').eq('classroom_id', classroomId).eq('student_id', actorId).abortSignal(controller.signal).maybeSingle()))
      if (!enrollment.success) throw unavailable()
      if (enrollment.data.data === null) throw new ApiError(403, 'Forbidden')
      if (enrollment.data.data.classroom_id !== classroomId || enrollment.data.data.student_id !== actorId) throw unavailable()
    }
    const baseKeys = ['id', 'teacher_id', 'archived_at', 'actual_site_config', 'feature_visibility', ...(!owner ? ['membership'] : [])]
    function queryFor(extra: string) {
      let query = input.supabase.from('classrooms').select(`${controlFields}${extra ? `,${extra}` : ''}${owner ? '' : `,${membershipFields}`}`).eq('id', classroomId)
      query = owner ? query.eq('teacher_id', actorId)
        : query.neq('teacher_id', actorId).is('archived_at', null).eq('membership.student_id', actorId).eq('membership.classroom_id', classroomId)
      return query.abortSignal(controller.signal)
    }
    function validateRelationship(row: Payload, selectedKeys: string[]) {
      const expected = [...baseKeys, ...selectedKeys].sort()
      if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(expected)
        || row.id !== classroomId || (owner ? row.teacher_id !== actorId
          : row.teacher_id === actorId || row.archived_at !== null || row.membership?.length !== 1
            || row.membership.some(member => member.classroom_id !== classroomId || member.student_id !== actorId))) throw unavailable()
    }
    const control = contextualCourseGuideReadControlEnvelopeSchema.safeParse(await execute(queryFor('').maybeSingle()))
    if (!control.success) throw unavailable()
    if (control.data.data === null) throw new ApiError(403, 'Forbidden')
    const snapshot = control.data.data
    validateRelationship(snapshot, [])
    if (!owner && !normalizeClassroomFeatureVisibility(snapshot.feature_visibility).syllabus) throw new ApiError(403, 'Course guide is not available')
    const visibility = toCourseGuideVisibility(normalizeActualCourseSiteConfig(snapshot.actual_site_config))
    const configFingerprint = courseGuideReadJsonFingerprint(snapshot.actual_site_config)
    const featureFingerprint = courseGuideReadJsonFingerprint(snapshot.feature_visibility)
    function guarded(extra: string) {
      // Composed database types describe normalized objects; raw JSONB equality uses the SDK's filter boundary.
      let query = queryFor(extra).filter('actual_site_config', 'eq', JSON.stringify(snapshot.actual_site_config))
      if (!owner) query = query.filter('feature_visibility', 'eq', JSON.stringify(snapshot.feature_visibility))
      return query
    }
    async function decode(query: PromiseLike<unknown>, selected: string[]): Promise<Payload> {
      const result = contextualCourseGuideReadPayloadEnvelopeSchema.safeParse(await execute(query))
      if (!result.success) throw unavailable()
      const row = result.data.data
      if (row === null) throw new ApiError(403, 'Forbidden')
      validateRelationship(row, selected)
      if (courseGuideReadJsonFingerprint(row.actual_site_config) !== configFingerprint
        || (!owner && courseGuideReadJsonFingerprint(row.feature_visibility) !== featureFingerprint)
        || JSON.stringify(toCourseGuideVisibility(normalizeActualCourseSiteConfig(row.actual_site_config))) !== JSON.stringify(visibility)) throw unavailable()
      return row
    }
    const headerFields = ['title', ...(visibility.overview ? ['course_overview_markdown'] : []), ...(visibility.resources ? ['resources:classroom_resources!classroom_materials_classroom_id_fkey(id,classroom_id,content)'] : [])]
    const headerKeys = ['title', ...(visibility.overview ? ['course_overview_markdown'] : []), ...(visibility.resources ? ['resources'] : [])]
    const header = await decode(guarded(headerFields.join(',')).maybeSingle(), headerKeys)
    if (header.title === undefined || (visibility.overview && header.course_overview_markdown === undefined)
      || (visibility.resources && header.resources === undefined)) throw unavailable()
    let resourcesContent: CourseGuideData['resourcesContent'] = null
    if (visibility.resources && header.resources !== null && header.resources !== undefined) {
      if (header.resources.classroom_id !== classroomId) throw unavailable()
      const content = parseContentField(header.resources.content)
      // Historical TEXT 'null' parses to null; the existing guide treats it as empty.
      if (content !== null) {
        const parsed = contextualCourseGuideReadTiptapSchema.safeParse(content)
        if (!parsed.success) throw unavailable()
        if (!isEmpty(parsed.data)) resourcesContent = parsed.data
      }
    }
    let pages = 0
    async function collection(kind: 'assignments' | 'tests'): Promise<Array<{ key: string; title: string }>> {
      const output: Array<{ key: string; title: string }> = []
      const seen = new Set<string>()
      let previous: { id: string; position: number } | undefined
      while (pages < COURSE_GUIDE_READ_PAGE_LIMIT) {
        pages++
        let query = guarded(kind === 'assignments' ? assignmentFields : testFields)
        const cursor = previous ? `position.gt.${previous.position},and(position.eq.${previous.position},id.gt.${previous.id})` : null
        if (kind === 'assignments') {
          const release = `released_at.is.null,released_at.lt.${releaseExclusive}`
          query = query.eq('assignments.is_draft', false).or(cursor ? `and(or(${release}),or(${cursor}))` : release, { referencedTable: kind })
        } else {
          query = query.neq('tests.status', 'draft')
          if (cursor) query = query.or(cursor, { referencedTable: kind })
        }
        const row = await decode(query.order('position', { ascending: true, referencedTable: kind })
          .order('id', { ascending: true, referencedTable: kind }).limit(COURSE_GUIDE_READ_PAGE_SIZE, { referencedTable: kind }).maybeSingle(), [kind])
        const children = kind === 'assignments' ? row.assignments : row.tests
        if (children === undefined) throw unavailable()
        if (children.length === 0) return output
        for (const child of children) {
          if (output.length >= COURSE_GUIDE_READ_COLLECTION_LIMIT || child.classroom_id !== classroomId || seen.has(child.id)
            || (previous && (child.position < previous.position || (child.position === previous.position && child.id <= previous.id)))
            || ('is_draft' in child && !isAssignmentVisibleToStudents(child, capturedNow))) throw unavailable()
          seen.add(child.id); previous = child
          output.push({ key: `${kind === 'assignments' ? 'assignment' : 'test'}:${output.length}`, title: child.title || `Untitled ${kind === 'assignments' ? 'assignment' : 'test'}` })
        }
      }
      throw unavailable()
    }
    const assignments = visibility.assignments ? await collection('assignments') : []
    const tests = visibility.tests ? await collection('tests') : []
    await decode(guarded('').maybeSingle(), [])
    const guide: CourseGuideData = { classroom: { title: header.title }, visibility,
      overviewMarkdown: visibility.overview ? header.course_overview_markdown ?? '' : '', resourcesContent, assignments, tests }
    if (Buffer.byteLength(JSON.stringify(guide), 'utf8') > COURSE_GUIDE_READ_DTO_BYTES) throw unavailable()
    checkDeadline()
    return guide
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw unavailable()
  } finally { clearTimeout(timer) }
}
