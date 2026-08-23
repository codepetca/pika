import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import {
  executeTeacherAttendanceMarks,
  TeacherAttendanceCommandError,
} from '@/lib/server/bara-attendance-commands'
import { teacherAttendanceMarksSchema } from '@/lib/validations/teacher-attendance'
import {
  resolveVerifiedPikaAttendanceTeacher,
  TeacherAttendanceIdentityError,
} from '@/lib/server/bara-attendance-teacher'
import {
  BaraAttendanceCanaryError,
} from '@/lib/server/bara-attendance-canary'
import { assertBaraAttendanceClassroomAccess } from '@/lib/server/bara-attendance-scope'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function mapCommandError(error: unknown): never {
  if (error instanceof BaraAttendanceCanaryError) {
    throw new ApiError(error.code === 'disabled' ? 404 : 503, error.code === 'disabled'
      ? 'Attendance is not enabled for this classroom'
      : 'Attendance is temporarily unavailable')
  }
  if (error instanceof TeacherAttendanceIdentityError) {
    if (error.code === 'identity_not_linked') {
      throw new ApiError(409, 'Attendance identity is not linked')
    }
    throw new ApiError(503, 'Attendance is temporarily unavailable')
  }
  if (error instanceof TeacherAttendanceCommandError) {
    if (error.code === 'identity_not_linked') {
      throw new ApiError(409, 'Attendance identity is not linked')
    }
    if (error.code === 'roster_changed' || error.code === 'conflict') {
      throw new ApiError(409, 'Attendance changed; refresh and try again')
    }
    throw new ApiError(503, 'Attendance is temporarily unavailable')
  }
  throw error
}

export const POST = withErrorHandler('PostTeacherAttendanceMarks', async (request) => {
  const user = await requireRole('teacher')
  const input = teacherAttendanceMarksSchema.parse(await request.json())
  const supabase = getServiceRoleClient()
  const ownership = await assertTeacherCanMutateClassroom(user.id, input.classroom_id, { supabase })
  if (!ownership.ok) throw new ApiError(ownership.status, ownership.error)

  try {
    await assertBaraAttendanceClassroomAccess({
      supabase,
      teacherId: user.id,
      classroomId: input.classroom_id,
    })
    const actor = await resolveVerifiedPikaAttendanceTeacher({ supabase, pikaUser: user })
    const result = await executeTeacherAttendanceMarks({
      supabase,
      teacherId: user.id,
      classroomId: input.classroom_id,
      classDate: input.date,
      requestId: input.request_id,
      actor,
      integrationState: 'ready',
      marks: input.marks.map((mark) => ({
        studentId: mark.student_id,
        status: mark.status,
        ...(mark.reason_code ? { reasonCode: mark.reason_code } : {}),
      })),
    })
    return NextResponse.json(result)
  } catch (error) {
    mapCommandError(error)
  }
})
