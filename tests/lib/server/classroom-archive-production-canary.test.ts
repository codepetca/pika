import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CLASSROOM_RELATIONAL_RESOURCES } from '@/lib/contracts/classroom-data'
import { CLASSROOM_ARCHIVE_V1_RESOURCES } from '@/lib/contracts/classroom-archive-resources'
import {
  buildClassroomArchiveBundle,
  verifyClassroomArchiveBundle,
} from '@/lib/server/classroom-archive-format'
import {
  assertClassroomArchiveProductionCanaryStorageMappingsEqual,
  assertClassroomArchiveProductionCanaryExecution,
  classroomArchiveProductionCanaryAcknowledgement,
  classroomArchiveProductionCanaryEvidenceDigest,
  createClassroomArchiveProductionCanaryArchiveProjection,
  createClassroomArchiveProductionCanaryNormalizedEvidence,
  createClassroomArchiveProductionCanaryPlan,
  createClassroomArchiveProductionCanaryVerifiedArchiveProjection,
  deriveClassroomArchiveProductionCanaryOperationId,
  deriveClassroomArchiveProductionCanaryRestoredStoragePath,
  normalizeClassroomArchiveProductionCanaryCliArguments,
  normalizeClassroomArchiveProductionCanaryResources,
  runClassroomArchiveProductionCanary,
  verifyClassroomArchiveProductionCanaryPlan,
  type ClassroomArchiveProductionCanaryDependencies,
  type ClassroomArchiveProductionCanaryEvidence,
  type ClassroomArchiveProductionCanaryFinalEvidence,
  type ClassroomArchiveProductionCanaryPlan,
  type ClassroomArchiveProductionCanaryState,
} from '@/lib/server/classroom-archive-production-canary'

const PROJECT_REF = 'abcdefghijklmnopqrst'
const TEACHER_ID = '00000000-0000-4000-8000-000000000001'
const CLASSROOM_ID = '00000000-0000-4000-8000-000000000002'
const RUN_ID = '00000000-0000-4000-8000-000000000003'
const COMMIT = 'a'.repeat(40)
const SHA = 'b'.repeat(64)

function jwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.')
}

function evidence(
  sourceRevision = 7,
  resourceSha = SHA,
): ClassroomArchiveProductionCanaryEvidence {
  return classroomArchiveProductionCanaryEvidenceDigest({
    sourceRevision,
    resources: CLASSROOM_RELATIONAL_RESOURCES.map(({ table }) => ({
      table,
      row_count: table === 'classrooms' ? 1 : 0,
      byte_size: table === 'classrooms' ? 123 : 0,
      sha256: resourceSha,
    })),
    storageObjects: [{ identity_sha256: 'c'.repeat(64), byte_size: 5, sha256: SHA }],
  })
}

function plan(): ClassroomArchiveProductionCanaryPlan {
  return createClassroomArchiveProductionCanaryPlan({
    preparedAt: '2026-07-15T12:00:00.000Z',
    approvedRunnerCommit: COMMIT,
    expectedProjectRef: PROJECT_REF,
    supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    runId: RUN_ID,
    teacherId: TEACHER_ID,
    classroomId: CLASSROOM_ID,
    sourceAppCommit: COMMIT,
    databaseBudgetBytes: 500_000_000,
    databaseSizeBytesBefore: 57_000_000,
    preEvidence: evidence(),
  })
}

const finalEvidence: ClassroomArchiveProductionCanaryFinalEvidence = {
  archiveRetained: true,
  archiveBytesVerified: true,
  hotClassroomRestored: true,
  coldTombstoneRemoved: true,
  operationsCompleted: true,
  sourceCleanupDeletedCount: 0,
  sourceCleanupOwnershipVerifiedCount: 0,
  sourceCleanupAttemptCount: 0,
  databaseWithinBudget: true,
  databaseSizeBytesBefore: 57_000_000,
  databaseSizeBytesAfter: 58_000_000,
}

function counts(value: ClassroomArchiveProductionCanaryEvidence) {
  return Object.fromEntries(value.resources.map((item) => [item.table, item.row_count]))
}

function dependencies(options: {
  states?: ClassroomArchiveProductionCanaryState[]
  initialArchive?: boolean
  exportFailure?: boolean
  compactFailure?: boolean
  retryRestore?: boolean
  restoreFailure?: boolean
  initialEvidence?: ClassroomArchiveProductionCanaryEvidence
  postEvidence?: ClassroomArchiveProductionCanaryEvidence
  restoredEvidence?: ClassroomArchiveProductionCanaryEvidence
  journalFailure?: boolean
  stateFailuresAtCalls?: number[]
  restoreCompleted?: boolean
  archiveFailures?: number
  restoreThrows?: number
} = {}): ClassroomArchiveProductionCanaryDependencies & {
  calls: string[]
  events: Array<{ phase: string; status: string }>
} {
  const approvedPlan = plan()
  const calls: string[] = []
  const events: Array<{ phase: string; status: string }> = []
  const stateQueue = [...(options.states || [
    { phase: 'hot' as const, teacherId: TEACHER_ID, archivedAt: '2026-07-01T00:00:00.000Z' },
    { phase: 'cold' as const, teacherId: TEACHER_ID, archiveId: approvedPlan.operation_ids.export },
  ])]
  let archiveAvailable = options.initialArchive || false
  let evidenceReads = 0
  let restoreCalls = 0
  let stateCalls = 0
  let archiveReads = 0
  const archive = {
    archiveId: approvedPlan.operation_ids.export,
    teacherId: TEACHER_ID,
    classroomId: CLASSROOM_ID,
    artifactSha256: 'd'.repeat(64),
    contentSha256: SHA,
    compressedByteSize: 100,
    uncompressedByteSize: 500,
    manifestSha256: SHA,
    operationRequestSha256: { export: SHA, compact: SHA, restore: SHA },
    storageObjectCounts: {},
    restoreAdapterChain: ['classroom-archive-v1-082-to-083'],
    restoredStorageMappings: [],
    evidence: approvedPlan.pre_evidence,
    restoredEvidence: options.restoredEvidence || approvedPlan.pre_evidence,
  }
  return {
    calls,
    events,
    readState: vi.fn(async () => {
      calls.push('state')
      stateCalls += 1
      if (options.stateFailuresAtCalls?.includes(stateCalls)) {
        throw new Error('transient lifecycle read failure')
      }
      return stateQueue.shift() || {
        phase: 'hot' as const,
        teacherId: TEACHER_ID,
        archivedAt: '2026-07-01T00:00:00.000Z',
      }
    }),
    readCurrentEvidence: vi.fn(async () => {
      calls.push('evidence')
      evidenceReads += 1
      return evidenceReads > 1 && options.postEvidence
        ? options.postEvidence
        : options.initialEvidence || approvedPlan.pre_evidence
    }),
    readRestoredEvidence: vi.fn(async () => {
      calls.push('restored-evidence')
      evidenceReads += 1
      return evidenceReads > 1 && options.postEvidence
        ? options.postEvidence
        : options.initialEvidence || options.restoredEvidence || approvedPlan.pre_evidence
    }),
    readArchiveEvidence: vi.fn(async () => {
      calls.push('archive')
      archiveReads += 1
      if (archiveReads <= (options.archiveFailures || 0)) {
        throw new Error('transient archive read failure')
      }
      return archiveAvailable ? archive : null
    }),
    readRestoreCompleted: vi.fn(async () => options.restoreCompleted || false),
    exportArchive: vi.fn(async () => {
      calls.push('export')
      archiveAvailable = true
      if (options.exportFailure) {
        return {
          ok: false as const,
          status: 500,
          operation_id: approvedPlan.operation_ids.export,
          error_code: 'ambiguous_export',
          error: 'ambiguous export response',
          retryable: true,
        }
      }
      return {
        ok: true as const,
        status: 201 as const,
        operation_id: approvedPlan.operation_ids.export,
        archive_id: approvedPlan.operation_ids.export,
        replayed: false,
        artifact_sha256: archive.artifactSha256,
        content_sha256: SHA,
        compressed_byte_size: 100,
        uncompressed_byte_size: 500,
        resource_counts: counts(approvedPlan.pre_evidence),
        storage_object_counts: {},
        verification: {} as never,
      }
    }),
    compactArchive: vi.fn(async () => {
      calls.push('compact')
      if (options.compactFailure) {
        return {
          ok: false as const,
          status: 500,
          operation_id: approvedPlan.operation_ids.compact,
          error_code: 'ambiguous_compaction',
          error: 'ambiguous compaction response',
          retryable: true,
        }
      }
      return {
        ok: true as const,
        status: 201 as const,
        operation_id: approvedPlan.operation_ids.compact,
        archive_id: approvedPlan.operation_ids.export,
        replayed: false,
        resource_counts: counts(approvedPlan.pre_evidence),
        storage_object_counts: { total_count: 1, total_bytes: 5, by_bucket: {} },
        cleanup_object_count: 1,
        cleanup_object_bytes: 5,
        verification: {} as never,
      }
    }),
    restoreArchive: vi.fn(async () => {
      calls.push('restore')
      restoreCalls += 1
      if (restoreCalls <= (options.restoreThrows || 0)) {
        throw new Error('transient restore transport failure')
      }
      if (options.restoreFailure || (options.retryRestore && restoreCalls === 1)) {
        return {
          ok: false as const,
          status: 503,
          operation_id: approvedPlan.operation_ids.restore,
          error_code: 'restore_busy',
          error: 'retry restore',
          retryable: true,
        }
      }
      return {
        ok: true as const,
        status: 201 as const,
        operation_id: approvedPlan.operation_ids.restore,
        archive_id: approvedPlan.operation_ids.export,
        replayed: false,
        resource_counts: counts(approvedPlan.pre_evidence),
        verification: {} as never,
      }
    }),
    verifyFinal: vi.fn(async () => {
      calls.push('verify')
      return finalEvidence
    }),
    recordEvent: vi.fn(async (event) => {
      if (options.journalFailure) throw new Error('journal unavailable')
      events.push(event)
    }),
  }
}

describe('production classroom archive canary contract', () => {
  it('accepts pnpm argument forwarding with or without its separator', () => {
    const args = ['prepare', '--plan', '/private/plan.json']
    expect(normalizeClassroomArchiveProductionCanaryCliArguments(args)).toEqual(args)
    expect(normalizeClassroomArchiveProductionCanaryCliArguments(['--', ...args])).toEqual(args)
  })

  it('derives stable, distinct operation IDs and verifies the immutable plan digest', () => {
    const ids = ['export', 'compact', 'restore'].map((phase) =>
      deriveClassroomArchiveProductionCanaryOperationId(
        RUN_ID,
        phase as 'export' | 'compact' | 'restore',
      ),
    )
    expect(new Set(ids).size).toBe(3)
    expect(ids[0]).toBe(deriveClassroomArchiveProductionCanaryOperationId(RUN_ID, 'export'))
    expect(verifyClassroomArchiveProductionCanaryPlan(plan())).toEqual(plan())
  })

  it('rejects incomplete evidence and a tampered plan', () => {
    expect(() => classroomArchiveProductionCanaryEvidenceDigest({
      sourceRevision: 1,
      resources: [],
      storageObjects: [],
    })).toThrow('exact classroom resource contract')
    const tampered = { ...plan(), database_budget_bytes: 1 }
    expect(() => verifyClassroomArchiveProductionCanaryPlan(tampered))
      .toThrow('plan digest does not match')
  })

  it('requires exact target acknowledgement, credential, and disabled cleanup gates', () => {
    const approvedPlan = plan()
    const valid = {
      plan: approvedPlan,
      acknowledgement: classroomArchiveProductionCanaryAcknowledgement(approvedPlan),
      supabaseUrl: approvedPlan.supabase_origin,
      serviceRoleKey: jwt({ role: 'service_role', ref: PROJECT_REF }),
      environment: {} as NodeJS.ProcessEnv,
    }
    expect(assertClassroomArchiveProductionCanaryExecution(valid))
      .toBe(`https://${PROJECT_REF}.supabase.co`)
    expect(() => assertClassroomArchiveProductionCanaryExecution({
      ...valid,
      acknowledgement: 'yes',
    })).toThrow('acknowledgement')
    expect(() => assertClassroomArchiveProductionCanaryExecution({
      ...valid,
      serviceRoleKey: jwt({ role: 'service_role', ref: 'zyxwvutsrqponmlkjihg' }),
    })).toThrow('exact hosted service-role key')
    expect(() => assertClassroomArchiveProductionCanaryExecution({
      ...valid,
      environment: { CLASSROOM_ARCHIVE_SOURCE_CLEANUP_ENABLED: 'true' },
    })).toThrow('cleanup gate')
  })

  it('normalizes only deterministic restored storage references to source identities', () => {
    const sourcePath = 'student/evidence.png'
    const restorePath = deriveClassroomArchiveProductionCanaryRestoredStoragePath({
      classroomId: CLASSROOM_ID,
      operationId: plan().operation_ids.restore,
      sha256: SHA,
      sourcePath,
      contentType: 'image/png',
    })
    const mappings = [{
      bucket: 'assignment-artifacts',
      sourcePath,
      restorePath,
    }]
    const source = {
      assignment_submission_artifacts: [{
        id: 'artifact-1',
        storage_path: sourcePath,
        caption: 'Original caption',
      }],
      assignments: [{
        id: 'assignment-1',
        instructions: `See https://${PROJECT_REF}.supabase.co/storage/v1/object/sign/assignment-artifacts/${sourcePath}.`,
      }],
    }
    const restored = {
      assignment_submission_artifacts: [{
        id: 'artifact-1',
        storage_path: restorePath,
        caption: 'Original caption',
      }],
      assignments: [{
        id: 'assignment-1',
        instructions: `See https://${PROJECT_REF}.supabase.co/storage/v1/object/public/assignment-artifacts/${restorePath}.`,
      }],
    }

    expect(normalizeClassroomArchiveProductionCanaryResources({
      resources: restored,
      storageMappings: mappings,
      storagePathKind: 'restored',
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    })).toEqual(normalizeClassroomArchiveProductionCanaryResources({
      resources: source,
      storageMappings: mappings,
      storagePathKind: 'source',
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    }))
    restored.assignment_submission_artifacts[0].caption = 'Changed caption'
    expect(normalizeClassroomArchiveProductionCanaryResources({
      resources: restored,
      storageMappings: mappings,
      storagePathKind: 'restored',
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    })).not.toEqual(normalizeClassroomArchiveProductionCanaryResources({
      resources: source,
      storageMappings: mappings,
      storagePathKind: 'source',
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    }))

    const staleNestedUrlOnly = {
      assignment_submission_artifacts: [{
        id: 'artifact-1',
        storage_path: restorePath,
        caption: 'Original caption',
      }],
      assignments: source.assignments,
    }
    expect(normalizeClassroomArchiveProductionCanaryResources({
      resources: staleNestedUrlOnly,
      storageMappings: mappings,
      storagePathKind: 'restored',
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    })).not.toEqual(normalizeClassroomArchiveProductionCanaryResources({
      resources: source,
      storageMappings: mappings,
      storagePathKind: 'source',
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    }))

    const authenticatedRestoredUrl = {
      ...restored,
      assignment_submission_artifacts: [{
        id: 'artifact-1',
        storage_path: restorePath,
        caption: 'Original caption',
      }],
      assignments: [{
        id: 'assignment-1',
        instructions: `See https://${PROJECT_REF}.supabase.co/storage/v1/object/authenticated/assignment-artifacts/${restorePath}.`,
      }],
    }
    expect(normalizeClassroomArchiveProductionCanaryResources({
      resources: authenticatedRestoredUrl,
      storageMappings: mappings,
      storagePathKind: 'restored',
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    })).not.toEqual(normalizeClassroomArchiveProductionCanaryResources({
      resources: source,
      storageMappings: mappings,
      storagePathKind: 'source',
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    }))

    const canonicalRestoredUrl = `https://${PROJECT_REF}.supabase.co/storage/v1/object/public/assignment-artifacts/${restorePath}`
    const expectedNormalized = normalizeClassroomArchiveProductionCanaryResources({
      resources: source,
      storageMappings: mappings,
      storagePathKind: 'source',
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    })
    for (const aliasedUrl of [
      `${canonicalRestoredUrl}?token=unexpected`,
      `${canonicalRestoredUrl}#unexpected`,
      canonicalRestoredUrl.replace('https://', 'https://user@'),
      canonicalRestoredUrl.replace('.supabase.co', '.supabase.co:443'),
    ]) {
      const aliased = {
        assignment_submission_artifacts: [{
          id: 'artifact-1',
          storage_path: restorePath,
          caption: 'Original caption',
        }],
        assignments: [{ id: 'assignment-1', instructions: `See ${aliasedUrl}.` }],
      }
      expect(normalizeClassroomArchiveProductionCanaryResources({
        resources: aliased,
        storageMappings: mappings,
        storagePathKind: 'restored',
        supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
      })).not.toEqual(expectedNormalized)
    }

    const wrongDirectRepresentation = {
      assignment_submission_artifacts: [{
        id: 'artifact-1',
        storage_path: canonicalRestoredUrl,
        caption: 'Original caption',
      }],
      assignments: restored.assignments,
    }
    expect(normalizeClassroomArchiveProductionCanaryResources({
      resources: wrongDirectRepresentation,
      storageMappings: mappings,
      storagePathKind: 'restored',
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    })).not.toEqual(expectedNormalized)
  })

  it('builds the runner archive projection from verified source rows', () => {
    const sourcePath = 'student/evidence.png'
    const resources = Object.fromEntries(
      CLASSROOM_ARCHIVE_V1_RESOURCES.map(({ table }) => [table, []]),
    ) as Record<string, Array<Record<string, unknown>>>
    resources.classrooms = [{
      id: CLASSROOM_ID,
      teacher_id: TEACHER_ID,
      title: 'Projection fixture',
      archived_at: '2026-07-15T12:00:00.000Z',
    }]
    resources.assignments = [{
      id: '10000000-0000-4000-8000-000000000001',
      classroom_id: CLASSROOM_ID,
      created_by: TEACHER_ID,
    }]
    resources.assignment_docs = [{
      id: '10000000-0000-4000-8000-000000000002',
      assignment_id: '10000000-0000-4000-8000-000000000001',
      student_id: '10000000-0000-4000-8000-000000000004',
    }]
    resources.assignment_submission_artifacts = [{
      id: '10000000-0000-4000-8000-000000000003',
      assignment_doc_id: '10000000-0000-4000-8000-000000000002',
      student_id: '10000000-0000-4000-8000-000000000004',
      storage_path: sourcePath,
      metadata: { preserved: true },
    }]
    const bundle = buildClassroomArchiveBundle({
      version: 1,
      archiveId: plan().operation_ids.export,
      classroomId: CLASSROOM_ID,
      teacherId: TEACHER_ID,
      createdAt: '2026-07-15T12:00:00.000Z',
      source: { schemaMigration: '082_verified_classroom_archive_exports', appCommit: COMMIT },
      retention: { mode: 'teacher_managed', delete_after: null },
      resources,
      actors: [
        { id: TEACHER_ID, email: 'teacher@example.test', role: 'teacher', profile: null },
        {
          id: '10000000-0000-4000-8000-000000000004',
          email: 'student@example.test',
          role: 'student',
          profile: null,
        },
      ],
      storageObjects: [{
        bucket: 'assignment-artifacts',
        sourcePath,
        contentType: 'image/png',
        bytes: Buffer.from('projection bytes'),
      }],
    })
    const verified = verifyClassroomArchiveBundle(bundle.archive)
    if (!verified.ok) throw new Error(verified.error)
    const projection = createClassroomArchiveProductionCanaryArchiveProjection({
      verified,
      sourceRevision: 7,
      restoreOperationId: plan().operation_ids.restore,
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    })
    expect(projection.restoredStorageMappings).toEqual([expect.objectContaining({
      bucket: 'assignment-artifacts',
      sourcePath,
    })])
    expect(() => assertClassroomArchiveProductionCanaryStorageMappingsEqual({
      independent: projection.restoredStorageMappings,
      planned: projection.restoredStorageMappings.map((mapping) => ({
        ...mapping,
        restorePath: `${mapping.restorePath}-wrong`,
      })),
    })).toThrow('independent restored paths differ')
    expect(createClassroomArchiveProductionCanaryVerifiedArchiveProjection({
      verified,
      sourceRevision: 7,
      restoreOperationId: plan().operation_ids.restore,
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
      plannedStorageMappings: projection.restoredStorageMappings,
    })).toEqual(projection)
    expect(() => createClassroomArchiveProductionCanaryVerifiedArchiveProjection({
      verified,
      sourceRevision: 7,
      restoreOperationId: plan().operation_ids.restore,
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
      plannedStorageMappings: projection.restoredStorageMappings.map((mapping) => ({
        ...mapping,
        restorePath: `${mapping.restorePath}-wrong`,
      })),
    })).toThrow('independent restored paths differ')
    expect(projection.restoredEvidence).toEqual(
      createClassroomArchiveProductionCanaryNormalizedEvidence({
        sourceRevision: 7,
        resources,
        storageObjects: bundle.manifest.storage_objects.map((object) => ({
          bucket: object.bucket,
          path: object.source_path,
          byteSize: object.byte_size,
          sha256: object.sha256,
        })),
        storageMappings: projection.restoredStorageMappings,
        storagePathKind: 'source',
        supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
      }),
    )
    const runner = readFileSync(resolve(
      process.cwd(),
      'scripts/run-classroom-archive-production-canary.ts',
    ), 'utf8')
    expect(runner).toContain('createClassroomArchiveProductionCanaryVerifiedArchiveProjection({')
    expect(runner).not.toContain('restorePlan.resources')
  })

  it('builds strict normalized evidence for the runner without sharing restore rows', () => {
    const sourcePath = 'student/evidence.png'
    const restorePath = deriveClassroomArchiveProductionCanaryRestoredStoragePath({
      classroomId: CLASSROOM_ID,
      operationId: plan().operation_ids.restore,
      sha256: SHA,
      sourcePath,
      contentType: 'image/png',
    })
    const storageMappings = [{ bucket: 'assignment-artifacts', sourcePath, restorePath }]
    const baseResources = Object.fromEntries(
      CLASSROOM_RELATIONAL_RESOURCES.map(({ table }) => [table, []]),
    ) as Record<string, Array<Record<string, unknown>>>
    const sourceResources = {
      ...baseResources,
      classrooms: [{ id: CLASSROOM_ID, teacher_id: TEACHER_ID, title: 'Original' }],
      assignment_submission_artifacts: [{ storage_path: sourcePath, metadata: { kept: true } }],
    }
    const restoredResources = {
      ...baseResources,
      classrooms: [{ id: CLASSROOM_ID, teacher_id: TEACHER_ID, title: 'Original' }],
      assignment_submission_artifacts: [{ storage_path: restorePath, metadata: { kept: true } }],
    }
    const expected = createClassroomArchiveProductionCanaryNormalizedEvidence({
      sourceRevision: 7,
      resources: sourceResources,
      storageObjects: [{ bucket: 'assignment-artifacts', path: sourcePath, byteSize: 5, sha256: SHA }],
      storageMappings,
      storagePathKind: 'source',
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    })
    const actual = createClassroomArchiveProductionCanaryNormalizedEvidence({
      sourceRevision: 7,
      resources: restoredResources,
      storageObjects: [{ bucket: 'assignment-artifacts', path: restorePath, byteSize: 5, sha256: SHA }],
      storageMappings,
      storagePathKind: 'restored',
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    })
    expect(actual).toEqual(expected)

    const drifted = createClassroomArchiveProductionCanaryNormalizedEvidence({
      sourceRevision: 7,
      resources: {
        ...restoredResources,
        assignment_submission_artifacts: [{
          storage_path: restorePath,
          metadata: { kept: false },
        }],
      },
      storageObjects: [{ bucket: 'assignment-artifacts', path: restorePath, byteSize: 5, sha256: SHA }],
      storageMappings,
      storagePathKind: 'restored',
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    })
    expect(drifted.evidence_sha256).not.toBe(expected.evidence_sha256)
    const wrongBytes = createClassroomArchiveProductionCanaryNormalizedEvidence({
      sourceRevision: 7,
      resources: restoredResources,
      storageObjects: [{
        bucket: 'assignment-artifacts',
        path: restorePath,
        byteSize: 5,
        sha256: 'd'.repeat(64),
      }],
      storageMappings,
      storagePathKind: 'restored',
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    })
    expect(wrongBytes.evidence_sha256).not.toBe(expected.evidence_sha256)
    expect(() => createClassroomArchiveProductionCanaryNormalizedEvidence({
      sourceRevision: 7,
      resources: sourceResources,
      storageObjects: [{ bucket: 'assignment-artifacts', path: sourcePath, byteSize: 5, sha256: SHA }],
      storageMappings,
      storagePathKind: 'restored',
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    })).toThrow('restored storage object path is unknown')
    expect(() => createClassroomArchiveProductionCanaryNormalizedEvidence({
      sourceRevision: 7,
      resources: restoredResources,
      storageObjects: [],
      storageMappings,
      storagePathKind: 'restored',
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    })).toThrow('storage object count differs')
    expect(() => createClassroomArchiveProductionCanaryNormalizedEvidence({
      sourceRevision: 7,
      resources: restoredResources,
      storageObjects: [
        { bucket: 'assignment-artifacts', path: restorePath, byteSize: 5, sha256: SHA },
        { bucket: 'assignment-artifacts', path: 'extra', byteSize: 1, sha256: SHA },
      ],
      storageMappings,
      storagePathKind: 'restored',
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    })).toThrow('storage object count differs')
  })

  it('binds each restored object checksum to its source identity', () => {
    const sourcePaths = ['student/first.png', 'student/second.png']
    const shas = ['1'.repeat(64), '2'.repeat(64)]
    const storageMappings = sourcePaths.map((sourcePath, index) => ({
      bucket: 'assignment-artifacts',
      sourcePath,
      restorePath: deriveClassroomArchiveProductionCanaryRestoredStoragePath({
        classroomId: CLASSROOM_ID,
        operationId: plan().operation_ids.restore,
        sha256: shas[index],
        sourcePath,
        contentType: 'image/png',
      }),
    }))
    const resources = Object.fromEntries(
      CLASSROOM_RELATIONAL_RESOURCES.map(({ table }) => [table, []]),
    ) as Record<string, Array<Record<string, unknown>>>
    resources.classrooms = [{ id: CLASSROOM_ID, teacher_id: TEACHER_ID }]
    resources.assignment_submission_artifacts = storageMappings.map((mapping, index) => ({
      id: `artifact-${index}`,
      storage_path: mapping.restorePath,
    }))
    const sourceResources = {
      ...resources,
      assignment_submission_artifacts: storageMappings.map((mapping, index) => ({
        id: `artifact-${index}`,
        storage_path: mapping.sourcePath,
      })),
    }
    const expected = createClassroomArchiveProductionCanaryNormalizedEvidence({
      sourceRevision: 7,
      resources: sourceResources,
      storageObjects: storageMappings.map((mapping, index) => ({
        bucket: mapping.bucket,
        path: mapping.sourcePath,
        byteSize: index === 0 ? 5 : 7,
        sha256: shas[index],
      })),
      storageMappings,
      storagePathKind: 'source',
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    })
    const swapped = createClassroomArchiveProductionCanaryNormalizedEvidence({
      sourceRevision: 7,
      resources,
      storageObjects: storageMappings.map((mapping, index) => ({
        bucket: mapping.bucket,
        path: mapping.restorePath,
        byteSize: index === 0 ? 7 : 5,
        sha256: shas[index === 0 ? 1 : 0],
      })),
      storageMappings,
      storagePathKind: 'restored',
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    })
    expect(swapped.evidence_sha256).not.toBe(expected.evidence_sha256)
    expect(() => createClassroomArchiveProductionCanaryNormalizedEvidence({
      sourceRevision: 7,
      resources,
      storageObjects: [
        {
          bucket: storageMappings[0].bucket,
          path: storageMappings[0].restorePath,
          byteSize: 5,
          sha256: shas[0],
        },
        {
          bucket: storageMappings[1].bucket,
          path: 'restores/unknown-object',
          byteSize: 7,
          sha256: shas[1],
        },
      ],
      storageMappings,
      storagePathKind: 'restored',
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    })).toThrow('restored storage object path is unknown')
  })
})

describe('production classroom archive canary orchestration', () => {
  it('exports, compacts, restores, and verifies exact evidence', async () => {
    const deps = dependencies()
    const result = await runClassroomArchiveProductionCanary({ plan: plan(), dependencies: deps })
    expect(result).toMatchObject({
      ok: true,
      resumedFromCold: false,
      restoreAttempts: 1,
      resourceTableCount: CLASSROOM_RELATIONAL_RESOURCES.length,
      storageObjectCount: 1,
    })
    expect(deps.calls).toEqual([
      'state', 'archive', 'evidence', 'export', 'archive', 'compact', 'state',
      'restore', 'restored-evidence', 'verify',
    ])
  })

  it('resumes a cold canary without rerunning export or compaction', async () => {
    const approvedPlan = plan()
    const deps = dependencies({
      initialArchive: true,
      states: [{
        phase: 'cold',
        teacherId: TEACHER_ID,
        archiveId: approvedPlan.operation_ids.export,
      }],
    })
    const result = await runClassroomArchiveProductionCanary({ plan: approvedPlan, dependencies: deps })
    expect(result.resumedFromCold).toBe(true)
    expect(deps.calls).not.toContain('export')
    expect(deps.calls).not.toContain('compact')
    expect(deps.calls).toContain('restore')
  })

  it('does not let journal failure prevent restore once durable state is cold', async () => {
    const approvedPlan = plan()
    const deps = dependencies({
      initialArchive: true,
      journalFailure: true,
      states: [{
        phase: 'cold',
        teacherId: TEACHER_ID,
        archiveId: approvedPlan.operation_ids.export,
      }],
    })
    await expect(runClassroomArchiveProductionCanary({ plan: approvedPlan, dependencies: deps }))
      .resolves.toMatchObject({ ok: true, resumedFromCold: true })
    expect(deps.calls).toContain('restore')
  })

  it('retries archive evidence before restoring a cold classroom', async () => {
    const approvedPlan = plan()
    const deps = dependencies({
      initialArchive: true,
      archiveFailures: 2,
      states: [{
        phase: 'cold',
        teacherId: TEACHER_ID,
        archiveId: approvedPlan.operation_ids.export,
      }],
    })
    await expect(runClassroomArchiveProductionCanary({ plan: approvedPlan, dependencies: deps }))
      .resolves.toMatchObject({ ok: true, resumedFromCold: true })
    expect(deps.calls.filter((call) => call === 'archive')).toHaveLength(3)
  })

  it('prioritizes restore when state reconciliation is transiently unreadable after compaction', async () => {
    const deps = dependencies({ stateFailuresAtCalls: [2, 3, 4] })
    await expect(runClassroomArchiveProductionCanary({ plan: plan(), dependencies: deps }))
      .resolves.toMatchObject({ ok: true })
    expect(deps.calls).toContain('restore')
  })

  it('reconciles ambiguous export and compaction responses from durable evidence', async () => {
    const approvedPlan = plan()
    const deps = dependencies({
      exportFailure: true,
      compactFailure: true,
      states: [
        { phase: 'hot', teacherId: TEACHER_ID, archivedAt: '2026-07-01T00:00:00.000Z' },
        { phase: 'cold', teacherId: TEACHER_ID, archiveId: approvedPlan.operation_ids.export },
      ],
    })
    await expect(runClassroomArchiveProductionCanary({ plan: approvedPlan, dependencies: deps }))
      .resolves.toMatchObject({ ok: true })
    expect(deps.events).toContainEqual({ phase: 'export', status: 'reconciled' })
    expect(deps.events).toContainEqual({ phase: 'compact', status: 'reconciled' })
  })

  it('retries restore with the same planned operation and rejects post-restore drift', async () => {
    const retrying = dependencies({ retryRestore: true })
    const result = await runClassroomArchiveProductionCanary({ plan: plan(), dependencies: retrying })
    expect(result.restoreAttempts).toBe(2)
    expect(retrying.calls.filter((call) => call === 'restore')).toHaveLength(2)

    const changed = evidence(7, 'e'.repeat(64))
    const drifting = dependencies({ postEvidence: changed })
    await expect(runClassroomArchiveProductionCanary({ plan: plan(), dependencies: drifting }))
      .rejects.toThrow('exact resource or storage evidence differs')
  })

  it('reconciles thrown restore calls from durable state before retrying', async () => {
    const approvedPlan = plan()
    const deps = dependencies({
      restoreThrows: 1,
      states: [
        { phase: 'hot', teacherId: TEACHER_ID, archivedAt: '2026-07-01T00:00:00.000Z' },
        { phase: 'cold', teacherId: TEACHER_ID, archiveId: approvedPlan.operation_ids.export },
        { phase: 'hot', teacherId: TEACHER_ID, archivedAt: '2026-07-01T00:00:00.000Z' },
      ],
    })
    const result = await runClassroomArchiveProductionCanary({
      plan: approvedPlan,
      dependencies: deps,
    })
    expect(result).toMatchObject({
      ok: true,
      restoreReplayed: true,
      restoreAttempts: 1,
    })
    expect(deps.calls.filter((call) => call === 'restore')).toHaveLength(1)
    expect(deps.events).toContainEqual({
      phase: 'restore',
      status: 'reconciled',
      errorCode: 'restore_call_threw',
    })
  })

  it('reconciles an ambiguous restore response only from exact durable hot state', async () => {
    const approvedPlan = plan()
    const deps = dependencies({
      restoreFailure: true,
      states: [
        { phase: 'hot', teacherId: TEACHER_ID, archivedAt: '2026-07-01T00:00:00.000Z' },
        { phase: 'cold', teacherId: TEACHER_ID, archiveId: approvedPlan.operation_ids.export },
        { phase: 'hot', teacherId: TEACHER_ID, archivedAt: '2026-07-01T00:00:00.000Z' },
      ],
    })
    const result = await runClassroomArchiveProductionCanary({
      plan: approvedPlan,
      dependencies: deps,
    })
    expect(result).toMatchObject({ ok: true, restoreReplayed: true, restoreAttempts: 3 })
    expect(deps.events).toContainEqual({
      phase: 'restore',
      status: 'reconciled',
      errorCode: 'restore_busy',
    })
  })

  it('rejects an already restored hot resume with a mismatched source revision', async () => {
    const restoredEvidence = evidence(99)
    const deps = dependencies({
      initialArchive: true,
      initialEvidence: restoredEvidence,
      postEvidence: restoredEvidence,
    })
    await expect(runClassroomArchiveProductionCanary({ plan: plan(), dependencies: deps }))
      .rejects.toThrow('source revision changed')
  })

  it('compares post-restore evidence to the deterministic rewritten storage projection', async () => {
    const restoredEvidence = evidence(7, 'f'.repeat(64))
    const deps = dependencies({ restoredEvidence, postEvidence: restoredEvidence })
    await expect(runClassroomArchiveProductionCanary({ plan: plan(), dependencies: deps }))
      .resolves.toMatchObject({ ok: true })
  })

  it('finalizes a hot resume after restore without replaying lifecycle mutations', async () => {
    const restoredEvidence = evidence(7, 'f'.repeat(64))
    const deps = dependencies({
      initialArchive: true,
      initialEvidence: restoredEvidence,
      restoredEvidence,
      restoreCompleted: true,
    })
    const result = await runClassroomArchiveProductionCanary({ plan: plan(), dependencies: deps })
    expect(result).toMatchObject({ ok: true, restoreReplayed: true, restoreAttempts: 0 })
    expect(deps.calls).not.toContain('export')
    expect(deps.calls).not.toContain('compact')
    expect(deps.calls).not.toContain('restore')
    expect(deps.calls).toContain('verify')
  })
})
