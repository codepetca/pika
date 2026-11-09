import { describe, expect, it, vi } from 'vitest'
import { processScheduledCancellation, type CancellationStore, cancellationClaimSchema } from '@/lib/server/billing/scheduled-cancellation-service'
import type { createLiveScheduledCancellationProvider } from '@/lib/server/billing/stripe-plan-change-provider'
const id = '11111111-1111-4111-8111-111111111111'
const sid = '22222222-2222-4222-8222-222222222222'
const schedule = '33333333-3333-4333-8333-333333333333'
const subject = '44444444-4444-4444-8444-444444444444'
const effective = '2027-01-01T00:00:00Z'
const binding = { subscription_id: sid, subject_user_id: subject, offering_id: subject, offering_version_id: subject,
  stripe_account: 'acct_live', stripe_customer_id: 'cus_live', stripe_subscription_id: 'sub_live', stripe_price_id: 'price_max',
  stripe_product_id: 'prod_max', unit_amount: 3000, plan_key: 'pro', currency: 'usd', interval: 'month', provider_mode: 'live' }
const claim = cancellationClaimSchema.parse({ fence: { operationId: id, subscriptionId: sid, leaseToken: subject,
  fencingToken: 1, subscriptionRevision: 1, operationRevision: 1 }, cancellationOperationId: id, action: 'cancel', readOnly: false,
  replayUntil: '2026-12-31T00:00:00Z', binding, operation: { operationId: schedule, stripeAccount: 'acct_live',
    stripeCustomerId: 'cus_live', stripeSubscriptionId: 'sub_live', scheduleId: 'sub_sched_live', providerMode: 'live',
    lastPaidInvoiceId: 'in_paid', paidPeriodStart: '2026-12-01T00:00:00Z', effectiveAt: effective,
    source: { priceId: 'price_max', productId: 'prod_max', unitAmount: 3000, currency: 'usd', interval: 'month' },
    target: { priceId: 'price_pro', productId: 'prod_pro', unitAmount: 1000, currency: 'usd', interval: 'month' } } })
const snapshot = { stripeAccount: 'acct_live', liveMode: true, isCurrent: true, status: 'canceled', subscriptionId: 'sub_live',
  customerId: 'cus_live', scheduleId: 'sub_sched_live', pendingUpdate: false, pauseCollection: false, cancelAt: null,
  cancelAtPeriodEnd: false, terminalObligationsCleared: true, items: [{ priceId: 'price_max', productId: 'prod_max',
    unitAmount: 3000, currency: 'usd', interval: 'month', intervalCount: 1, quantity: 1, priceLiveMode: true,
    currentPeriodStart: '2026-12-01T00:00:00Z', currentPeriodEnd: effective }], latestInvoice: null }
const paidInvoice = { id: 'in_paid', status: 'paid', billingReason: 'subscription_cycle',
  subtotal: 3000, total: 3000, startingBalance: 0, endingBalance: 0, totalDiscountAmount: 0, totalTaxAmount: 0,
  hasDiscounts: false, hasTaxes: false, prePaymentCreditNotesAmount: 0, postPaymentCreditNotesAmount: 0,
  amountDue: 3000, amountPaid: 3000, currency: 'usd', customerId: 'cus_live', subscriptionId: 'sub_live',
  linesFullyEnumerated: true, lines: [], paymentsFullyEnumerated: true, payments: [] }
function fixture() {
  const store = { claim: vi.fn<CancellationStore['claim']>().mockResolvedValue(claim),
    authorize: vi.fn<CancellationStore['authorize']>().mockResolvedValue(claim), finish: vi.fn<CancellationStore['finish']>().mockResolvedValue(true) }
  const provider = { read: vi.fn().mockResolvedValue({ kind: 'scheduled' }), cancel: vi.fn().mockResolvedValue({ kind: 'cancel_scheduled' }),
    undo: vi.fn().mockResolvedValue({ kind: 'scheduled' }) } as unknown as ReturnType<typeof createLiveScheduledCancellationProvider>
  const retrieveSubscription = vi.fn().mockResolvedValue(snapshot)
  return { store, provider, retrieveSubscription, run: () => processScheduledCancellation({ id, stripeAccount: 'acct_live', store, provider, retrieveSubscription }) }
}
describe('live scheduled cancellation worker', () => {
  it('passes exact operation identity and finishes successful cancellation', async () => {
    const f = fixture(); expect(await f.run()).toBe('canceled')
    expect(f.provider.cancel).toHaveBeenCalledWith(expect.objectContaining({ cancellationOperationId: id, operation: claim.operation }))
    expect(f.store.finish).toHaveBeenCalledWith(claim.fence, 'canceled', undefined)
  })
  it('does not retire completed cancellations without independent valid financial evidence', async () => {
    const f = fixture(); vi.mocked(f.provider.read).mockResolvedValue({ kind: 'completed' })
    expect(await f.run()).toBe('retry')
    expect(f.store.finish).toHaveBeenCalledWith(claim.fence, 'retry', undefined)
  })
  it('retires only after current terminal subscription and cleared obligations', async () => {
    const f = fixture(); vi.mocked(f.provider.read).mockResolvedValue({ kind: 'completed' })
    f.retrieveSubscription.mockResolvedValue({ ...snapshot, latestInvoice: paidInvoice })
    expect(await f.run()).toBe('completed')
    expect(f.store.finish).toHaveBeenCalledWith(claim.fence, 'completed', { ended_at: effective, obligations_cleared: true })
    f.retrieveSubscription.mockResolvedValue({ ...snapshot, terminalObligationsCleared: false })
    expect(await f.run()).toBe('retry')
  })
  it('requires consistent durable tax mode and fresh terminal Stripe Tax evidence', async () => {
    const f = fixture()
    const taxMode = 'stripe_exclusive' as const
    const taxedClaim = { ...claim, operation: { ...claim.operation, taxMode }, binding: { ...claim.binding, tax_mode: taxMode } }
    f.store.claim.mockResolvedValueOnce({ ...taxedClaim, binding: claim.binding })
    await expect(f.run()).rejects.toThrow('Invalid scheduled cancellation claim')
    expect(f.provider.read).not.toHaveBeenCalled()

    f.store.claim.mockResolvedValue(taxedClaim)
    vi.mocked(f.provider.read).mockResolvedValue({ kind: 'completed' })
    const taxedSnapshot = { ...snapshot, automaticTaxEnabled: true,
      items: [{ ...snapshot.items[0], priceTaxBehavior: 'exclusive' }],
      latestInvoice: { ...paidInvoice, hasTaxes: true, totalTaxAmount: 390, total: 3390, amountDue: 3390, amountPaid: 3390,
        exclusiveTax: { status: 'complete', subtotal: 3000 } } }
    f.retrieveSubscription.mockResolvedValueOnce({ ...taxedSnapshot, automaticTaxEnabled: undefined })
      .mockResolvedValueOnce({ ...taxedSnapshot, items: snapshot.items })
      .mockResolvedValueOnce({ ...taxedSnapshot, terminalObligationsCleared: false })
      .mockResolvedValueOnce({ ...taxedSnapshot, latestInvoice: { ...taxedSnapshot.latestInvoice, id: 'in_Other' } })
      .mockResolvedValue(taxedSnapshot)
    for (let i = 0; i < 4; i++) await expect(f.run()).resolves.toBe('retry')
    await expect(f.run()).resolves.toBe('completed')
    expect(f.store.finish).toHaveBeenLastCalledWith(claim.fence, 'completed', { ended_at: effective, obligations_cleared: true })
  })
  it.each([['undo', 'restored_after_cutoff'], ['cancel', 'unchanged_after_cutoff']] as const)(
    'hands off a verified target phase after cutoff for %s', async (action, outcome) => {
      const f = fixture(); f.store.claim.mockResolvedValue({ ...claim, action })
      vi.mocked(f.provider.read).mockResolvedValue({ kind: 'restored_after_cutoff' })
      expect(await f.run()).toBe(outcome)
      expect(f.store.finish).toHaveBeenCalledWith(claim.fence, outcome, { provider_schedule_id: 'sub_sched_live',
        period_start: effective, period_end: '2027-02-01T00:00:00.000Z' })
      expect(f.provider.cancel).not.toHaveBeenCalled(); expect(f.provider.undo).not.toHaveBeenCalled()
    })
  it('retries a straddling provider observation with the bounded attempt budget', async () => {
    const f = fixture(); vi.mocked(f.provider.read).mockResolvedValue({ kind: 'transition_pending' })
    expect(await f.run()).toBe('retry'); expect(f.store.authorize).not.toHaveBeenCalled()
  })
  it('uses a fresh authorization fence and defers only if the database accepts it', async () => {
    const f = fixture(); f.store.authorize.mockResolvedValue(null); f.store.finish.mockResolvedValue(false)
    vi.mocked(f.provider.cancel).mockImplementation(async input => ({ kind: await input.beforeMutation() ? 'cancel_scheduled' : 'stale' }))
    expect(await f.run()).toBe('lost_claim')
    expect(f.store.finish).toHaveBeenCalledWith(claim.fence, 'deferred', undefined)
  })
  it('rejects a changed checkpoint before the provider can write', async () => {
    const f = fixture()
    f.store.authorize.mockResolvedValue({ ...claim, operation: { ...claim.operation, lastPaidInvoiceId: 'in_other' } })
    vi.mocked(f.provider.cancel).mockImplementation(async input => { await input.beforeMutation(); throw new Error('write reached') })
    expect(await f.run()).toBe('retry')
    expect(f.store.finish).toHaveBeenCalledWith(claim.fence, 'retry', undefined)
  })
  it('rejects mismatched source identity before provider reads', async () => {
    const f = fixture(); f.store.claim.mockResolvedValue({ ...claim, binding: { ...claim.binding, stripe_account: 'acct_foreign' } })
    await expect(f.run()).rejects.toThrow('Invalid scheduled cancellation claim')
    expect(f.provider.read).not.toHaveBeenCalled()
  })
})


describe('read-only attention recovery', () => {
  it.each([
    ['cancel', 'cancel_scheduled', 'canceled'], ['undo', 'scheduled', 'restored'],
    ['cancel', 'scheduled', 'attention'], ['undo', 'cancel_scheduled', 'attention'],
    ['undo', 'transition_pending', 'retry'], ['undo', 'restored_after_cutoff', 'restored_after_cutoff'],
  ] as const)('observes %s/%s without authorizing or writing', async (action, kind, outcome) => {
    const f = fixture(); f.store.claim.mockResolvedValue({ ...claim, action, readOnly: true })
    vi.mocked(f.provider.read).mockResolvedValue({ kind })
    expect(await f.run()).toBe(outcome)
    expect(f.store.authorize).not.toHaveBeenCalled()
    expect(f.provider.cancel).not.toHaveBeenCalled(); expect(f.provider.undo).not.toHaveBeenCalled()
  })
  it('requires independent terminal subscription and cleared obligations before retirement', async () => {
    const f = fixture(); f.store.claim.mockResolvedValue({ ...claim, readOnly: true })
    vi.mocked(f.provider.read).mockResolvedValue({ kind: 'completed' })
    expect(await f.run()).toBe('retry'); expect(f.retrieveSubscription).toHaveBeenCalledOnce()
    expect(f.store.authorize).not.toHaveBeenCalled(); expect(f.provider.cancel).not.toHaveBeenCalled()
  })
  it('rejects a checkpoint that changes the read-only property', async () => {
    const f = fixture(); f.store.authorize.mockResolvedValue({ ...claim, readOnly: true })
    vi.mocked(f.provider.cancel).mockImplementation(async input => { await input.beforeMutation(); throw new Error('write reached') })
    expect(await f.run()).toBe('retry')
  })
})
