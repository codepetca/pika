import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import {
  isClassroomExperienceAdmissionConfigured,
  resolveClassroomExperienceAdmission,
} from '@/lib/server/classroom-experience-admission'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  contextualClassDayReadClassroomEnvelopeSchema,
  contextualClassDayReadEnrollmentEnvelopeSchema,
  contextualClassDayReadIdentitySchema,
  contextualClassDayReadMemberEnvelopeSchema,
  contextualClassDayReadMembershipSchema,
  contextualClassDayReadOwnerEnvelopeSchema,
} from '@/lib/validations/contextual-class-day-read'
import type { AuthenticatedUser } from '@/types'
import type { TableRow } from '@/types/database'

export type ContextualClassDayReadClient = ReturnType<typeof getServiceRoleClient>
const PAGE_SIZE = 1000
const ownerSelect = 'id,teacher_id,archived_at,class_days:class_days!class_days_classroom_id_fkey(id,classroom_id,date,is_class_day,prompt_text)'
const memberSelect = `${ownerSelect},membership:classroom_enrollments!classroom_enrollments_classroom_id_fkey!inner(classroom_id,student_id)`
const unavailable = () => new ApiError(503, 'Unable to verify classroom class days')

/** Presence detection preserves existing installations; parsing follows authentication. */
export async function authorizeSharedClassDayReadActor(): Promise<{ mode: 'existing' } | { mode: 'shared'; user: AuthenticatedUser }> {
  if (!isClassroomExperienceAdmissionConfigured()) return { mode: 'existing' }
  const user = await requireAuth()
  if (resolveClassroomExperienceAdmission(user).status !== 'admitted') return { mode: 'existing' }
  return { mode: 'shared', user }
}

/** Each page proves the current relationship in its payload statement, including the terminal empty page. */
export async function readContextualClassDays(input: {
  supabase: ContextualClassDayReadClient; actorId: string; classroomId: string
}): Promise<{ class_days: TableRow<'class_days'>[] }> {
  const identity = contextualClassDayReadIdentitySchema.safeParse({ actorId: input.actorId, classroomId: input.classroomId })
  if (!identity.success) throw new ApiError(400, 'Invalid class-day query')
  const { actorId, classroomId } = identity.data
  let preflightResult: unknown
  try {
    preflightResult = await input.supabase.from('classrooms')
      .select('id,teacher_id,archived_at').eq('id', classroomId).maybeSingle()
  } catch { throw unavailable() }
  const preflight = contextualClassDayReadClassroomEnvelopeSchema.safeParse(preflightResult)
  if (!preflight.success) throw unavailable()
  const classroom = preflight.data.data
  if (classroom === null) throw new ApiError(404, 'Classroom not found')
  if (classroom.id !== classroomId) throw unavailable()
  // Ownership takes precedence even when an owner also has an enrollment.
  const owner = classroom.teacher_id === actorId
  if (!owner) {
    if (classroom.archived_at !== null) throw new ApiError(403, 'Forbidden')
    let enrollmentResult: unknown
    try {
      enrollmentResult = await input.supabase.from('classroom_enrollments')
        .select('classroom_id,student_id').eq('classroom_id', classroomId)
        .eq('student_id', actorId).maybeSingle()
    } catch { throw unavailable() }
    const enrollment = contextualClassDayReadEnrollmentEnvelopeSchema.safeParse(enrollmentResult)
    if (!enrollment.success) throw unavailable()
    if (enrollment.data.data === null) throw new ApiError(403, 'Forbidden')
    if (enrollment.data.data.classroom_id !== classroomId || enrollment.data.data.student_id !== actorId) throw unavailable()
  }

  const days: TableRow<'class_days'>[] = []
  const seenIds = new Set<string>()
  const seenDates = new Set<string>()
  let previous: TableRow<'class_days'> | undefined
  for (;;) {
    let pageResult: unknown
    try {
      let query = input.supabase.from('classrooms').select(owner ? ownerSelect : memberSelect).eq('id', classroomId)
      query = owner ? query.eq('teacher_id', actorId)
        : query.neq('teacher_id', actorId).is('archived_at', null).eq('membership.student_id', actorId)
      if (previous) query = query.or(`date.gt.${previous.date},and(date.eq.${previous.date},id.gt.${previous.id})`, { referencedTable: 'class_days' })
      pageResult = await query.order('date', { ascending: true, referencedTable: 'class_days' })
        .order('id', { ascending: true, referencedTable: 'class_days' })
        .limit(PAGE_SIZE, { referencedTable: 'class_days' }).maybeSingle()
    } catch { throw unavailable() }
    const envelope = (owner ? contextualClassDayReadOwnerEnvelopeSchema : contextualClassDayReadMemberEnvelopeSchema).safeParse(pageResult)
    if (!envelope.success) throw unavailable()
    const row = envelope.data.data
    if (row === null) throw new ApiError(403, 'Forbidden')
    const membership = owner ? null : contextualClassDayReadMembershipSchema.safeParse('membership' in row ? row.membership : undefined)
    if (row.id !== classroomId || (owner ? row.teacher_id !== actorId
      : row.teacher_id === actorId || row.archived_at !== null || !membership?.success
        || membership.data.some(member => member.classroom_id !== classroomId || member.student_id !== actorId))) throw unavailable()
    for (const day of row.class_days) {
      if (day.classroom_id !== classroomId || seenIds.has(day.id) || seenDates.has(day.date)
        || (previous && (day.date < previous.date || (day.date === previous.date && day.id <= previous.id)))) throw unavailable()
      seenIds.add(day.id)
      seenDates.add(day.date)
      days.push(day)
      previous = day
    }
    if (row.class_days.length === 0) break
  }
  return { class_days: days }
}
