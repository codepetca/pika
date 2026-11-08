import {
  BillingFinishResultSchema,
  BillingProviderSubscriptionSnapshotSchema,
  BillingScheduledRenewalSchema,
  BillingSubscriptionClaimSchema,
  type BillingClaimedSubscription,
  type BillingProviderSubscriptionSnapshot,
  type BillingFinishInput,
  type BillingScheduledRenewal,
  type BillingScheduledRenewalFinishInput,
  type BillingSubscriptionBinding,
  type BillingSynchronizationReason,
} from '@/lib/server/billing/contracts'
import { z } from 'zod'
import { scheduledTermEnd } from './scheduled-plan-change-period'
import { AppliedUpgradeProviderEvidenceSchema, UpgradeOperationSchema, type UpgradeOperation } from './upgrade-contracts'
import { upgradeQuoteDigest } from './upgrade-service'

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
  getScheduledRenewal?(input: { subscription_id: string }): Promise<unknown>
  finishScheduledRenewal?(input: BillingScheduledRenewalFinishInput): Promise<unknown>
}

export type BillingSynchronizationResult =
  | { kind: 'applied' | 'replayed' }
  | { kind: 'deferred'; retryable: true }
  | { kind: 'busy' | 'not_found' }
  | { kind: 'lost_claim' | 'plan_conflict'; retryable: true }
  | { kind: 'rejected'; retryable: boolean }
  | { kind: 'exception'; reason: BillingSynchronizationReason; retryable: boolean }

type PaidEvidence = {
  invoiceId: string
  periodStart: string
  periodEnd: string
}

type BillingObservation = Omit<BillingFinishInput, 'subscription_id' | 'lease_token' | 'fencing_token' | 'expected_subscription_revision' | 'expected_account_plan_revision' | 'event_inbox_id'>

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
): BillingObservation | BillingSynchronizationReason {
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
  const cancellation = snapshot.cancelAt !== null || snapshot.cancelAtPeriodEnd || snapshot.status === 'canceled'
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
  const pendingRenewal = (invoice?.status === 'draft' || invoice?.status === 'open')
    && snapshot.status === 'active' && !cancellation && facts.end_reason === 'renewal_pending'
  if ((failedRenewal || pendingRenewal) && invoice) {
    if (invoice.billingReason !== 'subscription_cycle' || invoice.customerId !== binding.stripe_customer_id
      || invoice.subscriptionId !== binding.stripe_subscription_id || invoice.currency !== binding.currency) return 'invoice_not_bound'
    if (binding.unit_amount <= 0 || invoice.amountPaid !== 0 || invoice.payments.length !== 0 || (invoice.amountPaidOffStripe ?? 0) !== 0
      || invoice.subtotal !== binding.unit_amount || invoice.total !== binding.unit_amount || invoice.amountDue !== binding.unit_amount
      || invoice.startingBalance !== 0 || (invoice.endingBalance !== 0 && !(invoice.status === 'draft' && invoice.endingBalance === null))
      || invoice.hasDiscounts || invoice.hasTaxes
      || invoice.totalDiscountAmount !== 0 || invoice.totalTaxAmount !== 0
      || invoice.prePaymentCreditNotesAmount !== 0 || invoice.postPaymentCreditNotesAmount !== 0 || invoice.lines.length !== 1) return 'financial_terms_unapproved'
    const line = invoice.lines[0]
    if (invoice.id === facts.last_paid_invoice_id || line.subscriptionId !== binding.stripe_subscription_id || line.priceId !== binding.stripe_price_id
      || line.quantity !== 1 || line.proration || line.hasDiscounts || line.hasTaxes || line.amount !== binding.unit_amount
      || !equalTimestamp(line.periodStart, facts.paid_through) || !equalTimestamp(line.periodStart, item.currentPeriodStart)
      || !equalTimestamp(line.periodEnd, item.currentPeriodEnd) || Date.parse(line.periodEnd) <= Date.parse(line.periodStart)) return 'invoice_line_unverified'
    return { ...common, outcome: pendingRenewal ? 'renewal_invoice_pending' : 'renewal_failed',
      invoice_id: invoice.id, period_start: line.periodStart, period_end: line.periodEnd }
  }
  if (cancellation) {
    if (snapshot.latestInvoice && (snapshot.latestInvoice.customerId !== binding.stripe_customer_id
      || snapshot.latestInvoice.subscriptionId !== binding.stripe_subscription_id)) return 'invoice_not_bound'
    return { ...common, outcome: 'canceled' }
  }
  return 'invoice_not_paid'
}

function verifyScheduledRenewalSnapshot(
  claim: BillingClaimedSubscription,
  proof: BillingScheduledRenewal,
  snapshot: BillingProviderSubscriptionSnapshot,
): BillingObservation | BillingSynchronizationReason {
  const { binding, lifecycle: facts } = claim
  const target = proof.target_binding
  if (snapshot.scheduleId !== proof.provider_schedule_id || snapshot.pendingUpdate || snapshot.pauseCollection
    || snapshot.cancelAt !== null || snapshot.cancelAtPeriodEnd || snapshot.status === 'canceled') return 'subscription_transition_unapproved'
  if (snapshot.liveMode || snapshot.stripeAccount !== binding.stripe_account
    || target.stripe_account !== binding.stripe_account || target.provider_mode !== binding.provider_mode) return 'provider_environment_invalid'
  if (!snapshot.isCurrent || !facts?.is_current) return 'subscription_not_current'
  if (snapshot.customerId !== binding.stripe_customer_id || snapshot.subscriptionId !== binding.stripe_subscription_id
    || target.stripe_customer_id !== binding.stripe_customer_id || target.stripe_subscription_id !== binding.stripe_subscription_id
    || target.subscription_id !== binding.subscription_id || target.subject_user_id !== binding.subject_user_id) return 'subscription_not_bound'
  if (!facts.paid_through || !facts.paid_period_start || !facts.last_paid_invoice_id
    || (facts.end_reason !== 'renewal_pending' && facts.end_reason !== 'renewal_grace')) return 'invoice_not_paid'
  if (target.currency !== binding.currency || target.unit_amount <= 0) return 'financial_terms_unapproved'

  const effective = Date.parse(proof.effective_at)
  const now = Date.now()
  const alreadyApplied = proof.state === 'applied'
  if (alreadyApplied) {
    if (now < effective || !equalTimestamp(proof.effective_at, facts.paid_period_start)
      || Date.parse(facts.paid_through) !== scheduledTermEnd(proof.effective_at, target.interval)) return 'invoice_line_unverified'
    if (target.offering_version_id !== binding.offering_version_id || target.offering_id !== binding.offering_id
      || target.stripe_price_id !== binding.stripe_price_id || target.stripe_product_id !== binding.stripe_product_id
      || target.plan_key !== binding.plan_key || target.interval !== binding.interval
      || target.unit_amount !== binding.unit_amount) return 'subscription_transition_unapproved'
  } else {
    if (!equalTimestamp(proof.effective_at, facts.paid_through)) return 'invoice_line_unverified'
    // The durable admission contract currently permits only this downgrade.
    if (target.offering_version_id === binding.offering_version_id || target.stripe_price_id === binding.stripe_price_id
      || binding.plan_key !== 'pro' || target.plan_key !== 'plus' || target.interval !== binding.interval
      || target.unit_amount >= binding.unit_amount) return 'subscription_transition_unapproved'
  }

  // Strip only the schedule whose durable identity and binding were checked.
  // The ordinary verifiers still enforce invoice, item, charge, and mode facts.
  const knownSchedule = { ...snapshot, scheduleId: null }
  if (alreadyApplied || now < effective) {
    if (now < Date.parse(facts.paid_period_start) || facts.end_reason !== 'renewal_pending') return 'invoice_line_unverified'
    const paid = verifyPaidSubscriptionSnapshot(binding, knownSchedule)
    if (typeof paid === 'string') return paid
    if (paid.invoiceId !== facts.last_paid_invoice_id || !equalTimestamp(paid.periodStart, facts.paid_period_start)
      || !equalTimestamp(paid.periodEnd, facts.paid_through)
      || (alreadyApplied && snapshot.latestInvoice?.billingReason !== 'subscription_cycle')) return 'invoice_line_unverified'
    return { outcome: 'observed', invoice_id: null, period_start: null, period_end: null, reason_code: null,
      provider_status: 'active', cancel_at_period_end: false, obligations_cleared: false }
  }

  const invoice = snapshot.latestInvoice
  if (!invoice) return 'invoice_missing'
  if (invoice.billingReason !== 'subscription_cycle') return 'invoice_not_bound'
  const verified = verifyBillingLifecycleSnapshot({ ...claim, binding: target }, knownSchedule)
  if (typeof verified === 'string') return verified
  if (verified.outcome !== 'paid' && verified.outcome !== 'renewal_invoice_pending' && verified.outcome !== 'renewal_failed') {
    return 'subscription_transition_unapproved'
  }
  if (!verified.invoice_id || verified.invoice_id === facts.last_paid_invoice_id || !verified.period_start || !verified.period_end
    || !equalTimestamp(verified.period_start, proof.effective_at)
    || Date.parse(verified.period_end) !== scheduledTermEnd(proof.effective_at, target.interval)) return 'invoice_line_unverified'
  return verified
}

async function finish(
  store: BillingStore,
  claim: BillingClaimedSubscription,
  input: BillingObservation & Pick<BillingFinishInput, 'event_inbox_id'>,
  persist: (request: BillingFinishInput) => Promise<unknown> = request => store.finishSubscription(request),
): Promise<BillingSynchronizationResult> {
  const rawResult = await persist({
    subscription_id: claim.subscription_id,
    lease_token: claim.lease_token,
    fencing_token: claim.fencing_token,
    expected_subscription_revision: claim.subscription_revision,
    expected_account_plan_revision: claim.expected_account_plan_revision,
    ...input,
  })
  const result = BillingFinishResultSchema.safeParse(rawResult)
  if (!result.success) throw new Error('Billing synchronization completion is unavailable')
  if ((result.data.status === 'deferred' || result.data.status === 'attention') && input.outcome !== 'renewal_invoice_pending') {
    throw new Error('Billing synchronization returned an unexpected renewal status')
  }

  switch (result.data.status) {
    case 'applied': return { kind: 'applied' }
    case 'replayed': return { kind: 'replayed' }
    case 'deferred': return { kind: 'deferred', retryable: true }
    case 'attention': return exception('renewal_invoice_pending')
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
    || !operation.invoice_id || !operation.payment_intent_id || operation.quote_revision === null
    || operation.quote_digest !== upgradeQuoteDigest(operation.quote)
    || upgradeQuoteDigest(operation.quote.binding) !== upgradeQuoteDigest(operation.source_binding)
    || upgradeQuoteDigest(operation.quote.target) !== upgradeQuoteDigest(operation.target)
    || !equalTimestamp(operation.quote.paidPeriodStart, operation.paid_period_start)
    || !equalTimestamp(operation.quote.paidThrough, operation.paid_through)
    || operation.subscription_id !== claim.subscription_id || operation.subject_user_id !== binding.subject_user_id
    || operation.source_binding.subscription_id !== claim.subscription_id
    || operation.source_binding.subject_user_id !== binding.subject_user_id
    || operation.source_binding.stripe_account !== binding.stripe_account
    || operation.source_binding.stripe_customer_id !== binding.stripe_customer_id
    || operation.source_binding.stripe_subscription_id !== binding.stripe_subscription_id
    || operation.target.offering_version_id !== binding.offering_version_id
    || operation.target.stripe_price_id !== binding.stripe_price_id
    || operation.target.stripe_product_id !== binding.stripe_product_id || operation.target.unit_amount !== binding.unit_amount
    || operation.target.currency !== binding.currency || operation.target.interval !== binding.interval
    || operation.target.stripe_account !== binding.stripe_account || operation.target.plan_key !== binding.plan_key
    || !claim.lifecycle.paid_through || !claim.lifecycle.paid_period_start
    || !equalTimestamp(operation.paid_through, claim.lifecycle.paid_through)
    || !equalTimestamp(operation.paid_period_start, claim.lifecycle.paid_period_start)
    || operation.last_paid_invoice_id !== claim.lifecycle.last_paid_invoice_id) return null
  const result = AppliedUpgradeProviderEvidenceSchema.safeParse(await args.provider.retrieveAppliedUpgrade(operation))
  if (!result.success || result.data.kind !== 'paid' || !result.data.targetApplied) return null
  const evidence = result.data.evidence
  if (evidence.invoiceId !== operation.invoice_id || evidence.paymentIntentId !== operation.payment_intent_id
    || evidence.subscriptionId !== binding.stripe_subscription_id || evidence.subscriptionItemId !== operation.quote.subscriptionItemId
    || evidence.targetPriceId !== binding.stripe_price_id || evidence.amountPaid !== operation.quote.amountDue
    || evidence.currency !== binding.currency || !equalTimestamp(evidence.paidThrough, operation.paid_through)
    || !equalTimestamp(evidence.paidPeriodStart, operation.paid_period_start)
    || (result.data.cancelAt !== null && !equalTimestamp(result.data.cancelAt, operation.paid_through))) return null
  const cancellation = result.data.cancelAt !== null || result.data.cancelAtPeriodEnd || evidence.providerStatus === 'canceled'
  return finish(args.store, claim, { outcome: cancellation ? 'canceled' : 'observed', event_inbox_id: eventInboxId, invoice_id: null,
    period_start: null, period_end: null, reason_code: null, provider_status: evidence.providerStatus,
    cancel_at_period_end: result.data.cancelAtPeriodEnd, obligations_cleared: result.data.terminalObligationsCleared })
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

  const { getScheduledRenewal, finishScheduledRenewal } = args.store
  if (getScheduledRenewal && finishScheduledRenewal && typeof snapshot === 'object' && snapshot !== null
    && 'scheduleId' in snapshot && snapshot.scheduleId !== null) {
    const normalized = BillingProviderSubscriptionSnapshotSchema.safeParse(snapshot)
    if (!normalized.success) return finishException(args.store, claim.data, args.eventInboxId, 'provider_snapshot_invalid')
    let stored: unknown
    try {
      stored = await getScheduledRenewal({ subscription_id: claim.data.subscription_id })
    } catch {
      return finishException(args.store, claim.data, args.eventInboxId, 'provider_unavailable')
    }
    const proof = BillingScheduledRenewalSchema.safeParse(stored)
    if (!proof.success) return finishException(args.store, claim.data, args.eventInboxId, 'subscription_transition_unapproved')
    const verified = verifyScheduledRenewalSnapshot(claim.data, proof.data, normalized.data)
    if (typeof verified === 'string') return finishException(args.store, claim.data, args.eventInboxId, verified)
    const completion = { ...verified, event_inbox_id: args.eventInboxId }
    if (verified.outcome === 'observed') return finish(args.store, claim.data, completion)
    return finish(args.store, claim.data, completion, request => finishScheduledRenewal({
      ...request, operation_id: proof.data.operation_id, provider_schedule_id: proof.data.provider_schedule_id,
      target_offering_version_id: proof.data.target_binding.offering_version_id,
    }))
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
