/** Rehearsal-only timing barrier. Never substitutes, clones or consumes a
 * response: the application's native fetch returns its same Response after
 * the host has verified the original Playwright Response bytes. This avoids
 * pausing a Chromium navigation request while waiting for Network.getResponseBody.
 */
import assert from 'node:assert/strict'
import type { BrowserContext } from '@playwright/test'

export function loginFetchGateInit({ origin, binding }: { origin: string; binding: string }) {
  if (window.top !== window || window.location.href !== origin + '/login') return
  const nativeFetch = window.fetch.bind(window)
  let used = false
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : new URL(String(input), window.location.href).href
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    if (url !== origin + '/api/auth/login' || method !== 'POST') return nativeFetch(input, init)
    if (used) throw new Error('Private login verification')
    used = true
    const response = await nativeFetch(input, init)
    const ready = (window as unknown as Record<string, () => Promise<boolean>>)[binding]
    if (typeof ready !== 'function' || await ready() !== true) throw new Error('Private login verification')
    return response
  }
}

export async function installLoginFetchGate(context: BrowserContext, origin: string, check: () => void, waiting = () => {}) {
  const binding = '__pikaLoginBodyReady'
  const url = new URL(origin)
  assert(url.origin === origin && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
  let settle!: (verified: boolean) => void, used = false, settled = false, revoked = false
  const decision = new Promise<boolean>(resolve => { settle = resolve })
  await context.exposeBinding(binding, async (source, ...args: unknown[]) => {
    assert(source.context === context && source.page.context() === context && source.frame === source.page.mainFrame())
    assert(source.page.url() === origin + '/login' && args.length === 0 && !used)
    check(); used = true; waiting()
    const verified = await decision
    check(); assert(verified && !revoked, 'Private login verification')
    return true
  })
  await context.addInitScript(loginFetchGateInit, { origin, binding })
  return { release(verified: boolean) {
    if (!verified) revoked = true
    if (!settled) { settled = true; settle(verified) }
  } }
}
