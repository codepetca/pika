import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import type { Json } from '@/types/database.generated'
import { getServiceRoleClient } from '@/lib/supabase'
import { createTargetBoundFetch } from '@/lib/server/supabase-target'
import type { BillingLiveCheckoutConfig } from './live-target'
import { createBillingStripeClient, createStripeBillingReadPort } from './runtime'
import { createStripeBillingProvider } from './stripe-provider'
import { createStripePlanChangePort, createLiveScheduledCancellationProvider } from './stripe-plan-change-provider'
import { cancellationClaimSchema, processScheduledCancellation, type CancellationStore } from './scheduled-cancellation-service'

type RpcName = 'billing_get_live_scheduled_cancellation_v1' | 'billing_request_live_scheduled_cancellation_v1'
  | 'billing_list_live_scheduled_cancellations_v1' | 'billing_live_scheduled_cancellation_command_v1'
export function createLiveScheduledCancellationRpc(config: BillingLiveCheckoutConfig) {
  z.strictObject({ providerMode: z.literal('live'), stripeAccount: z.string().regex(/^acct_[A-Za-z0-9]{1,240}$/) })
    .parse({ providerMode: config.providerMode, stripeAccount: config.stripeAccount })
  const client = getServiceRoleClient({ fetch: createTargetBoundFetch(config.supabaseOrigin) })
  return async (name: RpcName, request: Json) => {
    const result = await client.rpc(name, { p_project_ref: config.projectRef, p_stripe_account: config.stripeAccount,
      p_request: request }).abortSignal(AbortSignal.timeout(5_000))
    if (result.error) {
      if (name === 'billing_request_live_scheduled_cancellation_v1'
        && ['55000', '23505'].includes(result.error.code)
        && result.error.message.startsWith('billing_scheduled_cancellation_')) {
        throw new ApiError(409, 'This cancellation is unavailable. Refresh billing and try again.')
      }
      throw new Error('Live scheduled cancellation operation failed')
    }
    return result.data
  }
}
export async function processLiveScheduledCancellations(config: BillingLiveCheckoutConfig, limit = 1) {
  const count = z.number().int().min(1).max(5).parse(limit)
  const rpc = createLiveScheduledCancellationRpc(config)
  const scope = { providerMode: config.providerMode, stripeAccount: config.stripeAccount }
  const stripe = createBillingStripeClient(config.secretKey)
  const provider = createLiveScheduledCancellationProvider(createStripePlanChangePort(stripe), scope)
  const reader = createStripeBillingProvider(createStripeBillingReadPort(stripe), scope)
  const store: CancellationStore = {
    async claim(id) { return cancellationClaimSchema.nullable().parse(await rpc('billing_live_scheduled_cancellation_command_v1', { operation_id: id, action: 'claim' })) },
    async authorize(fence) { return cancellationClaimSchema.nullable().parse(await rpc('billing_live_scheduled_cancellation_command_v1', { operation_id: fence.operationId, action: 'authorize_write', fence })) },
    async finish(fence, outcome, evidence) {
      return z.literal(true).nullable().parse(await rpc('billing_live_scheduled_cancellation_command_v1', {
        operation_id: fence.operationId, action: 'finish', fence, outcome, ...(evidence ? { evidence } : {}),
      })) === true
    },
  }
  const ids = z.array(z.uuid()).max(count).parse(await rpc('billing_list_live_scheduled_cancellations_v1', { limit: count }))
  const outcomes: Record<string, number> = {}
  for (const id of ids) {
    const result = await processScheduledCancellation({ id, stripeAccount: config.stripeAccount, store, provider,
      retrieveSubscription: binding => reader.retrieveSubscription(binding) })
    outcomes[result] = (outcomes[result] ?? 0) + 1
  }
  return outcomes
}
