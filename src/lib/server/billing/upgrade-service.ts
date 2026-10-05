import { createHash } from 'node:crypto'
import { z } from 'zod'
import { UpgradeQuoteContractError, UpgradeQuoteFactsSchema } from './upgrade-quote-contracts'
import {
  UpgradeClaimResultSchema, UpgradeFinishSchema, UpgradeProviderEvidenceSchema, UpgradeWorkSchema,
  UpgradeProviderContractError,
  type UpgradeClaim, type UpgradeFence, type UpgradeOperation, type UpgradeProvider, type UpgradeStore,
} from './upgrade-contracts'

export type UpgradeProcessingResult = { kind: 'applied' | 'expired' | 'awaiting_confirmation' | 'payment_pending'
  | 'busy' | 'not_found' | 'plan_conflict' | 'lost_claim' | 'deferred' } | { kind: 'attention'; reason: string }

/** Canonical object ordering is stable across JSONB round trips. Never hash transport key order. */
export function upgradeQuoteDigest(value: unknown): string {
  function canonical(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(canonical)
    if (item !== null && typeof item === 'object') return Object.fromEntries(Object.entries(item)
      .sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, canonical(nested)]))
    return item
  }
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

function fence(claim: UpgradeClaim): UpgradeFence {
  return { operation_id: claim.operation.operation_id, subscription_id: claim.operation.subscription_id,
    lease_token: claim.lease_token, fencing_token: claim.fencing_token, subscription_revision: claim.subscription_revision,
    expected_account_plan_revision: claim.expected_account_plan_revision, expected_access_revision: claim.expected_access_revision,
    expected_entitlement_revision: claim.expected_entitlement_revision, operation_revision: claim.operation.revision }
}

function assertOperation(operation: UpgradeOperation, operationId: string) {
  if (operation.operation_id !== operationId || operation.source_binding.subscription_id !== operation.subscription_id
    || operation.source_binding.subject_user_id !== operation.subject_user_id) throw new Error('Upgrade operation identity is invalid')
  if (operation.quote && (upgradeQuoteDigest(operation.quote.binding) !== upgradeQuoteDigest(operation.source_binding)
    || upgradeQuoteDigest(operation.quote.target) !== upgradeQuoteDigest(operation.target)
    || Date.parse(operation.quote.paidPeriodStart) !== Date.parse(operation.paid_period_start)
    || Date.parse(operation.quote.paidThrough) !== Date.parse(operation.paid_through))) throw new Error('Upgrade quote identity is invalid')
  if (operation.quote_digest && (!operation.quote || operation.quote_digest !== upgradeQuoteDigest(operation.quote))) {
    throw new Error('Upgrade quote digest is invalid')
  }
}

class UpgradeClaimLost extends Error {
  constructor(readonly kind: 'lost_claim' | 'plan_conflict') { super('Upgrade lease is no longer current') }
}

/** Every uncertain provider write retains a durable intent and the same request identity. */
export async function processUpgrade(args: { store: UpgradeStore; provider: UpgradeProvider; operationId: string
  leaseSeconds: number; now?: () => string }): Promise<UpgradeProcessingResult> {
  if (!Number.isInteger(args.leaseSeconds) || args.leaseSeconds < 30 || args.leaseSeconds > 300) throw new Error('Upgrade lease is invalid')
  const now = args.now ?? (() => new Date().toISOString())
  const initial = UpgradeClaimResultSchema.parse(await args.store.claim({ operation_id: args.operationId, lease_seconds: args.leaseSeconds }))
  if (initial.status !== 'claimed') return { kind: initial.status }
  let claim = initial
  let paymentAttempted = false
  assertOperation(claim.operation, args.operationId)
  async function checkpoint(stage: UpgradeOperation['stage'], facts: Partial<Pick<Parameters<UpgradeStore['checkpoint']>[0],
    'quote' | 'quote_digest' | 'invoice_id' | 'payment_intent_id'>> = {}) {
    const result = UpgradeClaimResultSchema.parse(await args.store.checkpoint({ ...fence(claim), stage, ...facts }))
    if (result.status !== 'claimed') throw new UpgradeClaimLost(result.status === 'plan_conflict' ? 'plan_conflict' : 'lost_claim')
    if (result.operation.operation_id !== args.operationId || result.lease_token !== claim.lease_token
      || result.fencing_token !== claim.fencing_token) throw new Error('Upgrade checkpoint identity is invalid')
    assertOperation(result.operation, args.operationId)
    claim = result
  }
  async function finish(outcome: Parameters<UpgradeStore['finish']>[0]['outcome'], reason?: string,
    evidence?: Parameters<UpgradeStore['finish']>[0]['evidence']): Promise<UpgradeProcessingResult> {
    const result = UpgradeFinishSchema.parse(await args.store.finish({ ...fence(claim), outcome,
      ...(reason ? { reason } : {}), ...(evidence ? { evidence } : {}) }))
    return result.status === 'attention' ? { kind: 'attention', reason: reason ?? 'provider_contract_invalid' } : { kind: result.status }
  }
  function mutation(kind: string) {
    return { operation: structuredClone(claim.operation), idempotencyKey: `pika-upgrade-${args.operationId}-${kind}`,
      async beforeMutation() { await checkpoint(claim.operation.stage); return true } }
  }
  async function read() {
    const result = UpgradeProviderEvidenceSchema.parse(await args.provider.readEvidence(claim.operation))
    const invoiceId = 'invoiceId' in result ? result.invoiceId : result.kind === 'paid' ? result.evidence.invoiceId : null
    if (invoiceId && invoiceId !== claim.operation.invoice_id) throw new Error('Upgrade invoice identity is invalid')
    return result
  }
  try {
    for (let step = 0; step < 16; step++) {
      const operation = claim.operation
      if (Date.parse(now()) >= Date.parse(operation.paid_through)) {
        if (!operation.invoice_id && ['reserved', 'preview_verified'].includes(operation.stage)) return finish('expired')
        if (!operation.invoice_id || ['payment_verified', 'change_requested'].includes(operation.stage)) {
          return finish('attention', 'paid_period_ended')
        }
        // A known unpaid invoice remains safely cleanable after renewal. Never
        // require the old provider period to stay current merely to void it.
        if (operation.stage !== 'void_requested') await checkpoint('void_requested')
        const cleanup = await read()
        if (cleanup.kind === 'attention') return finish('attention', cleanup.reason)
        if (cleanup.kind === 'voided') return finish('expired', undefined, { kind: 'voided', invoiceId: cleanup.invoiceId })
        if (cleanup.kind !== 'unpaid') return finish('attention', cleanup.kind === 'paid' ? 'paid_period_ended' : 'payment_pending_at_expiry')
        await args.provider.voidInvoice(mutation('void'))
        continue
      }
      if (operation.stage === 'reserved') {
        if (Date.parse(now()) >= Date.parse(operation.expires_at)) return finish('expired')
        const quote = UpgradeQuoteFactsSchema.parse(await args.provider.prepareQuote(operation, now()))
        if (quote.paymentState === 'zero_due') return finish('attention', 'zero_amount_upgrade')
        await checkpoint('preview_verified', { quote, quote_digest: upgradeQuoteDigest(quote) })
        continue
      }
      if (operation.stage === 'preview_verified' || operation.stage === 'invoice_requested') {
        if (operation.stage === 'preview_verified') {
          if (Date.parse(now()) >= Date.parse(operation.expires_at)) return finish('expired')
          await checkpoint('invoice_requested')
        }
        // Even after a timeout/expiry, resolve this exact idempotent request; don't forget its invoice.
        const result = await args.provider.createInvoice(mutation('invoice'))
        if (!/^in_[A-Za-z0-9]+$/.test(result.invoiceId)) throw new Error('Upgrade invoice identity is invalid')
        await checkpoint('invoice_created', { invoice_id: result.invoiceId })
        continue
      }
      if (operation.stage === 'invoice_created') {
        if (Date.parse(now()) >= Date.parse(operation.expires_at)) {
          await checkpoint('void_requested')
          continue
        }
        // Persist the invoice identity before line writes, so partial preparation is recoverable.
        await args.provider.populateInvoice(mutation('invoice'))
        await checkpoint(Date.parse(now()) >= Date.parse(claim.operation.expires_at) ? 'void_requested' : 'finalize_requested')
        continue
      }
      const evidence = await read()
      if (evidence.kind === 'attention') return finish('attention', evidence.reason)
      if (evidence.kind === 'voided') {
        if (operation.stage !== 'void_requested') await checkpoint('void_requested')
        return finish('expired', undefined, { kind: 'voided', invoiceId: evidence.invoiceId })
      }
      if (evidence.kind === 'payment_pending') return operation.stage === 'void_requested'
        ? finish('attention', 'payment_pending_at_expiry') : finish('payment_pending')
      if (evidence.kind === 'paid') {
        if (operation.stage === 'void_requested') return finish('attention', 'unexpected_payment_at_expiry')
        if (!operation.confirmed || !operation.quote || evidence.evidence.amountPaid !== operation.quote.amountDue
          || evidence.evidence.targetPriceId !== operation.target.stripe_price_id
          || evidence.evidence.subscriptionId !== operation.source_binding.stripe_subscription_id
          || evidence.evidence.currency !== operation.target.currency
          || Date.parse(evidence.evidence.paidPeriodStart) !== Date.parse(operation.paid_period_start)
          || Date.parse(evidence.evidence.paidThrough) !== Date.parse(operation.paid_through)
          || evidence.evidence.subscriptionItemId !== operation.quote.subscriptionItemId) return finish('attention', 'unexpected_payment')
        if (operation.stage !== 'payment_verified' && operation.stage !== 'change_requested') {
          if (operation.stage === 'quoted') await checkpoint('payment_requested')
          await checkpoint('payment_verified', { payment_intent_id: evidence.evidence.paymentIntentId })
        }
        if (claim.operation.stage !== 'change_requested') await checkpoint('change_requested')
        if (evidence.targetApplied) return finish('applied', undefined, evidence.evidence)
        await args.provider.applyTarget(mutation('target'))
        continue
      }
      if (Date.parse(now()) >= Date.parse(operation.expires_at)) {
        if (operation.stage !== 'void_requested') await checkpoint('void_requested')
        await args.provider.voidInvoice(mutation('void'))
        continue
      }
      if (operation.stage === 'finalize_requested') {
        if (evidence.status === 'draft') {
          await args.provider.finalizeInvoice(mutation('finalize'))
          continue
        }
        await checkpoint('quoted', { quote: evidence.quote, quote_digest: upgradeQuoteDigest(evidence.quote) })
        return finish('awaiting_confirmation')
      }
      if (!operation.quote || upgradeQuoteDigest(evidence.quote) !== upgradeQuoteDigest(operation.quote)) {
        return finish('attention', operation.confirmed ? 'confirmed_quote_changed' : 'prepared_quote_changed')
      }
      if (!operation.confirmed) return finish('awaiting_confirmation')
      if (operation.stage === 'quoted') await checkpoint('payment_requested')
      if (claim.operation.stage === 'payment_requested' && !paymentAttempted) {
        // Recover a persisted intent that may never have reached Stripe. Always
        // reuse its exact key; pending/captured evidence has already returned.
        paymentAttempted = true
        await args.provider.payInvoice(mutation('payment'))
        continue
      }
      if (operation.stage === 'payment_requested') return finish('payment_pending')
      return finish('attention', 'provider_state_conflict')
    }
    return finish('deferred', 'provider_unavailable')
  } catch (error) {
    if (error instanceof UpgradeClaimLost) return { kind: error.kind }
    if (error instanceof UpgradeProviderContractError) return finish('attention', error.reason)
    if (error instanceof z.ZodError || error instanceof UpgradeQuoteContractError) return finish('attention', 'provider_contract_invalid')
    return finish('deferred', 'provider_unavailable')
  }
}

export async function processDueUpgrades(args: { store: UpgradeStore; provider: UpgradeProvider; leaseSeconds: number; limit: number }) {
  if (args.limit !== 1) throw new Error('Upgrade batch is invalid')
  const work = UpgradeWorkSchema.parse(await args.store.list({ limit: args.limit }))
  const results = []
  for (const item of work.items) results.push(await processUpgrade({ ...args, operationId: item.operation_id }))
  return { processed: results.length, results }
}
