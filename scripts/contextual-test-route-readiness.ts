/** Explicit-call, single-use prerequisite for the disposable login route.
 * The owner supplies the original app-ready/cleanup ends and accounts the GET.
 * No environment, network, timer or dependency access at construction/import. */
import { request, type ClientRequest, type IncomingMessage } from 'node:http'

type Handle = ClientRequest | IncomingMessage | NonNullable<ClientRequest['socket']>
const fixedError = () => new Error('Private contextual Test route readiness failed')
const validEnd = (end: number, maximum: number) => Number.isSafeInteger(end) && end > Date.now() && end - Date.now() <= maximum

export function createContextualTestRouteReadiness() {
  const handles = new Set<Handle>(), seen = new WeakSet<Handle>(), waiters = new Set<() => void>()
  let used = false, stopping = false, failed = false, cleanupFailed = false, bodyEnded = false, responseSeen = false, socketSeen = false
  let completedSuccessfully = false
  let bytes = 0, runEnd = 0, cleanupEnd = Infinity, lastClosedAt = 0
  let activeResponse: IncomingMessage | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let resolveRun: (() => void) | undefined, rejectRun: ((error: Error) => void) | undefined
  const notify = () => { for (const waiter of [...waiters]) waiter() }
  const clearRunTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined }
  const destroy = () => {
    for (const handle of [...handles]) {
      try { handle.destroy() } catch { cleanupFailed = true }
    }
  }
  const fail = () => {
    if (!failed) {
      failed = true; clearRunTimer(); rejectRun?.(fixedError()); resolveRun = undefined; rejectRun = undefined
      destroy()
    }
    notify()
  }
  const check = () => {
    if (!failed && Date.now() >= runEnd) fail()
    if (!failed && bodyEnded && responseSeen && socketSeen && handles.size === 0) {
      completedSuccessfully = true
      clearRunTimer(); resolveRun?.(); resolveRun = undefined; rejectRun = undefined
    }
    notify()
  }
  const own = (handle: Handle, kind: 'request' | 'socket' | 'response') => {
    if (seen.has(handle)) return
    seen.add(handle); handles.add(handle)
    // Keep error listeners even after close: no late original error can escape
    // as an unhandled EventEmitter error or be retained as diagnostic content.
    handle.on('error', fail)
    handle.once('close', () => {
      handles.delete(handle); lastClosedAt = Math.max(lastClosedAt, Date.now())
      // Node may close the request/socket after parsing a complete response
      // but before pushing its readable EOF. Only the response's actual end
      // consumes that EOF; a response close before end remains premature.
      if (!bodyEnded && (kind === 'response' || !activeResponse?.complete || activeResponse.aborted)) fail()
      if (kind === 'response') activeResponse = undefined
      check()
    })
    if (failed || stopping) {
      try { handle.destroy() } catch { cleanupFailed = true }
    }
  }
  return Object.freeze({
    async run(end: number): Promise<void> {
      if (used || stopping) throw fixedError()
      used = true
      if (!validEnd(end, 180000)) { failed = true; throw fixedError() }
      runEnd = end
      return new Promise<void>((resolve, reject) => {
        resolveRun = resolve; rejectRun = reject
        timer = setTimeout(fail, end - Date.now())
        try {
          const req = request({ hostname: '127.0.0.1', port: 3117, path: '/login', method: 'GET',
            headers: { Host: 'localhost:3117', Connection: 'close' }, agent: false })
          own(req, 'request')
          req.on('socket', socket => { socketSeen = true; own(socket, 'socket'); check() })
          if (req.socket) { socketSeen = true; own(req.socket, 'socket') }
          req.on('response', response => {
            activeResponse = response; own(response, 'response')
            response.on('aborted', fail)
            response.on('data', (chunk: Buffer) => {
              if (failed) return
              if (!Buffer.isBuffer(chunk)) { fail(); return }
              bytes += chunk.byteLength
              if (bytes > 1048576) fail()
              check()
            })
            response.once('end', () => {
              if (!response.complete || response.aborted) fail()
              bodyEnded = true; check()
            })
            if (responseSeen) { fail(); return }
            responseSeen = true
            if (response.statusCode !== 200 || !/^text\/html(?:\s*;[^\r\n]*)?$/i.test(response.headers['content-type'] ?? '')) fail()
            check()
          })
          req.end()
        } catch { fail() }
      })
    },
    async settle(end: number): Promise<void> {
      stopping = true
      if (resolveRun || rejectRun) fail()
      cleanupEnd = Math.min(cleanupEnd, end)
      if (lastClosedAt && (!Number.isSafeInteger(cleanupEnd) || lastClosedAt >= cleanupEnd)) cleanupFailed = true
      if (handles.size === 0) {
        if (cleanupFailed) throw fixedError()
        return
      }
      if (!validEnd(cleanupEnd, 360000)) { cleanupFailed = true; destroy(); throw fixedError() }
      destroy()
      await new Promise<void>((resolve, reject) => {
        let timeout: ReturnType<typeof setTimeout> | undefined
        const done = () => {
          if (!cleanupFailed && handles.size !== 0 && Date.now() < cleanupEnd) return
          waiters.delete(done); if (timeout !== undefined) clearTimeout(timeout)
          if (handles.size || cleanupFailed || Date.now() >= cleanupEnd) { cleanupFailed = true; reject(fixedError()); notify() }
          else resolve()
        }
        waiters.add(done); timeout = setTimeout(done, Math.max(0, cleanupEnd - Date.now())); done()
      })
    },
    assertClosed(): void {
      if (handles.size || resolveRun || rejectRun || cleanupFailed || (completedSuccessfully && failed)) throw fixedError()
    },
  })
}
