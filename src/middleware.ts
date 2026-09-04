import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  applyResponseHeaders,
  authkit,
  partitionAuthkitHeaders,
} from '@workos-inc/authkit-nextjs'
import { getRequestPath, PIKA_REQUEST_PATH_HEADER } from '@/lib/auth-redirect'
import {
  createContentSecurityPolicy,
  createCspNonce,
  getBrowserSecurityEnvironment,
} from '@/lib/browser-security'

const CSP_NONCE_REQUEST_HEADER = 'x-nonce'

function withTrustedRequestHeaders(
  headers: Headers,
  request: NextRequest,
  contentSecurityPolicy: string,
  nonce: string,
): Headers {
  const requestHeaders = new Headers(headers)
  requestHeaders.delete(PIKA_REQUEST_PATH_HEADER)
  requestHeaders.delete(CSP_NONCE_REQUEST_HEADER)
  requestHeaders.delete('content-security-policy')
  requestHeaders.set(PIKA_REQUEST_PATH_HEADER, getRequestPath(request.nextUrl))
  requestHeaders.set(CSP_NONCE_REQUEST_HEADER, nonce)
  requestHeaders.set('content-security-policy', contentSecurityPolicy)
  return requestHeaders
}

function applyContentSecurityPolicy(response: NextResponse, value: string): NextResponse {
  response.headers.set('Content-Security-Policy', value)
  return response
}

export default async function middleware(request: NextRequest) {
  const nonce = createCspNonce()
  const contentSecurityPolicy = createContentSecurityPolicy(
    nonce,
    getBrowserSecurityEnvironment(),
  )

  if (process.env.WORKOS_MAGIC_AUTH_PILOT !== 'true') {
    return applyContentSecurityPolicy(
      NextResponse.next({
        request: {
          headers: withTrustedRequestHeaders(
            request.headers,
            request,
            contentSecurityPolicy,
            nonce,
          ),
        },
      }),
      contentSecurityPolicy,
    )
  }

  const { headers } = await authkit(request)
  const partitioned = partitionAuthkitHeaders(request, headers)
  const response = NextResponse.next({
    request: {
      headers: withTrustedRequestHeaders(
        partitioned.requestHeaders,
        request,
        contentSecurityPolicy,
        nonce,
      ),
    },
  })
  return applyContentSecurityPolicy(
    applyResponseHeaders(response, partitioned.responseHeaders),
    contentSecurityPolicy,
  )
}

export const config = {
  matcher: [
    '/((?!_next/static(?:/|$)|_next/image(?:/|$)|(?:favicon\\.ico|pika-icon-(?:light|dark)\\.svg)$).*)',
  ],
}
