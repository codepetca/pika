import { NextResponse } from 'next/server'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import {
  executeStudentAttendanceCheckIn,
  StudentAttendanceCheckInError,
} from '@/lib/server/bara-attendance-student'
import { getServiceRoleClient } from '@/lib/supabase'
import { studentAttendanceCheckInSchema } from '@/lib/validations/student-attendance'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostStudentAttendanceCheckIn', async (request) => {
  const user = await requireRole('student')
  const { entryToken, attemptId } = studentAttendanceCheckInSchema.parse(await request.json())
  try {
    const result = await executeStudentAttendanceCheckIn({
      supabase: getServiceRoleClient(),
      pikaUser: user,
      entryToken,
      attemptId,
    })
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    })
  } catch (error) {
    if (error instanceof StudentAttendanceCheckInError) {
      if (error.code === 'invalid_entry') {
        return NextResponse.json({
          state: 'invalid',
          title: 'This attendance link is invalid',
          description: 'Ask your teacher to show the current attendance QR code.',
        }, { headers: { 'Cache-Control': 'no-store' } })
      }
      if (error.code === 'expired_entry') {
        return NextResponse.json({
          state: 'closed',
          title: 'Check-in is closed',
          description: 'Ask your teacher if your attendance needs to be corrected.',
        }, { headers: { 'Cache-Control': 'no-store' } })
      }
      if (error.code === 'identity_not_linked') {
        return NextResponse.json({
          state: 'needs_staff',
          title: 'Your teacher needs to help',
          description: 'Ask your teacher to check your Pika account and class roster.',
        }, { headers: { 'Cache-Control': 'no-store' } })
      }
      throw new ApiError(503, 'Attendance is temporarily unavailable')
    }
    throw error
  }
})
