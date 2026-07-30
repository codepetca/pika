import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { CLASSROOM_RELATIONAL_RESOURCES } from '@/lib/contracts/classroom-data'
import {
  discoverClassroomStorageReferences,
} from '@/lib/server/classroom-archive-format'
import {
  createSupabaseClassroomArchiveInventoryReader,
  readClassroomArchiveResourceGraph,
} from '@/lib/server/classroom-archive-inventory'
import { missingStorageObjectEvidence } from '@/lib/server/storage-object-evidence'
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

type StorageObject = {
  bucket: PurgeStorageBucket
  path: string
}

type PurgeStorageAdapter = {
  from(bucket: string): {
    remove(paths: string[]): PromiseLike<{ error: unknown }>
    list(
      path: string,
      options: { limit: number; search: string },
    ): PromiseLike<{
      data: Array<{ name: string }> | null
      error: unknown
    }>
  }
}

type Inventory = {
  impact: ClassroomPurgeImpact
  resources: Record<string, Array<Record<string, unknown>>>
  objects: StorageObject[]
  sourceRevision: number
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

function uniqueObjects(objects: StorageObject[]): StorageObject[] {
  const byIdentity = new Map<string, StorageObject>()
  for (const object of objects) {
    byIdentity.set(`${object.bucket}\0${object.path}`, object)
  }
  return [...byIdentity.values()].sort((left, right) =>
    `${left.bucket}/${left.path}`.localeCompare(`${right.bucket}/${right.path}`),
  )
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

async function readOperationalObjects(
  supabase: ServiceClient,
  classroomId: string,
): Promise<{
  archiveObjects: StorageObject[]
  gradexObjects: StorageObject[]
  bytes: number
}> {
  const [archives, extracts] = await Promise.all([
    supabase
      .from('classroom_archives')
      .select('storage_bucket,storage_path,compressed_byte_size')
      .eq('classroom_id', classroomId),
    supabase
      .from('classroom_gradex_extracts')
      .select('storage_bucket,storage_path,compressed_byte_size')
      .eq('classroom_id', classroomId),
  ])
  if (archives.error) {
    throw new ClassroomPurgeError(archives.error.code, 'Could not inventory classroom archives', 500, true)
  }
  if (extracts.error) {
    throw new ClassroomPurgeError(extracts.error.code, 'Could not inventory Gradex extracts', 500, true)
  }
  const archiveObjects = (archives.data || []).map((row) => ({
    bucket: row.storage_bucket as 'classroom-archives',
    path: row.storage_path,
  }))
  const gradexObjects = (extracts.data || []).map((row) => ({
    bucket: row.storage_bucket as 'gradex-analytics-extracts',
    path: row.storage_path,
  }))
  const bytes = [...(archives.data || []), ...(extracts.data || [])]
    .reduce((total, row) => total + Number(row.compressed_byte_size || 0), 0)
  return { archiveObjects, gradexObjects, bytes }
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
    const sourceObjects = discoverClassroomStorageReferences(resources, supabaseUrl)
      .map((reference) => ({
        bucket: reference.bucket as PurgeStorageBucket,
        path: reference.path,
      }))
    const operational = await readOperationalObjects(supabase, classroomId)
    const objects = uniqueObjects([
      ...sourceObjects,
      ...operational.archiveObjects,
      ...operational.gradexObjects,
    ])
    const sizes = await Promise.all(sourceObjects.map(async (object) => {
      const value = await reader.readStorageObjectSize(object.bucket, object.path)
      return value === null ? null : z.number().int().nonnegative().parse(value)
    }))
    const revisionAfter = z.number().int().positive().parse(
      await reader.readRevision(classroomId),
    )
    if (sourceRevision !== revisionAfter) continue

    const resourceCounts = Object.fromEntries(
      CLASSROOM_RELATIONAL_RESOURCES.map((resource) => [
        resource.table,
        (resources[resource.table] || []).length,
      ]),
    )
    const students = new Set<string>()
    for (const table of ['classroom_enrollments', 'classroom_roster', 'entries']) {
      for (const row of resources[table] || []) {
        if (typeof row.student_id === 'string') students.add(row.student_id)
      }
    }
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
      relational_row_count: Object.values(resourceCounts)
        .reduce((total, count) => total + count, 0),
      student_count: students.size,
      managed_file_count: objects.length,
      managed_file_bytes: sizes.reduce<number>(
        (total, size) => total + (size || 0),
        operational.bytes,
      ),
      missing_file_count: sizes.filter((size) => size === null).length,
      archive_count: operational.archiveObjects.length,
      gradex_extract_count: operational.gradexObjects.length,
      resource_counts: resourceCounts,
      storage_counts: storageCounts,
      conflicting_operation: conflict,
    })
    return { impact, resources, objects, sourceRevision }
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
}): Promise<ClassroomPurgeStatus> {
  uuidSchema.parse(args.operationId)
  const supabase = getServiceRoleClient()
  const inventory = await readStableInventory(supabase, args.teacherId, args.classroomId)
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

  const requestSha256 = canonicalRequestHash({
    classroom_id: args.classroomId,
    teacher_id: args.teacherId,
    intent: 'delete_permanently',
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

  const fencedInventory = await readStableInventory(supabase, args.teacherId, args.classroomId)
  if (
    begin.source_revision !== undefined
    && fencedInventory.sourceRevision !== begin.source_revision
  ) {
    throw new ClassroomPurgeError(
      'classroom_inventory_drift',
      'Classroom inventory changed before deletion was fenced',
      409,
      false,
    )
  }

  for (let offset = 0; offset < fencedInventory.objects.length; offset += 100) {
    const batch = fencedInventory.objects.slice(offset, offset + 100)
    await rpc(supabase, 'stage_classroom_purge_objects', {
      p_operation_id: args.operationId,
      p_teacher_id: args.teacherId,
      p_objects: batch.map((object) => ({
        ...object,
        disposition: 'delete',
      })),
    })
  }
  parseRpcResult(await rpc(supabase, 'seal_classroom_purge_inventory', {
    p_operation_id: args.operationId,
    p_teacher_id: args.teacherId,
    p_expected_object_count: fencedInventory.objects.length,
  }))

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
    'id,classroom_id,teacher_id,status,retryable,error_code,resource_counts,completed_at',
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
  const separator = path.lastIndexOf('/')
  const directory = separator === -1 ? '' : path.slice(0, separator)
  const objectName = separator === -1 ? path : path.slice(separator + 1)
  const verification = await bucket.list(directory, {
    limit: 100,
    search: objectName,
  })
  if (verification.error) throw verification.error
  if ((verification.data || []).some((object) => object.name === objectName)) {
    throw new Error('storage_delete_not_verified')
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
