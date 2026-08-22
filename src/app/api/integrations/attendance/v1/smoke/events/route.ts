import { NextRequest, NextResponse } from 'next/server'

import { withErrorHandler } from '@/lib/api-handler'
import { receiveBaraAttendanceSmokeCallback } from '@/lib/server/bara-attendance-smoke'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostAttendanceIntegrationSmokeEvent', async (request: NextRequest) => {
  const result = await receiveBaraAttendanceSmokeCallback(request)
  return NextResponse.json(result.ok ? { ok: true, authenticated: true } : { error: result.error }, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  })
})
