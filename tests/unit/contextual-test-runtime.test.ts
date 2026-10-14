import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Browser, Page, Response, TestInfo } from '@playwright/test'

const platform = vi.hoisted(() => ({ readContextualTestBinding: vi.fn(), executeContextualTestSql: vi.fn() }))
vi.mock('../../scripts/contextual-test-rehearsal-platform', () => platform)
import { createContextualTestRuntime } from '../../e2e/helpers/contextual-test-runtime'
import { createContextualTestPlan, type ActorLabel } from '../../e2e/helpers/contextual-test-rehearsal'

const plan = createContextualTestPlan('pika_assignment_list_012345abcdef')
const password = 'CPU-private-login-password'
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
class FakeRequest {
  constructor(private target: string, private verb = 'GET', private data?: unknown) {}
  url = () => this.target
  method = () => this.verb
  postDataJSON = () => this.data
  postDataBuffer = () => this.data ? Buffer.from(JSON.stringify(this.data)) : null
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
  readonly goto = vi.fn(async (url: string) => { this.current = url })
  readonly waitForURL = vi.fn(async (predicate: (url: URL) => boolean) => {
    expect(predicate(new URL(this.current))).toBe(true)
  })
  constructor(readonly owner: FakeContext) { super() }
  context = () => this.owner
  url = () => this.current
  getByLabel(label: string | RegExp) {
    this.labels.push(label)
    return { fill: async (value: string) => { this.fills.push({ label, value }) } }
  }
  getByRole(role: string, options: unknown) {
    this.roles.push({ role, options })
    return { click: async () => {
      const request = new FakeRequest(plan.appOrigin + '/api/auth/login', 'POST', { email: this.owner.actor.email, password })
      await this.owner.dispatch(request)
      this.loginResponse = new FakeResponse(this, request, { success: true })
      this.owner.emit('response', this.loginResponse)
      expect(this.loginPredicate?.(this.loginResponse)).toBe(true)
      this.current = plan.appOrigin + '/classrooms'
      this.loginWait!.resolve(this.loginResponse)
    } }
  }
  waitForResponse(predicate: (response: FakeResponse) => boolean) {
    this.loginPredicate = predicate; this.loginWait = deferred<FakeResponse>(); return this.loginWait.promise
  }
}
class FakeContext extends EventEmitter {
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
    this.emit('request', request)
    const continued = vi.fn(async () => {}), aborted = vi.fn(async () => {})
    await this.routeHandler?.({ request: () => request, continue: continued, abort: aborted })
    expect(continued).toHaveBeenCalledOnce(); expect(aborted).not.toHaveBeenCalled()
    this.emit('requestfinished', request)
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
})
async function setup(browser = new FakeBrowser()) {
  const outputDir = realpathSync(mkdtempSync(join(tmpdir(), 'contextual-runtime-cpu-'))); outputs.push(outputDir)
  platform.readContextualTestBinding.mockReturnValue({ projectId: plan.projectId, password, deadline: Date.now() + 120000, outputDir })
  const handle = await createContextualTestRuntime(browser as unknown as Browser, {} as TestInfo)
  handles.push(handle)
  return { ...handle, browser, outputDir, receipt: () => JSON.parse(readFileSync(join(outputDir, 'playwright-receipt.json'), 'utf8')) }
}

describe('actual contextual Test runtime with CPU browser doubles', () => {
  it('uses the real login selectors and validates the persisted session without a login shortcut', async () => {
    const s = await setup(new FakeBrowser('ownerStudent'))
    await s.runtime.withActor('ownerStudentPeer', async page => {
      expect(page).toBe(s.browser.contexts[0].page)
      expect(platform.executeContextualTestSql).not.toHaveBeenCalled()
    })
    const c = s.browser.contexts[0]
    expect(s.browser.newContext).toHaveBeenCalledWith({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', acceptDownloads: false })
    expect(c.page.goto).toHaveBeenCalledWith(plan.appOrigin + '/login', expect.objectContaining({ waitUntil: 'domcontentloaded' }))
    expect(c.page.labels[0]).toBe('School Email')
    expect(c.page.labels[1]).toBeInstanceOf(RegExp)
    expect((c.page.labels[1] as RegExp).test('Password *')).toBe(true)
    expect(c.page.fills.map(fill => fill.value)).toEqual([plan.actors.ownerStudent.email, password])
    expect(c.page.roles).toEqual([{ role: 'button', options: { name: 'Login', exact: true } }])
    expect(c.page.loginResponse!.body).toHaveBeenCalledOnce()
    expect(c.requests[0]).toMatchObject({ url: plan.appOrigin + '/api/auth/me', options: { method: 'GET', maxRedirects: 0 } })
    expect(c.responses[0].body).toHaveBeenCalledOnce(); expect(c.responses[0].dispose).toHaveBeenCalledOnce()
    expect(c.close).toHaveBeenCalledOnce()
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
    expect(Object.keys(receipt).sort()).toEqual(['artifacts','consoleErrors','contextsClosed','counts','deadline','endedAt','firstFailure','outcome','pageErrors','pending','projectId','sourceSha','sourceTree','version','witnesses'].sort())
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
