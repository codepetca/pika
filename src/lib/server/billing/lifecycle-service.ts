import { z } from 'zod'
import { BillingAccessStatusSchema, type BillingAccessStatus } from './lifecycle-contracts'

export class BillingLifecycleEligibilityError extends Error {
  readonly code = 'billing_trial_ineligible'
  constructor() { super('This account is not eligible to start a trial.') }
}
export type BillingLifecycleStore = {
  startTrial(input: { subject_user_id: string; operation_id: string }): Promise<unknown>
  getAccessStatus(input: { subject_user_id: string }): Promise<unknown>
  applyDueAccess(input: { limit: number }): Promise<unknown>
}
function status(raw: unknown, subjectUserId: string): BillingAccessStatus {
  const parsed = BillingAccessStatusSchema.safeParse(raw)
  if (!parsed.success || parsed.data.subject_user_id !== subjectUserId) throw new Error('Billing access status is unavailable')
  return parsed.data
}
export async function startBillingTrial(args: { store: BillingLifecycleStore; subjectUserId: string; operationId: string }): Promise<BillingAccessStatus> {
  const subject_user_id = z.string().uuid().parse(args.subjectUserId)
  const operation_id = z.string().uuid().parse(args.operationId)
  return status(await args.store.startTrial({ subject_user_id, operation_id }), subject_user_id)
}
export async function getBillingAccessStatus(args: { store: BillingLifecycleStore; subjectUserId: string }): Promise<BillingAccessStatus> {
  const subject_user_id = z.string().uuid().parse(args.subjectUserId)
  return status(await args.store.getAccessStatus({ subject_user_id }), subject_user_id)
}
export async function applyDueBillingAccess(args: { store: BillingLifecycleStore; limit: number }): Promise<{ processed: number }> {
  const limit = z.number().int().min(1).max(100).parse(args.limit)
  return z.object({ processed: z.number().int().min(0).max(limit) }).strict().parse(await args.store.applyDueAccess({ limit }))
}
