import {
  BillingFinishResultSchema,
  BillingProviderSubscriptionSnapshotSchema,
  BillingSubscriptionClaimSchema,
  type BillingClaimedSubscription,
  type BillingProviderSubscriptionSnapshot,
  type BillingFinishInput,
  type BillingSubscriptionBinding,
  type BillingSynchronizationReason,
} from '@/lib/server/billing/contracts'
import { z } from 'zod'
import { UpgradeOperationSchema, UpgradeProviderEvidenceSchema, type UpgradeOperation } from './upgrade-contracts'

export type BillingProvider = {
  /** Returns only the normalized snapshot, never an SDK object. */
  retrieveSubscription(binding: BillingSubscriptionBinding): Promise<unknown>
  retrieveAppliedUpgrade?(operation: UpgradeOperation): Promise<unknown>
}

export type BillingStore = {
  claimSubscription(input: { subscription_id: string; lease_seconds: number }): Promise<unknown>
  finishSubscription(input: BillingFinishInput): Promise<unknown>
  listWork(input: { limit: number }): Promise<unknown>
  getAppliedUpgrade?(input: { subscription_id: string }): Promise<unknown>
}

export type BillingSynchronizationResult =
  | { kind: 'applied' | 'replayed' }
  | { kind: 'busy' | 'not_found' }
  | { kind: 'lost_claim' | 'plan_conflict'; retryable: true }
  | { kind: 'rejected'; retryable: boolean }
  | { kind: 'exception'; reason: BillingSynchronizationReason; retryable: boolean }

type PaidEvidence = {
  invoiceId: string
  periodStart: string
  periodEnd: string
}

function equalTimestamp(left: string, right: string): boolean {
  return new Date(left).getTime() === new Date(right).getTime()
}

function exception(reason: BillingSynchronizationReason): { kind: 'exception'; reason: BillingSynchronizationReason; retryable: boolean } {
  return { kind: 'exception', reason, retryable: reason === 'provider_unavailable' }
}

/**
 * Evaluates a current provider snapshot against the immutable, purchased
 * binding. It intentionally has no catalog lookup: even an archived offering
 * version remains valid for the binding's renewal.
 */
export function verifyPaidSubscriptionSnapshot(
  binding: BillingSubscriptionBinding,
  candidate: unknown,
): PaidEvidence | BillingSynchronizationReason {
  const parsed = BillingProviderSubscriptionSnapshotSchema.safeParse(candidate)
  if (!parsed.success) return 'provider_snapshot_invalid'
  const snapshot = parsed.data

  if (snapshot.liveMode || snapshot.stripeAccount !== binding.stripe_account) {
    return 'provider_environment_invalid'
  }
  if (!snapshot.isCurrent) return 'subscription_not_current'
  if (snapshot.status !== 'active') return 'subscription_not_active'
  if (snapshot.pendingUpdate) return 'subscription_pending_update'
  if (
    snapshot.cancelAt !== null
    || snapshot.cancelAtPeriodEnd
    || snapshot.pauseCollection
    || snapshot.scheduleId !== null
  ) return 'subscription_transition_unapproved'
  if (
    snapshot.subscriptionId !== binding.stripe_subscription_id
    || snapshot.customerId !== binding.stripe_customer_id
  ) return 'subscription_not_bound'

  if (snapshot.items.length !== 1 || snapshot.items[0].quantity !== 1) {
    return 'subscription_item_invalid'
  }
  const item = snapshot.items[0]
  if (item.priceId !== binding.stripe_price_id) return 'changed_price'
  if (
    binding.unit_amount <= 0
    || item.productId !== binding.stripe_product_id
    || item.unitAmount !== binding.unit_amount
  ) return 'financial_terms_unapproved'
  if (
    item.currency !== binding.currency
    || item.interval !== binding.interval
    || item.intervalCount !== 1
    || item.priceLiveMode
    || new Date(item.currentPeriodEnd).getTime() <= new Date(item.currentPeriodStart).getTime()
  ) {
    return 'subscription_item_invalid'
  }

  const invoice = snapshot.latestInvoice
  if (!invoice) return 'invoice_missing'
  if (invoice.status !== 'paid') return 'invoice_not_paid'
  if (invoice.amountPaidOffStripe !== undefined && invoice.amountPaidOffStripe !== 0) {
    return 'invoice_paid_out_of_band'
  }
  // Payment/discount/credit policy is not approved. A zero-amount invoice or
  // a payment composition other than one captured card payment grants nothing.
  if (
    !['subscription_create', 'subscription_cycle'].includes(invoice.billingReason)
    || invoice.subtotal !== binding.unit_amount
    || invoice.total !== binding.unit_amount
    || invoice.amountDue !== binding.unit_amount
    || invoice.amountPaid !== binding.unit_amount
    || invoice.startingBalance !== 0
    || invoice.endingBalance !== 0
    || invoice.totalDiscountAmount !== 0
    || invoice.totalTaxAmount !== 0
    || invoice.hasDiscounts
    || invoice.hasTaxes
    || invoice.prePaymentCreditNotesAmount !== 0
    || invoice.postPaymentCreditNotesAmount !== 0
  ) return 'financial_terms_unapproved'
  if (
    invoice.amountDue <= 0
    || invoice.amountPaid !== invoice.amountDue
    || !invoice.paymentsFullyEnumerated
    || invoice.payments.length !== 1
  ) return 'invoice_payment_unapproved'
  const payment = invoice.payments[0]
  if (payment.latestCharge.paymentMethodType !== 'card') return 'financial_terms_unapproved'
  if (
    payment.customerId !== binding.stripe_customer_id
    || invoice.currency !== binding.currency
    || payment.currency !== binding.currency
    || payment.amountReceived !== invoice.amountDue
    || payment.latestCharge.customerId !== binding.stripe_customer_id
    || payment.latestCharge.currency !== binding.currency
    || payment.latestCharge.paymentIntentId !== payment.paymentIntentId
  ) return 'invoice_payment_unapproved'
  if (
    invoice.customerId !== binding.stripe_customer_id
    || invoice.subscriptionId !== binding.stripe_subscription_id
  ) return 'invoice_not_bound'

  if (invoice.lines.length !== 1) return 'financial_terms_unapproved'
  const line = invoice.lines[0]
  if (
    line.amount !== binding.unit_amount
    || line.hasDiscounts
    || line.hasTaxes
  ) return 'financial_terms_unapproved'
  const matchingLine = (
    line.subscriptionId === binding.stripe_subscription_id
    && line.priceId === binding.stripe_price_id
    && line.quantity === 1
    && !line.proration
    && equalTimestamp(line.periodStart, item.currentPeriodStart)
    && equalTimestamp(line.periodEnd, item.currentPeriodEnd)
  )
  if (!matchingLine) return 'invoice_line_unverified'

  return {
    invoiceId: invoice.id,
    periodStart: item.currentPeriodStart,
    periodEnd: item.currentPeriodEnd,
  }
}

/** Recognizes lifecycle facts without relaxing proof of a successful payment. */
export function verifyBillingLifecycleSnapshot(
  claim: BillingClaimedSubscription,
  candidate: unknown,
): Omit<BillingFinishInput, 'subscription_id' | 'lease_token' | 'fencing_token' | 'expected_subscription_revision' | 'expected_account_plan_revision' | 'event_inbox_id'> | BillingSynchronizationReason {
  const facts = claim.lifecycle
  if (!facts?.is_current) return 'subscription_not_current'
  const parsed = BillingProviderSubscriptionSnapshotSchema.safeParse(candidate)
  if (!parsed.success) return 'provider_snapshot_invalid'
  const snapshot = parsed.data
  const binding = claim.binding
  if (snapshot.liveMode || snapshot.stripeAccount !== binding.stripe_account) return 'provider_environment_invalid'
  if (!snapshot.isCurrent) return 'subscription_not_current'
  if (snapshot.subscriptionId !== binding.stripe_subscription_id || snapshot.customerId !== binding.stripe_customer_id) return 'subscription_not_bound'
  if (snapshot.items.length !== 1 || snapshot.items[0].quantity !== 1) return 'subscription_item_invalid'
  const item = snapshot.items[0]
  if (item.priceId !== binding.stripe_price_id) return 'changed_price'
  if (item.productId !== binding.stripe_product_id || item.unitAmount !== binding.unit_amount
    || item.currency !== binding.currency || item.interval !== binding.interval || item.intervalCount !== 1 || item.priceLiveMode) return 'subscription_item_invalid'
  if (snapshot.pendingUpdate || snapshot.pauseCollection || snapshot.scheduleId) return 'subscription_transition_unapproved'
  const common = {
    provider_status: snapshot.status,
    cancel_at_period_end: snapshot.cancelAtPeriodEnd,
    // Only complete outstanding-invoice enumeration on a terminal subscription proves closure.
    obligations_cleared: snapshot.status === 'canceled' && snapshot.terminalObligationsCleared === true,
    invoice_id: null, period_start: null, period_end: null, reason_code: null,
  }
  const cancellation = snapshot.cancelAtPeriodEnd || snapshot.status === 'canceled'
  // A paid invoice remains payment evidence while end-of-period cancellation is
  // scheduled. No provider status alone proves a new paid period.
  if (snapshot.latestInvoice?.status === 'paid' && ['active', 'canceled'].includes(snapshot.status)) {
    const paid = verifyPaidSubscriptionSnapshot(binding, {
      ...snapshot, status: 'active', cancelAt: null, cancelAtPeriodEnd: false,
    } satisfies BillingProviderSubscriptionSnapshot)
    if (typeof paid === 'string') return paid
    if (snapshot.cancelAt !== null && !equalTimestamp(snapshot.cancelAt, paid.periodEnd)) return 'subscription_transition_unapproved'
    return { ...common, outcome: 'paid', invoice_id: paid.invoiceId, period_start: paid.periodStart, period_end: paid.periodEnd,
      cancel_at_period_end: cancellation }
  }
  if (!facts.paid_through || !facts.last_paid_invoice_id) return 'invoice_not_paid'
  if (snapshot.cancelAt !== null && !equalTimestamp(snapshot.cancelAt, facts.paid_through)) return 'subscription_transition_unapproved'
  const invoice = snapshot.latestInvoice
  // Exhausted retries can leave the subscription active, unpaid, or canceled.
  // Decode the verified failed cycle before treating canceled as voluntary expiry.
  // https://docs.stripe.com/billing/subscriptions/overview#subscription-statuses
  const failedRenewal = (invoice?.status === 'uncollectible' && ['active', 'past_due', 'unpaid', 'canceled'].includes(snapshot.status))
    || (invoice?.status === 'open' && ['past_due', 'unpaid', 'canceled'].includes(snapshot.status))
  if (failedRenewal && invoice) {
    if (invoice.billingReason !== 'subscription_cycle' || invoice.customerId !== binding.stripe_customer_id
      || invoice.subscriptionId !== binding.stripe_subscription_id || invoice.currency !== binding.currency) return 'invoice_not_bound'
    if (invoice.amountPaid !== 0 || invoice.payments.length !== 0 || (invoice.amountPaidOffStripe ?? 0) !== 0
      || invoice.subtotal !== binding.unit_amount || invoice.total !== binding.unit_amount || invoice.amountDue !== binding.unit_amount
      || invoice.startingBalance !== 0 || invoice.endingBalance !== 0 || invoice.hasDiscounts || invoice.hasTaxes
      || invoice.totalDiscountAmount !== 0 || invoice.totalTaxAmount !== 0
      || invoice.prePaymentCreditNotesAmount !== 0 || invoice.postPaymentCreditNotesAmount !== 0 || invoice.lines.length !== 1) return 'financial_terms_unapproved'
    const line = invoice.lines[0]
    if (line.subscriptionId !== binding.stripe_subscription_id || line.priceId !== binding.stripe_price_id
      || line.quantity !== 1 || line.proration || line.hasDiscounts || line.hasTaxes || line.amount !== binding.unit_amount
      || !equalTimestamp(line.periodStart, facts.paid_through) || !equalTimestamp(line.periodStart, item.currentPeriodStart)
      || !equalTimestamp(line.periodEnd, item.currentPeriodEnd) || Date.parse(line.periodEnd) <= Date.parse(line.periodStart)) return 'invoice_line_unverified'
    return { ...common, outcome: 'renewal_failed', invoice_id: invoice.id, period_start: line.periodStart, period_end: line.periodEnd }
  }
  if (cancellation) {
    if (snapshot.latestInvoice && (snapshot.latestInvoice.customerId !== binding.stripe_customer_id
      || snapshot.latestInvoice.subscriptionId !== binding.stripe_subscription_id)) return 'invoice_not_bound'
    return { ...common, outcome: 'canceled' }
  }
  return 'invoice_not_paid'
}

async function finish(
  store: BillingStore,
  claim: BillingClaimedSubscription,
  input: Omit<BillingFinishInput, 'subscription_id' | 'lease_token' | 'fencing_token' | 'expected_subscription_revision' | 'expected_account_plan_revision'>,
): Promise<BillingSynchronizationResult> {
  const rawResult = await store.finishSubscription({
    subscription_id: claim.subscription_id,
    lease_token: claim.lease_token,
    fencing_token: claim.fencing_token,
    expected_subscription_revision: claim.subscription_revision,
    expected_account_plan_revision: claim.expected_account_plan_revision,
    ...input,
  })
  const result = BillingFinishResultSchema.safeParse(rawResult)
  if (!result.success) throw new Error('Billing synchronization completion is unavailable')

  switch (result.data.status) {
    case 'applied': return { kind: 'applied' }
    case 'replayed': return { kind: 'replayed' }
    case 'lost_claim': return { kind: 'lost_claim', retryable: true }
    case 'plan_conflict': return { kind: 'plan_conflict', retryable: true }
    case 'rejected': return { kind: 'rejected', retryable: result.data.retry_scheduled }
  }
}

async function finishException(
  store: BillingStore,
  claim: BillingClaimedSubscription,
  eventInboxId: string | null,
  reason: BillingSynchronizationReason,
): Promise<BillingSynchronizationResult> {
  const result = await finish(store, claim, {
    outcome: 'exception',
    event_inbox_id: eventInboxId,
    invoice_id: null,
    period_start: null,
    period_end: null,
    reason_code: reason,
  })
  return result.kind === 'applied' || result.kind === 'replayed' ? exception(reason) : result
}

/** A manual upgrade receipt proves a version transition, never an additional paid period. */
async function observeAppliedUpgrade(args: { store: BillingStore; provider: BillingProvider }, claim: BillingClaimedSubscription,
  eventInboxId: string | null): Promise<BillingSynchronizationResult | null> {
  if (!args.store.getAppliedUpgrade || !args.provider.retrieveAppliedUpgrade || !claim.lifecycle?.is_current) return null
  const stored = z.object({ operation: UpgradeOperationSchema.nullable() }).strict().safeParse(
    await args.store.getAppliedUpgrade({ subscription_id: claim.subscription_id }),
  )
  if (!stored.success || !stored.data.operation) return null
  const operation = stored.data.operation
  const binding = claim.binding
  if (operation.status !== 'applied' || operation.stage !== 'applied' || !operation.confirmed || !operation.quote
    || operation.subscription_id !== claim.subscription_id || operation.subject_user_id !== binding.subject_user_id
    || operation.source_binding.stripe_account !== binding.stripe_account
    || operation.source_binding.stripe_customer_id !== binding.stripe_customer_id
    || operation.source_binding.stripe_subscription_id !== binding.stripe_subscription_id
    || operation.target.offering_version_id !== binding.offering_version_id
    || operation.target.stripe_price_id !== binding.stripe_price_id
    || operation.target.stripe_product_id !== binding.stripe_product_id || operation.target.unit_amount !== binding.unit_amount
    || operation.target.currency !== binding.currency || operation.target.interval !== binding.interval
    || !claim.lifecycle.paid_through || !claim.lifecycle.paid_period_start
    || !equalTimestamp(operation.paid_through, claim.lifecycle.paid_through)
    || !equalTimestamp(operation.paid_period_start, claim.lifecycle.paid_period_start)
    || operation.last_paid_invoice_id !== claim.lifecycle.last_paid_invoice_id) return null
  const result = UpgradeProviderEvidenceSchema.safeParse(await args.provider.retrieveAppliedUpgrade(operation))
  if (!result.success || result.data.kind !== 'paid' || !result.data.targetApplied) return null
  const evidence = result.data.evidence
  if (evidence.invoiceId !== operation.invoice_id || evidence.paymentIntentId !== operation.payment_intent_id
    || evidence.subscriptionId !== binding.stripe_subscription_id || evidence.subscriptionItemId !== operation.quote.subscriptionItemId
    || evidence.targetPriceId !== binding.stripe_price_id || evidence.amountPaid !== operation.quote.amountDue
    || evidence.currency !== binding.currency || !equalTimestamp(evidence.paidThrough, operation.paid_through)
    || !equalTimestamp(evidence.paidPeriodStart, operation.paid_period_start)) return null
  return finish(args.store, claim, { outcome: 'observed', event_inbox_id: eventInboxId, invoice_id: null,
    period_start: null, period_end: null, reason_code: null, provider_status: 'active', cancel_at_period_end: false })
}

/**
 * Fetches authoritative current state only after obtaining a per-subscription
 * claim. Every completion includes the fencing token and account-plan revision
 * so an expired worker cannot overwrite a later manual plan assignment.
 */
export async function synchronizeBillingSubscription(args: {
  store: BillingStore
  provider: BillingProvider
  subscriptionId: string
  eventInboxId: string | null
  leaseSeconds: number
}): Promise<BillingSynchronizationResult> {
  if (!Number.isInteger(args.leaseSeconds) || args.leaseSeconds < 30 || args.leaseSeconds > 300) {
    throw new Error('Billing subscription lease is invalid')
  }

  const rawClaim = await args.store.claimSubscription({
    subscription_id: args.subscriptionId,
    lease_seconds: args.leaseSeconds,
  })
  const claim = BillingSubscriptionClaimSchema.safeParse(rawClaim)
  if (!claim.success) throw new Error('Billing subscription claim is unavailable')
  if (claim.data.status === 'busy') return { kind: 'busy' }
  if (claim.data.status === 'not_found') return { kind: 'not_found' }
  if (
    claim.data.subscription_id !== args.subscriptionId
    || claim.data.binding.subscription_id !== claim.data.subscription_id
  ) {
    throw new Error('Billing subscription claim does not match the requested binding')
  }

  let snapshot: unknown
  try {
    snapshot = await args.provider.retrieveSubscription(claim.data.binding)
  } catch {
    return finishException(args.store, claim.data, args.eventInboxId, 'provider_unavailable')
  }

  if (claim.data.lifecycle) {
    const lifecycle = verifyBillingLifecycleSnapshot(claim.data, snapshot)
    if (typeof lifecycle === 'string') {
      try {
        const upgraded = await observeAppliedUpgrade(args, claim.data, args.eventInboxId)
        if (upgraded) return upgraded
      } catch { return finishException(args.store, claim.data, args.eventInboxId, 'provider_unavailable') }
      return finishException(args.store, claim.data, args.eventInboxId, lifecycle)
    }
    return finish(args.store, claim.data, { ...lifecycle, event_inbox_id: args.eventInboxId })
  }

  const verified = verifyPaidSubscriptionSnapshot(claim.data.binding, snapshot)
  if (typeof verified === 'string') {
    return finishException(args.store, claim.data, args.eventInboxId, verified)
  }

  return finish(args.store, claim.data, {
    outcome: 'paid',
    event_inbox_id: args.eventInboxId,
    invoice_id: verified.invoiceId,
    period_start: verified.periodStart,
    period_end: verified.periodEnd,
    reason_code: null,
  })
}
