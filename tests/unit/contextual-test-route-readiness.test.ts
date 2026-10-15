import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

const io = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('node:http', () => ({ request: io.request }))
import { createContextualTestRouteReadiness } from '../../scripts/contextual-test-route-readiness'

class Handle extends EventEmitter {
  readonly destroy = vi.fn(() => this)
}
class Response extends Handle {
  statusCode = 200
  headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' }
  complete = true
  aborted = false
}
let req: Handle & { end: ReturnType<typeof vi.fn> }, socket: Handle, response: Response
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(100000)
  req = Object.assign(new Handle(), { end: vi.fn() }); socket = new Handle(); response = new Response()
  io.request.mockReset().mockReturnValue(req)
})
afterEach(() => { vi.useRealTimers() })
function start(end = Date.now() + 180000) {
  const control = createContextualTestRouteReadiness(), run = control.run(end)
  const rejected = run.catch(error => error as Error)
  req.emit('socket', socket)
  return { control, run, rejected }
}
function document() { req.emit('response', response); response.emit('data', Buffer.from('<html>private-content</html>')); response.emit('end') }
function close() { response.emit('close'); req.emit('close'); socket.emit('close') }

describe('one fixed route readiness request with CPU event doubles', () => {
  it('constructs inertly and considers a never-started factory closed', async () => {
    const control = createContextualTestRouteReadiness()
    control.assertClosed(); expect(io.request).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
    await control.settle(Date.now() + 1); control.assertClosed()
    await expect(control.run(Date.now() + 1000)).rejects.toThrow()
    expect(io.request).not.toHaveBeenCalled()
  })
  it('uses only the fixed physical target, semantic host and finite no-agent connection', async () => {
    const { control, run } = start()
    expect(io.request).toHaveBeenCalledExactlyOnceWith({ hostname: '127.0.0.1', port: 3117, path: '/login', method: 'GET',
      headers: { Host: 'localhost:3117', Connection: 'close' }, agent: false })
    expect(req.end).toHaveBeenCalledExactlyOnceWith()
    document(); close(); await run; control.assertClosed(); expect(vi.getTimerCount()).toBe(0)
  })
  it('does not accept headers, body end or any subset of positive close events as complete readiness', async () => {
    const { control, run } = start(); const done = vi.fn(); void run.then(done)
    req.emit('response', response); await Promise.resolve(); expect(done).not.toHaveBeenCalled()
    response.emit('end'); response.emit('close'); req.emit('close'); await Promise.resolve()
    expect(done).not.toHaveBeenCalled(); expect(() => control.assertClosed()).toThrow()
    socket.emit('close'); await run; expect(done).toHaveBeenCalledOnce(); control.assertClosed()
  })
  it.each([301, 302, 401, 500])('rejects status %s without redirect or retry', async status => {
    const { control, rejected } = start(); response.statusCode = status; req.emit('response', response)
    expect(await rejected).toBeInstanceOf(Error); expect(req.destroy).toHaveBeenCalled(); expect(response.destroy).toHaveBeenCalled(); expect(socket.destroy).toHaveBeenCalled()
    close(); await control.settle(Date.now() + 1000); control.assertClosed(); expect(io.request).toHaveBeenCalledOnce()
  })
  it.each(['application/json', 'text/htmlish', '', 'text/plain'])('rejects non-document media type %s', async media => {
    const { control, rejected } = start(); response.headers['content-type'] = media; req.emit('response', response)
    expect(await rejected).toBeInstanceOf(Error); close(); await control.settle(Date.now() + 1000)
  })
  it.each([1048576, 1048577])('bounds actual complete response bytes at 1MiB (%s)', async bytes => {
    const { control, run, rejected } = start(); req.emit('response', response); response.emit('data', Buffer.alloc(bytes)); response.emit('end'); close()
    if (bytes === 1048576) await run
    else expect(await rejected).toBeInstanceOf(Error)
    await control.settle(Date.now() + 1000); control.assertClosed()
  })
  it.each(['request', 'socket', 'response'])('retains ownership after %s error until actual close, without retaining raw errors', async location => {
    const { control, rejected } = start(); req.emit('response', response)
    const handle = location === 'request' ? req : location === 'socket' ? socket : response
    handle.emit('error', Error('DO-NOT-RETAIN secret cookie password url'))
    const error = await rejected
    expect(error).toBeInstanceOf(Error); expect(String(error)).not.toMatch(/DO-NOT-RETAIN|secret|cookie|password|url/)
    expect(JSON.stringify(control)).toBe('{}'); expect(() => control.assertClosed()).toThrow()
    const settled = control.settle(Date.now() + 1000); close(); await settled; control.assertClosed()
    // Late EventEmitter errors remain observed even after disposal.
    handle.emit('error', Error('late-private-error'))
  })
  it.each(['headers', 'body', 'close'])('expires at the supplied original end while waiting for %s', async waiting => {
    const originalEnd = Date.now() + 180000; vi.setSystemTime(originalEnd - 25)
    const { control, rejected } = start(originalEnd)
    if (waiting !== 'headers') req.emit('response', response)
    if (waiting === 'close') response.emit('end')
    await vi.advanceTimersByTimeAsync(25); expect(await rejected).toBeInstanceOf(Error)
    expect(req.destroy).toHaveBeenCalled(); expect(socket.destroy).toHaveBeenCalled(); expect(() => control.assertClosed()).toThrow()
    if (waiting === 'headers') req.emit('response', response)
    response.emit('end'); close(); await control.settle(Date.now() + 1000); control.assertClosed()
    await expect(control.run(Date.now() + 180000)).rejects.toThrow(); expect(io.request).toHaveBeenCalledOnce()
  })
  it('rejects an already expired run before dispatch and still consumes the single use', async () => {
    const control = createContextualTestRouteReadiness()
    await expect(control.run(Date.now())).rejects.toThrow()
    await expect(control.run(Date.now() + 1000)).rejects.toThrow()
    control.assertClosed(); expect(io.request).not.toHaveBeenCalled()
  })
  it('does not credit destroyed flags, abort, or end as positive handle closure', async () => {
    const { control, rejected } = start(Date.now() + 10)
    Object.assign(req, { destroyed: true }); Object.assign(socket, { destroyed: true })
    req.emit('abort'); await vi.advanceTimersByTimeAsync(10); await rejected
    const settled = control.settle(Date.now() + 20); const failure = settled.catch(error => error)
    await vi.advanceTimersByTimeAsync(20); expect(await failure).toBeInstanceOf(Error)
    expect(() => control.assertClosed()).toThrow(); req.emit('close'); socket.emit('close')
    expect(() => control.assertClosed()).toThrow() // missed cleanup deadline remains a failure
  })
  it('destroys a late original response and never turns a failed run into success', async () => {
    const { control, rejected } = start(Date.now() + 10)
    await vi.advanceTimersByTimeAsync(10); expect(await rejected).toBeInstanceOf(Error)
    const settled = control.settle(Date.now() + 1000)
    req.emit('response', response); expect(response.destroy).toHaveBeenCalled()
    response.emit('end'); close(); await settled; control.assertClosed()
    expect(await rejected).toBeInstanceOf(Error)
  })
  it.each(['incomplete', 'early-close', 'aborted'])('rejects %s response completion', async mode => {
    const { control, rejected } = start(); req.emit('response', response)
    if (mode === 'incomplete') { response.complete = false; response.emit('end') }
    if (mode === 'early-close') response.emit('close')
    if (mode === 'aborted') response.emit('aborted')
    expect(await rejected).toBeInstanceOf(Error); close(); await control.settle(Date.now() + 1000)
  })
  it('settlement stops in-progress admission and joins every actual close under its supplied cleanup end', async () => {
    const { control, rejected } = start(), settled = control.settle(Date.now() + 1000)
    expect(await rejected).toBeInstanceOf(Error); expect(() => control.assertClosed()).toThrow()
    req.emit('close'); socket.emit('close'); await settled; control.assertClosed()
  })
  it('sanitizes synchronous transport failure without leaking or dispatching again', async () => {
    io.request.mockImplementation(() => { throw Error('private endpoint credential') })
    const control = createContextualTestRouteReadiness()
    await expect(control.run(Date.now() + 1000)).rejects.toThrow('Private contextual Test route readiness failed')
    control.assertClosed(); expect(vi.getTimerCount()).toBe(0)
    await expect(control.run(Date.now() + 1000)).rejects.toThrow(); expect(io.request).toHaveBeenCalledOnce()
  })
  it('cannot infer socket closure from complete request and response events when the socket was never observed', async () => {
    const control = createContextualTestRouteReadiness(), run = control.run(Date.now() + 10), rejected = run.catch(error => error)
    document(); response.emit('close'); req.emit('close')
    expect(() => control.assertClosed()).toThrow()
    await vi.advanceTimersByTimeAsync(10); expect(await rejected).toBeInstanceOf(Error)
    await control.settle(Date.now() + 1000); control.assertClosed()
  })
  it('does not renew a cleanup end through overlapping settlement calls', async () => {
    const { control, rejected } = start(), later = control.settle(Date.now() + 1000).catch(error => error)
    await rejected
    const earlier = control.settle(Date.now() + 10).catch(error => error)
    await vi.advanceTimersByTimeAsync(10)
    expect(await earlier).toBeInstanceOf(Error); expect(await later).toBeInstanceOf(Error)
    expect(vi.getTimerCount()).toBe(0); close(); expect(() => control.assertClosed()).toThrow()
  })
  it('observes an already assigned socket and deduplicates its later socket event', async () => {
    Object.assign(req, { socket })
    const { control, run } = start()
    expect(socket.listenerCount('close')).toBe(1)
    document(); close(); await run; control.assertClosed()
  })
  it('rejects a requested readiness end beyond the infrastructure maximum before dispatch', async () => {
    const control = createContextualTestRouteReadiness()
    await expect(control.run(Date.now() + 180001)).rejects.toThrow()
    control.assertClosed(); expect(io.request).not.toHaveBeenCalled()
  })
  it('rejects a cleanup lease beyond six minutes and still destroys each owned handle', async () => {
    const { control, rejected } = start()
    await expect(control.settle(Date.now() + 360001)).rejects.toThrow(); await rejected
    expect(req.destroy).toHaveBeenCalled(); expect(socket.destroy).toHaveBeenCalled()
    close(); expect(() => control.assertClosed()).toThrow()
  })
  it('continues disposal of other resources if one destroy throws and cannot credit closure afterward', async () => {
    const { control, rejected } = start()
    req.destroy.mockImplementation(() => { throw Error('private destroy failure') })
    req.emit('error', Error('private transport failure')); await rejected
    expect(socket.destroy).toHaveBeenCalled(); close()
    await expect(control.settle(Date.now() + 1000)).rejects.toThrow(); expect(() => control.assertClosed()).toThrow()
  })
  it('rejects closure that occurred after the supplied cleanup deadline even if settle is invoked later', async () => {
    const { control, rejected } = start(Date.now() + 10), cleanupEnd = Date.now() + 20
    await vi.advanceTimersByTimeAsync(30); await rejected; close()
    await expect(control.settle(cleanupEnd)).rejects.toThrow(); expect(() => control.assertClosed()).toThrow()
  })
  it('can attest previously observed timely closure even when settlement is requested after the end', async () => {
    const { control, rejected } = start(Date.now() + 10), cleanupEnd = Date.now() + 20
    await vi.advanceTimersByTimeAsync(10); await rejected; close()
    await vi.advanceTimersByTimeAsync(20); await control.settle(cleanupEnd); control.assertClosed()
  })
  it.each(['request', 'socket'])('makes a late original %s error after successful readiness prevent final acceptance', async kind => {
    const { control, run } = start()
    document(); close(); await run; control.assertClosed()
    const handle = kind === 'request' ? req : socket
    handle.emit('error', Error('private late original error'))
    expect(() => control.assertClosed()).toThrow('Private contextual Test route readiness failed')
    await control.settle(Date.now() + 1000)
    expect(() => control.assertClosed()).toThrow('Private contextual Test route readiness failed')
  })
  it('accepts parser-complete request/socket closure before response end, but waits for actual end and response close', async () => {
    const { control, run } = start(), done = vi.fn()
    void run.then(done, () => {})
    req.emit('response', response); response.emit('data', Buffer.from('<html>complete</html>'))
    // Pinned Node socketCloseListener closes the request before pushing the
    // response EOF. Parser completion is not consumption of that EOF.
    req.emit('close'); socket.emit('close'); await Promise.resolve()
    expect(done).not.toHaveBeenCalled(); expect(() => control.assertClosed()).toThrow()
    response.emit('end'); await Promise.resolve()
    expect(done).not.toHaveBeenCalled(); expect(() => control.assertClosed()).toThrow()
    response.emit('close'); await run; control.assertClosed(); expect(done).toHaveBeenCalledOnce()
  })
  it.each(['incomplete', 'aborted', 'absent'])('rejects early request/socket closure with %s response state', async state => {
    const { control, rejected } = start()
    if (state !== 'absent') {
      req.emit('response', response)
      response.complete = state !== 'incomplete'; response.aborted = state === 'aborted'
    }
    req.emit('close'); socket.emit('close'); expect(await rejected).toBeInstanceOf(Error)
    if (state !== 'absent') response.emit('close')
    await control.settle(Date.now() + 1000); control.assertClosed()
  })
  it('times out without an actual response end despite parser completion and request/socket closure', async () => {
    const { control, rejected } = start(Date.now() + 10)
    req.emit('response', response); req.emit('close'); socket.emit('close')
    await vi.advanceTimersByTimeAsync(10); expect(await rejected).toBeInstanceOf(Error)
    expect(response.destroy).toHaveBeenCalled(); expect(() => control.assertClosed()).toThrow()
    response.emit('end'); response.emit('close'); await control.settle(Date.now() + 1000); control.assertClosed()
  })
})
