import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Browser, Route } from '@playwright/test'
const http = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('node:http', () => ({ createServer: http.create }))
import { createLoginBodyObservation, runLoginBodyDiagnostic } from '../../e2e/helpers/contextual-browser-login-diagnostic'

afterEach(() => vi.useRealTimers())

function browserFixture(mode: 'immediate' | 'after-abort' | 'reject') {
  let serve!: (request: IncomingMessage, response: ServerResponse) => void
  http.create.mockImplementation(handler => {
    serve = handler
    return Object.assign(new EventEmitter(), { listen(_options: unknown, ready: () => void) { ready() }, address: () => ({ port: 43210 }), close(done: () => void) { done() } })
  })
  const origin = 'http://127.0.0.1:43210', context = new EventEmitter()
  let handle!: (route: Route) => Promise<void>, resolveBody!: (bytes: Buffer) => void, rejectBody!: () => void
  const body = new Promise<Buffer>((resolve, reject) => { resolveBody = resolve; rejectBody = () => reject(Error('SECRET')) })
  let respond!: (response: unknown) => void
  const responseWait = new Promise(resolve => { respond = resolve })
  const original = { url: () => origin + '/api/auth/login', body: vi.fn(() => body), status: () => 200, headers: () => ({ 'content-type': 'application/json' }) }
  const route = (path: string, method = 'GET') => ({
    request: () => ({ url: () => origin + path, method: () => method, postData: () => '{"probe":"login"}' }),
    abort: async () => { if (mode === 'after-abort') resolveBody(Buffer.from('{"success":true}')) },
    continue: async () => {
      const request = Object.assign(new EventEmitter(), { method, url: path, complete: true, destroy() {} })
      const response = Object.assign(new EventEmitter(), { setHeader() {}, writeHead() {}, end() {}, destroy() {} })
      serve(request as never, response as never)
      if (method === 'POST') {
        request.emit('data', Buffer.from('{"probe":"login"}')); request.emit('end')
        context.emit('response', original); respond(original)
        context.emit('requestfinished', { url: original.url })
        if (mode === 'immediate') resolveBody(Buffer.from('{"success":true}'))
        if (mode === 'reject') rejectBody()
        void handle(route('/classrooms') as never)
      }
    },
  })
  const fake = Object.assign(context, {
    route: async (_pattern: string, callback: typeof handle) => { handle = callback }, routeWebSocket: async () => {},
    newPage: async () => Object.assign(new EventEmitter(), {
      goto: async () => handle(route('/login') as never), waitForResponse: () => responseWait,
      waitForURL: async () => {},
      getByRole: () => ({ click: async (options: { noWaitAfter?: boolean }) => { expect(options.noWaitAfter).toBe(true); await handle(route('/api/auth/login', 'POST') as never) } }),
    }),
    close: async () => {},
  })
  return { browser: { newContext: async () => fake } as unknown as Browser, original }
}

describe('fixed login-body diagnostic observations (CPU only)', () => {
  it('distinguishes request completion from pending body at cutoff and late body completion', () => {
    let now = 1000
    const value = createLoginBodyObservation(() => now)
    value.mark('response'); value.mark('body-start'); value.mark('request-finished')
    now += 8000; value.cutoff()
    value.mark('navigation-aborted'); value.mark('body-resolved'); value.mark('body-verified')
    const result = value.snapshot()
    expect(result.atCutoff).toEqual({ requestFinished: true, bodySettled: false, bodyVerified: false, navigationHeld: false })
    expect(result.bodyVerified).toBe(true)
    expect(result.events.map(row => row.event)).toEqual(['response', 'body-start', 'request-finished', 'cutoff', 'navigation-aborted', 'body-resolved', 'body-verified'])
    expect(result.events.at(-1)?.elapsedMs).toBe(8000)
  })
  it('does not rewrite an early rejection or invent missing request completion', () => {
    const value = createLoginBodyObservation(() => 123)
    value.mark('body-start'); value.mark('body-rejected'); value.cutoff()
    expect(value.snapshot().atCutoff).toEqual({ requestFinished: false, bodySettled: true, bodyVerified: false, navigationHeld: false })
    expect(value.snapshot().bodyVerified).toBe(false)
  })
  it('returns isolated snapshots and bounds retained events', () => {
    const value = createLoginBodyObservation(() => 123)
    for (let i = 0; i < 40; i++) value.mark('response')
    const first = value.snapshot(); first.events.length = 0
    expect(value.snapshot().events).toHaveLength(32)
    expect(value.snapshot().overflow).toBe(true)
  })
  it('rejects arbitrary labels without retaining their text', () => {
    const value = createLoginBodyObservation(() => 123)
    expect(() => value.mark('SECRET' as never)).toThrow()
    expect(JSON.stringify(value.snapshot())).not.toContain('SECRET')
  })
  it.each(['immediate', 'after-abort', 'reject'] as const)('executes the actual diagnostic with injected browser/HTTP doubles: %s', async mode => {
    vi.useFakeTimers()
    const { browser, original } = browserFixture(mode)
    const pending = runLoginBodyDiagnostic(browser, Date.now() + 20000)
    await vi.advanceTimersByTimeAsync(mode === 'after-abort' ? 8001 : 1)
    const result = await pending
    expect(original.body).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ diagnosticOnly: true, contextClosed: true, serverClosed: true, posts: 1, unexpectedRequests: 0, bodyDone: true })
    expect(result.bodyVerified).toBe(mode !== 'reject')
    expect(result.failure).toBe(mode === 'reject')
    expect(result.atCutoff).toMatchObject({ requestFinished: true, bodySettled: mode !== 'after-abort', navigationHeld: true })
    if (mode === 'after-abort') expect(result.events.map(row => row.event)).toEqual(expect.arrayContaining(['cutoff', 'navigation-aborted', 'body-resolved']))
    expect(JSON.stringify(result)).not.toContain('SECRET')
  })
})
