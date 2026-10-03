import { isDeepStrictEqual } from 'node:util'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { rosterActorSchema, rosterClassParamsSchema, rosterRowParamsSchema, rosterUpsertEnvelopeSchema,
  rosterPatchEnvelopeSchema, rosterStudentsSchema, rosterCounselorBodySchema, type RosterStudent,
  type RosterCounselorInput } from '@/lib/validations/roster-mutations'
import type { AuthenticatedUser } from '@/types'

const unavailable = () => new ApiError(503, 'Unable to verify roster mutation')
export async function authorizeSharedRosterMutationActor(): Promise<{ mode: 'existing' } | { mode: 'shared'; user: AuthenticatedUser }> {
  if (!isClassroomExperienceAdmissionConfigured()) return { mode: 'existing' }
  const user = await requireAuth()
  if (resolveClassroomExperienceAdmission(user).status !== 'admitted') return { mode: 'existing' }
  return { mode: 'shared', user }
}
function actorId(value: string) {
  const parsed = rosterActorSchema.safeParse(value)
  if (!parsed.success) throw unavailable()
  return parsed.data
}
function mapError(code: string): never {
  if (code === '42501') throw new ApiError(403, 'Forbidden')
  if (code === 'P0002') throw new ApiError(404, 'Classroom not found')
  if (code === 'PT404') throw new ApiError(404, 'Roster entry not found')
  if (code === '22023') throw new ApiError(400, 'Invalid roster mutation request')
  if (['PT409', '40001', '40P01', '55P03', '55000'].includes(code)) throw new ApiError(409, 'Roster changed during this update. Refresh and try again.')
  throw unavailable()
}
async function invoke(operation: () => PromiseLike<unknown>) {
  try { return await operation() } catch { throw unavailable() }
}
function bindingMatches(roster: { id: string; classroom_id: string }, binding: { roster_id: string; classroom_id: string } | null) {
  return binding === null || (binding.roster_id === roster.id && binding.classroom_id === roster.classroom_id)
}
const values = (student: RosterStudent) => ({ firstName: student.firstName, lastName: student.lastName, studentNumber: student.studentNumber, counselorEmail: student.counselorEmail })
export async function upsertContextualRoster(input: { actorId: string; classroomId: string; students: RosterStudent[]; mode: 'manual' | 'csv-preview' | 'csv-confirmed' }) {
  const actor = actorId(input.actorId)
  const { id: classroomId } = rosterClassParamsSchema.parse({ id: input.classroomId })
  const students = rosterStudentsSchema.parse(input.students)
  const response = await invoke(() => getServiceRoleClient().rpc('upsert_classroom_roster_for_owner_v1', {
    p_actor_id: actor, p_classroom_id: classroomId, p_students: students, p_mode: input.mode,
  }))
  const envelope = rosterUpsertEnvelopeSchema.safeParse(response)
  if (!envelope.success) throw unavailable()
  if (envelope.data.error !== null) mapError(envelope.data.error.code)
  const data = envelope.data.data
  if (data.actor_id !== actor || data.classroom_id !== classroomId || data.mode !== input.mode) throw unavailable()
  const byEmail = new Map(students.map(student => [student.email, student]))
  if (data.needs_confirmation) {
    if (data.total_count !== students.length || data.update_count !== data.changes.length
      || data.update_count + data.new_count > data.total_count
      || new Set(data.changes.map(change => change.email)).size !== data.changes.length) throw unavailable()
    for (const change of data.changes) {
      const student = byEmail.get(change.email)
      if (!student || !isDeepStrictEqual(change.incoming, values(student))
        || isDeepStrictEqual(change.current, change.incoming)) throw unavailable()
    }
    return { needsConfirmation: true as const, changes: data.changes, updateCount: data.update_count, newCount: data.new_count, totalCount: data.total_count }
  }
  if (data.rows.length !== students.length || new Set(data.rows.map(row => row.roster.id)).size !== students.length
    || new Set(data.rows.map(row => row.roster.email.trim().toLowerCase())).size !== students.length) throw unavailable()
  for (const { roster, binding } of data.rows) {
    const student = byEmail.get(roster.email.trim().toLowerCase())
    if (!student || roster.classroom_id !== classroomId || !bindingMatches(roster, binding)
      || roster.first_name !== student.firstName || roster.last_name !== student.lastName
      || roster.student_number !== student.studentNumber || roster.counselor_email !== student.counselorEmail
      || roster.join_source !== (input.mode === 'manual' ? 'manual' : 'csv')) throw unavailable()
  }
  return input.mode === 'manual' ? { success: true as const, upsertedCount: data.rows.length }
    : { success: true as const, totalProcessed: students.length, upsertedCount: data.rows.length }
}
export async function patchContextualRosterCounselor(input: { actorId: string; classroomId: string; rosterId: string; body: RosterCounselorInput }) {
  const actor = actorId(input.actorId)
  const params = rosterRowParamsSchema.parse({ id: input.classroomId, rosterId: input.rosterId })
  const body = rosterCounselorBodySchema.parse(input.body)
  const response = await invoke(() => getServiceRoleClient().rpc('update_classroom_roster_counselor_for_owner_v1', {
    p_actor_id: actor, p_classroom_id: params.id, p_roster_id: params.rosterId,
    p_counselor_email: body.counselor_email, p_expected_updated_at: body.expected_updated_at,
  }))
  const envelope = rosterPatchEnvelopeSchema.safeParse(response)
  if (!envelope.success) throw unavailable()
  if (envelope.data.error !== null) mapError(envelope.data.error.code)
  const { data } = envelope.data
  if (data.actor_id !== actor || data.classroom_id !== params.id || data.roster.id !== params.rosterId
    || data.roster.classroom_id !== params.id || data.roster.counselor_email !== body.counselor_email
    || !bindingMatches(data.roster, data.binding)) throw unavailable()
  return { success: true as const, roster: { id: data.roster.id, counselor_email: data.roster.counselor_email, updated_at: data.roster.updated_at } }
}
