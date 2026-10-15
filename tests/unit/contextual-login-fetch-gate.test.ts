import { describe, expect, it, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import type { BrowserContext } from '@playwright/test'
import { installLoginFetchGate, loginFetchGateInit } from '../../e2e/helpers/contextual-login-fetch-gate'

const origin = 'http://127.0.0.1:43210'
const binding = '__pikaLoginBodyReady'
function browserPage(allow: Promise<boolean>) {
  const response = { original: true }, fetch = vi.fn(async () => response), ready = vi.fn(() => allow)
  const page = { fetch, location: { href: origin + '/login' }, [binding]: ready } as Record<string, unknown>
  page.top = page
  runInNewContext(`(${loginFetchGateInit.toString()})(${JSON.stringify({ origin, binding })})`, { window: page, URL, Request, Error })
  return { page, response, fetch, ready, call: page.fetch as typeof window.fetch }
}
describe('pre-navigation login fetch gate (CPU only)', () => {
  it('keeps the exact original response from the app until host verification; never pauses navigation or reads a replacement body', async () => {
    let release!: (yes: boolean) => void
    const p = browserPage(new Promise(resolve => { release = resolve }))
    let returned = false
    const result = p.call('/api/auth/login', { method: 'POST', body: 'private' }).then(value => { returned = true; return value })
    await new Promise(resolve => setImmediate(resolve))
    expect(returned).toBe(false); expect(p.fetch).toHaveBeenCalledExactlyOnceWith('/api/auth/login', { method: 'POST', body: 'private' })
    expect(p.ready).toHaveBeenCalledOnce()
    release(true); expect(await result).toBe(p.response)
  })
  it('rejects cancellation and duplicate login without replaying the native fetch', async () => {
    const p = browserPage(Promise.resolve(false))
    await expect(p.call('/api/auth/login', { method: 'POST' })).rejects.toThrow('Private login verification')
    await expect(p.call('/api/auth/login', { method: 'POST' })).rejects.toThrow('Private login verification')
    expect(p.fetch).toHaveBeenCalledOnce()
  })
  it('passes unrelated fetches through and recognizes Request input without consuming its body', async () => {
    const p = browserPage(Promise.resolve(true))
    expect(await p.call('/other')).toBe(p.response); expect(p.ready).not.toHaveBeenCalled()
    const request = new Request(origin + '/api/auth/login', { method: 'POST', body: 'private' })
    expect(await p.call(request)).toBe(p.response); expect(request.bodyUsed).toBe(false)
    expect(p.fetch).toHaveBeenLastCalledWith(request, undefined); expect(p.ready).toHaveBeenCalledOnce()
  })
  it('binds one main-frame caller to the owned login page and checks the original deadline again after release', async () => {
    let callback!: (...args: any[]) => Promise<boolean>
    const context = { exposeBinding: vi.fn(async (_name, cb) => { callback = cb }), addInitScript: vi.fn(async () => {}) }
    const frame = {}, page = { context: () => context, mainFrame: () => frame, url: () => origin + '/login' }
    const check = vi.fn(), waiting = vi.fn()
    const gate = await installLoginFetchGate(context as unknown as BrowserContext, origin, check, waiting)
    const result = callback({ context, page, frame })
    expect(waiting).toHaveBeenCalledOnce(); expect(check).toHaveBeenCalledOnce()
    gate.release(true); expect(await result).toBe(true); expect(check).toHaveBeenCalledTimes(2)
    await expect(callback({ context, page, frame })).rejects.toThrow()
  })
  it.each(['foreign', 'subframe', 'arguments', 'late', 'cancelled'] as const)('fails closed for %s without granting navigation', async kind => {
    let callback!: (...args: any[]) => Promise<boolean>
    const context = { exposeBinding: vi.fn(async (_name, cb) => { callback = cb }), addInitScript: vi.fn(async () => {}) }
    const frame = {}, page = { context: () => context, mainFrame: () => frame, url: () => origin + '/login' }
    const check = vi.fn()
    const gate = await installLoginFetchGate(context as unknown as BrowserContext, origin, check)
    if (kind === 'late') check.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw Error('deadline') })
    const pending = callback({ context: kind === 'foreign' ? {} : context, page, frame: kind === 'subframe' ? {} : frame }, ...(kind === 'arguments' ? ['private'] : []))
    gate.release(kind !== 'cancelled')
    await expect(pending).rejects.toThrow()
  })
})
