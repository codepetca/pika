import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UpgradeConfirmationError, UpgradeEligibilityError } from '@/lib/server/billing/upgrade-contracts'
import { upgradeQuoteDigest } from '@/lib/server/billing/upgrade-service'
import { createBillingUpgradeRuntime, createUpgradeApplication, readBillingUpgradeConfig } from '@/lib/server/billing/upgrade-runtime'

const mocks = vi.hoisted(() => ({ stripe: vi.fn(), client: vi.fn(), boundFetch: vi.fn(), store: vi.fn(),
  port: vi.fn(), provider: vi.fn(), process: vi.fn(), due: vi.fn(), purchaseConfig: vi.fn() }))
vi.mock('stripe', () => ({ default: mocks.stripe }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))
vi.mock('@/lib/server/supabase-target', () => ({ createTargetBoundFetch: mocks.boundFetch }))
vi.mock('@/lib/server/billing/upgrade-store', () => ({ createBillingUpgradeStore: mocks.store }))
vi.mock('@/lib/server/billing/stripe-upgrade-provider', () => ({ createStripeUpgradePort: mocks.port, createStripeUpgradeProvider: mocks.provider }))
vi.mock('@/lib/server/billing/purchase-config', () => ({ readBillingPurchaseConfig: mocks.purchaseConfig }))
vi.mock('@/lib/server/billing/upgrade-service', async importOriginal => ({
  ...await importOriginal<object>(), processUpgrade: mocks.process, processDueUpgrades: mocks.due,
}))
const subjectUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const operationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const subscriptionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const offeringVersionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const config = { secretKey: 'sk_test_fixture', webhookSecret: 'whsec_fixture', workerSecret: 'x'.repeat(40),
  stripeAccount: 'acct_fixture', supabaseOrigin: 'http://127.0.0.1:54321', appOrigin: 'http://localhost:3000' }
const binding = { subscription_id: subscriptionId, subject_user_id: subjectUserId,
  offering_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', offering_version_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  stripe_account: 'acct_fixture', stripe_customer_id: 'cus_private', stripe_subscription_id: 'sub_private',
  stripe_product_id: 'prod_source', stripe_price_id: 'price_source', unit_amount: 2000,
  plan_key: 'basic', currency: 'usd', interval: 'month', provider_mode: 'test' } as const
const target = { offering_version_id: offeringVersionId, plan_key: 'plus', stripe_account: 'acct_fixture',
  stripe_product_id: 'prod_target', stripe_price_id: 'price_target', currency: 'usd', interval: 'month',
  unit_amount: 4000, classroom_limit: 3, catalog_key: 'plus-month-usd-v1' } as const
const now = '2026-10-15T12:00:00.000Z'
const quote = { binding, target, subscriptionItemId: 'si_private', prorationDate: Date.parse(now) / 1000,
  quotedAt: now, paidPeriodStart: '2026-10-01T00:00:00.000Z', paidThrough: '2026-11-01T00:00:00.000Z',
  expiresAt: '2026-10-15T12:15:00.000Z', unusedCreditAmount: -1000, remainingChargeAmount: 2000, amountDue: 1000,
  currency: 'usd', nextRecurringAmount: 4000, paymentState: 'payment_required',
  lines: [{ kind: 'old_credit', priceId: 'price_source', subscriptionItemId: 'si_private', amount: -1000,
    quantity: 1, periodStart: now, periodEnd: '2026-11-01T00:00:00.000Z' },
  { kind: 'target_debit', priceId: 'price_target', subscriptionItemId: 'si_private', amount: 2000,
    quantity: 1, periodStart: now, periodEnd: '2026-11-01T00:00:00.000Z' }] } as const
function setup() {
  const operation = { operation_id: operationId, subject_user_id: subjectUserId, subscription_id: subscriptionId,
    source_binding: structuredClone(binding), target: structuredClone(target), stage: 'quoted', status: 'queued', revision: 4,
    paid_period_start: quote.paidPeriodStart, paid_through: quote.paidThrough, last_paid_invoice_id: 'in_paid',
    expires_at: quote.expiresAt, quote: structuredClone(quote), quote_digest: upgradeQuoteDigest(quote), quote_revision: 3,
    invoice_id: 'in_private', payment_intent_id: null as string | null, confirmed: false }
  const store = { reserve: vi.fn().mockResolvedValue({ status: 'existing', operation }),
    get: vi.fn().mockResolvedValue({ status: 'found', operation }),
    confirm: vi.fn().mockResolvedValue({ status: 'confirmed', operation }),
    list: vi.fn(), claim: vi.fn(), checkpoint: vi.fn(), finish: vi.fn(), getApplied: vi.fn() }
  const provider = { prepareQuote: vi.fn(), createInvoice: vi.fn(), finalizeInvoice: vi.fn(), readEvidence: vi.fn(),
    payInvoice: vi.fn(), applyTarget: vi.fn(), voidInvoice: vi.fn() }
  const runtime = createUpgradeApplication({ store, provider, stripeAccount: config.stripeAccount, now: () => Date.parse(now) })
  return { operation, store, provider, runtime }
}
beforeEach(() => { vi.clearAllMocks(); mocks.process.mockResolvedValue({ kind: 'deferred' }); mocks.due.mockResolvedValue({ processed: 0, results: [] }) })
describe('upgrade application runtime', () => {
  it('replays an already quoted reservation without materializing another invoice', async () => {
    const f = setup(); const result = await f.runtime.startUpgrade({ subjectUserId, operationId, offeringVersionId })
    expect(result?.status).toBe('quoted'); expect(mocks.process).not.toHaveBeenCalled()
    expect(f.store.reserve).toHaveBeenCalledWith({ subject_user_id: subjectUserId, operation_id: operationId, offering_version_id: offeringVersionId })
    expect(result?.quote).toMatchObject({ plan: 'pro', amountDue: 1000, unusedCreditAmount: -1000,
      remainingChargeAmount: 2000, nextRenewalAt: quote.paidThrough, nextRecurringAmount: 4000, quoteRevision: 3,
      quoteDigest: f.operation.quote_digest, expiresAt: quote.expiresAt })
    for (const secret of ['cus_private', 'sub_private', 'si_private', 'in_private', 'price_target']) expect(JSON.stringify(result)).not.toContain(secret)
  })
  it('processes a newly reserved operation, then projects stored state rather than processor success', async () => {
    const f = setup(); f.operation.stage = 'reserved'; Object.assign(f.operation, { quote: null, quote_digest: null, quote_revision: null, invoice_id: null })
    f.store.reserve.mockResolvedValue({ status: 'reserved', operation: f.operation })
    mocks.process.mockResolvedValue({ kind: 'applied' })
    expect(await f.runtime.startUpgrade({ subjectUserId, operationId, offeringVersionId })).toMatchObject({ status: 'pending', quote: null })
    expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({ store: f.store, provider: f.provider, operationId, leaseSeconds: 120 }))
    expect(f.store.get).toHaveBeenCalled()
  })
  it('confirms the exact stored quote and processes before rereading', async () => {
    const f = setup(); f.operation.confirmed = true; f.operation.stage = 'payment_requested'
    const result = await f.runtime.confirmUpgrade({ subjectUserId, operationId, quoteRevision: 3, quoteDigest: f.operation.quote_digest })
    expect(f.store.confirm).toHaveBeenCalledWith({ subject_user_id: subjectUserId, operation_id: operationId,
      quote_revision: 3, quote_digest: f.operation.quote_digest })
    expect(mocks.process).toHaveBeenCalledOnce(); expect(result).toMatchObject({ status: 'payment_pending', quote: null })
  })
  it('returns active only for a validated applied operation and retries confirmation without a new payment', async () => {
    const f = setup(); f.operation.confirmed = true; f.operation.stage = 'applied'; f.operation.status = 'applied'; f.operation.payment_intent_id = 'pi_private'
    f.store.confirm.mockResolvedValue({ status: 'existing', operation: f.operation })
    expect(await f.runtime.confirmUpgrade({ subjectUserId, operationId, quoteRevision: 3, quoteDigest: f.operation.quote_digest }))
      .toEqual({ operationId, status: 'active', quote: null })
    expect(mocks.process).not.toHaveBeenCalled()
  })
  it.each(['payment_verified', 'change_requested'])('projects %s as synchronizing', async stage => {
    const f = setup(); f.operation.stage = stage; f.operation.confirmed = true
    expect(await f.runtime.getUpgrade({ subjectUserId, operationId })).toMatchObject({ status: 'synchronizing', quote: null })
  })
  it('status reads never invoke the mutation processor', async () => {
    const f = setup(); await f.runtime.getUpgrade({ subjectUserId, operationId })
    expect(mocks.process).not.toHaveBeenCalled(); expect(f.store.confirm).not.toHaveBeenCalled()
  })
  it('returns missing operations without revealing foreign ownership', async () => {
    const f = setup(); f.store.get.mockResolvedValue({ status: 'not_found' })
    expect(await f.runtime.getUpgrade({ subjectUserId, operationId })).toBeNull()
  })
  it('returns null for a missing reservation without running the provider', async () => {
    const f = setup(); f.store.reserve.mockResolvedValue({ status: 'not_found' })
    expect(await f.runtime.startUpgrade({ subjectUserId, operationId, offeringVersionId })).toBeNull()
    expect(mocks.process).not.toHaveBeenCalled()
  })
  it.each(['plan_conflict', 'rejected'])('maps reserve %s to eligibility conflict', async status => {
    const f = setup(); f.store.reserve.mockResolvedValue({ status })
    await expect(f.runtime.startUpgrade({ subjectUserId, operationId, offeringVersionId })).rejects.toBeInstanceOf(UpgradeEligibilityError)
    expect(mocks.process).not.toHaveBeenCalled()
  })
  it.each(['expired', 'rejected', 'plan_conflict'])('maps confirm %s to quote conflict', async status => {
    const f = setup(); f.store.confirm.mockResolvedValue({ status })
    await expect(f.runtime.confirmUpgrade({ subjectUserId, operationId, quoteRevision: 3, quoteDigest: f.operation.quote_digest }))
      .rejects.toBeInstanceOf(UpgradeConfirmationError)
    expect(mocks.process).not.toHaveBeenCalled()
  })
  it('projects an elapsed unconfirmed quote as expired without provider writes', async () => {
    const f = setup(); const runtime = createUpgradeApplication({ store: f.store, provider: f.provider,
      stripeAccount: config.stripeAccount, now: () => Date.parse(quote.expiresAt) })
    expect(await runtime.getUpgrade({ subjectUserId, operationId })).toEqual({ operationId, status: 'expired', quote: null })
    expect(mocks.process).not.toHaveBeenCalled()
  })
  it('rejects elapsed unconfirmed quotes locally before confirmation or processing', async () => {
    const f = setup(); const runtime = createUpgradeApplication({ store: f.store, provider: f.provider,
      stripeAccount: config.stripeAccount, now: () => Date.parse(quote.expiresAt) })
    await expect(runtime.confirmUpgrade({ subjectUserId, operationId, quoteRevision: 3, quoteDigest: f.operation.quote_digest }))
      .rejects.toBeInstanceOf(UpgradeConfirmationError)
    expect(f.store.confirm).not.toHaveBeenCalled(); expect(mocks.process).not.toHaveBeenCalled()
  })
  it('rejects a stale confirmation digest before the confirmation RPC', async () => {
    const f = setup()
    await expect(f.runtime.confirmUpgrade({ subjectUserId, operationId, quoteRevision: 3, quoteDigest: 'b'.repeat(64) }))
      .rejects.toBeInstanceOf(UpgradeConfirmationError)
    expect(f.store.confirm).not.toHaveBeenCalled(); expect(mocks.process).not.toHaveBeenCalled()
  })
  it('rejects a confirmed envelope whose operation still says unconfirmed', async () => {
    const f = setup()
    await expect(f.runtime.confirmUpgrade({ subjectUserId, operationId, quoteRevision: 3, quoteDigest: f.operation.quote_digest }))
      .rejects.toThrow('Billing upgrade operation is invalid')
    expect(mocks.process).not.toHaveBeenCalled()
  })
  it.each([
    ['foreign subject', (f: ReturnType<typeof setup>) => { f.operation.subject_user_id = offeringVersionId }],
    ['foreign operation', (f: ReturnType<typeof setup>) => { f.operation.operation_id = offeringVersionId }],
    ['foreign account', (f: ReturnType<typeof setup>) => { Object.assign(f.operation.target, { stripe_account: 'acct_other' }) }],
    ['digest mismatch', (f: ReturnType<typeof setup>) => { f.operation.quote_digest = 'f'.repeat(64) }],
    ['inconsistent active', (f: ReturnType<typeof setup>) => { f.operation.status = 'applied' }],
  ] as const)('rejects malformed persisted %s', async (_label, mutate) => {
    const f = setup(); mutate(f)
    await expect(f.runtime.getUpgrade({ subjectUserId, operationId })).rejects.toThrow('Billing upgrade operation is invalid')
    expect(mocks.process).not.toHaveBeenCalled()
  })
  it('fails closed for malformed database envelopes', async () => {
    const f = setup(); f.store.get.mockResolvedValue({ status: 'found', operation: null })
    await expect(f.runtime.getUpgrade({ subjectUserId, operationId })).rejects.toThrow('Billing upgrade database result is invalid')
  })
  it('keeps worker batches strictly bounded to one operation', async () => {
    const f = setup(); await f.runtime.processDue({ limit: 1 })
    expect(mocks.due).toHaveBeenCalledWith({ store: f.store, provider: f.provider, leaseSeconds: 120, limit: 1 })
  })
})
describe('gated upgrade construction', () => {
  it('checks the independent upgrade flag before loading purchase configuration', () => {
    expect(readBillingUpgradeConfig({})).toBeNull(); expect(mocks.purchaseConfig).not.toHaveBeenCalled()
    mocks.purchaseConfig.mockReturnValue(config)
    expect(readBillingUpgradeConfig({ BILLING_UPGRADES_ENABLED: 'true' })).toEqual(config)
  })
  it('still requires the existing purchase and sandbox configuration', () => {
    mocks.purchaseConfig.mockReturnValue(null)
    expect(readBillingUpgradeConfig({ BILLING_UPGRADES_ENABLED: 'true' })).toBeNull()
  })
  it('constructs the pinned SDK and target-bound generated client only when called', () => {
    const sdk = {}; const client = {}; const port = {}; const provider = {}; const fetcher = vi.fn()
    mocks.stripe.mockImplementation(function () { return sdk }); mocks.client.mockReturnValue(client)
    mocks.port.mockReturnValue(port); mocks.provider.mockReturnValue(provider); mocks.boundFetch.mockReturnValue(fetcher)
    mocks.store.mockReturnValue(setup().store)
    createBillingUpgradeRuntime(config)
    expect(mocks.stripe).toHaveBeenCalledExactlyOnceWith(config.secretKey,
      { apiVersion: '2026-08-26.dahlia', timeout: 5000, maxNetworkRetries: 0 })
    expect(mocks.boundFetch).toHaveBeenCalledWith(config.supabaseOrigin)
    expect(mocks.client).toHaveBeenCalledWith({ fetch: fetcher }); expect(mocks.store).toHaveBeenCalledWith(client)
    expect(mocks.port).toHaveBeenCalledWith(sdk); expect(mocks.provider).toHaveBeenCalledWith(port)
  })
})
