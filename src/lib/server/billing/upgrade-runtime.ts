import Stripe from 'stripe'
import { z } from 'zod'
import { getServiceRoleClient } from '@/lib/supabase'
import { createTargetBoundFetch } from '@/lib/server/supabase-target'
import { publicBillingUpgradeSchema, type PublicBillingUpgrade } from '@/lib/validations/billing-upgrades'
import { STRIPE_BILLING_API_VERSION } from './runtime'
import { readBillingPurchaseConfig, type BillingPurchaseConfig } from './purchase-config'
import { createBillingUpgradeStore } from './upgrade-store'
import { createStripeUpgradePort, createStripeUpgradeProvider } from './stripe-upgrade-provider'
import { processUpgrade, processDueUpgrades, upgradeQuoteDigest } from './upgrade-service'
import { UpgradeOperationSchema, UpgradeConfirmationError, UpgradeEligibilityError,
  type UpgradeOperation, type UpgradeProvider, type UpgradeStore } from './upgrade-contracts'

export function readBillingUpgradeConfig(env: NodeJS.ProcessEnv = process.env): BillingPurchaseConfig | null {
  if (env.BILLING_UPGRADES_ENABLED !== 'true') return null
  return readBillingPurchaseConfig(env)
}

const envelopeSchema = z.union([
  z.object({ status: z.enum(['reserved', 'existing', 'found', 'confirmed']), operation: UpgradeOperationSchema }).strict(),
  z.object({ status: z.enum(['plan_conflict', 'busy', 'not_found', 'expired', 'rejected']) }).strict(),
])
function envelope(value: unknown) {
  const parsed = envelopeSchema.safeParse(value)
  if (!parsed.success) throw new Error('Billing upgrade database result is invalid')
  return parsed.data
}
const publicPlan = { basic: 'basic', plus: 'pro', pro: 'max' } as const

/** Application facade shared by authenticated routes and the separately gated worker. */
export function createUpgradeApplication(input: { store: UpgradeStore; provider: UpgradeProvider; stripeAccount: string; now?: () => number }) {
  const { store, provider } = input
  const now = input.now ?? Date.now
  function owned(operation: UpgradeOperation, subjectUserId: string, operationId: string) {
    const quote = operation.quote
    if (operation.operation_id !== operationId || operation.subject_user_id !== subjectUserId
      || operation.source_binding.subject_user_id !== subjectUserId
      || operation.source_binding.subscription_id !== operation.subscription_id
      || operation.source_binding.stripe_account !== input.stripeAccount || operation.target.stripe_account !== input.stripeAccount
      || (quote && (upgradeQuoteDigest(quote.binding) !== upgradeQuoteDigest(operation.source_binding)
        || upgradeQuoteDigest(quote.target) !== upgradeQuoteDigest(operation.target)
        || Date.parse(quote.paidPeriodStart) !== Date.parse(operation.paid_period_start)
        || Date.parse(quote.paidThrough) !== Date.parse(operation.paid_through)
        || Date.parse(quote.expiresAt) !== Date.parse(operation.expires_at)))
      || (operation.quote_digest && (!quote || operation.quote_digest !== upgradeQuoteDigest(quote)))
      || (operation.stage === 'quoted' && (!quote || !operation.quote_digest || !operation.quote_revision || !operation.invoice_id))
      || (operation.status === 'applied' && (operation.stage !== 'applied' || !operation.confirmed
        || !operation.invoice_id || !operation.payment_intent_id || !quote || !operation.quote_digest || !operation.quote_revision))) {
      throw new Error('Billing upgrade operation is invalid')
    }
    return operation
  }
  function project(operation: UpgradeOperation): PublicBillingUpgrade {
    let status: PublicBillingUpgrade['status'] = 'pending'
    if (operation.status === 'applied') status = 'active'
    else if (operation.status === 'attention') status = 'attention'
    else if (operation.status === 'expired') status = 'expired'
    else if (operation.confirmed && ['payment_verified', 'change_requested'].includes(operation.stage)) status = 'synchronizing'
    else if (operation.confirmed) status = 'payment_pending'
    else if (Date.parse(operation.expires_at) <= now()) status = 'expired'
    else if (operation.stage === 'quoted') status = 'quoted'
    const quote = operation.quote
    const result = publicBillingUpgradeSchema.safeParse({ operationId: operation.operation_id, status,
      quote: status === 'quoted' && quote ? {
        plan: publicPlan[operation.target.plan_key], currency: quote.currency,
        unusedCreditAmount: quote.unusedCreditAmount, remainingChargeAmount: quote.remainingChargeAmount, amountDue: quote.amountDue,
        nextRenewalAt: quote.paidThrough, nextRecurringAmount: quote.nextRecurringAmount,
        expiresAt: quote.expiresAt, quoteRevision: operation.quote_revision, quoteDigest: operation.quote_digest,
      } : null,
    })
    if (!result.success) throw new Error('Billing upgrade response is invalid')
    return result.data
  }
  async function get(subjectUserId: string, operationId: string) {
    const result = envelope(await store.get({ subject_user_id: subjectUserId, operation_id: operationId }))
    if (result.status === 'not_found') return null
    if (!('operation' in result) || result.status !== 'found') throw new Error('Billing upgrade database result is invalid')
    return owned(result.operation, subjectUserId, operationId)
  }
  const process = (operationId: string) => processUpgrade({ store, provider, operationId, leaseSeconds: 120,
    now: () => new Date(now()).toISOString() })
  return {
    async startUpgrade(args: { subjectUserId: string; operationId: string; offeringVersionId: string }) {
      const result = envelope(await store.reserve({ subject_user_id: args.subjectUserId,
        operation_id: args.operationId, offering_version_id: args.offeringVersionId }))
      if (result.status === 'not_found') return null
      if (!('operation' in result)) throw new UpgradeEligibilityError()
      if (!['reserved', 'existing'].includes(result.status)) throw new Error('Billing upgrade database result is invalid')
      const operation = owned(result.operation, args.subjectUserId, args.operationId)
      if (operation.target.offering_version_id !== args.offeringVersionId) throw new UpgradeEligibilityError()
      if (!['applied', 'expired', 'attention'].includes(operation.status) && operation.stage !== 'quoted') await process(args.operationId)
      const current = await get(args.subjectUserId, args.operationId)
      if (!current) throw new Error('Billing upgrade reservation is unavailable')
      return project(current)
    },
    async confirmUpgrade(args: { subjectUserId: string; operationId: string; quoteRevision: number; quoteDigest: string }) {
      const operation = await get(args.subjectUserId, args.operationId)
      if (!operation) return null
      if (operation.quote_revision !== args.quoteRevision || operation.quote_digest !== args.quoteDigest) throw new UpgradeConfirmationError()
      if (!operation.confirmed && Date.parse(operation.expires_at) <= now()) throw new UpgradeConfirmationError()
      const result = envelope(await store.confirm({ subject_user_id: args.subjectUserId, operation_id: args.operationId,
        quote_revision: args.quoteRevision, quote_digest: args.quoteDigest }))
      if (result.status === 'not_found') return null
      if (!('operation' in result)) throw new UpgradeConfirmationError()
      if (!['confirmed', 'existing'].includes(result.status)) throw new Error('Billing upgrade database result is invalid')
      const confirmed = owned(result.operation, args.subjectUserId, args.operationId)
      if (!confirmed.confirmed) throw new Error('Billing upgrade operation is invalid')
      if (confirmed.quote_revision !== args.quoteRevision || confirmed.quote_digest !== args.quoteDigest) throw new UpgradeConfirmationError()
      if (!['applied', 'expired', 'attention'].includes(confirmed.status)) await process(args.operationId)
      const current = await get(args.subjectUserId, args.operationId)
      if (!current) throw new Error('Billing upgrade confirmation is unavailable')
      return project(current)
    },
    async getUpgrade(args: { subjectUserId: string; operationId: string }) {
      const operation = await get(args.subjectUserId, args.operationId)
      return operation ? project(operation) : null
    },
    processDue: (args: { limit: number }) => processDueUpgrades({ store, provider, leaseSeconds: 120, limit: args.limit }),
  }
}

/** Called after feature configuration and request authorization pass. No cast hides missing RPC types. */
export function createBillingUpgradeRuntime(config: BillingPurchaseConfig) {
  const stripe = new Stripe(config.secretKey, { apiVersion: STRIPE_BILLING_API_VERSION, timeout: 5_000, maxNetworkRetries: 0 })
  const client = getServiceRoleClient({ fetch: createTargetBoundFetch(config.supabaseOrigin) })
  return createUpgradeApplication({ store: createBillingUpgradeStore(client),
    provider: createStripeUpgradeProvider(createStripeUpgradePort(stripe)), stripeAccount: config.stripeAccount })
}
