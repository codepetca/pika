import type { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-handler'
import { requireSameOriginPost } from '@/lib/server/workos-logout'

/** Browser logins must be same-origin JSON; pika CLI sends JSON without Origin. */
export function requirePasswordLoginRequest(request: NextRequest): void {
  const origin = request.headers.get('origin')
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') {
    throw new ApiError(403, 'Invalid request origin')
  }
  if (origin !== null) {
    // Retains the repository's private-browser Origin:null + same-origin policy.
    requireSameOriginPost(request)
  }
  // An absent Origin is deliberate compatibility for scripts/pika-api.ts and
  // headless tests. JSON cannot be submitted by a cross-site simple HTML form.
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw new ApiError(415, 'Content-Type must be application/json')
  }
}
