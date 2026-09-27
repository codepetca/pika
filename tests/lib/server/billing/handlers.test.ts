import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import { createBillingHandlers } from '@/lib/server/billing/handlers'

const context = { params: Promise.resolve({}) }
const secret = 'a-worker-secret-containing-at-least-32-characters'

describe('billing handler boundaries', () => {
  it('keeps disabled billing inaccessible', async () => {
    const load = vi.fn()
    const handlers = createBillingHandlers(() => null, load)
    const response = await handlers.webhook(new NextRequest('http://localhost/hook', { method: 'POST' }), context)
    expect(response.status).toBe(404)
    expect(load).not.toHaveBeenCalled()
  })
  it('authenticates the worker before loading Stripe or the database', async () => {
    const load = vi.fn()
    const purchases = vi.fn()
    const handlers = createBillingHandlers(() => ({ stripeAccount: 'acct_fixture', workerSecret: secret }), load, purchases)
    const response = await handlers.process(new NextRequest('http://localhost/process', {
      method: 'POST', headers: { Authorization: 'Bearer wrong' },
    }), context)
    expect(response.status).toBe(401)
    expect(load).not.toHaveBeenCalled()
    expect(purchases).not.toHaveBeenCalled()
  })
  it('bounds each authorized worker request to one subscription', async () => {
    const listWork = vi.fn().mockResolvedValue({ items: [] })
    const load = vi.fn().mockResolvedValue({
      store: { listWork, claimSubscription: vi.fn(), finishSubscription: vi.fn() },
      provider: { retrieveSubscription: vi.fn() }, verify: vi.fn(), record: vi.fn(),
    })
    const handlers = createBillingHandlers(() => ({ stripeAccount: 'acct_fixture', workerSecret: secret }), load)
    const response = await handlers.process(new NextRequest('http://localhost/process?limit=99999', {
      method: 'POST', headers: { Authorization: `Bearer ${secret}` },
    }), context)
    expect(response.status).toBe(200)
    expect(listWork).toHaveBeenCalledWith({ limit: 1 })
  })
  it('recovers at most one checkout without trusting a requested worker limit', async () => {
    const listWork = vi.fn().mockResolvedValue({ items: [] })
    const reconcileCheckouts = vi.fn().mockResolvedValue({ processed: 1, failed: 0 })
    const handlers = createBillingHandlers(
      () => ({ stripeAccount: 'acct_fixture', workerSecret: secret }),
      vi.fn().mockResolvedValue({ store: { listWork } }),
      vi.fn().mockResolvedValue({ reconcileCheckouts }),
    )
    const response = await handlers.process(new NextRequest('http://localhost/process?limit=99999', {
      method: 'POST', headers: { Authorization: `Bearer ${secret}` },
    }), context)
    expect(response.status).toBe(200)
    expect(reconcileCheckouts).toHaveBeenCalledWith({ limit: 1 })
    expect(await response.json()).toMatchObject({ purchases: { processed: 1, failed: 0 } })
  })
})
