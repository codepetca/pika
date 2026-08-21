import type { NextFetchEvent, NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authkitMiddleware } from '@workos-inc/authkit-nextjs'

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  if (process.env.WORKOS_MAGIC_AUTH_PILOT !== 'true') {
    return NextResponse.next()
  }

  return authkitMiddleware()(request, event)
}

export const config = {
  matcher: [
    '/((?!_next/static(?:/|$)|_next/image(?:/|$)|(?:favicon\\.ico|pika-icon-(?:light|dark)\\.svg)$).*)',
  ],
}
