import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  applyResponseHeaders,
  authkit,
  partitionAuthkitHeaders,
} from '@workos-inc/authkit-nextjs'
import { getRequestPath, PIKA_REQUEST_PATH_HEADER } from '@/lib/auth-redirect'

function withTrustedRequestPath(headers: Headers, request: NextRequest): Headers {
  const requestHeaders = new Headers(headers)
  requestHeaders.delete(PIKA_REQUEST_PATH_HEADER)
  requestHeaders.set(PIKA_REQUEST_PATH_HEADER, getRequestPath(request.nextUrl))
  return requestHeaders
}

export default async function middleware(request: NextRequest) {
  if (process.env.WORKOS_MAGIC_AUTH_PILOT !== 'true') {
    return NextResponse.next({
      request: { headers: withTrustedRequestPath(request.headers, request) },
    })
  }

  const { headers } = await authkit(request)
  const partitioned = partitionAuthkitHeaders(request, headers)
  const response = NextResponse.next({
    request: {
      headers: withTrustedRequestPath(partitioned.requestHeaders, request),
    },
  })
  return applyResponseHeaders(response, partitioned.responseHeaders)
}

export const config = {
  matcher: [
    '/((?!_next/static(?:/|$)|_next/image(?:/|$)|(?:favicon\\.ico|pika-icon-(?:light|dark)\\.svg)$).*)',
  ],
}
