import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBillingUpgradeHandlers } from '@/lib/server/billing/upgrade-handlers'
import { UpgradeConfirmationError, UpgradeEligibilityError } from '@/lib/server/billing/upgrade-contracts'
import { POST as startRoute } from '@/app/api/billing/upgrade/route'
import { POST as confirmRoute } from '@/app/api/billing/upgrade/confirm/route'
import { GET as statusRoute } from '@/app/api/billing/upgrade/[id]/route'

const entrypoint = vi.hoisted(() => ({ authenticate: vi.fn(), configuration: vi.fn(), runtime: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRole: entrypoint.authenticate }))
vi.mock('@/lib/server/billing/upgrade-runtime', () => ({
  readBillingUpgradeConfig: entrypoint.configuration, createBillingUpgradeRuntime: entrypoint.runtime,
}))

const origin = 'http://localhost:3000'
const subjectUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const operationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const offeringVersionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const quoteDigest = 'a'.repeat(64)
const context = { params: Promise.resolve({ id: operationId }) }
const pending = { operationId, status: 'pending', quote: null }
function setup() {
  const runtime = { startUpgrade: vi.fn().mockResolvedValue(pending), confirmUpgrade: vi.fn().mockResolvedValue(pending),
    getUpgrade: vi.fn().mockResolvedValue(pending) }
  const deps = { configuration: vi.fn<() => { appOrigin: string } | null>(() => ({ appOrigin: origin })),
    authenticate: vi.fn().mockResolvedValue({ id: subjectUserId }), loadRuntime: vi.fn().mockResolvedValue(runtime) }
  return { runtime, ...deps, handlers: createBillingUpgradeHandlers(deps) }
}
function request(body: unknown = { operationId, offeringVersionId }, headers = {}) {
  return new NextRequest(`${origin}/api/billing/upgrade`, { method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
}
describe('upgrade request boundaries', () => {
  it('hides all disabled endpoints before auth or runtime construction', async () => {
    const f = setup(); f.configuration.mockReturnValue(null)
    for (const handler of Object.values(f.handlers)) expect((await handler(request(), context)).status).toBe(404)
    expect(f.authenticate).not.toHaveBeenCalled(); expect(f.loadRuntime).not.toHaveBeenCalled()
  })
  it.each(['AuthenticationError', 'AuthorizationError'])('rejects %s before constructing clients', async name => {
    const f = setup(); f.authenticate.mockRejectedValue(Object.assign(new Error('denied'), { name }))
    expect((await f.handlers.start(request(), context)).status).toBe(name === 'AuthenticationError' ? 401 : 403)
    expect(f.loadRuntime).not.toHaveBeenCalled()
  })
  it('starts using only authenticated identity with private no-store response', async () => {
    const f = setup(); const response = await f.handlers.start(request(), context)
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(f.runtime.startUpgrade).toHaveBeenCalledWith({ subjectUserId, operationId, offeringVersionId })
    expect(await response.json()).toEqual(pending)
  })
  it('passes the exact revision and digest for confirmation', async () => {
    const f = setup(); const response = await f.handlers.confirm(request({ operationId, quoteRevision: 3, quoteDigest }), context)
    expect(response.status).toBe(200)
    expect(f.runtime.confirmUpgrade).toHaveBeenCalledWith({ subjectUserId, operationId, quoteRevision: 3, quoteDigest })
  })
  it.each(['https://attacker.example', 'null', 'http://localhost:3001'])('rejects origin %s before runtime', async invalid => {
    const f = setup()
    expect((await f.handlers.start(request(undefined, { origin: invalid }), context)).status).toBe(403)
    expect(f.loadRuntime).not.toHaveBeenCalled()
  })
  it.each([
    { operationId, offeringVersionId, subjectUserId },
    { operationId, offeringVersionId, amountDue: 1 },
    { operationId, offeringVersionId, customerId: 'cus_other' },
    { operationId: 'invalid', offeringVersionId },
  ])('rejects malicious or malformed quote input %#', async body => {
    const f = setup(); expect((await f.handlers.start(request(body), context)).status).toBe(400)
    expect(f.loadRuntime).not.toHaveBeenCalled()
  })
  it.each([
    { operationId, quoteRevision: 0, quoteDigest },
    { operationId, quoteRevision: 1, quoteDigest: 'invalid' },
    { operationId, quoteRevision: 1, quoteDigest, amountDue: 1 },
  ])('rejects invalid confirmation input %#', async body => {
    const f = setup(); expect((await f.handlers.confirm(request(body), context)).status).toBe(400)
    expect(f.loadRuntime).not.toHaveBeenCalled()
  })
  it('bounds streamed body independently of Content-Length', async () => {
    const f = setup(); expect((await f.handlers.start(request({ padding: 'x'.repeat(5000) }), context)).status).toBe(413)
    expect(f.loadRuntime).not.toHaveBeenCalled()
  })
  it('rejects wrong content type and malformed JSON before runtime', async () => {
    const f = setup()
    expect((await f.handlers.start(request(undefined, { 'content-type': 'text/plain' }), context)).status).toBe(415)
    const malformed = new NextRequest(`${origin}/api/billing/upgrade`, { method: 'POST',
      headers: { origin, 'content-type': 'application/json' }, body: '{' })
    expect((await f.handlers.start(malformed, context)).status).toBe(400)
    expect(f.loadRuntime).not.toHaveBeenCalled()
  })
  it.each([['start', new UpgradeEligibilityError()], ['confirm', new UpgradeConfirmationError()]] as const)(
    'maps %s domain denial to a safe conflict', async (method, error) => {
      const f = setup(); const callback = method === 'start' ? f.runtime.startUpgrade : f.runtime.confirmUpgrade
      callback.mockRejectedValue(error)
      const response = await f.handlers[method](request(method === 'start' ? undefined : { operationId, quoteRevision: 1, quoteDigest }), context)
      expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: error.message })
    },
  )
  it('reads status for the owner without starting or confirming provider writes', async () => {
    const f = setup(); const response = await f.handlers.status(new NextRequest(`${origin}/api/billing/upgrade/${operationId}`), context)
    expect(response.status).toBe(200)
    expect(f.runtime.getUpgrade).toHaveBeenCalledWith({ subjectUserId, operationId })
    expect(f.runtime.startUpgrade).not.toHaveBeenCalled(); expect(f.runtime.confirmUpgrade).not.toHaveBeenCalled()
  })
  it('hides missing and foreign operations', async () => {
    const f = setup(); f.runtime.getUpgrade.mockResolvedValue(null)
    expect((await f.handlers.status(new NextRequest(origin), context)).status).toBe(404)
  })
  it('maps missing reservations and confirmations to private 404 responses', async () => {
    const f = setup(); f.runtime.startUpgrade.mockResolvedValue(null); f.runtime.confirmUpgrade.mockResolvedValue(null)
    expect((await f.handlers.start(request(), context)).status).toBe(404)
    expect((await f.handlers.confirm(request({ operationId, quoteRevision: 1, quoteDigest }), context)).status).toBe(404)
  })
  it.each([
    { ...pending, customerId: 'cus_private' },
    { ...pending, operationId: offeringVersionId },
    { operationId, status: 'quoted', quote: null },
  ])('fails closed with safe 500 for malformed runtime output %#', async value => {
    const f = setup(); f.runtime.startUpgrade.mockResolvedValue(value)
    const response = await f.handlers.start(request(), context)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Internal server error' })
  })
  it('makes rejected responses private and uncacheable', async () => {
    const f = setup(); f.configuration.mockReturnValue(null)
    expect((await f.handlers.start(request(), context)).headers.get('cache-control')).toBe('private, no-store')
  })
})

describe('upgrade route wiring', () => {
  beforeEach(() => {
    entrypoint.authenticate.mockReset(); entrypoint.configuration.mockReset(); entrypoint.runtime.mockReset()
  })
  it('gates every exported route before teacher authorization or SDK construction', async () => {
    entrypoint.configuration.mockReturnValue(null)
    for (const route of [startRoute, confirmRoute, statusRoute]) {
      const response = await route(request(), context)
      expect(response.status).toBe(404); expect(response.headers.get('cache-control')).toBe('private, no-store')
    }
    expect(entrypoint.authenticate).not.toHaveBeenCalled(); expect(entrypoint.runtime).not.toHaveBeenCalled()
  })
  it('requires the teacher role on the actual route and rejects students before loading clients', async () => {
    entrypoint.configuration.mockReturnValue({ appOrigin: origin })
    entrypoint.authenticate.mockRejectedValue(Object.assign(new Error('Student cannot access billing'), { name: 'AuthorizationError' }))
    expect((await startRoute(request(), context)).status).toBe(403)
    expect(entrypoint.authenticate).toHaveBeenCalledWith('teacher'); expect(entrypoint.runtime).not.toHaveBeenCalled()
  })
  it('routes confirmation through the feature-owned validated body and trusted subject', async () => {
    entrypoint.configuration.mockReturnValue({ appOrigin: origin })
    entrypoint.authenticate.mockResolvedValue({ id: subjectUserId })
    const confirmUpgrade = vi.fn().mockResolvedValue({ ...pending, status: 'payment_pending' })
    entrypoint.runtime.mockReturnValue({ confirmUpgrade })
    const response = await confirmRoute(request({ operationId, quoteRevision: 7, quoteDigest }), context)
    expect(response.status).toBe(200)
    expect(confirmUpgrade).toHaveBeenCalledWith({ subjectUserId, operationId, quoteRevision: 7, quoteDigest })
  })
})
