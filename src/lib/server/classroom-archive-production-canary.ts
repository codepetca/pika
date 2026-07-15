import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { CLASSROOM_RELATIONAL_RESOURCES } from '@/lib/contracts/classroom-data'
import {
  canonicalJsonStringify,
  decodeClassroomArchiveData,
  type VerifiedClassroomArchiveBundle,
} from '@/lib/server/classroom-archive-format'
import type { ClassroomArchiveCompactionResult } from '@/lib/server/classroom-archive-compaction'
import type { ClassroomArchiveExportResult } from '@/lib/server/classroom-archive-operations'
import type { ClassroomArchiveRestoreResult } from '@/lib/server/classroom-archive-restore-operations'
import { verifyHostedSupabaseApiOrigin } from '@/lib/server/supabase-target'

export const CLASSROOM_ARCHIVE_PRODUCTION_CANARY_PLAN_VERSION = 1 as const
export const CLASSROOM_ARCHIVE_PRODUCTION_CANARY_ACK_PREFIX = 'COMPACT_AND_RESTORE'

export function normalizeClassroomArchiveProductionCanaryCliArguments(
  args: string[],
): string[] {
  return args[0] === '--' ? args.slice(1) : args
}

const uuidSchema = z.string().uuid()
const projectRefSchema = z.string().regex(/^[a-z0-9]{20}$/)
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/)
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

const cleanupGateNames = [
  'CLASSROOM_ARCHIVE_SOURCE_CLEANUP_ENABLED',
  'CLASSROOM_ARCHIVE_SOURCE_CLEANUP_TRIGGER_ENABLED',
  'CLASSROOM_ARCHIVE_STAGING_CLEANUP_ENABLED',
  'CLASSROOM_ARCHIVE_OBJECT_CLEANUP_ENABLED',
  'CLASSROOM_GRADEX_CLEANUP_ENABLED',
  'CLASSROOM_GRADEX_CLEANUP_TRIGGER_ENABLED',
] as const

const hostedServiceRoleClaimsSchema = z.object({
  role: z.literal('service_role'),
  ref: projectRefSchema,
}).passthrough()

const resourceDigestSchema = z.object({
  table: z.string().min(1),
  row_count: z.number().int().nonnegative(),
  byte_size: z.number().int().nonnegative(),
  sha256: sha256Schema,
}).strict()

const storageDigestSchema = z.object({
  identity_sha256: sha256Schema,
  byte_size: z.number().int().nonnegative(),
  sha256: sha256Schema,
}).strict()

export const classroomArchiveProductionCanaryEvidenceSchema = z.object({
  source_revision: z.number().int().positive(),
  resources: z.array(resourceDigestSchema),
  storage_objects: z.array(storageDigestSchema),
  evidence_sha256: sha256Schema,
}).strict().superRefine((evidence, context) => {
  const computedDigest = createHash('sha256').update(canonicalJsonStringify({
    resources: [...evidence.resources].sort((left, right) => left.table.localeCompare(right.table)),
    storage_objects: [...evidence.storage_objects]
      .sort((left, right) => left.identity_sha256.localeCompare(right.identity_sha256)),
  })).digest('hex')
  if (computedDigest !== evidence.evidence_sha256) {
    context.addIssue({
      code: 'custom',
      message: 'Production canary evidence digest does not match its contents',
      path: ['evidence_sha256'],
    })
  }
  const expectedTables = CLASSROOM_RELATIONAL_RESOURCES.map(({ table }) => table).sort()
  const actualTables = evidence.resources.map(({ table }) => table).sort()
  if (canonicalJsonStringify(actualTables) !== canonicalJsonStringify(expectedTables)) {
    context.addIssue({
      code: 'custom',
      message: 'Production canary evidence does not cover the exact classroom resource contract',
      path: ['resources'],
    })
  }
  if (new Set(actualTables).size !== actualTables.length) {
    context.addIssue({
      code: 'custom',
      message: 'Production canary evidence contains duplicate classroom resources',
      path: ['resources'],
    })
  }
  const identities = evidence.storage_objects.map(({ identity_sha256 }) => identity_sha256)
  if (new Set(identities).size !== identities.length) {
    context.addIssue({
      code: 'custom',
      message: 'Production canary evidence contains duplicate storage identities',
      path: ['storage_objects'],
    })
  }
})

const operationIdsSchema = z.object({
  export: uuidSchema,
  compact: uuidSchema,
  restore: uuidSchema,
}).strict().refine((ids) => new Set(Object.values(ids)).size === 3, {
  message: 'Production canary operation IDs must be distinct',
})

const planPayloadSchema = z.object({
  format: z.literal('pika.classroom-archive-production-canary-plan'),
  version: z.literal(CLASSROOM_ARCHIVE_PRODUCTION_CANARY_PLAN_VERSION),
  prepared_at: z.string().datetime({ offset: true }),
  approved_runner_commit: commitSchema,
  expected_project_ref: projectRefSchema,
  supabase_origin: z.string().url(),
  run_id: uuidSchema,
  teacher_id: uuidSchema,
  classroom_id: uuidSchema,
  operation_ids: operationIdsSchema,
  source_app_commit: commitSchema,
  database_budget_bytes: z.number().int().positive(),
  database_size_bytes_before: z.number().int().positive(),
  retention: z.object({
    mode: z.literal('teacher_managed'),
    delete_after: z.null(),
  }).strict(),
  pre_evidence: classroomArchiveProductionCanaryEvidenceSchema,
}).strict()

export const classroomArchiveProductionCanaryPlanSchema = planPayloadSchema.extend({
  plan_sha256: sha256Schema,
}).strict()

export type ClassroomArchiveProductionCanaryEvidence = z.infer<
  typeof classroomArchiveProductionCanaryEvidenceSchema
>
export type ClassroomArchiveProductionCanaryPlan = z.infer<
  typeof classroomArchiveProductionCanaryPlanSchema
>

export type ClassroomArchiveProductionCanaryState =
  | { phase: 'hot'; teacherId: string; archivedAt: string }
  | { phase: 'cold'; teacherId: string; archiveId: string }

export type ClassroomArchiveProductionCanaryStorageMapping = {
  bucket: string
  sourcePath: string
  restorePath: string
}

export function assertClassroomArchiveProductionCanaryStorageMappingsEqual(args: {
  independent: ClassroomArchiveProductionCanaryStorageMapping[]
  planned: ClassroomArchiveProductionCanaryStorageMapping[]
}): void {
  const normalize = (mappings: ClassroomArchiveProductionCanaryStorageMapping[]) =>
    mappings.map((mapping) => ({
      bucket: z.string().min(1).parse(mapping.bucket),
      sourcePath: z.string().min(1).parse(mapping.sourcePath),
      restorePath: z.string().min(1).parse(mapping.restorePath),
    })).sort((left, right) => (
      left.bucket.localeCompare(right.bucket) ||
      left.sourcePath.localeCompare(right.sourcePath) ||
      left.restorePath.localeCompare(right.restorePath)
    ))
  if (
    canonicalJsonStringify(normalize(args.independent)) !==
    canonicalJsonStringify(normalize(args.planned))
  ) {
    throw new Error('Production archive canary independent restored paths differ')
  }
}

export type ClassroomArchiveProductionArchiveEvidence = {
  archiveId: string
  teacherId: string
  classroomId: string
  artifactSha256: string
  contentSha256: string
  compressedByteSize: number
  uncompressedByteSize: number
  manifestSha256: string
  operationRequestSha256: { export: string; compact: string; restore: string }
  storageObjectCounts: Record<string, unknown>
  restoreAdapterChain: string[]
  restoredStorageMappings: ClassroomArchiveProductionCanaryStorageMapping[]
  evidence: ClassroomArchiveProductionCanaryEvidence
  restoredEvidence: ClassroomArchiveProductionCanaryEvidence
}

export type ClassroomArchiveProductionCanaryFinalEvidence = {
  archiveRetained: true
  archiveBytesVerified: true
  hotClassroomRestored: true
  coldTombstoneRemoved: true
  operationsCompleted: true
  sourceCleanupDeletedCount: 0
  sourceCleanupOwnershipVerifiedCount: 0
  sourceCleanupAttemptCount: 0
  databaseWithinBudget: true
  databaseSizeBytesBefore: number
  databaseSizeBytesAfter: number
}

export type ClassroomArchiveProductionCanaryResult = {
  ok: true
  runId: string
  resumedFromCold: boolean
  exportReplayed: boolean
  compactionReplayed: boolean
  restoreReplayed: boolean
  restoreAttempts: number
  compressedByteSize: number
  uncompressedByteSize: number
  resourceTableCount: number
  storageObjectCount: number
  evidenceSha256: string
  finalEvidence: ClassroomArchiveProductionCanaryFinalEvidence
}

export type ClassroomArchiveProductionCanaryEvent = {
  phase: 'preflight' | 'export' | 'compact' | 'restore' | 'verify'
  status: 'started' | 'completed' | 'reconciled' | 'failed'
  errorCode?: string
}

export type ClassroomArchiveProductionCanaryDependencies = {
  readState(): Promise<ClassroomArchiveProductionCanaryState>
  readCurrentEvidence(): Promise<ClassroomArchiveProductionCanaryEvidence>
  readRestoredEvidence(
    archive: ClassroomArchiveProductionArchiveEvidence,
  ): Promise<ClassroomArchiveProductionCanaryEvidence>
  readArchiveEvidence(): Promise<ClassroomArchiveProductionArchiveEvidence | null>
  readRestoreCompleted(): Promise<boolean>
  exportArchive(): Promise<ClassroomArchiveExportResult>
  compactArchive(): Promise<ClassroomArchiveCompactionResult>
  restoreArchive(): Promise<ClassroomArchiveRestoreResult>
  verifyFinal(args: {
    archive: ClassroomArchiveProductionArchiveEvidence
    operationIds: ClassroomArchiveProductionCanaryPlan['operation_ids']
  }): Promise<ClassroomArchiveProductionCanaryFinalEvidence>
  recordEvent(event: ClassroomArchiveProductionCanaryEvent): Promise<void>
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export function deriveClassroomArchiveProductionCanaryRestoredStoragePath(args: {
  classroomId: string
  operationId: string
  sha256: string
  sourcePath: string
  contentType: string | null
}): string {
  const objectIdentity = sha256(
    `${z.string().min(1).parse(args.sourcePath)}\0${args.contentType ?? '<null>'}`,
  )
  return [
    'restores',
    uuidSchema.parse(args.classroomId),
    uuidSchema.parse(args.operationId),
    `${objectIdentity}-${sha256Schema.parse(args.sha256)}`,
  ].join('/')
}

function normalizeCanaryStorageMappings(
  mappings: ClassroomArchiveProductionCanaryStorageMapping[],
  storagePathKind: 'source' | 'restored',
): Map<string, string> {
  const paths = new Map<string, string>()
  for (const mapping of mappings) {
    const bucket = z.string().min(1).parse(mapping.bucket)
    const sourcePath = z.string().min(1).parse(mapping.sourcePath)
    const restorePath = z.string().min(1).parse(mapping.restorePath)
    const identity = sha256(`${bucket}\0${sourcePath}`)
    const path = storagePathKind === 'source' ? sourcePath : restorePath
    const key = `${bucket}\0${path}`
    const existing = paths.get(key)
    if (existing && existing !== identity) {
      throw new Error('Production canary storage normalization is ambiguous')
    }
    paths.set(key, identity)
  }
  return paths
}

function normalizeCanaryManagedUrls(
  value: string,
  supabaseOrigin: string,
  paths: Map<string, string>,
  storagePathKind: 'source' | 'restored',
): string {
  return value.replace(/https?:\/\/[^\s<>"'`]+/gi, (candidate) => {
    const stripped = candidate.replace(/[),.;:!?]+$/, '')
    const suffix = candidate.slice(stripped.length)
    try {
      const url = new URL(stripped)
      if (url.origin !== supabaseOrigin) return candidate
      const match = url.pathname.match(
        /^\/storage\/v1\/object\/(public|sign|authenticated)\/([^/]+)\/(.+)$/,
      )
      if (!match) return candidate
      const bucket = decodeURIComponent(match[2])
      const path = decodeURIComponent(match[3])
      if (storagePathKind === 'restored') {
        const canonicalPath = [
          '',
          'storage',
          'v1',
          'object',
          'public',
          encodeURIComponent(bucket),
          ...path.split('/').map((segment) => encodeURIComponent(segment)),
        ].join('/')
        if (stripped !== `${supabaseOrigin}${canonicalPath}`) return candidate
      }
      const identity = paths.get(`${bucket}\0${path}`)
      return identity ? `pika-storage-object:${identity}${suffix}` : candidate
    } catch {
      return candidate
    }
  })
}

function normalizeCanaryResourceValue(args: {
  value: unknown
  table: string
  key?: string
  inTestDocuments?: boolean
  supabaseOrigin: string
  paths: Map<string, string>
  storagePathKind: 'source' | 'restored'
}): unknown {
  if (typeof args.value === 'string') {
    const directBucket = args.table === 'assignment_submission_artifacts' &&
      args.key === 'storage_path'
      ? 'assignment-artifacts'
      : args.table === 'tests' && args.inTestDocuments && args.key === 'snapshot_path'
        ? 'test-documents'
        : null
    if (directBucket) {
      const identity = args.paths.get(`${directBucket}\0${args.value}`)
      return identity ? `pika-storage-object:${identity}` : args.value
    }
    return normalizeCanaryManagedUrls(
      args.value,
      args.supabaseOrigin,
      args.paths,
      args.storagePathKind,
    )
  }
  if (Array.isArray(args.value)) {
    return args.value.map((value) => normalizeCanaryResourceValue({ ...args, value }))
  }
  if (!args.value || typeof args.value !== 'object') return args.value
  return Object.fromEntries(Object.entries(args.value).map(([key, value]) => [
    key,
    normalizeCanaryResourceValue({
      ...args,
      value,
      key,
      inTestDocuments: args.inTestDocuments ||
        (args.table === 'tests' && key === 'documents'),
    }),
  ]))
}

export function normalizeClassroomArchiveProductionCanaryResources(args: {
  resources: Record<string, Array<Record<string, unknown>>>
  storageMappings: ClassroomArchiveProductionCanaryStorageMapping[]
  storagePathKind: 'source' | 'restored'
  supabaseUrl: string
}): Record<string, Array<Record<string, unknown>>> {
  const supabaseOrigin = new URL(args.supabaseUrl).origin
  const paths = normalizeCanaryStorageMappings(args.storageMappings, args.storagePathKind)
  return Object.fromEntries(Object.entries(args.resources).map(([table, rows]) => [
    table,
    rows.map((row) => normalizeCanaryResourceValue({
      value: row,
      table,
      supabaseOrigin,
      paths,
      storagePathKind: args.storagePathKind,
    }) as Record<string, unknown>),
  ]))
}

export function createClassroomArchiveProductionCanaryNormalizedEvidence(args: {
  sourceRevision: number
  resources: Record<string, Array<Record<string, unknown>>>
  storageObjects: Array<{
    bucket: string
    path: string
    byteSize: number
    sha256: string
  }>
  storageMappings: ClassroomArchiveProductionCanaryStorageMapping[]
  storagePathKind: 'source' | 'restored'
  supabaseUrl: string
}): ClassroomArchiveProductionCanaryEvidence {
  if (args.storageObjects.length !== args.storageMappings.length) {
    throw new Error('Production canary normalized storage object count differs')
  }
  const sourcePaths = new Map(args.storageMappings.map((mapping) => [
    `${mapping.bucket}\0${
      args.storagePathKind === 'source' ? mapping.sourcePath : mapping.restorePath
    }`,
    mapping.sourcePath,
  ]))
  const seenSourceIdentities = new Set<string>()
  const storageObjects = args.storageObjects.map((object) => {
    const sourcePath = sourcePaths.get(`${object.bucket}\0${object.path}`)
    if (!sourcePath) {
      throw new Error(
        `Production canary ${args.storagePathKind} storage object path is unknown`,
      )
    }
    const identitySha256 = sha256(`${object.bucket}\0${sourcePath}`)
    if (seenSourceIdentities.has(identitySha256)) {
      throw new Error('Production canary normalized storage object identity is duplicated')
    }
    seenSourceIdentities.add(identitySha256)
    return {
      identity_sha256: identitySha256,
      byte_size: z.number().int().nonnegative().parse(object.byteSize),
      sha256: sha256Schema.parse(object.sha256),
    }
  })
  const resources = normalizeClassroomArchiveProductionCanaryResources({
    resources: args.resources,
    storageMappings: args.storageMappings,
    storagePathKind: args.storagePathKind,
    supabaseUrl: args.supabaseUrl,
  })
  return classroomArchiveProductionCanaryEvidenceDigest({
    sourceRevision: args.sourceRevision,
    resources: CLASSROOM_RELATIONAL_RESOURCES.map(({ table }) => {
      const rows = resources[table] || []
      const bytes = Buffer.from(
        rows.map((row) => `${canonicalJsonStringify(row)}\n`).join(''),
        'utf8',
      )
      return {
        table,
        row_count: rows.length,
        byte_size: bytes.byteLength,
        sha256: sha256(bytes),
      }
    }),
    storageObjects,
  })
}

export function createClassroomArchiveProductionCanaryArchiveProjection(args: {
  verified: Extract<VerifiedClassroomArchiveBundle, { ok: true }>
  sourceRevision: number
  restoreOperationId: string
  supabaseUrl: string
}): {
  restoredStorageMappings: ClassroomArchiveProductionCanaryStorageMapping[]
  restoredEvidence: ClassroomArchiveProductionCanaryEvidence
} {
  const decoded = decodeClassroomArchiveData(args.verified)
  const restoredStorageMappings = args.verified.manifest.storage_objects.map((object) => ({
    bucket: object.bucket,
    sourcePath: object.source_path,
    restorePath: deriveClassroomArchiveProductionCanaryRestoredStoragePath({
      classroomId: args.verified.manifest.classroom_id,
      operationId: args.restoreOperationId,
      sha256: object.sha256,
      sourcePath: object.source_path,
      contentType: object.content_type,
    }),
  }))
  return {
    restoredStorageMappings,
    restoredEvidence: createClassroomArchiveProductionCanaryNormalizedEvidence({
      sourceRevision: args.sourceRevision,
      resources: decoded.resources,
      storageObjects: args.verified.manifest.storage_objects.map((object) => ({
        bucket: object.bucket,
        path: object.source_path,
        byteSize: object.byte_size,
        sha256: object.sha256,
      })),
      storageMappings: restoredStorageMappings,
      storagePathKind: 'source',
      supabaseUrl: args.supabaseUrl,
    }),
  }
}

export function createClassroomArchiveProductionCanaryVerifiedArchiveProjection(args: {
  verified: Extract<VerifiedClassroomArchiveBundle, { ok: true }>
  sourceRevision: number
  restoreOperationId: string
  supabaseUrl: string
  plannedStorageMappings: ClassroomArchiveProductionCanaryStorageMapping[]
}): {
  restoredStorageMappings: ClassroomArchiveProductionCanaryStorageMapping[]
  restoredEvidence: ClassroomArchiveProductionCanaryEvidence
} {
  const projection = createClassroomArchiveProductionCanaryArchiveProjection(args)
  assertClassroomArchiveProductionCanaryStorageMappingsEqual({
    independent: projection.restoredStorageMappings,
    planned: args.plannedStorageMappings,
  })
  return projection
}

function decodeJwtClaims(value: string): unknown {
  const segments = value.split('.')
  if (segments.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function isEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function deriveClassroomArchiveProductionCanaryOperationId(
  runId: string,
  phase: 'export' | 'compact' | 'restore',
): string {
  const parsedRunId = uuidSchema.parse(runId)
  const bytes = createHash('sha256')
    .update(`pika.classroom-archive-production-canary:v1:${parsedRunId}:${phase}`)
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return uuidSchema.parse([
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-'))
}

export function classroomArchiveProductionCanaryEvidenceDigest(args: {
  sourceRevision: number
  resources: Array<z.infer<typeof resourceDigestSchema>>
  storageObjects: Array<z.infer<typeof storageDigestSchema>>
}): ClassroomArchiveProductionCanaryEvidence {
  const payload = {
    source_revision: z.number().int().positive().parse(args.sourceRevision),
    resources: z.array(resourceDigestSchema).parse(args.resources)
      .sort((left, right) => left.table.localeCompare(right.table)),
    storage_objects: z.array(storageDigestSchema).parse(args.storageObjects)
      .sort((left, right) => left.identity_sha256.localeCompare(right.identity_sha256)),
  }
  return classroomArchiveProductionCanaryEvidenceSchema.parse({
    ...payload,
    evidence_sha256: sha256(canonicalJsonStringify({
      resources: payload.resources,
      storage_objects: payload.storage_objects,
    })),
  })
}

export function classroomArchiveStorageIdentitySha256(bucket: string, path: string): string {
  return sha256(`${z.string().min(1).parse(bucket)}\0${z.string().min(1).parse(path)}`)
}

export function createClassroomArchiveProductionCanaryPlan(args: {
  preparedAt?: string
  approvedRunnerCommit: string
  expectedProjectRef: string
  supabaseUrl: string
  runId?: string
  teacherId: string
  classroomId: string
  sourceAppCommit: string
  databaseBudgetBytes: number
  databaseSizeBytesBefore: number
  preEvidence: ClassroomArchiveProductionCanaryEvidence
}): ClassroomArchiveProductionCanaryPlan {
  const expectedProjectRef = projectRefSchema.parse(args.expectedProjectRef)
  const runId = uuidSchema.parse(args.runId || randomUUID())
  const payload = planPayloadSchema.parse({
    format: 'pika.classroom-archive-production-canary-plan',
    version: CLASSROOM_ARCHIVE_PRODUCTION_CANARY_PLAN_VERSION,
    prepared_at: args.preparedAt || new Date().toISOString(),
    approved_runner_commit: args.approvedRunnerCommit,
    expected_project_ref: expectedProjectRef,
    supabase_origin: verifyHostedSupabaseApiOrigin(args.supabaseUrl, expectedProjectRef),
    run_id: runId,
    teacher_id: args.teacherId,
    classroom_id: args.classroomId,
    operation_ids: {
      export: deriveClassroomArchiveProductionCanaryOperationId(runId, 'export'),
      compact: deriveClassroomArchiveProductionCanaryOperationId(runId, 'compact'),
      restore: deriveClassroomArchiveProductionCanaryOperationId(runId, 'restore'),
    },
    source_app_commit: args.sourceAppCommit,
    database_budget_bytes: args.databaseBudgetBytes,
    database_size_bytes_before: args.databaseSizeBytesBefore,
    retention: { mode: 'teacher_managed', delete_after: null },
    pre_evidence: args.preEvidence,
  })
  return classroomArchiveProductionCanaryPlanSchema.parse({
    ...payload,
    plan_sha256: sha256(canonicalJsonStringify(payload)),
  })
}

export function verifyClassroomArchiveProductionCanaryPlan(
  value: unknown,
): ClassroomArchiveProductionCanaryPlan {
  const plan = classroomArchiveProductionCanaryPlanSchema.parse(value)
  const { plan_sha256: digest, ...payload } = plan
  if (sha256(canonicalJsonStringify(payload)) !== digest) {
    throw new Error('Production archive canary plan digest does not match its contents')
  }
  verifyHostedSupabaseApiOrigin(plan.supabase_origin, plan.expected_project_ref)
  return plan
}

export function classroomArchiveProductionCanaryAcknowledgement(
  plan: ClassroomArchiveProductionCanaryPlan,
): string {
  return `${CLASSROOM_ARCHIVE_PRODUCTION_CANARY_ACK_PREFIX} ${plan.expected_project_ref} ${plan.plan_sha256}`
}

export function assertClassroomArchiveProductionCanaryExecution(args: {
  plan: ClassroomArchiveProductionCanaryPlan
  acknowledgement: string
  supabaseUrl: string | undefined
  serviceRoleKey: string | undefined
  environment: NodeJS.ProcessEnv
}): string {
  const plan = verifyClassroomArchiveProductionCanaryPlan(args.plan)
  if (args.acknowledgement.trim() !== classroomArchiveProductionCanaryAcknowledgement(plan)) {
    throw new Error('Production archive canary target-specific acknowledgement is invalid')
  }
  return assertClassroomArchiveProductionCanaryTarget({
    expectedProjectRef: plan.expected_project_ref,
    supabaseUrl: args.supabaseUrl,
    serviceRoleKey: args.serviceRoleKey,
    environment: args.environment,
  })
}

export function assertClassroomArchiveProductionCanaryTarget(args: {
  expectedProjectRef: string
  supabaseUrl: string | undefined
  serviceRoleKey: string | undefined
  environment: NodeJS.ProcessEnv
}): string {
  const expectedProjectRef = projectRefSchema.parse(args.expectedProjectRef)
  for (const name of cleanupGateNames) {
    if (isEnabled(args.environment[name])) {
      throw new Error('Production archive canary requires every cleanup gate to remain disabled')
    }
  }
  const supabaseUrl = verifyHostedSupabaseApiOrigin(
    z.url().parse(args.supabaseUrl),
    expectedProjectRef,
  )
  const serviceRoleKey = z.string().min(1).parse(args.serviceRoleKey)
  const claims = hostedServiceRoleClaimsSchema.safeParse(decodeJwtClaims(serviceRoleKey))
  if (!claims.success || claims.data.ref !== expectedProjectRef) {
    throw new Error('Production archive canary requires the exact hosted service-role key')
  }
  return supabaseUrl
}

export function assertClassroomArchiveProductionCanaryEvidenceEqual(args: {
  expected: ClassroomArchiveProductionCanaryEvidence
  actual: ClassroomArchiveProductionCanaryEvidence
  compareRevision: boolean
}) {
  const expected = classroomArchiveProductionCanaryEvidenceSchema.parse(args.expected)
  const actual = classroomArchiveProductionCanaryEvidenceSchema.parse(args.actual)
  if (args.compareRevision && expected.source_revision !== actual.source_revision) {
    throw new Error('Production archive canary source revision changed after preparation')
  }
  if (expected.evidence_sha256 !== actual.evidence_sha256) {
    throw new Error('Production archive canary exact resource or storage evidence differs')
  }
}

function assertStateIdentity(
  state: ClassroomArchiveProductionCanaryState,
  plan: ClassroomArchiveProductionCanaryPlan,
) {
  if (state.teacherId !== plan.teacher_id) {
    throw new Error('Production archive canary lifecycle identity does not match the plan')
  }
  if (state.phase === 'cold' && state.archiveId !== plan.operation_ids.export) {
    throw new Error('Production archive canary cold tombstone does not match the plan')
  }
}

function assertArchiveIdentity(
  archive: ClassroomArchiveProductionArchiveEvidence,
  plan: ClassroomArchiveProductionCanaryPlan,
) {
  if (
    archive.archiveId !== plan.operation_ids.export ||
    archive.teacherId !== plan.teacher_id ||
    archive.classroomId !== plan.classroom_id
  ) {
    throw new Error('Production archive canary archive identity does not match the plan')
  }
  assertClassroomArchiveProductionCanaryEvidenceEqual({
    expected: plan.pre_evidence,
    actual: archive.evidence,
    compareRevision: true,
  })
}

function operationFailure(label: string, result: {
  error_code: string
  retryable: boolean
}): Error {
  return new Error(`${label} failed with ${result.error_code}; retryable=${String(result.retryable)}`)
}

function sameResourceCounts(
  counts: Record<string, number>,
  evidence: ClassroomArchiveProductionCanaryEvidence,
): boolean {
  const expected = Object.fromEntries(evidence.resources.map((item) => [item.table, item.row_count]))
  return canonicalJsonStringify(counts) === canonicalJsonStringify(expected)
}

export async function runClassroomArchiveProductionCanary(args: {
  plan: ClassroomArchiveProductionCanaryPlan
  dependencies: ClassroomArchiveProductionCanaryDependencies
}): Promise<ClassroomArchiveProductionCanaryResult> {
  const plan = verifyClassroomArchiveProductionCanaryPlan(args.plan)
  const { dependencies } = args
  const readStateWithRetry = async () => {
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await dependencies.readState()
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }
  let initialEventError: unknown
  try {
    await dependencies.recordEvent({ phase: 'preflight', status: 'started' })
  } catch (error) {
    initialEventError = error
  }
  const initialState = await readStateWithRetry()
  assertStateIdentity(initialState, plan)
  if (initialEventError && initialState.phase !== 'cold') throw initialEventError
  let coldRecoveryRequired = initialState.phase === 'cold'
  const recordEvent = async (event: ClassroomArchiveProductionCanaryEvent) => {
    try {
      await dependencies.recordEvent(event)
    } catch (error) {
      if (!coldRecoveryRequired) throw error
    }
  }
  const resumedFromCold = initialState.phase === 'cold'
  let exportReplayed = resumedFromCold
  let compactionReplayed = resumedFromCold
  const readArchiveWithRetry = async () => {
    let lastError: unknown
    const attempts = coldRecoveryRequired ? 3 : 1
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await dependencies.readArchiveEvidence()
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }
  let archive = await readArchiveWithRetry()

  if (initialState.phase === 'hot') {
    const completedArchive = archive !== null && await dependencies.readRestoreCompleted()
      ? archive
      : null
    const currentEvidence = completedArchive
      ? await dependencies.readRestoredEvidence(completedArchive)
      : await dependencies.readCurrentEvidence()
    assertClassroomArchiveProductionCanaryEvidenceEqual({
      expected: completedArchive?.restoredEvidence || plan.pre_evidence,
      actual: currentEvidence,
      compareRevision: true,
    })
    if (completedArchive) {
      await recordEvent({ phase: 'preflight', status: 'reconciled' })
      await recordEvent({ phase: 'restore', status: 'reconciled' })
      await recordEvent({ phase: 'verify', status: 'started' })
      const finalEvidence = await dependencies.verifyFinal({
        archive: completedArchive,
        operationIds: plan.operation_ids,
      })
      await recordEvent({ phase: 'verify', status: 'completed' })
      return {
        ok: true,
        runId: plan.run_id,
        resumedFromCold: false,
        exportReplayed: true,
        compactionReplayed: true,
        restoreReplayed: true,
        restoreAttempts: 0,
        compressedByteSize: completedArchive.compressedByteSize,
        uncompressedByteSize: completedArchive.uncompressedByteSize,
        resourceTableCount: plan.pre_evidence.resources.length,
        storageObjectCount: plan.pre_evidence.storage_objects.length,
        evidenceSha256: plan.pre_evidence.evidence_sha256,
        finalEvidence,
      }
    }
    await recordEvent({ phase: 'preflight', status: 'completed' })

    await recordEvent({ phase: 'export', status: 'started' })
    const exported = await dependencies.exportArchive()
    if (exported.operation_id !== plan.operation_ids.export) {
      throw new Error('Production archive export operation identity does not match the plan')
    }
    archive = await dependencies.readArchiveEvidence()
    if (!exported.ok && !archive) {
      await recordEvent({
        phase: 'export', status: 'failed', errorCode: exported.error_code,
      })
      throw operationFailure('Production archive export', exported)
    }
    if (exported.ok) {
      if (
        exported.operation_id !== plan.operation_ids.export ||
        exported.archive_id !== plan.operation_ids.export ||
        !sameResourceCounts(exported.resource_counts, plan.pre_evidence)
      ) {
        throw new Error('Production archive export evidence does not match the plan')
      }
      exportReplayed = exported.replayed
    }
    if (!archive) throw new Error('Production archive metadata is unavailable after export')
    assertArchiveIdentity(archive, plan)
    await recordEvent({
      phase: 'export', status: exported.ok ? 'completed' : 'reconciled',
    })

    await recordEvent({ phase: 'compact', status: 'started' })
    const compacted = await dependencies.compactArchive()
    if (compacted.operation_id !== plan.operation_ids.compact) {
      throw new Error('Production archive compaction operation identity does not match the plan')
    }
    let stateAfterCompaction: ClassroomArchiveProductionCanaryState | null = null
    try {
      stateAfterCompaction = await readStateWithRetry()
      assertStateIdentity(stateAfterCompaction, plan)
      coldRecoveryRequired = stateAfterCompaction.phase === 'cold'
    } catch {
      // Compaction may have committed despite an unreadable response. Prioritize restore.
      coldRecoveryRequired = true
    }
    if (!compacted.ok && stateAfterCompaction?.phase !== 'cold' && stateAfterCompaction !== null) {
      await recordEvent({
        phase: 'compact', status: 'failed', errorCode: compacted.error_code,
      })
      throw operationFailure('Production archive compaction', compacted)
    }
    if (compacted.ok) {
      if (
        compacted.operation_id !== plan.operation_ids.compact ||
        compacted.archive_id !== plan.operation_ids.export ||
        !sameResourceCounts(compacted.resource_counts, plan.pre_evidence)
      ) {
        throw new Error('Production archive compaction evidence does not match the plan')
      }
      compactionReplayed = compacted.replayed
      if (stateAfterCompaction?.phase === 'hot' && !compacted.replayed) {
        throw new Error('Production archive compaction completed without a cold tombstone')
      }
    }
    await recordEvent({
      phase: 'compact', status: compacted.ok ? 'completed' : 'reconciled',
    })
  } else {
    await recordEvent({ phase: 'preflight', status: 'reconciled' })
  }

  archive ??= await readArchiveWithRetry()
  if (!archive) throw new Error('Production archive metadata is unavailable for restore')
  assertArchiveIdentity(archive, plan)

  await recordEvent({ phase: 'restore', status: 'started' })
  let restored: ClassroomArchiveRestoreResult | null = null
  let restoreReconciled = false
  let restoreCallError: unknown = null
  let restoreAttempts = 0
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    restoreAttempts = attempt
    try {
      restored = await dependencies.restoreArchive()
    } catch (error) {
      restoreCallError = error
      let stateAfterThrownRestore: ClassroomArchiveProductionCanaryState | null = null
      try {
        stateAfterThrownRestore = await readStateWithRetry()
      } catch {
        // Retry the fixed operation id; a later attempt can reconcile durable state.
      }
      if (stateAfterThrownRestore) assertStateIdentity(stateAfterThrownRestore, plan)
      if (stateAfterThrownRestore?.phase === 'hot') {
        const reconciledEvidence = await dependencies.readRestoredEvidence(archive)
        assertClassroomArchiveProductionCanaryEvidenceEqual({
          expected: archive.restoredEvidence,
          actual: reconciledEvidence,
          compareRevision: true,
        })
        restoreReconciled = true
        break
      }
      continue
    }
    if (restored.operation_id !== plan.operation_ids.restore) {
      throw new Error('Production archive restore operation identity does not match the plan')
    }
    if (restored.ok || !restored.retryable) break
  }
  if (!restored || !restored.ok) {
    const errorCode = restored?.error_code || (restoreCallError
      ? 'restore_call_threw'
      : 'restore_result_missing')
    if (!restoreReconciled) {
      const stateAfterRestore = await readStateWithRetry()
      assertStateIdentity(stateAfterRestore, plan)
      if (stateAfterRestore.phase !== 'hot') {
        await recordEvent({ phase: 'restore', status: 'failed', errorCode })
        if (!restored) {
          throw restoreCallError || new Error('Production archive restore did not return a result')
        }
        throw operationFailure('Production archive restore', restored)
      }
      const reconciledEvidence = await dependencies.readRestoredEvidence(archive)
      assertClassroomArchiveProductionCanaryEvidenceEqual({
        expected: archive.restoredEvidence,
        actual: reconciledEvidence,
        compareRevision: true,
      })
      restoreReconciled = true
    }
    await recordEvent({ phase: 'restore', status: 'reconciled', errorCode })
  } else {
    if (
      restored.operation_id !== plan.operation_ids.restore ||
      restored.archive_id !== plan.operation_ids.export ||
      !sameResourceCounts(restored.resource_counts, plan.pre_evidence)
    ) {
      throw new Error('Production archive restore evidence does not match the plan')
    }
    await recordEvent({ phase: 'restore', status: 'completed' })
  }

  await recordEvent({ phase: 'verify', status: 'started' })
  const postEvidence = await dependencies.readRestoredEvidence(archive)
  assertClassroomArchiveProductionCanaryEvidenceEqual({
    expected: archive.restoredEvidence,
    actual: postEvidence,
    compareRevision: true,
  })
  const finalEvidence = await dependencies.verifyFinal({
    archive,
    operationIds: plan.operation_ids,
  })
  await recordEvent({ phase: 'verify', status: 'completed' })

  return {
    ok: true,
    runId: plan.run_id,
    resumedFromCold,
    exportReplayed,
    compactionReplayed,
    restoreReplayed: restored?.ok ? restored.replayed : restoreReconciled,
    restoreAttempts,
    compressedByteSize: archive.compressedByteSize,
    uncompressedByteSize: archive.uncompressedByteSize,
    resourceTableCount: plan.pre_evidence.resources.length,
    storageObjectCount: plan.pre_evidence.storage_objects.length,
    evidenceSha256: plan.pre_evidence.evidence_sha256,
    finalEvidence,
  }
}
