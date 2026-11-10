import { NextResponse } from 'next/server'
import { ApiError } from '@/lib/api-handler'
import { REPOLIGHT_CATALOG_RELEASE_TAG } from '@/lib/billing/launch-catalog'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { createTargetBoundFetch } from '@/lib/server/supabase-target'
import { readBillingPurchaseConfig } from './purchase-config'
import { createScheduledPlanChangeHandlers } from './scheduled-plan-change-handlers'
import { readBillingLiveScheduledChangeConfig } from './live-target'
import { listLaunchPurchaseCatalog } from './purchase-catalog'

function configuration() {
  const live = readBillingLiveScheduledChangeConfig()
  if (live) return live
  if (process.env.BILLING_SCHEDULED_CHANGES_ENABLED !== 'true' || process.env.BILLING_SCHEDULED_RENEWALS_ENABLED !== 'true') return null
  return readBillingPurchaseConfig()
}

function scheduledChangeContext() {
  const config = configuration()
  if (!config) throw new Error('Billing scheduled change is unavailable')
  return {
    config,
    client: getServiceRoleClient({ fetch: createTargetBoundFetch(config.supabaseOrigin) }),
  }
}

async function assertLiveSchedulingReady(client: ReturnType<typeof getServiceRoleClient>, target: {
  p_project_ref: string; p_stripe_account: string
}) {
  const { data, error } = await client.rpc('billing_live_scheduled_customer_ready_v1', target).abortSignal(AbortSignal.timeout(5_000))
  if (error || data !== true) throw new ApiError(409, 'Scheduled plan changes are unavailable.')
}

function result(response: { data: unknown; error: { code: string; message: string } | null }) {
  if (!response.error) return response.data
  if (['55000', '23505'].includes(response.error.code)
    && /^billing_(?:live_)?scheduled_change/.test(response.error.message)) {
    throw new ApiError(409, 'This scheduled plan change is unavailable. Refresh billing and try again.')
  }
  throw new Error('Billing scheduled change operation failed')
}

export const scheduledPlanChangeHandlers = createScheduledPlanChangeHandlers({
  configuration,
  authenticate: () => requireRole('teacher'),
  async reserve(subject, operation, offering) {
    const { client, config } = scheduledChangeContext()
    if ('projectRef' in config) {
      const target = { p_project_ref: config.projectRef, p_stripe_account: config.stripeAccount }
      return result(await client.rpc('billing_reserve_live_scheduled_plan_change_v1', { ...target, p_request: {
        subject_user_id: subject, operation_id: operation, target_offering_version_id: offering,
      } }).abortSignal(AbortSignal.timeout(5_000)))
    }
    return result(await client.rpc('billing_reserve_scheduled_plan_change_v1', {
      p_subject_user_id: subject, p_operation_id: operation, p_target_offering_version_id: offering, p_stripe_account: config.stripeAccount,
    }))
  },
  async confirm(subject, operation) {
    const { client, config } = scheduledChangeContext()
    if ('projectRef' in config) {
      const target = { p_project_ref: config.projectRef, p_stripe_account: config.stripeAccount }
      return result(await client.rpc('billing_confirm_live_scheduled_plan_change_v1', { ...target, p_request: {
        subject_user_id: subject, operation_id: operation,
      } }).abortSignal(AbortSignal.timeout(5_000)))
    }
    return result(await client.rpc('billing_confirm_scheduled_plan_change_v1', {
      p_subject_user_id: subject, p_operation_id: operation, p_stripe_account: config.stripeAccount,
    }))
  },
})

export async function getLiveScheduledChangeOffers() {
  const config = readBillingLiveScheduledChangeConfig()
  if (!config) throw new ApiError(404, 'Not found')
  await requireRole('teacher')
  const client = getServiceRoleClient({ fetch: createTargetBoundFetch(config.supabaseOrigin) })
  const target = { p_project_ref: config.projectRef, p_stripe_account: config.stripeAccount }
  await assertLiveSchedulingReady(client, target)
  const offers = await listLaunchPurchaseCatalog({
    stripeAccount: config.stripeAccount, providerMode: 'live', release: REPOLIGHT_CATALOG_RELEASE_TAG,
    async listOfferings() {
      const { data, error } = await client.rpc('billing_list_live_checkout_offerings_v1', {
        ...target, p_request: { stripe_account: config.stripeAccount },
      }).abortSignal(AbortSignal.timeout(5_000))
      if (error) throw new Error('Scheduled plan change offers are unavailable')
      return data
    },
  })
  return NextResponse.json({ items: offers.filter(offer => offer.plan === 'pro') })
}
