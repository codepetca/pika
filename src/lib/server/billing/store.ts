import { z } from 'zod'
import type { Json } from '@/types/database.generated'
import type { BillingStore } from '@/lib/server/billing/synchronize'
import type { BillingEventReceipt } from '@/lib/server/billing/webhook'

type BillingRpcName =
  | 'billing_record_event_v1'
  | 'billing_claim_subscription_v1'
  | 'billing_finish_subscription_v1'
  | 'billing_list_work_v1'

/** Narrow transport seam; the runtime supplies the generated Supabase client. */
export type BillingRpcClient = {
  rpc(name: BillingRpcName, args: { p_request: Json }): PromiseLike<{
    data: unknown
    error: unknown
  }>
}

const billingEventReceiptResultSchema = z.object({
  status: z.enum(['accepted', 'duplicate']),
  event_inbox_id: z.string().uuid(),
}).strict()

export function createBillingStore(client: BillingRpcClient): BillingStore & {
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
    finishSubscription: request => call('billing_finish_subscription_v1', request),
    listWork: request => call('billing_list_work_v1', request),
    async recordEvent(receipt) {
      const result = billingEventReceiptResultSchema.safeParse(
        await call('billing_record_event_v1', receipt),
      )
      if (!result.success) throw new Error('Billing event receipt could not be confirmed')
      return result.data
    },
  }
}
