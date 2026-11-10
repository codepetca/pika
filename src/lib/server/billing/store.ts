import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import type { Json } from '@/types/database.generated'
import type { BillingStore } from '@/lib/server/billing/synchronize'
import type { BillingEventReceipt } from '@/lib/server/billing/webhook'

type BillingRpcName =
  | 'billing_record_event_v1'
  | 'billing_claim_subscription_v1'
  | 'billing_finish_lifecycle_v1'
  | 'billing_list_work_v1'
  | 'billing_get_applied_upgrade_v1'
  | 'billing_get_scheduled_renewal_v1'
  | 'billing_finish_scheduled_renewal_v1'

/** Narrow transport seam; the runtime supplies the generated Supabase client. */
export type BillingRpcClient = {
  rpc(name: BillingRpcName, args: { p_request: Json }): PromiseLike<{
    data: unknown
    error: unknown
  }>
}

type LiveBillingRpcName = 'billing_list_live_work_v1' | 'billing_claim_live_subscription_v1' | 'billing_finish_live_lifecycle_v1'
  | 'billing_get_live_scheduled_renewal_v1' | 'billing_finish_live_scheduled_renewal_v1'
export type LiveBillingRpcClient = {
  rpc(name: LiveBillingRpcName, args: { p_project_ref: string; p_stripe_account: string; p_request: Json }):
    PromiseLike<{ data: unknown; error: unknown }>
}

export function createLiveBillingStore(client: LiveBillingRpcClient, target: {
  projectRef: string; stripeAccount: string
}): BillingStore {
  async function call(name: LiveBillingRpcName, payload: Json) {
    const { data, error } = await client.rpc(name, {
      p_project_ref: target.projectRef, p_stripe_account: target.stripeAccount, p_request: payload,
    })
    if (error) throw new Error('Live billing database operation failed')
    return data
  }
  return {
    listWork: request => call('billing_list_live_work_v1', request),
    claimSubscription: request => call('billing_claim_live_subscription_v1', request),
    finishSubscription: request => call('billing_finish_live_lifecycle_v1', request),
    getScheduledRenewal: request => call('billing_get_live_scheduled_renewal_v1', request),
    finishScheduledRenewal: request => call('billing_finish_live_scheduled_renewal_v1', request),
  }
}

const billingEventReceiptResultSchema = z.object({
  status: z.enum(['accepted', 'duplicate']),
  event_inbox_id: z.string().uuid(),
}).strict()

export async function recordLiveBillingEvent(input: {
  receipt: BillingEventReceipt
  target: { projectRef: string; stripeAccount: string }
  record: (args: { p_project_ref: string; p_request: Json }) => PromiseLike<{
    data: unknown; error: { code: string } | null
  }>
}) {
  const { receipt, target, record } = input
  if (receipt.provider_mode !== 'live' || receipt.stripe_account !== target.stripeAccount) {
    throw new Error('Live billing receipt scope mismatch')
  }
  const { data, error } = await record({ p_project_ref: target.projectRef, p_request: receipt })
  if (error?.code === '55000') throw new ApiError(503, 'Live billing webhook is unavailable')
  if (error?.code === '23505') throw new ApiError(409, 'Stripe event conflicts with an existing receipt')
  if (error) throw new Error('Live billing receipt could not be recorded')
  const result = billingEventReceiptResultSchema.safeParse(data)
  if (!result.success) throw new Error('Billing event receipt could not be confirmed')
  return result.data
}

export function createBillingStore(client: BillingRpcClient, scheduledRenewalsEnabled = false): BillingStore & {
  recordEvent(receipt: BillingEventReceipt): Promise<z.infer<typeof billingEventReceiptResultSchema>>
} {
  async function call(name: BillingRpcName, request: Json): Promise<unknown> {
    const { data, error } = await client.rpc(name, { p_request: request })
    // Provider/database error text can contain identifiers or sensitive details.
    if (error) throw new Error('Billing database operation failed')
    return data
  }
  return {
    claimSubscription: request => call('billing_claim_subscription_v1', request),
    finishSubscription: request => call('billing_finish_lifecycle_v1', request),
    listWork: request => call('billing_list_work_v1', request),
    getAppliedUpgrade: request => call('billing_get_applied_upgrade_v1', request),
    ...(scheduledRenewalsEnabled ? {
      getScheduledRenewal: request => call('billing_get_scheduled_renewal_v1', request),
      finishScheduledRenewal: request => call('billing_finish_scheduled_renewal_v1', request),
    } : {}),
    async recordEvent(receipt) {
      if (receipt.provider_mode === 'live') throw new Error('Live billing events require a scoped store')
      const result = billingEventReceiptResultSchema.safeParse(
        await call('billing_record_event_v1', receipt),
      )
      if (!result.success) throw new Error('Billing event receipt could not be confirmed')
      return result.data
    },
  }
}
