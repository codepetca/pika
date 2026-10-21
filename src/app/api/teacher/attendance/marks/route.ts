import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import {
  executeTeacherAttendanceMarks,
  TeacherAttendanceCommandError,
} from '@/lib/server/bara-attendance-commands'
import { teacherAttendanceMarksSchema, teacherAttendanceMembershipMarksSchema } from '@/lib/validations/teacher-attendance'
import { authorizeSharedAttendancePolicyActor } from '@/lib/server/contextual-attendance-policy'
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
  const admission = await authorizeSharedAttendancePolicyActor()
  const user = admission.mode === 'shared' ? admission.user : await requireRole('teacher')
  const input = admission.mode === 'shared'
    ? teacherAttendanceMembershipMarksSchema.parse(await request.json())
    : teacherAttendanceMarksSchema.parse(await request.json())
  const supabase = getServiceRoleClient()
  const ownership = await assertTeacherCanMutateClassroom(user.id, input.classroom_id, { supabase })
  if (!ownership.ok) throw new ApiError(ownership.status, ownership.error)

  try {
    await assertBaraAttendanceClassroomAccess({
      supabase,
      teacherId: user.id,
      classroomId: input.classroom_id,
    })
    const result = await executeTeacherAttendanceMarks({
      supabase,
      teacherId: user.id,
      classroomId: input.classroom_id,
      classDate: input.date,
      requestId: input.request_id,
      integrationState: 'ready',
      ...(admission.mode === 'shared' ? { membershipAware: true as const } : {}),
      marks: input.marks.map((mark) => ({
        studentId: mark.student_id,
        ...('expected_generation_id' in mark && typeof mark.expected_generation_id === 'string'
          ? { expectedGenerationId: mark.expected_generation_id } : {}),
        status: mark.status,
        ...(mark.reason_code ? { reasonCode: mark.reason_code } : {}),
      })),
    })
    return NextResponse.json(result)
  } catch (error) {
    mapCommandError(error)
  }
})
