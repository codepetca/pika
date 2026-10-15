/** One synthetic loopback exchange; no Pika users, database, session or app.
 * Measures the original Playwright Response while matching fetch/json/navigate.
 * All recorded values are fixed labels, booleans, bounded counts or durations.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { Socket } from 'node:net'
import type { Browser, BrowserContext, Response } from '@playwright/test'

const events = ['page-ready', 'response', 'body-start', 'request-finished', 'request-failed', 'body-resolved',
  'body-verified', 'body-rejected', 'navigation-held', 'navigation-released', 'navigation-aborted',
  'cutoff', 'settlement-deadline', 'context-closed', 'server-closed', 'unexpected-request', 'failed'] as const
type Event = typeof events[number]
export function createLoginBodyObservation(now = Date.now) {
  const start = now(), rows: Array<{ event: Event; elapsedMs: number }> = []
  let overflow = false, requestFinished = false, bodySettled = false, bodyVerified = false, navigationHeld = false
  let atCutoff: { requestFinished: boolean; bodySettled: boolean; bodyVerified: boolean; navigationHeld: boolean } | null = null
  const mark = (event: Event) => {
    assert(events.includes(event), 'Private diagnostic label')
    requestFinished ||= event === 'request-finished'
    bodySettled ||= event === 'body-resolved' || event === 'body-rejected'
    bodyVerified ||= event === 'body-verified'
    navigationHeld ||= event === 'navigation-held'
    if (rows.length < 32) rows.push({ event, elapsedMs: Math.min(30000, Math.max(0, Math.floor(now() - start))) })
    else overflow = true
  }
  return { mark, cutoff() { atCutoff ??= { requestFinished, bodySettled, bodyVerified, navigationHeld }; mark('cutoff') },
    snapshot() { return { requestFinished, bodySettled, bodyVerified, navigationHeld, atCutoff: atCutoff && { ...atCutoff },
      overflow, events: rows.map(row => ({ ...row })) } } }
}

const requestText = '{"probe":"login"}'
const responseText = '{"success":true}'
const html = `<!doctype html><html><head><link rel="icon" href="data:,"></head><body><button>Login</button><script>
document.querySelector('button').onclick = async () => {
  const response = await fetch('/api/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},body:'${requestText}'});
  const data = await response.json(); if (response.ok && data.success) window.location.assign('/classrooms');
};</script></body></html>`

export async function runLoginBodyDiagnostic(browser: Browser, end: number) {
  assert(Number.isSafeInteger(end) && end > Date.now() && end - Date.now() <= 30000)
  const observation = createLoginBodyObservation(), sockets = new Set<Socket>()
  let context: BrowserContext | undefined, contextClosed = false, serverClosed = false
  let requests = 0, posts = 0, unexpectedRequests = 0, pageErrors = 0, failure = false, stopping = false
  let original: Response | undefined, body: Promise<void> | undefined, bodyDone = false, bodyVerified = false
  let release!: (verified: boolean) => void
  const navigation = new Promise<boolean>(resolve => { release = resolve })
  let navigationSeen!: () => void
  const held = new Promise<void>(resolve => { navigationSeen = resolve })
  const timeout = () => { const value = end - Date.now(); assert(value > 0, 'Private diagnostic deadline'); return value }
  const server = createServer((request, response) => {
    requests++
    const reject = () => { failure = true; unexpectedRequests++; observation.mark('unexpected-request'); request.destroy(); response.destroy() }
    if (stopping || Date.now() >= end || requests > 3) { reject(); return }
    request.on('error', () => { failure = true })
    response.on('error', () => { failure = true })
    response.setHeader('Connection', 'close')
    const send = (mime: string, text: string) => { response.writeHead(200, { 'Content-Type': mime, 'Content-Length': Buffer.byteLength(text) }); response.end(text) }
    if (request.method === 'GET' && request.url === '/login') { send('text/html', html); return }
    if (request.method === 'GET' && request.url === '/classrooms') { send('text/html', '<!doctype html><title>Destination</title>Done'); return }
    if (request.method !== 'POST' || request.url !== '/api/auth/login' || ++posts !== 1) { reject(); return }
    let text = ''
    request.on('data', (bytes: Buffer) => { if (!Buffer.isBuffer(bytes) || text.length + bytes.byteLength > 64) reject(); else text += bytes.toString('utf8') })
    request.on('end', () => { if (text !== requestText || !request.complete || failure || Date.now() >= end) reject(); else send('application/json', responseText) })
  })
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => { failure = true }) })
  server.on('error', () => { failure = true })
  const waitFor = async (promise: Promise<unknown>, until: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try { await Promise.race([promise, new Promise<void>(resolve => { timer = setTimeout(resolve, Math.max(0, until - Date.now())) })]) }
    finally { if (timer) clearTimeout(timer) }
  }
  try {
    {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port: 0 }, () => { server.removeListener('error', reject); resolve() }) })
      const address = server.address(); assert(address && typeof address !== 'string')
      const origin = `http://127.0.0.1:${address.port}`
      context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false })
      await context.route('**/*', async route => {
        const request = route.request(), url = request.url()
        if (stopping) { await route.abort().catch(() => {}); return }
        if (!((url === origin + '/login' || url === origin + '/classrooms') && request.method() === 'GET'
          || url === origin + '/api/auth/login' && request.method() === 'POST' && request.postData() === requestText)) {
          unexpectedRequests++; failure = true; observation.mark('unexpected-request'); await route.abort(); return
        }
        if (url === origin + '/classrooms') {
          observation.mark('navigation-held')
          navigationSeen()
          const verified = await navigation
          if (!verified || stopping || Date.now() >= end) { observation.mark('navigation-aborted'); await route.abort().catch(() => {}); return }
          observation.mark('navigation-released')
        }
        await route.continue()
      })
      await context.routeWebSocket('**/*', socket => { unexpectedRequests++; failure = true; socket.close() })
      context.on('requestfinished', request => { if (request.url() === origin + '/api/auth/login') observation.mark('request-finished') })
      context.on('requestfailed', request => { if (request.url() === origin + '/api/auth/login') observation.mark('request-failed') })
      context.on('response', response => {
        if (response.url() !== origin + '/api/auth/login') return
        if (original) { failure = true; return }
        original = response; observation.mark('response'); observation.mark('body-start')
        body = response.body().then(bytes => {
          observation.mark('body-resolved')
          assert(bytes.byteLength <= 64 && bytes.equals(Buffer.from(responseText)))
          assert.equal(response.status(), 200); assert(/application\/json/i.test(response.headers()['content-type'] ?? ''))
          bodyVerified = true; observation.mark('body-verified')
        }).catch(() => { failure = true; observation.mark('body-rejected') }).finally(() => { bodyDone = true })
      })
      const page = await context.newPage(); page.on('pageerror', () => { pageErrors++ })
      await page.goto(origin + '/login', { timeout: timeout(), waitUntil: 'load' }); observation.mark('page-ready')
      const response = page.waitForResponse(value => value.url() === origin + '/api/auth/login', { timeout: timeout() }); void response.catch(() => {})
      await Promise.all([response, page.getByRole('button', { name: 'Login', exact: true }).click({ timeout: timeout(), noWaitAfter: true })])
      assert(original && body)
      // A diagnostic observation window, not a new login or renewed deadline.
      await waitFor(Promise.all([body, held]), Math.min(end - 5000, Date.now() + 8000))
      observation.cutoff()
      const verifiedBeforeRelease = bodyVerified
      release(verifiedBeforeRelease)
      // If the hold blocked the original body, aborting that hold may release
      // it. Observe the same promise only; never refetch, replace or replay it.
      await waitFor(body, end - 2000)
      if (!bodyDone) observation.mark('settlement-deadline')
      if (verifiedBeforeRelease) await page.waitForURL(url => url.origin === origin && url.pathname === '/classrooms', { timeout: timeout(), waitUntil: 'load' })
    }
  } catch { failure = true; observation.mark('failed') }
  finally {
    stopping = true; release(false)
    try { if (context) { await context.close(); contextClosed = true; observation.mark('context-closed') } } catch { failure = true }
    // Closing may settle a pending original read; retain that timing too.
    if (body && !bodyDone && Date.now() < end) await waitFor(body, end)
    await new Promise<void>(resolve => {
      server.close(() => { serverClosed = true; observation.mark('server-closed'); resolve() })
      for (const socket of sockets) socket.destroy()
    })
  }
  return { diagnosticOnly: true, ...observation.snapshot(), contextClosed, serverClosed, socketsRemaining: sockets.size,
    requests, posts, unexpectedRequests, pageErrors, originalSeen: original !== undefined, bodyDone, failure }
}
