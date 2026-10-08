import { describe, expect, it, vi } from 'vitest'
import { closeFailedRenewal, closeDueRenewals } from '@/lib/server/billing/closeout-service'
import type { RenewalCloseoutClaim, RenewalCloseoutEvidence, RenewalCloseoutProvider, RenewalCloseoutStore } from '@/lib/server/billing/closeout-contracts'

const claim: RenewalCloseoutClaim = {
  status: 'claimed', operation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  subscription_id: '11111111-1111-4111-8111-111111111111', lease_token: '55555555-5555-4555-8555-555555555555',
  fencing_token: 1, subscription_revision: 10, expected_account_plan_revision: 7, operation_revision: 1,
  lease_expires_at: '2026-10-08T00:02:00.000Z', stage: 'queued', invoice_id: 'in_failed',
  paid_through: '2026-10-01T00:00:00.000Z', cutoff: '2026-10-08T00:00:00.000Z',
  binding: { subscription_id: '11111111-1111-4111-8111-111111111111', subject_user_id: '22222222-2222-4222-8222-222222222222',
    stripe_account: 'acct_fixture', stripe_customer_id: 'cus_fixture', stripe_subscription_id: 'sub_fixture',
    offering_id: '33333333-3333-4333-8333-333333333333', offering_version_id: '44444444-4444-4444-8444-444444444444',
    stripe_product_id: 'prod_fixture', stripe_price_id: 'price_fixture', unit_amount: 1900, plan_key: 'plus',
    currency: 'usd', interval: 'month', provider_mode: 'test' },
}
const unpaid: RenewalCloseoutEvidence = { kind: 'unpaid', invoiceId: 'in_failed', invoiceStatus: 'open', collectionPaused: false }
const paused: RenewalCloseoutEvidence = { ...unpaid, collectionPaused: true }
const voided: RenewalCloseoutEvidence = { kind: 'invoice_voided', invoiceId: 'in_failed', subscriptionCanceled: false, obligationsCleared: true }
const closed: RenewalCloseoutEvidence = { ...voided, subscriptionCanceled: true }
const paid: RenewalCloseoutEvidence = { kind: 'paid', invoiceId: 'in_failed', periodStart: claim.paid_through,
  periodEnd: '2026-11-01T00:00:00.000Z', providerStatus: 'active', cancelAtPeriodEnd: false, terminalObligationsCleared: false }
function setup(evidence: RenewalCloseoutEvidence[] = [unpaid, paused, voided, closed]) {
  const events: string[] = []
  let revision = claim.operation_revision
  const store: RenewalCloseoutStore = {
    listDue: vi.fn().mockResolvedValue({ items: [{ subscription_id: claim.subscription_id }] }),
    claim: vi.fn().mockResolvedValue(claim),
    checkpoint: vi.fn().mockImplementation(async input => {
      events.push(input.stage); return { ...claim, stage: input.stage, operation_revision: ++revision }
    }),
    finish: vi.fn().mockImplementation(async input => { events.push(input.outcome); return { status: input.outcome } }),
  }
  const provider: RenewalCloseoutProvider = {
    readCloseoutEvidence: vi.fn().mockImplementation(async () => { events.push('read'); return evidence.shift() }),
    pauseInvoiceCollection: vi.fn().mockImplementation(async input => { if (await input.beforeMutation()) events.push('pause') }),
    voidInvoice: vi.fn().mockImplementation(async input => { if (await input.beforeMutation()) events.push('void') }),
    cancelSubscription: vi.fn().mockImplementation(async input => { if (await input.beforeMutation()) events.push('cancel') }),
  }
  return { store, provider, events }
}
const execute = (f: ReturnType<typeof setup>) => closeFailedRenewal({ ...f, subscriptionId: claim.subscription_id, leaseSeconds: 120 })

describe('failed renewal closeout orchestration', () => {
  it('checkpoints every mutation, refreshes fences and verifies terminal state', async () => {
    const f = setup(); await expect(execute(f)).resolves.toEqual({ status: 'closed' })
    expect(f.events).toEqual(['read', 'pause_requested', 'pause_requested', 'pause', 'read', 'collection_paused', 'void_requested', 'void_requested', 'void', 'read', 'invoice_voided', 'cancel_requested', 'cancel_requested', 'cancel', 'read', 'closed'])
    expect(f.store.checkpoint).toHaveBeenNthCalledWith(2, expect.objectContaining({ operation_revision: 2 }))
    expect(f.store.finish).toHaveBeenCalledWith(expect.objectContaining({ operation_revision: 9, evidence: closed }))
    expect(f.provider.pauseInvoiceCollection).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: `${claim.operation_id}:pause` }))
    expect(f.provider.voidInvoice).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: `${claim.operation_id}:void` }))
    expect(f.provider.cancelSubscription).toHaveBeenCalledWith(expect.not.objectContaining({ idempotencyKey: expect.anything() }))
  })
  it.each([0, 1, 2])('restores a paid renewal winning at read %s without further writes', async position => {
    const f = setup([unpaid, paused, paid].slice(0, position).concat(paid));
    await expect(execute(f)).resolves.toEqual({ status: 'payment_won' })
    expect(f.provider.cancelSubscription).not.toHaveBeenCalled()
    if (position < 2) expect(f.provider.voidInvoice).not.toHaveBeenCalled()
    if (position === 0) expect(f.provider.pauseInvoiceCollection).not.toHaveBeenCalled()
    expect(f.store.finish).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'payment_won', evidence: paid }))
  })
  it.each(['busy', 'not_found', 'plan_conflict', 'superseded'])('does not read Stripe for %s claim', async status => {
    const f = setup(); vi.mocked(f.store.claim).mockResolvedValue({ status })
    await expect(execute(f)).resolves.toEqual({ status })
    expect(f.provider.readCloseoutEvidence).not.toHaveBeenCalled()
  })
  it.each(['lost_claim', 'plan_conflict', 'superseded'])('stops before provider mutation on %s checkpoint', async status => {
    const f = setup(); vi.mocked(f.store.checkpoint).mockResolvedValue({ status })
    await expect(execute(f)).resolves.toEqual({ status }); expect(f.events).toEqual(['read'])
  })
  it('rejects a checkpoint with swapped immutable facts before a write', async () => {
    const f = setup(); vi.mocked(f.store.checkpoint).mockResolvedValue({ ...claim, stage: 'pause_requested', invoice_id: 'in_other', operation_revision: 2 })
    await expect(execute(f)).rejects.toThrow('Billing closeout checkpoint is unavailable')
    expect(f.provider.pauseInvoiceCollection).not.toHaveBeenCalled()
  })
  it('stops when the lease is lost during the adapter fresh read', async () => {
    const f = setup(); vi.mocked(f.store.checkpoint)
      .mockResolvedValueOnce({ ...claim, stage: 'pause_requested', operation_revision: 2 })
      .mockResolvedValueOnce({ status: 'lost_claim' })
    await expect(execute(f)).resolves.toEqual({ status: 'lost_claim' })
    expect(f.events).toEqual(['read']); expect(f.store.finish).not.toHaveBeenCalled()
  })
  it('rejects an unchanged checkpoint revision', async () => {
    const f = setup(); vi.mocked(f.store.checkpoint).mockResolvedValue({ ...claim, stage: 'pause_requested' })
    await expect(execute(f)).rejects.toThrow('Billing closeout checkpoint is unavailable')
    expect(f.provider.pauseInvoiceCollection).not.toHaveBeenCalled()
  })
  it.each(['pauseInvoiceCollection', 'voidInvoice', 'cancelSubscription'] as const)('preserves durable intent after %s timeout', async method => {
    const f = setup(); vi.mocked(f.provider[method]).mockRejectedValue(new Error('secret provider error'))
    await expect(execute(f)).resolves.toEqual({ status: 'deferred' })
    expect(f.store.finish).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'deferred', reason: 'provider_unavailable' }))
    expect(JSON.stringify(vi.mocked(f.store.finish).mock.calls)).not.toContain('secret provider error')
  })
  it.each(['void_requested', 'cancel_requested'] as const)('rereads provider on recovery from %s', async stage => {
    const f = setup([closed]); vi.mocked(f.store.claim).mockResolvedValue({ ...claim, stage })
    await expect(execute(f)).resolves.toEqual({ status: 'closed' }); expect(f.events).toEqual(['read', 'closed'])
  })
  it.each([
    ['void_requested', [paused, voided, closed]],
    ['cancel_requested', [voided, closed]],
  ] as const)('recovers unfinished %s without moving durable intent backwards', async (stage, states) => {
    const f = setup([...states]); vi.mocked(f.store.claim).mockResolvedValue({ ...claim, stage })
    vi.mocked(f.store.checkpoint).mockImplementation(async input => {
      const order = ['queued', 'pause_requested', 'collection_paused', 'void_requested', 'invoice_voided', 'cancel_requested']
      if (order.indexOf(input.stage) < order.indexOf(stage)) throw new Error('backwards stage')
      return { ...claim, stage: input.stage, operation_revision: input.operation_revision + 1 }
    })
    await expect(execute(f)).resolves.toEqual({ status: 'closed' })
  })
  it('holds provider state that regressed after a persisted void intent', async () => {
    const f = setup([unpaid]); vi.mocked(f.store.claim).mockResolvedValue({ ...claim, stage: 'void_requested' })
    await expect(execute(f)).resolves.toEqual({ status: 'attention' })
    expect(f.provider.pauseInvoiceCollection).not.toHaveBeenCalled(); expect(f.store.checkpoint).not.toHaveBeenCalled()
  })
  it('defers pending payment with no irreversible action', async () => {
    const f = setup([{ kind: 'payment_pending', invoiceId: claim.invoice_id }]);
    await expect(execute(f)).resolves.toEqual({ status: 'deferred' }); expect(f.events).toEqual(['read', 'deferred'])
  })
  it('reports database escalation after exhausting the retry budget', async () => {
    const f = setup([{ kind: 'payment_pending', invoiceId: claim.invoice_id }])
    vi.mocked(f.store.finish).mockResolvedValue({ status: 'attention' })
    await expect(execute(f)).resolves.toEqual({ status: 'attention' })
  })
  it('holds incomplete obligations without canceling or retiring the binding', async () => {
    const f = setup([{ ...voided, obligationsCleared: false }]);
    await expect(execute(f)).resolves.toEqual({ status: 'attention' }); expect(f.events).toEqual(['read', 'attention'])
  })
  it('does not repeat an ineffective mutation in the same invocation', async () => {
    const f = setup([unpaid, unpaid]); await expect(execute(f)).resolves.toEqual({ status: 'deferred' })
    expect(f.provider.pauseInvoiceCollection).toHaveBeenCalledOnce(); expect(f.provider.voidInvoice).not.toHaveBeenCalled()
  })
  it.each([{ ...paid, invoiceId: 'in_other' }, { ...paid, periodStart: '2026-09-01T00:00:00.000Z' }, { ...paid, periodEnd: claim.paid_through }, { kind: 'unknown' }])('holds invalid or unrelated evidence', async evidence => {
    const f = setup(); vi.mocked(f.provider.readCloseoutEvidence).mockResolvedValue(evidence)
    await expect(execute(f)).resolves.toEqual({ status: 'attention' }); expect(f.events).toEqual(['attention'])
  })
  it('rejects identity-swapped claims before Stripe', async () => {
    const f = setup(); vi.mocked(f.store.claim).mockResolvedValue({ ...claim, subscription_id: '99999999-9999-4999-8999-999999999999' })
    await expect(execute(f)).rejects.toThrow('Billing closeout claim is unavailable')
    expect(f.provider.readCloseoutEvidence).not.toHaveBeenCalled()
  })
  it('contains per-item database failures in the bounded worker response', async () => {
    const f = setup(); vi.mocked(f.store.claim).mockRejectedValue(new Error('database unavailable'))
    await expect(closeDueRenewals({ ...f, limit: 1, leaseSeconds: 120 })).resolves.toEqual({ requested: 1, processed: 1, closed: 0, paymentWon: 0, deferred: 0, attention: 0, exceptions: 1 })
  })
  it.each([0, 2, 1.5])('rejects invalid worker limit %s before listing', async limit => {
    const f = setup(); await expect(closeDueRenewals({ ...f, limit, leaseSeconds: 120 })).rejects.toThrow()
    expect(f.store.listDue).not.toHaveBeenCalled()
  })
})
