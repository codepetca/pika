import { EventEmitter } from 'node:events'
import type { Frame, Page, Request, Route } from '@playwright/test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContextualTestBoundary } from '../../e2e/helpers/contextual-test-boundary'
import { ContextualTestNavigation } from '../../e2e/helpers/contextual-test-navigation'
import { createContextualTestPlan } from '../../e2e/helpers/contextual-test-rehearsal'

const plan = createContextualTestPlan('pika_assignment_list_1a2b3c4d5e6f')
const origin = plan.appOrigin, target = origin + '/classrooms/next'
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
function harness(now = () => 1000, current = origin + '/classrooms') {
  const context = {}, emitter = new EventEmitter()
  const boundary = new ContextualTestBoundary(plan, 2701000, now)
  const frame = { page: () => page, _eventEmitter: emitter } as unknown as Frame
  const frames = [frame]
  const page = { context: () => context, mainFrame: () => frame, frames: () => frames, url: () => current } as unknown as Page
  const fence = new ContextualTestNavigation(boundary, context, now)
  function request(options: { method?: string; url?: string; frame?: Frame; navigation?: boolean; previous?: Request; unknownFrame?: boolean } = {}) {
    return {
      method: () => options.method ?? 'GET', url: () => options.url ?? origin + '/api/auth/me',
      frame: () => { if (options.unknownFrame) throw Error('unknown frame'); return options.frame ?? frame },
      isNavigationRequest: () => options.navigation ?? false, redirectedFrom: () => options.previous ?? null,
      postDataJSON: () => undefined, resourceType: () => options.navigation ? 'document' : 'fetch',
    } as unknown as Request
  }
  function route(request: Request, overrides: { abort?: () => Promise<void>; continue?: () => Promise<void>; known?: boolean } = {}) {
    if (overrides.known !== false) boundary.requestStarted(context, request)
    boundary.admit(request.url(), request.method(), undefined, request.resourceType())
    boundary.requestIntercepted(context, request, request.method())
    return {
      request: () => request,
      continue: vi.fn(overrides.continue ?? (async () => {})),
      abort: vi.fn(overrides.abort ?? (async () => { boundary.requestFinished(context, request, true) })),
    }
  }
  function commit(request: Request, url = request.url()) {
    emitter.emit('navigated', { url, newDocument: { request: { _object: request } } })
    boundary.requestFinished(context, request)
  }
  async function navigate(url = target) {
    const navigation = request({ navigation: true, url }), navigationRoute = route(navigation)
    expect(await fence.route(navigationRoute)).toBe(true)
    commit(navigation)
    return navigationRoute
  }
  return { boundary, context, emitter, frame, frames, page, fence, request, route, commit, navigate }
}
afterEach(() => vi.useRealTimers())

describe('contextual Test departure navigation fence', () => {
  it('cancels a late native read after dispatch and before navigation interception', async () => {
    const h = harness()
    await h.fence.depart(h.page, target, 2000, async () => {
      await Promise.resolve()
      const late = h.route(h.request())
      await h.fence.route(late)
      expect(late.abort).toHaveBeenCalledExactlyOnceWith('aborted')
      expect(late.continue).not.toHaveBeenCalled()
      await h.navigate()
    })
    expect(h.boundary.receipt().firstFailure).toBeNull()
    expect(h.boundary.pending(h.context)).toBe(0)
  })

  it('arms before draining, awaits original sent transport/body, and cancels only new held reads', async () => {
    const h = harness(), original = h.request(), body = deferred<Buffer>(), entered = deferred<void>()
    const old = h.route(original)
    h.boundary.requestReleased(h.context, original); await old.continue()
    const action = vi.fn(async () => { entered.resolve(); await h.navigate() })
    const departure = h.fence.depart(h.page, target, 2000, action)
    const late = h.route(h.request())
    await h.fence.route(late)
    expect(late.abort).toHaveBeenCalledOnce(); expect(action).not.toHaveBeenCalled()
    const observed = h.boundary.observe(h.context, {
      url: () => original.url(), status: () => 200, headers: () => ({ 'content-type': 'application/json' }), body: () => body.promise,
    }, original)
    h.boundary.requestFinished(h.context, original)
    await Promise.resolve(); expect(action).not.toHaveBeenCalled()
    body.resolve(Buffer.from('{}')); await observed; await entered.promise; await departure
    expect(action).toHaveBeenCalledOnce(); expect(old.abort).not.toHaveBeenCalled()
  })

  it('keeps the fence after continue resolves until the exact commit, then admits new assets normally', async () => {
    const h = harness()
    await h.fence.depart(h.page, target + '#section', 2000, async () => {
      const navigation = h.request({ navigation: true, url: target }), nav = h.route(navigation)
      await h.fence.route(nav)
      expect(nav.continue).toHaveBeenCalledOnce()
      const beforeCommit = h.route(h.request())
      await h.fence.route(beforeCommit); expect(beforeCommit.abort).toHaveBeenCalledOnce()
      h.commit(navigation, target + '#section')
      const assetRequest = h.request({ url: origin + '/asset.js' }), asset = h.route(assetRequest)
      expect(await h.fence.route(asset)).toBe(false)
      h.boundary.requestReleased(h.context, assetRequest); await asset.continue()
      h.boundary.requestFinished(h.context, assetRequest)
      expect(asset.abort).not.toHaveBeenCalled()
    })
    expect(h.emitter.listenerCount('navigated')).toBe(0)
  })

  it('accepts only an exact redirect predecessor and commits the last hop', async () => {
    const h = harness()
    await h.fence.depart(h.page, target, 2000, async () => {
      const first = h.request({ navigation: true, url: target })
      await h.fence.route(h.route(first)); h.boundary.requestFinished(h.context, first)
      const last = h.request({ navigation: true, url: origin + '/classrooms/final', previous: first })
      await h.fence.route(h.route(last))
      const late = h.route(h.request({ method: 'HEAD' }))
      await h.fence.route(late); expect(late.continue).not.toHaveBeenCalled()
      h.commit(last)
    })
    expect(h.boundary.receipt().firstFailure).toBeNull()
  })

  it.each(['wrong-first-url', 'unrelated-second', 'wrong-predecessor', 'HEAD'] as const)('rejects %s navigation without continuing it', async scenario => {
    const h = harness()
    await expect(h.fence.depart(h.page, target, 2000, async () => {
      let first: Request | undefined
      if (scenario === 'unrelated-second' || scenario === 'wrong-predecessor') {
        first = h.request({ navigation: true, url: target }); await h.fence.route(h.route(first))
        h.boundary.requestFinished(h.context, first)
      }
      const invalid = h.route(h.request({ navigation: true,
        url: scenario === 'wrong-first-url' ? target + '?unexpected=1' : target,
        method: scenario === 'HEAD' ? 'HEAD' : 'GET',
        previous: scenario === 'wrong-predecessor' ? h.request() : undefined,
      }))
      await expect(h.fence.route(invalid)).rejects.toThrow()
      expect(invalid.continue).not.toHaveBeenCalled()
      h.boundary.check()
    })).rejects.toThrow()
    expect(h.boundary.receipt().endpointFailure?.reason).toBe('route-inspection')
    expect(h.boundary.receipt().endpointFailure?.detail).toBe(scenario === 'wrong-first-url' ? 'navigation-target'
      : scenario === 'HEAD' ? 'navigation-method' : 'redirect-predecessor')
  })

  it.each(['wrong-request', 'missing-request', 'same-document-event', 'wrong-url', 'error'] as const)('does not release on a %s commit event', async scenario => {
    const h = harness()
    await expect(h.fence.depart(h.page, target, 2000, async () => {
      const navigation = h.request({ navigation: true, url: target })
      await h.fence.route(h.route(navigation))
      h.emitter.emit('navigated', {
        url: scenario === 'wrong-url' ? target + '/wrong' : target,
        ...(scenario === 'same-document-event' ? {} : { newDocument: scenario === 'missing-request' ? {} : { request: { _object: scenario === 'wrong-request' ? h.request() : navigation } } }),
        ...(scenario === 'error' ? { error: 'failed' } : {}),
      })
      h.boundary.requestFinished(h.context, navigation)
    })).rejects.toThrow()
    expect(h.boundary.receipt().firstFailure).toBe('endpoint')
    if (scenario !== 'error') expect(h.boundary.receipt().endpointFailure?.detail).toBe(
      scenario === 'wrong-url' ? 'commit-url' : 'commit-request')
  })

  it('rejects command completion without a matching document commit', async () => {
    const h = harness()
    await expect(h.fence.depart(h.page, target, 2000, async () => {
      const request = h.request({ navigation: true, url: target })
      await h.fence.route(h.route(request)); h.boundary.requestFinished(h.context, request)
    })).rejects.toThrow()
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('never cancels or continues %s during departure', async method => {
    const h = harness()
    await expect(h.fence.depart(h.page, target, 2000, async () => {
      // A non-API URL permits boundary admission; the fence must independently
      // reject a mutation even when admission itself permits the endpoint.
      const route = h.route(h.request({ method, url: origin + '/resource' }))
      await expect(h.fence.route(route)).rejects.toThrow()
      expect(route.abort).not.toHaveBeenCalled(); expect(route.continue).not.toHaveBeenCalled()
      h.boundary.check()
    })).rejects.toThrow()
  })

  it.each(['foreign-page', 'detached-frame', 'unknown-frame', 'subframe-navigation'] as const)('rejects %s ownership', async scenario => {
    const h = harness()
    const other = { page: () => scenario === 'foreign-page' ? {} : h.page } as unknown as Frame
    if (scenario === 'subframe-navigation') h.frames.push(other)
    await expect(h.fence.depart(h.page, target, 2000, async () => {
      const route = h.route(h.request({ frame: other, unknownFrame: scenario === 'unknown-frame', navigation: scenario === 'subframe-navigation' }))
      await h.fence.route(route)
    })).rejects.toThrow()
    expect(h.boundary.receipt().endpointFailure?.reason).toBe('route-inspection')
    expect(h.boundary.receipt().endpointFailure?.detail).toBe({
      'foreign-page': 'frame-page', 'detached-frame': 'frame-detached',
      'unknown-frame': 'frame-unavailable', 'subframe-navigation': 'navigation-frame',
    }[scenario])
  })

  it('cancels a held read in a live owned subframe', async () => {
    const h = harness(), subframe = { page: () => h.page } as unknown as Frame
    h.frames.push(subframe)
    await h.fence.depart(h.page, target, 2000, async () => {
      const route = h.route(h.request({ frame: subframe }))
      await h.fence.route(route); expect(route.abort).toHaveBeenCalledOnce(); await h.navigate()
    })
  })

  it('requires a known intercepted lifetime rather than inferring one from a route', async () => {
    const h = harness()
    await expect(h.fence.depart(h.page, target, 2000, async () => {
      const route = { request: () => h.request(), abort: vi.fn(async () => {}), continue: vi.fn(async () => {}) }
      await expect(h.fence.route(route)).rejects.toThrow()
      expect(route.abort).not.toHaveBeenCalled(); h.boundary.check()
    })).rejects.toThrow()
  })

  it.each(['released-transport', 'original-body'] as const)('fails navigation when %s appears after dispatch', async scenario => {
    const h = harness(), body = deferred<Buffer>()
    await expect(h.fence.depart(h.page, target, 2000, async () => {
      const pending = h.request(); h.route(pending); h.boundary.requestReleased(h.context, pending)
      if (scenario === 'original-body') {
        h.boundary.observe(h.context, { url: () => pending.url(), status: () => 200, headers: () => ({ 'content-type': 'application/json' }), body: () => body.promise }, pending)
        h.boundary.requestFinished(h.context, pending)
      }
      const nav = h.route(h.request({ navigation: true, url: target }))
      await expect(h.fence.route(nav)).rejects.toThrow(); expect(nav.continue).not.toHaveBeenCalled()
      body.resolve(Buffer.from('{}')); h.boundary.check()
    })).rejects.toThrow()
    expect(h.boundary.receipt().endpointFailure?.reason).toBe('navigation-pending')
  })

  it('holds navigation until both abort acknowledgement and matching failed event', async () => {
    const h = harness(), acknowledgement = deferred<void>(), attempted = deferred<void>()
    await h.fence.depart(h.page, target, 2000, async () => {
      const request = h.request(), read = h.route(request, { abort: () => { attempted.resolve(); return acknowledgement.promise } })
      const cancelling = h.fence.route(read); await attempted.promise
      const navigation = h.request({ navigation: true, url: target }), nav = h.route(navigation)
      const navigating = h.fence.route(nav)
      h.boundary.requestFinished(h.context, request, true)
      await Promise.resolve(); expect(nav.continue).not.toHaveBeenCalled()
      acknowledgement.resolve(); await cancelling; await navigating
      h.commit(navigation)
    })
  })

  it.each(['abort-rejects', 'missing-failed-event'] as const)('retains failure when %s', async scenario => {
    vi.useFakeTimers()
    let now = 1000
    const h = harness(() => now)
    const departure = h.fence.depart(h.page, target, 2000, async () => {
      const request = h.request(), read = h.route(request, { abort: async () => {
        if (scenario === 'abort-rejects') throw Error('abort rejected')
      } })
      await h.fence.route(read)
    })
    const rejected = expect(departure).rejects.toThrow()
    if (scenario === 'missing-failed-event') { now = 2000; await vi.advanceTimersByTimeAsync(1000) }
    await rejected
    expect(h.boundary.receipt().firstFailure).toBe(scenario === 'abort-rejects' ? 'response-body' : 'deadline')
  })

  it('treats fragment navigation explicitly with no read cancellation and retains late body ownership', async () => {
    const h = harness(), body = deferred<Buffer>(), acted = deferred<void>(), completed = vi.fn()
    const departure = h.fence.depart(h.page, origin + '/classrooms#section', 2000, async () => {
      const request = h.request(), read = h.route(request)
      expect(await h.fence.route(read)).toBe(false)
      h.boundary.requestReleased(h.context, request); await read.continue()
      h.boundary.observe(h.context, { url: () => request.url(), status: () => 200, headers: () => ({ 'content-type': 'application/json' }), body: () => body.promise }, request)
      h.boundary.requestFinished(h.context, request)
      h.emitter.emit('navigated', { url: origin + '/classrooms#section' })
      expect(read.abort).not.toHaveBeenCalled(); acted.resolve()
    }).then(completed)
    await acted.promise; await Promise.resolve(); expect(completed).not.toHaveBeenCalled()
    body.resolve(Buffer.from('{}')); await departure; expect(completed).toHaveBeenCalledOnce()
  })

  it('requires a new document for explicit reload even with a fragment', async () => {
    const url = target + '#section', h = harness(() => 1000, url)
    await h.fence.depart(h.page, url, 2000, async () => {
      const late = h.route(h.request()); await h.fence.route(late)
      expect(late.abort).toHaveBeenCalledOnce(); await h.navigate(target)
    }, 'reload')
  })

  it('fails closed when the pinned private observer is absent', async () => {
    const h = harness(), action = vi.fn(async () => {})
    delete (h.frame as unknown as { _eventEmitter?: unknown })._eventEmitter
    await expect(h.fence.depart(h.page, target, 2000, action)).rejects.toThrow()
    expect(action).not.toHaveBeenCalled()
  })
})
