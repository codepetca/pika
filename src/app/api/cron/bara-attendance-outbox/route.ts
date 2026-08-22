import { NextRequest, NextResponse } from 'next/server'

import { withErrorHandler } from '@/lib/api-handler'
import {
  assertBaraAttendanceCanaryClassroomOwner,
  BaraAttendanceCanaryError,
  getBaraAttendanceCanaryScope,
} from '@/lib/server/bara-attendance-canary'
import {
  deliverBaraAttendanceOutboxBatch,
  getBaraAttendanceOutboxHealth,
} from '@/lib/server/bara-attendance-outbox'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

export const POST = withErrorHandler(
  'PostBaraAttendanceOutboxDelivery',
  async (request: NextRequest) => {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
    }
    if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getServiceRoleClient()
    const scope = getBaraAttendanceCanaryScope()
    const enabled = scope.state === 'ready'
    if (enabled && scope.classroomId) {
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
    const delivery = await deliverBaraAttendanceOutboxBatch({
      supabase,
      enabled,
      teacherId: scope.teacherId,
      classroomId: scope.classroomId,
    })
    const health = await getBaraAttendanceOutboxHealth({
      supabase,
      enabled,
      teacherId: scope.teacherId,
      classroomId: scope.classroomId,
    })
    const status = delivery.status === 'partial' || health.status === 'degraded'
      ? 'partial'
      : delivery.status

    return NextResponse.json({ status, delivery, health }, {
      status: status === 'partial' ? 503 : 200,
      headers: { 'Cache-Control': 'no-store' },
    })
  },
)
