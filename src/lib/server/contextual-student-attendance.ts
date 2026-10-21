import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { formatDateInToronto } from '@/lib/timezone'
import type { getServiceRoleClient } from '@/lib/supabase'
import type { StudentAttendanceStatusView } from '@/lib/validations/student-attendance'
import { getBaraAttendanceIntegrationState } from '@/lib/server/bara-attendance-client'
import { getBaraAttendanceCanaryScope } from '@/lib/server/bara-attendance-canary'
import { getBaraAttendanceScopeMode } from '@/lib/server/bara-attendance-scope'
import { deriveStudentAttendanceMembershipOccurrenceBinding } from '@/lib/server/bara-attendance-entry-token'
import {
  buildStudentAttendanceClassroomState, occurrenceRowsSchema, sessionRowsSchema,
  checkInRowsSchema, overrideRowsSchema,
} from '@/lib/server/bara-attendance-student-view'

const integrationSchema = z.enum(['disabled', 'not_configured', 'ready'])
const installationSchema = z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/)
const classroomSchema = z.object({
  classroom_id: z.string().uuid(), generation_id: z.string().uuid().nullable(),
  participant_ref: z.string().regex(/^participant_[a-f0-9]{32}$/).nullable(),
  integration: integrationSchema, occurrence: occurrenceRowsSchema.element.nullable(),
  session: sessionRowsSchema.element.nullable(), check_in: checkInRowsSchema.element.nullable(),
  override: overrideRowsSchema.element.nullable(),
}).strict().superRefine((row, context) => {
  if ((row.integration === 'ready' && (!row.generation_id || !row.participant_ref))
    || (row.integration !== 'ready' && (row.generation_id || row.participant_ref || row.occurrence || row.session || row.check_in || row.override))
    || (row.occurrence && row.occurrence.classroom_id !== row.classroom_id)
    || (row.session && row.session.occurrence_ref !== row.occurrence?.occurrence_ref)
    || (row.check_in && (row.check_in.classroom_id !== row.classroom_id || row.check_in.occurrence_ref !== row.occurrence?.occurrence_ref))
    || (row.override && (row.override.classroom_id !== row.classroom_id || row.override.occurrence_ref !== row.occurrence?.occurrence_ref))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid membership attendance disclosure' })
  }
})
const snapshotSchema = z.object({
  student_id: z.string().uuid(), class_date: z.string().date(), runtime_integration: integrationSchema,
  scope_mode: z.enum(['exact_canary', 'teacher_entitlements']), installation_ref: installationSchema.nullable(),
  observed_at: z.string().datetime({ offset: true }), classrooms: z.array(classroomSchema).max(50),
}).strict().refine(value => new Set(value.classrooms.map(row => row.classroom_id)).size === value.classrooms.length)
const envelopeSchema = z.object({ data: snapshotSchema, error: z.null(), status: z.number().int().min(200).max(299),
  statusText: z.string(), count: z.union([z.null(), z.literal(1)]) }).strict()
const unavailable = () => new ApiError(503, 'Attendance status is temporarily unavailable')

/** Admission is selected by the route; the DB independently checks current
 * membership, attendance scope and lifecycle in the same bounded snapshot.
 * Generation/ref never leave this server adapter, only their opaque binding.
 */
export async function loadContextualStudentAttendanceStatus(input: {
  supabase: ReturnType<typeof getServiceRoleClient>; studentId: string; now?: Date
}): Promise<StudentAttendanceStatusView> {
  const studentId = z.string().uuid().parse(input.studentId)
  const requestedAt = input.now ?? new Date()
  const classDate = formatDateInToronto(requestedAt)
  const mode = getBaraAttendanceScopeMode()
  const canary = mode === 'exact_canary' ? getBaraAttendanceCanaryScope() : null
  const runtime = canary?.state ?? getBaraAttendanceIntegrationState()
  const configured = installationSchema.safeParse(process.env.BARA_ATTENDANCE_INSTALLATION_REF?.trim())
  const installation = configured.success ? configured.data : null
  let response: unknown
  try {
    response = await input.supabase.rpc('read_attendance_membership_status_v1', {
      p_student_id: studentId, p_class_date: classDate, p_runtime_integration: runtime,
      p_scope_mode: mode, p_installation_ref: installation,
      p_canary_actor_id: canary?.teacherId ?? null, p_canary_classroom_id: canary?.classroomId ?? null,
    }).abortSignal(AbortSignal.timeout(10_000))
  } catch { throw unavailable() }
  const parsed = envelopeSchema.safeParse(response)
  if (!parsed.success) throw unavailable()
  const value = parsed.data.data
  const observedAt = new Date(value.observed_at)
  if (value.student_id !== studentId || value.class_date !== classDate || value.runtime_integration !== runtime
    || value.scope_mode !== mode || value.installation_ref !== installation
    || formatDateInToronto(observedAt) !== classDate
    || Math.abs(observedAt.getTime() - requestedAt.getTime()) > 30_000
    || Buffer.byteLength(JSON.stringify(value), 'utf8') > 1024 * 1024
    || value.classrooms.some(row => (row.occurrence && row.occurrence.class_date !== classDate)
      || (row.integration === 'ready' && (runtime !== 'ready' || !installation
        || (canary && row.classroom_id !== canary.classroomId))))) throw unavailable()
  let nextRefreshAt: string | null = null
  const classrooms = value.classrooms.map(row => {
    if (row.integration !== 'ready') return { classroomId: row.classroom_id, state: 'unavailable' as const, opensAt: null, closesAt: null }
    const built = buildStudentAttendanceClassroomState({ classroomId: row.classroom_id,
      occurrence: row.occurrence, session: row.session, checkIn: row.check_in, statusOverride: row.override, now: observedAt })
    if (built.nextRefreshAt && (!nextRefreshAt || built.nextRefreshAt < nextRefreshAt)) nextRefreshAt = built.nextRefreshAt
    if (!row.occurrence || !row.generation_id || !row.participant_ref) return built.state
    try {
      return { ...built.state, classDate, occurrenceBinding: deriveStudentAttendanceMembershipOccurrenceBinding({
        studentId, classroomId: row.classroom_id, generationId: row.generation_id,
        participantRef: row.participant_ref, occurrenceRef: row.occurrence.occurrence_ref,
      }) }
    } catch { throw unavailable() }
  })
  return { studentId, classrooms, nextRefreshAt, serverNow: value.observed_at }
}
