import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import {
  loadTeacherAttendanceQrPresentation,
  TeacherAttendanceQrError,
} from '@/lib/server/bara-attendance-qr'
import { teacherAttendanceViewQuerySchema } from '@/lib/validations/teacher-attendance'
import {
  resolveVerifiedPikaAttendanceTeacher,
  TeacherAttendanceIdentityError,
} from '@/lib/server/bara-attendance-teacher'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function mapQrError(error: unknown): never {
  if (error instanceof TeacherAttendanceIdentityError) {
    if (error.code === 'identity_not_linked') {
      throw new ApiError(409, 'Attendance setup is still syncing. Try again shortly')
    }
    throw new ApiError(503, 'Attendance is temporarily unavailable')
  }
  if (error instanceof TeacherAttendanceQrError) {
    if (error.code === 'identity_not_linked') {
      throw new ApiError(409, 'Attendance setup is still syncing. Try again shortly')
    }
    if (error.code === 'mapping_missing') {
      throw new ApiError(409, 'Attendance is not scheduled for this date')
    }
    if (error.code === 'session_not_open') {
      throw new ApiError(409, 'Open attendance before showing the QR code')
    }
    throw new ApiError(503, 'Attendance is temporarily unavailable')
  }
  throw error
}

export const GET = withErrorHandler('GetTeacherAttendanceQr', async (request) => {
  const user = await requireRole('teacher')
  const input = teacherAttendanceViewQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  const supabase = getServiceRoleClient()
  const ownership = await assertTeacherOwnsClassroom(user.id, input.classroom_id, { supabase })
  if (!ownership.ok) throw new ApiError(ownership.status, ownership.error)

  try {
    const actor = await resolveVerifiedPikaAttendanceTeacher({ supabase, pikaUser: user })
    const presentation = await loadTeacherAttendanceQrPresentation({
      supabase,
      teacherId: user.id,
      classroomId: input.classroom_id,
      classDate: input.date,
      requestId: crypto.randomUUID(),
      actor,
    })
    return NextResponse.json(presentation, {
      headers: {
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    })
  } catch (error) {
    mapQrError(error)
  }
})
