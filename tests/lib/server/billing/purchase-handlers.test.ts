import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import { createBillingPurchaseHandlers } from '@/lib/server/billing/purchase-handlers'

const origin = 'http://localhost:3000'
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const attemptId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const offeringVersionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const operationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const context = { params: Promise.resolve({ id: attemptId }) }
const result = { attemptId, status: 'pending' as const, checkoutUrl: null }
function setup() {
  const runtime = {
    listCatalog: vi.fn().mockResolvedValue([]),
    startCheckout: vi.fn().mockResolvedValue(result),
    getCheckout: vi.fn().mockResolvedValue(result),
  }
  const deps = {
    configuration: vi.fn<() => { appOrigin: string } | null>(() => ({ appOrigin: origin })),
    authenticate: vi.fn().mockResolvedValue({ id: userId }),
    loadRuntime: vi.fn().mockResolvedValue(runtime),
  }
  return { ...deps, runtime, handlers: createBillingPurchaseHandlers(deps) }
}
function request(body: unknown = { offeringVersionId, operationId }, headers = {}) {
  return new NextRequest(`${origin}/api/billing/checkout`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}
describe('authenticated purchase boundaries', () => {
  it('keeps every endpoint inaccessible without constructing clients when disabled', async () => {
    const env = setup()
    env.configuration.mockReturnValue(null)
    for (const handler of Object.values(env.handlers)) {
      expect((await handler(request(), context)).status).toBe(404)
    }
    expect(env.authenticate).not.toHaveBeenCalled()
    expect(env.loadRuntime).not.toHaveBeenCalled()
  })
  it.each(['AuthenticationError', 'AuthorizationError'])('rejects %s before loading clients', async name => {
    const env = setup()
    env.authenticate.mockRejectedValue(Object.assign(new Error('Denied'), { name }))
    expect((await env.handlers.start(request(), context)).status).toBe(name === 'AuthenticationError' ? 401 : 403)
    expect(env.loadRuntime).not.toHaveBeenCalled()
  })
  it('uses only authenticated identity and makes checkout responses uncacheable', async () => {
    const env = setup()
    const response = await env.handlers.start(request(), context)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(env.runtime.startCheckout).toHaveBeenCalledWith({ subjectUserId: userId, offeringVersionId, operationId })
  })
  it('rejects customer, account and price injection', async () => {
    const env = setup()
    const response = await env.handlers.start(request({ offeringVersionId, operationId, subjectUserId: attemptId, priceId: 'price_attacker' }), context)
    expect(response.status).toBe(400)
    expect(env.loadRuntime).not.toHaveBeenCalled()
  })
  it.each(['https://attacker.example', 'null', 'http://localhost:3001'])('rejects origin %s independently of Host', async invalidOrigin => {
    const env = setup()
    const response = await env.handlers.start(request(undefined, { origin: invalidOrigin, host: 'localhost:3000' }), context)
    expect(response.status).toBe(403)
    expect(env.loadRuntime).not.toHaveBeenCalled()
  })
  it('bounds the streamed body without trusting Content-Length', async () => {
    const env = setup()
    expect((await env.handlers.start(request({ padding: 'x'.repeat(5000) }), context)).status).toBe(413)
    expect(env.loadRuntime).not.toHaveBeenCalled()
  })
  it('looks up status with the authenticated owner and hides missing or foreign attempts', async () => {
    const env = setup()
    env.runtime.getCheckout.mockResolvedValue(null)
    const response = await env.handlers.status(new NextRequest(`${origin}/api/billing/checkout/${attemptId}?paid=true`), context)
    expect(response.status).toBe(404)
    expect(env.runtime.getCheckout).toHaveBeenCalledWith({ subjectUserId: userId, attemptId })
    expect(env.runtime.startCheckout).not.toHaveBeenCalled()
  })
})
