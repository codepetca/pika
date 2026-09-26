import {
  BillingFinishResultSchema,
  BillingProviderSubscriptionSnapshotSchema,
  BillingSubscriptionClaimSchema,
  type BillingClaimedSubscription,
  type BillingFinishInput,
  type BillingSubscriptionBinding,
  type BillingSynchronizationReason,
} from '@/lib/server/billing/contracts'

export type BillingProvider = {
  /** Returns only the normalized snapshot, never an SDK object. */
  retrieveSubscription(binding: BillingSubscriptionBinding): Promise<unknown>
}

export type BillingStore = {
  claimSubscription(input: { subscription_id: string; lease_seconds: number }): Promise<unknown>
  finishSubscription(input: BillingFinishInput): Promise<unknown>
  listWork(input: { limit: number }): Promise<unknown>
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
    invoice.amountDue <= 0
    || invoice.amountPaid !== invoice.amountDue
    || !invoice.paymentsFullyEnumerated
    || invoice.payments.length !== 1
  ) return 'invoice_payment_unapproved'
  const payment = invoice.payments[0]
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

  const matchingLine = invoice.lines.find((line) => (
    line.subscriptionId === binding.stripe_subscription_id
    && line.priceId === binding.stripe_price_id
    && line.quantity === 1
    && !line.proration
    && equalTimestamp(line.periodStart, item.currentPeriodStart)
    && equalTimestamp(line.periodEnd, item.currentPeriodEnd)
  ))
  if (!matchingLine) return 'invoice_line_unverified'

  return {
    invoiceId: invoice.id,
    periodStart: item.currentPeriodStart,
    periodEnd: item.currentPeriodEnd,
  }
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
