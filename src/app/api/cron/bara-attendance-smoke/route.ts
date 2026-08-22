import { NextRequest, NextResponse } from 'next/server'

import { withErrorHandler } from '@/lib/api-handler'
import { runBaraAttendanceSmoke } from '@/lib/server/bara-attendance-smoke'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 30

export const POST = withErrorHandler('PostBaraAttendanceSmoke', async (request: NextRequest) => {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runBaraAttendanceSmoke()
  return NextResponse.json(result, {
    status: result.status === 'failed' ? 503 : 200,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  })
})
