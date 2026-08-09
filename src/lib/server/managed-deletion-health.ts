import { z } from 'zod'
import { getServiceRoleClient } from '@/lib/supabase'

const MIN_STUCK_AFTER_SECONDS = 300
const MAX_STUCK_AFTER_SECONDS = 604_800
const DEFAULT_STUCK_AFTER_SECONDS = 3_600

const countSchema = z.number().int().nonnegative()

const operationHealthSchema = z.object({
  terminal_failures: countSchema,
  stale_operations: countSchema,
  stale_partial_operations: countSchema,
  expired_object_leases: countSchema,
  due_failed_objects: countSchema,
  fences_without_active_operation: countSchema,
  active_operations_without_fence: countSchema,
  deleted_objects_reappeared: countSchema,
}).strict()

const managedStorageHealthSchema = z.object({
  unregistered_storage_objects: countSchema,
  registered_objects_missing_storage: countSchema,
  referenced_objects_not_ready: countSchema,
  raw_references_missing_identity: countSchema,
  relational_identity_mismatches: countSchema,
  embedded_hosts_missing_registry: countSchema,
  embedded_ownership_mismatches: countSchema,
  objects_without_durable_owner: countSchema,
  settled_provisional_objects: countSchema,
  ready_objects_unreferenced: countSchema,
  expired_reservations: countSchema,
  expired_provisional_owners: countSchema,
  stale_cleanup_pending: countSchema,
  expired_cleanup_leases: countSchema,
}).strict()

export const managedDeletionHealthSnapshotSchema = z.object({
  version: z.literal(1),
  generated_at: z.string().datetime({ offset: true }),
  stuck_after_seconds: z.number().int().min(MIN_STUCK_AFTER_SECONDS)
    .max(MAX_STUCK_AFTER_SECONDS),
  healthy: z.boolean(),
  critical_count: countSchema,
  warning_count: countSchema,
  operations: z.object({
    classroom: operationHealthSchema,
    course_blueprint: operationHealthSchema,
  }).strict(),
  managed_storage: managedStorageHealthSchema,
}).strict()

export type ManagedDeletionHealthSnapshot = z.infer<
  typeof managedDeletionHealthSnapshotSchema
>

type RpcError = { code?: string; message?: string }
type HealthClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown
    error: RpcError | null
  }>
}

export type ManagedDeletionHealthResult =
  | { schemaAvailable: false }
  | { schemaAvailable: true; snapshot: ManagedDeletionHealthSnapshot }

export class ManagedDeletionHealthError extends Error {
  constructor(public readonly code: string) {
    super('Managed deletion health could not be verified')
    this.name = 'ManagedDeletionHealthError'
  }
}

function isMissingSchemaError(error: RpcError): boolean {
  return error.code === 'PGRST202'
    || error.code === 'PGRST205'
    || error.code === '42883'
    || error.code === '42P01'
}

function healthClient(value: ReturnType<typeof getServiceRoleClient>): HealthClient {
  return value as unknown as HealthClient
}

export async function readManagedDeletionHealth(input: {
  supabase?: ReturnType<typeof getServiceRoleClient>
  stuckAfterSeconds?: number
} = {}): Promise<ManagedDeletionHealthResult> {
  const stuckAfterSeconds = input.stuckAfterSeconds ?? DEFAULT_STUCK_AFTER_SECONDS
  if (
    !Number.isSafeInteger(stuckAfterSeconds)
    || stuckAfterSeconds < MIN_STUCK_AFTER_SECONDS
    || stuckAfterSeconds > MAX_STUCK_AFTER_SECONDS
  ) {
    throw new ManagedDeletionHealthError('managed_deletion_health_threshold_invalid')
  }

  const supabase = input.supabase ?? getServiceRoleClient()
  const { data, error } = await healthClient(supabase).rpc(
    'get_managed_deletion_health_snapshot',
    { p_stuck_after_seconds: stuckAfterSeconds },
  )

  if (error) {
    if (isMissingSchemaError(error)) {
      console.warn('[managed-deletion-health] schema unavailable', {
        error_code: error.code ?? 'unknown',
      })
      return { schemaAvailable: false }
    }
    throw new ManagedDeletionHealthError('managed_deletion_health_query_failed')
  }

  const parsed = managedDeletionHealthSnapshotSchema.safeParse(data)
  if (!parsed.success) {
    throw new ManagedDeletionHealthError('managed_deletion_health_contract_invalid')
  }

  console.info('[managed-deletion-health] snapshot', {
    healthy: parsed.data.healthy,
    critical_count: parsed.data.critical_count,
    warning_count: parsed.data.warning_count,
  })
  return { schemaAvailable: true, snapshot: parsed.data }
}
