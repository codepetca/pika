import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { computeAttendanceRecords } from '@/lib/attendance'
import { formatDateInToronto } from '@/lib/timezone'
import type { getServiceRoleClient } from '@/lib/supabase'

export const attendanceReportQuerySchema = z.object({ classroom_id: z.string().uuid() }).strict()
const identitySchema = z.object({ actorId: z.string().uuid(), classroomId: z.string().uuid() }).strict()
const snapshotSchema = z.object({
  actor_id: z.string().uuid(), classroom_id: z.string().uuid(), observed_at: z.string().datetime({ offset: true }),
  status: z.enum(['ok','forbidden','blocked']),
  students: z.array(z.object({ id: z.string().uuid(), email: z.string(), first_name: z.string(), last_name: z.string() }).strict()),
  class_days: z.array(z.object({ classroom_id: z.string().uuid(), date: z.string().date(), is_class_day: z.boolean() }).strict()),
  entries: z.array(z.object({ id: z.string().uuid(), classroom_id: z.string().uuid(), student_id: z.string().uuid(), date: z.string().date(), text: z.string() }).strict()),
}).strict().superRefine((value,ctx) => {
  const students = new Set(value.students.map(row => row.id))
  if (students.size !== value.students.length
    || new Set(value.class_days.map(row => row.date)).size !== value.class_days.length
    || new Set(value.entries.map(row => row.id)).size !== value.entries.length
    || new Set(value.entries.map(row => `${row.student_id}:${row.date}`)).size !== value.entries.length
    || value.class_days.some(row => row.classroom_id !== value.classroom_id)
    || value.entries.some(row => row.classroom_id !== value.classroom_id || !students.has(row.student_id))
    || (value.status !== 'ok' && (value.students.length > 0 || value.class_days.length > 0 || value.entries.length > 0))) {
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'Invalid attendance report snapshot'})
  }
})
const envelopeSchema = z.object({ data: snapshotSchema, error: z.null(), status: z.number().int().min(200).max(299),
  statusText: z.string(), count: z.union([z.null(),z.literal(1)]) }).strict()
const unavailable = () => new ApiError(503,'Attendance is temporarily unavailable')
// Private response/work bounds, not subscription quantities or roster quotas.
const REPORT_BYTES = 8 * 1024 * 1024
const REPORT_CELLS = 250_000
const REPORT_FILTER_COMPARISONS = 32_000_000

/** Daily Log report only: no Bara runtime, grant, principal or decommission dependency. */
export async function loadContextualAttendanceReport(input: {
  supabase: ReturnType<typeof getServiceRoleClient>; actorId: string; classroomId: string
}) {
  const identity = identitySchema.parse({actorId:input.actorId,classroomId:input.classroomId})
  let response: unknown
  try {
    response = await input.supabase.rpc('read_attendance_report_for_owner_v1', {
      p_actor_id:identity.actorId,p_classroom_id:identity.classroomId,
    }).abortSignal(AbortSignal.timeout(10_000))
  } catch { throw unavailable() }
  const parsed = envelopeSchema.safeParse(response)
  if (!parsed.success) throw unavailable()
  const snapshot = parsed.data.data
  if (snapshot.actor_id !== identity.actorId || snapshot.classroom_id !== identity.classroomId
    || Buffer.byteLength(JSON.stringify(snapshot),'utf8') > REPORT_BYTES) throw unavailable()
  if (snapshot.status === 'forbidden') throw new ApiError(403,'Classroom access is unavailable')
  if (snapshot.status === 'blocked') throw unavailable()
  const students = [...snapshot.students].sort((a,b) => a.email.localeCompare(b.email) || a.id.localeCompare(b.id))
  const days = [...snapshot.class_days].sort((a,b) => a.date.localeCompare(b.date))
  const entries = [...snapshot.entries].sort((a,b) => a.id.localeCompare(b.id))
  const cells = students.length * days.filter(day => day.is_class_day).length
  // The unchanged pure helper filters both entries and ALL days per student.
  const comparisons = students.length * (entries.length + days.length)
  if (!Number.isSafeInteger(cells) || cells > REPORT_CELLS
    || !Number.isSafeInteger(comparisons) || comparisons > REPORT_FILTER_COMPARISONS) throw unavailable()
  const result = { attendance:computeAttendanceRecords(students,days,entries,formatDateInToronto(new Date(snapshot.observed_at))),
    dates:days.filter(day => day.is_class_day).map(day => day.date),classroom_id:identity.classroomId }
  if (Buffer.byteLength(JSON.stringify(result),'utf8') > REPORT_BYTES) throw unavailable()
  return result
}
