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
const TEST_DOCUMENT_SNAPSHOT_PATH = /^\/api\/(?:student|teacher)\/tests\/[^/]+\/documents\/[^/]+\/snapshot\/?$/

function routeOwnsContentSecurityPolicy(pathname: string): boolean {
  return TEST_DOCUMENT_SNAPSHOT_PATH.test(pathname)
}

function withTrustedRequestHeaders(
  headers: Headers,
  request: NextRequest,
  browserPolicy: { value: string; nonce: string } | null,
): Headers {
  const requestHeaders = new Headers(headers)
  requestHeaders.delete(PIKA_REQUEST_PATH_HEADER)
  requestHeaders.delete(CSP_NONCE_REQUEST_HEADER)
  requestHeaders.delete('content-security-policy')
  requestHeaders.set(PIKA_REQUEST_PATH_HEADER, getRequestPath(request.nextUrl))
  if (browserPolicy) {
    requestHeaders.set(CSP_NONCE_REQUEST_HEADER, browserPolicy.nonce)
    requestHeaders.set('content-security-policy', browserPolicy.value)
  }
  return requestHeaders
}

function applyContentSecurityPolicy(
  response: NextResponse,
  browserPolicy: { value: string } | null,
): NextResponse {
  if (browserPolicy) {
    response.headers.set('Content-Security-Policy', browserPolicy.value)
  }
  return response
}

export default async function middleware(request: NextRequest) {
  const browserPolicy = routeOwnsContentSecurityPolicy(request.nextUrl.pathname)
    ? null
    : (() => {
      const nonce = createCspNonce()
      return {
        nonce,
        value: createContentSecurityPolicy(nonce, getBrowserSecurityEnvironment()),
      }
    })()

  if (process.env.WORKOS_MAGIC_AUTH_PILOT !== 'true') {
    return applyContentSecurityPolicy(
      NextResponse.next({
        request: {
          headers: withTrustedRequestHeaders(
            request.headers,
            request,
            browserPolicy,
          ),
        },
      }),
      browserPolicy,
    )
  }

  const { headers } = await authkit(request)
  const partitioned = partitionAuthkitHeaders(request, headers)
  const response = NextResponse.next({
    request: {
      headers: withTrustedRequestHeaders(
        partitioned.requestHeaders,
        request,
        browserPolicy,
      ),
    },
  })
  return applyContentSecurityPolicy(
    applyResponseHeaders(response, partitioned.responseHeaders),
    browserPolicy,
  )
}

export const config = {
  matcher: [
    '/((?!_next/static/|_next/image$|(?:favicon\\.ico|pika-icon-(?:light|dark)\\.svg)$).*)',
  ],
}
