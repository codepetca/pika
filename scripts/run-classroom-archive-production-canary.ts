import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import {
  link,
  open,
  rename,
  unlink,
} from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { gunzipSync } from 'node:zlib'
import { config as loadEnvironment } from 'dotenv'
import { z } from 'zod'
import { CLASSROOM_RELATIONAL_RESOURCES } from '@/lib/contracts/classroom-data'
import {
  assertClassroomArchiveProductionCanaryEvidenceEqual,
  assertClassroomArchiveProductionCanaryExecution,
  assertClassroomArchiveProductionCanaryTarget,
  classroomArchiveProductionCanaryAcknowledgement,
  classroomArchiveProductionCanaryEvidenceDigest,
  classroomArchiveStorageIdentitySha256,
  createClassroomArchiveProductionCanaryPlan,
  normalizeClassroomArchiveProductionCanaryCliArguments,
  runClassroomArchiveProductionCanary,
  verifyClassroomArchiveProductionCanaryPlan,
  type ClassroomArchiveProductionArchiveEvidence,
  type ClassroomArchiveProductionCanaryEvent,
  type ClassroomArchiveProductionCanaryEvidence,
  type ClassroomArchiveProductionCanaryFinalEvidence,
  type ClassroomArchiveProductionCanaryPlan,
  type ClassroomArchiveProductionCanaryState,
} from '@/lib/server/classroom-archive-production-canary'
import { compactClassroomArchive } from '@/lib/server/classroom-archive-compaction'
import {
  canonicalJsonStringify,
  decodeClassroomArchiveData,
  discoverClassroomStorageReferences,
  sha256Bytes,
  verifyClassroomArchiveBundle,
} from '@/lib/server/classroom-archive-format'
import {
  buildClassroomArchiveRestorePlan,
  CLASSROOM_ARCHIVE_RESTORE_TARGET_MIGRATION,
} from '@/lib/server/classroom-archive-restore'
import {
  createSupabaseClassroomArchiveInventoryReader,
  readClassroomArchiveResourceGraph,
} from '@/lib/server/classroom-archive-inventory'
import {
  classroomArchiveStoragePath,
  exportClassroomArchive,
} from '@/lib/server/classroom-archive-operations'
import { restoreClassroomArchive } from '@/lib/server/classroom-archive-restore-operations'
import { createTargetBoundFetch } from '@/lib/server/supabase-target'
import { getServiceRoleClient } from '@/lib/supabase'

loadEnvironment({ path: process.env.ENV_FILE || '.env.local' })

const uuidSchema = z.string().uuid()
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const commandSchema = z.enum(['prepare', 'execute', 'resume'])
const projectRefSchema = z.string().regex(/^[a-z0-9]{20}$/)
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/)
const planFileSchema = z.string().min(1).transform((value) => resolve(value))
const MINIMUM_DATABASE_SAFETY_MARGIN_BYTES = 100_000_000

type SupabaseClient = ReturnType<typeof getServiceRoleClient>

async function readProductionDatabaseSizeBytes(projectRef: string): Promise<number> {
  const accessToken = z.string().min(1).parse(process.env.SUPABASE_ACCESS_TOKEN)
  const endpoint = `https://api.supabase.com/v1/projects/${projectRefSchema.parse(projectRef)}/database/query`
  const response = await fetch(endpoint, {
    method: 'POST',
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: 'select pg_database_size(current_database())::bigint as database_size_bytes',
    }),
  })
  if (!response.ok) throw new Error('Production archive canary database size could not be read')
  const rows = z.array(z.object({
    database_size_bytes: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  }).passthrough()).parse(await response.json())
  if (rows.length !== 1) throw new Error('Production archive canary database size evidence is invalid')
  return z.coerce.number().int().positive().parse(rows[0].database_size_bytes)
}

const classroomStateRowSchema = z.object({
  id: uuidSchema,
  teacher_id: uuidSchema,
  archived_at: z.string().datetime({ offset: true }),
}).strict()

const tombstoneRowSchema = z.object({
  classroom_id: uuidSchema,
  teacher_id: uuidSchema,
  archive_id: uuidSchema,
}).strict()

const archiveRowSchema = z.object({
  id: uuidSchema,
  operation_id: uuidSchema,
  classroom_id: uuidSchema,
  teacher_id: uuidSchema,
  format: z.literal('pika.classroom-archive'),
  format_version: z.literal(1),
  storage_bucket: z.literal('classroom-archives'),
  storage_path: z.string().min(1),
  artifact_sha256: sha256Schema,
  compressed_byte_size: z.number().int().positive(),
  uncompressed_byte_size: z.number().int().positive(),
  source_revision: z.number().int().positive(),
  source_schema_migration: z.string().min(1),
  source_app_commit: commitSchema,
  content_sha256: sha256Schema,
  retention: z.object({ mode: z.literal('teacher_managed'), delete_after: z.null() }).strict(),
  resource_counts: z.record(z.string(), z.number().int().nonnegative()),
  storage_object_counts: z.record(z.string(), z.unknown()),
  verification: z.record(z.string(), z.unknown()),
  verified_at: z.string().datetime({ offset: true }),
}).strict()

const operationRowSchema = z.object({
  id: uuidSchema,
  teacher_id: uuidSchema,
  classroom_id: uuidSchema,
  operation_type: z.enum(['export', 'compact', 'restore']),
  status: z.literal('completed'),
  request_sha256: sha256Schema,
  source_revision: z.number().int().positive(),
  source_schema_migration: z.string().min(1),
  source_app_commit: commitSchema,
  archive_id: uuidSchema,
  retention: z.object({ mode: z.literal('teacher_managed'), delete_after: z.null() }).strict(),
  resource_counts: z.record(z.string(), z.number().int().nonnegative()),
  storage_object_counts: z.record(z.string(), z.unknown()),
  storage_bucket: z.literal('classroom-archives'),
  storage_path: z.string().min(1),
  artifact_sha256: sha256Schema,
  content_sha256: sha256Schema,
  compressed_byte_size: z.number().int().positive(),
  uncompressed_byte_size: z.number().int().positive(),
  target_schema_migration: z.string().nullable(),
  adapter_chain: z.array(z.string()).nullable(),
  completed_at: z.string().datetime({ offset: true }),
  error_code: z.null(),
  retryable: z.null(),
  verification: z.record(z.string(), z.unknown()),
}).strict()

const cleanupRowSchema = z.object({
  storage_bucket: z.string().min(1),
  storage_path: z.string().min(1),
  expected_sha256: sha256Schema,
  expected_byte_size: z.number().int().nonnegative(),
  attempt_count: z.number().int().nonnegative(),
  status: z.string().min(1),
  lease_token: z.string().nullable(),
  lease_expires_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
  ownership_verified: z.boolean(),
  ownership_verified_at: z.string().nullable(),
}).strict()

const completedRestoreIdentitySchema = z.object({
  id: uuidSchema,
  teacher_id: uuidSchema,
  classroom_id: uuidSchema,
  archive_id: uuidSchema,
  operation_type: z.literal('restore'),
  status: z.literal('completed'),
}).strict()

function currentCommit(): string {
  return commitSchema.parse(execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim())
}

function assertCleanCheckout(expectedCommit?: string) {
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  if (status) throw new Error('Production archive canary requires a clean checkout')
  const commit = currentCommit()
  if (expectedCommit && commit !== expectedCommit) {
    throw new Error('Production archive canary checkout does not match the approved runner commit')
  }
  return commit
}

function parseArguments() {
  const args = normalizeClassroomArchiveProductionCanaryCliArguments(process.argv.slice(2))
  const command = commandSchema.parse(args[0])
  const planIndex = args.indexOf('--plan')
  if (planIndex < 0 || !args[planIndex + 1]) {
    throw new Error('--plan is required')
  }
  return { command, planPath: planFileSchema.parse(args[planIndex + 1]) }
}

async function writeImmutablePlan(path: string, plan: ClassroomArchiveProductionCanaryPlan) {
  try {
    const existing = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    await existing.close()
    throw new Error('Production archive canary plan already exists')
  } catch (error) {
    if (error instanceof Error && error.message === 'Production archive canary plan already exists') {
      throw error
    }
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const temporaryPath = `${path}.${process.pid}.tmp`
  const handle = await open(temporaryPath, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(plan, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await link(temporaryPath, path)
  } finally {
    await unlink(temporaryPath).catch(() => undefined)
  }
}

async function readPlan(path: string): Promise<ClassroomArchiveProductionCanaryPlan> {
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
      throw new Error('Production archive canary plan must be a mode-0600 regular file')
    }
    return verifyClassroomArchiveProductionCanaryPlan(
      JSON.parse(await handle.readFile('utf8')),
    )
  } finally {
    await handle.close()
  }
}

async function writeAtomicJson(path: string, value: unknown) {
  const temporaryPath = `${path}.${process.pid}.tmp`
  const handle = await open(
    temporaryPath,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
    0o600,
  )
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporaryPath, path)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

function createEventRecorder(planPath: string, plan: ClassroomArchiveProductionCanaryPlan) {
  const journalPath = `${planPath}.events.jsonl`
  const statePath = `${planPath}.state.json`
  return async (event: ClassroomArchiveProductionCanaryEvent) => {
    const record = {
      format: 'pika.classroom-archive-production-canary-event',
      version: 1,
      plan_sha256: plan.plan_sha256,
      recorded_at: new Date().toISOString(),
      ...event,
    }
    const handle = await open(
      journalPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_APPEND | fsConstants.O_NOFOLLOW,
      0o600,
    )
    try {
      const metadata = await handle.stat()
      if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
        throw new Error('Production archive canary evidence files must be mode-0600 regular files')
      }
      await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await writeAtomicJson(statePath, record)
  }
}

function createProductionClient(args: {
  expectedProjectRef: string
  plan?: ClassroomArchiveProductionCanaryPlan
  acknowledgement?: string
}) {
  const supabaseUrl = args.plan && args.acknowledgement !== undefined
    ? assertClassroomArchiveProductionCanaryExecution({
        plan: args.plan,
        acknowledgement: args.acknowledgement,
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        serviceRoleKey: process.env.SUPABASE_SECRET_KEY,
        environment: process.env,
      })
    : assertClassroomArchiveProductionCanaryTarget({
        expectedProjectRef: args.expectedProjectRef,
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        serviceRoleKey: process.env.SUPABASE_SECRET_KEY,
        environment: process.env,
      })
  const targetFetch = createTargetBoundFetch(supabaseUrl)
  return {
    supabaseUrl,
    supabase: getServiceRoleClient({ fetch: targetFetch }),
  }
}

async function readLifecycleState(
  supabase: SupabaseClient,
  classroomId: string,
): Promise<ClassroomArchiveProductionCanaryState> {
  const [classroomResponse, tombstoneResponse] = await Promise.all([
    supabase.from('classrooms')
      .select('id,teacher_id,archived_at')
      .eq('id', classroomId)
      .maybeSingle(),
    supabase.from('classroom_cold_tombstones')
      .select('classroom_id,teacher_id,archive_id')
      .eq('classroom_id', classroomId)
      .maybeSingle(),
  ])
  if (classroomResponse.error || tombstoneResponse.error) {
    throw new Error('Production archive canary lifecycle state could not be read')
  }
  if (classroomResponse.data && tombstoneResponse.data) {
    throw new Error('Production archive canary found conflicting hot and cold lifecycle state')
  }
  if (classroomResponse.data) {
    const classroom = classroomStateRowSchema.parse(classroomResponse.data)
    return { phase: 'hot', teacherId: classroom.teacher_id, archivedAt: classroom.archived_at }
  }
  if (tombstoneResponse.data) {
    const tombstone = tombstoneRowSchema.parse(tombstoneResponse.data)
    return {
      phase: 'cold',
      teacherId: tombstone.teacher_id,
      archiveId: tombstone.archive_id,
    }
  }
  throw new Error('Production archive canary target has no hot classroom or cold tombstone')
}

async function readRestoreCompleted(
  supabase: SupabaseClient,
  plan: ClassroomArchiveProductionCanaryPlan,
): Promise<boolean> {
  const response = await supabase.from('classroom_archive_operations')
    .select('id,teacher_id,classroom_id,archive_id,operation_type,status')
    .eq('id', plan.operation_ids.restore)
    .maybeSingle()
  if (response.error) throw new Error('Production archive canary restore state could not be read')
  if (!response.data) return false
  const operation = completedRestoreIdentitySchema.parse(response.data)
  return operation.teacher_id === plan.teacher_id &&
    operation.classroom_id === plan.classroom_id &&
    operation.archive_id === plan.operation_ids.export
}

function resourceBytes(rows: Array<Record<string, unknown>>): Uint8Array {
  return Buffer.from(rows.map((row) => `${canonicalJsonStringify(row)}\n`).join(''), 'utf8')
}

function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJsonStringify(value)).digest('hex')
}

async function downloadExactStorageBytes(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
): Promise<Uint8Array> {
  const response = await supabase.storage.from(bucket).download(path)
  if (response.error || !response.data) {
    throw new Error('Production archive canary source object could not be read exactly')
  }
  return new Uint8Array(await response.data.arrayBuffer())
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  async function run() {
    while (nextIndex < values.length) {
      const index = nextIndex++
      results[index] = await worker(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run))
  return results
}

async function readCurrentEvidence(args: {
  supabase: SupabaseClient
  supabaseUrl: string
  databaseSizeBytesBefore: number
  serviceRoleKey: string
  classroomId: string
}): Promise<ClassroomArchiveProductionCanaryEvidence> {
  const reader = createSupabaseClassroomArchiveInventoryReader({
    supabase: args.supabase,
    supabaseUrl: args.supabaseUrl,
    secretKey: args.serviceRoleKey,
  })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const revisionBefore = z.number().int().positive().parse(
      await reader.readRevision(args.classroomId),
    )
    const resources = await readClassroomArchiveResourceGraph(reader, args.classroomId)
    const root = resources.classrooms || []
    if (root.length !== 1 || typeof root[0].archived_at !== 'string') {
      throw new Error('Production archive canary target is not an archived hot classroom')
    }
    const resourceDigests = CLASSROOM_RELATIONAL_RESOURCES.map(({ table }) => {
      const rows = resources[table] || []
      const bytes = resourceBytes(rows)
      return {
        table,
        row_count: rows.length,
        byte_size: bytes.byteLength,
        sha256: sha256Bytes(bytes),
      }
    })
    const references = discoverClassroomStorageReferences(resources, args.supabaseUrl)
    const storageDigests = await mapWithConcurrency(references, 4, async (reference) => {
      const bytes = await downloadExactStorageBytes(
        args.supabase,
        reference.bucket,
        reference.path,
      )
      return {
        identity_sha256: classroomArchiveStorageIdentitySha256(
          reference.bucket,
          reference.path,
        ),
        byte_size: bytes.byteLength,
        sha256: sha256Bytes(bytes),
      }
    })
    const revisionAfter = z.number().int().positive().parse(
      await reader.readRevision(args.classroomId),
    )
    if (revisionBefore !== revisionAfter) continue
    return classroomArchiveProductionCanaryEvidenceDigest({
      sourceRevision: revisionAfter,
      resources: resourceDigests,
      storageObjects: storageDigests,
    })
  }
  throw new Error('Production archive canary target changed during exact evidence capture')
}

async function readArchiveEvidence(args: {
  supabase: SupabaseClient
  archiveId: string
  classroomId: string
  teacherId: string
  restoreOperationId: string
  sourceAppCommit: string
  supabaseUrl: string
  verifyOriginalSourceObjects?: boolean
}): Promise<ClassroomArchiveProductionArchiveEvidence | null> {
  const metadataResponse = await args.supabase.from('classroom_archives')
    .select([
      'id',
      'operation_id',
      'classroom_id',
      'teacher_id',
      'format',
      'format_version',
      'storage_bucket',
      'storage_path',
      'artifact_sha256',
      'compressed_byte_size',
      'uncompressed_byte_size',
      'source_revision',
      'source_schema_migration',
      'source_app_commit',
      'content_sha256',
      'retention',
      'resource_counts',
      'storage_object_counts',
      'verification',
      'verified_at',
    ].join(','))
    .eq('id', args.archiveId)
    .eq('classroom_id', args.classroomId)
    .eq('teacher_id', args.teacherId)
    .maybeSingle()
  if (metadataResponse.error) {
    throw new Error('Production archive canary metadata could not be read')
  }
  if (!metadataResponse.data) return null
  const metadata = archiveRowSchema.parse(metadataResponse.data)
  const bytes = await downloadExactStorageBytes(
    args.supabase,
    metadata.storage_bucket,
    metadata.storage_path,
  )
  if (
    bytes.byteLength !== metadata.compressed_byte_size ||
    sha256Bytes(bytes) !== metadata.artifact_sha256 ||
    gunzipSync(bytes).byteLength !== metadata.uncompressed_byte_size
  ) {
    throw new Error('Production archive canary immutable archive bytes do not match metadata')
  }
  const verified = verifyClassroomArchiveBundle(bytes)
  if (!verified.ok) throw new Error('Production archive canary immutable archive is invalid')
  if (
    verified.manifest.archive_id !== metadata.id ||
    verified.manifest.classroom_id !== metadata.classroom_id ||
    verified.manifest.teacher_id !== metadata.teacher_id
  ) {
    throw new Error('Production archive canary immutable archive identity is invalid')
  }
  const manifestResourceCounts = Object.fromEntries(
    verified.manifest.resources.map((resource) => [resource.table, resource.row_count]),
  )
  const manifestStorageCounts = {
    total_count: verified.manifest.storage_objects.length,
    total_bytes: verified.manifest.storage_objects.reduce((sum, object) => sum + object.byte_size, 0),
    by_bucket: Object.fromEntries([...new Set(
      verified.manifest.storage_objects.map((object) => object.bucket),
    )].sort().map((bucket) => {
      const objects = verified.manifest.storage_objects.filter((object) => object.bucket === bucket)
      return [bucket, {
        count: objects.length,
        bytes: objects.reduce((sum, object) => sum + object.byte_size, 0),
      }]
    })),
  }
  if (
    metadata.operation_id !== args.archiveId ||
    metadata.storage_path !== classroomArchiveStoragePath({
      teacherId: args.teacherId,
      classroomId: args.classroomId,
      archiveId: args.archiveId,
    }) ||
    canonicalJsonStringify(metadata.resource_counts) !== canonicalJsonStringify(manifestResourceCounts) ||
    canonicalJsonStringify(metadata.storage_object_counts) !== canonicalJsonStringify(manifestStorageCounts) ||
    [
      'read_back_verified', 'artifact_checksum_verified', 'manifest_verified',
      'resource_checksums_verified', 'resource_counts_verified',
      'storage_objects_verified', 'actor_snapshots_verified',
    ].some((key) => metadata.verification[key] !== true) ||
    verified.manifest.source.app_commit !== args.sourceAppCommit ||
    verified.manifest.source.schema_migration !== metadata.source_schema_migration ||
    verified.manifest.content_sha256 !== metadata.content_sha256 ||
    metadata.source_app_commit !== args.sourceAppCommit ||
    canonicalJsonStringify(verified.manifest.retention) !== canonicalJsonStringify(metadata.retention) ||
    verified.manifest.retention.mode !== 'teacher_managed' ||
    verified.manifest.retention.delete_after !== null
  ) {
    throw new Error('Production archive canary immutable archive source or retention is invalid')
  }
  if (args.verifyOriginalSourceObjects) {
    await mapWithConcurrency(verified.manifest.storage_objects, 4, async (object) => {
      const sourceBytes = await downloadExactStorageBytes(
        args.supabase,
        object.bucket,
        object.source_path,
      )
      if (sourceBytes.byteLength !== object.byte_size || sha256Bytes(sourceBytes) !== object.sha256) {
        throw new Error('Production archive canary original source object changed after restore')
      }
    })
  }
  const evidence = classroomArchiveProductionCanaryEvidenceDigest({
    sourceRevision: metadata.source_revision,
    resources: verified.manifest.resources.map((resource) => ({
      table: resource.table,
      row_count: resource.row_count,
      byte_size: resource.byte_size,
      sha256: resource.sha256,
    })),
    storageObjects: verified.manifest.storage_objects.map((object) => ({
      identity_sha256: classroomArchiveStorageIdentitySha256(
        object.bucket,
        object.source_path,
      ),
      byte_size: object.byte_size,
      sha256: object.sha256,
    })),
  })
  const decoded = decodeClassroomArchiveData(verified)
  const restorePlan = buildClassroomArchiveRestorePlan({
    verified,
    operationId: args.restoreOperationId,
    supabaseUrl: args.supabaseUrl,
    artifactChecksumVerified: true,
    currentActors: decoded.actors.map((actor) => ({
      id: actor.id,
      email: actor.email,
      role: actor.role,
    })),
  })
  const restoredEvidence = classroomArchiveProductionCanaryEvidenceDigest({
    sourceRevision: metadata.source_revision,
    resources: CLASSROOM_RELATIONAL_RESOURCES.map(({ table }) => {
      const rows = restorePlan.resources[table] || []
      const resource = resourceBytes(rows)
      return {
        table,
        row_count: rows.length,
        byte_size: resource.byteLength,
        sha256: sha256Bytes(resource),
      }
    }),
    storageObjects: restorePlan.storageObjects.map((object) => ({
      identity_sha256: classroomArchiveStorageIdentitySha256(
        object.bucket,
        object.restorePath,
      ),
      byte_size: object.bytes.byteLength,
      sha256: object.sha256,
    })),
  })
  const restoredStorageDescriptors = restorePlan.storageObjects.map((object) => ({
    storage_bucket: object.bucket,
    storage_path: object.restorePath,
    expected_sha256: object.sha256,
    expected_byte_size: object.bytes.byteLength,
  })).sort((left, right) => (
    left.storage_bucket.localeCompare(right.storage_bucket) ||
    left.storage_path.localeCompare(right.storage_path)
  ))
  return {
    archiveId: metadata.id,
    classroomId: metadata.classroom_id,
    teacherId: metadata.teacher_id,
    artifactSha256: metadata.artifact_sha256,
    contentSha256: metadata.content_sha256,
    compressedByteSize: metadata.compressed_byte_size,
    uncompressedByteSize: metadata.uncompressed_byte_size,
    manifestSha256: sha256Bytes(Buffer.from(canonicalJsonStringify(verified.manifest), 'utf8')),
    operationRequestSha256: {
      export: canonicalSha256({
        format: 'pika.classroom-archive',
        version: 1,
        classroom_id: args.classroomId,
        retention: metadata.retention,
      }),
      compact: canonicalSha256({
        format: 'pika.classroom-archive',
        version: 1,
        transition: 'archived_hot:archived_cold',
        classroom_id: args.classroomId,
        archive_id: args.archiveId,
      }),
      restore: canonicalSha256({
        operation: 'classroom_archive_restore',
        archive_id: args.archiveId,
        classroom_id: args.classroomId,
        target_schema_migration: CLASSROOM_ARCHIVE_RESTORE_TARGET_MIGRATION,
        storage_objects: restoredStorageDescriptors,
      }),
    },
    storageObjectCounts: metadata.storage_object_counts,
    restoreAdapterChain: restorePlan.adapterChain,
    evidence,
    restoredEvidence,
  }
}

function configureCoordinatorGates(plan: ClassroomArchiveProductionCanaryPlan) {
  process.env.CLASSROOM_ARCHIVE_EXPORT_ENABLED = 'true'
  process.env.CLASSROOM_ARCHIVE_EXPORT_TEACHER_IDS = plan.teacher_id
  process.env.CLASSROOM_ARCHIVE_COMPACTION_ENABLED = 'true'
  process.env.CLASSROOM_ARCHIVE_COMPACTION_TEACHER_IDS = plan.teacher_id
  process.env.CLASSROOM_ARCHIVE_COMPACTION_ARCHIVE_IDS = plan.operation_ids.export
  process.env.CLASSROOM_ARCHIVE_RESTORE_ENABLED = 'true'
  process.env.CLASSROOM_ARCHIVE_RESTORE_TEACHER_IDS = plan.teacher_id
  process.env.CLASSROOM_ARCHIVE_RESTORE_DATABASE_BUDGET_BYTES =
    String(plan.database_budget_bytes)
  process.env.PIKA_APP_COMMIT = plan.source_app_commit
  for (const name of [
    'CLASSROOM_ARCHIVE_SOURCE_CLEANUP_ENABLED',
    'CLASSROOM_ARCHIVE_SOURCE_CLEANUP_TRIGGER_ENABLED',
    'CLASSROOM_ARCHIVE_STAGING_CLEANUP_ENABLED',
    'CLASSROOM_ARCHIVE_OBJECT_CLEANUP_ENABLED',
    'CLASSROOM_GRADEX_CLEANUP_ENABLED',
    'CLASSROOM_GRADEX_CLEANUP_TRIGGER_ENABLED',
  ]) process.env[name] = 'false'
}

async function verifyFinalEvidence(args: {
  supabase: SupabaseClient
  supabaseUrl: string
  databaseSizeBytesBefore: number
  plan: ClassroomArchiveProductionCanaryPlan
  archive: ClassroomArchiveProductionArchiveEvidence
}): Promise<ClassroomArchiveProductionCanaryFinalEvidence> {
  const state = await readLifecycleState(args.supabase, args.plan.classroom_id)
  if (state.phase !== 'hot' || state.teacherId !== args.plan.teacher_id) {
    throw new Error('Production archive canary did not restore the archived hot classroom')
  }
  const retainedArchive = await readArchiveEvidence({
    supabase: args.supabase,
    archiveId: args.plan.operation_ids.export,
    classroomId: args.plan.classroom_id,
    teacherId: args.plan.teacher_id,
    restoreOperationId: args.plan.operation_ids.restore,
    sourceAppCommit: args.plan.source_app_commit,
    supabaseUrl: args.supabaseUrl,
    verifyOriginalSourceObjects: true,
  })
  if (
    !retainedArchive ||
    retainedArchive.artifactSha256 !== args.archive.artifactSha256 ||
    retainedArchive.manifestSha256 !== args.archive.manifestSha256
  ) {
    throw new Error('Production archive canary immutable archive was not retained exactly')
  }

  const operationsResponse = await args.supabase.from('classroom_archive_operations')
    .select([
      'id',
      'teacher_id',
      'classroom_id',
      'operation_type',
      'status',
      'request_sha256',
      'source_revision',
      'source_schema_migration',
      'source_app_commit',
      'archive_id',
      'retention',
      'resource_counts',
      'storage_object_counts',
      'storage_bucket',
      'storage_path',
      'artifact_sha256',
      'content_sha256',
      'compressed_byte_size',
      'uncompressed_byte_size',
      'target_schema_migration',
      'adapter_chain',
      'completed_at',
      'error_code',
      'retryable',
      'verification',
    ].join(','))
    .in('id', Object.values(args.plan.operation_ids))
  if (operationsResponse.error) {
    throw new Error('Production archive canary operation evidence could not be read')
  }
  const operations = z.array(operationRowSchema).parse(operationsResponse.data || [])
  const expectedTypes = new Map([
    [args.plan.operation_ids.export, 'export'],
    [args.plan.operation_ids.compact, 'compact'],
    [args.plan.operation_ids.restore, 'restore'],
  ])
  const requiredVerificationKeys = {
    export: [
      'read_back_verified', 'artifact_checksum_verified', 'manifest_verified',
      'resource_checksums_verified', 'resource_counts_verified',
      'storage_objects_verified', 'actor_snapshots_verified',
    ],
    compact: [
      'read_back_verified', 'artifact_checksum_verified', 'manifest_verified',
      'resource_checksums_verified', 'resource_counts_verified',
      'storage_objects_verified', 'actor_snapshots_verified', 'schema_adapter_verified',
      'actor_references_resolved', 'source_object_cleanup_staged',
      'source_revision_verified', 'resource_ownership_verified',
      'relational_deletion_verified', 'tombstone_verified',
    ],
    restore: [
      'archive_checksum_verified', 'manifest_verified', 'resource_checksums_verified',
      'resource_counts_verified', 'storage_objects_verified', 'actor_snapshots_verified',
      'schema_adapter_available', 'restored_storage_objects_verified',
      'referential_integrity_verified',
    ],
  } as const
  const expectedResourceCounts = Object.fromEntries(
    args.plan.pre_evidence.resources.map((resource) => [resource.table, resource.row_count]),
  )
  const expectedRequestHashes = args.archive.operationRequestSha256
  if (
    operations.length !== 3 ||
    operations.some((operation) => (
      expectedTypes.get(operation.id) !== operation.operation_type ||
      operation.teacher_id !== args.plan.teacher_id ||
      operation.classroom_id !== args.plan.classroom_id ||
      operation.archive_id !== args.plan.operation_ids.export ||
      operation.request_sha256 !== expectedRequestHashes[operation.operation_type] ||
      operation.source_revision !== args.plan.pre_evidence.source_revision ||
      operation.source_app_commit !== args.plan.source_app_commit ||
      operation.source_schema_migration !== '082_verified_classroom_archive_exports' ||
      canonicalJsonStringify(operation.retention) !== canonicalJsonStringify(args.plan.retention) ||
      canonicalJsonStringify(operation.resource_counts) !== canonicalJsonStringify(expectedResourceCounts) ||
      canonicalJsonStringify(operation.storage_object_counts) !==
        canonicalJsonStringify(args.archive.storageObjectCounts) ||
      operation.storage_bucket !== 'classroom-archives' ||
      operation.storage_path !== classroomArchiveStoragePath({
        teacherId: args.plan.teacher_id,
        classroomId: args.plan.classroom_id,
        archiveId: args.plan.operation_ids.export,
      }) ||
      operation.artifact_sha256 !== args.archive.artifactSha256 ||
      operation.content_sha256 !== args.archive.contentSha256 ||
      operation.compressed_byte_size !== args.archive.compressedByteSize ||
      operation.uncompressed_byte_size !== args.archive.uncompressedByteSize ||
      (operation.operation_type === 'restore'
        ? operation.target_schema_migration !== CLASSROOM_ARCHIVE_RESTORE_TARGET_MIGRATION ||
          canonicalJsonStringify(operation.adapter_chain) !==
            canonicalJsonStringify(args.archive.restoreAdapterChain)
        : operation.target_schema_migration !== null || operation.adapter_chain !== null) ||
      requiredVerificationKeys[operation.operation_type]
        .some((key) => operation.verification[key] !== true)
    ))
  ) {
    throw new Error('Production archive canary completed operation evidence is invalid')
  }

  const cleanupResponse = await args.supabase
    .from('classroom_archive_source_object_cleanup')
    .select([
      'storage_bucket',
      'storage_path',
      'expected_sha256',
      'expected_byte_size',
      'attempt_count',
      'status',
      'lease_token',
      'lease_expires_at',
      'deleted_at',
      'ownership_verified',
      'ownership_verified_at',
    ].join(','))
    .eq('operation_id', args.plan.operation_ids.compact)
  if (cleanupResponse.error) {
    throw new Error('Production archive canary cleanup evidence could not be read')
  }
  const cleanupRows = z.array(cleanupRowSchema).parse(cleanupResponse.data || [])
  const cleanupDescriptors = cleanupRows.map((row) => ({
    identity_sha256: classroomArchiveStorageIdentitySha256(row.storage_bucket, row.storage_path),
    byte_size: row.expected_byte_size,
    sha256: row.expected_sha256,
  })).sort((left, right) => left.identity_sha256.localeCompare(right.identity_sha256))
  if (
    canonicalJsonStringify(cleanupDescriptors) !==
      canonicalJsonStringify(args.plan.pre_evidence.storage_objects) ||
    cleanupRows.some((row) => (
    row.attempt_count !== 0 ||
    row.status !== 'pending' ||
    row.lease_token !== null ||
    row.lease_expires_at !== null ||
    row.deleted_at !== null ||
    row.ownership_verified ||
    row.ownership_verified_at !== null
    ))
  ) {
    throw new Error('Production archive canary source cleanup did not remain untouched')
  }
  const reservationsResponse = await args.supabase
    .from('classroom_archive_source_object_reservations')
    .select('operation_id', { count: 'exact', head: true })
    .eq('operation_id', args.plan.operation_ids.compact)
  if (reservationsResponse.error || reservationsResponse.count !== 0) {
    throw new Error('Production archive canary unexpectedly reserved source object ownership')
  }
  const [stagingResponse, uploadCleanupResponse] = await Promise.all([
    args.supabase.from('classroom_archive_restore_staging')
      .select('operation_id', { count: 'exact', head: true })
      .eq('operation_id', args.plan.operation_ids.restore),
    args.supabase.from('classroom_archive_object_upload_cleanup')
      .select('operation_id', { count: 'exact', head: true })
      .eq('operation_id', args.plan.operation_ids.restore),
  ])
  if (
    stagingResponse.error || stagingResponse.count !== 0 ||
    uploadCleanupResponse.error || uploadCleanupResponse.count !== 0
  ) {
    throw new Error('Production archive canary restore staging cleanup is incomplete')
  }
  const databaseSizeBytesAfter = await readProductionDatabaseSizeBytes(
    args.plan.expected_project_ref,
  )
  if (databaseSizeBytesAfter >= args.plan.database_budget_bytes) {
    throw new Error('Production archive canary database size reached or exceeded its budget')
  }

  return {
    archiveRetained: true,
    archiveBytesVerified: true,
    hotClassroomRestored: true,
    coldTombstoneRemoved: true,
    operationsCompleted: true,
    sourceCleanupDeletedCount: 0,
    sourceCleanupOwnershipVerifiedCount: 0,
    sourceCleanupAttemptCount: 0,
    databaseWithinBudget: true,
    databaseSizeBytesBefore: args.databaseSizeBytesBefore,
    databaseSizeBytesAfter,
  }
}

async function assertPreparePreconditions(args: {
  supabase: SupabaseClient
  teacherId: string
  classroomId: string
}) {
  const state = await readLifecycleState(args.supabase, args.classroomId)
  if (state.phase !== 'hot' || state.teacherId !== args.teacherId) {
    throw new Error('Production archive canary prepare target is not the approved hot classroom')
  }
  const operations = await args.supabase.from('classroom_archive_operations')
    .select('id', { count: 'exact', head: true })
    .eq('classroom_id', args.classroomId)
  if (operations.error || operations.count !== 0) {
    throw new Error('Production archive canary prepare target already has lifecycle operations')
  }
}

async function readAcknowledgement(plan: ClassroomArchiveProductionCanaryPlan): Promise<string> {
  const expected = classroomArchiveProductionCanaryAcknowledgement(plan)
  process.stderr.write(`Type the exact acknowledgement to continue:\n${expected}\n> `)
  const readline = createInterface({ input: process.stdin, output: process.stderr })
  try {
    return await readline.question('')
  } finally {
    readline.close()
  }
}

async function prepare(planPath: string) {
  const commit = assertCleanCheckout()
  const expectedProjectRef = projectRefSchema.parse(
    process.env.CLASSROOM_ARCHIVE_PRODUCTION_CANARY_EXPECTED_PROJECT_REF,
  )
  const teacherId = uuidSchema.parse(
    process.env.CLASSROOM_ARCHIVE_PRODUCTION_CANARY_TEACHER_ID,
  )
  const classroomId = uuidSchema.parse(
    process.env.CLASSROOM_ARCHIVE_PRODUCTION_CANARY_CLASSROOM_ID,
  )
  const databaseBudgetBytes = z.coerce.number().int().positive().parse(
    process.env.CLASSROOM_ARCHIVE_PRODUCTION_CANARY_DATABASE_BUDGET_BYTES,
  )
  const { supabase, supabaseUrl } = createProductionClient({ expectedProjectRef })
  await assertPreparePreconditions({ supabase, teacherId, classroomId })
  const preEvidence = await readCurrentEvidence({
    supabase,
    supabaseUrl,
    serviceRoleKey: z.string().min(1).parse(process.env.SUPABASE_SECRET_KEY),
    classroomId,
  })
  const databaseSizeBytesBefore = await readProductionDatabaseSizeBytes(expectedProjectRef)
  if (databaseSizeBytesBefore >= databaseBudgetBytes) {
    throw new Error('Production archive canary database is already at or above its budget')
  }
  const plan = createClassroomArchiveProductionCanaryPlan({
    approvedRunnerCommit: commit,
    expectedProjectRef,
    supabaseUrl,
    teacherId,
    classroomId,
    sourceAppCommit: commit,
    databaseBudgetBytes,
    databaseSizeBytesBefore,
    preEvidence,
  })
  await writeImmutablePlan(planPath, plan)
  process.stdout.write(`${JSON.stringify({
    status: 'prepared',
    plan_sha256: plan.plan_sha256,
    resource_table_count: plan.pre_evidence.resources.length,
    storage_object_count: plan.pre_evidence.storage_objects.length,
    evidence_sha256: plan.pre_evidence.evidence_sha256,
    acknowledgement: classroomArchiveProductionCanaryAcknowledgement(plan),
  }, null, 2)}\n`)
}

async function execute(planPath: string) {
  const plan = await readPlan(planPath)
  assertCleanCheckout(plan.approved_runner_commit)
  const acknowledgement = await readAcknowledgement(plan)
  const { supabase, supabaseUrl } = createProductionClient({
    expectedProjectRef: plan.expected_project_ref,
    plan,
    acknowledgement,
  })
  const databaseSizeBytesBefore = await readProductionDatabaseSizeBytes(
    plan.expected_project_ref,
  )
  if (
    databaseSizeBytesBefore + MINIMUM_DATABASE_SAFETY_MARGIN_BYTES >=
      plan.database_budget_bytes
  ) {
    throw new Error('Production archive canary lacks the minimum database safety margin')
  }
  configureCoordinatorGates(plan)
  const serviceRoleKey = z.string().min(1).parse(process.env.SUPABASE_SECRET_KEY)
  const archiveReader = () => readArchiveEvidence({
    supabase,
    archiveId: plan.operation_ids.export,
    classroomId: plan.classroom_id,
    teacherId: plan.teacher_id,
    restoreOperationId: plan.operation_ids.restore,
    sourceAppCommit: plan.source_app_commit,
    supabaseUrl,
  })
  const result = await runClassroomArchiveProductionCanary({
    plan,
    dependencies: {
      readState: () => readLifecycleState(supabase, plan.classroom_id),
      readCurrentEvidence: () => readCurrentEvidence({
        supabase,
        supabaseUrl,
        serviceRoleKey,
        classroomId: plan.classroom_id,
      }),
      readArchiveEvidence: archiveReader,
      readRestoreCompleted: () => readRestoreCompleted(supabase, plan),
      exportArchive: () => exportClassroomArchive({
        supabase,
        operationId: plan.operation_ids.export,
        teacherId: plan.teacher_id,
        classroomId: plan.classroom_id,
        retention: plan.retention,
        sourceAppCommit: plan.source_app_commit,
        supabaseUrl,
      }),
      compactArchive: async () => {
        const archive = await archiveReader()
        if (!archive) throw new Error('Production archive canary archive is unavailable before compaction')
        const databaseSize = await readProductionDatabaseSizeBytes(plan.expected_project_ref)
        const safetyMargin = Math.max(
          MINIMUM_DATABASE_SAFETY_MARGIN_BYTES,
          archive.uncompressedByteSize * 4,
        )
        if (databaseSize + safetyMargin >= plan.database_budget_bytes) {
          throw new Error('Production archive canary database safety margin is insufficient')
        }
        return compactClassroomArchive({
          supabase,
          operationId: plan.operation_ids.compact,
          teacherId: plan.teacher_id,
          classroomId: plan.classroom_id,
          archiveId: plan.operation_ids.export,
          supabaseUrl,
        })
      },
      restoreArchive: () => restoreClassroomArchive({
        supabase,
        operationId: plan.operation_ids.restore,
        archiveId: plan.operation_ids.export,
        teacherId: plan.teacher_id,
        classroomId: plan.classroom_id,
        databaseBudgetBytes: plan.database_budget_bytes,
        supabaseUrl,
      }),
      verifyFinal: async ({ archive }) => verifyFinalEvidence({
        supabase,
        supabaseUrl,
        databaseSizeBytesBefore,
        plan,
        archive,
      }),
      recordEvent: createEventRecorder(planPath, plan),
    },
  })
  const archive = await archiveReader()
  if (!archive) throw new Error('Production archive canary final archive evidence is unavailable')
  assertClassroomArchiveProductionCanaryEvidenceEqual({
    expected: plan.pre_evidence,
    actual: archive.evidence,
    compareRevision: true,
  })
  process.stdout.write(`${JSON.stringify({
    format: 'pika.classroom-archive-production-canary-result',
    version: 1,
    status: 'passed',
    target_project_ref: plan.expected_project_ref,
    ...result,
  }, null, 2)}\n`)
}

async function main() {
  const { command, planPath } = parseArguments()
  if (command === 'prepare') await prepare(planPath)
  else await execute(planPath)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown production archive canary failure'
  process.stderr.write(`Production classroom archive canary failed: ${message}\n`)
  process.exitCode = 1
})
