import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLASSROOM_ARCHIVE_V2_RESOURCES,
  CLASSROOM_ARCHIVE_V2_RESTORE_ORDER,
} from '@/lib/contracts/classroom-archive-resources'
import { buildClassroomArchiveBundle } from '@/lib/server/classroom-archive-format'
import {
  CLASSROOM_ARCHIVE_COMPACTION_OBJECT_BATCH_SIZE,
  compactClassroomArchive,
  isClassroomArchiveCompactionAllowed,
  resolveClassroomArchiveCompactionOperationId,
} from '@/lib/server/classroom-archive-compaction'

const ARCHIVE_ID = '00000000-0000-4000-8000-000000000001'
const CLASSROOM_ID = '00000000-0000-4000-8000-000000000002'
const TEACHER_ID = '00000000-0000-4000-8000-000000000003'
const OPERATION_ID = '00000000-0000-4000-8000-000000000004'
const OTHER_ARCHIVE_ID = '00000000-0000-4000-8000-000000000005'
const OTHER_CLASSROOM_ID = '00000000-0000-4000-8000-000000000006'
const ARCHIVE_PATH = `${TEACHER_ID}/${CLASSROOM_ID}/${ARCHIVE_ID}/classroom-v2.tar.gz`

function emptyResources() {
  return Object.fromEntries(
    CLASSROOM_ARCHIVE_V2_RESOURCES.map((resource) => [resource.table, []]),
  )
}

function fixture(options: { classroomId?: string; objectCount?: number } = {}) {
  const classroomId = options.classroomId ?? CLASSROOM_ID
  const storageObjects = Array.from({ length: options.objectCount ?? 1 }, (_, index) => ({
    bucket: index % 2 === 0
      ? 'assignment-artifacts' as const
      : 'submission-images' as const,
    sourcePath: `student/assignment/object-${index}.txt`,
    contentType: 'text/plain',
    bytes: Buffer.from(`object-${index}`),
  }))
  return buildClassroomArchiveBundle({
    version: 2,
    archiveId: ARCHIVE_ID,
    classroomId,
    teacherId: TEACHER_ID,
    createdAt: '2026-07-13T12:00:00.000Z',
    source: {
      schemaMigration: '082_verified_classroom_archive_exports',
      appCommit: 'abcdef1',
    },
    retention: { mode: 'teacher_managed', delete_after: null },
    resources: {
      ...emptyResources(),
      classrooms: [{
        id: classroomId,
        teacher_id: TEACHER_ID,
        title: 'Cold compaction fixture',
        archived_at: '2026-07-13T12:00:00.000Z',
        archive_references: storageObjects
          .filter((object) => object.bucket === 'submission-images')
          .map((object) =>
            `https://project.supabase.co/storage/v1/object/public/${object.bucket}/${object.sourcePath}`
          ),
      }],
      assignment_submission_artifacts: storageObjects
        .filter((object) => object.bucket === 'assignment-artifacts')
        .map((object, index) => ({
          id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          storage_path: object.sourcePath,
        })),
    },
    actors: [{
      id: TEACHER_ID,
      email: 'teacher@example.test',
      role: 'teacher',
      profile: null,
    }],
    storageObjects,
  })
}

function resourceCounts(bundle: ReturnType<typeof fixture>) {
  return Object.fromEntries(
    bundle.manifest.resources.map((resource) => [resource.table, resource.row_count]),
  )
}

function storageObjectCounts(bundle: ReturnType<typeof fixture>) {
  const byBucket: Record<string, { count: number; bytes: number }> = {}
  let totalBytes = 0
  for (const object of bundle.manifest.storage_objects) {
    byBucket[object.bucket] ||= { count: 0, bytes: 0 }
    byBucket[object.bucket].count += 1
    byBucket[object.bucket].bytes += object.byte_size
    totalBytes += object.byte_size
  }
  return {
    total_count: bundle.manifest.storage_objects.length,
    total_bytes: totalBytes,
    by_bucket: byBucket,
  }
}

function completionVerification(args: Record<string, unknown>) {
  return {
    ...(args.p_verification as Record<string, unknown>),
    source_revision_verified: true,
    resource_ownership_verified: true,
    relational_deletion_verified: true,
    tombstone_verified: true,
  }
}

function createSupabaseMock(options: {
  objectCount?: number
  completedReplay?: boolean
  legacyArchive?: boolean
  beginError?: { code?: string; message?: string }
  corruptArchive?: boolean
  wrongManifestIdentity?: boolean
  wrongResourceCounts?: boolean
  wrongStorageCounts?: boolean
  wrongStoragePath?: boolean
  stageFailure?: boolean
  malformedStage?: boolean
  malformedComplete?: boolean
  mismatchedCompleteCounts?: boolean
  downloadError?: boolean
  completeError?: { code?: string; message?: string }
  mismatchedCompleteVerification?: boolean
  completeFailure?: boolean
  unresolvedActor?: boolean
} = {}) {
  const bundle = fixture({
    classroomId: options.wrongManifestIdentity ? OTHER_CLASSROOM_ID : CLASSROOM_ID,
    objectCount: options.objectCount,
  })
  const expectedResourceCounts = resourceCounts(bundle)
  const expectedStorageCounts = storageObjectCounts(bundle)
  const reportedResourceCounts = options.wrongResourceCounts
    ? { ...expectedResourceCounts, classrooms: 2 }
    : expectedResourceCounts
  const reportedStorageCounts = options.wrongStorageCounts
    ? { ...expectedStorageCounts, total_bytes: expectedStorageCounts.total_bytes + 1 }
    : expectedStorageCounts
  const archiveBytes = options.corruptArchive
    ? Uint8Array.from([...bundle.archive.slice(0, -1), bundle.archive.at(-1)! ^ 1])
    : bundle.archive
  const calls: string[] = []
  const staged = new Map<string, { byteSize: number }>()

  const completed = (replayed: boolean, verification: Record<string, unknown>) => ({
    ok: true,
    status: replayed ? 200 : 201,
    operation_id: OPERATION_ID,
    archive_id: ARCHIVE_ID,
    operation_status: 'completed',
    replayed,
    resource_counts: options.mismatchedCompleteCounts && !replayed
      ? { ...reportedResourceCounts, classrooms: 2 }
      : reportedResourceCounts,
    storage_object_counts: reportedStorageCounts,
    verification,
    source_contract_version: 2,
    archive_format_version: 2,
    restore_contract_version: 2,
  })

  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push(`rpc:${name}`)
    if (name === 'begin_classroom_archive_compaction_v2') {
      if (options.beginError) return { data: null, error: options.beginError }
      if (options.legacyArchive) {
        return {
          data: {
            ok: false,
            status: 409,
            operation_id: OPERATION_ID,
            error_code: 'classroom_archive_reexport_required',
            error: 'Classroom must be re-exported with archive-v2 before compaction',
            retryable: false,
          },
          error: null,
        }
      }
      if (options.completedReplay) {
        return {
          data: completed(true, {
            operation_id: OPERATION_ID,
            archive_id: ARCHIVE_ID,
            artifact_sha256: bundle.artifactSha256,
            content_sha256: bundle.manifest.content_sha256,
            verified_at: '2026-07-13T12:01:00.000Z',
            read_back_verified: true,
            artifact_checksum_verified: true,
            manifest_verified: true,
            resource_checksums_verified: true,
            resource_counts_verified: true,
            storage_objects_verified: true,
            actor_snapshots_verified: true,
            schema_adapter_verified: true,
            actor_references_resolved: true,
            source_object_cleanup_staged: true,
            source_revision_verified: true,
            resource_ownership_verified: true,
            relational_deletion_verified: true,
            tombstone_verified: true,
          }),
          error: null,
        }
      }
      return {
        data: {
          ok: true,
          status: 202,
          operation_id: OPERATION_ID,
          archive_id: ARCHIVE_ID,
          operation_status: 'snapshot_ready',
          replayed: false,
          snapshot_expires_at: '2026-07-14T12:00:00.000Z',
          resource_counts: reportedResourceCounts,
          storage_object_counts: reportedStorageCounts,
          storage_bucket: 'classroom-archives',
          storage_path: options.wrongStoragePath ? 'wrong/archive.tar.gz' : ARCHIVE_PATH,
          artifact_sha256: bundle.artifactSha256,
          content_sha256: bundle.manifest.content_sha256,
          source_contract_version: 2,
          archive_format_version: 2,
          restore_contract_version: 2,
        },
        error: null,
      }
    }
    if (name === 'stage_classroom_archive_compaction_objects') {
      if (options.stageFailure) {
        return {
          data: {
            ok: false,
            status: 409,
            operation_id: OPERATION_ID,
            error_code: 'compaction_not_ready',
            error: 'Compaction operation is not ready',
            retryable: false,
          },
          error: null,
        }
      }
      if (options.malformedStage) return { data: { ok: true }, error: null }
      for (const object of args.p_objects as Array<Record<string, unknown>>) {
        staged.set(`${object.storage_bucket}/${object.storage_path}`, {
          byteSize: object.byte_size as number,
        })
      }
      return {
        data: {
          ok: true,
          status: 202,
          operation_id: OPERATION_ID,
          operation_status: 'snapshot_ready',
          staged_object_count: staged.size,
          staged_object_bytes: [...staged.values()].reduce(
            (total, object) => total + object.byteSize,
            0,
          ),
        },
        error: null,
      }
    }
    if (name === 'stage_classroom_archive_restore_rows') {
      const rows = args.p_rows as Array<Record<string, unknown>>
      return {
        data: {
          ok: true,
          status: 202,
          operation_id: OPERATION_ID,
          table_name: args.p_table_name,
          staged_count: rows.length,
          expected_count: rows.length,
        },
        error: null,
      }
    }
    if (name === 'complete_classroom_archive_compaction_v2') {
      if (options.completeError) return { data: null, error: options.completeError }
      if (options.malformedComplete) return { data: { ok: true, status: 201 }, error: null }
      if (options.completeFailure) {
        return {
          data: {
            ok: false,
            status: 409,
            operation_id: OPERATION_ID,
            error_code: 'classroom_archive_source_changed',
            error: 'Classroom no longer matches the verified archive',
            retryable: false,
          },
          error: null,
        }
      }
      const verification = completionVerification(args)
      if (options.mismatchedCompleteVerification) {
        verification.artifact_sha256 = '9'.repeat(64)
      }
      return {
        data: completed(false, verification),
        error: null,
      }
    }
    if (name === 'fail_classroom_archive_compaction') {
      return { data: true, error: null }
    }
    throw new Error(`Unexpected RPC: ${name}`)
  })

  const storageFrom = vi.fn((bucket: string) => ({
    download: vi.fn(async (path: string) => {
      calls.push(`download:${bucket}/${path}`)
      if (options.downloadError) {
        return { data: null, error: { message: 'temporary storage outage' } }
      }
      return {
        data: {
          type: 'application/gzip',
          arrayBuffer: async () => archiveBytes.buffer.slice(
            archiveBytes.byteOffset,
            archiveBytes.byteOffset + archiveBytes.byteLength,
          ),
        },
        error: null,
      }
    }),
  }))

  const from = vi.fn((table: string) => {
    if (table !== 'users') throw new Error(`Unexpected table: ${table}`)
    return {
      select: vi.fn(() => ({
        in: vi.fn(async () => ({
          data: options.unresolvedActor
            ? []
            : [{ id: TEACHER_ID, email: 'teacher@example.test', role: 'teacher' }],
          error: null,
        })),
      })),
    }
  })

  return {
    bundle,
    calls,
    client: { rpc, from, storage: { from: storageFrom } } as any,
    rpc,
    staged,
    storageFrom,
  }
}

function operationArgs(mock: ReturnType<typeof createSupabaseMock>) {
  return {
    supabase: mock.client,
    operationId: OPERATION_ID,
    teacherId: TEACHER_ID,
    classroomId: CLASSROOM_ID,
    archiveId: ARCHIVE_ID,
    supabaseUrl: 'https://project.supabase.co',
  }
}

describe('classroom archive cold-compaction coordinator', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.stubEnv('CLASSROOM_ARCHIVE_COMPACTION_ENABLED', 'true')
    vi.stubEnv('CLASSROOM_ARCHIVE_COMPACTION_TEACHER_IDS', TEACHER_ID)
    vi.stubEnv('CLASSROOM_ARCHIVE_COMPACTION_ARCHIVE_IDS', ARCHIVE_ID)
  })

  it('requires the enable flag plus exact teacher and archive canary allowlists', () => {
    expect(isClassroomArchiveCompactionAllowed({
      teacherId: TEACHER_ID,
      archiveId: ARCHIVE_ID,
    })).toBe(true)

    vi.stubEnv('CLASSROOM_ARCHIVE_COMPACTION_ENABLED', 'false')
    expect(isClassroomArchiveCompactionAllowed({
      teacherId: TEACHER_ID,
      archiveId: ARCHIVE_ID,
    })).toBe(false)

    vi.stubEnv('CLASSROOM_ARCHIVE_COMPACTION_ENABLED', 'true')
    expect(isClassroomArchiveCompactionAllowed({
      teacherId: TEACHER_ID,
      archiveId: OTHER_ARCHIVE_ID,
    })).toBe(false)
  })

  it('does not touch the database or Storage while the canary is disabled', async () => {
    vi.stubEnv('CLASSROOM_ARCHIVE_COMPACTION_ARCHIVE_IDS', OTHER_ARCHIVE_ID)
    const mock = createSupabaseMock()

    const result = await compactClassroomArchive(operationArgs(mock))

    expect(result).toEqual({
      ok: false,
      status: 503,
      operation_id: OPERATION_ID,
      error_code: 'classroom_archive_compaction_not_enabled',
      error: 'Classroom archive compaction is not enabled for this canary',
      retryable: true,
    })
    expect(mock.rpc).not.toHaveBeenCalled()
    expect(mock.storageFrom).not.toHaveBeenCalled()
  })

  it('verifies the immutable archive, stages exact source objects, then atomically completes', async () => {
    const mock = createSupabaseMock()

    const result = await compactClassroomArchive(operationArgs(mock))

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      status: 201,
      replayed: false,
      archive_id: ARCHIVE_ID,
      cleanup_object_count: 1,
      cleanup_object_bytes: Buffer.byteLength('object-0'),
    }))
    const object = mock.bundle.manifest.storage_objects[0]
    expect(mock.rpc).toHaveBeenCalledWith(
      'stage_classroom_archive_compaction_objects',
      {
        p_operation_id: OPERATION_ID,
        p_teacher_id: TEACHER_ID,
        p_objects: [{
          storage_bucket: object.bucket,
          storage_path: object.source_path,
          sha256: object.sha256,
          byte_size: object.byte_size,
        }],
      },
    )
    expect(mock.calls.indexOf(`download:classroom-archives/${ARCHIVE_PATH}`))
      .toBeLessThan(mock.calls.indexOf('rpc:stage_classroom_archive_compaction_objects'))
    expect(mock.calls.indexOf('rpc:stage_classroom_archive_compaction_objects'))
      .toBeLessThan(mock.calls.indexOf('rpc:complete_classroom_archive_compaction_v2'))
    expect(mock.rpc).toHaveBeenCalledWith(
      'complete_classroom_archive_compaction_v2',
      expect.objectContaining({
        p_actors: [{ actor_id: TEACHER_ID, role: 'teacher' }],
        p_restore_contract_version: 2,
        p_verification: expect.objectContaining({
          operation_id: OPERATION_ID,
          archive_id: ARCHIVE_ID,
          read_back_verified: true,
          schema_adapter_verified: true,
          actor_references_resolved: true,
          source_object_cleanup_staged: true,
        }),
      }),
    )
    const stagedTables = mock.rpc.mock.calls
      .filter(([name]) => name === 'stage_classroom_archive_restore_rows')
      .map(([, args]) => args.p_table_name)
    expect(stagedTables).toEqual(
      CLASSROOM_ARCHIVE_V2_RESTORE_ORDER.filter((table) =>
        table === 'classrooms' || table === 'assignment_submission_artifacts',
      ),
    )
  })

  it('refuses compaction when current actors cannot satisfy a restore preflight', async () => {
    const mock = createSupabaseMock({ unresolvedActor: true })

    const result = await compactClassroomArchive(operationArgs(mock))

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'archive_compaction_restore_preflight_failed',
      retryable: false,
    }))
    expect(mock.rpc).not.toHaveBeenCalledWith(
      'stage_classroom_archive_compaction_objects',
      expect.anything(),
    )
  })

  it('bounds cleanup staging batches and verifies the final aggregate', async () => {
    const objectCount = CLASSROOM_ARCHIVE_COMPACTION_OBJECT_BATCH_SIZE + 1
    const mock = createSupabaseMock({ objectCount })

    const result = await compactClassroomArchive(operationArgs(mock))

    expect(result).toEqual(expect.objectContaining({ ok: true, cleanup_object_count: objectCount }))
    const stageCalls = mock.rpc.mock.calls.filter(
      ([name]) => name === 'stage_classroom_archive_compaction_objects',
    )
    expect(stageCalls).toHaveLength(2)
    expect(stageCalls.map(([, args]) => args.p_objects.length)).toEqual([
      CLASSROOM_ARCHIVE_COMPACTION_OBJECT_BATCH_SIZE,
      1,
    ])
  })

  it('stages an explicit empty inventory before compacting a classroom without objects', async () => {
    const mock = createSupabaseMock({ objectCount: 0 })

    const result = await compactClassroomArchive(operationArgs(mock))

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      cleanup_object_count: 0,
      cleanup_object_bytes: 0,
    }))
    expect(mock.rpc).toHaveBeenCalledWith(
      'stage_classroom_archive_compaction_objects',
      expect.objectContaining({ p_objects: [] }),
    )
  })

  it('returns a completed replay without downloading or staging the archive', async () => {
    const mock = createSupabaseMock({ completedReplay: true })

    const result = await compactClassroomArchive(operationArgs(mock))

    expect(result).toEqual(expect.objectContaining({ ok: true, replayed: true }))
    expect(mock.storageFrom).not.toHaveBeenCalled()
    expect(mock.rpc.mock.calls.map(([name]) => name)).toEqual([
      'begin_classroom_archive_compaction_v2',
    ])
  })

  it('requires a v2 re-export before compacting a historical v1 archive', async () => {
    const mock = createSupabaseMock({ legacyArchive: true })

    const result = await compactClassroomArchive(operationArgs(mock))

    expect(result).toEqual({
      ok: false,
      status: 409,
      operation_id: OPERATION_ID,
      error_code: 'classroom_archive_reexport_required',
      error: 'Classroom must be re-exported with archive-v2 before compaction',
      retryable: false,
    })
    expect(mock.storageFrom).not.toHaveBeenCalled()
    expect(mock.rpc.mock.calls.map(([name]) => name)).toEqual([
      'begin_classroom_archive_compaction_v2',
    ])
  })

  it('rejects a structurally valid begin response with a noncanonical archive path', async () => {
    const mock = createSupabaseMock({ wrongStoragePath: true })

    const result = await compactClassroomArchive(operationArgs(mock))

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'compaction_rpc_contract_invalid',
      retryable: false,
    }))
    expect(mock.storageFrom).not.toHaveBeenCalled()
  })

  it('fails terminally before staging when archive bytes or manifest identity differ', async () => {
    const corrupt = createSupabaseMock({ corruptArchive: true })
    const wrongIdentity = createSupabaseMock({ wrongManifestIdentity: true })

    const corruptResult = await compactClassroomArchive(operationArgs(corrupt))
    const identityResult = await compactClassroomArchive(operationArgs(wrongIdentity))

    expect(corruptResult).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'archive_compaction_checksum_mismatch',
      retryable: false,
    }))
    expect(identityResult).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'archive_compaction_identity_mismatch',
      retryable: false,
    }))
    for (const mock of [corrupt, wrongIdentity]) {
      expect(mock.rpc.mock.calls.map(([name]) => name)).not.toContain(
        'stage_classroom_archive_compaction_objects',
      )
      expect(mock.rpc.mock.calls.map(([name]) => name)).toContain(
        'fail_classroom_archive_compaction',
      )
    }
  })

  it('records a transient archive download failure without making cleanup eligible', async () => {
    const mock = createSupabaseMock({ downloadError: true })

    const result = await compactClassroomArchive(operationArgs(mock))

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'archive_compaction_download_failed',
      retryable: true,
    }))
    expect(mock.rpc).toHaveBeenCalledWith(
      'fail_classroom_archive_compaction',
      expect.objectContaining({ p_retryable: true }),
    )
    expect(mock.rpc.mock.calls.map(([name]) => name)).not.toContain(
      'stage_classroom_archive_compaction_objects',
    )
  })

  it('rejects database inventory drift before staging source-object deletion', async () => {
    const resources = createSupabaseMock({ wrongResourceCounts: true })
    const storage = createSupabaseMock({ wrongStorageCounts: true })

    const resourceResult = await compactClassroomArchive(operationArgs(resources))
    const storageResult = await compactClassroomArchive(operationArgs(storage))

    expect(resourceResult).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'archive_compaction_resource_counts_mismatch',
    }))
    expect(storageResult).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'archive_compaction_storage_counts_mismatch',
    }))
    expect(resources.staged.size).toBe(0)
    expect(storage.staged.size).toBe(0)
  })

  it('never completes after a rejected or malformed staging response', async () => {
    const rejected = createSupabaseMock({ stageFailure: true })
    const malformed = createSupabaseMock({ malformedStage: true })

    const rejectedResult = await compactClassroomArchive(operationArgs(rejected))
    const malformedResult = await compactClassroomArchive(operationArgs(malformed))

    expect(rejectedResult).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'compaction_not_ready',
    }))
    expect(malformedResult).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'compaction_rpc_contract_invalid',
    }))
    for (const mock of [rejected, malformed]) {
      expect(mock.rpc.mock.calls.map(([name]) => name)).not.toContain(
        'complete_classroom_archive_compaction_v2',
      )
    }
  })

  it('fails closed when completion may have committed but its response is malformed', async () => {
    const mock = createSupabaseMock({ malformedComplete: true })

    const result = await compactClassroomArchive(operationArgs(mock))

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'compaction_completion_contract_unknown',
      retryable: false,
    }))
    expect(mock.rpc.mock.calls.map(([name]) => name)).not.toContain(
      'fail_classroom_archive_compaction',
    )
  })

  it('does not claim success when committed completion counts differ from verified inventory', async () => {
    const mock = createSupabaseMock({ mismatchedCompleteCounts: true })

    const result = await compactClassroomArchive(operationArgs(mock))

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'compaction_completion_contract_unknown',
      retryable: false,
    }))
    expect(mock.rpc.mock.calls.map(([name]) => name)).not.toContain(
      'fail_classroom_archive_compaction',
    )
  })

  it('does not claim success when committed verification differs from read-back evidence', async () => {
    const mock = createSupabaseMock({ mismatchedCompleteVerification: true })

    const result = await compactClassroomArchive(operationArgs(mock))

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'compaction_completion_contract_unknown',
      retryable: false,
    }))
    expect(mock.rpc.mock.calls.map(([name]) => name)).not.toContain(
      'fail_classroom_archive_compaction',
    )
  })

  it('records finalization transport failure only after verification and staging', async () => {
    const mock = createSupabaseMock({
      completeError: { code: '08006', message: 'connection failure' },
    })

    const result = await compactClassroomArchive(operationArgs(mock))

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'archive_compaction_finalize_failed',
      retryable: true,
    }))
    expect(mock.calls.indexOf('rpc:stage_classroom_archive_compaction_objects'))
      .toBeLessThan(mock.calls.indexOf('rpc:complete_classroom_archive_compaction_v2'))
    expect(mock.calls.indexOf('rpc:complete_classroom_archive_compaction_v2'))
      .toBeLessThan(mock.calls.indexOf('rpc:fail_classroom_archive_compaction'))
  })

  it('durably records a valid terminal completion failure', async () => {
    const mock = createSupabaseMock({ completeFailure: true })

    const result = await compactClassroomArchive(operationArgs(mock))

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'classroom_archive_source_changed',
      retryable: false,
    }))
    expect(mock.rpc).toHaveBeenCalledWith(
      'fail_classroom_archive_compaction',
      expect.objectContaining({
        p_error_code: 'classroom_archive_source_changed',
        p_retryable: false,
      }),
    )
  })

  it('binds idempotency to a stable non-secret request digest', async () => {
    const first = createSupabaseMock()
    const second = createSupabaseMock()

    await compactClassroomArchive(operationArgs(first))
    await compactClassroomArchive(operationArgs(second))

    const firstHash = first.rpc.mock.calls[0][1].p_request_sha256
    const secondHash = second.rpc.mock.calls[0][1].p_request_sha256
    expect(firstHash).toMatch(/^[a-f0-9]{64}$/)
    expect(secondHash).toBe(firstHash)
    expect(JSON.stringify(first.rpc.mock.calls[0])).not.toContain('teacher@example.test')
  })

  it('maps an unavailable begin RPC to migration required and records no invented state', async () => {
    const mock = createSupabaseMock({
      beginError: { code: 'PGRST202', message: 'missing function' },
    })

    const result = await compactClassroomArchive(operationArgs(mock))

    expect(result).toEqual({
      ok: false,
      status: 503,
      operation_id: OPERATION_ID,
      error_code: 'classroom_archive_compaction_migration_required',
      error: 'Classroom archive compaction requires migration 107',
      retryable: true,
    })
    expect(mock.rpc.mock.calls.map(([name]) => name)).toEqual([
      'begin_classroom_archive_compaction_v2',
      'fail_classroom_archive_compaction',
    ])
  })

  it('validates caller-provided idempotency keys and generates one when absent', () => {
    expect(resolveClassroomArchiveCompactionOperationId(` ${OPERATION_ID} `)).toBe(OPERATION_ID)
    expect(resolveClassroomArchiveCompactionOperationId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(() => resolveClassroomArchiveCompactionOperationId('not-a-uuid')).toThrow()
  })
})
