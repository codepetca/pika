import type Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import { attachStripeExclusiveTax } from '../../../helpers/stripe-exclusive-tax-fixture'
import { verifyLiveStripeFullRefund } from '@/lib/server/billing/stripe-refund-provider'

function fixture() {
  const collection = (data: unknown[] = []) => ({ object: 'list', has_more: false, data })
  const sub = { id: 'sub_1', customer: 'cus_1', livemode: true, status: 'canceled', latest_invoice: 'in_1', items: { data: [{ price: {} }] } }
  const line = { amount: 2000, quantity: 1, discounts: [], discount_amounts: [], taxes: [],
    parent: { subscription_item_details: { subscription: 'sub_1', proration: false } },
    pricing: { price_details: { price: 'price_1' } }, period: { start: 1700000000, end: 1702592000 } }
  const invoice = { id: 'in_1', customer: 'cus_1', livemode: true, status: 'paid', currency: 'cad',
    parent: { subscription_details: { subscription: 'sub_1' } }, subtotal: 2000, total: 2000, amount_due: 2000,
    amount_paid: 2000, amount_remaining: 0, starting_balance: 0, ending_balance: 0,
    pre_payment_credit_notes_amount: 0, post_payment_credit_notes_amount: 0, discounts: [], total_discount_amounts: [],
    automatic_tax: { enabled: false }, total_taxes: [], lines: collection([line]) }
  const payment = { livemode: true, invoice: 'in_1', status: 'paid', amount_paid: 2000, currency: 'cad', payment: { type: 'payment_intent', payment_intent: 'pi_1' } }
  const intent = { id: 'pi_1', livemode: true, customer: 'cus_1', status: 'succeeded', currency: 'cad', amount_received: 2000, latest_charge: 'ch_1' }
  const charge = { id: 'ch_1', livemode: true, customer: 'cus_1', payment_intent: 'pi_1', currency: 'cad', status: 'succeeded', paid: true,
    captured: true, refunded: true, disputed: false, amount: 2000, amount_captured: 2000, amount_refunded: 2000, payment_method_details: { type: 'card' } }
  const refund = { id: 're_1', charge: 'ch_1', currency: 'cad', amount: 2000, status: 'succeeded' }
  const sdk = { accounts: { retrieve: vi.fn().mockResolvedValue({ id: 'acct_1' }) }, subscriptions: { retrieve: vi.fn().mockResolvedValue(sub) },
    invoices: { list: vi.fn().mockResolvedValue(collection()), retrieve: vi.fn().mockResolvedValue(invoice) },
    invoicePayments: { list: vi.fn().mockResolvedValue(collection([payment])) }, paymentIntents: { retrieve: vi.fn().mockResolvedValue(intent) },
    charges: { retrieve: vi.fn().mockResolvedValue(charge) }, disputes: { list: vi.fn().mockResolvedValue(collection()) },
    refunds: { list: vi.fn().mockResolvedValue(collection([refund])) } }
  const input = { stripeAccount: 'acct_1', stripeSubscriptionId: 'sub_1', stripeInvoiceId: 'in_1' }
  return { sub, invoice, line, payment, intent, charge, refund, sdk, input, collection,
    verify: () => verifyLiveStripeFullRefund(sdk as unknown as Stripe, input) }
}

describe('live full refund evidence', () => {
  it('returns exact IDs, amount, and paid period after complete evidence', async () => {
    const f = fixture()
    expect(await f.verify()).toEqual({ stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', invoice_id: 'in_1', charge_id: 'ch_1',
      refund_ids: ['re_1'], currency: 'cad', gross_amount: 2000, base_amount: 2000, price_id: 'price_1',
      paid_period_start: '2023-11-14T22:13:20.000Z', paid_through: '2023-12-14T22:13:20.000Z' })
    expect(f.sdk.refunds.list).toHaveBeenCalledWith({ charge: 'ch_1', limit: 100 })
  })
  it('accepts multiple succeeded refunds only when they total the full charge', async () => {
    const f = fixture()
    f.refund.amount = 800
    f.sdk.refunds.list.mockResolvedValue(f.collection([f.refund, { ...f.refund, id: 're_2', amount: 1200 }]))
    expect(await f.verify()).toMatchObject({ refund_ids: ['re_1', 're_2'], gross_amount: 2000 })
  })
  it('keeps only the confirmed refunds after a failed refund attempt', async () => {
    const f = fixture()
    f.sdk.refunds.list.mockResolvedValue(f.collection([f.refund, { ...f.refund, id: 're_failed', status: 'failed' }]))
    expect(await f.verify()).toMatchObject({ refund_ids: ['re_1'], gross_amount: 2000 })
  })
  it('accepts verified exclusive tax and a full post-payment credit note', async () => {
    const f = fixture(); attachStripeExclusiveTax(f.sub, f.invoice)
    Object.assign(f.invoice, { amount_paid: 2260, post_payment_credit_notes_amount: 2260 })
    Object.assign(f.payment, { amount_paid: 2260 }); Object.assign(f.intent, { amount_received: 2260 })
    Object.assign(f.charge, { amount: 2260, amount_captured: 2260, amount_refunded: 2260 }); f.refund.amount = 2260
    expect(await f.verify()).toMatchObject({ base_amount: 2000, gross_amount: 2260 })
  })
  it.each([
    ['wrong account', (f: ReturnType<typeof fixture>) => f.sdk.accounts.retrieve.mockResolvedValue({ id: 'acct_other' })],
    ['test-mode subscription', f => { f.sub.livemode = false }],
    ['active subscription', f => { f.sub.status = 'active' }],
    ['different latest invoice', f => { f.sub.latest_invoice = 'in_other' }],
    ['unpaid obligation', f => f.sdk.invoices.list.mockResolvedValue(f.collection([{}]))],
    ['partial invoice lines', f => { f.invoice.lines.has_more = true }],
    ['proration', f => { f.line.parent.subscription_item_details.proration = true }],
    ['pre-payment credit', f => { f.invoice.pre_payment_credit_notes_amount = 1 }],
    ['discount', f => { f.invoice.discounts = ['di_1'] as never[] }],
    ['partial payment enumeration', f => f.sdk.invoicePayments.list.mockResolvedValue({ ...f.collection([f.payment]), has_more: true })],
    ['test-mode payment', f => { f.payment.livemode = false }],
    ['test-mode intent', f => { f.intent.livemode = false }],
    ['test-mode charge', f => { f.charge.livemode = false }],
    ['partial refund', f => { f.charge.amount_refunded = 1000 }],
    ['pending refund', f => { f.refund.status = 'pending' }],
    ['incomplete refund enumeration', f => f.sdk.refunds.list.mockResolvedValue({ ...f.collection([f.refund]), has_more: true })],
    ['wrong refund charge', f => { f.refund.charge = 'ch_other' }],
    ['prior dispute', f => f.sdk.disputes.list.mockResolvedValue(f.collection([{}]))],
    ['provider failure', f => f.sdk.refunds.list.mockRejectedValue(new Error('unavailable'))],
  ])('fails closed for %s', async (_name, mutate) => {
    const f = fixture(); mutate(f); expect(await f.verify()).toBeNull()
  })
})
