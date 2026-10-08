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
    const lifecycle = vi.fn()
    const closeouts = vi.fn()
    const handlers = createBillingHandlers(() => ({ stripeAccount: 'acct_fixture', workerSecret: secret }), load, purchases, lifecycle, closeouts)
    const response = await handlers.process(new NextRequest('http://localhost/process', {
      method: 'POST', headers: { Authorization: 'Bearer wrong' },
    }), context)
    expect(response.status).toBe(401)
    expect(load).not.toHaveBeenCalled()
    expect(purchases).not.toHaveBeenCalled()
    expect(lifecycle).not.toHaveBeenCalled()
    expect(closeouts).not.toHaveBeenCalled()
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
  it('applies due local trial and access transitions even when there is no Stripe work', async () => {
    const listWork = vi.fn().mockResolvedValue({ items: [] })
    const applyDue = vi.fn().mockResolvedValue({ processed: 1 })
    const handlers = createBillingHandlers(
      () => ({ stripeAccount: 'acct_fixture', workerSecret: secret }),
      vi.fn().mockResolvedValue({ store: { listWork } }),
      undefined,
      vi.fn().mockResolvedValue({ applyDue }),
    )
    const response = await handlers.process(new NextRequest('http://localhost/process?limit=99999', {
      method: 'POST', headers: { Authorization: `Bearer ${secret}` },
    }), context)
    expect(response.status).toBe(200)
    expect(applyDue).toHaveBeenCalledWith({ limit: 25 })
    expect(await response.json()).toMatchObject({ lifecycle: { processed: 1 } })
  })
  it('closes at most one due renewal after local expiry without trusting request limits', async () => {
    const order: string[] = []
    const applyDue = vi.fn().mockImplementation(async () => { order.push('expiry'); return { processed: 1 } })
    const closeDueRenewals = vi.fn().mockImplementation(async () => { order.push('closeout'); return { processed: 1, closed: 1 } })
    const handlers = createBillingHandlers(
      () => ({ stripeAccount: 'acct_fixture', workerSecret: secret }),
      vi.fn().mockResolvedValue({ store: { listWork: vi.fn().mockResolvedValue({ items: [] }) } }),
      undefined, vi.fn().mockResolvedValue({ applyDue }), vi.fn().mockResolvedValue({ closeDueRenewals }),
    )
    const response = await handlers.process(new NextRequest('http://localhost/process?limit=99999', {
      method: 'POST', headers: { Authorization: `Bearer ${secret}` },
    }), context)
    expect(response.status).toBe(200)
    expect(order).toEqual(['expiry', 'closeout'])
    expect(closeDueRenewals).toHaveBeenCalledWith({ limit: 1 })
    expect(await response.json()).toMatchObject({ closeouts: { processed: 1, closed: 1 } })
  })
})
