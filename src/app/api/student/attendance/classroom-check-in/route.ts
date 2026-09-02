import { NextResponse } from 'next/server'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import {
  ClassroomAttendanceQrError,
  executeClassroomQrStudentCheckIn,
} from '@/lib/server/classroom-attendance-qr'
import { StudentAttendanceCheckInError } from '@/lib/server/bara-attendance-student'
import { getServiceRoleClient } from '@/lib/supabase'
import { studentClassroomAttendanceCheckInSchema } from '@/lib/validations/student-attendance'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function result(state: 'invalid' | 'closed' | 'needs_staff', title: string, description: string) {
  return NextResponse.json({ state, title, description }, {
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  })
}

export const POST = withErrorHandler('PostStudentClassroomAttendanceCheckIn', async (request) => {
  const user = await requireRole('student')
  const { classroomQrToken, attemptId } = studentClassroomAttendanceCheckInSchema.parse(
    await request.json(),
  )
  try {
    const checkIn = await executeClassroomQrStudentCheckIn({
      supabase: getServiceRoleClient(),
      pikaUser: user,
      classroomQrToken,
      attemptId,
    })
    return NextResponse.json(checkIn, {
      headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    })
  } catch (error) {
    if (error instanceof ClassroomAttendanceQrError) {
      if (error.code === 'invalid_or_revoked') {
        return result(
          'invalid',
          'This classroom QR is no longer valid',
          'Ask your teacher for the current classroom attendance poster.',
        )
      }
      if (error.code === 'not_open') {
        return result(
          'closed',
          'Attendance is not open',
          'This classroom poster works when your teacher opens attendance.',
        )
      }
      if (error.code === 'not_enrolled') {
        return result(
          'needs_staff',
          'Your teacher needs to help',
          'This signed-in account is not on the attendance roster for this classroom.',
        )
      }
      throw new ApiError(503, 'Attendance is temporarily unavailable')
    }
    if (error instanceof StudentAttendanceCheckInError) {
      if (error.code === 'identity_not_linked') {
        return result(
          'needs_staff',
          'Your teacher needs to help',
          'Ask your teacher to check your Pika account and class roster.',
        )
      }
      throw new ApiError(503, 'Attendance is temporarily unavailable')
    }
    throw error
  }
})
