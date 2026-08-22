import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { withErrorHandler } from '@/lib/api-handler'
import { auditDeployedBaraAttendanceEnvironment } from '@/lib/server/bara-attendance-deployed-preflight'
import { runBaraAttendanceSmoke } from '@/lib/server/bara-attendance-smoke'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 30

const rolloutModeSchema = z.enum(['pre-enable', 'enabled'])
const privateResponseHeaders = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
}

function unauthorizedResponse() {
  return NextResponse.json(
    { error: 'Unauthorized' },
    { status: 401, headers: privateResponseHeaders },
  )
}

export const POST = withErrorHandler('PostBaraAttendanceSmoke', async (request: NextRequest) => {
  const operatorSecret = process.env.BARA_ATTENDANCE_SMOKE_OPERATOR_SECRET
  const conflictingSecrets = [
    process.env.CRON_SECRET,
    process.env.BARA_ATTENDANCE_INTEGRATION_SECRET,
    process.env.BARA_ATTENDANCE_EVENT_SECRET,
  ].filter((value): value is string => Boolean(value))
  if (!operatorSecret || operatorSecret.length < 32 || conflictingSecrets.includes(operatorSecret)) {
    return unauthorizedResponse()
  }
  if (request.headers.get('authorization') !== `Bearer ${operatorSecret}`) {
    return unauthorizedResponse()
  }
  const rolloutMode = rolloutModeSchema.safeParse(
    request.headers.get('x-attendance-rollout-mode'),
  )
  if (!rolloutMode.success) {
    return NextResponse.json({ error: 'Invalid rollout mode' }, { status: 400 })
  }
  const deployedPreflight = auditDeployedBaraAttendanceEnvironment(rolloutMode.data)
  if (!deployedPreflight.ready) {
    return NextResponse.json({
      error: 'Deployed attendance preflight failed',
      failedChecks: deployedPreflight.failedChecks,
      passedCount: deployedPreflight.passedCount,
      checkCount: deployedPreflight.checkCount,
    }, {
      status: 503,
      headers: privateResponseHeaders,
    })
  }
  const result = await runBaraAttendanceSmoke({ attendanceMode: rolloutMode.data })
  return NextResponse.json(result, {
    status: result.status === 'failed' ? 503 : 200,
    headers: privateResponseHeaders,
  })
})
