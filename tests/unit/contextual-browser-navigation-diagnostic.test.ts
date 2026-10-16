import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { Browser } from '@playwright/test'
const http = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('node:http', () => ({ createServer: http.create }))
import { runNavigationLifecycleDiagnostic } from '../../e2e/helpers/contextual-browser-navigation-diagnostic'

afterEach(() => vi.useRealTimers())
function fixture(mode: 'success' | 'body-failure' | 'positive-length' | 'never-headers' | 'socket-unclosed' | 'late-close' | 'duplicate-data' | 'abort-failure' | 'abort-no-terminal' = 'success') {
  let serve!: (request: unknown, response: unknown) => void
  const context = new EventEmitter(), server = new EventEmitter(), origin = 'http://127.0.0.1:43210'
  let route!: (route: unknown) => Promise<void>, current = 'about:blank', evaluated = false
  const calls: string[] = []
  const socket = Object.assign(new EventEmitter(), { destroy() { if (mode !== 'socket-unclosed') this.emit('close') } })
  http.create.mockImplementation(handler => {
    serve = handler
    return Object.assign(server, { listen(_opts: unknown, ready: () => void) { ready() }, address: () => ({ port: 43210 }), close(done: () => void) { done() } })
  })
  const dispatch = async (path: string, navigation = false) => {
    const request = { url: () => origin + path, method: () => 'GET', postDataJSON: () => undefined,
      resourceType: () => navigation ? 'document' : 'fetch', isNavigationRequest: () => navigation,
      frame: () => frame, redirectedFrom: () => null }
    context.emit('request', request)
    await route({ request: () => request, abort: async () => {
      if (mode !== 'abort-no-terminal') context.emit('requestfailed', request)
      if (mode === 'abort-failure') throw Error('PRIVATE')
    }, continue: async () => {
      calls.push(path)
      if (mode === 'never-headers' && path === '/data') return
      let contentType = '', bytes = '', resolveBody!: (value: Buffer) => void, rejectBody!: (reason: Error) => void, headersSent = false
      const body = new Promise<Buffer>((resolve, reject) => { resolveBody = resolve; rejectBody = reject })
      void body.catch(() => {})
      const original = { request: () => request, url: request.url, status: () => 200, body: vi.fn(() => body),
        headers: () => ({ 'content-type': contentType, ...(mode === 'positive-length' && path === '/data' ? { 'content-length': '14' } : {}) }) }
      const publish = () => { if (!headersSent) { headersSent = true; context.emit('response', original) } }
      const response = Object.assign(new EventEmitter(), {
        setHeader() {}, writeHead(_code: number, headers: Record<string, string>) { contentType = headers['Content-Type'] },
        write(value: string) { bytes += value; publish() },
        end(value = '') { bytes += value; publish(); context.emit('requestfinished', request)
          if (mode === 'body-failure' && path === '/data') rejectBody(Error('PRIVATE'))
          else resolveBody(Buffer.from(bytes)) },
        destroy() { context.emit('requestfailed', request); rejectBody(Error('PRIVATE')) },
      })
      const incoming = Object.assign(new EventEmitter(), { method: 'GET', url: path, destroy() {} })
      serve(incoming, response)
      if (navigation) frame._eventEmitter.emit('navigated', { url: current, newDocument: { request: { _object: request } } })
      if (mode === 'duplicate-data' && path === '/data') serve(incoming, response)
    } })
  }
  const frame = { page: () => page, _eventEmitter: new EventEmitter() }
  const page = Object.assign(new EventEmitter(), {
    goto: async (url: string) => { current = url; await dispatch(new URL(url).pathname, true) },
    evaluate: async (action: () => unknown) => {
      if (!evaluated) { evaluated = true; await dispatch('/data') }
      else if (action.toString().includes('/late')) await dispatch('/late')
      return 'complete'
    },
    url: () => current, mainFrame: () => frame, frames: () => [frame], context: () => context,
  })
  const browser = { newContext: async () => Object.assign(context, {
    route: async (_pattern: string, handler: typeof route) => { route = handler }, routeWebSocket: async () => {},
    newPage: async () => { server.emit('connection', socket); return page },
    close: async () => {
      if (mode === 'late-close') await new Promise<void>(resolve => setTimeout(resolve, 20001))
      context.emit('close')
    },
  }) } as unknown as Browser
  return { browser, calls }
}
describe('navigation lifecycle diagnostic CPU doubles only', () => {
  it('holds before headers and body, validates the original once, then dispatches only one destination', async () => {
    const { browser, calls } = fixture()
    const result = await runNavigationLifecycleDiagnostic(browser, Date.now() + 20000)
    expect(result).toMatchObject({ diagnosticOnly: true, preHeaderHeld: true, bodyHeld: true, bodyVerified: true,
      destinationAfterValidation: true, requests: 3, jsonRequests: 1, originalBodies: 1, pending: 0,
      contextClosed: true, serverClosed: true, socketsRemaining: 0, failure: null,
      unsentCancelled: true, lateRoutes: 1, inspectionDetail: null })
    expect(calls).toEqual(['/source', '/data', '/destination'])
  })
  it.each(['body-failure', 'positive-length'] as const)('fails closed without destination or refetch: %s', async mode => {
    const { browser, calls } = fixture(mode)
    const result = await runNavigationLifecycleDiagnostic(browser, Date.now() + 20000)
    expect(result.failure).not.toBeNull(); expect(result.destinationAfterValidation).toBe(false)
    expect(calls).toEqual(['/source', '/data']); expect(result.jsonRequests).toBe(1)
    expect(result.contextClosed && result.serverClosed).toBe(true)
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
  })
  it('rejects a duplicate synthetic request instead of counting a replay as original evidence', async () => {
    const { browser } = fixture('duplicate-data')
    const result = await runNavigationLifecycleDiagnostic(browser, Date.now() + 20000)
    expect(result.failure).not.toBeNull(); expect(result.unexpectedRequests).toBe(1)
  })
  it.each(['abort-failure', 'abort-no-terminal'] as const)('requires both real cancellation signals: %s', async mode => {
    vi.useFakeTimers()
    const { browser, calls } = fixture(mode)
    const pending = runNavigationLifecycleDiagnostic(browser, Date.now() + 20000)
    await vi.advanceTimersByTimeAsync(20001)
    const result = await pending
    expect(result.failure).not.toBeNull(); expect(result.unsentCancelled).toBe(false)
    expect(result.destinationAfterValidation).toBe(false)
    expect(calls).toEqual(['/source', '/data'])
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
  })
  it.each(['never-headers', 'socket-unclosed'] as const)('cannot renew the original deadline or erase unresolved ownership: %s', async mode => {
    vi.useFakeTimers()
    const { browser } = fixture(mode), end = Date.now() + 20000
    const pending = runNavigationLifecycleDiagnostic(browser, end)
    await vi.advanceTimersByTimeAsync(20001)
    const result = await pending
    expect(result.failure).not.toBeNull()
    if (mode === 'socket-unclosed') expect(result.socketsRemaining).toBe(1)
  })
  it('does not convert a context-close acknowledgement after the original end into success', async () => {
    vi.useFakeTimers()
    const { browser } = fixture('late-close'), end = Date.now() + 20000
    const pending = runNavigationLifecycleDiagnostic(browser, end)
    await vi.advanceTimersByTimeAsync(20002)
    const result = await pending
    expect(result.failure).toBe('cleanup'); expect(result.contextClosed).toBe(false)
  })
})
