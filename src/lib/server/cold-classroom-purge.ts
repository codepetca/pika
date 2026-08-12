import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  ClassroomPurgeError,
  deleteClassroomPurgeStorageObject,
  getClassroomPurgeStatus,
  shouldRequeueClassroomPurgeSafetyNet,
} from '@/lib/server/classroom-purge'
import { getServiceRoleClient } from '@/lib/supabase'
import type { ClassroomPurgeStatus } from '@/lib/validations/classroom-purge'
import {
  coldClassroomPurgeImpactSchema,
  type ColdClassroomPurgeImpact,
} from '@/lib/validations/cold-classroom-purge'

const uuidSchema = z.string().uuid()
const rpcResultSchema = z.object({
  ok: z.boolean(),
  status: z.number().int(),
  operation_id: z.string().uuid().optional(),
  operation_status: z.string().optional(),
  error_code: z.string().optional(),
  error: z.string().optional(),
  retryable: z.boolean().optional(),
}).passthrough()

const purgeObjectSchema = z.object({
  id: z.string().uuid(),
  operation_id: z.string().uuid(),
  storage_bucket: z.enum([
    'assignment-artifacts',
    'submission-images',
    'test-documents',
    'classroom-archives',
    'gradex-analytics-extracts',
  ]),
  storage_path: z.string().min(1),
  lease_token: z.string().uuid(),
}).passthrough()

const operationIdentitySchema = z.object({
  id: z.string().uuid(),
  classroom_id: z.string().uuid(),
  teacher_id: z.string().uuid(),
  purge_scope: z.literal('cold_classroom'),
  cold_archive_id: z.string().uuid(),
}).strict()

type ServiceClient = ReturnType<typeof getServiceRoleClient>
type RpcError = { code?: string; message?: string }
type UntypedClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown
    error: RpcError | null
  }>
  from(table: string): {
    select(columns: string): unknown
  }
}

function untyped(supabase: ServiceClient): UntypedClient {
  return supabase as unknown as UntypedClient
}

async function rpc(
  supabase: ServiceClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await untyped(supabase).rpc(name, args)
  if (error) {
    throw new ClassroomPurgeError(
      error.code || 'cold_classroom_purge_rpc_failed',
      error.message || 'Stored classroom deletion failed',
      error.code === 'P0002' ? 404 : 500,
      true,
    )
  }
  return data
}

function parseResult(value: unknown) {
  const result = rpcResultSchema.parse(value)
  if (!result.ok) {
    throw new ClassroomPurgeError(
      result.error_code || 'cold_classroom_purge_failed',
      result.error || 'Stored classroom deletion could not continue',
      result.status,
      result.retryable || false,
    )
  }
  return result
}

function canonicalHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

async function readOperationIdentity(
  supabase: ServiceClient,
  teacherId: string,
  operationId: string,
) {
  const query = untyped(supabase).from('classroom_purge_operations').select(
    'id,classroom_id,teacher_id,purge_scope,cold_archive_id',
  ) as {
    eq(column: string, value: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: unknown; error: RpcError | null }>
      }
    }
  }
  const response = await query
    .eq('id', operationId)
    .eq('teacher_id', teacherId)
    .maybeSingle()
  if (response.error) {
    throw new ClassroomPurgeError(
      response.error.code || 'cold_classroom_purge_read_failed',
      'Could not read stored classroom deletion',
      500,
      true,
    )
  }
  if (!response.data) {
    throw new ClassroomPurgeError(
      'cold_classroom_purge_not_found',
      'Stored classroom deletion not found',
      404,
    )
  }
  const parsed = operationIdentitySchema.safeParse(response.data)
  if (!parsed.success) {
    throw new ClassroomPurgeError(
      'cold_classroom_purge_not_found',
      'Stored classroom deletion not found',
      404,
    )
  }
  return parsed.data
}

export async function getColdClassroomPurgeImpact(
  teacherId: string,
  classroomId: string,
  archiveId: string,
): Promise<ColdClassroomPurgeImpact> {
  uuidSchema.parse(teacherId)
  uuidSchema.parse(classroomId)
  uuidSchema.parse(archiveId)
  const value = await rpc(
    getServiceRoleClient(),
    'get_cold_archived_classroom_purge_inventory',
    {
      p_teacher_id: teacherId,
      p_classroom_id: classroomId,
      p_archive_id: archiveId,
    },
  )
  const result = rpcResultSchema.parse(value)
  if (!result.ok) parseResult(result)
  const { ok: _ok, status: _status, ...impact } = result
  return coldClassroomPurgeImpactSchema.parse(impact)
}

export async function getColdClassroomPurgeStatus(
  teacherId: string,
  classroomId: string,
  archiveId: string,
  operationId: string,
): Promise<ClassroomPurgeStatus> {
  const supabase = getServiceRoleClient()
  const identity = await readOperationIdentity(supabase, teacherId, operationId)
  if (
    identity.classroom_id !== classroomId
    || identity.cold_archive_id !== archiveId
  ) {
    throw new ClassroomPurgeError(
      'cold_classroom_purge_not_found',
      'Stored classroom deletion not found',
      404,
    )
  }
  return getClassroomPurgeStatus(teacherId, operationId, 'cold_classroom')
}

export async function getActiveColdClassroomPurgeStatus(
  teacherId: string,
  classroomId: string,
  archiveId: string,
): Promise<ClassroomPurgeStatus | null> {
  const db = untyped(getServiceRoleClient())
  const query = db.from('classroom_purge_operations').select('id,cold_archive_id') as {
    eq(column: string, value: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): {
          in(column: string, values: string[]): {
            order(column: string, options: { ascending: boolean }): {
              limit(count: number): {
                maybeSingle(): PromiseLike<{ data: unknown; error: RpcError | null }>
              }
            }
          }
        }
      }
    }
  }
  const response = await query
    .eq('teacher_id', teacherId)
    .eq('classroom_id', classroomId)
    .eq('purge_scope', 'cold_classroom')
    .in('status', ['inventorying', 'deleting_objects', 'finalizing', 'failed'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (response.error) {
    throw new ClassroomPurgeError(
      response.error.code || 'cold_classroom_purge_read_failed',
      'Could not read stored classroom deletion state',
      500,
      true,
    )
  }
  if (!response.data) return null
  const row = z.object({
    id: z.string().uuid(),
    cold_archive_id: z.string().uuid(),
  }).strict().parse(response.data)
  if (row.cold_archive_id !== archiveId) {
    throw new ClassroomPurgeError(
      'cold_classroom_purge_archive_changed',
      'Stored classroom recovery identity changed',
      409,
      false,
    )
  }
  return getClassroomPurgeStatus(teacherId, row.id, 'cold_classroom')
}

export async function startColdClassroomPurge(args: {
  teacherId: string
  classroomId: string
  archiveId: string
  operationId: string
  confirmation: string
  expectedSourceRevision: number
  expectedStorageInventorySha256: string
  expectedColdResourceInventorySha256: string
}): Promise<ClassroomPurgeStatus> {
  uuidSchema.parse(args.operationId)
  const supabase = getServiceRoleClient()

  try {
    const identity = await readOperationIdentity(supabase, args.teacherId, args.operationId)
    if (
      identity.classroom_id === args.classroomId
      && identity.cold_archive_id === args.archiveId
    ) {
      return getClassroomPurgeStatus(args.teacherId, args.operationId, 'cold_classroom')
    }
  } catch (error) {
    if (!(error instanceof ClassroomPurgeError) || error.status !== 404) throw error
  }

  const impact = await getColdClassroomPurgeImpact(
    args.teacherId,
    args.classroomId,
    args.archiveId,
  )
  if (
    impact.source_revision !== args.expectedSourceRevision
    || impact.storage_inventory_sha256 !== args.expectedStorageInventorySha256
    || impact.cold_resource_inventory_sha256
      !== args.expectedColdResourceInventorySha256
  ) {
    throw new ClassroomPurgeError(
      'cold_classroom_purge_inventory_changed',
      'Stored classroom data changed after the deletion impact was shown. Review it and confirm again.',
      409,
      true,
    )
  }
  if (
    args.confirmation !== impact.classroom_title
    && args.confirmation !== 'DELETE STORED ARCHIVE'
  ) {
    throw new ClassroomPurgeError(
      'confirmation_mismatch',
      'Type the classroom name exactly, or type DELETE STORED ARCHIVE',
      400,
    )
  }
  if (!impact.deletion_available) {
    throw new ClassroomPurgeError(
      impact.conflicting_operation || 'cold_classroom_purge_disabled',
      impact.unavailable_reason || 'Stored classroom deletion is not available',
      impact.conflicting_operation ? 409 : 503,
      Boolean(impact.conflicting_operation),
    )
  }

  const requestSha256 = canonicalHash({
    classroom_id: args.classroomId,
    archive_id: args.archiveId,
    teacher_id: args.teacherId,
    source_revision: args.expectedSourceRevision,
    storage_inventory_sha256: args.expectedStorageInventorySha256,
    cold_resource_inventory_sha256: args.expectedColdResourceInventorySha256,
    intent: 'delete_cold_classroom_permanently',
  })
  parseResult(await rpc(supabase, 'begin_cold_archived_classroom_purge', {
    p_operation_id: args.operationId,
    p_teacher_id: args.teacherId,
    p_classroom_id: args.classroomId,
    p_archive_id: args.archiveId,
    p_request_sha256: requestSha256,
    p_impact_summary: impact,
  }))
  await advanceColdClassroomPurge(args.teacherId, args.operationId)
  return getClassroomPurgeStatus(args.teacherId, args.operationId, 'cold_classroom')
}

export async function advanceColdClassroomPurge(
  teacherId: string,
  operationId: string,
): Promise<{ operation: ClassroomPurgeStatus; advanced: boolean }> {
  const supabase = getServiceRoleClient()
  const leaseToken = randomUUID()
  const claimed = z.array(purgeObjectSchema).parse(await rpc(
    supabase,
    'claim_cold_classroom_purge_object',
    {
      p_operation_id: operationId,
      p_teacher_id: teacherId,
      p_lease_token: leaseToken,
      p_lease_seconds: 60,
    },
  ))
  const object = claimed[0]
  if (!object) {
    parseResult(await rpc(supabase, 'finalize_cold_archived_classroom_purge', {
      p_operation_id: operationId,
      p_teacher_id: teacherId,
    }))
    const operation = await getClassroomPurgeStatus(
      teacherId,
      operationId,
      'cold_classroom',
    )
    return { operation, advanced: operation.status === 'completed' }
  }
  try {
    await deleteClassroomPurgeStorageObject(
      supabase.storage,
      object.storage_bucket,
      object.storage_path,
    )
    const completed = z.boolean().parse(await rpc(
      supabase,
      'complete_classroom_purge_object',
      {
        p_object_id: object.id,
        p_teacher_id: teacherId,
        p_lease_token: object.lease_token,
      },
    ))
    if (!completed) throw new Error('purge_object_lease_lost')
  } catch (error) {
    await rpc(supabase, 'fail_classroom_purge_object', {
      p_object_id: object.id,
      p_teacher_id: teacherId,
      p_lease_token: object.lease_token,
      p_error_code: error instanceof Error ? error.message : 'storage_delete_failed',
    })
  }
  return {
    operation: await getClassroomPurgeStatus(
      teacherId,
      operationId,
      'cold_classroom',
    ),
    advanced: true,
  }
}

export function isMissingColdClassroomPurgeSchemaError(error: RpcError | null): boolean {
  return error?.code === 'PGRST205' || error?.code === '42P01'
}

export async function runColdClassroomPurgeSafetyNet(maxTicks = 25) {
  const db = untyped(getServiceRoleClient())
  const readiness = await (db
    .from('cold_classroom_purge_settings')
    .select('singleton') as PromiseLike<{ data: unknown; error: RpcError | null }>)
  if (readiness.error) {
    if (isMissingColdClassroomPurgeSchemaError(readiness.error)) {
      return { processed: 0, completed: 0, failed: 0 }
    }
    throw new ClassroomPurgeError(
      readiness.error.code || 'cold_classroom_purge_safety_net_readiness_failed',
      'Could not verify stored classroom deletion worker readiness',
      500,
      true,
    )
  }
  const settings = z.array(z.object({ singleton: z.literal(true) }).strict())
    .parse(readiness.data || [])
  if (settings.length !== 1) return { processed: 0, completed: 0, failed: 0 }

  const query = db.from('classroom_purge_operations').select(
    'id,teacher_id,status,retryable',
  ) as {
    eq(column: string, value: string): {
      in(column: string, values: string[]): {
        or(filters: string): {
          order(column: string, options: { ascending: boolean }): {
            limit(count: number): PromiseLike<{ data: unknown; error: RpcError | null }>
          }
        }
      }
    }
  }
  const response = await query
    .eq('purge_scope', 'cold_classroom')
    .in('status', ['deleting_objects', 'finalizing', 'failed'])
    .or('status.neq.failed,retryable.eq.true,retryable.is.null')
    .order('updated_at', { ascending: true })
    .limit(maxTicks)
  if (response.error) {
    if (isMissingColdClassroomPurgeSchemaError(response.error)) {
      return { processed: 0, completed: 0, failed: 0 }
    }
    throw new ClassroomPurgeError(
      response.error.code || 'cold_classroom_purge_safety_net_read_failed',
      'Could not read pending stored classroom deletions',
      500,
      true,
    )
  }
  const rows = z.array(z.object({
    id: z.string().uuid(),
    teacher_id: z.string().uuid(),
    status: z.enum(['deleting_objects', 'finalizing', 'failed']),
    retryable: z.boolean().nullable(),
  }).strict()).parse(response.data || [])
  const pending = rows.filter((row) => row.status !== 'failed' || row.retryable !== false)
  let processed = 0
  let completed = 0
  let failed = 0
  while (pending.length > 0 && processed < maxTicks) {
    const row = pending.shift()
    if (!row) break
    try {
      const { operation, advanced } = await advanceColdClassroomPurge(row.teacher_id, row.id)
      processed += 1
      if (operation.status === 'completed') completed += 1
      else if ((operation.storage_object_counts.failed || 0) > 0) failed += 1
      else if (shouldRequeueClassroomPurgeSafetyNet(operation, advanced)) pending.push(row)
    } catch {
      processed += 1
      failed += 1
    }
  }
  return { processed, completed, failed }
}
