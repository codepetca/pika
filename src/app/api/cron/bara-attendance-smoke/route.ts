import { NextRequest, NextResponse } from 'next/server'

import { withErrorHandler } from '@/lib/api-handler'
import { runBaraAttendanceSmoke } from '@/lib/server/bara-attendance-smoke'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 30

export const POST = withErrorHandler('PostBaraAttendanceSmoke', async (request: NextRequest) => {
  const operatorSecret = process.env.BARA_ATTENDANCE_SMOKE_OPERATOR_SECRET
  const conflictingSecrets = [
    process.env.CRON_SECRET,
    process.env.BARA_ATTENDANCE_INTEGRATION_SECRET,
    process.env.BARA_ATTENDANCE_EVENT_SECRET,
  ].filter((value): value is string => Boolean(value))
  if (!operatorSecret || operatorSecret.length < 32 || conflictingSecrets.includes(operatorSecret)) {
    return NextResponse.json({ error: 'Smoke operator authentication not configured' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${operatorSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runBaraAttendanceSmoke()
  return NextResponse.json(result, {
    status: result.status === 'failed' ? 503 : 200,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  })
})
