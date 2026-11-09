import { NextResponse } from 'next/server'
import { ApiError, withErrorHandler } from '@/lib/api-handler'

export function createBillingPortalHandler(deps: {
  configuration(): { appOrigin: string } | null
  authenticate(): Promise<{ id: string }>
  open(userId: string): Promise<string>
}) {
  const handler = withErrorHandler('BillingPortal', async request => {
    const config = deps.configuration()
    if (!config) throw new ApiError(404, 'Not found')
    const user = await deps.authenticate()
    if (request.headers.get('origin') !== config.appOrigin) throw new ApiError(403, 'Forbidden')
    // No request parameters are used to select the customer or return URL.
    let url: string
    try { url = await deps.open(user.id) } catch { throw new Error('Billing portal unavailable') }
    return NextResponse.json({ url })
  })
  return async (...args: Parameters<typeof handler>) => {
    const response = await handler(...args)
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }
}
