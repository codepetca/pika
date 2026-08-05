import { config as loadEnvironment } from 'dotenv'
import { z } from 'zod'
import { getServiceRoleClient } from '@/lib/supabase'

loadEnvironment({ path: process.env.ENV_FILE || '.env.local' })

const commandSchema = z.enum(['report', 'reconcile', 'refresh', 'activate', 'pause'])
const runSchema = z.object({
  generation: z.coerce.number().int().positive(),
  status: z.enum(['running', 'blocked', 'ready']),
  finding_count: z.coerce.number().int().nonnegative(),
  object_count: z.coerce.number().int().nonnegative(),
  reference_count: z.coerce.number().int().nonnegative(),
  inventory_digest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  completed_at: z.string().nullable(),
}).passthrough()

function requireMutationAcknowledgement(command: string) {
  const expected = `MANAGED STORAGE ${command.toUpperCase()} ${process.env.MANAGED_STORAGE_TARGET || 'UNSET'}`
  if (process.env.MANAGED_STORAGE_OPERATOR_ACKNOWLEDGEMENT !== expected) {
    throw new Error(`Mutation acknowledgement must equal: ${expected}`)
  }
}

async function main() {
  const command = commandSchema.parse(process.argv[2] || 'report')
  const supabase = getServiceRoleClient()
  if (command === 'report') {
    const response = await (supabase as any)
      .from('managed_storage_readiness_runs')
      .select('generation,status,finding_count,object_count,reference_count,inventory_digest,completed_at')
      .order('generation', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (response.error) throw new Error('managed_storage_readiness_report_failed')
    console.log(JSON.stringify(response.data ? runSchema.parse(response.data) : null, null, 2))
    return
  }

  requireMutationAcknowledgement(command)
  if (command === 'reconcile') {
    const relational = await (supabase as any).rpc(
      'reconcile_managed_storage_relational_references',
      {},
    )
    if (relational.error) throw new Error('managed_storage_relational_reconciliation_failed')
    const embedded = await (supabase as any).rpc(
      'reconcile_managed_storage_json_references',
      {},
    )
    if (embedded.error) throw new Error('managed_storage_embedded_reconciliation_failed')
    console.log(JSON.stringify({
      relational_references_bound: z.coerce.number().int().nonnegative().parse(relational.data),
      embedded_references_rebuilt: z.coerce.number().int().nonnegative().parse(embedded.data),
    }))
    return
  }
  if (command === 'refresh') {
    const response = await (supabase as any).rpc('refresh_managed_storage_readiness', {})
    if (response.error) throw new Error('managed_storage_readiness_refresh_failed')
    console.log(JSON.stringify(runSchema.parse(response.data), null, 2))
    return
  }
  if (command === 'pause') {
    const response = await (supabase as any).rpc('pause_managed_storage_enforcement', {})
    if (response.error || response.data !== true) {
      throw new Error('managed_storage_enforcement_pause_failed')
    }
    console.log(JSON.stringify({ mode: 'compatibility', readiness_invalidated: true }))
    return
  }

  const generation = z.coerce.number().int().positive().parse(process.env.MANAGED_STORAGE_READINESS_GENERATION)
  const digest = z.string().regex(/^[a-f0-9]{64}$/).parse(process.env.MANAGED_STORAGE_READINESS_DIGEST)
  const response = await (supabase as any).rpc('activate_managed_storage_enforcement', {
    p_generation: generation,
    p_inventory_digest: digest,
  })
  if (response.error || response.data !== true) {
    throw new Error('managed_storage_enforcement_activation_failed')
  }
  console.log(JSON.stringify({ mode: 'enforced', generation, inventory_digest: digest }))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'managed_storage_operator_failed')
  process.exitCode = 1
})
