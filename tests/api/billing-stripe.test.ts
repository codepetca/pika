import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLoadBillingRuntime } = vi.hoisted(() => ({
  mockLoadBillingRuntime: vi.fn(),
}))

vi.mock('@/lib/server/billing/runtime', () => ({
  createBillingRuntime: mockLoadBillingRuntime,
}))

import { POST as processBilling } from '@/app/api/billing/stripe/process/route'
import { POST as receiveWebhook } from '@/app/api/billing/stripe/webhook/route'

const context = { params: Promise.resolve({}) }
const workerSecret = 'a-worker-secret-containing-at-least-32-characters'

function enableBilling() {
  vi.stubEnv('BILLING_SANDBOX_ENABLED', 'true')
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_billing_route_fixture')
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_billing_route_fixture')
  vi.stubEnv('STRIPE_ACCOUNT_ID', 'acct_fixture')
  vi.stubEnv('BILLING_WORKER_SECRET', workerSecret)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
}

describe('Stripe billing routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('keeps both routes inaccessible while the local sandbox is disabled', async () => {
    const webhookResponse = await receiveWebhook(new Request('http://localhost/api/billing/stripe/webhook', {
      method: 'POST',
    }) as any, context)
    const processResponse = await processBilling(new Request('http://localhost/api/billing/stripe/process', {
      method: 'POST',
    }) as any, context)

    expect(webhookResponse.status).toBe(404)
    expect(processResponse.status).toBe(404)
    expect(mockLoadBillingRuntime).not.toHaveBeenCalled()
  })

  it('checks the dedicated worker credential before constructing the billing runtime', async () => {
    enableBilling()

    const response = await processBilling(new Request('http://localhost/api/billing/stripe/process', {
      method: 'POST', headers: { authorization: 'Bearer wrong' },
    }) as any, context)

    expect(response.status).toBe(401)
    expect(mockLoadBillingRuntime).not.toHaveBeenCalled()
  })

  it('runs at most one claimed subscription with a 120-second lease', async () => {
    enableBilling()
    const listWork = vi.fn().mockResolvedValue({ items: [] })
    mockLoadBillingRuntime.mockReturnValue({
      store: { listWork, claimSubscription: vi.fn(), finishSubscription: vi.fn() },
      provider: { retrieveSubscription: vi.fn() },
      verify: vi.fn(),
      record: vi.fn(),
    })

    const response = await processBilling(new Request('http://localhost/api/billing/stripe/process?limit=1000', {
      method: 'POST', headers: { authorization: `Bearer ${workerSecret}` },
    }) as any, context)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ requested: 1, processed: 0 })
    expect(listWork).toHaveBeenCalledWith({ limit: 1 })
    expect(mockLoadBillingRuntime).toHaveBeenCalledOnce()
  })
})
