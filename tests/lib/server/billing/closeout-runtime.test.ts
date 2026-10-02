import type Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import { createStripeCloseoutPort } from '@/lib/server/billing/closeout-runtime'

describe('closeout SDK transport', () => {
  it('expands raw payments and uses explicit keyed POSTs and non-invoicing DELETE', async () => {
    const sdk = {
      accounts: { retrieve: vi.fn() }, subscriptions: { retrieve: vi.fn(), cancel: vi.fn() },
      invoices: { retrieve: vi.fn(), list: vi.fn(), update: vi.fn(), voidInvoice: vi.fn() },
      paymentIntents: { retrieve: vi.fn() }, charges: { retrieve: vi.fn() },
    }
    const port = createStripeCloseoutPort(sdk as unknown as Stripe)
    await port.invoices.retrieve('in_target')
    await port.invoices.update('in_target', { auto_advance: false }, { idempotencyKey: 'operation:pause' })
    await port.invoices.voidInvoice('in_target', {}, { idempotencyKey: 'operation:void' })
    await port.subscriptions.cancel('sub_target', { invoice_now: false, prorate: false })
    expect(sdk.invoices.retrieve).toHaveBeenCalledWith('in_target', { expand: ['payments'] })
    expect(sdk.invoices.update).toHaveBeenCalledWith('in_target', { auto_advance: false }, { idempotencyKey: 'operation:pause' })
    expect(sdk.invoices.voidInvoice).toHaveBeenCalledWith('in_target', {}, { idempotencyKey: 'operation:void' })
    expect(sdk.subscriptions.cancel).toHaveBeenCalledWith('sub_target', { invoice_now: false, prorate: false })
  })
})
