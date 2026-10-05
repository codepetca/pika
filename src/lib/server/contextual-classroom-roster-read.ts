import type { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import type { getServiceRoleClient } from '@/lib/supabase'
import {
  isClassroomExperienceAdmissionConfigured,
  resolveClassroomExperienceAdmission,
} from '@/lib/server/classroom-experience-admission'
import { getStudentPurgeEnabledStudentIds } from '@/lib/server/student-purge'
import {
  contextualClassroomRosterClassroomEnvelopeSchema,
  contextualClassroomRosterEnrollmentPageEnvelopeSchema,
  contextualClassroomRosterPageEnvelopeSchema,
  contextualClassroomRosterPurgeAvailabilitySchema,
  contextualClassroomRosterQuerySchema,
  type contextualClassroomRosterEnrollmentSchema,
  type contextualClassroomRosterRowSchema,
} from '@/lib/validations/contextual-classroom-roster-read'
import type { AuthenticatedUser } from '@/types'

type Client = ReturnType<typeof getServiceRoleClient>
type RosterRow = z.infer<typeof contextualClassroomRosterRowSchema>
type Enrollment = z.infer<typeof contextualClassroomRosterEnrollmentSchema>
type PurgeAvailabilityResolver = (actorId: string, classroomId: string, studentIds: string[]) => Promise<string[]>
const PAGE_SIZE = 1000
const rosterSelect = 'id,teacher_id,archived_at,roster:classroom_roster!classroom_roster_classroom_id_fkey(id,classroom_id,email,student_number,first_name,last_name,counselor_email,join_source,created_at,updated_at,removed_at,binding:classroom_roster_student_bindings!classroom_roster_student_bindings_roster_id_fkey(classroom_id,roster_id,student_id))'
const enrollmentSelect = 'id,teacher_id,archived_at,enrollments:classroom_enrollments!classroom_enrollments_classroom_id_fkey(id,classroom_id,student_id,created_at,student:users!classroom_enrollments_student_id_fkey(id,email))'
const unavailable = () => new ApiError(503, 'Unable to verify classroom roster')

/** Authentication precedes parsing present admission and all request parameters. */
export async function authorizeSharedClassroomRosterReadActor(): Promise<{ mode: 'existing' } | { mode: 'shared'; user: AuthenticatedUser }> {
  if (!isClassroomExperienceAdmissionConfigured()) return { mode: 'existing' }
  const user = await requireAuth()
  if (resolveClassroomExperienceAdmission(user).status !== 'admitted') return { mode: 'existing' }
  return { mode: 'shared', user }
}

/**
 * Every payload statement, including each terminal empty collection, proves the
 * current owner. This is statement-time authority, not an atomic list snapshot.
 * The optional availability resolver is server-only; HTTP callers cannot supply it.
 */
export async function readContextualClassroomRoster(input: {
  supabase: Client; actorId: string; classroomId: string;
  resolvePurgeAvailability?: PurgeAvailabilityResolver
}) {
  const parsed = contextualClassroomRosterQuerySchema.safeParse({ actorId: input.actorId, classroomId: input.classroomId })
  if (!parsed.success) throw new ApiError(400, 'Invalid classroom roster query')
  const { actorId, classroomId } = parsed.data
  let preflightResult: unknown
  try {
    preflightResult = await input.supabase.from('classrooms')
      .select('id,teacher_id,archived_at').eq('id', classroomId).maybeSingle()
  } catch { throw unavailable() }
  const preflight = contextualClassroomRosterClassroomEnvelopeSchema.safeParse(preflightResult)
  if (!preflight.success) throw unavailable()
  if (preflight.data.data === null) throw new ApiError(404, 'Classroom not found')
  if (preflight.data.data.id !== classroomId) throw unavailable()
  if (preflight.data.data.teacher_id !== actorId) throw new ApiError(403, 'Forbidden')

  const rows: RosterRow[] = []
  let rosterCursor: string | undefined
  for (;;) {
    let pageResult: unknown
    try {
      let query = input.supabase.from('classrooms').select(rosterSelect)
        .eq('id', classroomId).eq('teacher_id', actorId).is('roster.removed_at', null)
      if (rosterCursor) query = query.gt('roster.id', rosterCursor)
      pageResult = await query.order('id', { ascending: true, referencedTable: 'roster' })
        .limit(PAGE_SIZE, { referencedTable: 'roster' }).maybeSingle()
    } catch { throw unavailable() }
    const envelope = contextualClassroomRosterPageEnvelopeSchema.safeParse(pageResult)
    if (!envelope.success) throw unavailable()
    const root = envelope.data.data
    if (root === null) throw new ApiError(403, 'Forbidden')
    if (root.id !== classroomId || root.teacher_id !== actorId) throw unavailable()
    for (const row of root.roster) {
      if (row.classroom_id !== classroomId || row.removed_at !== null
        || (rosterCursor !== undefined && row.id <= rosterCursor)) throw unavailable()
      if (row.binding !== null) {
        if (row.binding.classroom_id !== classroomId || row.binding.roster_id !== row.id) throw unavailable()
      }
      rows.push(row)
      rosterCursor = row.id
    }
    if (root.roster.length === 0) break
  }

  const joinedByStudentId = new Map<string, Enrollment>()
  const joinedByEmail = new Map<string, Enrollment>()
  let enrollmentCursor: string | undefined
  for (;;) {
    let pageResult: unknown
    try {
      let query = input.supabase.from('classrooms').select(enrollmentSelect)
        .eq('id', classroomId).eq('teacher_id', actorId)
      if (enrollmentCursor) query = query.gt('enrollments.id', enrollmentCursor)
      pageResult = await query.order('id', { ascending: true, referencedTable: 'enrollments' })
        .limit(PAGE_SIZE, { referencedTable: 'enrollments' }).maybeSingle()
    } catch { throw unavailable() }
    const envelope = contextualClassroomRosterEnrollmentPageEnvelopeSchema.safeParse(pageResult)
    if (!envelope.success) throw unavailable()
    const root = envelope.data.data
    if (root === null) throw new ApiError(403, 'Forbidden')
    if (root.id !== classroomId || root.teacher_id !== actorId) throw unavailable()
    for (const row of root.enrollments) {
      if (row.classroom_id !== classroomId || row.student.id !== row.student_id
        || (enrollmentCursor !== undefined && row.id <= enrollmentCursor)
        || joinedByStudentId.has(row.student_id)) throw unavailable()
      joinedByStudentId.set(row.student_id, row)
      joinedByEmail.set(row.student.email.toLowerCase().trim(), row)
      enrollmentCursor = row.id
    }
    if (root.enrollments.length === 0) break
  }

  const roster = rows.map(row => {
    const joined = row.binding !== null
      ? joinedByStudentId.get(row.binding.student_id)
      : joinedByEmail.get(row.email.toLowerCase().trim())
    return {
      id: row.id, email: row.email, student_number: row.student_number,
      first_name: row.first_name, last_name: row.last_name, counselor_email: row.counselor_email,
      join_source: row.join_source === 'open_join' || row.join_source === 'csv' ? row.join_source : 'manual',
      created_at: row.created_at, updated_at: row.updated_at, joined: !!joined,
      student_id: row.binding !== null && joined ? joined.student_id : null,
      joined_at: joined?.created_at ?? null,
    }
  })
  const eligibleIds = [...new Set(roster.flatMap(row => row.student_id ? [row.student_id] : []))]
  const eligible = new Set(eligibleIds)
  let availabilityResult: unknown
  try {
    availabilityResult = await (input.resolvePurgeAvailability ?? getStudentPurgeEnabledStudentIds)(actorId, classroomId, [...eligibleIds])
  } catch { throw unavailable() }
  const availability = contextualClassroomRosterPurgeAvailabilitySchema.safeParse(availabilityResult)
  if (!availability.success || availability.data.some(studentId => !eligible.has(studentId))) throw unavailable()
  return { roster, student_purge_enabled_ids: availability.data }
}
