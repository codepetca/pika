import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherCanMutateClassroom, assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { BaraAttendanceCanaryError } from '@/lib/server/bara-attendance-canary'
import { assertBaraAttendanceClassroomAccess } from '@/lib/server/bara-attendance-scope'
import { loadTeacherAttendancePolicy } from '@/lib/server/bara-attendance-policy'
import { teacherAttendancePolicyUpdateSchema } from '@/lib/validations/teacher-attendance-policy'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const id = z.string().uuid()
const date = z.string().date()
const querySchema = z.object({ classroom_id: id, date }).strict()
const timingSchema = z.object({
  classroomId: id, timezone: z.literal('America/Toronto'),
  sessionStartsLocal: z.string(), sessionEndsLocal: z.string(),
  sessionEndDayOffset: z.union([z.literal(0), z.literal(1)]),
  entryOpensMinutesBefore: z.number(), presentGraceMinutes: z.number(),
  entryClosesMinutesBeforeEnd: z.number(), absentMinutesBeforeEnd: z.number(),
  enabled: z.boolean(), revision: z.number().int().positive(), updatedAt: z.string(),
}).strict()
const mutationSchema = z.object({
  classroom_id: id, id: id.nullable().optional(), name: z.string().trim().min(1).max(80),
  policy: timingSchema, expected_revision: z.number().int().safe().positive(),
}).strict()
const selectionSchema = z.object({
  classroom_id: id, date, schedule_id: id.nullable(), expected_revision: z.number().int().safe().positive(),
}).strict()
const storedTimingSchema = z.object({
  session_starts_local: z.string(), session_ends_local: z.string(),
  session_end_day_offset: z.union([z.literal(0), z.literal(1)]),
  entry_opens_minutes_before: z.number(), present_grace_minutes: z.number(),
  entry_closes_minutes_before_end: z.number(), absent_minutes_before_end: z.number(),
}).strict()

async function access(classroomId: string, write: boolean) {
  const user = await requireRole('teacher')
  // The schedule tables are introduced by migration 296; generated types are
  // refreshed after the separately authorized database migration.
  const supabase: any = getServiceRoleClient()
  const ownership = await (write ? assertTeacherCanMutateClassroom : assertTeacherOwnsClassroom)(user.id, classroomId, { supabase })
  if (!ownership.ok) throw new ApiError(ownership.status, ownership.error)
  if (ownership.classroom.archived_at) throw new ApiError(403, 'Classroom is archived')
  try {
    await assertBaraAttendanceClassroomAccess({ supabase, teacherId: user.id, classroomId })
  } catch (error) {
    if (error instanceof BaraAttendanceCanaryError) throw new ApiError(error.code === 'disabled' ? 404 : 503, 'Attendance is unavailable for this classroom')
    throw error
  }
  return { user, supabase }
}

export const GET = withErrorHandler('GetTeacherAttendanceSchedules', async (request) => {
  const input = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
  const { supabase } = await access(input.classroom_id, false)
  const [policy, definitions, assignment] = await Promise.all([
    loadTeacherAttendancePolicy({ supabase, classroomId: input.classroom_id }),
    supabase.from('attendance_named_schedules').select('id, name, policy').eq('classroom_id', input.classroom_id).order('name'),
    supabase.from('attendance_day_schedules').select('schedule_id').eq('classroom_id', input.classroom_id).eq('class_date', input.date).maybeSingle(),
  ])
  if (definitions.error || assignment.error) throw new ApiError(503, 'Attendance schedules are temporarily unavailable')
  if (!policy) return NextResponse.json({ schedules: [], selectedId: null })
  const rowsResult = z.array(z.object({ id, name: z.string().min(1).max(80), policy: storedTimingSchema }).strict()).safeParse(definitions.data)
  const selectionResult = z.object({ schedule_id: id }).strict().nullable().safeParse(assignment.data)
  if (!rowsResult.success || !selectionResult.success) throw new ApiError(503, 'Attendance schedules are temporarily unavailable')
  const rows = rowsResult.data
  const selected = selectionResult.data
  if (selected && !rows.some(row => row.id === selected.schedule_id)) throw new ApiError(503, 'Attendance schedules are temporarily unavailable')
  const schedules = [{ id: null, name: 'Regular schedule', policy }, ...rows.map(row => ({
    id: row.id, name: row.name, policy: { ...policy,
      sessionStartsLocal: row.policy.session_starts_local, sessionEndsLocal: row.policy.session_ends_local,
      sessionEndDayOffset: row.policy.session_end_day_offset, entryOpensMinutesBefore: row.policy.entry_opens_minutes_before,
      presentGraceMinutes: row.policy.present_grace_minutes, entryClosesMinutesBeforeEnd: row.policy.entry_closes_minutes_before_end,
      absentMinutesBeforeEnd: row.policy.absent_minutes_before_end,
    },
  }))]
  return NextResponse.json({ schedules, selectedId: selected?.schedule_id ?? null })
})

async function mutate(request: Request, command: 'upsert' | 'assign', requireId = false) {
  const body: unknown = await request.json()
  const input = command === 'assign' ? selectionSchema.parse(body) : mutationSchema.parse(body)
  const { user, supabase } = await access(input.classroom_id, true)
  let scheduleId: string | null
  let classDate: string | null = null
  let name: string | null = null
  let policy: Record<string, unknown> | null = null
  if ('schedule_id' in input) {
    scheduleId = input.schedule_id
    classDate = input.date
  } else {
    scheduleId = input.id ?? null
    if (requireId && !scheduleId) throw new ApiError(400, 'Schedule ID is required')
    if (!requireId && scheduleId) throw new ApiError(400, 'Schedule ID is not allowed')
    if (input.policy.classroomId !== input.classroom_id) throw new ApiError(400, 'Classroom does not match schedule')
    const parsed = teacherAttendancePolicyUpdateSchema.parse({
      classroom_id: input.classroom_id, session_starts_local: input.policy.sessionStartsLocal,
      session_ends_local: input.policy.sessionEndsLocal, session_end_day_offset: input.policy.sessionEndDayOffset,
      entry_opens_minutes_before: input.policy.entryOpensMinutesBefore, present_grace_minutes: input.policy.presentGraceMinutes,
      entry_closes_minutes_before_end: input.policy.entryClosesMinutesBeforeEnd,
      absent_minutes_before_end: input.policy.absentMinutesBeforeEnd, enabled: input.policy.enabled,
      expected_revision: input.expected_revision,
    })
    policy = { session_starts_local: parsed.session_starts_local, session_ends_local: parsed.session_ends_local,
      session_end_day_offset: parsed.session_end_day_offset, entry_opens_minutes_before: parsed.entry_opens_minutes_before,
      present_grace_minutes: parsed.present_grace_minutes, entry_closes_minutes_before_end: parsed.entry_closes_minutes_before_end,
      absent_minutes_before_end: parsed.absent_minutes_before_end }
    name = input.name
  }
  const { data, error } = await supabase.rpc('mutate_attendance_schedule_v1', {
    p_teacher_id: user.id, p_classroom_id: input.classroom_id, p_command: command,
    p_schedule_id: scheduleId, p_date: classDate, p_name: name, p_policy: policy,
    p_expected_revision: input.expected_revision,
  })
  if (error) {
    if (error.code === '40001' || error.code === '23514' || error.code === '23505') throw new ApiError(409, 'Attendance schedule changed or is already open; refresh and try again')
    if (error.code === '42501') throw new ApiError(403, 'Attendance schedule access denied')
    if (error.code === '22023') throw new ApiError(400, 'Invalid attendance schedule')
    throw new ApiError(503, 'Attendance schedules are temporarily unavailable')
  }
  return NextResponse.json(z.object({ id: id.nullable(), revision: z.number().int().safe().positive() }).strict().parse(data))
}

export const POST = withErrorHandler('PostTeacherAttendanceSchedule', request => mutate(request, 'upsert'))
export const PATCH = withErrorHandler('PatchTeacherAttendanceSchedule', request => mutate(request, 'upsert', true))
export const PUT = withErrorHandler('PutTeacherAttendanceSchedule', request => mutate(request, 'assign'))
