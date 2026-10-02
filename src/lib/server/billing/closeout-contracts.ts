import { z } from 'zod'
import { BillingSubscriptionBindingSchema, type BillingSubscriptionBinding } from './contracts'

const timestamp = z.string().datetime({ offset: true })
const reference = z.string().min(1).max(255)
export const RenewalCloseoutStageSchema = z.enum(['queued', 'pause_requested', 'collection_paused', 'void_requested', 'invoice_voided', 'cancel_requested', 'closed', 'payment_won', 'superseded', 'attention'])
export type RenewalCloseoutStage = z.infer<typeof RenewalCloseoutStageSchema>
export const RenewalCloseoutEvidenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('paid'), invoiceId: reference, periodStart: timestamp, periodEnd: timestamp,
    providerStatus: z.enum(['active', 'canceled']), cancelAtPeriodEnd: z.boolean(), terminalObligationsCleared: z.boolean() }).strict(),
  z.object({ kind: z.literal('unpaid'), invoiceId: reference, invoiceStatus: z.enum(['open', 'uncollectible']), collectionPaused: z.boolean() }).strict(),
  z.object({ kind: z.literal('payment_pending'), invoiceId: reference }).strict(),
  z.object({ kind: z.literal('invoice_voided'), invoiceId: reference, subscriptionCanceled: z.boolean(), obligationsCleared: z.boolean() }).strict(),
  z.object({ kind: z.literal('attention'), reason: z.enum(['identity_mismatch', 'unsupported_payment', 'partial_payment', 'unknown_invoice', 'incomplete_evidence', 'unexpected_money']) }).strict(),
])
export type RenewalCloseoutEvidence = z.infer<typeof RenewalCloseoutEvidenceSchema>
export type RenewalCloseoutReadRequest = {
  binding: BillingSubscriptionBinding
  invoiceId: string
  paidThrough: string
  cutoff: string
}
/** Recheck the durable lease after provider reads, immediately before the actual write. */
export type RenewalCloseoutMutationRequest = RenewalCloseoutReadRequest & { beforeMutation(): Promise<boolean> }
export type RenewalCloseoutWriteRequest = RenewalCloseoutMutationRequest & { idempotencyKey: string }
/** Every read independently verifies complete raw payment facts; normalized empty payments are insufficient. */
export type RenewalCloseoutProvider = {
  readCloseoutEvidence(input: RenewalCloseoutReadRequest): Promise<unknown>
  pauseInvoiceCollection(input: RenewalCloseoutWriteRequest): Promise<void>
  voidInvoice(input: RenewalCloseoutWriteRequest): Promise<void>
  cancelSubscription(input: RenewalCloseoutMutationRequest): Promise<void>
}
export const RenewalCloseoutClaimSchema = z.object({
  status: z.literal('claimed'), operation_id: z.string().uuid(), subscription_id: z.string().uuid(),
  lease_token: z.string().uuid(), fencing_token: z.number().int().positive(),
  lease_expires_at: timestamp, subscription_revision: z.number().int().positive(),
  expected_account_plan_revision: z.number().int().positive(), operation_revision: z.number().int().positive(),
  binding: BillingSubscriptionBindingSchema, stage: RenewalCloseoutStageSchema,
  invoice_id: reference, paid_through: timestamp, cutoff: timestamp,
}).strict()
export type RenewalCloseoutClaim = z.infer<typeof RenewalCloseoutClaimSchema>
export const RenewalCloseoutClaimResultSchema = z.union([RenewalCloseoutClaimSchema,
  z.object({ status: z.enum(['busy', 'not_found', 'plan_conflict', 'superseded']) }).strict()])
export const RenewalCloseoutCheckpointStageSchema = z.enum(['pause_requested', 'collection_paused', 'void_requested', 'invoice_voided', 'cancel_requested'])
export type RenewalCloseoutCheckpointStage = z.infer<typeof RenewalCloseoutCheckpointStageSchema>
export const RenewalCloseoutCheckpointResultSchema = z.union([RenewalCloseoutClaimSchema,
  z.object({ status: z.enum(['lost_claim', 'plan_conflict', 'superseded']) }).strict()])
export const RenewalCloseoutWorkSchema = z.object({ items: z.array(z.object({ subscription_id: z.string().uuid() }).strict()).max(1) }).strict()
export type RenewalCloseoutFence = Pick<RenewalCloseoutClaim, 'operation_id' | 'subscription_id' | 'lease_token' | 'fencing_token' | 'subscription_revision' | 'expected_account_plan_revision' | 'operation_revision'>
export type RenewalCloseoutFinishRequest = RenewalCloseoutFence & {
  outcome: 'closed' | 'payment_won' | 'deferred' | 'attention'
  reason?: string
  evidence?: RenewalCloseoutEvidence
}
export const RenewalCloseoutFinishSchema = z.object({ status: z.enum(['closed', 'payment_won', 'deferred', 'attention', 'lost_claim', 'plan_conflict', 'superseded']) }).strict()
export type RenewalCloseoutStore = {
  listDue(input: { limit: number }): Promise<unknown>
  claim(input: { subscription_id: string; lease_seconds: number }): Promise<unknown>
  checkpoint(input: RenewalCloseoutFence & { stage: RenewalCloseoutCheckpointStage }): Promise<unknown>
  finish(input: RenewalCloseoutFinishRequest): Promise<unknown>
}
