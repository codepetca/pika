/** Departure-scoped routing for the private, source-pinned rehearsal only. */
import type { Frame, Page, Request, Route } from '@playwright/test'
import type { ContextualTestBoundary } from './contextual-test-boundary'

type NavigationEvent = {
  url: string
  error?: string
  newDocument?: { request?: { _object?: unknown } }
}
type NavigationEmitter = {
  on(event: 'navigated', listener: (event: NavigationEvent) => void): unknown
  removeListener(event: 'navigated', listener: (event: NavigationEvent) => void): unknown
}

/** Playwright 1.58's public framenavigated event loses newDocument/request.
 * Its pinned client Frame forwards the decoded channel event here, and the
 * pinned ChannelOwner binds channel._object to the original Request. The
 * runner verifies those installed sources before constructing this helper.
 * Missing private shape is an incompatibility, never a public-event fallback.
 */
export function observeContextualTestNavigation(frame: Frame, listener: (event: NavigationEvent) => void) {
  const emitter = (frame as unknown as { _eventEmitter?: NavigationEmitter })._eventEmitter
  if (!emitter || typeof emitter.on !== 'function' || typeof emitter.removeListener !== 'function') {
    throw new Error('Private Test navigation observer incompatible')
  }
  emitter.on('navigated', listener)
  return () => { emitter.removeListener('navigated', listener) }
}

function withoutHash(value: string) { const url = new URL(value); url.hash = ''; return url.href }
type Departure = {
  page: Page
  frame: Frame
  target: string
  end: number
  sameDocument: boolean
  dispatched: boolean
  committed: boolean
  last: Request | null
  released: boolean
}

export class ContextualTestNavigation {
  private active: Departure | undefined

  constructor(private readonly boundary: ContextualTestBoundary, private readonly context: object, private readonly now = Date.now) {}

  private check(departure: Departure) {
    this.boundary.check()
    if (this.active !== departure || this.now() >= departure.end) this.boundary.endpoint('navigation-pending')
  }

  /** The runtime must admit/count and requestIntercepted EVERY route before
   * calling this method. False delegates ordinary release to that same runtime.
   * No rejected route is continued here, including one from a foreign page.
   */
  async route(route: Pick<Route, 'request' | 'continue' | 'abort'>): Promise<boolean> {
    const departure = this.active
    if (!departure || departure.committed) return false
    this.check(departure)
    const request = route.request()
    let frame: Frame
    try { frame = request.frame() } catch { return this.boundary.inspection('frame-unavailable') }
    if (frame.page() !== departure.page) this.boundary.inspection('frame-page')
    if (departure.page.context() !== this.context) this.boundary.inspection('frame-context')
    if (!departure.page.frames().includes(frame)) this.boundary.inspection('frame-detached')
    const method = request.method()
    if (!['GET', 'HEAD'].includes(method)) this.boundary.inspection('read-method')
    if (request.isNavigationRequest()) {
      // Subframe documents are unrelated navigation, not incidental reads.
      if (frame !== departure.frame) this.boundary.inspection('navigation-frame')
      if (method !== 'GET') this.boundary.inspection('navigation-method')
      if (departure.sameDocument) this.boundary.inspection('navigation-fragment')
      if (!departure.dispatched) this.boundary.inspection('navigation-before-dispatch')
      const previous = request.redirectedFrom()
      if (departure.last) {
        if (previous !== departure.last) this.boundary.inspection('redirect-predecessor')
        if (!departure.released) this.boundary.inspection('redirect-before-release')
      } else {
        if (previous !== null) this.boundary.inspection('navigation-first-redirect')
        if (withoutHash(request.url()) !== withoutHash(departure.target)) this.boundary.inspection('navigation-target')
      }
      departure.last = request; departure.released = false
      await this.boundary.waitForNavigation(this.context, request, departure.end)
      this.check(departure)
      if (departure.last !== request) this.boundary.inspection('navigation-superseded')
      if (departure.committed) this.boundary.inspection('navigation-already-committed')
      this.boundary.requestReleased(this.context, request)
      departure.released = true
      // Continuation acknowledgement is not a commit. Keep cancelling old
      // document reads until the exact last redirect request commits below.
      await route.continue()
      this.boundary.check()
      return true
    }
    if (departure.sameDocument) return false
    await this.boundary.cancelUnsentRead(this.context, request, () => route.abort('aborted'), departure.end)
    return true
  }

  async depart(page: Page, intendedUrl: string, operationEnd: number, action: (timeout: number) => Promise<unknown>, kind: 'navigate' | 'reload' = 'navigate') {
    this.boundary.check()
    if (this.active) this.boundary.inspection('departure-active')
    if (page.context() !== this.context) this.boundary.inspection('departure-context')
    const target = new URL(intendedUrl).href, current = new URL(page.url()).href
    const departure: Departure = {
      page, frame: page.mainFrame(), target, end: operationEnd,
      // A fragment-only navigation does not discard its document. A request to
      // the exact unfragmented URL, and explicit reload, still require a commit.
      sameDocument: kind === 'navigate' && withoutHash(current) === withoutHash(target)
        && (current !== target || new URL(target).hash !== ''),
      dispatched: false, committed: false, last: null, released: false,
    }
    // Arm before draining: late old-document routes must not escape while an
    // already-sent transport or its original response body is being awaited.
    this.active = departure
    let unobserve: (() => void) | undefined
    try {
      unobserve = observeContextualTestNavigation(departure.frame, event => {
        try {
          this.check(departure)
          if (departure.committed || !departure.dispatched || event.error) this.boundary.endpoint('navigation-pending')
          if (departure.sameDocument) {
            if (event.newDocument !== undefined) this.boundary.inspection('fragment-document')
            if (event.url !== departure.target) this.boundary.inspection('fragment-url')
          } else {
            if (!departure.last) this.boundary.inspection('commit-missing-navigation')
            if (!departure.released) this.boundary.inspection('commit-before-release')
            if (event.newDocument?.request?._object !== departure.last) this.boundary.inspection('commit-request')
            if (withoutHash(event.url) !== withoutHash(departure.last.url())) this.boundary.inspection('commit-url')
          }
          departure.committed = true
          unobserve?.()
        } catch {
          // Event listeners must not throw into Playwright. Latch the fixed
          // failure; the departing operation and all future admissions fail.
          try { this.boundary.inspection('commit-callback') } catch { /* latched */ }
        }
      })
      await this.boundary.depart(this.context, operationEnd, timeout => {
        this.check(departure)
        departure.dispatched = true
        return action(timeout)
      })
      this.check(departure)
      if (!departure.committed) this.boundary.endpoint('navigation-pending')
    } catch {
      // Includes a missing private emitter and a failed native navigation.
      this.boundary.endpoint('navigation-pending')
    } finally {
      unobserve?.()
      this.active = undefined
    }
  }
}
