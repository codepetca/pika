import { NextResponse } from 'next/server'

import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import {
  loadStudentAttendanceStatusView,
  StudentAttendanceStatusReadError,
} from '@/lib/server/bara-attendance-student-view'
import { getServiceRoleClient } from '@/lib/supabase'
import { authorizeSharedAttendancePolicyActor } from '@/lib/server/contextual-attendance-policy'
import { loadContextualStudentAttendanceStatus } from '@/lib/server/contextual-student-attendance'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function privateStudentHeaders(studentId: string) {
  return {
    'Cache-Control': 'private, no-store',
    'X-Pika-Student-Id': studentId,
  }
}

export const GET = withErrorHandler('GetStudentAttendanceStatus', async () => {
  const admission = await authorizeSharedAttendancePolicyActor()
  const user = admission.mode === 'shared' ? admission.user : await requireRole('student')
  try {
    const view = await (admission.mode === 'shared' ? loadContextualStudentAttendanceStatus : loadStudentAttendanceStatusView)({
      supabase: getServiceRoleClient(),
      studentId: user.id,
    })
    return NextResponse.json(view, {
      headers: privateStudentHeaders(user.id),
    })
  } catch (error) {
    if (error instanceof StudentAttendanceStatusReadError || (error instanceof ApiError && error.statusCode === 503)) {
      return NextResponse.json(
        { error: 'Attendance status is temporarily unavailable' },
        { status: 503, headers: privateStudentHeaders(user.id) },
      )
    }
    throw error
  }
})
