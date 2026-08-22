import { NextRequest, NextResponse } from 'next/server'

import { withErrorHandler } from '@/lib/api-handler'
import {
  BaraAttendanceAutomationError,
  syncBaraAttendanceSchedules,
} from '@/lib/server/bara-attendance-automation'
import { getBaraAttendanceCanaryScope } from '@/lib/server/bara-attendance-canary'
import {
  deliverBaraAttendanceOutboxBatch,
  getBaraAttendanceOutboxHealth,
} from '@/lib/server/bara-attendance-outbox'
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

  const supabase = getServiceRoleClient()
  const scope = getBaraAttendanceCanaryScope()
  try {
    const schedules = await syncBaraAttendanceSchedules({
      supabase,
      integrationState: scope.state,
      teacherId: scope.teacherId ?? undefined,
      classroomId: scope.classroomId ?? undefined,
    })
    const delivery = await deliverBaraAttendanceOutboxBatch({
      supabase,
      enabled: scope.state === 'ready',
      teacherId: scope.teacherId,
      classroomId: scope.classroomId,
      limit: 50,
    })
    const health = await getBaraAttendanceOutboxHealth({
      supabase,
      enabled: scope.state === 'ready',
      teacherId: scope.teacherId,
      classroomId: scope.classroomId,
    })
    const status = schedules.status === 'partial'
      || delivery.status === 'partial'
      || health.status === 'degraded'
      ? 'partial'
      : schedules.status

    return NextResponse.json({ status, schedules, delivery, health }, {
      status: status === 'partial' ? 503 : 200,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    if (error instanceof BaraAttendanceAutomationError) {
      return NextResponse.json({
        status: 'error',
        error: error.code,
      }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }
    throw error
  }
}

export const GET = withErrorHandler('GetBaraAttendanceAutomation', handle)
export const POST = withErrorHandler('PostBaraAttendanceAutomation', handle)
