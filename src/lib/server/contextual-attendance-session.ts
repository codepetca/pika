import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import type { getServiceRoleClient } from '@/lib/supabase'
import { getBaraAttendanceIntegrationState } from '@/lib/server/bara-attendance-client'
import { getBaraAttendanceCanaryScope } from '@/lib/server/bara-attendance-canary'
import { getBaraAttendanceScopeMode } from '@/lib/server/bara-attendance-scope'
import { buildTeacherAttendanceViewFromSnapshot, teacherAttendanceSnapshotRowsSchema } from '@/lib/server/bara-attendance-view'

const identitySchema = z.object({ actorId: z.string().uuid(), classroomId: z.string().uuid(), classDate: z.string().date() }).strict()
const integrationSchema = z.enum(['disabled','not_configured','ready'])
const installationSchema = z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/)
const studentsSchema = z.array(z.object({ id: z.string().uuid(), email: z.string(), first_name: z.string(), last_name: z.string() }).strict())
  .refine(rows => new Set(rows.map(row => row.id)).size === rows.length)
const snapshotSchema = z.object({
  actor_id: z.string().uuid(), classroom_id: z.string().uuid(), class_date: z.string().date(), runtime_integration: integrationSchema,
  scope_mode: z.enum(['exact_canary','teacher_entitlements']), installation_ref: installationSchema.nullable(),
  observed_at: z.string().datetime({ offset: true }), status: z.enum(['ok','forbidden','blocked']), integration: integrationSchema,
  students: studentsSchema, rows: teacherAttendanceSnapshotRowsSchema,
}).strict().superRefine((value,ctx) => {
  const empty = value.rows.participants.length === 0 && value.rows.occurrence === null && value.rows.policy === null && value.rows.session === null
    && value.rows.check_ins.length === 0 && value.rows.overrides.length === 0 && value.rows.outbox.length === 0
  if ((value.status !== 'ok' && (value.students.length > 0 || value.integration !== 'disabled' || !empty))
    || (value.integration !== 'ready' && !empty)
    || (value.rows.session && value.rows.session.occurrence_ref !== value.rows.occurrence?.occurrence_ref)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid snapshot disclosure' })
})
const envelopeSchema = z.object({ data: snapshotSchema, error: z.null(), status: z.number().int().min(200).max(299),
  statusText: z.string(), count: z.union([z.null(),z.literal(1)]) }).strict()
const unavailable = () => new ApiError(503,'Attendance is temporarily unavailable')

/** Even runtime-OFF requests authorize in the same DB snapshot before roster
 * disclosure. All runtime/scope inputs are server-owned, never caller supplied. */
export async function loadContextualAttendanceSession(input: {
  supabase: ReturnType<typeof getServiceRoleClient>; actorId: string; classroomId: string; classDate: string
}) {
  const identity = identitySchema.parse({ actorId: input.actorId, classroomId: input.classroomId, classDate: input.classDate })
  const mode = getBaraAttendanceScopeMode(), transport = getBaraAttendanceIntegrationState()
  const canary = mode === 'exact_canary' ? getBaraAttendanceCanaryScope() : null
  const runtime = canary?.state ?? transport
  const configured = installationSchema.safeParse(process.env.BARA_ATTENDANCE_INSTALLATION_REF?.trim())
  const installation = configured.success ? configured.data : null
  let response: unknown
  try {
    response = await input.supabase.rpc('read_attendance_session_for_owner_v1', {
      p_actor_id: identity.actorId, p_classroom_id: identity.classroomId, p_class_date: identity.classDate,
      p_runtime_integration: runtime, p_scope_mode: mode, p_installation_ref: installation,
      p_canary_actor_id: canary?.teacherId ?? null, p_canary_classroom_id: canary?.classroomId ?? null,
    }).abortSignal(AbortSignal.timeout(10_000))
  } catch { throw unavailable() }
  const parsed = envelopeSchema.safeParse(response)
  if (!parsed.success) throw unavailable()
  const value = parsed.data.data
  if (value.actor_id !== identity.actorId || value.classroom_id !== identity.classroomId || value.class_date !== identity.classDate
    || value.runtime_integration !== runtime || value.scope_mode !== mode || value.installation_ref !== installation) throw unavailable()
  if (value.status === 'forbidden') throw new ApiError(403,'Classroom access is unavailable')
  if (value.status === 'blocked') throw unavailable()
  if (value.integration === 'ready' && (runtime !== 'ready' || !installation || (canary
    && (canary.teacherId !== identity.actorId || canary.classroomId !== identity.classroomId)))) throw unavailable()
  const students = [...value.students].sort((a,b) => a.email.localeCompare(b.email) || a.id.localeCompare(b.id))
    .map(row => ({ studentId: row.id, firstName: row.first_name, lastName: row.last_name }))
  try {
    return buildTeacherAttendanceViewFromSnapshot({ classroomId: identity.classroomId, classDate: identity.classDate,
      integration: value.integration, students, rows: value.rows, now: value.observed_at })
  } catch { throw unavailable() }
}
