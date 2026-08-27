import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { clearPendingWorkOSMagicAuth } from '@/lib/server/workos-magic-pending'
import { requireWorkOSMagicAuth } from '@/lib/server/workos-config'

export const DELETE = withErrorHandler('ClearPendingWorkOSMagicAuth', async () => {
  requireWorkOSMagicAuth()
  await clearPendingWorkOSMagicAuth()
  return new NextResponse(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store' },
  })
})
