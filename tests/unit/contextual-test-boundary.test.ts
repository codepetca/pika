import { describe, expect, it, vi } from 'vitest'
import { createContextualTestPlan } from '../../e2e/helpers/contextual-test-rehearsal'
import { ContextualTestBoundary } from '../../e2e/helpers/contextual-test-boundary'

const plan = createContextualTestPlan('pika_assignment_list_1a2b3c4d5e6f')
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function response(body: () => Promise<Buffer>, status = 200, url = plan.appOrigin + '/api/auth/me') {
  return { body: vi.fn(body), status: () => status, headers: () => ({ 'content-type': 'application/json' }), url: () => url }
}
function boundary(now = () => 1_000) { return new ContextualTestBoundary(plan, 2_701_000, now) }

describe('contextual Test browser boundary', () => {
  it('invokes the original response body immediately and exactly once', async () => {
    const gate = deferred<Buffer>(), b = boundary(), context = {}, r = response(() => gate.promise)
    const first = b.observe(context, r), second = b.observe(context, r)
    expect(r.body).toHaveBeenCalledTimes(1)
    expect(b.pending(context)).toBe(1)
    expect(first).toBe(second)
    gate.resolve(Buffer.from('{"user":{}}')); await first; await b.settle(context)
    expect(b.pending(context)).toBe(0)
  })
  it('holds the same original tasks before context disposal', async () => {
    const gate = deferred<Buffer>(), b = boundary(), context = {}, calls: string[] = []
    b.observe(context, response(() => gate.promise))
    const close = b.beforeContextClose(context, async () => { calls.push('close') })
    await Promise.resolve(); expect(calls).toEqual([])
    gate.resolve(Buffer.from('{}')); await close
    expect(calls).toEqual(['close'])
  })
  it('never joins unrelated actor contexts', async () => {
    const gate = deferred<Buffer>(), b = boundary(), a = {}, other = {}
    b.observe(other, response(() => gate.promise))
    await b.beforeContextClose(a, async () => {})
    expect(b.pending(other)).toBe(1)
    gate.resolve(Buffer.from('{}')); await b.settle(other)
  })
  it.each(['{', 'x'.repeat(1048577)])('latches parse/cap failures even after task removal', async value => {
    const b = boundary(), c = {}; await b.observe(c, response(async () => Buffer.from(value)))
    expect(b.pending(c)).toBe(0)
    await expect(b.settle(c)).rejects.toThrow('Private Test rehearsal boundary')
    expect(() => b.check()).toThrow('Private Test rehearsal boundary')
  })
  it('records no raw body or error in its fixed diagnostic', async () => {
    const b = boundary(), c = {}; await b.observe(c, response(async () => { throw Error('password-cookie-secret') }))
    expect(JSON.stringify(b.receipt())).not.toContain('password-cookie-secret')
    expect(b.receipt().firstFailure).toBe('response-body')
  })
  it.each([
    ['Protocol error (Network.getResponseBody): No resource with given identifier found', 'inspector-resource-unavailable'],
    ['Protocol error (Network.getResponseBody): Request content was evicted from inspector cache', 'inspector-resource-unavailable'],
    ['Response body is unavailable for redirect responses', 'redirect-body-unavailable'],
    ['Target page, context or browser has been closed', 'target-closed'],
    ['DO-NOT-RETAIN password cookie https://private.invalid?token=secret', 'unknown'],
  ])('retains only a fixed body failure category for %s', async (message, cause) => {
    const b = boundary(), c = {}
    await b.observe(c, response(async () => { throw Error(message) }, 200, plan.appOrigin + '/api/auth/login'))
    expect(b.receipt().responseFailure).toEqual({ phase: 'response-body', resource: 'login', status: 'success', cause })
    expect(JSON.stringify(b.receipt())).not.toMatch(/DO-NOT-RETAIN|private\.invalid|password|cookie|token=|Protocol error/)
  })
  it('attributes an unrelated JSON failure independently of a successful login without inspecting hostile errors', async () => {
    const b = boundary(), c = {}, trap = vi.fn(() => { throw Error('must not inspect') })
    const hostile = new Proxy(new Error('private'), { get: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap, ownKeys: trap })
    await b.observe(c, response(async () => Buffer.from('{}'), 200, plan.appOrigin + '/api/auth/login'))
    await b.observe(c, response(async () => { throw hostile }, 502, plan.appOrigin + '/private?secret=value'))
    expect(b.receipt().responseFailure).toEqual({ phase: 'response-body', resource: 'other', status: 'server-error', cause: 'unknown' })
    expect(trap).not.toHaveBeenCalled()
    expect(() => b.check()).toThrow()
  })
  it('still closes a context when its body verification fails', async () => {
    const b = boundary(), c = {}, close = vi.fn(async () => {})
    await b.observe(c, response(async () => { throw Error('private') }))
    await expect(b.beforeContextClose(c, close)).rejects.toThrow()
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('keeps the original deadline and fails closed after it', async () => {
    let now = 1000; const b = boundary(() => now); now = 2_701_000
    expect(() => b.admit(plan.appOrigin + '/api/auth/me', 'GET')).toThrow()
    expect(b.receipt().counts.appRequests).toBe(0)
  })
  it.each(['https://localhost:3117/api/auth/me', 'http://127.0.0.1:54321/rest/v1/users', 'https://example.test', 'http://secret@localhost:3117/api/auth/me'])('denies foreign or credentialed origin %s', url => {
    expect(() => boundary().admit(url, 'GET')).toThrow()
  })
  it.each([
    ['https://fonts.googleapis.com/css2?family=DO-NOT-RETAIN&token=secret', 'protocol', 'google-font-stylesheet', 'stylesheet'],
    ['https://fonts.gstatic.com/private-secret.woff2', 'protocol', 'google-font-file', 'font'],
    ['https://fonts.googleapis.com.private.invalid/css2', 'protocol', 'other', 'stylesheet'],
    ['http://localhost.private.invalid:3117/private?token=secret', 'origin', 'other', 'document'],
    ['http://private-secret@localhost:3117/api/auth/me', 'credentials', 'app', 'fetch'],
    ['not a URL DO-NOT-RETAIN', 'malformed-url', 'other', 'other'],
  ])('rejects and projects only fixed origin diagnostics for %s', (url, reason, target, resource) => {
    const b = boundary()
    expect(() => b.admit(url, 'GET', undefined, resource)).toThrow()
    const receipt = b.receipt()
    expect(receipt.requestFailure).toEqual({ reason, target, method: 'GET', resource })
    expect(receipt.firstFailure).toBe('origin')
    expect(receipt.counts).toEqual({ appRequests: 0, storageRequests: 0, tests: 2, reservations: 0, uploads: 0 })
    expect(JSON.stringify(receipt)).not.toMatch(/DO-NOT-RETAIN|private|token|https?:|\.woff/)
    receipt.requestFailure!.target = 'other'
    expect(b.receipt().requestFailure?.target).toBe(target)
    expect(() => b.admit(plan.appOrigin + '/api/auth/me', 'GET')).toThrow()
    expect(b.receipt().requestFailure?.target).toBe(target)
  })
  it('does not retain arbitrary method/resource names or soften the origin rejection', () => {
    const b = boundary()
    expect(() => b.admit('https://fonts.googleapis.com/css2', 'PRIVATE-METHOD', undefined, 'PRIVATE-RESOURCE')).toThrow()
    expect(b.receipt().requestFailure).toEqual({ reason: 'protocol', target: 'google-font-stylesheet', method: 'other', resource: 'other' })
    expect(() => b.check()).toThrow()
    expect(JSON.stringify(b.receipt())).not.toContain('PRIVATE')
  })
  it('does not manufacture a request diagnostic for an earlier deadline or provider-path failure', () => {
    let now = 1000; const expired = boundary(() => now); now = 2_701_000
    expect(() => expired.admit('https://fonts.googleapis.com/css2', 'GET')).toThrow()
    expect(expired.receipt().requestFailure).toBeNull()
    const b = boundary()
    expect(() => b.admit(plan.appOrigin + '/api/billing/private', 'POST')).toThrow()
    expect(b.receipt().requestFailure).toBeNull()
  })
  it.each(['/api/cron/x','/api/billing/x','/api/auth/workos/magic/start','/api/auth/signup','/api/teacher/tests/a/ai-grade','/api/teacher/tests/a/ai-grading/run'])('denies provider or unrelated privileged path %s', path => {
    expect(() => boundary().admit(plan.appOrigin + path, 'POST', {})).toThrow()
  })
  it('charges app requests before dispatch and does not exceed the browser allocation', () => {
    const b = boundary(); for (let i = 0; i < 950; i++) b.admit(plan.appOrigin + '/api/auth/me', 'GET')
    expect(() => b.admit(plan.appOrigin + '/api/auth/me', 'GET')).toThrow()
    expect(b.receipt().counts.appRequests).toBe(950)
  })
  it('limits Tests including the two existing retired fixtures', () => {
    const b = boundary(); for (let i = 0; i < 6; i++) b.admit(plan.appOrigin + '/api/teacher/tests', 'POST', { classroom_id: plan.classrooms.classA.id })
    expect(() => b.admit(plan.appOrigin + '/api/teacher/tests', 'POST', { classroom_id: plan.classrooms.classA.id })).toThrow()
  })
  it('rejects unreserved Storage writes before dispatch', () => {
    expect(() => boundary().admit(plan.apiOrigin + '/storage/v1/object/upload/sign/test', 'PUT', Buffer.alloc(8))).toThrow()
  })
  it('allows a signed read only for the exact acknowledged and uploaded private object', async () => {
    const b = boundary(), c = {}, test = '50000000-0000-4000-8000-000000000044', doc = '50000000-0000-4000-8000-000000000045', object = '50000000-0000-4000-8000-000000000046'
    const path = `classrooms/${plan.classrooms.classA.id}/tests/${test}/documents/${doc}/${object}.pdf`
    const upload = plan.apiOrigin + '/storage/v1/object/upload/sign/test-documents/' + path + '?token=private'
    const read = plan.apiOrigin + '/storage/v1/object/sign/test-documents/' + path + '?token=private'
    const endpoint = plan.appOrigin + `/api/teacher/tests/${test}/documents/upload`
    const data = { document_id: doc, byte_size: 8 }
    b.admit(endpoint, 'POST', data)
    const acknowledgement = response(async () => Buffer.from(JSON.stringify({ bucket: 'test-documents', storage_path: path, upload_url: upload, managed_object_id: object })), 200, endpoint)
    await b.observe(c, acknowledgement, { method: () => 'POST', postDataJSON: () => data }); await b.settle(c)
    b.admit(upload, 'PUT', Buffer.alloc(8)); b.admit(read, 'GET'); b.admit(read, 'HEAD')
    expect(b.receipt().counts.storageRequests).toBe(3)
    expect(() => b.admit(read.replace(object, doc), 'GET')).toThrow()
  })
  it.each(['?token=', '?token=a&token=b', '?token=a&other=b', '?token=a#fragment'])('rejects a malformed signed read %s before dispatch', query => {
    expect(() => boundary().admit(plan.apiOrigin + '/storage/v1/object/sign/test-documents/x' + query, 'GET')).toThrow()
  })
})
