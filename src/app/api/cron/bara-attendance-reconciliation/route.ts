import { NextRequest, NextResponse } from 'next/server'

import { withErrorHandler } from '@/lib/api-handler'
import {
  assertBaraAttendanceCanaryClassroomOwner,
  BaraAttendanceCanaryError,
} from '@/lib/server/bara-attendance-canary'
import { getBaraAttendanceWorkerScope } from '@/lib/server/bara-attendance-scope'
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

  const scope = getBaraAttendanceWorkerScope()
  const supabase = getServiceRoleClient()
  if (scope.mode === 'exact_canary' && scope.state === 'ready' && scope.classroomId) {
    try {
      await assertBaraAttendanceCanaryClassroomOwner({
        supabase,
        classroomId: scope.classroomId,
      })
    } catch (error) {
      if (error instanceof BaraAttendanceCanaryError) {
        return NextResponse.json({ status: 'error', error: 'not_configured' }, {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        })
      }
      throw error
    }
  }
  const summary = await reconcileBaraAttendanceSessions({
    supabase,
    enabled: scope.state === 'ready',
    teacherId: scope.teacherId,
    classroomId: scope.classroomId,
    scopeMode: scope.mode,
  })
  return NextResponse.json(summary, {
    status: summary.status === 'partial' ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export const GET = withErrorHandler('GetBaraAttendanceReconciliation', handle)
export const POST = withErrorHandler('PostBaraAttendanceReconciliation', handle)
