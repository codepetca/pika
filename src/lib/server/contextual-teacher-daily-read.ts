import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { AuthorizationError, requireAuth, requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import {
  isClassroomExperienceAdmissionConfigured,
  resolveClassroomExperienceAdmission,
} from '@/lib/server/classroom-experience-admission'
import type { AuthenticatedUser } from '@/types'

type TeacherDailyReadActor = { mode: 'legacy' | 'contextual'; user: AuthenticatedUser }
type ServiceClient = ReturnType<typeof getServiceRoleClient>
const uuid = z.string().uuid().transform((value) => value.toLowerCase())
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const entrySchema = z.object({
  id: uuid, classroom_id: uuid, student_id: uuid, date: dateSchema,
  student: z.object({ id: uuid, email: z.string() }),
  classroom: z.object({ id: uuid, teacher_id: uuid }),
}).passthrough()
const historyRowSchema = z.object({
  id: uuid, classroom_id: uuid, student_id: uuid, date: dateSchema,
  classroom: z.object({
    id: uuid, teacher_id: uuid,
    membership: z.array(z.object({ classroom_id: uuid, student_id: uuid })).min(1),
  }),
}).passthrough()
const enrollmentSchema = z.object({ classroom_id: uuid, student_id: uuid })

function requiredUuid(value: string): string {
  const parsed = uuid.safeParse(value)
  if (!parsed.success) throw new ApiError(400, 'Invalid Daily Log identifier')
  return parsed.data
}

/** Authentication precedes admission parsing and all request input. */
export async function authorizeTeacherDailyReadActor(): Promise<TeacherDailyReadActor> {
  if (!isClassroomExperienceAdmissionConfigured()) {
    return { mode: 'legacy', user: await requireRole('teacher') }
  }
  const user = await requireAuth()
  if (resolveClassroomExperienceAdmission(user).status === 'not-admitted') {
    if (user.role !== 'teacher') throw new AuthorizationError('Forbidden: teacher role required')
    return { mode: 'legacy', user }
  }
  return { mode: 'contextual', user: { ...user, id: user.id.toLowerCase() } }
}

/** The joined owner in this same entry statement is authoritative. */
export async function readContextualTeacherEntry(input: {
  supabase: ServiceClient; actorId: string; entryId: string
}) {
  const actorId = requiredUuid(input.actorId)
  const entryId = requiredUuid(input.entryId)
  let result: { data: unknown; error: { code?: string } | null }
  try {
    result = await input.supabase.from('entries')
      .select('*, student:users!student_id(id, email), classroom:classrooms!inner(id, teacher_id)')
      .eq('id', entryId).single()
  } catch {
    throw new ApiError(503, 'Unable to verify Daily Log entry')
  }
  const { data, error } = result
  if (error?.code === 'PGRST116') throw new ApiError(404, 'Entry not found')
  const parsed = entrySchema.safeParse(data)
  if (error || !parsed.success || parsed.data.id !== entryId
    || parsed.data.classroom.id !== parsed.data.classroom_id
    || parsed.data.student.id !== parsed.data.student_id) {
    throw new ApiError(503, 'Unable to verify Daily Log entry')
  }
  if (parsed.data.classroom.teacher_id !== actorId) throw new ApiError(403, 'Forbidden')
  const { classroom: _classroom, student, ...safeEntry } = parsed.data
  return { ...safeEntry, student: { email: student.email } }
}

/**
 * Preflights retain legacy 404/403 statuses. The final entry query independently
 * binds current classroom ownership and target enrollment in one statement.
 */
export async function readContextualTeacherStudentHistory(input: {
  supabase: ServiceClient; actorId: string; classroomId: string; studentId: string;
  date?: string; beforeDate?: string; limit: number
}) {
  const { supabase } = input
  const actorId = requiredUuid(input.actorId)
  const classroomId = requiredUuid(input.classroomId)
  const studentId = requiredUuid(input.studentId)
  if ((input.date && !dateSchema.safeParse(input.date).success)
    || (input.beforeDate && !dateSchema.safeParse(input.beforeDate).success)
    || (input.date && input.beforeDate)
    || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
    throw new ApiError(400, 'Invalid Daily Log history query')
  }

  let context: Awaited<ReturnType<typeof resolveClassroomAccess>>
  try {
    context = await resolveClassroomAccess(actorId, classroomId, { supabase })
  } catch {
    throw new ApiError(503, 'Unable to verify Daily Log history')
  }
  if (context === null) throw new ApiError(404, 'Classroom not found')
  if (context.classroomId !== classroomId || context.userId !== actorId) {
    throw new ApiError(503, 'Unable to verify Daily Log history')
  }
  if (context.relationship !== 'owner') throw new ApiError(403, 'Forbidden')
  if (context.ownerId !== actorId) throw new ApiError(503, 'Unable to verify Daily Log history')

  let enrollmentResult: { data: unknown; error: unknown }
  try {
    enrollmentResult = await supabase.from('classroom_enrollments')
      .select('classroom_id, student_id')
      .eq('classroom_id', classroomId).eq('student_id', studentId).maybeSingle()
  } catch {
    throw new ApiError(503, 'Unable to verify Daily Log history')
  }
  const { data: enrollment, error: enrollmentError } = enrollmentResult
  if (enrollmentError) throw new ApiError(503, 'Unable to verify Daily Log history')
  if (enrollment === null) throw new ApiError(404, 'Student not found in classroom')
  const membership = enrollmentSchema.safeParse(enrollment)
  if (!membership.success || membership.data.classroom_id !== classroomId
    || membership.data.student_id !== studentId) {
    throw new ApiError(503, 'Unable to verify Daily Log history')
  }

  let query = supabase.from('entries')
    .select('*, classroom:classrooms!inner(id, teacher_id, membership:classroom_enrollments!inner(classroom_id, student_id))')
    .eq('classroom_id', classroomId)
    .eq('student_id', studentId)
    .eq('classroom.teacher_id', actorId)
    .eq('classroom.membership.student_id', studentId)
  if (input.date) query = query.eq('date', input.date)
  else if (input.beforeDate) query = query.lt('date', input.beforeDate)
  let entriesResult: { data: unknown; error: unknown }
  try {
    entriesResult = await query.order('date', { ascending: false }).limit(input.limit)
  } catch {
    throw new ApiError(503, 'Unable to verify Daily Log history')
  }
  const { data, error } = entriesResult
  const rows = z.array(historyRowSchema).safeParse(data)
  if (error || !rows.success || rows.data.some((row) => (
    row.classroom_id !== classroomId || row.student_id !== studentId
    || (input.date !== undefined && row.date !== input.date)
    || (input.beforeDate !== undefined && row.date >= input.beforeDate)
    || row.classroom.id !== classroomId || row.classroom.teacher_id !== actorId
    || row.classroom.membership.some((member) => (
      member.classroom_id !== classroomId || member.student_id !== studentId
    ))
  ))) {
    throw new ApiError(503, 'Unable to verify Daily Log history')
  }
  return rows.data.map(({ classroom: _classroom, ...entry }) => entry)
}
