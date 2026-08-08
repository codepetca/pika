import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { missingStorageObjectEvidence } from '@/lib/server/storage-object-evidence'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  courseBlueprintPurgeImpactSchema,
  courseBlueprintPurgeStatusSchema,
  type CourseBlueprintPurgeImpact,
  type CourseBlueprintPurgeStatus,
} from '@/lib/validations/course-blueprint-purge'

type RpcError = { code?: string; message?: string; details?: string }
type ServiceClient = ReturnType<typeof getServiceRoleClient>
type UntypedClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown
    error: RpcError | null
  }>
  from(table: string): {
    select(columns: string): unknown
  }
}
type PurgeStorageAdapter = {
  from(bucket: string): {
    remove(paths: string[]): PromiseLike<{ error: unknown }>
  }
}

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
const inventoryResultSchema = courseBlueprintPurgeImpactSchema.extend({
  ok: z.literal(true),
  status: z.number().int(),
}).passthrough()
const inventoryErrorSchema = z.object({
  ok: z.literal(false),
  status: z.number().int(),
  error_code: z.string().optional(),
  error: z.string().optional(),
}).passthrough()
const operationRowSchema = z.object({
  id: z.string().uuid(),
  course_blueprint_id: z.string().uuid(),
  teacher_id: z.string().uuid(),
  status: z.enum(['inventorying', 'deleting_objects', 'finalizing', 'completed', 'failed']),
  retryable: z.boolean().nullable(),
  error_code: z.string().nullable(),
  resource_counts: z.record(z.string(), z.number().int().nonnegative()),
  impact_summary: z.unknown(),
  attempt_count: z.number().int().positive(),
  completed_at: z.string().datetime({ offset: true }).nullable(),
}).strict()
const purgeObjectSchema = z.object({
  id: z.string().uuid(),
  operation_id: z.string().uuid(),
  storage_bucket: z.literal('test-documents'),
  storage_path: z.string().min(1),
  lease_token: z.string().uuid(),
}).passthrough()

export class CourseBlueprintPurgeError extends ApiError {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable = false,
  ) {
    super(status, message)
    this.name = 'CourseBlueprintPurgeError'
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
    if (isMissingCourseBlueprintPurgeSchemaError(error)) {
      throw new CourseBlueprintPurgeError(
        'course_blueprint_purge_unavailable',
        'Permanent Course Blueprint deletion is not available yet',
        503,
      )
    }
    throw new CourseBlueprintPurgeError(
      error.code || 'course_blueprint_purge_rpc_failed',
      error.message || 'Permanent Course Blueprint deletion failed',
      error.code === 'P0002' ? 404 : 500,
      true,
    )
  }
  return data
}

async function getCourseBlueprintPurgeOperationRow(
  teacherId: string,
  operationId: string,
): Promise<z.infer<typeof operationRowSchema> | null> {
  uuidSchema.parse(operationId)
  const db = untyped(getServiceRoleClient())
  const query = db.from('course_blueprint_purge_operations').select(
    'id,course_blueprint_id,teacher_id,status,retryable,error_code,resource_counts,attempt_count,completed_at,impact_summary',
  ) as {
    eq(column: string, value: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: unknown; error: RpcError | null }>
      }
    }
  }
  const response = await query.eq('id', operationId).eq('teacher_id', teacherId).maybeSingle()
  if (response.error) {
    if (isMissingCourseBlueprintPurgeSchemaError(response.error)) {
      throw new CourseBlueprintPurgeError(
        'course_blueprint_purge_unavailable',
        'Permanent Course Blueprint deletion is not available yet',
        503,
      )
    }
    throw new CourseBlueprintPurgeError(
      response.error.code || 'course_blueprint_purge_read_failed',
      'Could not read permanent deletion',
      500,
      true,
    )
  }
  return response.data ? operationRowSchema.parse(response.data) : null
}

function persistedImpact(
  operation: z.infer<typeof operationRowSchema>,
): CourseBlueprintPurgeImpact {
  return courseBlueprintPurgeImpactSchema.parse(operation.impact_summary)
}

function parseResult(value: unknown) {
  const result = rpcResultSchema.parse(value)
  if (!result.ok) {
    throw new CourseBlueprintPurgeError(
      result.error_code || 'course_blueprint_purge_failed',
      result.error || 'Permanent deletion could not continue',
      result.status,
      result.retryable || false,
    )
  }
  return result
}

function canonicalHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function getCourseBlueprintPurgeImpact(
  teacherId: string,
  courseBlueprintId: string,
): Promise<CourseBlueprintPurgeImpact> {
  uuidSchema.parse(teacherId)
  uuidSchema.parse(courseBlueprintId)
  const value = await rpc(
    getServiceRoleClient(),
    'get_course_blueprint_purge_inventory',
    { p_teacher_id: teacherId, p_blueprint_id: courseBlueprintId },
  )
  const parsed = z.union([inventoryResultSchema, inventoryErrorSchema]).parse(value)
  if (!parsed.ok) {
    throw new CourseBlueprintPurgeError(
      parsed.error_code || 'course_blueprint_purge_inventory_failed',
      parsed.error || 'Could not prepare permanent deletion',
      parsed.status,
      parsed.status >= 500,
    )
  }
  const { ok: _ok, status: _status, ...impact } = parsed
  return courseBlueprintPurgeImpactSchema.parse(impact)
}

export async function startCourseBlueprintPurge(args: {
  teacherId: string
  courseBlueprintId: string
  operationId: string
  confirmation: string
  expectedSourceRevision: number
  expectedInventorySha256: string
}): Promise<CourseBlueprintPurgeStatus> {
  uuidSchema.parse(args.operationId)
  const existing = await getCourseBlueprintPurgeOperationRow(
    args.teacherId,
    args.operationId,
  )
  if (existing && existing.course_blueprint_id !== args.courseBlueprintId) {
    throw new CourseBlueprintPurgeError(
      'idempotency_conflict',
      'Deletion request was already used for another Course Blueprint',
      409,
    )
  }
  if (existing?.status === 'completed') {
    return getCourseBlueprintPurgeStatus(args.teacherId, args.operationId)
  }
  const impact = existing
    ? persistedImpact(existing)
    : await getCourseBlueprintPurgeImpact(args.teacherId, args.courseBlueprintId)
  if (impact.source_revision !== args.expectedSourceRevision
    || impact.inventory_sha256 !== args.expectedInventorySha256) {
    throw new CourseBlueprintPurgeError(
      'course_blueprint_purge_inventory_changed',
      'Course Blueprint data changed after the deletion impact was shown. Review it and confirm again.',
      409,
      true,
    )
  }
  if (args.confirmation !== 'DELETE'
    && args.confirmation !== impact.course_blueprint_title) {
    throw new CourseBlueprintPurgeError(
      'confirmation_mismatch',
      'Type the Course Blueprint name exactly, or type DELETE',
      400,
    )
  }
  if (!impact.deletion_available) {
    throw new CourseBlueprintPurgeError(
      impact.conflicting_operation || 'course_blueprint_purge_disabled',
      impact.unavailable_reason || 'Permanent deletion is not available',
      impact.conflicting_operation ? 409 : 503,
      Boolean(impact.conflicting_operation),
    )
  }
  const requestSha256 = canonicalHash({
    course_blueprint_id: args.courseBlueprintId,
    teacher_id: args.teacherId,
    source_revision: args.expectedSourceRevision,
    inventory_sha256: args.expectedInventorySha256,
    intent: 'delete_course_blueprint_permanently',
  })
  parseResult(await rpc(getServiceRoleClient(), 'begin_course_blueprint_purge', {
    p_operation_id: args.operationId,
    p_teacher_id: args.teacherId,
    p_course_blueprint_id: args.courseBlueprintId,
    p_request_sha256: requestSha256,
    p_impact_summary: impact,
  }))
  await advanceCourseBlueprintPurge(args.teacherId, args.operationId)
  return getCourseBlueprintPurgeStatus(args.teacherId, args.operationId)
}

export async function getCourseBlueprintPurgeStatus(
  teacherId: string,
  operationId: string,
): Promise<CourseBlueprintPurgeStatus> {
  const operation = await getCourseBlueprintPurgeOperationRow(teacherId, operationId)
  if (!operation) {
    throw new CourseBlueprintPurgeError(
      'course_blueprint_purge_not_found',
      'Permanent deletion not found',
      404,
    )
  }
  const db = untyped(getServiceRoleClient())
  const objectQuery = db.from('course_blueprint_purge_objects').select('status') as {
    eq(column: string, value: string): PromiseLike<{
      data: unknown
      error: RpcError | null
    }>
  }
  const objects = await objectQuery.eq('operation_id', operationId)
  if (objects.error) {
    if (isMissingCourseBlueprintPurgeSchemaError(objects.error)) {
      throw new CourseBlueprintPurgeError(
        'course_blueprint_purge_unavailable',
        'Permanent Course Blueprint deletion is not available yet',
        503,
      )
    }
    throw new CourseBlueprintPurgeError(
      objects.error.code || 'course_blueprint_purge_read_failed',
      'Could not read permanent deletion progress',
      500,
      true,
    )
  }
  const counts: Record<string, number> = {}
  for (const row of z.array(z.object({ status: z.string() })).parse(objects.data || [])) {
    counts[row.status] = (counts[row.status] || 0) + 1
  }
  return courseBlueprintPurgeStatusSchema.parse({
    operation_id: operation.id,
    course_blueprint_id: operation.course_blueprint_id,
    status: operation.status,
    retryable: operation.retryable,
    error_code: operation.error_code,
    attempt_count: operation.attempt_count,
    resource_counts: operation.resource_counts,
    storage_object_counts: counts,
    completed_at: operation.completed_at,
  })
}

export async function getActiveCourseBlueprintPurgeStatus(
  teacherId: string,
  courseBlueprintId: string,
): Promise<CourseBlueprintPurgeStatus | null> {
  const db = untyped(getServiceRoleClient())
  const query = db.from('course_blueprint_purge_operations').select('id') as {
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
  const response = await query.eq('teacher_id', teacherId)
    .eq('course_blueprint_id', courseBlueprintId)
    .in('status', ['inventorying', 'deleting_objects', 'finalizing', 'failed'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (response.error) {
    if (isMissingCourseBlueprintPurgeSchemaError(response.error)) {
      throw new CourseBlueprintPurgeError(
        'course_blueprint_purge_unavailable',
        'Permanent Course Blueprint deletion is not available yet',
        503,
      )
    }
    throw new CourseBlueprintPurgeError(
      response.error.code || 'course_blueprint_purge_read_failed',
      'Could not read permanent deletion state',
      500,
      true,
    )
  }
  if (!response.data) return null
  const id = z.object({ id: z.string().uuid() }).parse(response.data).id
  return getCourseBlueprintPurgeStatus(teacherId, id)
}

export async function getCourseBlueprintPurgeImpactForOperation(
  teacherId: string,
  courseBlueprintId: string,
  operationId: string,
): Promise<CourseBlueprintPurgeImpact> {
  const operation = await getCourseBlueprintPurgeOperationRow(teacherId, operationId)
  if (!operation || operation.course_blueprint_id !== courseBlueprintId) {
    throw new CourseBlueprintPurgeError(
      'course_blueprint_purge_not_found',
      'Permanent deletion not found',
      404,
    )
  }
  return persistedImpact(operation)
}

export async function deleteCourseBlueprintPurgeStorageObject(
  storage: PurgeStorageAdapter,
  bucket: 'test-documents',
  path: string,
): Promise<void> {
  const removal = await storage.from(bucket).remove([path])
  if (removal.error && !missingStorageObjectEvidence(removal.error)) {
    throw removal.error
  }
}

export async function advanceCourseBlueprintPurge(
  teacherId: string,
  operationId: string,
): Promise<{ operation: CourseBlueprintPurgeStatus; advanced: boolean }> {
  const supabase = getServiceRoleClient()
  const leaseToken = randomUUID()
  const claimed = z.array(purgeObjectSchema).parse(await rpc(
    supabase,
    'claim_course_blueprint_purge_object',
    {
      p_operation_id: operationId,
      p_teacher_id: teacherId,
      p_lease_token: leaseToken,
      p_lease_seconds: 60,
    },
  ))
  const object = claimed[0]
  if (!object) {
    parseResult(await rpc(supabase, 'finalize_course_blueprint_purge', {
      p_operation_id: operationId,
      p_teacher_id: teacherId,
    }))
    const operation = await getCourseBlueprintPurgeStatus(teacherId, operationId)
    return { operation, advanced: operation.status === 'completed' }
  }
  try {
    await deleteCourseBlueprintPurgeStorageObject(
      supabase.storage,
      object.storage_bucket,
      object.storage_path,
    )
    const completed = z.boolean().parse(await rpc(
      supabase,
      'complete_course_blueprint_purge_object',
      {
        p_object_id: object.id,
        p_teacher_id: teacherId,
        p_lease_token: object.lease_token,
      },
    ))
    if (!completed) throw new Error('course_blueprint_purge_object_lease_lost')
  } catch (error) {
    await rpc(supabase, 'fail_course_blueprint_purge_object', {
      p_object_id: object.id,
      p_teacher_id: teacherId,
      p_lease_token: object.lease_token,
      p_error_code: error instanceof Error ? error.message : 'storage_delete_failed',
    })
  }
  return {
    operation: await getCourseBlueprintPurgeStatus(teacherId, operationId),
    advanced: true,
  }
}

export function isMissingCourseBlueprintPurgeSchemaError(
  error: RpcError | null,
): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883'
    || error?.code === 'PGRST205' || error?.code === '42P01'
}

export async function runCourseBlueprintPurgeSafetyNet(maxTicks = 25) {
  const db = untyped(getServiceRoleClient())
  const readiness = await (db.from('course_blueprint_purge_settings')
    .select('singleton,rollout_mode') as PromiseLike<{
      data: unknown
      error: RpcError | null
    }>)
  if (readiness.error) {
    if (isMissingCourseBlueprintPurgeSchemaError(readiness.error)) {
      return { processed: 0, completed: 0, failed: 0 }
    }
    throw new CourseBlueprintPurgeError(
      readiness.error.code || 'course_blueprint_purge_safety_net_readiness_failed',
      'Could not verify permanent deletion worker readiness',
      500,
      true,
    )
  }
  const settings = z.array(z.object({
    singleton: z.literal(true),
    rollout_mode: z.enum(['disabled', 'canary', 'enabled']),
  }).strict()).parse(readiness.data || [])
  if (settings.length !== 1 || settings[0].rollout_mode === 'disabled') {
    return { processed: 0, completed: 0, failed: 0 }
  }

  const query = db.from('course_blueprint_purge_operations')
    .select('id,teacher_id,status,retryable') as {
      in(column: string, values: string[]): {
        order(column: string, options: { ascending: boolean }): {
          limit(count: number): PromiseLike<{ data: unknown; error: RpcError | null }>
        }
      }
    }
  const response = await query
    .in('status', ['deleting_objects', 'finalizing', 'failed'])
    .order('updated_at', { ascending: true })
    .limit(maxTicks)
  if (response.error) {
    if (isMissingCourseBlueprintPurgeSchemaError(response.error)) {
      return { processed: 0, completed: 0, failed: 0 }
    }
    throw new CourseBlueprintPurgeError(
      response.error.code || 'course_blueprint_purge_safety_net_read_failed',
      'Could not read pending Course Blueprint deletions',
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
      const result = await advanceCourseBlueprintPurge(row.teacher_id, row.id)
      processed += 1
      if (result.operation.status === 'completed') completed += 1
      else if (result.operation.status === 'failed') failed += 1
      else if (result.advanced) pending.push(row)
    } catch {
      processed += 1
      failed += 1
    }
  }
  return { processed, completed, failed }
}
