import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import type { getServiceRoleClient } from '@/lib/supabase'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { normalizeClassroomFeatureVisibility } from '@/lib/classroom-feature-visibility'
import { getTodayInToronto } from '@/lib/timezone'
import { isAssignmentVisibleToStudents } from '@/lib/assignments'
import { hasMeaningfulTestResponse } from '@/lib/test-responses'
import { getEffectiveStudentTestAccess } from '@/lib/server/tests'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import { courseGuideReadJsonFingerprint } from '@/lib/validations/contextual-course-guide-read'
import { notificationUuidSchema as uuid, notificationTimestampSchema as timestamp } from '@/lib/validations/student-notifications'

const PAGE = 1000, CHILD_PAGE = 100, BATCH = 50, MAX_COLLECTION = 10000, MAX_ROWS = 100000, MAX_STATEMENTS = 1024, DEADLINE_MS = 20000
const rootFields = 'id,teacher_id,archived_at,feature_visibility,membership:classroom_enrollments!classroom_enrollments_classroom_id_fkey!inner(id,classroom_id,student_id)'
const classroomSchema = z.object({ id: uuid, teacher_id: uuid, archived_at: timestamp.nullable() }).strict()
const membershipSchema = z.object({ id: uuid, classroom_id: uuid, student_id: uuid }).strict()
const rootSchema = classroomSchema.extend({
  feature_visibility: z.record(z.string(), z.boolean()).nullable().refine(value => boundedAssignmentListJson(value, 4096)),
  membership: z.array(membershipSchema).length(1),
}).strict()
const parent = z.object({ id: uuid, classroom_id: uuid, updated_at: timestamp }).strict()
const assignmentSchema = parent.extend({ is_draft: z.boolean(), released_at: timestamp.nullable() }).strict()
const testSchema = parent.extend({ status: z.enum(['active', 'closed']) }).strict()
const announcementSchema = parent.extend({ is_draft: z.boolean(), scheduled_for: timestamp.nullable() }).strict()
const own = z.object({ id: uuid, student_id: uuid }).strict()
const docSchema = own.extend({ assignment_id: uuid, viewed_at: timestamp.nullable(), returned_at: timestamp.nullable(), feedback_returned_at: timestamp.nullable() }).strict()
const responseSchema = own.extend({ test_id: uuid, selected_option: z.number().int().nullable(), response_text: z.string().nullable() }).strict()
const attemptSchema = own.extend({ test_id: uuid, is_submitted: z.boolean(), closed_for_grading_at: timestamp.nullable() }).strict()
const availabilitySchema = own.extend({ test_id: uuid, state: z.enum(['open', 'closed']) }).strict()
const receiptSchema = z.object({ id: uuid, announcement_id: uuid, user_id: uuid }).strict()
const daySchema = z.object({ id: uuid, classroom_id: uuid, date: z.string(), is_class_day: z.boolean() }).strict()
const entrySchema = own.extend({ classroom_id: uuid, date: z.string() }).strict()
type Parent = z.infer<typeof parent>
type Client = ReturnType<typeof getServiceRoleClient>
type Root = z.infer<typeof rootSchema>
type Kind = 'assignments' | 'tests' | 'announcements'
const fields = {
  assignments: 'id,classroom_id,updated_at,is_draft,released_at',
  tests: 'id,classroom_id,updated_at,status',
  announcements: 'id,classroom_id,updated_at,is_draft,scheduled_for',
}
const schemas = { assignments: assignmentSchema, tests: testSchema, announcements: announcementSchema }

export async function authorizeSharedNotificationsActor() {
  if (!isClassroomExperienceAdmissionConfigured()) return { mode: 'existing' as const }
  const user = await requireAuth()
  return (await resolveClassroomExperienceAdmission(user)).status === 'admitted'
    ? { mode: 'shared' as const, user } : { mode: 'existing' as const }
}

/** Each page (including empty terminal pages) carries current relationship authority.
 * Revalidation catches observed drift; it does not create a transaction snapshot. */
export async function readContextualStudentNotifications(input: { supabase: Client; actorId: string; classroomId: string }) {
  const safeErrors = new Set<ApiError>()
  function apiError(status: number, message: string) {
    const error = new ApiError(status, message); safeErrors.add(error); return error
  }
  const unavailable = () => apiError(503, 'Unable to verify classroom notifications')
  const actorId = uuid.parse(input.actorId), classroomId = uuid.parse(input.classroomId)
  const now = new Date(), cutoff = now.toISOString(), today = getTodayInToronto()
  const controller = new AbortController(), deadline = Date.now() + DEADLINE_MS
  const timer = setTimeout(() => controller.abort(), DEADLINE_MS)
  let statements = 0, bytes = 0, rowCount = 0
  const check = () => { if (controller.signal.aborted || Date.now() >= deadline) throw unavailable() }
  async function execute(query: PromiseLike<unknown>) {
    check()
    if (++statements > MAX_STATEMENTS) throw unavailable()
    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        const abort = () => reject(unavailable())
        controller.signal.addEventListener('abort', abort, { once: true })
        Promise.resolve(query).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort))
      })
      check()
      if (!boundedAssignmentListJson(result, 8 * 1024 * 1024)) throw unavailable()
      bytes += Buffer.byteLength(JSON.stringify(result))
      if (bytes > 64 * 1024 * 1024) throw unavailable()
      return result
    } catch { throw unavailable() }
  }
  function envelope<T extends z.ZodType>(schema: T) {
    return z.object({ data: schema.nullable(), error: z.null(), count: z.number().int().nonnegative().nullable().optional(),
      status: z.number().int().min(200).max(299).optional(), statusText: z.string().optional() }).strict()
  }
  try {
    const preflight = envelope(classroomSchema).safeParse(await execute(input.supabase.from('classrooms')
      .select('id,teacher_id,archived_at').eq('id', classroomId).abortSignal(controller.signal).maybeSingle()))
    if (!preflight.success) throw unavailable()
    const classroom = preflight.data.data
    if (!classroom) throw apiError(404, 'Classroom not found')
    if (classroom.id !== classroomId) throw unavailable()
    if (classroom.teacher_id === actorId || classroom.archived_at !== null) throw apiError(403, 'Forbidden')
    let control: Root | undefined, fingerprint: string | undefined
    function queryFor(extra = '') {
      let query = input.supabase.from('classrooms').select(`${rootFields}${extra ? `,${extra}` : ''}`)
        .eq('id', classroomId).eq('teacher_id', classroom!.teacher_id).neq('teacher_id', actorId).is('archived_at', null)
        .eq('membership.classroom_id', classroomId).eq('membership.student_id', actorId)
      if (control) query = query.eq('membership.id', control.membership[0].id).filter('feature_visibility', 'eq', JSON.stringify(control.feature_visibility))
      return query.abortSignal(controller.signal)
    }
    async function decode<T extends z.ZodRawShape>(query: PromiseLike<unknown>, extra: T) {
      const parsed = envelope(rootSchema.extend(extra).strict()).safeParse(await execute(query))
      if (!parsed.success) throw unavailable()
      if (!parsed.data.data) throw apiError(403, 'Forbidden')
      // Zod's generic extend type does not retain the base shape statically.
      // Both the strict base and the extra projection were validated above.
      const row = parsed.data.data as Root & z.infer<z.ZodObject<T>>
      if (row.id !== classroomId || row.teacher_id !== classroom!.teacher_id || row.teacher_id === actorId || row.archived_at !== null
        || row.membership.some(m => m.classroom_id !== classroomId || m.student_id !== actorId || (control && m.id !== control.membership[0].id))
        || (fingerprint !== undefined && courseGuideReadJsonFingerprint(row.feature_visibility) !== fingerprint)) throw unavailable()
      return row
    }
    control = await decode(queryFor().maybeSingle(), {})
    fingerprint = courseGuideReadJsonFingerprint(control.feature_visibility)
    const visibility = normalizeClassroomFeatureVisibility(control.feature_visibility)
    function published(query: ReturnType<typeof queryFor>, kind: Kind, batch?: Parent[]) {
      const stable = batch?.map(p => `and(id.eq.${p.id},updated_at.eq.${p.updated_at})`).join(',')
      if (kind === 'tests') {
        const active = query.in('items.status', ['active', 'closed'])
        return stable ? active.or(stable, { referencedTable: 'items' }) : active
      }
      const schedule = kind === 'assignments'
        ? `released_at.is.null,released_at.lte.${cutoff}` : `scheduled_for.is.null,scheduled_for.lte.${cutoff}`
      // PostgREST replaces repeated .or calls on one alias: compose both rules.
      return query.eq('items.is_draft', false).or(stable ? `and(or(${schedule}),or(${stable}))` : schedule, { referencedTable: 'items' })
    }
    async function discover<K extends Kind>(kind: K) {
      const output: Array<z.infer<(typeof schemas)[K]>> = [], seen = new Set<string>()
      let cursor: string | undefined
      for (;;) {
        let query = published(queryFor(`items:${kind}!${kind}_classroom_id_fkey(${fields[kind]})`), kind).eq('items.classroom_id', classroomId)
        if (cursor) query = query.gt('items.id', cursor)
        const row = await decode(query.order('id', { ascending: true, referencedTable: 'items' }).limit(PAGE, { referencedTable: 'items' }).maybeSingle(), { items: z.array(schemas[kind]).max(PAGE) })
        if (!row.items.length) return output
        for (const item of row.items) {
          if (item.classroom_id !== classroomId || seen.has(item.id) || (cursor && item.id <= cursor) || output.length >= MAX_COLLECTION || ++rowCount > MAX_ROWS) throw unavailable()
          if ('is_draft' in item && item.is_draft) throw unavailable()
          if ('released_at' in item && !isAssignmentVisibleToStudents(item, now)) throw unavailable()
          if ('scheduled_for' in item && item.scheduled_for !== null && Date.parse(item.scheduled_for) > now.getTime()) throw unavailable()
          output.push(item as z.infer<(typeof schemas)[K]>); seen.add(item.id); cursor = item.id
        }
      }
    }
    async function children<T extends z.ZodType<{ id: string }>>(kind: Kind, parents: Parent[], table: string, projection: string, schema: T, userColumn: 'student_id' | 'user_id', parentColumn: 'assignment_id' | 'test_id' | 'announcement_id', singular = true) {
      const output = new Map<string, z.output<T>[]>(parents.map(p => [p.id, []]))
      for (let start = 0; start < parents.length; start += BATCH) {
        const batch = parents.slice(start, start + BATCH), expected = new Map(batch.map(p => [p.id, p])), seen = new Set<string>()
        let cursor: string | undefined
        for (;;) {
          let query = published(queryFor(`items:${kind}!${kind}_classroom_id_fkey!inner(${fields[kind]},children:${table}!${table}_${parentColumn}_fkey(${projection}))`), kind, batch)
            .eq('items.classroom_id', classroomId).in('items.id', batch.map(p => p.id)).eq(`items.children.${userColumn}`, actorId)
            .order('id', { ascending: true, referencedTable: 'items' }).limit(BATCH, { referencedTable: 'items' })
          if (cursor) query = query.gt('items.children.id', cursor)
          const row = await decode(query.order('id', { ascending: true, referencedTable: 'items.children' }).limit(CHILD_PAGE, { referencedTable: 'items.children' }).maybeSingle(), {
            items: z.array(schemas[kind].extend({ children: z.array(schema).max(CHILD_PAGE) }).strict()).length(batch.length),
          })
          const candidates: Array<{ parentId: string; value: z.output<T> }> = [], tails: string[] = [], parentSeen = new Set<string>()
          for (const item of row.items) {
            const original = expected.get(item.id), { children: values, ...metadata } = item
            if (!original || parentSeen.has(item.id) || JSON.stringify(metadata) !== JSON.stringify(original)) throw unavailable()
            parentSeen.add(item.id)
            let last = cursor
            for (const value of values) {
              const raw = value as Record<string, unknown>
              if (raw[parentColumn] !== item.id || raw[userColumn] !== actorId || (last && value.id <= last)) throw unavailable()
              last = value.id; candidates.push({ parentId: item.id, value })
            }
            if (values.length && last) tails.push(last)
          }
          if (!tails.length) break
          const next = tails.sort()[0]
          if (cursor && next <= cursor) throw unavailable()
          for (const { parentId, value } of candidates) {
            if (value.id > next) continue
            const values = output.get(parentId)!
            if (seen.has(value.id) || (singular && values.length > 0) || values.length >= MAX_COLLECTION || ++rowCount > MAX_ROWS) throw unavailable()
            seen.add(value.id); values.push(value)
          }
          cursor = next
        }
      }
      return output
    }
    async function snapshot() {
      const daily = await decode(queryFor('days:class_days!class_days_classroom_id_fkey(id,classroom_id,date,is_class_day),entries:entries!entries_classroom_id_fkey(id,classroom_id,student_id,date)')
        .eq('days.date', today).eq('entries.date', today).eq('entries.student_id', actorId)
        .limit(2, { referencedTable: 'days' }).limit(2, { referencedTable: 'entries' }).maybeSingle(), { days: z.array(daySchema).max(1), entries: z.array(entrySchema).max(1) })
      if (daily.days.some(d => d.classroom_id !== classroomId || d.date !== today)
        || daily.entries.some(e => e.classroom_id !== classroomId || e.date !== today || e.student_id !== actorId)) throw unavailable()
      const assignments = visibility.classwork ? await discover('assignments') : []
      const docs = await children('assignments', assignments, 'assignment_docs', 'id,assignment_id,student_id,viewed_at,returned_at,feedback_returned_at', docSchema, 'student_id', 'assignment_id')
      const tests = visibility.tests ? await discover('tests') : []
      const responses = await children('tests', tests, 'test_responses', 'id,test_id,student_id,selected_option,response_text', responseSchema, 'student_id', 'test_id', false)
      const attempts = await children('tests', tests, 'test_attempts', 'id,test_id,student_id,is_submitted,closed_for_grading_at', attemptSchema, 'student_id', 'test_id')
      const availability = await children('tests', tests, 'test_student_availability', 'id,test_id,student_id,state', availabilitySchema, 'student_id', 'test_id')
      const announcements = visibility.announcements ? await discover('announcements') : []
      const reads = await children('announcements', announcements, 'announcement_reads', 'id,announcement_id,user_id', receiptSchema, 'user_id', 'announcement_id')
      return { daily: { days: daily.days, entries: daily.entries }, assignments, docs: [...docs], tests, responses: [...responses], attempts: [...attempts], availability: [...availability], announcements, reads: [...reads] }
    }
    const value = await snapshot()
    if (JSON.stringify(await snapshot()) !== JSON.stringify(value)) throw unavailable()
    await decode(queryFor().maybeSingle(), {})
    const docs = new Map(value.docs), responses = new Map(value.responses), attempts = new Map(value.attempts), availability = new Map(value.availability), reads = new Map(value.reads)
    check()
    return {
      hasTodayEntry: !value.daily.days.some(day => day.is_class_day) || value.daily.entries.length > 0,
      unviewedAssignmentsCount: value.assignments.filter(a => {
        const doc = docs.get(a.id)?.[0]
        return !doc || doc.viewed_at === null || Math.max(Date.parse(doc.returned_at ?? '') || 0, Date.parse(doc.feedback_returned_at ?? '') || 0) > Date.parse(doc.viewed_at)
      }).length,
      activeTestsCount: value.tests.filter(test => getEffectiveStudentTestAccess({ testStatus: test.status,
        accessState: availability.get(test.id)?.[0]?.state ?? null,
        hasSubmitted: attempts.get(test.id)?.[0]?.is_submitted === true || (responses.get(test.id) ?? []).some(hasMeaningfulTestResponse),
        returnedAt: null, isLockedForGrading: !!attempts.get(test.id)?.[0]?.closed_for_grading_at }).can_start_or_continue).length,
      unreadAnnouncementsCount: value.announcements.filter(a => !(reads.get(a.id)?.length)).length,
    }
  } catch (error) {
    if (error instanceof ApiError && safeErrors.has(error)) throw error
    throw unavailable()
  } finally { clearTimeout(timer); controller.abort() }
}
