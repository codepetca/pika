import { getServiceRoleClient } from '@/lib/supabase'
import { createManagedRepoLightRegistry, parseManagedRepoLightConfig } from './repolight-managed'
import { createManagedRepoLightDatabase } from './repolight-managed-database'
import { deliverRepoLightProvisionOutbox } from './repolight-provision-outbox'

/** Disabled before creating a client or reading key material. The DB has its
 * separate off-by-default gate; neither gate enables billing or RepoLight AI. */
export async function drainRepoLightProvisionOutbox(input: {
  client?: ReturnType<typeof getServiceRoleClient>
  teacherId?: string
  limit?: number
} = {}) {
  if (process.env.PIKA_REPOLIGHT_MANAGED_ENABLED !== 'true') return { status: 'disabled' as const }
  const config = parseManagedRepoLightConfig()
  const limit = input.limit ?? 1
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('RepoLight provisioning batch is invalid')
  const db = input.client ?? getServiceRoleClient()
  const deadlineAt = Date.now() + 40_000
  const deliverySignal = AbortSignal.timeout(40_000)
  const rpcSignal = () => AbortSignal.any([deliverySignal, AbortSignal.timeout(5_000)])
  async function call(action: string, payload: { [key: string]: string } = {}) {
    // Reserve a short acknowledgement budget after the delivery deadline.
    const { data, error } = await db.rpc('repolight_provision_outbox_v1', { p_action: action, p_payload: payload })
      .abortSignal(action === 'finish' ? AbortSignal.timeout(5_000) : rpcSignal())
    if (error) throw new Error('RepoLight provisioning outbox is unavailable')
    return data
  }
  const deps = { enabled: config.enabled, teacherId: input.teacherId,
    registry: createManagedRepoLightRegistry(createManagedRepoLightDatabase((name, args) =>
      db.rpc(name, args).abortSignal(rpcSignal())), { config: () => config, timeoutMs: 4_000 }),
    outbox: {
      claim: (teacherId?: string) => call('claim', teacherId ? { teacherId } : {}),
      finish: (value: { teacherId: string; leaseToken: string; outcome: string; errorCode?: string }) => call('finish', value),
    },
  }
  let processed = 0
  const outcomes: Record<string, number> = {}
  for (let i = 0; i < limit; i += 1) {
    // No parallel provider calls. A last request may consume two4s provider
    // deadlines plus a5s SQL acknowledgement; the route's60s cap has reserve.
    if (Date.now() >= deadlineAt - 10_000) return { status: 'ok' as const, processed, outcomes, stoppedReason: 'time_limit' }
    const result = await deliverRepoLightProvisionOutbox(deps)
    if (result.status === 'empty') return { status: 'ok' as const, processed, outcomes, stoppedReason: 'empty' }
    processed += 1
    outcomes[result.status] = (outcomes[result.status] ?? 0) + 1
  }
  return { status: 'ok' as const, processed, outcomes, stoppedReason: 'batch_limit' }
}

/** Billing has committed before this best-effort kick. Provisioning failures
 * cannot change the successful purchase/trial response; durable cron recovery
 * can reclaim a killed worker without allocating another provider operation. */
export async function attemptRepoLightProvisionOutbox(input: Parameters<typeof drainRepoLightProvisionOutbox>[0] = {}) {
  try { return await drainRepoLightProvisionOutbox(input) }
  catch { return { status: 'pending' as const } }
}
