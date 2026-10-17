import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { NextRequest } from 'next/server'
// The installed Next implementation is exercised without constructing a server,
// touching a database, binding a socket, or applying an app/source overlay.
const { startContextualTestVerticalApp } = require('../../scripts/contextual-test-vertical-app.cjs')
const NextServer = require('next/dist/server/next-server').default
const { NodeNextRequest } = require('next/dist/server/base-http/node')
const { NextRequestAdapter } = require('next/dist/server/web/spec-extension/adapters/next-request')

function adaptedOrigin(hostname: string, port: number, origin: string): NextRequest {
  const raw = Object.assign(new PassThrough(), { method: 'POST', url: '/api/auth/login',
    headers: { host: 'localhost:3117', origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin',
      'x-forwarded-host': 'localhost:3117', 'x-forwarded-port': '3117', 'x-forwarded-proto': 'http' } })
  raw.end()
  const request = new NodeNextRequest(raw)
  NextServer.prototype.attachRequestMeta.call({ fetchHostname: hostname, port, nextConfig: { experimental: {} } }, request, { query: {} }, false)
  return NextRequestAdapter.fromNodeNextRequest(request, new AbortController().signal)
}

describe('vertical app public-origin contract', () => {
  it('reproduces the private CLI origin mismatch using actual installed Next adapters', () => {
    const request = adaptedOrigin('127.0.0.1', 3118, 'http://localhost:3117')
    expect(request.nextUrl.origin).toBe('http://localhost:3118')
    expect(request.headers.get('origin')).not.toBe(request.nextUrl.origin)
  })
  it('passes the unchanged strict same-origin comparison with the public server identity', () => {
    const request = adaptedOrigin('localhost', 3117, 'http://localhost:3117')
    expect(request.nextUrl.origin).toBe('http://localhost:3117')
    expect(request.headers.get('origin')).toBe(request.nextUrl.origin)
    const foreign = adaptedOrigin('localhost', 3117, 'https://foreign.invalid')
    expect(foreign.headers.get('origin')).not.toBe(foreign.nextUrl.origin)
  })
  it('separates advertised identity from the only private listening address', async () => {
    const server = Object.assign(new EventEmitter(), { listen: vi.fn((_port, _host, ready) => { ready() }) })
    const handler = vi.fn().mockResolvedValue(undefined)
    const app = { prepare: vi.fn().mockResolvedValue(undefined), getRequestHandler: () => handler }
    const next = vi.fn(() => app), createServer = vi.fn(() => server)
    expect(await startContextualTestVerticalApp({ next, createServer, dir: '/private/owned/app' })).toEqual({ app, server })
    expect(next).toHaveBeenCalledExactlyOnceWith({ dev: true, hostname: 'localhost', port: 3117, dir: '/private/owned/app', httpServer: server })
    expect(server.listen).toHaveBeenCalledExactlyOnceWith(3118, '127.0.0.1', expect.any(Function))
    const request = { headers: { origin: 'http://localhost:3117', host: 'localhost:3117' } }, response = { destroy: vi.fn() }
    server.emit('request', request, response)
    await Promise.resolve(); await Promise.resolve()
    expect(handler).toHaveBeenCalledExactlyOnceWith(request, response)
    expect(request.headers).toEqual({ origin: 'http://localhost:3117', host: 'localhost:3117' })
    expect(response.destroy).not.toHaveBeenCalled()
  })
  it('does not open a listener after preparation fails', async () => {
    const server = Object.assign(new EventEmitter(), { listen: vi.fn() })
    const next = () => ({ prepare: async () => { throw new Error('synthetic') } })
    await expect(startContextualTestVerticalApp({ next, createServer: () => server, dir: '/private/owned/app' })).rejects.toThrow('synthetic')
    expect(server.listen).not.toHaveBeenCalled()
  })
})
