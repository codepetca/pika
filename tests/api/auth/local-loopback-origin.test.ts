import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { requireSameOriginPost } from '@/lib/server/workos-logout'

function request(origin: string, host: string) {
  return new NextRequest('http://localhost:3002/api/auth/login', {
    method: 'POST', headers: { origin, host, 'sec-fetch-site': 'same-origin' },
  })
}

describe('local loopback origin', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('accepts the exact loopback host and port in development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(() => requireSameOriginPost(request('http://127.0.0.1:3002', '127.0.0.1:3002'))).not.toThrow()
  })

  it('rejects a different origin or port in development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(() => requireSameOriginPost(request('http://127.0.0.1:3003', '127.0.0.1:3002'))).toThrow()
    expect(() => requireSameOriginPost(request('http://evil.example:3002', '127.0.0.1:3002'))).toThrow()
  })

  it('rejects rewritten host, scheme, port, and cross-site metadata', () => {
    vi.stubEnv('NODE_ENV', 'development')
    const headers = { origin: 'http://127.0.0.1:3002', host: '127.0.0.1:3002' }
    for (const url of ['http://example.test:3002/path', 'https://localhost:3002/path', 'http://localhost:3003/path']) {
      expect(() => requireSameOriginPost(new NextRequest(url, { method: 'POST', headers }))).toThrow()
    }
    for (const fetchSite of ['cross-site', 'none']) {
      expect(() => requireSameOriginPost(new NextRequest('http://localhost:3002/path', {
        method: 'POST', headers: { ...headers, 'sec-fetch-site': fetchSite },
      }))).toThrow()
    }
    expect(() => requireSameOriginPost(new NextRequest('http://localhost:3002/path', { method: 'POST', headers }))).toThrow()
  })

  it('does not enable the exception in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => requireSameOriginPost(request('http://127.0.0.1:3002', '127.0.0.1:3002'))).toThrow()
  })
})
