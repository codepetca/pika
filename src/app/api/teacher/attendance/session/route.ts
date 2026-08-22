import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherCanMutateClassroom, assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import {
  assertBaraAttendanceCanaryClassroom,
  BaraAttendanceCanaryError,
  getBaraAttendanceClassroomIntegrationState,
} from '@/lib/server/bara-attendance-canary'
import {
  loadTeacherAttendanceView,
  TeacherAttendanceViewReadError,
} from '@/lib/server/bara-attendance-view'
import { teacherAttendanceViewQuerySchema } from '@/lib/validations/teacher-attendance'
import { teacherAttendanceSessionCommandSchema } from '@/lib/validations/teacher-attendance'
import {
  executeTeacherAttendanceSessionCommand,
  TeacherAttendanceCommandError,
} from '@/lib/server/bara-attendance-commands'
import {
  resolveVerifiedPikaAttendanceTeacher,
  TeacherAttendanceIdentityError,
} from '@/lib/server/bara-attendance-teacher'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetTeacherAttendanceSession', async (request) => {
  const user = await requireRole('teacher')
  const input = teacherAttendanceViewQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  const supabase = getServiceRoleClient()
  const ownership = await assertTeacherOwnsClassroom(user.id, input.classroom_id, { supabase })
  if (!ownership.ok) throw new ApiError(ownership.status, ownership.error)

  try {
    const view = await loadTeacherAttendanceView({
      supabase,
      classroomId: input.classroom_id,
      classDate: input.date,
      integration: getBaraAttendanceClassroomIntegrationState({
        teacherId: user.id,
        classroomId: input.classroom_id,
      }),
    })
    return NextResponse.json(view)
  } catch (error) {
    if (error instanceof TeacherAttendanceViewReadError) {
      throw new ApiError(503, 'Attendance is temporarily unavailable')
    }
    throw error
  }
})

function mapCommandError(error: unknown): never {
  if (error instanceof BaraAttendanceCanaryError) {
    throw new ApiError(
      error.code === 'disabled' ? 404 : 503,
      error.code === 'disabled'
        ? 'Attendance is not enabled for this classroom'
        : 'Attendance is temporarily unavailable',
    )
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

export const POST = withErrorHandler('PostTeacherAttendanceSession', async (request) => {
  const user = await requireRole('teacher')
  const input = teacherAttendanceSessionCommandSchema.parse(await request.json())
  const supabase = getServiceRoleClient()
  const ownership = await assertTeacherCanMutateClassroom(user.id, input.classroom_id, { supabase })
  if (!ownership.ok) throw new ApiError(ownership.status, ownership.error)

  try {
    assertBaraAttendanceCanaryClassroom({
      teacherId: user.id,
      classroomId: input.classroom_id,
    })
    const actor = await resolveVerifiedPikaAttendanceTeacher({ supabase, pikaUser: user })
    const result = await executeTeacherAttendanceSessionCommand({
      supabase,
      teacherId: user.id,
      classroomId: input.classroom_id,
      classDate: input.date,
      requestId: input.request_id,
      command: input.command,
      actor,
    })
    return NextResponse.json(result)
  } catch (error) {
    mapCommandError(error)
  }
})
