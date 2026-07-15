import { describe, expect, it, vi } from 'vitest'
import { CLASSROOM_RELATIONAL_RESOURCES } from '@/lib/contracts/classroom-data'
import {
  assertClassroomArchiveProductionCanaryExecution,
  classroomArchiveProductionCanaryAcknowledgement,
  classroomArchiveProductionCanaryEvidenceDigest,
  createClassroomArchiveProductionCanaryPlan,
  deriveClassroomArchiveProductionCanaryOperationId,
  normalizeClassroomArchiveProductionCanaryCliArguments,
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
      'restore', 'evidence', 'verify',
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
