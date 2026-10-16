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
  it.each(['GET', 'HEAD'])('joins both signals for an intercepted unsent %s cancellation', async method => {
    for (const terminalFirst of [true, false]) {
      const b = boundary(), c = {}, r = {}, ack = deferred<void>()
      b.requestStarted(c, r); b.requestIntercepted(c, r, method)
      const cancelled = b.cancelUnsentRead(c, r, () => ack.promise, 2000)
      if (terminalFirst) b.requestFinished(c, r, true)
      else ack.resolve()
      await Promise.resolve(); await Promise.resolve()
      expect(b.pending(c)).toBe(1)
      if (terminalFirst) ack.resolve()
      else b.requestFinished(c, r, true)
      await cancelled; await b.settle(c)
      expect(b.pending(c)).toBe(0); expect(b.receipt().firstFailure).toBeNull()
    }
  })
  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('never cancels an intercepted %s mutation/non-read', async method => {
    const b = boundary(), c = {}, r = {}, abort = vi.fn(async () => {})
    b.requestStarted(c, r); b.requestIntercepted(c, r, method)
    await expect(b.cancelUnsentRead(c, r, abort, 2000)).rejects.toThrow()
    expect(abort).not.toHaveBeenCalled(); b.requestFinished(c, r)
  })
  it.each(['unknown', 'unintercepted', 'released', 'responded', 'finished', 'wrong-context'])('refuses cancellation of %s work', async mode => {
    const b = boundary(), c = {}, r = { method: () => 'GET', postDataJSON: () => undefined }, abort = vi.fn(async () => {})
    if (mode !== 'unknown') b.requestStarted(c, r)
    if (!['unknown', 'unintercepted'].includes(mode)) b.requestIntercepted(c, r, 'GET')
    if (mode === 'released') b.requestReleased(c, r)
    if (mode === 'responded') await b.observe(c, response(async () => Buffer.from('{}')), r)
    if (mode === 'finished') b.requestFinished(c, r)
    await expect(b.cancelUnsentRead(mode === 'wrong-context' ? {} : c, r, abort, 2000)).rejects.toThrow()
    expect(abort).not.toHaveBeenCalled(); b.requestFinished(c, r)
  })
  it('does not consider a successful terminal event an expected abort', async () => {
    const b = boundary(), c = {}, r = {}
    b.requestStarted(c, r); b.requestIntercepted(c, r, 'GET')
    const work = b.cancelUnsentRead(c, r, async () => { b.requestFinished(c, r) }, 2000)
    await expect(work).rejects.toThrow(); expect(b.receipt().firstFailure).toBe('response-body')
  })
  it('retains abort acknowledgement failure even after requestfailed', async () => {
    const b = boundary(), c = {}, r = {}
    b.requestStarted(c, r); b.requestIntercepted(c, r, 'GET')
    await expect(b.cancelUnsentRead(c, r, async () => { b.requestFinished(c, r, true); throw Error('PRIVATE') }, 2000)).rejects.toThrow()
    expect(b.pending(c)).toBe(1); expect(b.receipt().firstFailure).toBe('response-body')
  })
  it.each(['ack', 'terminal'])('fails the original deadline if cancellation %s is missing', async missing => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1000)
      const b = boundary(Date.now), c = {}, r = {}, never = deferred<void>()
      b.requestStarted(c, r); b.requestIntercepted(c, r, 'HEAD')
      const work = b.cancelUnsentRead(c, r, () => missing === 'ack' ? never.promise : Promise.resolve(), 1010)
      const rejected = expect(work).rejects.toThrow()
      if (missing === 'ack') b.requestFinished(c, r, true)
      await vi.advanceTimersByTimeAsync(10); await rejected
      expect(b.receipt().firstFailure).toBe('deadline'); expect(b.pending(c)).toBe(1)
      if (missing === 'ack') never.resolve(); else b.requestFinished(c, r, true)
      await Promise.resolve()
    } finally { vi.useRealTimers() }
  })
  it('a response during expected abort remains fatal and keeps its original body', async () => {
    const b = boundary(), c = {}, r = { method: () => 'GET', postDataJSON: () => undefined }, original = response(async () => Buffer.from('{}'))
    b.requestStarted(c, r); b.requestIntercepted(c, r, 'GET')
    await expect(b.cancelUnsentRead(c, r, async () => {
      await b.observe(c, original, r); b.requestFinished(c, r, true)
    }, 2000)).rejects.toThrow()
    expect(original.body).toHaveBeenCalledOnce(); expect(b.receipt().firstFailure).toBe('response-body')
  })
  it('waits for both abort signals before releasing a held navigation', async () => {
    const b = boundary(), c = {}, read = {}, nav = {}, ack = deferred<void>(), release = vi.fn()
    b.requestStarted(c, read); b.requestIntercepted(c, read, 'GET')
    const cancelled = b.cancelUnsentRead(c, read, () => ack.promise, 2000)
    b.requestStarted(c, nav); b.requestIntercepted(c, nav, 'GET')
    const navigation = b.waitForNavigation(c, nav, 2000).then(release)
    b.requestFinished(c, read, true); await Promise.resolve()
    expect(release).not.toHaveBeenCalled()
    ack.resolve(); await cancelled; await navigation
    expect(release).toHaveBeenCalledOnce(); b.requestFinished(c, nav)
  })
  it('does not wait on already released work at navigation interception', async () => {
    const b = boundary(), c = {}, read = {}, nav = {}
    b.requestStarted(c, read); b.requestIntercepted(c, read, 'GET'); b.requestReleased(c, read)
    b.requestStarted(c, nav); b.requestIntercepted(c, nav, 'GET')
    await expect(b.waitForNavigation(c, nav, 2000)).rejects.toThrow()
    expect(b.receipt().endpointFailure?.reason).toBe('navigation-pending')
    b.requestFinished(c, read); b.requestFinished(c, nav)
  })
  it.each(['1', '42', '-1', '', ' 0', '0 ', '00', '0, 0', 'NaN', 'private'])('rejects browser JSON Content-Length %j before a possible library refetch', async length => {
    const b = boundary(), c = {}, r = response(async () => Buffer.from('{}'))
    Object.assign(r, { headers: () => ({ 'content-type': 'application/json', 'content-length': length }) })
    await b.observe(c, r); await expect(b.settle(c)).rejects.toThrow()
    expect(r.body).not.toHaveBeenCalled(); expect(b.receipt().firstFailure).toBe('response-original-incompatible')
    expect(b.receipt().responseFailure).toMatchObject({ phase: 'response-original-incompatible', resource: 'session', cause: 'unknown' })
  })
  it.each([undefined, '0'])('reads browser JSON with safe Content-Length %j once and retains parse failures', async length => {
    const b = boundary(), c = {}, r = response(async () => Buffer.from('{'))
    Object.assign(r, { headers: () => ({ 'content-type': 'application/json', ...(length === undefined ? {} : { 'content-length': length }) }) })
    await b.observe(c, r); await expect(b.settle(c)).rejects.toThrow()
    expect(r.body).toHaveBeenCalledOnce(); expect(b.receipt().firstFailure).toBe('response-json')
  })
  it('does not constrain APIResponse bodies by the Chromium-only Content-Length fallback', async () => {
    const b = boundary(), c = {}, r = response(async () => Buffer.from('{}'))
    Object.assign(r, { headers: () => ({ 'content-type': 'application/json', 'content-length': '2' }) })
    await b.observe(c, r, undefined, 'api'); await b.settle(c); expect(r.body).toHaveBeenCalledOnce()
  })
  it('owns pre-header requests through delayed body completion before departure', async () => {
    const b = boundary(), c = {}, request = { method: () => 'GET', postDataJSON: () => undefined }
    const body = deferred<Buffer>(), departed = vi.fn()
    b.requestStarted(c, request)
    const departure = b.settle(c).then(departed)
    await Promise.resolve(); expect(departed).not.toHaveBeenCalled()
    const original = b.observe(c, response(() => body.promise), request)
    b.requestFinished(c, request)
    await Promise.resolve(); expect(departed).not.toHaveBeenCalled()
    body.resolve(Buffer.from('{}')); await original; await departure
    expect(departed).toHaveBeenCalledOnce(); expect(b.pending(c)).toBe(0)
  })
  it('fails cancellation after headers even if the original body later resolves', async () => {
    const b = boundary(), c = {}, request = { method: () => 'GET', postDataJSON: () => undefined }, body = deferred<Buffer>()
    b.requestStarted(c, request); b.observe(c, response(() => body.promise), request)
    b.requestFinished(c, request, true); body.resolve(Buffer.from('{}'))
    await expect(b.settle(c)).rejects.toThrow(); expect(b.receipt().firstFailure).toBe('response-body')
  })
  it('does not renew a request operation bound when headers finally arrive', async () => {
    let now = 1000; const b = boundary(() => now), c = {}, request = { method: () => 'GET', postDataJSON: () => undefined }
    b.requestStarted(c, request); now += plan.limits.operationMs - 1
    const body = deferred<Buffer>(); b.observe(c, response(() => body.promise), request); b.requestFinished(c, request)
    now++; expect(() => b.check()).toThrow(); body.resolve(Buffer.from('{}'))
    await expect(b.settle(c)).rejects.toThrow()
  })
  it('joins a response delivered during close and rejects its body failure', async () => {
    const b = boundary(), c = {}, body = deferred<Buffer>(), closeEntered = deferred<void>()
    const closed = b.beforeContextClose(c, async () => {
      b.observe(c, response(() => body.promise)); closeEntered.resolve()
    })
    const failure = expect(closed).rejects.toThrow()
    await closeEntered.promise; body.reject(Error('late private cancellation')); await failure
    expect(b.pending(c)).toBe(0); expect(b.receipt().firstFailure).toBe('response-body')
  })
  it('joins a request first seen during close before its headers arrive', async () => {
    const b = boundary(), c = {}, request = { method: () => 'GET', postDataJSON: () => undefined }
    const entered = deferred<void>(), body = deferred<Buffer>(), completed = vi.fn()
    const close = b.beforeContextClose(c, async () => { b.requestStarted(c, request); entered.resolve() }).then(completed)
    await entered.promise; await new Promise<void>(resolve => setImmediate(resolve))
    expect(completed).not.toHaveBeenCalled()
    b.observe(c, response(() => body.promise), request); b.requestFinished(c, request)
    await Promise.resolve(); expect(completed).not.toHaveBeenCalled()
    body.resolve(Buffer.from('{}')); await close; expect(completed).toHaveBeenCalledOnce()
  })
  it('rejects a navigation racing a newly started request without waiting inside its route', async () => {
    const b = boundary(), c = {}, navigation = {}, late = {}
    b.requestStarted(c, navigation); expect(() => b.canNavigate(c, navigation)).not.toThrow()
    b.requestStarted(c, late); expect(() => b.canNavigate(c, navigation)).toThrow()
    b.requestFinished(c, navigation); b.requestFinished(c, late)
    await expect(b.settle(c)).rejects.toThrow()
    expect(b.receipt().endpointFailure).toEqual({ reason: 'navigation-pending', transports: 1, bodies: 0 })
  })
  it('invokes departure in the same continuation as its final drain, not after a resolved-promise gap', async () => {
    const b = boundary(), c = {}, late = {}, navigation = {}, events: string[] = []
    queueMicrotask(() => { b.requestStarted(c, late); events.push('late'); b.requestFinished(c, late) })
    await b.depart(c, 2000, async () => {
      events.push('dispatch'); b.requestStarted(c, navigation); b.canNavigate(c, navigation); b.requestFinished(c, navigation)
    })
    expect(events).toEqual(['dispatch', 'late']); expect(b.receipt().firstFailure).toBeNull()
  })
  it('still rejects a late native request between command dispatch and navigation interception', async () => {
    const b = boundary(), c = {}, late = {}, navigation = {}
    await expect(b.depart(c, 2000, async () => {
      // The command has been sent, but Chromium has not yet emitted navigation.
      await Promise.resolve(); b.requestStarted(c, late); b.requestStarted(c, navigation)
      try { b.canNavigate(c, navigation) }
      finally { b.requestFinished(c, navigation); b.requestFinished(c, late) }
    })).rejects.toThrow()
    expect(b.receipt().endpointFailure?.reason).toBe('navigation-pending')
  })
  it('never passes timeout zero when the operation expires between the final check and dispatch', async () => {
    let armed = false, calls = 0
    const b = boundary(() => armed ? (++calls >= 3 ? 2000 : 1999) : 1000), dispatch = vi.fn(async () => {})
    armed = true
    await expect(b.depart({}, 2000, dispatch)).rejects.toThrow()
    expect(dispatch).not.toHaveBeenCalled(); expect(b.receipt().firstFailure).toBe('deadline')
  })
  it('drains the original pre-header transport and original body once before departure', async () => {
    const b = boundary(), c = {}, request = { method: () => 'GET', postDataJSON: () => undefined }, body = deferred<Buffer>(), dispatch = vi.fn(async () => {})
    b.requestStarted(c, request)
    const departing = b.depart(c, 2000, dispatch)
    const r = response(() => body.promise)
    const original = b.observe(c, r, request); b.requestFinished(c, request)
    await Promise.resolve(); expect(dispatch).not.toHaveBeenCalled()
    body.resolve(Buffer.from('{}')); await original; await departing
    expect(r.body).toHaveBeenCalledOnce(); expect(dispatch).toHaveBeenCalledOnce(); expect(b.pending(c)).toBe(0)
  })
  it.each(['body', 'deadline'] as const)('does not dispatch after a %s failure while draining', async failure => {
    let now = 1000
    const b = boundary(() => now), c = {}, request = { method: () => 'GET', postDataJSON: () => undefined }, body = deferred<Buffer>(), dispatch = vi.fn(async () => {})
    b.requestStarted(c, request)
    const departing = b.depart(c, 2000, dispatch), rejected = expect(departing).rejects.toThrow()
    b.observe(c, response(() => body.promise), request); b.requestFinished(c, request)
    if (failure === 'deadline') { now = 2000; body.resolve(Buffer.from('{}')) }
    else body.reject(Error('PRIVATE-BODY'))
    await rejected; expect(dispatch).not.toHaveBeenCalled()
  })
  it('identifies prohibited endpoints without retaining their values or overwriting the first branch', () => {
    const b = boundary()
    expect(() => b.admit(plan.appOrigin + '/api/billing/PRIVATE?secret=PRIVATE', 'POST')).toThrow()
    expect(() => b.endpoint('route-continue')).toThrow()
    expect(b.receipt().endpointFailure).toEqual({ reason: 'prohibited-api', transports: 0, bodies: 0 })
    expect(JSON.stringify(b.receipt())).not.toContain('PRIVATE')
    const copy = b.receipt().endpointFailure!; copy.reason = 'route-inspection'
    expect(b.receipt().endpointFailure?.reason).toBe('prohibited-api')
    const unknown = boundary()
    expect(() => unknown.endpoint('PRIVATE' as never)).toThrow()
    expect(unknown.receipt().endpointFailure?.reason).toBe('unspecified')
    expect(JSON.stringify(unknown.receipt())).not.toContain('PRIVATE')
  })
  it('identifies an original body blocker even after its transport has completed', async () => {
    const b = boundary(), c = {}, navigation = {}, body = deferred<Buffer>()
    const original = b.observe(c, response(() => body.promise))
    b.requestStarted(c, navigation)
    expect(() => b.canNavigate(c, navigation)).toThrow()
    expect(b.receipt().endpointFailure).toEqual({ reason: 'navigation-pending', transports: 0, bodies: 1 })
    body.resolve(Buffer.from('{}')); b.requestFinished(c, navigation); await original
    expect(b.pending(c)).toBe(0); expect(() => b.check()).toThrow()
  })
  it('enforces the departure operation end even when a transport task finishes at that end', async () => {
    let now = 1000; const b = boundary(() => now), c = {}, request = {}
    b.requestStarted(c, request)
    const departure = b.settle(c, 1001)
    now = 1001; b.requestFinished(c, request)
    await expect(departure).rejects.toThrow(); expect(b.receipt().firstFailure).toBe('deadline')
  })
  it.each([-1, 0, 1])('retains the transport deadline when completion occurs %i ms from its end', async offset => {
    let now = 1000; const b = boundary(() => now), c = {}, request = {}
    b.requestStarted(c, request)
    now += plan.limits.operationMs + offset
    expect(() => b.requestFinished(c, request)).not.toThrow()
    expect(b.pending(c)).toBe(0)
    if (offset < 0) { await b.settle(c); expect(b.receipt().firstFailure).toBeNull() }
    else { await expect(b.settle(c)).rejects.toThrow(); expect(b.receipt().firstFailure).toBe('deadline') }
  })
  it.each([-1, 0, 1])('retains the body deadline when completion occurs %i ms from its end before the timer runs', async offset => {
    let now = 1000; const b = boundary(() => now), c = {}, body = deferred<Buffer>()
    const request = { method: () => 'GET', postDataJSON: () => undefined }
    b.requestStarted(c, request)
    const original = b.observe(c, response(() => body.promise), request)
    b.requestFinished(c, request)
    // Advance the injected clock without running timer callbacks, modeling an
    // event-loop delay. Completion must not erase the original expired end.
    now += plan.limits.operationMs + offset
    body.resolve(Buffer.from('{}')); await original
    expect(b.pending(c)).toBe(0)
    if (offset < 0) { await b.settle(c); expect(b.receipt().firstFailure).toBeNull() }
    else { await expect(b.settle(c)).rejects.toThrow(); expect(b.receipt().firstFailure).toBe('deadline') }
  })
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
