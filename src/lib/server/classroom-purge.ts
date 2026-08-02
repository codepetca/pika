import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { CLASSROOM_RELATIONAL_RESOURCES } from '@/lib/contracts/classroom-data'
import {
  createSupabaseClassroomArchiveInventoryReader,
  readClassroomArchiveResourceGraph,
} from '@/lib/server/classroom-archive-inventory'
import { missingStorageObjectEvidence } from '@/lib/server/storage-object-evidence'
import { loadChunkedRows } from '@/lib/server/query-chunks'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  classroomPurgeImpactSchema,
  classroomPurgeStatusSchema,
  type ClassroomPurgeImpact,
  type ClassroomPurgeStatus,
} from '@/lib/validations/classroom-purge'

const uuidSchema = z.string().uuid()
const purgeRpcResultSchema = z.object({
  ok: z.boolean(),
  status: z.number().int(),
  operation_id: z.string().uuid().optional(),
  operation_status: z.string().optional(),
  source_revision: z.number().int().positive().optional(),
  error_code: z.string().optional(),
  error: z.string().optional(),
  retryable: z.boolean().optional(),
}).passthrough()

const purgeOperationRowSchema = z.object({
  id: z.string().uuid(),
  classroom_id: z.string().uuid(),
  teacher_id: z.string().uuid(),
  status: z.enum(['inventorying', 'deleting_objects', 'finalizing', 'completed', 'failed']),
  retryable: z.boolean().nullable(),
  error_code: z.string().nullable(),
  resource_counts: z.record(z.string(), z.number().int().nonnegative()),
  attempt_count: z.number().int().positive(),
  completed_at: z.string().datetime({ offset: true }).nullable(),
}).strict()

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

const managedStorageObjectRowSchema = z.object({
  id: z.string().uuid(),
  storage_bucket: z.enum([
    'assignment-artifacts',
    'submission-images',
    'test-documents',
    'classroom-archives',
    'gradex-analytics-extracts',
  ]),
  storage_path: z.string().min(1),
  byte_size: z.coerce.number().int().nonnegative().nullable(),
  status: z.enum([
    'pending_upload',
    'ready',
    'cleanup_pending',
    'cleanup_processing',
    'purging',
  ]),
  purpose: z.enum([
    'student_assignment_artifact',
    'student_inline_image',
    'teacher_test_material',
    'test_execution_snapshot',
    'legacy_classroom_file',
    'classroom_archive',
    'gradex_extract',
  ]),
}).strict()

const storageCoverageRowSchema = z.object({
  status: z.enum(['pending', 'verified', 'blocked']),
  inventory_version: z.number().int().positive(),
  inventory_sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).strict()

const affectedUserRowSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.string(),
}).strict()

const managedStorageSettingsSchema = z.object({
  enforce_ownership: z.boolean(),
  hot_classroom_purge_enabled: z.boolean(),
}).strict()

type PurgeStorageBucket = z.infer<typeof purgeObjectSchema>['storage_bucket']
type ServiceClient = ReturnType<typeof getServiceRoleClient>
type RpcError = { code?: string; message?: string; details?: string; hint?: string }
type UntypedClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError | null }>
  from(table: string): {
    select(columns: string, options?: { count?: 'exact'; head?: boolean }): unknown
  }
}

type PurgeStorageAdapter = {
  from(bucket: string): {
    remove(paths: string[]): PromiseLike<{ error: unknown }>
  }
}

type Inventory = {
  impact: ClassroomPurgeImpact
}

type ManagedInventoryCoverageSnapshot = z.infer<typeof storageCoverageRowSchema>

export function isStableManagedInventoryCoverage(
  before: ManagedInventoryCoverageSnapshot,
  after: ManagedInventoryCoverageSnapshot,
): boolean {
  return before.status === after.status
    && before.inventory_version === after.inventory_version
    && before.inventory_sha256 === after.inventory_sha256
}

export function countClassroomStudents(
  resources: Record<string, Array<Record<string, unknown>>>,
  affectedUsers: Array<{ id: string; email: string; role: string }> = [],
): number {
  const knownStudentIds = new Set<string>()
  const ambiguousActorIds = new Set<string>()
  for (const rows of Object.values(resources)) {
    for (const row of rows) {
      if (typeof row.student_id === 'string') knownStudentIds.add(row.student_id)
    }
  }
  for (const row of resources.announcement_reads || []) {
    if (typeof row.user_id === 'string') ambiguousActorIds.add(row.user_id)
  }
  for (const row of resources.classroom_retired_assessment_record_actors || []) {
    if (row.source_column === 'student_id' && typeof row.actor_id === 'string') {
      knownStudentIds.add(row.actor_id)
    }
  }

  const studentEmails = new Set<string>()
  for (const user of affectedUsers) {
    if (knownStudentIds.has(user.id) || (
      ambiguousActorIds.has(user.id) && user.role === 'student'
    )) {
      knownStudentIds.add(user.id)
      studentEmails.add(user.email.trim().toLowerCase())
    }
  }
  const unmatchedRosterEmails = new Set<string>()
  for (const row of resources.classroom_roster || []) {
    if (typeof row.email !== 'string') continue
    const email = row.email.trim().toLowerCase()
    if (email && !studentEmails.has(email)) unmatchedRosterEmails.add(email)
  }
  return knownStudentIds.size + unmatchedRosterEmails.size
}

function collectAffectedUserIds(
  resources: Record<string, Array<Record<string, unknown>>>,
): string[] {
  const ids = new Set<string>()
  for (const rows of Object.values(resources)) {
    for (const row of rows) {
      if (typeof row.student_id === 'string') ids.add(row.student_id)
    }
  }
  for (const row of resources.announcement_reads || []) {
    if (typeof row.user_id === 'string') ids.add(row.user_id)
  }
  for (const row of resources.classroom_retired_assessment_record_actors || []) {
    if (row.source_column === 'student_id' && typeof row.actor_id === 'string') {
      ids.add(row.actor_id)
    }
  }
  return [...ids]
}

export class ClassroomPurgeError extends ApiError {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable = false,
  ) {
    super(status, message)
    this.name = 'ClassroomPurgeError'
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
      error.code || 'purge_rpc_failed',
      error.message || 'Permanent deletion operation failed',
      error.code === 'P0002' ? 404 : 500,
      true,
    )
  }
  return data
}

function requireSupabaseInventoryConfiguration() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!supabaseUrl || !secretKey) {
    throw new Error('Missing Supabase inventory environment variables')
  }
  return { supabaseUrl, secretKey }
}

function canonicalRequestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

async function readClassroomRoot(
  supabase: ServiceClient,
  teacherId: string,
  classroomId: string,
) {
  const { data, error } = await supabase
    .from('classrooms')
    .select('id,title,teacher_id,archived_at')
    .eq('id', classroomId)
    .eq('teacher_id', teacherId)
    .maybeSingle()
  if (error) throw new ClassroomPurgeError(error.code, 'Could not read classroom', 500, true)
  if (!data) throw new ClassroomPurgeError('classroom_not_found', 'Classroom not found', 404)
  if (!data.archived_at) {
    throw new ClassroomPurgeError(
      'classroom_not_hot_archived',
      'Only archived classrooms stored in Pika can be permanently deleted',
      409,
    )
  }

  const { count: tombstoneCount, error: tombstoneError } = await supabase
    .from('classroom_cold_tombstones')
    .select('*', { count: 'exact', head: true })
    .eq('classroom_id', classroomId)
  if (tombstoneError) {
    throw new ClassroomPurgeError(tombstoneError.code, 'Could not read classroom state', 500, true)
  }
  if ((tombstoneCount || 0) > 0) {
    throw new ClassroomPurgeError(
      'classroom_is_cold_archived',
      'Stored classroom deletion is not available yet',
      409,
    )
  }
  return data
}

async function readStableInventory(
  supabase: ServiceClient,
  teacherId: string,
  classroomId: string,
): Promise<Inventory> {
  const classroom = await readClassroomRoot(supabase, teacherId, classroomId)
  const { supabaseUrl, secretKey } = requireSupabaseInventoryConfiguration()
  const reader = createSupabaseClassroomArchiveInventoryReader({
    supabase,
    supabaseUrl,
    secretKey,
  })

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const sourceRevision = z.number().int().positive().parse(
      await reader.readRevision(classroomId),
    )
    const resources = await readClassroomArchiveResourceGraph(reader, classroomId)
    // Bracket the registry read with its trigger-maintained digest. Parallel
    // reads could otherwise pair pre-change objects with a post-change digest
    // and bind confirmation to a file set the teacher was not shown.
    const coverageBeforeResult = await (supabase as any)
      .from('classroom_managed_storage_coverage')
      .select('status,inventory_version,inventory_sha256')
      .eq('classroom_id', classroomId)
      .maybeSingle()
    if (coverageBeforeResult.error) {
      throw new ClassroomPurgeError(
        coverageBeforeResult.error.code || 'managed_storage_coverage_failed',
        'Could not verify classroom file ownership',
        500,
        true,
      )
    }
    const coverageBefore = storageCoverageRowSchema.parse(
      coverageBeforeResult.data || {
        status: 'pending', inventory_version: 1, inventory_sha256: null,
      },
    )
    const [managedResult, settingsResult] = await Promise.all([
      (supabase as any)
        .from('managed_storage_objects')
        .select('id,storage_bucket,storage_path,byte_size,status,purpose')
        .eq('classroom_id', classroomId),
      (supabase as any)
        .from('managed_storage_settings')
        .select('enforce_ownership,hot_classroom_purge_enabled')
        .eq('singleton', true)
        .single(),
    ])
    if (managedResult.error) {
      throw new ClassroomPurgeError(
        managedResult.error.code || 'managed_storage_inventory_failed',
        'Could not inventory classroom files',
        500,
        true,
      )
    }
    if (settingsResult.error) {
      throw new ClassroomPurgeError(
        settingsResult.error.code || 'managed_storage_settings_failed',
        'Permanent deletion is not available yet',
        503,
        true,
      )
    }
    const managedObjects = z.array(managedStorageObjectRowSchema).parse(
      managedResult.data || [],
    )
    const settings = managedStorageSettingsSchema.parse(settingsResult.data)
    const objects = managedObjects.map((object) => ({
      bucket: object.storage_bucket as PurgeStorageBucket,
      path: object.storage_path,
    }))
    const sizes = await Promise.all(managedObjects.map(async (object) => {
      const value = await reader.readStorageObjectSize(
        object.storage_bucket,
        object.storage_path,
      )
      if (value === null) return null
      return z.number().int().nonnegative().parse(value)
    }))
    const [revisionAfterValue, coverageAfterResult] = await Promise.all([
      reader.readRevision(classroomId),
      (supabase as any)
        .from('classroom_managed_storage_coverage')
        .select('status,inventory_version,inventory_sha256')
        .eq('classroom_id', classroomId)
        .maybeSingle(),
    ])
    if (coverageAfterResult.error) {
      throw new ClassroomPurgeError(
        coverageAfterResult.error.code || 'managed_storage_coverage_failed',
        'Could not verify classroom file ownership',
        500,
        true,
      )
    }
    const revisionAfter = z.number().int().positive().parse(revisionAfterValue)
    const coverageAfter = storageCoverageRowSchema.parse(
      coverageAfterResult.data || {
        status: 'pending', inventory_version: 1, inventory_sha256: null,
      },
    )
    if (
      sourceRevision !== revisionAfter
      || !isStableManagedInventoryCoverage(coverageBefore, coverageAfter)
    ) continue

    const affectedUserIds = collectAffectedUserIds(resources)
    const affectedUsersResult = await loadChunkedRows<unknown>({
      supabase,
      table: 'users',
      select: 'id,email,role',
      filters: [{ column: 'id', values: affectedUserIds }],
    })
    if (affectedUsersResult.error) {
      throw new ClassroomPurgeError(
        affectedUsersResult.error.code || 'classroom_student_inventory_failed',
        'Could not inventory affected students',
        500,
        true,
      )
    }
    const affectedUsers = z.array(affectedUserRowSchema).parse(affectedUsersResult.rows)

    const resourceCounts = Object.fromEntries(
      CLASSROOM_RELATIONAL_RESOURCES.map((resource) => [
        resource.table,
        (resources[resource.table] || []).length,
      ]),
    )
    const storageCounts: Record<string, number> = {}
    for (const object of objects) {
      storageCounts[object.bucket] = (storageCounts[object.bucket] || 0) + 1
    }
    const conflict = z.string().nullable().parse(
      await rpc(supabase, 'classroom_purge_conflict', {
        p_classroom_id: classroomId,
      }),
    )
    const impact = classroomPurgeImpactSchema.parse({
      classroom_id: classroomId,
      classroom_title: classroom.title,
      source_revision: sourceRevision,
      storage_inventory_version: coverageAfter.inventory_version,
      storage_inventory_sha256: coverageAfter.inventory_sha256,
      relational_row_count: Object.values(resourceCounts)
        .reduce((total, count) => total + count, 0),
      student_count: countClassroomStudents(resources, affectedUsers),
      managed_file_count: objects.length,
      managed_file_bytes: sizes.reduce<number>(
        (total, size) => total + (size || 0),
        0,
      ),
      missing_file_count: sizes.filter((size) => size === null).length,
      archive_count: managedObjects.filter((object) =>
        object.storage_bucket === 'classroom-archives'
          && object.purpose === 'classroom_archive'
          && object.status === 'ready',
      ).length,
      gradex_extract_count: managedObjects.filter((object) =>
        object.storage_bucket === 'gradex-analytics-extracts'
          && object.purpose === 'gradex_extract'
          && object.status === 'ready',
      ).length,
      resource_counts: resourceCounts,
      storage_counts: storageCounts,
      conflicting_operation: conflict,
      ownership_coverage_status: coverageAfter.status,
      deletion_available:
        coverageAfter.status === 'verified'
        && settings.enforce_ownership
        && settings.hot_classroom_purge_enabled
        && conflict === null,
      unavailable_reason: coverageAfter.status !== 'verified'
        ? 'Classroom file ownership must be reconciled before deletion.'
        : !settings.enforce_ownership
          ? 'Managed file ownership enforcement is not enabled.'
          : !settings.hot_classroom_purge_enabled
            ? 'Permanent classroom deletion is not enabled.'
            : conflict
              ? 'Finish the active classroom operation before deleting permanently.'
              : null,
    })
    return { impact }
  }
  throw new ClassroomPurgeError(
    'classroom_inventory_unstable',
    'Classroom data changed while preparing permanent deletion',
    409,
    true,
  )
}

export async function getClassroomPurgeImpact(
  teacherId: string,
  classroomId: string,
): Promise<ClassroomPurgeImpact> {
  return (await readStableInventory(getServiceRoleClient(), teacherId, classroomId)).impact
}

function parseRpcResult(value: unknown) {
  const result = purgeRpcResultSchema.parse(value)
  if (!result.ok) {
    throw new ClassroomPurgeError(
      result.error_code || 'classroom_purge_failed',
      result.error || 'Permanent deletion could not be started',
      result.status,
      result.retryable || false,
    )
  }
  return result
}

export async function startClassroomPurge(args: {
  teacherId: string
  classroomId: string
  operationId: string
  confirmation: string
  expectedSourceRevision?: number
  expectedStorageInventoryVersion?: number
  expectedStorageInventorySha256?: string
}): Promise<ClassroomPurgeStatus> {
  uuidSchema.parse(args.operationId)
  const supabase = getServiceRoleClient()
  // Authorize the classroom owner before consulting the global purge fence so
  // another teacher cannot learn that a deletion exists for this classroom.
  try {
    await readClassroomRoot(supabase, args.teacherId, args.classroomId)
  } catch (error) {
    if (!(error instanceof ClassroomPurgeError) || error.code !== 'classroom_not_found') {
      throw error
    }
    // A successful purge removes the classroom root. Preserve safe idempotent
    // replay by authorizing against the redacted terminal operation itself.
    const completedReplay = await (supabase as any)
      .from('classroom_purge_operations')
      .select('id')
      .eq('id', args.operationId)
      .eq('teacher_id', args.teacherId)
      .eq('classroom_id', args.classroomId)
      .eq('status', 'completed')
      .maybeSingle()
    if (completedReplay.error) {
      throw new ClassroomPurgeError(
        completedReplay.error.code || 'purge_replay_read_failed',
        'Could not verify the completed permanent deletion',
        500,
        true,
      )
    }
    if (completedReplay.data) {
      return getClassroomPurgeStatus(args.teacherId, args.operationId)
    }
    throw error
  }
  const activeFence = await (supabase as any)
    .from('classroom_purge_fences')
    .select('operation_id')
    .eq('classroom_id', args.classroomId)
    .maybeSingle()
  if (activeFence.error) {
    throw new ClassroomPurgeError(
      activeFence.error.code || 'classroom_purge_fence_read_failed',
      'Could not verify the active permanent deletion operation',
      500,
      true,
    )
  }
  if (activeFence.data) {
    if (activeFence.data.operation_id !== args.operationId) {
      throw new ClassroomPurgeError(
        'classroom_purge_active',
        'Permanent deletion is already active for this classroom',
        409,
        true,
      )
    }
    return tickClassroomPurge(args.teacherId, args.operationId)
  }

  const inventory = await readStableInventory(supabase, args.teacherId, args.classroomId)
  if (
    args.expectedSourceRevision !== inventory.impact.source_revision
    || args.expectedStorageInventoryVersion !== inventory.impact.storage_inventory_version
    || args.expectedStorageInventorySha256 !== inventory.impact.storage_inventory_sha256
  ) {
    throw new ClassroomPurgeError(
      'classroom_purge_inventory_changed',
      'Classroom data changed after the deletion impact was shown. Review the updated impact and confirm again.',
      409,
      true,
    )
  }
  if (
    args.confirmation !== 'DELETE'
    && args.confirmation !== inventory.impact.classroom_title
  ) {
    throw new ClassroomPurgeError(
      'confirmation_mismatch',
      'Type the classroom name exactly, or type DELETE',
      400,
    )
  }
  if (inventory.impact.conflicting_operation) {
    throw new ClassroomPurgeError(
      inventory.impact.conflicting_operation,
      'Finish the active classroom operation before deleting permanently',
      409,
      true,
    )
  }
  if (!inventory.impact.deletion_available) {
    throw new ClassroomPurgeError(
      inventory.impact.ownership_coverage_status !== 'verified'
        ? 'classroom_storage_coverage_incomplete'
        : 'classroom_purge_disabled',
      inventory.impact.unavailable_reason || 'Permanent deletion is not available',
      inventory.impact.ownership_coverage_status !== 'verified' ? 409 : 503,
      false,
    )
  }

  const requestSha256 = canonicalRequestHash({
    classroom_id: args.classroomId,
    teacher_id: args.teacherId,
    intent: 'delete_permanently',
    source_revision: args.expectedSourceRevision,
    storage_inventory_version: args.expectedStorageInventoryVersion,
    storage_inventory_sha256: args.expectedStorageInventorySha256,
  })
  const begin = parseRpcResult(await rpc(
    supabase,
    'begin_hot_archived_classroom_purge',
    {
      p_operation_id: args.operationId,
      p_teacher_id: args.teacherId,
      p_classroom_id: args.classroomId,
      p_request_sha256: requestSha256,
      p_impact_summary: inventory.impact,
    },
  ))
  if (begin.operation_status === 'completed') {
    return getClassroomPurgeStatus(args.teacherId, args.operationId)
  }

  await tickClassroomPurge(args.teacherId, args.operationId)
  return getClassroomPurgeStatus(args.teacherId, args.operationId)
}

export async function getClassroomPurgeStatus(
  teacherId: string,
  operationId: string,
): Promise<ClassroomPurgeStatus> {
  uuidSchema.parse(operationId)
  const supabase = getServiceRoleClient()
  const db = untyped(supabase)
  const operationQuery = db.from('classroom_purge_operations').select(
    'id,classroom_id,teacher_id,status,retryable,error_code,resource_counts,attempt_count,completed_at',
  ) as {
    eq(column: string, value: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: unknown; error: RpcError | null }>
      }
    }
  }
  const { data, error } = await operationQuery
    .eq('id', operationId)
    .eq('teacher_id', teacherId)
    .maybeSingle()
  if (error) throw new ClassroomPurgeError(error.code || 'purge_read_failed', 'Could not read deletion', 500, true)
  if (!data) throw new ClassroomPurgeError('purge_not_found', 'Permanent deletion not found', 404)
  const operation = purgeOperationRowSchema.parse(data)

  const objectQuery = db.from('classroom_purge_objects').select('status') as {
    eq(column: string, value: string): PromiseLike<{
      data: unknown
      error: RpcError | null
    }>
  }
  const objects = await objectQuery.eq('operation_id', operationId)
  if (objects.error) {
    throw new ClassroomPurgeError(
      objects.error.code || 'purge_read_failed',
      'Could not read deletion progress',
      500,
      true,
    )
  }
  const storageObjectCounts: Record<string, number> = {}
  for (const row of z.array(z.object({ status: z.string() })).parse(objects.data)) {
    storageObjectCounts[row.status] = (storageObjectCounts[row.status] || 0) + 1
  }
  return classroomPurgeStatusSchema.parse({
    operation_id: operation.id,
    classroom_id: operation.classroom_id,
    status: operation.status,
    retryable: operation.retryable,
    error_code: operation.error_code,
    attempt_count: operation.attempt_count,
    resource_counts: operation.resource_counts,
    storage_object_counts: storageObjectCounts,
    completed_at: operation.completed_at,
  })
}

export async function getActiveClassroomPurgeStatus(
  teacherId: string,
  classroomId: string,
): Promise<ClassroomPurgeStatus | null> {
  const supabase = getServiceRoleClient()
  const query = untyped(supabase).from('classroom_purge_operations').select('id') as {
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
  const { data, error } = await query
    .eq('teacher_id', teacherId)
    .eq('classroom_id', classroomId)
    .in('status', ['inventorying', 'deleting_objects', 'finalizing', 'failed'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    throw new ClassroomPurgeError(
      error.code || 'purge_read_failed',
      'Could not read permanent deletion state',
      500,
      true,
    )
  }
  if (!data) return null
  const id = z.object({ id: z.string().uuid() }).parse(data).id
  return getClassroomPurgeStatus(teacherId, id)
}

export async function tickClassroomPurge(
  teacherId: string,
  operationId: string,
): Promise<ClassroomPurgeStatus> {
  uuidSchema.parse(operationId)
  const supabase = getServiceRoleClient()
  const leaseToken = randomUUID()
  const claimed = z.array(purgeObjectSchema).parse(await rpc(
    supabase,
    'claim_classroom_purge_object',
    {
      p_operation_id: operationId,
      p_teacher_id: teacherId,
      p_lease_token: leaseToken,
      p_lease_seconds: 60,
    },
  ))
  const object = claimed[0]
  if (!object) {
    parseRpcResult(await rpc(supabase, 'finalize_hot_archived_classroom_purge', {
      p_operation_id: operationId,
      p_teacher_id: teacherId,
    }))
    return getClassroomPurgeStatus(teacherId, operationId)
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

  return getClassroomPurgeStatus(teacherId, operationId)
}

export async function deleteClassroomPurgeStorageObject(
  storage: PurgeStorageAdapter,
  bucketName: PurgeStorageBucket,
  path: string,
): Promise<void> {
  const bucket = storage.from(bucketName)
  const removal = await bucket.remove([path])
  if (removal.error && !missingStorageObjectEvidence(removal.error)) {
    throw removal.error
  }
}

export async function runClassroomPurgeSafetyNet(
  maxTicks = 25,
): Promise<{ processed: number; completed: number; failed: number }> {
  const supabase = getServiceRoleClient()
  const query = untyped(supabase).from('classroom_purge_operations').select(
    'id,teacher_id,classroom_id,status,retryable',
  ) as {
    in(column: string, values: string[]): {
      order(column: string, options: { ascending: boolean }): {
        limit(count: number): PromiseLike<{ data: unknown; error: RpcError | null }>
      }
    }
  }
  const response = await query
    .in('status', ['inventorying', 'deleting_objects', 'finalizing', 'failed'])
    .order('updated_at', { ascending: true })
    .limit(maxTicks)
  if (response.error) {
    throw new ClassroomPurgeError(
      response.error.code || 'purge_safety_net_read_failed',
      'Could not read pending permanent deletions',
      500,
      true,
    )
  }
  const rows = z.array(z.object({
    id: z.string().uuid(),
    teacher_id: z.string().uuid(),
    classroom_id: z.string().uuid(),
    status: z.enum(['inventorying', 'deleting_objects', 'finalizing', 'failed']),
    retryable: z.boolean().nullable(),
  }).strict()).parse(response.data)

  const pending = rows.filter((row) => row.status !== 'failed' || row.retryable !== false)
  let processed = 0
  let completed = 0
  let failed = 0
  while (pending.length > 0 && processed < maxTicks) {
    const row = pending.shift()
    if (!row) break
    try {
      const status = row.status === 'inventorying'
        ? await startClassroomPurge({
            teacherId: row.teacher_id,
            classroomId: row.classroom_id,
            operationId: row.id,
            confirmation: 'DELETE',
          })
        : await tickClassroomPurge(row.teacher_id, row.id)
      processed += 1
      if (status.status === 'completed') {
        completed += 1
      } else if ((status.storage_object_counts.failed || 0) > 0) {
        failed += 1
      } else if (status.status !== 'failed' || status.retryable !== false) {
        pending.push({ ...row, status: status.status, retryable: status.retryable })
      }
    } catch {
      processed += 1
      failed += 1
    }
  }
  return { processed, completed, failed }
}
