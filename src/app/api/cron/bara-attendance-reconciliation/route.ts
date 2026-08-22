import { NextRequest, NextResponse } from 'next/server'

import { withErrorHandler } from '@/lib/api-handler'
import { getBaraAttendanceCanaryScope } from '@/lib/server/bara-attendance-canary'
import { reconcileBaraAttendanceSessions } from '@/lib/server/bara-attendance-reconciliation'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

async function handle(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const scope = getBaraAttendanceCanaryScope()
  const summary = await reconcileBaraAttendanceSessions({
    supabase: getServiceRoleClient(),
    enabled: scope.state === 'ready',
    teacherId: scope.teacherId,
    classroomId: scope.classroomId,
  })
  return NextResponse.json(summary, {
    status: summary.status === 'partial' ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export const GET = withErrorHandler('GetBaraAttendanceReconciliation', handle)
export const POST = withErrorHandler('PostBaraAttendanceReconciliation', handle)
