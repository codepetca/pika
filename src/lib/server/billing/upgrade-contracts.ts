import { z } from 'zod'
import { BillingSubscriptionBindingSchema } from './contracts'
import { CheckoutOfferingSchema } from './checkout-contracts'
import { UpgradeQuoteFactsSchema } from './upgrade-quote-contracts'

const uuid = z.string().uuid()
const instant = z.string().datetime({ offset: true })
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
export const UpgradeStageSchema = z.enum(['reserved', 'preview_verified', 'invoice_requested', 'invoice_created',
  'finalize_requested', 'quoted', 'payment_requested', 'payment_verified', 'change_requested', 'applied', 'void_requested', 'expired'])
export const UpgradeOperationSchema = z.object({
  operation_id: uuid, subject_user_id: uuid, subscription_id: uuid,
  source_binding: BillingSubscriptionBindingSchema, target: CheckoutOfferingSchema,
  stage: UpgradeStageSchema, status: z.enum(['queued', 'retry', 'attention', 'applied', 'expired']), revision,
  paid_period_start: instant, paid_through: instant, last_paid_invoice_id: z.string().regex(/^in_[A-Za-z0-9]+$/),
  expires_at: instant, quote: UpgradeQuoteFactsSchema.nullable(), quote_digest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  quote_revision: revision.nullable(), invoice_id: z.string().regex(/^in_[A-Za-z0-9]+$/).nullable(),
  payment_intent_id: z.string().regex(/^pi_[A-Za-z0-9]+$/).nullable(), confirmed: z.boolean(),
}).strict()
export type UpgradeOperation = z.infer<typeof UpgradeOperationSchema>
export const UpgradeClaimSchema = z.object({
  status: z.literal('claimed'), operation: UpgradeOperationSchema,
  lease_token: uuid, fencing_token: revision, lease_expires_at: instant,
  subscription_revision: revision, expected_account_plan_revision: revision,
  expected_access_revision: revision, expected_entitlement_revision: revision,
}).strict()
export type UpgradeClaim = z.infer<typeof UpgradeClaimSchema>
export const UpgradeClaimResultSchema = z.union([UpgradeClaimSchema,
  z.object({ status: z.enum(['busy', 'not_found', 'plan_conflict', 'lost_claim']) }).strict()])
export type UpgradeFence = {
  operation_id: string; subscription_id: string; lease_token: string; fencing_token: number
  subscription_revision: number; expected_account_plan_revision: number
  expected_access_revision: number; expected_entitlement_revision: number; operation_revision: number
}
export const UpgradeFinishSchema = z.object({
  status: z.enum(['applied', 'deferred', 'awaiting_confirmation', 'payment_pending', 'attention', 'expired', 'lost_claim', 'plan_conflict']),
}).strict()
export const UpgradeWorkSchema = z.object({ items: z.array(z.object({ operation_id: uuid }).strict()).max(1) }).strict()
export type UpgradeStore = {
  reserve(input: { subject_user_id: string; operation_id: string; offering_version_id: string }): Promise<unknown>
  get(input: { subject_user_id: string; operation_id: string }): Promise<unknown>
  list(input: { limit: number }): Promise<unknown>
  claim(input: { operation_id: string; lease_seconds: number }): Promise<unknown>
  checkpoint(input: UpgradeFence & { stage: z.infer<typeof UpgradeStageSchema>; quote?: z.infer<typeof UpgradeQuoteFactsSchema>
    invoice_id?: string; quote_digest?: string; payment_intent_id?: string }): Promise<unknown>
  confirm(input: { subject_user_id: string; operation_id: string; quote_revision: number; quote_digest: string }): Promise<unknown>
  finish(input: UpgradeFence & { outcome: 'applied' | 'deferred' | 'awaiting_confirmation' | 'payment_pending' | 'attention' | 'expired'; reason?: string
    evidence?: UpgradePaidEvidence | { kind: 'voided'; invoiceId: string } }): Promise<unknown>
  getApplied(input: { subscription_id: string }): Promise<unknown>
}
export const UpgradePaidEvidenceSchema = z.object({
  invoiceId: z.string().regex(/^in_[A-Za-z0-9]+$/), paymentIntentId: z.string().regex(/^pi_[A-Za-z0-9]+$/),
  subscriptionId: z.string().regex(/^sub_[A-Za-z0-9]+$/), paymentState: z.literal('paid'), providerStatus: z.literal('active'),
  amountPaid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), currency: z.enum(['usd', 'cad']),
  subscriptionItemId: z.string().regex(/^si_[A-Za-z0-9]+$/), targetPriceId: z.string().regex(/^price_[A-Za-z0-9]+$/),
  paidPeriodStart: instant, paidThrough: instant,
}).strict()
export type UpgradePaidEvidence = z.infer<typeof UpgradePaidEvidenceSchema>

export const UpgradeProviderEvidenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unpaid'), invoiceId: z.string().regex(/^in_[A-Za-z0-9]+$/), status: z.enum(['draft', 'open']),
    quote: UpgradeQuoteFactsSchema }).strict(),
  z.object({ kind: z.literal('payment_pending'), invoiceId: z.string().regex(/^in_[A-Za-z0-9]+$/) }).strict(),
  z.object({ kind: z.literal('paid'), evidence: UpgradePaidEvidenceSchema, targetApplied: z.boolean() }).strict(),
  z.object({ kind: z.literal('voided'), invoiceId: z.string().regex(/^in_[A-Za-z0-9]+$/) }).strict(),
  z.object({ kind: z.literal('attention'), reason: z.string().regex(/^[a-z][a-z0-9._-]{0,99}$/) }).strict(),
])
export type UpgradeProviderEvidence = z.infer<typeof UpgradeProviderEvidenceSchema>
/** Read-only receipt observation is separate from evidence that can authorize an upgrade write. */
export const AppliedUpgradeProviderEvidenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('paid'), targetApplied: z.literal(true),
    evidence: UpgradePaidEvidenceSchema.extend({ providerStatus: z.enum(['active', 'canceled']) }),
    cancelAt: instant.nullable(), cancelAtPeriodEnd: z.boolean(), terminalObligationsCleared: z.boolean(),
  }).strict().refine(value => value.evidence.providerStatus === 'canceled' || !value.terminalObligationsCleared,
    { message: 'Active subscriptions cannot have cleared terminal obligations' }),
  z.object({ kind: z.literal('attention'), reason: z.string().regex(/^[a-z][a-z0-9._-]{0,99}$/) }).strict(),
])
export type AppliedUpgradeProviderEvidence = z.infer<typeof AppliedUpgradeProviderEvidenceSchema>
export type UpgradeMutation = { operation: UpgradeOperation; idempotencyKey: string; beforeMutation(): Promise<boolean> }
export type UpgradeProvider = {
  /** Never accepts a browser quote or amount. The provider reconstructs the stored operation. */
  prepareQuote(operation: UpgradeOperation, now: string): Promise<unknown>
  createInvoice(input: UpgradeMutation): Promise<{ invoiceId: string }>
  populateInvoice(input: UpgradeMutation): Promise<void>
  finalizeInvoice(input: UpgradeMutation): Promise<void>
  readEvidence(operation: UpgradeOperation): Promise<unknown>
  payInvoice(input: UpgradeMutation): Promise<void>
  applyTarget(input: UpgradeMutation): Promise<void>
  voidInvoice(input: UpgradeMutation): Promise<void>
}
export type AppliedUpgradeProvider = UpgradeProvider & {
  /** Observes only a durable, confirmed applied receipt; never authorizes a mutation. */
  readAppliedEvidence(operation: UpgradeOperation): Promise<AppliedUpgradeProviderEvidence>
}

export class UpgradeEligibilityError extends Error {
  constructor() { super('This subscription cannot currently be upgraded') }
}
export class UpgradeConfirmationError extends Error {
  constructor() { super('The upgrade quote changed or expired; request a fresh quote') }
}
export class UpgradeProviderContractError extends Error {
  constructor(readonly reason: string = 'incomplete_evidence') { super('Upgrade provider contract is invalid') }
}
