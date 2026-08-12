import { createHash } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { missingStorageObjectEvidence } from '@/lib/server/storage-object-evidence'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  studentPurgeImpactSchema,
  studentPurgeStatusSchema,
  type StudentPurgeImpact,
  type StudentPurgeStatus,
} from '@/lib/validations/student-purge'

const rpcResultSchema = z.object({
  ok: z.boolean(),
  status: z.number().int(),
  operation_id: z.string().uuid().optional(),
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
  student_id: z.string().uuid().optional(),
  student_email: z.string().email().optional(),
  source_revision: z.number().int().positive().optional(),
  storage_inventory_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  relational_inventory_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  managed_file_count: z.number().int().nonnegative().optional(),
  managed_file_bytes: z.number().int().nonnegative().optional(),
  archive_count: z.number().int().nonnegative().optional(),
  gradex_extract_count: z.number().int().nonnegative().optional(),
  resource_counts: z.record(z.string(), z.number().int().nonnegative()).optional(),
  storage_counts: z.record(z.string(), z.number().int().nonnegative()).optional(),
  conflicting_operation: z.string().nullable().optional(),
  deletion_available: z.boolean().optional(),
  unavailable_reason: z.string().nullable().optional(),
}).passthrough()

const operationRowSchema = z.object({
  id: z.string().uuid(),
  classroom_id: z.string().uuid(),
  teacher_id: z.string().uuid(),
  student_id: z.string().uuid().nullable(),
  student_binding_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['inventorying', 'deleting_objects', 'finalizing', 'completed', 'failed']),
  retryable: z.boolean().nullable(),
  error_code: z.string().nullable(),
  resource_counts: z.record(z.string(), z.number().int().nonnegative()),
  attempt_count: z.number().int().positive(),
  completed_at: z.string().nullable(),
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

const healthSchema = z.object({
  captured_at: z.string().datetime({ offset: true }),
  active_count: z.number().int().nonnegative(),
  stuck_count: z.number().int().nonnegative(),
  failed_count: z.number().int().nonnegative(),
  orphan_fence_count: z.number().int().nonnegative(),
  processing_lease_drift_count: z.number().int().nonnegative(),
}).strict()

type RpcError = { code?: string; message?: string }
type QueryResponse = { data: unknown; error: RpcError | null }
type UntypedClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<QueryResponse>
  from(table: string): {
    select(columns: string): unknown
  }
}
type PurgeStorageAdapter = {
  from(bucket: string): {
    remove(paths: string[]): PromiseLike<{ error: unknown }>
  }
}

export class StudentPurgeError extends ApiError {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable = false,
  ) {
    super(status, message)
    this.name = 'StudentPurgeError'
  }
}

function db(): UntypedClient {
  return getServiceRoleClient() as unknown as UntypedClient
}

async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db().rpc(name, args)
  if (error) {
    throw new StudentPurgeError(
      error.code || 'student_purge_rpc_failed',
      error.message || 'Student data deletion failed',
      error.code === 'P0002' ? 404 : 500,
      true,
    )
  }
  return data
}

function parseResult(value: unknown) {
  const result = rpcResultSchema.parse(value)
  if (!result.ok) {
    throw new StudentPurgeError(
      result.error_code || 'student_purge_failed',
      result.error || 'Student data deletion could not continue',
      result.status,
      result.retryable || false,
    )
  }
  return result
}

export function isMissingStudentPurgeSchemaError(error: RpcError | null): boolean {
  return error?.code === 'PGRST205' || error?.code === '42P01' || error?.code === 'PGRST202'
}

export async function getStudentPurgeImpact(
  teacherId: string,
  classroomId: string,
  studentId: string,
): Promise<StudentPurgeImpact> {
  const raw = inventorySchema.parse(await rpc('get_student_purge_inventory', {
    p_teacher_id: teacherId,
    p_classroom_id: classroomId,
    p_student_id: studentId,
  }))
  if (!raw.ok) {
    throw new StudentPurgeError(
      raw.error_code || 'student_purge_inventory_failed',
      raw.error || 'Could not prepare student data deletion',
      raw.status,
    )
  }
  const resourceCounts = raw.resource_counts || {}
  return studentPurgeImpactSchema.parse({
    classroom_id: raw.classroom_id,
    classroom_title: raw.classroom_title,
    student_id: raw.student_id,
    student_email: raw.student_email,
    source_revision: raw.source_revision,
    storage_inventory_sha256: raw.storage_inventory_sha256,
    relational_inventory_sha256: raw.relational_inventory_sha256,
    relational_row_count: Object.values(resourceCounts).reduce((sum, count) => sum + count, 0),
    managed_file_count: raw.managed_file_count,
    managed_file_bytes: raw.managed_file_bytes,
    archive_count: raw.archive_count,
    gradex_extract_count: raw.gradex_extract_count,
    resource_counts: resourceCounts,
    storage_counts: raw.storage_counts || {},
    conflicting_operation: raw.conflicting_operation || null,
    deletion_available: raw.deletion_available,
    unavailable_reason: raw.unavailable_reason || null,
  })
}

async function readOperation(teacherId: string, operationId: string): Promise<z.infer<typeof operationRowSchema>> {
  type Query = {
    eq(column: string, value: string): Query
    maybeSingle(): PromiseLike<QueryResponse>
  }
  const query = db().from('student_purge_operations').select(
    'id,classroom_id,teacher_id,student_id,student_binding_sha256,status,retryable,error_code,resource_counts,attempt_count,completed_at',
  ) as unknown as Query
  const response = await query.eq('id', operationId).eq('teacher_id', teacherId).maybeSingle()
  if (response.error) {
    throw new StudentPurgeError(response.error.code || 'student_purge_read_failed', 'Could not read deletion progress', 500, true)
  }
  if (!response.data) throw new StudentPurgeError('student_purge_not_found', 'Student data deletion not found', 404)
  return operationRowSchema.parse(response.data)
}

async function countObjects(operationId: string) {
  type Query = {
    eq(column: string, value: string): Query
  } & PromiseLike<QueryResponse>
  const query = db().from('student_purge_objects').select('status') as unknown as Query
  const response = await query.eq('operation_id', operationId)
  if (response.error) {
    throw new StudentPurgeError(response.error.code || 'student_purge_objects_read_failed', 'Could not read deletion progress', 500, true)
  }
  const counts: Record<string, number> = {}
  for (const row of z.array(z.object({ status: z.string() })).parse(response.data || [])) {
    counts[row.status] = (counts[row.status] || 0) + 1
  }
  return counts
}

export async function getStudentPurgeStatus(
  teacherId: string,
  operationId: string,
): Promise<StudentPurgeStatus> {
  const [row, objectCounts] = await Promise.all([
    readOperation(teacherId, operationId),
    countObjects(operationId),
  ])
  return studentPurgeStatusSchema.parse({
    operation_id: row.id,
    classroom_id: row.classroom_id,
    status: row.status,
    retryable: row.retryable,
    error_code: row.error_code,
    attempt_count: row.attempt_count,
    resource_counts: row.resource_counts,
    storage_object_counts: objectCounts,
    completed_at: row.completed_at,
  })
}

export async function assertStudentPurgeOperationTarget(
  teacherId: string,
  operationId: string,
  classroomId: string,
  studentId: string,
): Promise<void> {
  const row = await readOperation(teacherId, operationId)
  const expectedBinding = createHash('sha256').update(`${operationId}:${studentId}`).digest('hex')
  if (
    row.classroom_id !== classroomId
    || row.student_binding_sha256 !== expectedBinding
    || (row.student_id !== null && row.student_id !== studentId)
  ) {
    throw new StudentPurgeError('student_purge_not_found', 'Student data deletion not found', 404)
  }
}

export async function getActiveStudentPurgeStatus(
  teacherId: string,
  classroomId: string,
  studentId: string,
): Promise<StudentPurgeStatus | null> {
  type Query = {
    eq(column: string, value: string): Query
    in(column: string, values: string[]): Query
    order(column: string, options: { ascending: boolean }): Query
    limit(count: number): Query
    maybeSingle(): PromiseLike<QueryResponse>
  }
  const query = db().from('student_purge_operations').select('id') as unknown as Query
  const response = await query
    .eq('teacher_id', teacherId)
    .eq('classroom_id', classroomId)
    .eq('student_id', studentId)
    .in('status', ['inventorying', 'deleting_objects', 'finalizing', 'failed'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (response.error) {
    if (isMissingStudentPurgeSchemaError(response.error)) return null
    throw new StudentPurgeError(response.error.code || 'student_purge_read_failed', 'Could not read deletion progress', 500, true)
  }
  const id = z.object({ id: z.string().uuid() }).nullable().parse(response.data)?.id
  return id ? getStudentPurgeStatus(teacherId, id) : null
}

export async function startStudentPurge(input: {
  teacherId: string
  classroomId: string
  studentId: string
  operationId: string
  confirmation: string
  expectedSourceRevision: number
  expectedStorageInventorySha256: string
  expectedRelationalInventorySha256: string
}): Promise<StudentPurgeStatus> {
  parseResult(await rpc('begin_student_purge', {
    p_operation_id: input.operationId,
    p_teacher_id: input.teacherId,
    p_classroom_id: input.classroomId,
    p_student_id: input.studentId,
    p_confirmation: input.confirmation,
    p_expected_source_revision: input.expectedSourceRevision,
    p_expected_storage_inventory_sha256: input.expectedStorageInventorySha256,
    p_expected_relational_inventory_sha256: input.expectedRelationalInventorySha256,
  }))
  return getStudentPurgeStatus(input.teacherId, input.operationId)
}

export async function deleteStudentPurgeStorageObject(
  storage: PurgeStorageAdapter,
  bucket: z.infer<typeof purgeObjectSchema>['storage_bucket'],
  path: string,
): Promise<void> {
  const removal = await storage.from(bucket).remove([path])
  if (removal.error && !missingStorageObjectEvidence(removal.error)) throw removal.error
}

export async function advanceStudentPurge(teacherId: string, operationId: string) {
  const before = await getStudentPurgeStatus(teacherId, operationId)
  if (before.status === 'completed' || (before.status === 'failed' && before.retryable === false)) {
    return { operation: before, advanced: false }
  }

  const claim = parseResult(await rpc('claim_student_purge_object', {
    p_operation_id: operationId,
    p_teacher_id: teacherId,
  }))
  if (claim.waiting_for_storage === true) {
    return { operation: await getStudentPurgeStatus(teacherId, operationId), advanced: false }
  }
  if (!claim.object) {
    parseResult(await rpc('finalize_student_purge', {
      p_operation_id: operationId,
      p_teacher_id: teacherId,
    }))
    return { operation: await getStudentPurgeStatus(teacherId, operationId), advanced: true }
  }

  const object = purgeObjectSchema.parse(claim.object)
  const supabase = getServiceRoleClient()
  try {
    await deleteStudentPurgeStorageObject(supabase.storage, object.storage_bucket, object.storage_path)
    parseResult(await rpc('complete_student_purge_object', {
      p_operation_id: operationId,
      p_teacher_id: teacherId,
      p_object_id: object.id,
      p_lease_token: object.lease_token,
    }))
  } catch (error) {
    parseResult(await rpc('fail_student_purge_object', {
      p_operation_id: operationId,
      p_teacher_id: teacherId,
      p_object_id: object.id,
      p_lease_token: object.lease_token,
      p_error_code: error instanceof Error ? error.message : 'storage_delete_failed',
    }))
  }
  return { operation: await getStudentPurgeStatus(teacherId, operationId), advanced: true }
}

export async function getStudentPurgeEnabledStudentIds(
  teacherId: string,
  classroomId: string,
  studentIds: string[],
): Promise<string[]> {
  if (studentIds.length === 0) return []
  type Query = { maybeSingle(): PromiseLike<QueryResponse> }
  const response = await (db().from('student_purge_settings').select(
    'rollout_mode,canary_teacher_id,canary_classroom_id,canary_student_id',
  ) as unknown as Query).maybeSingle()
  if (response.error) {
    if (isMissingStudentPurgeSchemaError(response.error)) return []
    throw new StudentPurgeError(response.error.code || 'student_purge_settings_failed', 'Could not read deletion availability', 500, true)
  }
  const settings = z.object({
    rollout_mode: z.enum(['disabled', 'canary', 'enabled']),
    canary_teacher_id: z.string().uuid().nullable(),
    canary_classroom_id: z.string().uuid().nullable(),
    canary_student_id: z.string().uuid().nullable(),
  }).nullable().parse(response.data)
  if (!settings || settings.rollout_mode === 'disabled') return []
  if (settings.rollout_mode === 'enabled') return studentIds
  return settings.canary_teacher_id === teacherId
    && settings.canary_classroom_id === classroomId
    && settings.canary_student_id
    && studentIds.includes(settings.canary_student_id)
    ? [settings.canary_student_id]
    : []
}

export function shouldRequeueStudentPurgeSafetyNet(status: StudentPurgeStatus, advanced: boolean) {
  return advanced
    && status.status !== 'completed'
    && (status.storage_object_counts.failed || 0) === 0
    && (status.status !== 'failed' || status.retryable !== false)
}

export async function runStudentPurgeSafetyNet(maxTicks = 25) {
  type Query = {
    in(column: string, values: string[]): Query
    or(filters: string): Query
    order(column: string, options: { ascending: boolean }): Query
    limit(count: number): PromiseLike<QueryResponse>
  }
  const response = await (db().from('student_purge_operations').select(
    'id,teacher_id,status,retryable',
  ) as unknown as Query)
    .in('status', ['deleting_objects', 'finalizing', 'failed'])
    .or('status.neq.failed,retryable.eq.true,retryable.is.null')
    .order('updated_at', { ascending: true })
    .limit(maxTicks)
  if (response.error) {
    if (isMissingStudentPurgeSchemaError(response.error)) return { processed: 0, completed: 0, failed: 0 }
    throw new StudentPurgeError(response.error.code || 'student_purge_safety_net_failed', 'Could not resume student data deletions', 500, true)
  }
  const pending = z.array(z.object({
    id: z.string().uuid(),
    teacher_id: z.string().uuid(),
    status: z.enum(['deleting_objects', 'finalizing', 'failed']),
    retryable: z.boolean().nullable(),
  }).strict()).parse(response.data || [])
  let processed = 0
  let completed = 0
  let failed = 0
  while (pending.length > 0 && processed < maxTicks) {
    const row = pending.shift()
    if (!row) break
    try {
      const result = await advanceStudentPurge(row.teacher_id, row.id)
      processed += 1
      if (result.operation.status === 'completed') completed += 1
      else if ((result.operation.storage_object_counts.failed || 0) > 0) failed += 1
      else if (shouldRequeueStudentPurgeSafetyNet(result.operation, result.advanced)) pending.push(row)
    } catch {
      processed += 1
      failed += 1
    }
  }
  return { processed, completed, failed }
}

export async function readStudentPurgeHealth() {
  try {
    const snapshot = healthSchema.parse(await rpc('get_student_purge_health_snapshot', {}))
    return { schemaAvailable: true as const, snapshot }
  } catch (error) {
    if (error instanceof StudentPurgeError && isMissingStudentPurgeSchemaError({ code: error.code })) {
      return { schemaAvailable: false as const, snapshot: null }
    }
    throw error
  }
}
