import { NextResponse } from 'next/server'

import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import {
  loadStudentAttendanceStatusView,
  StudentAttendanceStatusReadError,
} from '@/lib/server/bara-attendance-student-view'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetStudentAttendanceStatus', async () => {
  const user = await requireRole('student')
  try {
    const view = await loadStudentAttendanceStatusView({
      supabase: getServiceRoleClient(),
      studentId: user.id,
    })
    return NextResponse.json(view, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    if (error instanceof StudentAttendanceStatusReadError) {
      return NextResponse.json(
        { error: 'Attendance status is temporarily unavailable' },
        { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
      )
    }
    throw error
  }
})
