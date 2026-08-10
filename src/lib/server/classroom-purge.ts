import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import {
  CLASSROOM_PURGE_ONLY_RELATIONAL_RESOURCES,
  CLASSROOM_RELATIONAL_RESOURCES,
} from '@/lib/contracts/classroom-data'
import {
  createSupabaseClassroomArchiveInventoryReader,
  readClassroomArchiveResourceGraph,
} from '@/lib/server/classroom-archive-inventory'
import { loadChunkedRows } from '@/lib/server/query-chunks'
import { missingStorageObjectEvidence } from '@/lib/server/storage-object-evidence'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  classroomPurgeImpactSchema,
  classroomPurgeStatusSchema,
  type ClassroomPurgeImpact,
  type ClassroomPurgeStatus,
} from '@/lib/validations/classroom-purge'

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

const inventorySchema = z.object({
  ok: z.boolean(),
  status: z.number().int(),
  error_code: z.string().optional(),
  error: z.string().optional(),
  classroom_id: z.string().uuid().optional(),
  classroom_title: z.string().min(1).optional(),
  source_revision: z.number().int().positive().optional(),
  storage_inventory_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  operational_inventory_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  managed_file_count: z.number().int().nonnegative().optional(),
  managed_file_bytes: z.number().int().nonnegative().optional(),
  missing_file_count: z.number().int().nonnegative().optional(),
  archive_count: z.number().int().nonnegative().optional(),
  gradex_extract_count: z.number().int().nonnegative().optional(),
  interrupted_upload_count: z.number().int().nonnegative().optional(),
  storage_counts: z.record(z.string(), z.number().int().nonnegative()).optional(),
  operational_counts: z.record(z.string(), z.number().int().nonnegative()).optional(),
  conflicting_operation: z.string().nullable().optional(),
  deletion_available: z.boolean().optional(),
  unavailable_reason: z.string().nullable().optional(),
}).passthrough()

const operationRowSchema = z.object({
  id: z.string().uuid(),
  classroom_id: z.string().uuid(),
  teacher_id: z.string().uuid(),
  status: z.enum(['inventorying', 'deleting_objects', 'finalizing', 'completed', 'failed']),
  retryable: z.boolean().nullable(),
  error_code: z.string().nullable(),
  resource_counts: z.record(z.string(), z.number().int().nonnegative()),
  attempt_count: z.number().int().positive(),
  completed_at: z.string().datetime({ offset: true }).nullable(),
  purge_scope: z.enum(['hot_classroom', 'cold_classroom']),
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

const affectedUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.string(),
}).strict()

type ServiceClient = ReturnType<typeof getServiceRoleClient>
type RpcError = { code?: string; message?: string; details?: string }
type UntypedClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown
    error: RpcError | null
  }>
  from(table: string): {
    select(columns: string, options?: { count?: 'exact'; head?: boolean }): unknown
  }
}
type PurgeStorageAdapter = {
  from(bucket: string): {
    remove(paths: string[]): PromiseLike<{ error: unknown }>
  }
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

function parseResult(value: unknown) {
  const result = rpcResultSchema.parse(value)
  if (!result.ok) {
    throw new ClassroomPurgeError(
      result.error_code || 'classroom_purge_failed',
      result.error || 'Permanent deletion could not continue',
      result.status,
      result.retryable || false,
    )
  }
  return result
}

function inventoryConfiguration() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!supabaseUrl || !secretKey) throw new Error('Missing Supabase inventory environment variables')
  return { supabaseUrl, secretKey }
}

function canonicalHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

async function readRoot(supabase: ServiceClient, teacherId: string, classroomId: string) {
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
  const { count, error: tombstoneError } = await supabase
    .from('classroom_cold_tombstones')
    .select('*', { count: 'exact', head: true })
    .eq('classroom_id', classroomId)
  if (tombstoneError) {
    throw new ClassroomPurgeError(tombstoneError.code, 'Could not read classroom state', 500, true)
  }
  if ((count || 0) > 0) {
    throw new ClassroomPurgeError(
      'classroom_is_cold_archived',
      'Stored classroom deletion is not available yet',
      409,
    )
  }
  return data
}

function collectAffectedUserIds(resources: Record<string, Array<Record<string, unknown>>>) {
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

export function countClassroomStudents(
  resources: Record<string, Array<Record<string, unknown>>>,
  affectedUsers: Array<{ id: string; email: string; role: string }>,
): number {
  const studentIds = new Set<string>()
  const ambiguousIds = new Set<string>()
  for (const rows of Object.values(resources)) {
    for (const row of rows) {
      if (typeof row.student_id === 'string') studentIds.add(row.student_id)
    }
  }
  for (const row of resources.announcement_reads || []) {
    if (typeof row.user_id === 'string') ambiguousIds.add(row.user_id)
  }
  for (const row of resources.classroom_retired_assessment_record_actors || []) {
    if (row.source_column === 'student_id' && typeof row.actor_id === 'string') {
      studentIds.add(row.actor_id)
    }
  }
  const studentEmails = new Set<string>()
  for (const user of affectedUsers) {
    if (studentIds.has(user.id) || (ambiguousIds.has(user.id) && user.role === 'student')) {
      studentIds.add(user.id)
      studentEmails.add(user.email.trim().toLowerCase())
    }
  }
  const unmatchedRosterEmails = new Set<string>()
  for (const row of resources.classroom_roster || []) {
    if (typeof row.email !== 'string') continue
    const email = row.email.trim().toLowerCase()
    if (email && !studentEmails.has(email)) unmatchedRosterEmails.add(email)
  }
  return studentIds.size + unmatchedRosterEmails.size
}

export function mergeClassroomPurgeResourceCounts(
  classroomCounts: Record<string, number>,
  operationalCounts: Record<string, number>,
): Record<string, number> {
  return { ...classroomCounts, ...operationalCounts }
}

async function readDatabaseInventory(
  supabase: ServiceClient,
  teacherId: string,
  classroomId: string,
) {
  const result = inventorySchema.parse(await rpc(
    supabase,
    'get_hot_archived_classroom_purge_inventory',
    { p_teacher_id: teacherId, p_classroom_id: classroomId },
  ))
  if (!result.ok) {
    throw new ClassroomPurgeError(
      result.error_code || 'classroom_purge_inventory_failed',
      result.error || 'Could not prepare permanent deletion',
      result.status,
      result.status >= 500,
    )
  }
  return result as Required<Pick<typeof result,
    'classroom_id' | 'classroom_title' | 'source_revision'
    | 'storage_inventory_sha256' | 'managed_file_count' | 'managed_file_bytes'
    | 'missing_file_count' | 'archive_count' | 'gradex_extract_count'
    | 'interrupted_upload_count' | 'storage_counts' | 'deletion_available'
    | 'operational_counts'
    | 'operational_inventory_sha256'
  >> & typeof result
}

async function readStableImpact(
  supabase: ServiceClient,
  teacherId: string,
  classroomId: string,
): Promise<ClassroomPurgeImpact> {
  await readRoot(supabase, teacherId, classroomId)
  const { supabaseUrl, secretKey } = inventoryConfiguration()
  const reader = createSupabaseClassroomArchiveInventoryReader({ supabase, supabaseUrl, secretKey })

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await readDatabaseInventory(supabase, teacherId, classroomId)
    const resources = await readClassroomArchiveResourceGraph(reader, classroomId)
    const after = await readDatabaseInventory(supabase, teacherId, classroomId)
    if (
      before.source_revision !== after.source_revision
      || before.storage_inventory_sha256 !== after.storage_inventory_sha256
      || before.operational_inventory_sha256 !== after.operational_inventory_sha256
    ) continue

    const affectedUserIds = collectAffectedUserIds(resources)
    const assignmentDocIds = (resources.assignment_docs || [])
      .map((row) => row.id)
      .filter((id): id is string => typeof id === 'string')
    const [users, saveOperations] = await Promise.all([
      loadChunkedRows<unknown>({
        supabase,
        table: 'users',
        select: 'id,email,role',
        filters: [{ column: 'id', values: affectedUserIds }],
      }),
      loadChunkedRows<unknown>({
        supabase,
        table: 'assignment_doc_save_operations',
        select: 'id',
        filters: [{ column: 'assignment_doc_id', values: assignmentDocIds }],
      }),
    ])
    if (users.error) {
      throw new ClassroomPurgeError(
        users.error.code || 'classroom_student_inventory_failed',
        'Could not inventory affected students',
        500,
        true,
      )
    }
    if (saveOperations.error) {
      throw new ClassroomPurgeError(
        saveOperations.error.code || 'classroom_operation_inventory_failed',
        'Could not inventory classroom operation records',
        500,
        true,
      )
    }
    const affectedUsers = z.array(affectedUserSchema).parse(users.rows)
    const classroomCounts = Object.fromEntries([
      ...CLASSROOM_RELATIONAL_RESOURCES.map((resource) => [
        resource.table,
        (resources[resource.table] || []).length,
      ] as const),
      ...CLASSROOM_PURGE_ONLY_RELATIONAL_RESOURCES.map((resource) => [
        resource.table,
        resource.table === 'assignment_doc_save_operations' ? saveOperations.rows.length : 0,
      ] as const),
    ])
    const resourceCounts = mergeClassroomPurgeResourceCounts(
      classroomCounts,
      after.operational_counts,
    )
    return classroomPurgeImpactSchema.parse({
      classroom_id: classroomId,
      classroom_title: after.classroom_title,
      source_revision: after.source_revision,
      storage_inventory_sha256: after.storage_inventory_sha256,
      operational_inventory_sha256: after.operational_inventory_sha256,
      relational_row_count: Object.values(resourceCounts).reduce((sum, count) => sum + count, 0),
      student_count: countClassroomStudents(resources, affectedUsers),
      managed_file_count: after.managed_file_count,
      managed_file_bytes: after.managed_file_bytes,
      missing_file_count: after.missing_file_count,
      archive_count: after.archive_count,
      gradex_extract_count: after.gradex_extract_count,
      interrupted_upload_count: after.interrupted_upload_count,
      resource_counts: resourceCounts,
      storage_counts: after.storage_counts,
      conflicting_operation: after.conflicting_operation ?? null,
      deletion_available: after.deletion_available,
      unavailable_reason: after.unavailable_reason ?? null,
    })
  }
  throw new ClassroomPurgeError(
    'classroom_inventory_unstable',
    'Classroom data changed while preparing permanent deletion',
    409,
    true,
  )
}

export async function getClassroomPurgeImpact(teacherId: string, classroomId: string) {
  return readStableImpact(getServiceRoleClient(), teacherId, classroomId)
}

export async function startClassroomPurge(args: {
  teacherId: string
  classroomId: string
  operationId: string
  confirmation: string
  expectedSourceRevision: number
  expectedStorageInventorySha256: string
  expectedOperationalInventorySha256: string
}): Promise<ClassroomPurgeStatus> {
  uuidSchema.parse(args.operationId)
  const supabase = getServiceRoleClient()
  const replayQuery = untyped(supabase).from('classroom_purge_operations').select('id') as {
    eq(column: string, value: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): {
          eq(column: string, value: string): {
            maybeSingle(): PromiseLike<{ data: unknown; error: RpcError | null }>
          }
        }
      }
    }
  }
  const completedReplay = await replayQuery
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
  const impact = await readStableImpact(supabase, args.teacherId, args.classroomId)
  if (
    impact.source_revision !== args.expectedSourceRevision
    || impact.storage_inventory_sha256 !== args.expectedStorageInventorySha256
    || impact.operational_inventory_sha256 !== args.expectedOperationalInventorySha256
  ) {
    throw new ClassroomPurgeError(
      'classroom_purge_inventory_changed',
      'Classroom data changed after the deletion impact was shown. Review it and confirm again.',
      409,
      true,
    )
  }
  if (args.confirmation !== 'DELETE' && args.confirmation !== impact.classroom_title) {
    throw new ClassroomPurgeError(
      'confirmation_mismatch',
      'Type the classroom name exactly, or type DELETE',
      400,
    )
  }
  if (!impact.deletion_available) {
    throw new ClassroomPurgeError(
      impact.conflicting_operation || 'classroom_purge_disabled',
      impact.unavailable_reason || 'Permanent deletion is not available',
      impact.conflicting_operation ? 409 : 503,
      Boolean(impact.conflicting_operation),
    )
  }
  const requestSha256 = canonicalHash({
    classroom_id: args.classroomId,
    teacher_id: args.teacherId,
    source_revision: args.expectedSourceRevision,
    storage_inventory_sha256: args.expectedStorageInventorySha256,
    operational_inventory_sha256: args.expectedOperationalInventorySha256,
    intent: 'delete_permanently',
  })
  parseResult(await rpc(supabase, 'begin_hot_archived_classroom_purge', {
    p_operation_id: args.operationId,
    p_teacher_id: args.teacherId,
    p_classroom_id: args.classroomId,
    p_request_sha256: requestSha256,
    p_impact_summary: impact,
  }))
  await tickClassroomPurge(args.teacherId, args.operationId)
  return getClassroomPurgeStatus(args.teacherId, args.operationId)
}

export async function getClassroomPurgeStatus(
  teacherId: string,
  operationId: string,
  expectedScope: 'hot_classroom' | 'cold_classroom' = 'hot_classroom',
): Promise<ClassroomPurgeStatus> {
  uuidSchema.parse(operationId)
  const db = untyped(getServiceRoleClient())
  type OperationResponse = { data: unknown; error: RpcError | null }
  const readOperation = async (columns: string): Promise<OperationResponse> => {
    const query = db.from('classroom_purge_operations').select(columns) as {
      eq(column: string, value: string): {
        eq(column: string, value: string): {
          maybeSingle(): PromiseLike<OperationResponse>
        }
      }
    }
    return query.eq('id', operationId).eq('teacher_id', teacherId).maybeSingle()
  }
  const columns =
    'id,classroom_id,teacher_id,status,retryable,error_code,resource_counts,attempt_count,completed_at'
  let response = await readOperation(`${columns},purge_scope`)
  if (
    response.error
    && (response.error.code === 'PGRST204' || response.error.code === '42703')
    && response.error.message?.includes('purge_scope')
  ) {
    const legacy = await readOperation(columns)
    response = legacy.data
      ? { ...legacy, data: { ...(legacy.data as object), purge_scope: 'hot_classroom' } }
      : legacy
  }
  if (response.error) {
    throw new ClassroomPurgeError(response.error.code || 'purge_read_failed', 'Could not read deletion', 500, true)
  }
  if (!response.data) throw new ClassroomPurgeError('purge_not_found', 'Permanent deletion not found', 404)
  const operation = operationRowSchema.parse(response.data)
  if (operation.purge_scope !== expectedScope) {
    throw new ClassroomPurgeError('purge_not_found', 'Permanent deletion not found', 404)
  }
  const objectQuery = db.from('classroom_purge_objects').select('status') as {
    eq(column: string, value: string): PromiseLike<{ data: unknown; error: RpcError | null }>
  }
  const objects = await objectQuery.eq('operation_id', operationId)
  if (objects.error) {
    throw new ClassroomPurgeError(objects.error.code || 'purge_read_failed', 'Could not read deletion progress', 500, true)
  }
  const counts: Record<string, number> = {}
  for (const row of z.array(z.object({ status: z.string() })).parse(objects.data || [])) {
    counts[row.status] = (counts[row.status] || 0) + 1
  }
  return classroomPurgeStatusSchema.parse({
    operation_id: operation.id,
    classroom_id: operation.classroom_id,
    status: operation.status,
    retryable: operation.retryable,
    error_code: operation.error_code,
    attempt_count: operation.attempt_count,
    resource_counts: operation.resource_counts,
    storage_object_counts: counts,
    completed_at: operation.completed_at,
  })
}

export async function getActiveClassroomPurgeStatus(
  teacherId: string,
  classroomId: string,
): Promise<ClassroomPurgeStatus | null> {
  const db = untyped(getServiceRoleClient())
  const query = db.from('classroom_purge_operations').select('id') as {
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
  const response = await query
    .eq('teacher_id', teacherId)
    .eq('classroom_id', classroomId)
    .in('status', ['inventorying', 'deleting_objects', 'finalizing', 'failed'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (response.error) {
    throw new ClassroomPurgeError(response.error.code || 'purge_read_failed', 'Could not read deletion state', 500, true)
  }
  if (!response.data) return null
  const id = z.object({ id: z.string().uuid() }).parse(response.data).id
  return getClassroomPurgeStatus(teacherId, id)
}

export async function tickClassroomPurge(
  teacherId: string,
  operationId: string,
): Promise<ClassroomPurgeStatus> {
  return (await advanceClassroomPurge(teacherId, operationId)).operation
}

export async function advanceClassroomPurge(
  teacherId: string,
  operationId: string,
): Promise<{ operation: ClassroomPurgeStatus; advanced: boolean }> {
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
    parseResult(await rpc(supabase, 'finalize_hot_archived_classroom_purge', {
      p_operation_id: operationId,
      p_teacher_id: teacherId,
    }))
    const operation = await getClassroomPurgeStatus(teacherId, operationId)
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
    operation: await getClassroomPurgeStatus(teacherId, operationId),
    advanced: true,
  }
}

export function isMissingClassroomPurgeSchemaError(error: RpcError | null): boolean {
  return error?.code === 'PGRST205' || error?.code === '42P01'
}

export function shouldRequeueClassroomPurgeSafetyNet(
  status: ClassroomPurgeStatus,
  advanced: boolean,
): boolean {
  return advanced
    && status.status !== 'completed'
    && (status.storage_object_counts.failed || 0) === 0
    && (status.status !== 'failed' || status.retryable !== false)
}

export async function deleteClassroomPurgeStorageObject(
  storage: PurgeStorageAdapter,
  bucket: z.infer<typeof purgeObjectSchema>['storage_bucket'],
  path: string,
): Promise<void> {
  const removal = await storage.from(bucket).remove([path])
  if (removal.error && !missingStorageObjectEvidence(removal.error)) throw removal.error
}

export async function runClassroomPurgeSafetyNet(maxTicks = 25) {
  const db = untyped(getServiceRoleClient())
  const readiness = await (db
    .from('classroom_purge_settings')
    .select('singleton') as PromiseLike<{ data: unknown; error: RpcError | null }>)
  if (readiness.error) {
    if (isMissingClassroomPurgeSchemaError(readiness.error)) {
      return { processed: 0, completed: 0, failed: 0 }
    }
    throw new ClassroomPurgeError(
      readiness.error.code || 'purge_safety_net_readiness_failed',
      'Could not verify deletion worker readiness',
      500,
      true,
    )
  }

  const settings = z.array(z.object({ singleton: z.literal(true) }).strict()).parse(readiness.data || [])
  if (settings.length !== 1) {
    return { processed: 0, completed: 0, failed: 0 }
  }

  type OperationListResponse = { data: unknown; error: RpcError | null }
  const readPending = async (columns: string): Promise<OperationListResponse> => {
    const query = db.from('classroom_purge_operations').select(columns) as {
      in(column: string, values: string[]): {
        order(column: string, options: { ascending: boolean }): {
          limit(count: number): PromiseLike<OperationListResponse>
        }
      }
    }
    return query
      .in('status', ['deleting_objects', 'finalizing', 'failed'])
      .order('updated_at', { ascending: true })
      .limit(maxTicks)
  }
  const legacyColumns = 'id,teacher_id,status,retryable'
  let response = await readPending(`${legacyColumns},purge_scope`)
  if (
    response.error
    && (response.error.code === 'PGRST204' || response.error.code === '42703')
    && response.error.message?.includes('purge_scope')
  ) {
    const legacy = await readPending(legacyColumns)
    response = legacy.data
      ? {
        ...legacy,
        data: z.array(z.record(z.string(), z.unknown())).parse(legacy.data)
          .map((row) => ({ ...row, purge_scope: 'hot_classroom' })),
      }
      : legacy
  }
  if (response.error) {
    if (isMissingClassroomPurgeSchemaError(response.error)) {
      return { processed: 0, completed: 0, failed: 0 }
    }
    throw new ClassroomPurgeError(
      response.error.code || 'purge_safety_net_read_failed',
      'Could not read pending deletions',
      500,
      true,
    )
  }
  const rows = z.array(z.object({
    id: z.string().uuid(),
    teacher_id: z.string().uuid(),
    status: z.enum(['deleting_objects', 'finalizing', 'failed']),
    retryable: z.boolean().nullable(),
    purge_scope: z.enum(['hot_classroom', 'cold_classroom']),
  }).strict()).parse(response.data || [])
  const pending = rows.filter((row) =>
    row.purge_scope === 'hot_classroom'
    && (row.status !== 'failed' || row.retryable !== false),
  )
  let processed = 0
  let completed = 0
  let failed = 0
  while (pending.length > 0 && processed < maxTicks) {
    const row = pending.shift()
    if (!row) break
    try {
      const { operation: status, advanced } = await advanceClassroomPurge(row.teacher_id, row.id)
      processed += 1
      if (status.status === 'completed') completed += 1
      else if ((status.storage_object_counts.failed || 0) > 0) failed += 1
      else if (shouldRequeueClassroomPurgeSafetyNet(status, advanced)) pending.push(row)
    } catch {
      processed += 1
      failed += 1
    }
  }
  return { processed, completed, failed }
}
