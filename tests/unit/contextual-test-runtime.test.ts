import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Browser, Page, Response, TestInfo } from '@playwright/test'

const platform = vi.hoisted(() => ({ readContextualTestBinding: vi.fn(), executeContextualTestSql: vi.fn() }))
vi.mock('../../scripts/contextual-test-rehearsal-binding', () => platform)
vi.mock('../../scripts/contextual-playwright-redirect-guard.cjs', () => ({ assertContextualRedirectInterception: vi.fn() }))
import { createContextualTestLoginProgress, createContextualTestRuntime } from '../../e2e/helpers/contextual-test-runtime'
import { createContextualTestPlan, type ActorLabel } from '../../e2e/helpers/contextual-test-rehearsal'

const plan = createContextualTestPlan('pika_assignment_list_012345abcdef')
const password = 'CPU-private-login-password'
const loginSteps = ['context', 'setup', 'page', 'navigate', 'preset', 'form-ready', 'email', 'password', 'submit', 'response-body', 'redirect', 'session', 'identity'] as const
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
class FakeRequest {
  ownerPage?: FakePage
  constructor(private target: string, private verb = 'GET', private data?: unknown, private navigationPage?: FakePage) {}
  url = () => this.target
  method = () => this.verb
  resourceType = () => this.target.startsWith('https://fonts.googleapis.com/') ? 'stylesheet' : this.navigationPage ? 'document' : 'fetch'
  postDataJSON = () => this.data
  postDataBuffer = () => this.data ? Buffer.from(JSON.stringify(this.data)) : null
  isNavigationRequest = () => Boolean(this.navigationPage)
  frame = () => (this.navigationPage ?? this.ownerPage)!.mainFrame()
  redirectedFrom = () => null
}
class FakeResponse {
  readonly body: ReturnType<typeof vi.fn<() => Promise<Buffer>>>
  readonly dispose = vi.fn(async () => {})
  constructor(readonly page: FakePage, private req: FakeRequest, value: unknown = {}, private code = 200,
    body?: () => Promise<Buffer>) {
    this.body = vi.fn(body ?? (async () => Buffer.from(JSON.stringify(value))))
  }
  url = () => this.req.url()
  status = () => this.code
  headers = () => ({ 'content-type': 'application/json' })
  request = () => this.req
  frame = () => ({ page: () => this.page })
}
class FakePage extends EventEmitter {
  readonly labels: Array<string | RegExp> = []
  readonly fills: Array<{ label: string | RegExp; value: string }> = []
  readonly roles: Array<{ role: string; options: unknown }> = []
  private current = plan.appOrigin + '/login'
  private loginWait?: ReturnType<typeof deferred<FakeResponse>>
  private loginPredicate?: (response: FakeResponse) => boolean
  loginResponse?: FakeResponse
  loginBody?: () => Promise<Buffer>
  raceNavigation = false
  navigationStarted = false
  navigationCommitted = false
  navigationAborted = false
  navigationTask?: Promise<void>
  loginStatus = 200
  hydrated = false
  neverHydrates = false
  presetActivations = 0
  loginPosts = 0
  readyEnd?: number
  advanceOnPreset = 0
  private email = ''
  private secret = ''
  private domEmail = ''
  private domSecret = ''
  readonly goto = vi.fn(async (url: string, options: { waitUntil: string }) => {
    if (!await this.owner.navigate(this, url)) throw Error('CPU rejected navigation')
    if (options.waitUntil === 'load' && !this.neverHydrates) this.hydrated = true
  })
  readonly reload = vi.fn(async () => {
    if (!await this.owner.navigate(this, this.current, true)) throw Error('CPU rejected reload')
  })
  readonly waitForFunction = vi.fn(async (_predicate: () => boolean, _arg: undefined, options: { timeout: number }) => {
    this.readyEnd = Date.now() + options.timeout
    if (!(this.hydrated && this.email === 'teacher@example.com' && this.secret === 'test1234')) {
      await new Promise<void>((_resolve, reject) => setTimeout(() => reject(Error('CPU form not hydrated')), options.timeout))
    }
  })
  readonly waitForURL = vi.fn(async (predicate: (url: URL) => boolean) => {
    await this.navigationTask
    expect(predicate(new URL(this.current))).toBe(true)
  })
  private readonly frame = { page: () => this, _eventEmitter: new EventEmitter() }
  mainFrame = () => this.frame
  frames = () => [this.frame]
  commit(url: string, request?: FakeRequest) {
    this.current = url
    this.frame._eventEmitter.emit('navigated', { url, ...(request ? { newDocument: { request: { _object: request } } } : {}) })
  }
  constructor(readonly owner: FakeContext) { super() }
  context = () => this.owner
  url = () => this.current
  getByLabel(label: string | RegExp) {
    this.labels.push(label)
    return { fill: async (value: string) => {
      this.fills.push({ label, value })
      if (label === 'School Email') { this.domEmail = value; if (this.hydrated) this.email = value }
      else { this.domSecret = value; if (this.hydrated) this.secret = value }
    } }
  }
  getByRole(role: string, options: { name: string; exact: boolean }) {
    this.roles.push({ role, options })
    return { click: async (clickOptions?: { noWaitAfter?: boolean }) => {
      if (options.name === 'Teacher') {
        this.presetActivations++
        if (this.advanceOnPreset) vi.setSystemTime(Date.now() + this.advanceOnPreset)
        if (this.hydrated) { this.email = this.domEmail = 'teacher@example.com'; this.secret = this.domSecret = 'test1234' }
        return
      }
      if (!this.email || !this.secret) throw Error('CPU disabled Login with unhydrated inputs')
      expect(this.domEmail).toBe(this.owner.actor.email); expect(this.domSecret).toBe(password)
      this.loginPosts++
      const request = new FakeRequest(plan.appOrigin + '/api/auth/login', 'POST', { email: this.email, password: this.secret })
      await this.owner.dispatch(request)
      const originalBody = this.loginBody ?? (async () => Buffer.from('{"success":true}'))
      this.loginResponse = new FakeResponse(this, request, { success: true }, this.loginStatus, async () => {
        // The app has consumed its Fetch body before assigning location. The
        // separate inspector read can still be in flight at document commit.
        let bytes: Buffer
        try { bytes = await originalBody() }
        catch (error) { this.owner.emit('requestfailed', request); throw error }
        this.owner.emit('requestfinished', request)
        if (this.raceNavigation) await new Promise(resolve => setTimeout(resolve, 1))
        if (this.navigationCommitted) throw Error('Protocol error (Network.getResponseBody): No resource with given identifier found')
        return bytes
      })
      this.owner.emit('response', this.loginResponse)
      expect(this.loginPredicate?.(this.loginResponse)).toBe(true)
      this.loginWait!.resolve(this.loginResponse)
      this.navigationTask = this.owner.loginReady().then(async () => {
        this.navigationStarted = true
        if (this.raceNavigation) {
          const continued = await this.owner.navigate(this)
          this.navigationCommitted = continued; this.navigationAborted = !continued
          if (continued) this.current = plan.appOrigin + '/classrooms'
        } else this.current = plan.appOrigin + '/classrooms'
      }).catch(() => { this.navigationAborted = true })
      if (!clickOptions?.noWaitAfter) await this.navigationTask
    } }
  }
  waitForResponse(predicate: (response: FakeResponse) => boolean) {
    this.loginPredicate = predicate; this.loginWait = deferred<FakeResponse>(); return this.loginWait.promise
  }
}
class FakeContext extends EventEmitter {
  private loginBinding?: (source: unknown) => Promise<boolean>
  readonly exposeBinding = vi.fn(async (_name: string, callback: (source: unknown) => Promise<boolean>) => { this.loginBinding = callback })
  readonly addInitScript = vi.fn(async () => {})
  loginReady() { return this.loginBinding!({ context: this, page: this.page, frame: this.page.mainFrame() }) }
  readonly actor: (typeof plan.actors)[ActorLabel]
  readonly page: FakePage
  readonly setDefaultTimeout = vi.fn()
  readonly setDefaultNavigationTimeout = vi.fn()
  readonly serviceWorkers = vi.fn(() => [])
  readonly routeWebSocket = vi.fn(async () => {})
  readonly close = vi.fn(async () => { this.events.push('context-close'); this.emit('close') })
  readonly newPage = vi.fn(async () => { this.emit('page', this.page); return this.page })
  readonly requests: Array<{ url: string; options: Record<string, unknown> }> = []
  readonly responses: FakeResponse[] = []
  fetchReply?: (url: string, options: Record<string, unknown>) => FakeResponse
  beforeCommit?: () => Promise<void>
  private routeHandler?: (route: { request(): FakeRequest; continue(): Promise<void>; abort(): Promise<void> }) => Promise<void>
  readonly route = vi.fn(async (_pattern: string, handler: typeof this.routeHandler) => { this.routeHandler = handler })
  readonly request = { fetch: vi.fn(async (url: string, options: Record<string, unknown>) => {
    this.requests.push({ url, options })
    const response = this.fetchReply?.(url, options) ?? new FakeResponse(this.page, new FakeRequest(url, String(options.method)), { user: this.actor })
    this.responses.push(response); return response
  }) }
  constructor(actorLabel: ActorLabel = 'ownerTeacher', readonly events: string[] = []) {
    super(); this.actor = plan.actors[actorLabel]; this.page = new FakePage(this)
  }
  async dispatch(request: FakeRequest) {
    request.ownerPage = this.page
    this.emit('request', request)
    const continued = vi.fn(async () => {}), aborted = vi.fn(async () => {})
    await this.routeHandler?.({ request: () => request, continue: continued, abort: aborted })
    expect(continued).toHaveBeenCalledOnce(); expect(aborted).not.toHaveBeenCalled()
  }
  async navigate(page: FakePage, url = plan.appOrigin + '/classrooms', reload = false) {
    const current = new URL(page.url()), next = new URL(url)
    const samePath = current.origin + current.pathname + current.search === next.origin + next.pathname + next.search
    if (!reload && samePath && (current.href !== next.href || next.hash !== '')) { page.commit(url); return true }
    const request = new FakeRequest(url, 'GET', undefined, page)
    this.emit('request', request)
    let continued = false
    await this.routeHandler?.({ request: () => request, continue: async () => { continued = true }, abort: async () => {} })
    if (continued) { await this.beforeCommit?.(); page.commit(url, request) }
    this.emit(continued ? 'requestfinished' : 'requestfailed', request)
    return continued
  }
  async foreignResource() {
    const request = new FakeRequest('https://fonts.googleapis.com/css2?family=PRIVATE-FONT&token=SECRET')
    const continued = vi.fn(async () => {}), aborted = vi.fn(async () => {})
    this.emit('request', request)
    await this.routeHandler?.({ request: () => request, continue: continued, abort: aborted })
    this.emit('requestfailed', request)
    expect(continued).not.toHaveBeenCalled(); expect(aborted).toHaveBeenCalledOnce()
  }
}
class FakeBrowser {
  readonly contexts: FakeContext[] = []
  readonly newContext = vi.fn(async (_options: unknown) => {
    const context = new FakeContext(this.actorLabel, this.events)
    this.configure?.(context); this.contexts.push(context); return context
  })
  configure?: (context: FakeContext) => void
  constructor(readonly actorLabel: ActorLabel = 'ownerTeacher', readonly events: string[] = []) {}
}

const outputs: string[] = []
const handles: Array<Awaited<ReturnType<typeof createContextualTestRuntime>>> = []
beforeEach(() => {
  vi.stubEnv('PIKA_CONTEXTUAL_TEST_REHEARSAL', 'true')
  vi.stubEnv('PIKA_CONTEXTUAL_TEST_BINDING_FILE', '/CPU-mocked-no-file-binding.json')
  vi.stubEnv('PIKA_CONTEXTUAL_TEST_BINDING_SHA256', 'a'.repeat(64))
  platform.readContextualTestBinding.mockReset(); platform.executeContextualTestSql.mockReset()
})
afterEach(async () => {
  for (const handle of handles.splice(0)) { try { await handle.close('failed') } catch { /* Expected fixed failed receipt or already closed. */ } }
  for (const output of outputs.splice(0)) rmSync(output, { recursive: true })
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
async function setup(browser = new FakeBrowser(), leaseMs = 120000, stage?: Parameters<typeof createContextualTestRuntime>[2]) {
  const outputDir = realpathSync(mkdtempSync(join(tmpdir(), 'contextual-runtime-cpu-'))); outputs.push(outputDir)
  platform.readContextualTestBinding.mockReturnValue({ projectId: plan.projectId, password, deadline: Date.now() + leaseMs, outputDir })
  const handle = await createContextualTestRuntime(browser as unknown as Browser, {} as TestInfo, stage)
  handles.push(handle)
  return { ...handle, browser, outputDir, receipt: () => JSON.parse(readFileSync(join(outputDir, 'playwright-receipt.json'), 'utf8')) }
}

describe('actual contextual Test runtime with CPU browser doubles', () => {
  it.each(['navigate', 'reload'] as const)('cancels only unsent late reads around native %s and releases destination assets after commit', async mode => {
    const s = await setup(), sends = vi.fn(), aborts = vi.fn()
    await s.runtime.withActor('ownerTeacher', async page => {
      const c = s.browser.contexts[0], originalRequest = new FakeRequest(plan.appOrigin + '/api/auth/me')
      await c.dispatch(originalRequest)
      const body = deferred<Buffer>(), original = new FakeResponse(c.page, originalRequest, {}, 200, () => body.promise)
      c.emit('response', original); c.emit('requestfinished', originalRequest)
      const lateRead = async (method: string) => {
        const read = new FakeRequest(plan.appOrigin + '/api/auth/me', method); read.ownerPage = c.page
        c.emit('request', read)
        await c.route.mock.calls[0][1]!({ request: () => read, continue: async () => { sends() },
          abort: async () => { aborts(); c.emit('requestfailed', read) } })
      }
      c.beforeCommit = () => lateRead('HEAD')
      const command = async () => {
        // Model the server dispatcher's await before native navigation. This
        // request arrives after the final drain, not in a host-only microtask.
        await Promise.resolve()
        const cancelled = lateRead('GET')
        const navigated = c.navigate(c.page, mode === 'reload' ? c.page.url() : plan.appOrigin + '/pattern-lab', mode === 'reload')
        await Promise.all([cancelled, navigated])
        const asset = new FakeRequest(plan.appOrigin + '/_next/static/asset.js')
        await c.dispatch(asset); c.emit('requestfinished', asset)
      }
      c.page.goto.mockImplementation(command); c.page.reload.mockImplementation(command)
      const departing = mode === 'reload' ? s.runtime.reload(page) : s.runtime.navigate(page, plan.appOrigin + '/pattern-lab')
      await Promise.resolve(); expect(c.page.reload).not.toHaveBeenCalled(); expect(c.page.goto).toHaveBeenCalledTimes(1)
      body.resolve(Buffer.from('{}')); await departing
      expect(original.body).toHaveBeenCalledOnce(); expect(sends).not.toHaveBeenCalled(); expect(aborts).toHaveBeenCalledTimes(2)
    })
    await expect(s.close('failed')).rejects.toThrow()
    expect(s.receipt().firstFailure).toBeNull(); expect(s.receipt().pending).toBe(0)
  })
  it('does not let cancellation conceal a prohibited endpoint or skip admission', async () => {
    const s = await setup(), send = vi.fn()
    await expect(s.runtime.withActor('ownerTeacher', async page => {
      const c = s.browser.contexts[0]
      c.page.goto.mockImplementation(async () => {
        const request = new FakeRequest(plan.appOrigin + '/api/billing/private'); request.ownerPage = c.page
        c.emit('request', request)
        await c.route.mock.calls[0][1]!({ request: () => request, continue: async () => { send() }, abort: async () => { c.emit('requestfailed', request) } })
      })
      await s.runtime.navigate(page, plan.appOrigin + '/pattern-lab')
    })).rejects.toThrow()
    await expect(s.close('failed')).rejects.toThrow()
    expect(send).not.toHaveBeenCalled(); expect(s.receipt().endpointFailure.reason).toBe('prohibited-api')
  })
  it.each(['navigate', 'reload'] as const)('does not insert a host microtask gap before %s command dispatch', async mode => {
    const s = await setup(), events: string[] = []
    await s.runtime.withActor('ownerTeacher', async page => {
      const c = s.browser.contexts[0]
      const command = async () => {
        events.push('command')
        // Unlike the default inert doubles, this emits request, route and finish.
        if (!await c.navigate(c.page, mode === 'reload' ? c.page.url() : plan.appOrigin + '/pattern-lab', mode === 'reload')) throw Error('CPU rejected navigation')
      }
      c.page.goto.mockImplementation(command); c.page.reload.mockImplementation(command)
      queueMicrotask(() => {
        events.push('late-host-event')
        const request = new FakeRequest(plan.appOrigin + '/api/auth/me')
        c.emit('request', request)
        c.emit('response', new FakeResponse(c.page, request))
        c.emit('requestfinished', request)
      })
      if (mode === 'reload') await s.runtime.reload(page)
      else await s.runtime.navigate(page, plan.appOrigin + '/pattern-lab')
      expect(events).toEqual(['command', 'late-host-event'])
      // This asserts host dispatch ordering, NOT atomic native navigation.
    })
  })
  it.each(['route-inspection', 'route-continue'] as const)('retains the actual %s rejection branch without private error data', async phase => {
    const s = await setup()
    await expect(s.runtime.withActor('ownerTeacher', async () => {
      const c = s.browser.contexts[0], request = new FakeRequest(plan.appOrigin + '/allowed')
      c.emit('request', request)
      if (phase === 'route-inspection') request.url = () => { throw Error('PRIVATE-URL') }
      await c.route.mock.calls[0][1]!({ request: () => request,
        continue: async () => { throw Error('PRIVATE-CONTINUATION') }, abort: async () => {} })
      c.emit('requestfailed', request)
    })).rejects.toThrow()
    await expect(s.close('failed')).rejects.toThrow()
    expect(s.receipt().endpointFailure).toEqual({ reason: phase, transports: 0, bodies: 0,
      ...(phase === 'route-inspection' ? { detail: 'route-callback' } : {}) })
    expect(JSON.stringify(s.receipt())).not.toMatch(/PRIVATE-URL|PRIVATE-CONTINUATION/)
  })
  it('identifies premature login navigation without releasing it', async () => {
    const browser = new FakeBrowser()
    browser.configure = c => { c.page.loginBody = async () => {
      expect(await c.navigate(c.page)).toBe(false)
      return Buffer.from('{"success":true}')
    } }
    const s = await setup(browser), callback = vi.fn()
    await expect(s.runtime.withActor('ownerTeacher', callback)).rejects.toThrow()
    await expect(s.close('failed')).rejects.toThrow()
    expect(callback).not.toHaveBeenCalled()
    expect(s.receipt().endpointFailure?.reason).toBe('navigation-before-login')
  })
  it('keeps an explicit reload after draining rather than substituting same-document navigation', async () => {
    const s = await setup()
    await s.runtime.withActor('ownerTeacher', async page => {
      const c = s.browser.contexts[0], request = new FakeRequest(plan.appOrigin + '/incidental')
      await c.dispatch(request)
      const reloading = s.runtime.reload(page)
      await Promise.resolve(); expect(c.page.reload).not.toHaveBeenCalled()
      const response = new FakeResponse(c.page, request)
      c.emit('response', response); c.emit('requestfinished', request); await reloading
      expect(c.page.reload).toHaveBeenCalledWith(expect.objectContaining({ waitUntil: 'domcontentloaded' }))
      expect(c.page.goto).toHaveBeenCalledTimes(1)
    })
  })
  it('rejects positive-length original browser login before body acquisition or identity dispatch', async () => {
    const browser = new FakeBrowser()
    browser.configure = c => c.on('response', (response: FakeResponse) => {
      Object.assign(response, { headers: () => ({ 'content-type': 'application/json', 'content-length': '16' }) })
      // Transport finishes independently of whether the inspector read is used.
      c.emit('requestfinished', response.request())
    })
    const s = await setup(browser), callback = vi.fn()
    await expect(s.runtime.withActor('ownerTeacher', callback)).rejects.toThrow()
    const c = browser.contexts[0]
    expect(c.page.loginResponse!.body).not.toHaveBeenCalled(); expect(c.requests).toEqual([])
    expect(callback).not.toHaveBeenCalled()
  })
  it('still accepts positive-length APIResponse identity bodies without using the browser adapter', async () => {
    const browser = new FakeBrowser()
    browser.configure = c => { c.fetchReply = url => Object.assign(new FakeResponse(c.page, new FakeRequest(url), { user: c.actor }), {
      headers: () => ({ 'content-type': 'application/json', 'content-length': '128' }),
    }) }
    const s = await setup(browser), callback = vi.fn()
    await s.runtime.withActor('ownerTeacher', callback)
    expect(callback).toHaveBeenCalledOnce(); expect(browser.contexts[0].responses[0].body).toHaveBeenCalledOnce()
  })
  it('waits for a pre-header request and its completion-delayed body before owned navigation', async () => {
    const s = await setup(), entered = deferred<void>(), headers = deferred<void>(), body = deferred<Buffer>()
    const work = s.runtime.withActor('ownerTeacher', async page => {
      const c = s.browser.contexts[0], request = new FakeRequest(plan.appOrigin + '/api/teacher/classrooms')
      await c.dispatch(request)
      const navigating = s.runtime.navigate(page, plan.appOrigin + '/pattern-lab', 'load')
      entered.resolve(); await headers.promise
      const response = new FakeResponse(c.page, request, {}, 200, () => body.promise)
      c.emit('response', response); c.emit('requestfinished', request)
      await Promise.resolve(); expect(c.page.goto).toHaveBeenCalledTimes(1)
      body.resolve(Buffer.from('{}')); await navigating
      expect(response.body).toHaveBeenCalledOnce()
      expect(c.page.goto).toHaveBeenLastCalledWith(plan.appOrigin + '/pattern-lab', expect.objectContaining({ waitUntil: 'load' }))
    })
    await entered.promise; expect(s.browser.contexts[0].page.goto).toHaveBeenCalledTimes(1)
    headers.resolve(); await work
  })
  it('never starts navigation after an incidental JSON body fails', async () => {
    const s = await setup()
    await expect(s.runtime.withActor('ownerTeacher', async page => {
      const c = s.browser.contexts[0], request = new FakeRequest(plan.appOrigin + '/incidental')
      await c.dispatch(request)
      c.emit('response', new FakeResponse(c.page, request, {}, 200, async () => { throw Error('private') }))
      c.emit('requestfinished', request)
      await s.runtime.navigate(page, plan.appOrigin + '/pattern-lab')
    })).rejects.toThrow()
    expect(s.browser.contexts[0].page.goto).toHaveBeenCalledTimes(1)
  })
  it('waits for headers arriving after actor work returns before closing', async () => {
    const s = await setup(), entered = deferred<void>(), body = deferred<Buffer>()
    let request!: FakeRequest
    const work = s.runtime.withActor('ownerTeacher', async () => {
      request = new FakeRequest(plan.appOrigin + '/api/teacher/classrooms')
      await s.browser.contexts[0].dispatch(request); entered.resolve()
    })
    await entered.promise; await new Promise<void>(resolve => setImmediate(resolve))
    const c = s.browser.contexts[0]; expect(c.close).not.toHaveBeenCalled()
    c.emit('response', new FakeResponse(c.page, request, {}, 200, () => body.promise)); c.emit('requestfinished', request)
    await Promise.resolve(); expect(c.close).not.toHaveBeenCalled()
    body.resolve(Buffer.from('{}')); await work; expect(c.close).toHaveBeenCalledOnce()
  })
  it('owns font captures and rejects unknown labels, wrong actors, state drift and duplicate evidence', async () => {
    const s = await setup(), screenshot = vi.fn(async () => Buffer.from([137,80,78,71,13,10,26,10,0]))
    await s.runtime.withActor('ownerTeacher', async page => {
      await expect(s.runtime.captureFont('arbitrary-font-shot', page)).rejects.toThrow()
      await expect(s.runtime.captureFont('font-memberStudent-desktop-light-preview', page)).rejects.toThrow()
      const label = 'font-ownerTeacher-desktop-light-preview'
      await expect(s.runtime.captureFont(label, page)).rejects.toThrow()
      await page.goto(`${plan.appOrigin}/pattern-lab?role=teacher#history-preview`, { waitUntil: 'load' })
      const observation = { dark: false, ready: true, fits: true, positioned: true,
        clip: { x: 16, y: 180, width: 358, height: 500 }, editable: 'false', text: 'Fixed preview', preview: true,
        checks: { navigation: true, viewport: true, heading: true, content: true, placeholder: true } }
      const gallery = { waitFor: vi.fn(async () => {}), count: vi.fn(async () => 1), evaluate: vi.fn(async () => observation), screenshot }
      Object.assign(page, { screenshot, viewportSize: () => ({ width: 1440, height: 900 }), locator: (selector: string) => {
        expect(selector).toBe('#history-preview[data-testid="history-preview-gallery"]'); return gallery
      } })
      s.browser.contexts[0].page.waitForFunction.mockResolvedValue(undefined)
      observation.dark = true; await expect(s.runtime.captureFont(label, page)).rejects.toThrow(); expect(screenshot).not.toHaveBeenCalled()
      observation.dark = false; observation.fits = false; await expect(s.runtime.captureFont(label, page)).rejects.toThrow()
      observation.fits = true; observation.positioned = false; await expect(s.runtime.captureFont(label, page)).rejects.toThrow()
      observation.positioned = true; await s.runtime.captureFont(label, page)
      expect(screenshot).toHaveBeenCalledWith(expect.objectContaining({ fullPage: false, clip: observation.clip }))
      await expect(s.runtime.captureFont(label, page)).rejects.toThrow()
    })
    await expect(s.close('passed')).rejects.toThrow()
    expect(s.receipt().artifacts).toEqual([expect.objectContaining({ label: 'font-ownerTeacher-desktop-light-preview', kind: 'png', fontReference: 'teacher-history-viewer' })])
  })
  it('waits for canonical empty font evidence and stable geometry without another fill or screenshot retry', async () => {
    const s = await setup(), screenshot = vi.fn(async () => Buffer.from([137,80,78,71,13,10,26,10,0]))
    await s.runtime.withActor('ownerTeacher', async page => {
      await page.goto(`${plan.appOrigin}/pattern-lab?role=student#student-image-upload`, { waitUntil: 'load' })
      const settled = { dark: false, ready: true, fits: true, positioned: true,
        clip: { x: 16, y: 180, width: 358, height: 500 }, editable: 'true', text: '', preview: false,
        checks: { navigation: true, viewport: true, heading: true, content: true, placeholder: true } }
      const evaluate = vi.fn().mockResolvedValue(settled).mockResolvedValueOnce({ ...settled, positioned: false,
        checks: { ...settled.checks, placeholder: false } })
      const gallery = { waitFor: async () => {}, count: async () => 1, evaluate }
      Object.assign(page, { screenshot, viewportSize: () => ({ width: 1440, height: 900 }), locator: () => gallery })
      s.browser.contexts[0].page.waitForFunction.mockResolvedValue(undefined)
      await s.runtime.captureFont('font-ownerTeacher-desktop-light-empty', page)
      expect(evaluate).toHaveBeenCalledTimes(3)
      expect(screenshot).toHaveBeenCalledOnce()
    })
    await expect(s.close('passed')).rejects.toThrow()
    expect(s.receipt().fontCapture).toEqual({ label: 'font-ownerTeacher-desktop-light-empty', stage: 'saved', failedChecks: [] })
  })
  it('retains only fixed failed font predicates and does not renew the capture deadline', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const s = await setup(), screenshot = vi.fn()
    await s.runtime.withActor('ownerTeacher', async page => {
      await page.goto(`${plan.appOrigin}/pattern-lab?role=student#student-image-upload`, { waitUntil: 'load' })
      const started = Date.now()
      const gallery = { waitFor: async () => {}, count: async () => 1, evaluate: vi.fn(async () => {
        vi.setSystemTime(started + plan.limits.operationMs)
        return { dark: false, ready: true, fits: true, positioned: false,
          clip: { x: 16, y: 180, width: 358, height: 500 }, editable: 'true', text: 'PRIVATE-SENTINEL', preview: false,
          checks: { navigation: true, viewport: true, heading: true, content: false, placeholder: false } }
      }) }
      Object.assign(page, { screenshot, viewportSize: () => ({ width: 1440, height: 900 }), locator: () => gallery })
      s.browser.contexts[0].page.waitForFunction.mockResolvedValue(undefined)
      await expect(s.runtime.captureFont('font-ownerTeacher-desktop-light-empty', page)).rejects.toThrow()
      expect(gallery.evaluate).toHaveBeenCalledOnce(); expect(screenshot).not.toHaveBeenCalled()
    })
    await expect(s.close('passed')).rejects.toThrow()
    expect(s.receipt().fontCapture).toMatchObject({ label: 'font-ownerTeacher-desktop-light-empty', stage: 'readiness',
      failedChecks: expect.arrayContaining(['content', 'placeholder', 'text', 'deadline']) })
    expect(JSON.stringify(s.receipt().fontCapture)).not.toMatch(/PRIVATE-SENTINEL|clip|358|500/)
  })
  it.each([
    { height: 500, contentBottom: 300, blocked: false, passes: true },
    { height: 1200, contentBottom: 300, blocked: false, passes: true },
    { height: 1200, contentBottom: 850, blocked: false, passes: false },
    { height: 500, contentBottom: 300, blocked: true, passes: false },
  ])('positions a mobile font capture below real sticky chrome and fails closed on clipped evidence (%j)', async ({ height, contentBottom, blocked, passes }) => {
    const s = await setup(), screenshot = vi.fn(async () => Buffer.from([137,80,78,71,13,10,26,10,0]))
    await s.runtime.withActor('ownerTeacher', async page => {
      await page.goto(`${plan.appOrigin}/pattern-lab?role=teacher#history-preview`, { waitUntil: 'load' })
      let scrollY = 900
      const rect = (top: number, bottom: number) => ({ top, bottom, left: 16, right: 374, width: 358, height: bottom - top })
      const heading = { getBoundingClientRect: () => rect(1000 - scrollY + 16, 1000 - scrollY + 44) }
      const blocks = [{ getBoundingClientRect: () => rect(1000 - scrollY + 150, 1000 - scrollY + contentBottom) }]
      const editor = { scrollWidth: 326, clientWidth: 326, getAttribute: () => 'false', textContent: 'Fixed preview', querySelectorAll: () => blocks }
      let navReads = 0
      const nav = { getBoundingClientRect: () => rect(8, blocked && navReads++ > 0 ? 240 : 172) }
      const element = { scrollWidth: 358, clientWidth: 358, getBoundingClientRect: () => rect(1000 - scrollY, 1000 - scrollY + height),
        querySelector: (selector: string) => selector === '.tiptap.ProseMirror' ? editor : selector === 'h2' ? heading : {},
      }
      const scrollTo = vi.fn((options: { top: number }) => { scrollY = options.top })
      vi.stubGlobal('window', { innerWidth: 390, innerHeight: 844, get scrollY() { return scrollY }, scrollTo })
      vi.stubGlobal('document', { fonts: { status: 'loaded' }, documentElement: { classList: { contains: () => false } }, querySelectorAll: () => [nav] })
      vi.stubGlobal('getComputedStyle', () => ({ position: 'sticky', top: '8px', height: '164px', display: 'block', visibility: 'visible', opacity: '1', contentVisibility: 'visible' }))
      const gallery = { waitFor: async () => {}, count: async () => 1,
        evaluate: async (callback: (value: unknown, state: string) => unknown, state: string) => callback(element, state), screenshot: vi.fn() }
      Object.assign(page, { screenshot, viewportSize: () => ({ width: 390, height: 844 }), locator: () => gallery })
      s.browser.contexts[0].page.waitForFunction.mockResolvedValue(undefined)
      const capturing = s.runtime.captureFont('font-ownerTeacher-mobile-light-preview', page)
      if (passes) {
        await capturing
        expect(screenshot).toHaveBeenCalledWith(expect.objectContaining({ fullPage: false,
          clip: { x: 16, y: 180, width: 358, height: Math.min(height, 664) } }))
      } else { await expect(capturing).rejects.toThrow(); expect(screenshot).not.toHaveBeenCalled() }
      expect(scrollTo).toHaveBeenCalledWith({ top: 820, behavior: 'instant' })
      expect(gallery.screenshot).not.toHaveBeenCalled()
    })
  })
  it('aborts a foreign stylesheet without dispatch, retains only fixed labels and closes the context', async () => {
    const s = await setup()
    await expect(s.runtime.withActor('ownerTeacher', async () => { await s.browser.contexts[0].foreignResource() })).rejects.toThrow()
    await expect(s.close('passed')).rejects.toThrow('fixed-schema receipt')
    // Actor disposal and final runtime disposal both close defensively.
    expect(s.browser.contexts[0].close).toHaveBeenCalledTimes(2)
    expect(s.receipt()).toMatchObject({ outcome: 'failed', firstFailure: 'origin', pending: 0, contextsClosed: true,
      requestFailure: { reason: 'protocol', target: 'google-font-stylesheet', method: 'GET', resource: 'stylesheet' } })
    expect(JSON.stringify(s.receipt())).not.toMatch(/PRIVATE-FONT|SECRET|fonts\.googleapis|token=/)
  })
  it('verifies the original login bytes before navigation even starts, without pausing a network route', async () => {
    const browser = new FakeBrowser(); browser.configure = c => { c.page.raceNavigation = true }
    const s = await setup(browser), callback = vi.fn()
    browser.configure = c => { c.page.raceNavigation = true; c.page.loginBody = async () => {
      expect(c.page.navigationStarted).toBe(false)
      return Buffer.from('{"success":true}')
    } }
    await s.runtime.withActor('ownerTeacher', callback)
    const c = browser.contexts[0]
    expect(c.page.navigationStarted).toBe(true); expect(c.page.navigationCommitted).toBe(true)
    expect(c.page.loginPosts).toBe(1); expect(c.page.loginResponse!.body).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledOnce(); expect(c.requests).toHaveLength(1)
  })
  it.each(['body', 'status'] as const)('aborts held login navigation after %s verification fails, with no identity request or retry', async failure => {
    const browser = new FakeBrowser()
    browser.configure = c => {
      c.page.raceNavigation = true
      if (failure === 'body') c.page.loginBody = async () => { throw Error('CPU private body failure') }
      else c.page.loginStatus = 401
    }
    const s = await setup(browser), callback = vi.fn()
    await expect(s.runtime.withActor('ownerTeacher', callback)).rejects.toThrow()
    const c = browser.contexts[0]; await c.page.navigationTask
    expect(c.page.navigationCommitted).toBe(false); expect(c.page.navigationAborted).toBe(true)
    expect(c.page.loginPosts).toBe(1); expect(c.page.loginResponse!.body).toHaveBeenCalledOnce()
    expect(c.requests).toEqual([]); expect(callback).not.toHaveBeenCalled(); expect(c.close).toHaveBeenCalledOnce()
  })
  it('aborts held navigation at the original login deadline even when the original body settles later', async () => {
    vi.useFakeTimers()
    const body = deferred<Buffer>()
    try {
      const browser = new FakeBrowser()
      browser.configure = c => { c.page.raceNavigation = true; c.page.loginBody = () => body.promise }
      const s = await setup(browser), callback = vi.fn()
      const failed = expect(s.runtime.withActor('ownerTeacher', callback)).rejects.toThrow()
      await vi.advanceTimersByTimeAsync(30000)
      const c = browser.contexts[0]; await c.page.navigationTask
      expect(c.page.navigationAborted).toBe(true); expect(c.page.navigationCommitted).toBe(false)
      body.resolve(Buffer.from('{"success":true}')); await vi.advanceTimersByTimeAsync(1); await failed
      expect(c.requests).toEqual([]); expect(callback).not.toHaveBeenCalled()
      expect(c.page.loginPosts).toBe(1); expect(c.page.loginResponse!.body).toHaveBeenCalledOnce()
    } finally { body.resolve(Buffer.from('{}')); vi.useRealTimers() }
  })
  it('does not release navigation when a different observed JSON body fails during login', async () => {
    const browser = new FakeBrowser()
    browser.configure = c => {
      c.page.raceNavigation = true
      c.on('response', (reply: FakeResponse) => {
        if (reply.url().endsWith('/api/auth/login')) c.emit('response', new FakeResponse(c.page,
          new FakeRequest(plan.appOrigin + '/other'), {}, 200, async () => { throw Error('CPU unrelated failure') }))
      })
    }
    const s = await setup(browser), callback = vi.fn()
    await expect(s.runtime.withActor('ownerTeacher', callback)).rejects.toThrow()
    const c = browser.contexts[0]; await c.page.navigationTask
    expect(c.page.navigationAborted).toBe(true); expect(c.requests).toEqual([]); expect(callback).not.toHaveBeenCalled()
    await expect(s.close('failed')).rejects.toThrow()
    expect(s.receipt().responseFailure).toMatchObject({ resource: 'other', phase: 'response-body' })
  })
  it.each(loginSteps)('retains the entered %s step and last completion on actual runtime failure without sensitive data', async failedStep => {
    const secret = Error('DO-NOT-RECORD password https://private.invalid?token=secret'), browser = new FakeBrowser()
    if (failedStep === 'context') browser.newContext.mockRejectedValueOnce(secret)
    browser.configure = c => {
      if (failedStep === 'setup') c.setDefaultTimeout.mockImplementationOnce(() => { throw secret })
      if (failedStep === 'page') c.newPage.mockRejectedValueOnce(secret)
      if (failedStep === 'navigate') c.page.goto.mockRejectedValueOnce(secret)
      if (failedStep === 'form-ready') c.page.waitForFunction.mockRejectedValueOnce(secret)
      if (failedStep === 'redirect') c.page.waitForURL.mockRejectedValueOnce(secret)
      if (failedStep === 'session') c.request.fetch.mockRejectedValueOnce(secret)
      if (failedStep === 'identity') c.fetchReply = url => new FakeResponse(c.page, new FakeRequest(url), { user: { ...c.actor, id: 'foreign' } })
      if (failedStep === 'preset' || failedStep === 'submit') {
        const original = c.page.getByRole.bind(c.page)
        vi.spyOn(c.page, 'getByRole').mockImplementation((role, options) => {
          const locator = original(role, options)
          return options.name === (failedStep === 'preset' ? 'Teacher' : 'Login') ? { click: async () => { throw secret } } : locator
        })
      }
      if (failedStep === 'email' || failedStep === 'password') {
        const original = c.page.getByLabel.bind(c.page)
        vi.spyOn(c.page, 'getByLabel').mockImplementation(label => {
          const locator = original(label)
          return (label === 'School Email') === (failedStep === 'email') ? { fill: async () => { throw secret } } : locator
        })
      }
    }
    const s = await setup(browser), callback = vi.fn()
    if (failedStep === 'response-body') vi.spyOn(s.runtime, 'response').mockRejectedValueOnce(secret)
    await expect(s.runtime.withActor('ownerTeacher', callback)).rejects.toThrow()
    expect(callback).not.toHaveBeenCalled()
    await expect(s.close('failed')).rejects.toThrow()
    expect(s.receipt().login).toEqual({ attempts: 1, overflow: false, entries: [{ attempt: 1, entered: failedStep, completed: loginSteps[loginSteps.indexOf(failedStep) - 1] ?? null }] })
    expect(JSON.stringify(s.receipt().login)).not.toMatch(/DO-NOT-RECORD|private\.invalid|secret|CPU-private|@|http/)
    if (failedStep !== 'context') expect(browser.contexts[0].close).toHaveBeenCalledTimes(failedStep === 'session' ? 2 : 1)
  })
  it('preserves callback results and errors, rejects marker reordering and bounds metadata without stopping further logins', async () => {
    const progress = createContextualTestLoginProgress(), action = vi.fn(), error = Error('DO-NOT-RECORD')
    const failed = progress.begin()
    await expect(failed.step('page', action)).rejects.toThrow('Private login marker order')
    expect(action).not.toHaveBeenCalled()
    await expect(failed.step('context', () => { throw error })).rejects.toBe(error)
    await expect(failed.step('setup', action)).rejects.toThrow('Private login marker order')
    for (let attempt = 0; attempt < 65; attempt++) {
      const login = progress.begin(), result = { privateValue: 'DO-NOT-RECORD' }
      for (const step of loginSteps) expect(await login.step(step, () => result)).toBe(result)
      await expect(login.step(undefined as never, action)).rejects.toThrow('Private login marker order')
    }
    const snapshot = progress.snapshot()
    expect(snapshot).toMatchObject({ attempts: 66, overflow: true })
    expect(snapshot.entries).toHaveLength(64)
    expect(snapshot.entries[0]).toEqual({ attempt: 1, entered: 'context', completed: null })
    expect(snapshot.entries[1]).toEqual({ attempt: 2, entered: 'identity', completed: 'identity' })
    expect(JSON.stringify(snapshot)).not.toContain('DO-NOT-RECORD')
    snapshot.entries[0].completed = 'identity'
    expect(progress.snapshot().entries[0].completed).toBeNull()
    expect(action).not.toHaveBeenCalled()
  })
  it.each(['runtime-entry','binding','plan','boundary','output'] as const)('marks %s before its fallible action and never creates runtime output or browser contexts on injected failure', async failAt => {
    const reached: string[] = [], browser = new FakeBrowser()
    await expect(setup(browser, 120000, stage => { reached.push(stage); if (stage === failAt) throw Error('CPU stage failure') })).rejects.toThrow('CPU stage failure')
    const sequence = ['runtime-entry','binding','plan','boundary','output']
    expect(reached).toEqual(sequence.slice(0, sequence.indexOf(failAt) + 1))
    expect(existsSync(join(outputs.at(-1)!, 'playwright'))).toBe(false)
    expect(browser.newContext).not.toHaveBeenCalled()
    expect(platform.readContextualTestBinding).toHaveBeenCalledTimes(['runtime-entry','binding'].includes(failAt) ? 0 : 1)
  })
  it.each([30000, 5000])('rejects a hung original body at its original %ims end and retains truthful pending state', async remaining => {
    vi.useFakeTimers()
    const body = deferred<Buffer>(), entered = deferred<void>()
    try {
      const s = await setup(new FakeBrowser(), remaining), context = () => s.browser.contexts[0]
      let response!: FakeResponse
      const actor = s.runtime.withActor('ownerTeacher', async page => {
        response = new FakeResponse(context().page, new FakeRequest(plan.appOrigin + '/api/auth/me'), {}, 200, () => body.promise)
        context().emit('response', response); entered.resolve()
        await s.runtime.response(page, response as unknown as Response)
      })
      const rejected = expect(actor).rejects.toThrow()
      await entered.promise; await vi.advanceTimersByTimeAsync(remaining)
      await rejected; expect(context().close).toHaveBeenCalledOnce(); expect(response.body).toHaveBeenCalledOnce()
      await expect(s.close('passed')).rejects.toThrow()
      expect(s.receipt()).toMatchObject({ outcome: 'failed', firstFailure: 'deadline', pending: 1, contextsClosed: true })
      // Release only for CPU fixture hygiene; the immutable receipt stays failed.
      body.resolve(Buffer.from('{}')); await Promise.resolve()
      expect(s.receipt().outcome).toBe('failed')
    } finally { body.resolve(Buffer.from('{}')); vi.useRealTimers() }
  })
  it.each([['ownerTeacher', 'ownerTeacherPeer'], ['ownerStudent', 'ownerStudentPeer']] as const)('proves the public form handler before fixture fills and validates the real %s session', async (actor, label) => {
    const s = await setup(new FakeBrowser(actor))
    await s.runtime.withActor(label, async page => {
      expect(page).toBe(s.browser.contexts[0].page)
      expect(platform.executeContextualTestSql).not.toHaveBeenCalled()
    })
    const c = s.browser.contexts[0]
    expect(s.browser.newContext).toHaveBeenCalledWith({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', acceptDownloads: false })
    expect(c.page.goto).toHaveBeenCalledWith(plan.appOrigin + '/login', expect.objectContaining({ waitUntil: 'load' }))
    expect(c.page.labels[0]).toBe('School Email')
    expect(c.page.labels[1]).toBeInstanceOf(RegExp)
    expect((c.page.labels[1] as RegExp).test('Password *')).toBe(true)
    expect(c.page.fills.map(fill => fill.value)).toEqual([plan.actors[actor].email, password])
    expect(c.page.roles).toEqual([{ role: 'button', options: { name: 'Teacher', exact: true } }, { role: 'button', options: { name: 'Login', exact: true } }])
    expect(c.page.presetActivations).toBe(1); expect(c.page.waitForFunction).toHaveBeenCalledOnce(); expect(c.page.loginPosts).toBe(1)
    expect(c.page.loginResponse!.body).toHaveBeenCalledOnce()
    expect(c.requests[0]).toMatchObject({ url: plan.appOrigin + '/api/auth/me', options: { method: 'GET', maxRedirects: 0 } })
    expect(c.responses[0].body).toHaveBeenCalledOnce(); expect(c.responses[0].dispose).toHaveBeenCalledOnce()
    expect(c.close).toHaveBeenCalledOnce()
    await expect(s.close('failed')).rejects.toThrow()
    expect(s.receipt().login).toEqual({ attempts: 1, overflow: false, entries: [{ attempt: 1, entered: 'identity', completed: 'identity' }] })
  })
  it.each([30000, 5000])('fails a nonfunctional preset at its original %ims end without fixture fills, POST or retry', async lease => {
    vi.useFakeTimers()
    try {
      const browser = new FakeBrowser(); browser.configure = c => { c.page.neverHydrates = true }
      const s = await setup(browser, lease), callback = vi.fn()
      const end = Date.now() + lease
      const failed = expect(s.runtime.withActor('ownerTeacher', callback)).rejects.toThrow()
      await vi.advanceTimersByTimeAsync(lease)
      await failed
      const c = browser.contexts[0]
      expect(c.page.readyEnd).toBe(end); expect(c.page.presetActivations).toBe(1)
      expect(c.page.fills).toEqual([]); expect(c.page.loginPosts).toBe(0); expect(c.requests).toEqual([])
      expect(callback).not.toHaveBeenCalled(); expect(c.close).toHaveBeenCalledOnce()
      await expect(s.close('failed')).rejects.toThrow()
      expect(s.receipt().login.entries).toEqual([{ attempt: 1, entered: 'form-ready', completed: 'preset' }])
    } finally { vi.useRealTimers() }
  })
  it('does not renew the login operation after the preset consumes its original end', async () => {
    vi.useFakeTimers()
    try {
      const browser = new FakeBrowser(); browser.configure = c => { c.page.advanceOnPreset = 30000 }
      const s = await setup(browser), callback = vi.fn()
      await expect(s.runtime.withActor('ownerTeacher', callback)).rejects.toThrow()
      const c = browser.contexts[0]
      expect(c.page.presetActivations).toBe(1); expect(c.page.waitForFunction).not.toHaveBeenCalled()
      expect(c.page.fills).toEqual([]); expect(c.page.loginPosts).toBe(0); expect(callback).not.toHaveBeenCalled()
      expect(c.close).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers() }
  })
  it('stops after the original login end while joining a later original body without dispatching identity reads', async () => {
    vi.useFakeTimers()
    const body = deferred<Buffer>()
    try {
      const browser = new FakeBrowser()
      browser.configure = c => { c.page.advanceOnPreset = 10000; c.page.loginBody = () => body.promise }
      const s = await setup(browser), callback = vi.fn()
      const originalEnd = Date.now() + 30000
      const failed = expect(s.runtime.withActor('ownerTeacher', callback)).rejects.toThrow()
      await vi.advanceTimersByTimeAsync(20000)
      expect(Date.now()).toBe(originalEnd)
      const c = browser.contexts[0]
      expect(c.page.presetActivations).toBe(1); expect(c.page.loginPosts).toBe(1)
      expect(c.requests).toEqual([]); expect(callback).not.toHaveBeenCalled()
      // The original body remains owned until it finishes; timeout never grants
      // a second login, /auth/me dispatch, callback or successful completion.
      body.resolve(Buffer.from('{"success":true}'))
      await failed
      expect(c.requests).toEqual([]); expect(callback).not.toHaveBeenCalled()
      expect(c.close).toHaveBeenCalledOnce(); expect(c.page.loginResponse!.body).toHaveBeenCalledOnce()
    } finally { body.resolve(Buffer.from('{}')); vi.useRealTimers() }
  })
  it.each(['id','role','email'] as const)('rejects a persisted session with the wrong %s and closes the context', async field => {
    const browser = new FakeBrowser()
    browser.configure = context => { context.fetchReply = url => new FakeResponse(context.page, new FakeRequest(url), { user: { ...context.actor, [field]: 'foreign' } }) }
    const s = await setup(browser), callback = vi.fn()
    await expect(s.runtime.withActor('ownerTeacher', callback)).rejects.toThrow()
    expect(callback).not.toHaveBeenCalled(); expect(browser.contexts[0].close).toHaveBeenCalledOnce()
  })
  it('joins the same delayed original body before closing its actor context', async () => {
    const events: string[] = [], browser = new FakeBrowser('ownerTeacher', events), s = await setup(browser)
    const body = deferred<Buffer>(), entered = deferred<void>(); let response!: FakeResponse, acknowledgement!: Promise<unknown>
    const actor = s.runtime.withActor('ownerTeacher', async page => {
      const c = browser.contexts[0]
      response = new FakeResponse(c.page, new FakeRequest(plan.appOrigin + '/api/teacher/tests/50000000-0000-4000-8000-000000000044'), {}, 200, () => body.promise)
      c.emit('response', response)
      expect(response.body).toHaveBeenCalledOnce()
      acknowledgement = s.runtime.response(page, response as unknown as Response)
      entered.resolve()
    })
    await entered.promise; await Promise.resolve()
    expect(browser.contexts[0].close).not.toHaveBeenCalled()
    events.push('original-body-resolved'); body.resolve(Buffer.from('{"saved":true}'))
    await actor; await expect(acknowledgement).resolves.toEqual({ saved: true })
    expect(response.body).toHaveBeenCalledOnce()
    expect(events).toEqual(['original-body-resolved','context-close'])
  })
  it('uses the owned API context with redirects disabled and caches a create acknowledgement without another body read', async () => {
    const s = await setup()
    await s.runtime.withActor('ownerTeacher', async page => {
      const c = s.browser.contexts[0]
      c.fetchReply = (url, options) => new FakeResponse(c.page, new FakeRequest(url, String(options.method)), { saved: true })
      await expect(s.runtime.api(page, 'PATCH', '/api/teacher/tests/50000000-0000-4000-8000-000000000044/draft', { revision: 1 })).resolves.toEqual({ saved: true })
      expect(c.requests.at(-1)).toMatchObject({ url: plan.appOrigin + '/api/teacher/tests/50000000-0000-4000-8000-000000000044/draft', options: { method: 'PATCH', data: { revision: 1 }, maxRedirects: 0 } })
      expect(c.requests.at(-1)!.options.timeout).toBeLessThanOrEqual(30000)
      expect(c.responses.at(-1)!.body).toHaveBeenCalledOnce(); expect(c.responses.at(-1)!.dispose).toHaveBeenCalledOnce()
      const request = new FakeRequest(plan.appOrigin + '/api/teacher/tests', 'POST', { classroom_id: plan.classrooms.classA.id })
      await c.dispatch(request)
      const response = new FakeResponse(c.page, request, { test: { id: '50000000-0000-4000-8000-000000000044', classroom_id: plan.classrooms.classA.id } }, 201)
      c.emit('response', response)
      c.emit('requestfinished', request)
      const first = await s.runtime.response(page, response as unknown as Response), second = await s.runtime.response(page, response as unknown as Response)
      expect(first).toEqual(second); expect(response.body).toHaveBeenCalledOnce()
    })
  })
  it('latches a failed original body after task removal and writes only the failed fixed receipt', async () => {
    const s = await setup()
    await expect(s.runtime.withActor('ownerTeacher', async page => {
      const c = s.browser.contexts[0]
      const response = new FakeResponse(c.page, new FakeRequest(plan.appOrigin + '/api/auth/me'), {}, 200,
        async () => { throw new Error('DO-NOT-RECORD-private-body-cookie-secret') })
      c.emit('response', response)
      await expect(s.runtime.response(page, response as unknown as Response)).rejects.toThrow()
      expect(response.body).toHaveBeenCalledOnce()
      expect(() => s.runtime.check()).toThrow()
    })).rejects.toThrow()
    expect(s.browser.contexts[0].close).toHaveBeenCalledOnce()
    await expect(s.close('passed')).rejects.toThrow('fixed-schema receipt')
    const receipt = s.receipt()
    expect(receipt).toMatchObject({ version: 1, outcome: 'failed', contextsClosed: true, firstFailure: 'response-body', pending: 0 })
    expect(JSON.stringify(receipt)).not.toContain('DO-NOT-RECORD')
    expect(Object.keys(receipt).sort()).toEqual(['artifacts','consoleErrors','contextsClosed','counts','deadline','endedAt','firstFailure','requestFailure','responseFailure','endpointFailure','outcome','pageErrors','pending','projectId','sourceSha','sourceTree','appOverlaySha256','version','witnesses','login','fontCapture'].sort())
    expect(receipt.fontCapture).toBeNull()
    expect(receipt.appOverlaySha256).toBe(plan.appOverlaySha256)
  })
  it('disposes the original API response when JSON verification fails and retains no response body', async () => {
    const s = await setup(); let response!: FakeResponse
    await expect(s.runtime.withActor('ownerTeacher', async page => {
      const c = s.browser.contexts[0]
      c.fetchReply = url => {
        response = new FakeResponse(c.page, new FakeRequest(url), {}, 200, async () => Buffer.from('private-invalid-json-cookie'))
        return response
      }
      await s.runtime.api(page, 'GET', '/api/teacher/tests')
    })).rejects.toThrow()
    expect(response.body).toHaveBeenCalledOnce(); expect(response.dispose).toHaveBeenCalledOnce()
    await expect(s.close('passed')).rejects.toThrow('fixed-schema receipt')
    const receipt = s.receipt()
    expect(receipt).toMatchObject({ outcome: 'failed', firstFailure: 'response-json', pending: 0 })
    expect(JSON.stringify(receipt)).not.toContain('private-invalid-json-cookie')
  })
  it('rejects foreign contexts, foreign response frames and pages whose actor context was closed', async () => {
    const s = await setup(); let previous!: Page
    await s.runtime.withActor('ownerTeacher', async page => {
      previous = page
      const foreign = new FakeContext()
      await expect(s.runtime.api(foreign.page as unknown as Page, 'GET', '/api/auth/me')).rejects.toThrow('ownership')
      expect(foreign.request.fetch).not.toHaveBeenCalled()
      const response = new FakeResponse(foreign.page, new FakeRequest(plan.appOrigin + '/api/auth/me'))
      await expect(s.runtime.response(page, response as unknown as Response)).rejects.toThrow('response ownership')
      expect(response.body).not.toHaveBeenCalled()
    })
    const requests = s.browser.contexts[0].request.fetch.mock.calls.length
    await expect(s.runtime.api(previous, 'GET', '/api/auth/me')).rejects.toThrow('ownership')
    expect(s.browser.contexts[0].request.fetch).toHaveBeenCalledTimes(requests)
  })
  it.each(['route','routeWebSocket'] as const)('closes the just-created context when %s setup rejects', async method => {
    const browser = new FakeBrowser()
    browser.configure = c => { c[method].mockRejectedValueOnce(new Error('CPU synthetic setup failure')) }
    const s = await setup(browser), callback = vi.fn()
    await expect(s.runtime.withActor('ownerTeacher', callback)).rejects.toThrow('CPU synthetic setup failure')
    expect(callback).not.toHaveBeenCalled(); expect(browser.contexts[0].newPage).not.toHaveBeenCalled()
    expect(browser.contexts[0].close).toHaveBeenCalledOnce()
  })
})
