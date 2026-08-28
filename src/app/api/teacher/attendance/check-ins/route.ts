import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import {
  executeTeacherCheckInInvalidations,
  TeacherAttendanceCommandError,
} from '@/lib/server/bara-attendance-commands'
import { resolveVerifiedPikaAttendanceTeacher } from '@/lib/server/bara-attendance-teacher'
import { assertBaraAttendanceClassroomAccess } from '@/lib/server/bara-attendance-scope'
import { BaraAttendanceCanaryError } from '@/lib/server/bara-attendance-canary'
import { teacherAttendanceCheckInInvalidationSchema } from '@/lib/validations/teacher-attendance'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherAttendanceCheckInInvalidations', async (request) => {
  const user = await requireRole('teacher')
  const input = teacherAttendanceCheckInInvalidationSchema.parse(await request.json())
  const supabase = getServiceRoleClient()
  const ownership = await assertTeacherCanMutateClassroom(user.id, input.classroom_id, { supabase })
  if (!ownership.ok) throw new ApiError(ownership.status, ownership.error)
  try {
    await assertBaraAttendanceClassroomAccess({
      supabase, teacherId: user.id, classroomId: input.classroom_id,
    })
    const actor = await resolveVerifiedPikaAttendanceTeacher({ supabase, pikaUser: user })
    const result = await executeTeacherCheckInInvalidations({
      supabase, teacherId: user.id, classroomId: input.classroom_id,
      classDate: input.date, requestId: input.request_id,
      studentIds: input.student_ids, actor, integrationState: 'ready',
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof BaraAttendanceCanaryError) {
      throw new ApiError(error.code === 'disabled' ? 404 : 503, error.code === 'disabled'
        ? 'Attendance is not enabled for this classroom'
        : 'Attendance is temporarily unavailable')
    }
    if (error instanceof TeacherAttendanceCommandError) {
      if (error.code === 'conflict' || error.code === 'roster_changed') {
        throw new ApiError(409, 'Attendance changed; refresh and try again')
      }
      throw new ApiError(503, 'Attendance is temporarily unavailable')
    }
    throw error
  }
})
