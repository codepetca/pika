/** One bounded synthetic original-response exchange. No Pika app, credentials,
 * database, fixture mutation or browser launcher. Uses the standard fixture. */
import assert from 'node:assert/strict'
import { createServer, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import type { Browser, BrowserContext } from '@playwright/test'
import { ContextualTestBoundary } from './contextual-test-boundary'
import { createContextualTestPlan } from './contextual-test-rehearsal'

type Stage = 'setup' | 'pre-header' | 'body' | 'departure' | 'cleanup'
const html = '<!doctype html><html><head><link rel="icon" href="data:,"></head><body>Synthetic navigation source</body></html>'
export async function runNavigationLifecycleDiagnostic(browser: Browser, end: number) {
  assert(Number.isSafeInteger(end) && end > Date.now() && end - Date.now() <= 30000)
  let stage: Stage = 'setup', failure: Stage | null = null, stopping = false
  const fail = () => { failure ??= stage }
  const sockets = new Set<Socket>(), paths = new Set<string>()
  let requests = 0, jsonRequests = 0, originalBodies = 0, unexpectedRequests = 0, pageErrors = 0
  let preHeaderHeld = false, bodyHeld = false, bodyVerified = false, destinationAfterValidation = false
  let contextClosed = false, serverClosed = false, departureStarted = false
  let context: BrowserContext | undefined, boundary: ContextualTestBoundary | undefined, data: ServerResponse | undefined
  let seen!: () => void, headersSeen!: () => void
  const received = new Promise<void>(resolve => { seen = resolve })
  const headers = new Promise<void>(resolve => { headersSeen = resolve })
  let verified: Promise<void> | undefined, departure: Promise<void> | undefined
  const remaining = () => { const ms = end - Date.now(); assert(ms > 0, 'Private navigation diagnostic deadline'); return ms }
  const within = async <T>(work: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error('Private navigation diagnostic deadline')), Math.max(0, end - Date.now()))
    })]) } finally { if (timer) clearTimeout(timer) }
  }
  const server = createServer((request, response) => {
    requests = Math.min(4, requests + 1)
    const reject = () => { fail(); unexpectedRequests = Math.min(4, unexpectedRequests + 1); request.destroy(); response.destroy() }
    if (stopping || Date.now() >= end || requests > 3 || request.method !== 'GET'
      || !['/source', '/data', '/destination'].includes(request.url ?? '') || paths.has(request.url!)) { reject(); return }
    paths.add(request.url!)
    request.on('error', () => { if (!stopping) fail() }); response.on('error', () => { if (!stopping) fail() })
    response.setHeader('Connection', 'close')
    response.setHeader('Cache-Control', 'no-store')
    if (request.url === '/data') { jsonRequests++; data = response; seen(); return }
    if (request.url === '/destination') {
      if (!bodyVerified || !departureStarted) { reject(); return }
      destinationAfterValidation = true
    }
    response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html)
  })
  server.on('connection', socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => { if (!stopping) fail() })
  })
  server.on('error', fail)
  try {
    await within(new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen({ host: '127.0.0.1', port: 0 }, () => { server.removeListener('error', reject); resolve() })
    }))
    const address = server.address(); assert(address && typeof address !== 'string')
    const origin = `http://127.0.0.1:${address.port}`
    // Test-only transport origin. The plan is inert data; none of its fixture,
    // actor, SQL or application operations is invoked by this diagnostic.
    const plan = createContextualTestPlan('pika_assignment_list_000000000000')
    boundary = new ContextualTestBoundary({ ...plan, appOrigin: origin as typeof plan.appOrigin }, end)
    context = await within(browser.newContext({ serviceWorkers: 'block', acceptDownloads: false }))
    context.on('close', () => { contextClosed = true })
    context.on('request', request => boundary!.requestStarted(context!, request))
    context.on('requestfinished', request => boundary!.requestFinished(context!, request))
    context.on('requestfailed', request => boundary!.requestFinished(context!, request, true))
    context.on('response', response => {
      if (response.url() !== origin + '/data') { void boundary!.observe(context!, response, response.request()); return }
      if (verified) { fail(); return }
      verified = boundary!.observe(context!, {
        url: () => response.url(), status: () => response.status(), headers: () => response.headers(),
        body: () => { originalBodies++; return response.body() },
      }, response.request()).then(value => {
        boundary!.check(); assert.equal(response.status(), 200); assert.deepEqual(value, { proof: true }); bodyVerified = true
      })
      void verified.catch(() => {}); headersSeen()
    })
    await within(context.route('**/*', async route => {
      try {
        const request = route.request(), url = request.url()
        assert(!stopping && request.method() === 'GET' && ['/source', '/data', '/destination'].some(path => url === origin + path))
        boundary!.admit(url, request.method(), undefined, request.resourceType())
        if (request.isNavigationRequest()) boundary!.canNavigate(context!, request)
        await route.continue()
      } catch { fail(); unexpectedRequests = Math.min(4, unexpectedRequests + 1); await route.abort('blockedbyclient').catch(() => {}) }
    }))
    await within(context.routeWebSocket('**/*', socket => { fail(); unexpectedRequests = Math.min(4, unexpectedRequests + 1); socket.close() }))
    const page = await within(context.newPage()); page.on('pageerror', () => { pageErrors = Math.min(4, pageErrors + 1); fail() })
    await within(page.goto(origin + '/source', { waitUntil: 'load', timeout: remaining() }))
    stage = 'pre-header'
    await within(page.evaluate(() => { void fetch('/data').then(response => response.json()).catch(() => {}) }))
    await within(received); assert(data && boundary.pending(context) > 0)
    departure = boundary.depart(context, end, async timeout => {
      assert(verified && bodyVerified); boundary!.check()
      departureStarted = true
      await page.goto(origin + '/destination', { waitUntil: 'load', timeout })
    })
    void departure.catch(() => {})
    // A browser roundtrip provides an event barrier, not an arbitrary delay or
    // network-idle heuristic. The server still holds the first response header.
    await within(page.evaluate(() => document.readyState))
    preHeaderHeld = !departureStarted && !verified && boundary.pending(context) > 0
    assert(preHeaderHeld)
    stage = 'body'
    data.writeHead(200, { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' }); data.write('{"proof":')
    await within(headers); await within(page.evaluate(() => document.readyState))
    bodyHeld = !departureStarted && !bodyVerified && boundary.pending(context) > 0
    assert(bodyHeld)
    data.end('true}')
    stage = 'departure'; await within(departure)
    assert.equal(page.url(), origin + '/destination')
    assert(requests === 3 && jsonRequests === 1 && originalBodies === 1 && destinationAfterValidation)
  } catch { fail() }
  finally {
    stage = 'cleanup'; stopping = true
    try { if (context && boundary) await within(boundary.beforeContextClose(context, () => context!.close())) }
    catch { fail() }
    // A late operation remains owned and observed even when its deadline failed.
    if (departure) void departure.catch(() => {})
    const socketClosures = [...sockets].map(socket => new Promise<void>(resolve => { socket.once('close', resolve) }))
    const closing = new Promise<void>(resolve => { server.close(error => { if (error) fail(); else serverClosed = true; resolve() }) })
    for (const socket of sockets) socket.destroy()
    try { await within(Promise.all([closing, ...socketClosures])); remaining() } catch { fail() }
    if (!contextClosed || !serverClosed || sockets.size || (context && boundary?.pending(context))) fail()
  }
  return { diagnosticOnly: true as const, preHeaderHeld, bodyHeld, bodyVerified, destinationAfterValidation,
    requests, jsonRequests, originalBodies, unexpectedRequests, pageErrors, pending: context ? boundary?.pending(context) ?? 0 : 0,
    boundaryFailed: boundary?.receipt().firstFailure !== null && boundary !== undefined,
    contextClosed, serverClosed, socketsRemaining: sockets.size, failure }
}
