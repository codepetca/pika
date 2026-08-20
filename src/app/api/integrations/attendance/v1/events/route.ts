import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { receiveBaraAttendanceEvent } from '@/lib/server/bara-attendance-events'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostAttendanceIntegrationEvent', async (request: NextRequest) => {
  const result = await receiveBaraAttendanceEvent(request)
  return NextResponse.json(result.ok ? result.value : { error: result.error }, {
    status: result.status,
    headers: {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })
})
