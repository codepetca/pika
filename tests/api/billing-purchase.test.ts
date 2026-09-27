import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  config: vi.fn(), authenticate: vi.fn(), runtime: vi.fn(), listCatalog: vi.fn(),
  startCheckout: vi.fn(), getCheckout: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireRole: mock.authenticate }))
vi.mock('@/lib/server/billing/purchase-config', () => ({ readBillingPurchaseConfig: mock.config }))
vi.mock('@/lib/server/billing/purchase-runtime', () => ({ createBillingPurchaseRuntime: mock.runtime }))

import { GET as catalog } from '@/app/api/billing/catalog/route'
import { POST as checkout } from '@/app/api/billing/checkout/route'
import { GET as status } from '@/app/api/billing/checkout/[id]/route'

const subject = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const attemptId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const versionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const context = { params: Promise.resolve({ id: attemptId }) }
const origin = 'http://localhost:3000'
beforeEach(() => {
  vi.resetAllMocks()
  mock.config.mockReturnValue({ appOrigin: origin })
  mock.authenticate.mockResolvedValue({ id: subject })
  mock.runtime.mockReturnValue(mock)
  mock.listCatalog.mockResolvedValue([])
  mock.startCheckout.mockResolvedValue({ attemptId, status: 'pending', checkoutUrl: null })
  mock.getCheckout.mockResolvedValue(null)
})
describe('purchase API wiring', () => {
  it('does not expose any route or construct a runtime when billing is off', async () => {
    mock.config.mockReturnValue(null)
    for (const handler of [catalog, checkout, status]) {
      const response = await handler(new NextRequest(`${origin}/api/billing`), context)
      expect(response.status).toBe(404)
    }
    expect(mock.runtime).not.toHaveBeenCalled()
  })
  it('requires a teacher for the available catalog', async () => {
    mock.authenticate.mockRejectedValue(Object.assign(new Error('Denied'), { name: 'AuthorizationError' }))
    expect((await catalog(new NextRequest(`${origin}/api/billing/catalog`), context)).status).toBe(403)
    expect(mock.authenticate).toHaveBeenCalledWith('teacher')
    expect(mock.runtime).not.toHaveBeenCalled()
  })
  it('binds the purchase operation to the signed-in account', async () => {
    const response = await checkout(new NextRequest(`${origin}/api/billing/checkout`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ offeringVersionId: versionId, operationId: attemptId }),
    }), context)
    expect(response.status).toBe(200)
    expect(mock.authenticate).toHaveBeenCalledWith('teacher')
    expect(mock.startCheckout).toHaveBeenCalledWith({ subjectUserId: subject, offeringVersionId: versionId, operationId: attemptId })
  })
  it('returns404 for another account’s purchase instead of leaking status', async () => {
    const response = await status(new NextRequest(`${origin}/api/billing/checkout/${attemptId}`), context)
    expect(response.status).toBe(404)
    expect(mock.getCheckout).toHaveBeenCalledWith({ subjectUserId: subject, attemptId })
  })
})
