import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire, Module } from 'node:module'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ContextualTestBoundary } from '../../e2e/helpers/contextual-test-boundary'
import { createContextualTestPlan } from '../../e2e/helpers/contextual-test-rehearsal'

const require = createRequire(import.meta.url)
const file = join(dirname(require.resolve('playwright-core/package.json')), 'lib/server/chromium/crNetworkManager.js')
const source = readFileSync(file, 'utf8')
const plan = createContextualTestPlan('pika_assignment_list_012345abcdef')

// Exercise the installed adapter, not a mock that assumes redirect interception.
const { rewriteContextualRedirectAdapter: transform } = require('../../scripts/contextual-playwright-redirect-guard.cjs') as { rewriteContextualRedirectAdapter(value: string): string }
const { assertContextualNavigationSources: assertNavigationSources } = require('../../scripts/contextual-playwright-redirect-guard.cjs') as { assertContextualNavigationSources(sources: Record<string, Buffer>): void }
const { rewriteContextualRouteClient: transformClient } = require('../../scripts/contextual-playwright-redirect-guard.cjs') as { rewriteContextualRouteClient(source: string): string }
function clientFixture() {
  const clientFile = join(dirname(require.resolve('playwright-core/package.json')), 'lib/client/network.js')
  const compiled = new Module(clientFile) as Module & { _compile(source: string, file: string): void }
  compiled.filename = clientFile; compiled.paths = [join(dirname(require.resolve('playwright-core/package.json')), 'node_modules')]
  compiled._compile(transformClient(readFileSync(clientFile, 'utf8')), clientFile)
  const native = compiled.exports as { Route: { prototype: object } }
  const handled = vi.fn(), safeRace = vi.fn(async (promise: Promise<unknown>) => { void promise.catch(() => {}); return undefined })
  // Actual installed Route.abort/_handleRoute/_raceWithTargetClose methods;
  // only its channel reply and already-closed target are controlled here.
  const route = Object.assign(Object.create(native.Route.prototype), {
    _handlingPromise: { resolve: handled }, _didThrow: false,
    _channel: { abort: vi.fn(async (_params: { errorCode: string }) => {}) },
    request: () => ({ _targetClosedScope: () => ({ safeRace }) }),
  }) as { abort(code: string): Promise<void>; _channel: { abort: ReturnType<typeof vi.fn> }; _didThrow: boolean }
  return { route, handled, safeRace, clientFile }
}
type Session = { send: ReturnType<typeof vi.fn>; _sendMayFail: ReturnType<typeof vi.fn> }
type Route = { continue(overrides: object): Promise<void>; abort(code: string): Promise<void> }
type Request = { url(): string; method(): string; postDataBuffer(): Buffer | null; redirectedFrom(): object }
function fixture(resourceType = 'Fetch', worker = false) {
  const compiled = new Module(file) as Module & { _compile(source: string, file: string): void }
  compiled.filename = file; compiled.paths = [join(dirname(require.resolve('playwright-core/package.json')), 'node_modules')]
  compiled._compile(transform(source), file)
  const Native = (compiled.exports as { CRNetworkManager: new (page: object) => {
    _userRequestInterceptionEnabled: boolean; _protocolRequestInterceptionEnabled: boolean
    _requestIdToRequest: Map<string, object>; _handleRequestRedirect: ReturnType<typeof vi.fn>
    _onRequest(info: object, event: object, pausedInfo: object, pause: object): void
    _onRequestPaused(info: object, pause: object): void
  } }).CRNetworkManager
  const context = { attribution: {}, instrumentation: {} }, frame = { attribution: {}, instrumentation: {} }
  const started: Array<{ request: Request; route: Route }> = []
  const page = { browserContext: context, delegate: { _targetId: 'main' }, needsRequestInterception: () => true,
    frameManager: { frame: () => frame, requestStarted: (request: Request, route: Route) => started.push({ request, route }) } }
  const adapter = new Native(page)
  adapter._userRequestInterceptionEnabled = true; adapter._protocolRequestInterceptionEnabled = true
  adapter._handleRequestRedirect = vi.fn()
  const original = { request: {}, _originalRequestRoute: undefined }
  adapter._requestIdToRequest.set('network', original)
  const send = vi.fn(async () => ({})), session: Session = { send, _sendMayFail: send }
  const info = { session, ...(worker ? { workerFrame: frame } : {}) }
  const request = { url: 'http://localhost:3117/api/cron/private', method: 'GET', headers: {} }
  const event = { requestId: 'network', loaderId: resourceType === 'Document' ? 'network' : 'loader', type: resourceType,
    ...(worker ? {} : { frameId: 'main' }), request, redirectResponse: { status: 302 }, timestamp: 1, wallTime: 1, initiator: { type: 'other' } }
  const pause = { requestId: 'hop-2', networkId: 'network', redirectedRequestId: 'hop-1', frameId: 'main', resourceType, request }
  return { adapter, page, started, send, info, event, pause, original }
}

describe('pinned Chromium redirect interception', () => {
  it('pins the exact commit-event and request-identity plumbing and rejects every source drift', () => {
    const root = dirname(require.resolve('playwright-core/package.json'))
    const names = ['server/frames.js', 'server/chromium/crPage.js', 'client/frame.js', 'client/channelOwner.js', 'client/connection.js', 'server/dispatchers/frameDispatcher.js', 'protocol/validator.js',
      'server/network.js', 'server/dispatchers/networkDispatchers.js']
    const sources = Object.fromEntries(names.map(name => [name, readFileSync(join(root, 'lib', name))]))
    expect(() => assertNavigationSources(sources)).not.toThrow()
    for (const name of names) expect(() => assertNavigationSources({ ...sources, [name]: Buffer.concat([sources[name], Buffer.from('\n')]) })).toThrow('Private navigation source mismatch')
    expect(() => assertNavigationSources({})).toThrow('Private navigation source set mismatch')
  })
  it('loads before the SDK in both the CLI and its forked worker, without changing SDK bytes', () => {
    const preload = join(process.cwd(), 'scripts/contextual-playwright-preload.cjs')
    const result = spawnSync(process.execPath, ['--require', preload, join(process.cwd(), 'tests/fixtures/contextual-redirect-preload-probe.cjs')], {
      cwd: process.cwd(), timeout: 10000, maxBuffer: 16384, encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin', PIKA_BROWSER_DIAGNOSTIC: 'true' },
    })
    // This private runner deliberately rejects a different Node patch version;
    // CI's rolling Node24 may differ, and must prove rejection rather than skip.
    if (process.version === 'v24.12.0') {
      expect(result.stderr).toBe(''); expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({ parent: true, worker: true })
    } else { expect(result.status).not.toBe(0); expect(result.stderr).toContain('Private redirect interception preload rejected') }
    expect(readFileSync(file, 'utf8')).toBe(source)
  })

  it('cannot be enabled in an ordinary process or in both admission scopes', () => {
    for (const env of [{}, { PIKA_BROWSER_DIAGNOSTIC: 'true', PIKA_CONTEXTUAL_TEST_REHEARSAL: 'true' }]) {
      const result = spawnSync(process.execPath, ['--require', join(process.cwd(), 'scripts/contextual-playwright-preload.cjs'), '-e', 'process.exit(0)'], {
        cwd: process.cwd(), env, timeout: 3000, encoding: 'utf8', maxBuffer: 8192,
      })
      expect(result.status).not.toBe(0); expect(result.stderr).toContain('Private redirect interception preload rejected')
    }
  })

  it('rejects changed SDK bytes instead of guessing or silently skipping the shim', () => {
    expect(() => transform(source + '\n')).toThrow('Private redirect adapter source mismatch')
    expect(() => transform(transform(source))).toThrow('Private redirect adapter source mismatch')
    const clientSource = readFileSync(clientFixture().clientFile, 'utf8')
    expect(() => transformClient(clientSource + '\n')).toThrow('Private route client source mismatch')
    expect(() => transformClient(transformClient(clientSource))).toThrow('Private route client source mismatch')
  })

  it('does not count target closure as a client abort acknowledgement', async () => {
    const f = clientFixture(), completed = vi.fn()
    let acknowledge!: () => void
    f.route._channel.abort.mockImplementation(() => new Promise<void>(resolve => { acknowledge = resolve }))
    const abort = f.route.abort('aborted').then(completed)
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(f.safeRace).not.toHaveBeenCalled(); expect(completed).not.toHaveBeenCalled(); expect(f.handled).not.toHaveBeenCalled()
    acknowledge(); await abort
    expect(completed).toHaveBeenCalledOnce(); expect(f.handled).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('propagates a client command rejection even if its target is already closed', async () => {
    const f = clientFixture()
    f.route._channel.abort.mockRejectedValue(Error('private channel rejection'))
    await expect(f.route.abort('aborted')).rejects.toThrow('private channel rejection')
    expect(f.safeRace).not.toHaveBeenCalled(); expect(f.handled).not.toHaveBeenCalled(); expect(f.route._didThrow).toBe(true)
  })
  it.each(['Document', 'Fetch', 'XHR', 'Image', 'Script', 'Font'])('routes a redirected %s before any native continuation', async resource => {
    const f = fixture(resource)
    f.adapter._onRequest(f.info, f.event, f.info, f.pause)
    expect(f.send).not.toHaveBeenCalled()
    expect(f.started).toHaveLength(1)
    expect(f.started[0].route).toBeDefined()
    expect(f.started[0].request.redirectedFrom()).toBe(f.original.request)
    await f.started[0].route.abort('blockedbyclient')
    expect(f.send).toHaveBeenCalledExactlyOnceWith('Fetch.failRequest', { requestId: 'hop-2', errorReason: 'BlockedByClient' })
  })

  it('retains worker-frame interception instead of a page-only CDP guard', () => {
    const f = fixture('Fetch', true)
    f.adapter._onRequest(f.info, f.event, f.info, f.pause)
    expect(f.send).not.toHaveBeenCalled()
    expect(f.started[0].route).toBeDefined()
  })

  it('continues the original redirected request exactly once without rewriting it', async () => {
    const f = fixture()
    f.adapter._onRequest(f.info, f.event, f.info, f.pause)
    await f.started[0].route.continue({})
    expect(f.send).toHaveBeenCalledExactlyOnceWith('Fetch.continueRequest', {
      requestId: 'hop-2', url: undefined, headers: undefined, method: undefined, postData: undefined,
    })
  })

  it('rejects a failed native abort even when a matching failed terminal was observed', async () => {
    const f = fixture(), b = new ContextualTestBoundary(plan, Date.now() + 30000), context = {}
    f.adapter._onRequest(f.info, f.event, f.info, f.pause)
    const { request, route } = f.started[0]
    b.requestStarted(context, request); b.requestIntercepted(context, request, 'GET')
    f.send.mockImplementation(async () => {
      b.requestFinished(context, request, true)
      throw Error('Invalid InterceptionId')
    })
    await expect(b.cancelUnsentRead(context, request, () => route.abort('aborted'), Date.now() + 1000)).rejects.toThrow()
    expect(b.receipt().firstFailure).toBe('response-body')
    expect(b.pending(context)).toBe(1)
  })

  it.each(['url', 'method', 'headers', 'postData'])('rejects request %s overrides rather than change redirect inheritance', async key => {
    const f = fixture()
    f.adapter._onRequest(f.info, f.event, f.info, f.pause)
    await expect(f.started[0].route.continue({ [key]: 'private' })).rejects.toThrow('overrides prohibited')
    expect(f.send).not.toHaveBeenCalled()
  })

  it('uses the browser-provided POST body for a 307/308 hop without guessing method rewriting', () => {
    const f = fixture()
    f.pause.request.method = 'POST'
    Object.assign(f.pause.request, { postDataEntries: [{ bytes: Buffer.from('{"value":1}').toString('base64') }] })
    f.adapter._onRequest(f.info, f.event, f.info, f.pause)
    expect(f.started[0].request.method()).toBe('POST')
    expect(f.started[0].request.postDataBuffer()?.toString()).toBe('{"value":1}')
    expect(f.send).not.toHaveBeenCalled()
  })

  it('aborts unattributable pauses and fails instead of automatically continuing', () => {
    const f = fixture()
    expect(() => f.adapter._onRequestPaused(f.info, { ...f.pause, networkId: undefined })).toThrow('correlation missing')
    expect(f.send).toHaveBeenCalledExactlyOnceWith('Fetch.failRequest', { requestId: 'hop-2', errorReason: 'BlockedByClient' })
  })

  it('aborts unknown frames instead of automatically continuing a redirect', () => {
    const f = fixture()
    f.page.frameManager.frame = () => undefined as never
    expect(() => f.adapter._onRequest(f.info, { ...f.event, frameId: 'unknown' }, f.info, f.pause)).toThrow('ownership missing')
    expect(f.send).toHaveBeenCalledExactlyOnceWith('Fetch.failRequest', { requestId: 'hop-2', errorReason: 'BlockedByClient' })
  })

  it.each([
    ['foreign', 'http://127.0.0.1:1/sink', 'GET'],
    ['prohibited', plan.appOrigin + '/api/cron/private', 'GET'],
    ['mutation', plan.appOrigin + '/api/auth/signup', 'POST'],
    ['unreserved', plan.apiOrigin + '/storage/v1/object/sign/test-documents/unknown?token=private', 'GET'],
  ])('passes a redirected %s target to the real boundary before any continuation', async (_name, url, method) => {
    const f = fixture(), boundary = new ContextualTestBoundary(plan, Date.now() + 30000)
    f.pause.request.url = url; f.pause.request.method = method
    f.adapter._onRequest(f.info, f.event, f.info, f.pause)
    const { request, route } = f.started[0]
    expect(() => boundary.admit(request.url(), request.method())).toThrow()
    await route.abort('blockedbyclient')
    expect(f.send).toHaveBeenCalledExactlyOnceWith('Fetch.failRequest', { requestId: 'hop-2', errorReason: 'BlockedByClient' })
  })

  it('charges each same-origin hop and rejects the next hop at the unchanged cap', async () => {
    const boundary = new ContextualTestBoundary(plan, Date.now() + 30000)
    for (let index = 0; index < 950; index++) boundary.admit(plan.appOrigin + '/allowed', 'GET')
    const f = fixture(); f.pause.request.url = plan.appOrigin + '/allowed'
    f.adapter._onRequest(f.info, f.event, f.info, f.pause)
    expect(() => boundary.admit(f.started[0].request.url(), 'GET')).toThrow()
    expect(boundary.receipt().firstFailure).toBe('request-cap')
    await f.started[0].route.abort('blockedbyclient')
    expect(f.send).toHaveBeenCalledExactlyOnceWith('Fetch.failRequest', { requestId: 'hop-2', errorReason: 'BlockedByClient' })
  })

  it('does not give redirected requests a new boundary deadline', async () => {
    let now = 1000
    const boundary = new ContextualTestBoundary(plan, 2000, () => now), f = fixture()
    boundary.admit(plan.appOrigin + '/source', 'GET'); now = 2000
    f.pause.request.url = plan.appOrigin + '/allowed'
    f.adapter._onRequest(f.info, f.event, f.info, f.pause)
    expect(() => boundary.admit(f.started[0].request.url(), 'GET')).toThrow()
    expect(boundary.receipt().firstFailure).toBe('deadline')
    await f.started[0].route.abort('blockedbyclient')
    expect(f.send).toHaveBeenCalledExactlyOnceWith('Fetch.failRequest', { requestId: 'hop-2', errorReason: 'BlockedByClient' })
  })
})
