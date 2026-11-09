import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { getServiceRoleClient } from '@/lib/supabase'
import { createTargetBoundFetch } from '@/lib/server/supabase-target'
import { attemptRepoLightProvisionOutbox } from '../repolight-provision-runtime'
import type { BillingLiveCheckoutConfig } from './live-target'
import { createBillingPurchaseRuntime } from './purchase-runtime'
import { runOptionalRecoveryLane } from './recovery-lane'
import { reconcileLiveBillingSubscriptions } from './runtime'

const EXPIRY_BATCH_LIMIT = 25
const expiryResultSchema = z.object({ processed: z.number().int().min(0).max(EXPIRY_BATCH_LIMIT) }).strict()

/** The checkout, provider verification and expiry operations use separate leases. */
export async function processLiveBillingPaymentLifecycle(config: BillingLiveCheckoutConfig) {
  const client = getServiceRoleClient({ fetch: createTargetBoundFetch(config.supabaseOrigin) })
  const target = { p_project_ref: config.projectRef, p_stripe_account: config.stripeAccount }
  const ready = await client.rpc('billing_live_payment_lifecycle_ready_v1', target).abortSignal(AbortSignal.timeout(5_000))
  if (ready.error || ready.data !== true) throw new ApiError(503, 'Live billing is unavailable')

  const purchases = await runOptionalRecoveryLane(async () =>
    createBillingPurchaseRuntime(config).reconcileCheckouts({ limit: 1 }))
  const reconciliation = await runOptionalRecoveryLane(() => reconcileLiveBillingSubscriptions(config, 1))
  const expiry = await runOptionalRecoveryLane(async () => {
    const { data, error } = await client.rpc('billing_apply_due_live_paid_access_v1', {
      ...target, p_request: { limit: EXPIRY_BATCH_LIMIT },
    }).abortSignal(AbortSignal.timeout(10_000))
    if (error) throw new Error('Live paid expiry is unavailable')
    return expiryResultSchema.parse(data)
  })
  await attemptRepoLightProvisionOutbox({ client })
  return { purchases, reconciliation, expiry }
}
