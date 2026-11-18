import Stripe from 'stripe'
import { z } from 'zod'
import { getServiceRoleClient } from '@/lib/supabase'
import { createTargetBoundFetch } from '@/lib/server/supabase-target'
import type { Database, Json } from '@/types/database.generated'
import type { BillingSandboxConfig } from './config'
import type { BillingLiveCheckoutConfig } from './live-target'
import { STRIPE_BILLING_API_VERSION } from './runtime'
import { installScheduledPlanChange, type ScheduledPlanChangeInstallationStore } from './scheduled-plan-change-service'
import { createStripePlanChangePort, createStripePlanChangeProvider, stripePlanChangeOperationSchema } from './stripe-plan-change-provider'

const uuid = z.uuid()
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const replayUntil = z.iso.datetime({ offset: true })
const scheduleId = z.string().regex(/^sub_sched_[A-Za-z0-9]{1,240}$/)
const claimSchema = z.strictObject({
  fence: z.strictObject({ operationId: uuid, subscriptionId: uuid, leaseToken: uuid, fencingToken: revision,
    subscriptionRevision: revision, operationRevision: revision }),
  operation: stripePlanChangeOperationSchema.omit({ scheduleId: true }),
  installation: z.discriminatedUnion('stage', [
    z.strictObject({ stage: z.literal('confirmed') }),
    z.strictObject({ stage: z.literal('attach_requested'), replayUntil }),
    z.strictObject({ stage: z.literal('attached'), scheduleId }),
    z.strictObject({ stage: z.literal('configure_requested'), scheduleId, replayUntil }),
  ]),
}).nullable()

export function createScheduledPlanChangeRuntime(config: BillingSandboxConfig) {
  const stripe = new Stripe(config.secretKey, { apiVersion: STRIPE_BILLING_API_VERSION, timeout: 5_000, maxNetworkRetries: 0 })
  const client = getServiceRoleClient({ fetch: createTargetBoundFetch(config.supabaseOrigin) })
  const provider = createStripePlanChangeProvider(createStripePlanChangePort(stripe))

  async function command(input: Database['public']['Functions']['billing_scheduled_installation_v1']['Args']) {
    const { data, error } = await client.rpc('billing_scheduled_installation_v1', input)
    if (error) throw new Error('Scheduled billing change operation failed')
    return data
  }
  const store: ScheduledPlanChangeInstallationStore = {
    async claim(operationId) {
      return claimSchema.parse(await command({ p_operation_id: operationId, p_action: 'claim' }))
    },
    async checkpoint(fence, checkpoint) {
      return claimSchema.parse(await command({ p_operation_id: fence.operationId, p_fence: fence, p_action: checkpoint.action,
        ...('scheduleId' in checkpoint ? { p_schedule_id: checkpoint.scheduleId } : {}) }))
    },
    async finish(fence, finish) {
      return z.literal(true).nullable().parse(await command({ p_operation_id: fence.operationId, p_fence: fence, p_action: finish.outcome,
        ...('scheduleId' in finish ? { p_schedule_id: finish.scheduleId } : {}) })) === true
    },
  }
  return {
    async processDue({ limit }: { limit: number }) {
      const { data, error } = await client.rpc('billing_list_scheduled_installations_v1', {
        p_limit: limit, p_stripe_account: config.stripeAccount,
      })
      if (error) throw new Error('Scheduled billing change work is unavailable')
      const operationIds = z.array(uuid).max(limit).parse(data)
      const outcomes: Partial<Record<Awaited<ReturnType<typeof installScheduledPlanChange>>, number>> = {}
      for (const operationId of operationIds) {
        const result = await installScheduledPlanChange({ operationId, store, provider, stripeAccount: config.stripeAccount })
        outcomes[result] = (outcomes[result] ?? 0) + 1
      }
      return outcomes
    },
  }
}

const liveClaimSchema = claimSchema.unwrap().extend({
  operation: stripePlanChangeOperationSchema.omit({ scheduleId: true }).extend({
    providerMode: z.literal('live'), lastPaidInvoiceId: z.string().regex(/^in_[A-Za-z0-9]{1,240}$/),
  }),
}).nullable()

/** Constructed only for the exact configured live target; does not enable a worker. */
export function createLiveScheduledPlanChangeRuntime(config: BillingLiveCheckoutConfig) {
  const scope = z.strictObject({ providerMode: z.literal('live'), stripeAccount: z.string().regex(/^acct_[A-Za-z0-9]{1,240}$/) })
    .parse({ providerMode: config.providerMode, stripeAccount: config.stripeAccount })
  const stripe = new Stripe(config.secretKey, { apiVersion: STRIPE_BILLING_API_VERSION, timeout: 5_000, maxNetworkRetries: 0 })
  const client = getServiceRoleClient({ fetch: createTargetBoundFetch(config.supabaseOrigin) })
  const provider = createStripePlanChangeProvider(createStripePlanChangePort(stripe), Date.now, scope)
  async function rpc(name: 'billing_list_live_scheduled_installations_v1' | 'billing_live_scheduled_installation_command_v1',
    request: Json) {
    const { data, error } = await client.rpc(name, { p_project_ref: config.projectRef,
      p_stripe_account: scope.stripeAccount, p_request: request }).abortSignal(AbortSignal.timeout(5_000))
    if (error) throw new Error('Live scheduled billing change operation failed')
    return data
  }
  const store: ScheduledPlanChangeInstallationStore = {
    async claim(operationId) {
      return liveClaimSchema.parse(await rpc('billing_live_scheduled_installation_command_v1', { operation_id: operationId, action: 'claim' }))
    },
    async checkpoint(fence, checkpoint) {
      return liveClaimSchema.parse(await rpc('billing_live_scheduled_installation_command_v1', {
        operation_id: fence.operationId, fence, action: checkpoint.action,
        ...('scheduleId' in checkpoint ? { schedule_id: checkpoint.scheduleId } : {}),
      }))
    },
    async finish(fence, finish) {
      return z.literal(true).nullable().parse(await rpc('billing_live_scheduled_installation_command_v1', {
        operation_id: fence.operationId, fence, action: finish.outcome,
        ...('scheduleId' in finish ? { schedule_id: finish.scheduleId } : {}),
      })) === true
    },
  }
  return {
    async processDue({ limit }: { limit: number }) {
      const boundedLimit = z.number().int().min(1).max(5).parse(limit)
      const operationIds = z.array(uuid).max(boundedLimit).parse(await rpc('billing_list_live_scheduled_installations_v1', { limit: boundedLimit }))
      const outcomes: Partial<Record<Awaited<ReturnType<typeof installScheduledPlanChange>>, number>> = {}
      for (const operationId of operationIds) {
        const result = await installScheduledPlanChange({ operationId, store, provider, stripeAccount: scope.stripeAccount, providerMode: 'live' })
        outcomes[result] = (outcomes[result] ?? 0) + 1
      }
      return outcomes
    },
  }
}
