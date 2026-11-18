import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLoadBillingRuntime, mockLifecycleRuntime, applyDue, mockCloseoutRuntime, closeDueRenewals } = vi.hoisted(() => ({
  mockLoadBillingRuntime: vi.fn(),
  mockLifecycleRuntime: vi.fn(),
  applyDue: vi.fn(),
  mockCloseoutRuntime: vi.fn(), closeDueRenewals: vi.fn(),
}))

vi.mock('@/lib/server/billing/runtime', () => ({
  createBillingRuntime: mockLoadBillingRuntime,
}))
vi.mock('@/lib/server/billing/lifecycle-runtime', () => ({ createBillingLifecycleRuntime: mockLifecycleRuntime }))
vi.mock('@/lib/server/billing/closeout-runtime', () => ({ createBillingCloseoutRuntime: mockCloseoutRuntime }))

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
    applyDue.mockResolvedValue({ processed: 0 })
    mockLifecycleRuntime.mockReturnValue({ applyDue })
    closeDueRenewals.mockResolvedValue({ processed: 0 })
    mockCloseoutRuntime.mockReturnValue({ closeDueRenewals })
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
    expect(mockLifecycleRuntime).not.toHaveBeenCalled()
    expect(mockCloseoutRuntime).not.toHaveBeenCalled()
  })

  it('keeps provider routes off during the live target check', async () => {
    vi.stubEnv('BILLING_SANDBOX_ENABLED', 'false')
    vi.stubEnv('BILLING_LIVE_TARGET_CHECK_ENABLED', 'true')
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://pika.codepet.ca')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://zhioqbapgfcrronyuidm.supabase.co')
    vi.stubEnv('STRIPE_LIVE_ACCOUNT_ID', 'acct_Preflight311')

    const webhook = new NextRequest('https://pika.codepet.ca/api/billing/stripe/webhook', { method: 'POST' })
    const worker = new NextRequest('https://pika.codepet.ca/api/billing/stripe/process', { method: 'POST' })
    expect((await receiveWebhook(webhook, context)).status).toBe(404)
    expect((await processBilling(worker, context)).status).toBe(404)
    expect(mockLoadBillingRuntime).not.toHaveBeenCalled()
  })

  it('checks the dedicated worker credential before constructing the billing runtime', async () => {
    enableBilling()

    const response = await processBilling(new Request('http://localhost/api/billing/stripe/process', {
      method: 'POST', headers: { authorization: 'Bearer wrong' },
    }) as any, context)

    expect(response.status).toBe(401)
    expect(mockLoadBillingRuntime).not.toHaveBeenCalled()
    expect(mockLifecycleRuntime).not.toHaveBeenCalled()
    expect(mockCloseoutRuntime).not.toHaveBeenCalled()
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
    expect(applyDue).toHaveBeenCalledWith({ limit: 25 })
    expect(closeDueRenewals).toHaveBeenCalledWith({ limit: 1 })
  })
})
