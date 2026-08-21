import { NextResponse } from 'next/server'

import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import {
  BaraAttendanceSyncError,
  syncTeacherAttendanceSources,
} from '@/lib/server/bara-attendance-sync'
import { getServiceRoleClient } from '@/lib/supabase'
import { teacherAttendanceSyncSchema } from '@/lib/validations/teacher-attendance'
import {
  resolveVerifiedPikaAttendanceTeacher,
  TeacherAttendanceIdentityError,
} from '@/lib/server/bara-attendance-teacher'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherAttendanceSync', async (request) => {
  const user = await requireRole('teacher')
  const input = teacherAttendanceSyncSchema.parse(await request.json())
  const supabase = getServiceRoleClient()
  const ownership = await assertTeacherCanMutateClassroom(
    user.id,
    input.classroom_id,
    { supabase },
  )
  if (!ownership.ok) throw new ApiError(ownership.status, ownership.error)

  try {
    const actor = await resolveVerifiedPikaAttendanceTeacher({ supabase, pikaUser: user })
    return NextResponse.json(await syncTeacherAttendanceSources({
      supabase,
      teacherId: user.id,
      classroomId: input.classroom_id,
      windowStart: input.window_start,
      windowEnd: input.window_end,
      verifiedActor: actor,
    }))
  } catch (error) {
    if (error instanceof TeacherAttendanceIdentityError) {
      if (error.code === 'identity_not_linked') {
        throw new ApiError(409, 'Attendance identity is not linked')
      }
      throw new ApiError(503, 'Attendance is temporarily unavailable')
    }
    if (error instanceof BaraAttendanceSyncError) {
      if (error.code === 'identity_not_linked') {
        throw new ApiError(409, 'Attendance identity is not linked')
      }
      if (error.code === 'source_changed') {
        throw new ApiError(409, 'Attendance source changed; retry the sync')
      }
      if (error.code === 'policy_missing') {
        throw new ApiError(409, 'Configure the attendance window before syncing')
      }
      throw new ApiError(503, 'Attendance is temporarily unavailable')
    }
    throw error
  }
})
