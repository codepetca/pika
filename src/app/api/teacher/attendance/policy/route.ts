import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherCanMutateClassroom, assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import {
  loadTeacherAttendancePolicy,
  saveTeacherAttendancePolicy,
  TeacherAttendancePolicyError,
} from '@/lib/server/bara-attendance-policy'
import {
  teacherAttendancePolicyQuerySchema,
  teacherAttendancePolicyUpdateSchema,
} from '@/lib/validations/teacher-attendance-policy'
import {
  BaraAttendanceCanaryError,
} from '@/lib/server/bara-attendance-canary'
import { assertBaraAttendanceClassroomAccess } from '@/lib/server/bara-attendance-scope'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function mapPolicyError(error: unknown): never {
  if (error instanceof BaraAttendanceCanaryError) {
    throw new ApiError(error.code === 'disabled' ? 404 : 503, error.code === 'disabled'
      ? 'Attendance is not enabled for this classroom'
      : 'Attendance settings are temporarily unavailable')
  }
  if (error instanceof TeacherAttendancePolicyError) {
    if (error.code === 'conflict') {
      throw new ApiError(409, 'Attendance settings changed; refresh and try again')
    }
    throw new ApiError(503, 'Attendance settings are temporarily unavailable')
  }
  throw error
}

export const GET = withErrorHandler('GetTeacherAttendancePolicy', async (request) => {
  const user = await requireRole('teacher')
  const input = teacherAttendancePolicyQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  const supabase = getServiceRoleClient()
  const ownership = await assertTeacherOwnsClassroom(user.id, input.classroom_id, { supabase })
  if (!ownership.ok) throw new ApiError(ownership.status, ownership.error)
  if (ownership.classroom.archived_at) {
    throw new ApiError(403, 'Classroom is archived')
  }

  try {
    await assertBaraAttendanceClassroomAccess({
      supabase,
      teacherId: user.id,
      classroomId: input.classroom_id,
    })
    const policy = await loadTeacherAttendancePolicy({
      supabase,
      classroomId: input.classroom_id,
    })
    return NextResponse.json({ policy })
  } catch (error) {
    mapPolicyError(error)
  }
})

export const PUT = withErrorHandler('PutTeacherAttendancePolicy', async (request) => {
  const user = await requireRole('teacher')
  const input = teacherAttendancePolicyUpdateSchema.parse(await request.json())
  const supabase = getServiceRoleClient()
  const ownership = await assertTeacherCanMutateClassroom(user.id, input.classroom_id, { supabase })
  if (!ownership.ok) throw new ApiError(ownership.status, ownership.error)

  try {
    await assertBaraAttendanceClassroomAccess({
      supabase,
      teacherId: user.id,
      classroomId: input.classroom_id,
    })
    const policy = await saveTeacherAttendancePolicy({
      supabase,
      teacherId: user.id,
      classroomId: input.classroom_id,
      sessionStartsLocal: input.session_starts_local,
      sessionEndsLocal: input.session_ends_local,
      sessionEndDayOffset: input.session_end_day_offset,
      entryOpensMinutesBefore: input.entry_opens_minutes_before,
      presentGraceMinutes: input.present_grace_minutes,
      entryClosesMinutesBeforeEnd: input.entry_closes_minutes_before_end,
      absentMinutesBeforeEnd: input.absent_minutes_before_end,
      enabled: input.enabled,
      expectedRevision: input.expected_revision,
    })
    return NextResponse.json({ policy })
  } catch (error) {
    mapPolicyError(error)
  }
})
