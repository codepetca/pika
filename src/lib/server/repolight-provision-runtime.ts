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
  if (config.pilotMode === 'off') return { status: 'disabled' as const }
  const limit = input.limit ?? 1
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('RepoLight provisioning batch is invalid')
  if (input.teacherId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.teacherId)) throw new Error('RepoLight provisioning subject is invalid')
  // Never take a lease for a teacher outside the pilot. The existing RPC can
  // claim one exact teacher, so cron walks the bounded list without a migration.
  if (config.pilotTeacherIds && input.teacherId && !config.pilotTeacherIds.includes(input.teacherId)) {
    return { status: 'ok' as const, processed: 0, outcomes: {}, stoppedReason: 'empty' as const }
  }
  const candidates: (string | undefined)[] = input.teacherId ? [input.teacherId] : config.pilotTeacherIds ?? [undefined]
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
  const deps = { enabled: config.enabled,
    registry: createManagedRepoLightRegistry(createManagedRepoLightDatabase((name, args) =>
      db.rpc(name, args).abortSignal(rpcSignal())), { config: () => config, timeoutMs: 4_000 }),
    outbox: {
      claim: (teacherId?: string) => call('claim', teacherId ? { teacherId } : {}),
      finish: (value: { teacherId: string; leaseToken: string; outcome: string; errorCode?: string }) => call('finish', value),
    },
  }
  let processed = 0
  const outcomes: Record<string, number> = {}
  let candidateIndex = 0
  for (let i = 0; i < limit;) {
    // No parallel provider calls. A last request may consume two4s provider
    // deadlines plus a5s SQL acknowledgement; the route's60s cap has reserve.
    if (Date.now() >= deadlineAt - 10_000) return { status: 'ok' as const, processed, outcomes, stoppedReason: 'time_limit' }
    const result = await deliverRepoLightProvisionOutbox({ ...deps, teacherId: candidates[candidateIndex] })
    if (config.pilotTeacherIds && !input.teacherId) candidateIndex += 1
    if (result.status === 'empty') {
      if (config.pilotTeacherIds && !input.teacherId && candidateIndex < candidates.length) continue
      return { status: 'ok' as const, processed, outcomes, stoppedReason: 'empty' }
    }
    processed += 1
    i += 1
    outcomes[result.status] = (outcomes[result.status] ?? 0) + 1
    if (candidateIndex >= candidates.length && config.pilotTeacherIds && !input.teacherId) return { status: 'ok' as const, processed, outcomes, stoppedReason: 'empty' }
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
