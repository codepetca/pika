/** CPU compatibility test: real installed client objects and wire decoding,
 * with simulated route acknowledgements. No browser or network is started;
 * this does not establish Chromium's event ordering in an application run. */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Frame, Page, Request } from '@playwright/test'
import { describe, expect, it, vi } from 'vitest'
import { ContextualTestBoundary } from '../../e2e/helpers/contextual-test-boundary'
import { ContextualTestNavigation } from '../../e2e/helpers/contextual-test-navigation'
import { createContextualTestPlan } from '../../e2e/helpers/contextual-test-rehearsal'

const require = createRequire(import.meta.url)
const playwright = createRequire(require.resolve('@playwright/test/package.json'))
const core = createRequire(playwright.resolve('playwright/package.json'))
const root = dirname(core.resolve('playwright-core/package.json'))
type ClientConnection = {
  dispatch(message: { guid: string; method: string; params: Record<string, unknown> }): void
  getObjectWithKnownName(guid: string): unknown
  onmessage(message: unknown): void
}
const { Connection } = require(join(root, 'lib/client/connection.js')) as {
  Connection: new (platform: unknown) => ClientConnection
}
const { nodePlatform } = require(join(root, 'lib/server/utils/nodePlatform.js')) as { nodePlatform: unknown }
type ClientRequest = Request & { _guid: string }
type ClientFrame = Frame & { _eventEmitter: { listenerCount(event: string): number } }
const plan = createContextualTestPlan('pika_assignment_list_1a2b3c4d5e6f')
const target = plan.appOrigin + '/pattern-lab?role=teacher#history-preview'

function harness(current = plan.appOrigin + '/classrooms') {
  const connection = new Connection(nodePlatform)
  const outbound = vi.fn(() => { throw new Error('Unexpected SDK protocol command in CPU fixture') })
  connection.onmessage = outbound
  function create<T>(type: string, guid: string, initializer: Record<string, unknown>, parent = '') {
    connection.dispatch({ guid: parent, method: '__create__', params: { type, guid, initializer } })
    return connection.getObjectWithKnownName(guid) as T
  }
  const frame = create<ClientFrame>('Frame', 'frame', { url: current, name: '', loadStates: [] })
  // The inert root supplies an identity-only context. The real Page constructor
  // attaches the real Frame, so frame.page(), page.frames() and page.url() are
  // SDK methods rather than the hand-written methods in the behavioral mocks.
  const page = create<Page>('Page', 'page', { mainFrame: { guid: 'frame' }, isClosed: false })
  const context = page.context()
  const boundary = new ContextualTestBoundary(plan, 2701000, () => 1000)
  const fence = new ContextualTestNavigation(boundary, context, () => 1000)
  let nextRequest = 0
  function request(url: string, previous?: ClientRequest) {
    return create<ClientRequest>('Request', 'request-' + ++nextRequest, {
      frame: { guid: 'frame' }, url, resourceType: 'document', method: 'GET',
      headers: [], isNavigationRequest: true, hasResponse: false,
      ...(previous ? { redirectedFrom: { guid: previous._guid } } : {}),
    }, 'page')
  }
  function route(request: ClientRequest) {
    boundary.requestStarted(context, request)
    boundary.admit(request.url(), request.method(), undefined, request.resourceType())
    boundary.requestIntercepted(context, request, request.method())
    return { request: () => request, continue: vi.fn(async () => {}), abort: vi.fn(async () => {}) }
  }
  function commit(url: string, request?: ClientRequest) {
    // Use the wire GUID, never construct the decoded {_object: request} shape.
    connection.dispatch({ guid: 'frame', method: 'navigated', params: {
      url, name: '', newDocument: request ? { request: { guid: request._guid } } : {},
    } })
  }
  function assertSettled() {
    expect(boundary.pending(context)).toBe(0)
    expect(frame._eventEmitter.listenerCount('navigated')).toBe(0)
    expect(outbound).not.toHaveBeenCalled()
  }
  return { frame, page, context, boundary, fence, request, route, commit, assertSettled }
}

describe('installed Playwright navigation identity compatibility', () => {
  it('accepts a wire-decoded first document commit with the original Request and Frame identities', async () => {
    const h = harness()
    await h.fence.depart(h.page, target, 2000, async () => {
      const request = h.request(target.split('#')[0]), route = h.route(request)
      expect(request.frame()).toBe(h.frame)
      expect(request.frame().page()).toBe(h.page)
      expect(h.page.frames()).toContain(h.frame)
      expect(request.redirectedFrom()).toBeNull()
      expect(await h.fence.route(route)).toBe(true)
      h.commit(target, request)
      h.boundary.requestFinished(h.context, request)
      expect(route.continue).toHaveBeenCalledOnce()
      expect(route.abort).not.toHaveBeenCalled()
    })
    expect(h.page.url()).toBe(target)
    expect(h.boundary.receipt().firstFailure).toBeNull()
    h.assertSettled()
  })

  it('preserves the wire-decoded redirect predecessor and commits the last request', async () => {
    const h = harness(), final = plan.appOrigin + '/pattern-lab?role=student'
    await h.fence.depart(h.page, target, 2000, async () => {
      const first = h.request(target.split('#')[0]), firstRoute = h.route(first)
      await h.fence.route(firstRoute)
      h.boundary.requestFinished(h.context, first)
      const last = h.request(final, first), lastRoute = h.route(last)
      expect(last.redirectedFrom()).toBe(first)
      expect(first.redirectedTo()).toBe(last)
      await h.fence.route(lastRoute)
      h.commit(final, last)
      h.boundary.requestFinished(h.context, last)
      expect(firstRoute.continue).toHaveBeenCalledOnce()
      expect(lastRoute.continue).toHaveBeenCalledOnce()
    })
    expect(h.boundary.receipt().firstFailure).toBeNull()
    h.assertSettled()
  })

  it('accepts an explicit reload of a fragment URL only after its new document commit', async () => {
    const h = harness(target)
    await h.fence.depart(h.page, target, 2000, async () => {
      const request = h.request(target.split('#')[0]), route = h.route(request)
      await h.fence.route(route)
      h.commit(target, request)
      h.boundary.requestFinished(h.context, request)
      expect(route.continue).toHaveBeenCalledOnce()
    }, 'reload')
    expect(h.boundary.receipt().firstFailure).toBeNull()
    h.assertSettled()
  })

  it.each(['wrong', 'missing'] as const)('rejects a wire-decoded commit with a %s request', async kind => {
    const h = harness()
    await expect(h.fence.depart(h.page, target, 2000, async () => {
      const request = h.request(target.split('#')[0]), route = h.route(request)
      await h.fence.route(route)
      // The wrong request has the same URL and frame, isolating object identity.
      h.commit(target, kind === 'wrong' ? h.request(request.url()) : undefined)
      h.boundary.requestFinished(h.context, request)
      expect(route.continue).toHaveBeenCalledOnce()
    })).rejects.toThrow('Private Test rehearsal boundary')
    expect(h.boundary.receipt().endpointFailure).toMatchObject({ reason: 'route-inspection', detail: 'commit-request' })
    h.assertSettled()
  })
})
