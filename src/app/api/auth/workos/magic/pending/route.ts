import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { clearPendingWorkOSMagicAuth } from '@/lib/server/workos-magic-pending'
import { requireWorkOSMagicAuthPilot } from '@/lib/server/workos-pilot'

export const DELETE = withErrorHandler('ClearPendingWorkOSMagicAuth', async () => {
  requireWorkOSMagicAuthPilot()
  await clearPendingWorkOSMagicAuth()
  return new NextResponse(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store' },
  })
})
