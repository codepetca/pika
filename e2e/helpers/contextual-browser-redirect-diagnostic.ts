/** Finite loopback-only regression for the admitted runner's SDK shim.
 * No app, accounts, database, dependency writes, or replayed HTTP requests. */
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { Socket } from 'node:net'
import type { Browser, BrowserContext } from '@playwright/test'
import { ContextualTestBoundary } from './contextual-test-boundary'
import { createContextualTestPlan } from './contextual-test-rehearsal'
import { assertContextualRedirectInterception } from '../../scripts/contextual-playwright-redirect-guard.cjs'

const cases = ['signed', 'foreign', 'navigation', 'iframe', 'worker', 'popup'] as const
export async function runRedirectDiagnostic(browser: Browser, end: number) {
  assert(Number.isSafeInteger(end) && end > Date.now() && end - Date.now() <= 30000)
  assertContextualRedirectInterception()
  let failed = false, stopping = false, active: typeof cases[number] = 'signed'
  let appRequests = 0, sinkRequests = 0, forbiddenRequests = 0, redirectRoutes = 0, blocked = 0, completed = 0, contextsClosed = 0, originalBodies = 0
  let appOrigin = '', apiOrigin = '', target = '', signedPath = '', context: BrowserContext | undefined
  const sockets = new Set<Socket>(), fail = () => { failed = true }
  const remaining = () => { const n = end - Date.now(); assert(n > 0, 'Private redirect diagnostic deadline'); return n }
  const within = async <T>(work: Promise<T>) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([work, new Promise<never>((_yes, no) => { timer = setTimeout(() => no(Error('Private redirect diagnostic deadline')), Math.max(0, end - Date.now())) })]) }
    finally { if (timer) clearTimeout(timer) }
  }
  const app = createServer((request, response) => {
    appRequests++
    if (stopping || Date.now() >= end || appRequests > 13 || request.method !== 'GET') { fail(); request.destroy(); return }
    response.setHeader('Connection', 'close'); response.setHeader('Cache-Control', 'no-store')
    if (request.url === '/source') {
      response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><link rel="icon" href="data:,"><body>Redirect diagnostic</body>')
    } else if (request.url === '/hop') {
      response.writeHead(302, { Location: target }); response.end()
    } else if (active === 'worker' && request.url === '/worker.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end('fetch("/hop").catch(()=>{});')
    } else { forbiddenRequests++; fail(); response.destroy() }
  })
  const sink = createServer((request, response) => {
    sinkRequests++
    if (stopping || Date.now() >= end || active !== 'signed' || request.method !== 'GET'
      || request.url !== signedPath + '?token=synthetic' || sinkRequests !== 1) { forbiddenRequests++; fail(); request.destroy(); return }
    response.writeHead(200, { 'Content-Type': 'application/pdf', 'Transfer-Encoding': 'chunked',
      'Access-Control-Allow-Origin': appOrigin, 'Connection': 'close', 'Cache-Control': 'no-store' })
    response.end('synthetic-original')
  })
  const listen = async (server: Server) => {
    server.on('error', fail)
    server.on('connection', socket => { sockets.add(socket); socket.on('error', () => { if (!stopping) fail() }); socket.once('close', () => sockets.delete(socket)) })
    await within(new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen({ host: '127.0.0.1', port: 0 }, () => { server.removeListener('error', reject); resolve() })
    }))
    const address = server.address(); assert(address && typeof address !== 'string')
    return `http://127.0.0.1:${address.port}`
  }
  try {
    appOrigin = await listen(app); apiOrigin = await listen(sink)
    for (active of cases) {
      remaining()
      const plan = createContextualTestPlan('pika_assignment_list_000000000000')
      const b = new ContextualTestBoundary({ ...plan, appOrigin: appOrigin as typeof plan.appOrigin, apiOrigin: apiOrigin as typeof plan.apiOrigin }, end)
      // Synthetic policy setup only; these acknowledgements dispatch no HTTP/SQL.
      const test = '50000000-0000-4000-8000-000000000044', doc = '50000000-0000-4000-8000-000000000045', object = '50000000-0000-4000-8000-000000000046'
      const path = `classrooms/${plan.classrooms.classA.id}/tests/${test}/documents/${doc}/${object}.pdf`
      signedPath = '/storage/v1/object/sign/test-documents/' + path
      const upload = apiOrigin + '/storage/v1/object/upload/sign/test-documents/' + path + '?token=synthetic'
      const endpoint = appOrigin + `/api/teacher/tests/${test}/documents/upload`, body = { document_id: doc, byte_size: 18 }, policy = {}
      if (active === 'signed') {
        b.admit(endpoint, 'POST', body)
        await b.observe(policy, { url: () => endpoint, status: () => 200, headers: () => ({ 'content-type': 'application/json' }),
          body: async () => Buffer.from(JSON.stringify({ bucket: 'test-documents', storage_path: path, upload_url: upload, managed_object_id: object })),
        }, { method: () => 'POST', postDataJSON: () => body }, 'api')
        await b.settle(policy); b.admit(upload, 'PUT', Buffer.alloc(18))
      }
      target = active === 'signed' ? apiOrigin + signedPath + '?token=synthetic'
        : active === 'foreign' ? apiOrigin + '/sink' : appOrigin + '/api/cron/sink'
      context = await within(browser.newContext({ serviceWorkers: 'block', acceptDownloads: false }))
      const owned = context
      owned.on('close', () => { contextsClosed++ })
      owned.on('request', request => b.requestStarted(owned, request))
      owned.on('requestfinished', request => b.requestFinished(owned, request))
      owned.on('requestfailed', request => b.requestFinished(owned, request, true))
      let denied!: () => void
      const rejection = new Promise<void>(resolve => { denied = resolve })
      await within(owned.route('**/*', async route => {
        try {
          assert(!stopping); remaining(); assertContextualRedirectInterception()
          const request = route.request()
          if (request.redirectedFrom()) redirectRoutes++
          b.admit(request.url(), request.method(), undefined, request.resourceType())
          if (request.isNavigationRequest()) b.canNavigate(owned, request)
          await route.continue()
        } catch {
          if (!route.request().redirectedFrom() || active === 'signed' || !['origin', 'endpoint'].includes(b.receipt().firstFailure ?? '')) fail()
          else blocked++
          await route.abort('blockedbyclient').catch(fail); denied()
        }
      }))
      await within(owned.routeWebSocket('**/*', socket => { fail(); socket.close() }))
      const page = await within(owned.newPage())
      await within(page.goto(appOrigin + '/source', { waitUntil: 'load', timeout: remaining() }))
      if (active === 'signed') {
        const response = page.waitForResponse(response => response.url() === target, { timeout: remaining() }); void response.catch(() => {})
        const delivery = page.evaluate(() => fetch('/hop').then(r => r.arrayBuffer()).then(() => true))
        void delivery.catch(() => {})
        const original = await within(response); assert.equal(original.status(), 200)
        assert.equal(original.headers()['content-length'], undefined)
        originalBodies++; assert.equal((await within(original.body())).toString(), 'synthetic-original')
        assert.equal(await within(delivery), true); await within(b.settle(owned))
        assert.equal(b.receipt().counts.storageRequests, 2) // synthetic PUT + native redirected GET
      } else {
        if (active === 'navigation') await within(page.goto(appOrigin + '/hop', { timeout: remaining() }).then(() => { fail() }, () => {}))
        else await within(page.evaluate(kind => {
          if (kind === 'iframe') { const frame = document.createElement('iframe'); frame.src = '/hop'; document.body.append(frame) }
          else if (kind === 'worker') new Worker('/worker.js')
          else if (kind === 'popup') window.open('/hop')
          else void fetch('/hop').catch(() => {})
        }, active))
        await within(rejection)
      }
      await within(owned.close()); assert.equal(b.pending(owned), 0); context = undefined; completed++
    }
  } catch { fail() }
  finally {
    stopping = true
    try { if (context) await within(context.close()) } catch { fail() }
    const closedSockets = [...sockets].map(socket => new Promise<void>(resolve => socket.once('close', resolve)))
    const close = (server: Server) => new Promise<void>(resolve => { if (!server.listening) { resolve(); return }; server.close(error => { if (error) fail(); resolve() }) })
    const closedServers = Promise.all([close(app), close(sink)])
    for (const socket of sockets) socket.destroy()
    try { await within(Promise.all([closedServers, ...closedSockets])); remaining() } catch { fail() }
  }
  return { diagnosticOnly: true, completed, blocked, appRequests, sinkRequests, forbiddenRequests, redirectRoutes,
    originalBodies, contextsClosed, serversClosed: !app.listening && !sink.listening, socketsRemaining: sockets.size, failed }
}
