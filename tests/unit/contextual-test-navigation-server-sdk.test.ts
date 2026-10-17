/** CPU reproduction using installed server FrameManager -> dispatchers -> wire
 * -> client objects. Only the page shell and route acknowledgements are inert.
 * No browser/network/DB is started; this does not prove historical event order. */
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
type Wire = { guid: string; method: string; params: Record<string, unknown> }
type ClientConnection = { dispatch(message: Wire): void; getObjectWithKnownName(guid: string): unknown; onmessage(message: unknown): void }
type ServerRequest = { guid: string }
type ServerFrame = { guid: string; _url: string; pendingDocument(): { request?: ServerRequest } | undefined }
type ServerPage = {
  guid: string; browserContext: { requestInterceptors: unknown[] }; requestInterceptors: unknown[]
  addNetworkRequest(): void; emitOnContext(): void; frameNavigatedToNewDocument(): void
  mainFrame(): ServerFrame; frameManager: ServerManager
}
type ServerManager = {
  frameAttached(id: string, parent: null): ServerFrame; mainFrame(): ServerFrame
  requestStarted(request: ServerRequest): void; frameRequestedNavigation(id: string): void
  frameCommittedSameDocumentNavigation(id: string, url: string): void
  frameCommittedNewDocumentNavigation(id: string, url: string, name: string, documentId: string, initial: boolean): void
  dispose(): void
}
const { Connection } = require(join(root, 'lib/client/connection.js')) as { Connection: new (platform: unknown) => ClientConnection }
const { nodePlatform } = require(join(root, 'lib/server/utils/nodePlatform.js')) as { nodePlatform: unknown }
const { FrameManager } = require(join(root, 'lib/server/frames.js')) as { FrameManager: new (page: ServerPage) => ServerManager }
const { SdkObject, createRootSdkObject } = require(join(root, 'lib/server/instrumentation.js')) as {
  SdkObject: new (parent: unknown, type: string) => ServerPage; createRootSdkObject(): unknown
}
const { Request: NativeRequest } = require(join(root, 'lib/server/network.js')) as {
  Request: new (context: object, frame: ServerFrame, worker: null, previous: ServerRequest | null,
    documentId: string, url: string, type: string, method: string, body: null, headers: unknown[]) => ServerRequest
}
const { DispatcherConnection, RootDispatcher } = require(join(root, 'lib/server/dispatchers/dispatcher.js')) as {
  DispatcherConnection: new (local: boolean) => { onmessage(message: Wire): void }
  RootDispatcher: new (connection: object) => object
}
const { FrameDispatcher } = require(join(root, 'lib/server/dispatchers/frameDispatcher.js')) as { FrameDispatcher: new (scope: object, frame: ServerFrame) => object }
const { RequestDispatcher } = require(join(root, 'lib/server/dispatchers/networkDispatchers.js')) as { RequestDispatcher: { from(scope: object, request: ServerRequest): unknown } }
const plan = createContextualTestPlan('pika_assignment_list_1a2b3c4d5e6f')
const source = plan.appOrigin + '/classrooms', target = plan.appOrigin + '/pattern-lab?role=teacher#history-preview'

function harness(current = source) {
  const client = new Connection(nodePlatform), outbound = vi.fn(() => { throw Error('Unexpected SDK command in CPU fixture') })
  client.onmessage = outbound
  const server = new DispatcherConnection(true)
  server.onmessage = message => client.dispatch(message)
  const scope = new RootDispatcher(server), nativePage = new SdkObject(createRootSdkObject(), 'page')
  Object.assign(nativePage, {
    browserContext: { requestInterceptors: [] }, requestInterceptors: [],
    addNetworkRequest() {}, emitOnContext() {}, frameNavigatedToNewDocument() {},
    mainFrame: () => nativePage.frameManager.mainFrame(),
  })
  const manager = nativePage.frameManager = new FrameManager(nativePage)
  const nativeFrame = manager.frameAttached('frame', null)
  nativeFrame._url = current
  new FrameDispatcher(scope, nativeFrame)
  client.dispatch({ guid: '', method: '__create__', params: {
    type: 'Page', guid: nativePage.guid, initializer: { mainFrame: { guid: nativeFrame.guid }, isClosed: false },
  } })
  const page = client.getObjectWithKnownName(nativePage.guid) as Page
  const frame = page.mainFrame() as Frame & { _eventEmitter: { on(name: string, listener: (event: unknown) => void): void; listenerCount(name: string): number } }
  const events: Array<{ newDocument?: { request?: { _object?: unknown } } }> = []
  frame._eventEmitter.on('navigated', event => { events.push(event as typeof events[number]) })
  const context = page.context(), boundary = new ContextualTestBoundary(plan, 2701000, () => 1000)
  const fence = new ContextualTestNavigation(boundary, context, () => 1000)
  function request(documentId = 'doc1') {
    const native = new NativeRequest(nativePage.browserContext, nativeFrame, null, null, documentId, target.split('#')[0], 'document', 'GET', null, [])
    manager.requestStarted(native)
    RequestDispatcher.from(scope, native)
    return { native, request: client.getObjectWithKnownName(native.guid) as Request }
  }
  async function release(request: Request) {
    boundary.requestStarted(context, request)
    boundary.admit(request.url(), request.method(), undefined, request.resourceType())
    boundary.requestIntercepted(context, request, request.method())
    const route = { request: () => request, continue: vi.fn(async () => {}), abort: vi.fn(async () => {}) }
    expect(await fence.route(route)).toBe(true)
    expect(route.continue).toHaveBeenCalledOnce(); expect(route.abort).not.toHaveBeenCalled()
  }
  function commit(documentId = 'doc1') { manager.frameCommittedNewDocumentNavigation('frame', target, '', documentId, false) }
  function assertSettled() {
    expect(boundary.pending(context)).toBe(0)
    expect(frame._eventEmitter.listenerCount('navigated')).toBe(1) // only this fixture's observer
    expect(outbound).not.toHaveBeenCalled()
  }
  return { page, manager, nativeFrame, events, context, boundary, fence, request, release, commit, assertSettled }
}

describe('installed server-to-client navigation coordination', () => {
  it.each(['navigate', 'reload'] as const)('awaits the real document request after an auxiliary history event during %s', async kind => {
    const h = harness(kind === 'reload' ? target : source)
    try {
      await h.fence.depart(h.page, target, 2000, async () => {
        const { native, request } = h.request()
        await h.release(request)
        // Real server history events have no newDocument, but preserve the
        // pending document request. Path/query changes are still same-document.
        h.manager.frameCommittedSameDocumentNavigation('frame', plan.appOrigin + '/changed?history=1')
        expect(h.events[0].newDocument).toBeUndefined()
        expect(h.nativeFrame.pendingDocument()?.request).toBe(native)
        h.commit()
        expect(h.events[1].newDocument?.request?._object).toBe(request)
        h.boundary.requestFinished(h.context, request)
      }, kind)
      expect(h.boundary.receipt().firstFailure).toBeNull()
      h.assertSettled()
    } finally { h.manager.dispose() }
  })

  it('does not accept an auxiliary-only server sequence as a document commit', async () => {
    const h = harness()
    try {
      await expect(h.fence.depart(h.page, target, 2000, async () => {
        const { request } = h.request(); await h.release(request)
        h.manager.frameCommittedSameDocumentNavigation('frame', target)
        h.boundary.requestFinished(h.context, request)
      })).rejects.toThrow('Private Test rehearsal boundary')
      expect(h.boundary.receipt().firstFailure).toBe('endpoint')
      expect(h.boundary.receipt().endpointFailure?.reason).toBe('navigation-pending')
      h.assertSettled()
    } finally { h.manager.dispose() }
  })

  it.each(['missing', 'wrong'] as const)('rejects a real document event carrying a %s request even after an auxiliary event', async kind => {
    const h = harness()
    try {
      await expect(h.fence.depart(h.page, target, 2000, async () => {
        const { request } = h.request(); await h.release(request)
        h.manager.frameCommittedSameDocumentNavigation('frame', source)
        // A missing document ID replaces the pending request; a distinct
        // navigation installs a different request. Neither is a valid commit.
        if (kind === 'missing') h.manager.frameRequestedNavigation('frame')
        else h.request('doc2')
        h.commit(kind === 'missing' ? 'doc1' : 'doc2')
        expect(h.events[1].newDocument).toBeDefined()
        expect(h.events[1].newDocument?.request?._object).not.toBe(request)
        h.boundary.requestFinished(h.context, request)
      })).rejects.toThrow('Private Test rehearsal boundary')
      expect(h.boundary.receipt().firstFailure).toBe('endpoint')
      expect(h.boundary.receipt().endpointFailure?.detail).toBe(kind === 'missing' ? 'commit-request-missing' : 'commit-request-mismatch')
      h.assertSettled()
    } finally { h.manager.dispose() }
  })
})
