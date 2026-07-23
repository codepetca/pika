import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CLASSROOM_ARCHIVE_V1_RESOURCES } from '@/lib/contracts/classroom-archive-resources'
import { buildClassroomArchiveBundle } from '@/lib/server/classroom-archive-format'
import {
  classroomArchiveRestoreObjectPath,
} from '@/lib/server/classroom-archive-restore'
import {
  isClassroomArchiveRestoreAllowed,
  resolveClassroomArchiveRestoreDatabaseBudget,
  restoreClassroomArchive,
} from '@/lib/server/classroom-archive-restore-operations'

const ARCHIVE_ID = '00000000-0000-4000-8000-000000000001'
const CLASSROOM_ID = '00000000-0000-4000-8000-000000000002'
const TEACHER_ID = '00000000-0000-4000-8000-000000000003'
const OPERATION_ID = '00000000-0000-4000-8000-000000000004'
const STUDENT_ID = '00000000-0000-4000-8000-000000000005'
const ASSIGNMENT_ID = '10000000-0000-4000-8000-000000000001'
const DOC_ID = '10000000-0000-4000-8000-000000000002'
const ARTIFACT_ID = '10000000-0000-4000-8000-000000000003'

function resources() {
  return {
    ...Object.fromEntries(CLASSROOM_ARCHIVE_V1_RESOURCES.map((resource) => [resource.table, []])),
    classrooms: [{ id: CLASSROOM_ID, teacher_id: TEACHER_ID, title: 'Restore fixture', archived_at: '2026-07-13T12:00:00.000Z' }],
    assignments: [{ id: ASSIGNMENT_ID, classroom_id: CLASSROOM_ID, created_by: TEACHER_ID }],
    assignment_docs: [{ id: DOC_ID, assignment_id: ASSIGNMENT_ID, student_id: STUDENT_ID }],
    assignment_submission_artifacts: [{
      id: ARTIFACT_ID,
      assignment_doc_id: DOC_ID,
      student_id: STUDENT_ID,
      storage_path: 'student/evidence.png',
    }],
  }
}

function archiveV1ResourceCounts() {
  return Object.fromEntries(
    CLASSROOM_ARCHIVE_V1_RESOURCES.map((resource) => [
      resource.table,
      ['classrooms', 'assignments', 'assignment_docs', 'assignment_submission_artifacts']
        .includes(resource.table) ? 1 : 0,
    ]),
  )
}

function fixture() {
  return buildClassroomArchiveBundle({
    version: 1,
    archiveId: ARCHIVE_ID,
    classroomId: CLASSROOM_ID,
    teacherId: TEACHER_ID,
    createdAt: '2026-07-13T12:00:00.000Z',
    source: { schemaMigration: '082_verified_classroom_archive_exports', appCommit: 'abcdef1' },
    retention: { mode: 'teacher_managed', delete_after: null },
    resources: resources(),
    actors: [
      { id: TEACHER_ID, email: 'teacher@example.test', role: 'teacher', profile: null },
      {
        id: STUDENT_ID,
        email: 'student@example.test',
        role: 'student',
        profile: {
          id: '10000000-0000-4000-8000-000000000004',
          user_id: STUDENT_ID,
          student_number: 'S1',
          first_name: 'Restore',
          last_name: 'Student',
          created_at: '2026-07-13T12:00:00.000Z',
        },
      },
    ],
    storageObjects: [{
      bucket: 'assignment-artifacts',
      sourcePath: 'student/evidence.png',
      contentType: 'image/png',
      bytes: Buffer.from('restore evidence'),
    }],
  })
}

function createSupabaseMock(options: {
  corruptArchive?: boolean
  beginError?: { code?: string; message?: string }
  completeMalformed?: boolean
  stageFailure?: boolean
  failureRecorded?: boolean
  failureRecordThrows?: boolean
  postUploadReadFailureOnce?: boolean
  stageRpcThrows?: boolean
  preexistingRestoreObject?: boolean
  metadataErrorOnce?: boolean
} = {}) {
  const bundle = fixture()
  const counts = archiveV1ResourceCounts()
  const archive = options.corruptArchive
    ? Uint8Array.from([...bundle.archive.slice(0, -1), bundle.archive.at(-1)! ^ 1])
    : bundle.archive
  const stored = new Map<string, Uint8Array>()
  const removed: string[] = []
  if (options.preexistingRestoreObject) {
    const object = bundle.manifest.storage_objects[0]
    const restorePath = classroomArchiveRestoreObjectPath({
      classroomId: CLASSROOM_ID,
      operationId: OPERATION_ID,
      sha256: object.sha256,
      sourcePath: object.source_path,
      contentType: object.content_type,
    })
    stored.set(`assignment-artifacts/${restorePath}`, Buffer.from('restore evidence'))
  }
  let postUploadReadFailed = false
  let metadataReads = 0
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'begin_classroom_archive_restore_v2') {
      if (options.beginError) return { data: null, error: options.beginError }
      return {
        data: {
          ok: true,
          status: 202,
          operation_id: OPERATION_ID,
          archive_id: ARCHIVE_ID,
          operation_status: 'snapshot_ready',
          replayed: false,
          resource_counts: counts,
          source_contract_version: 1,
          archive_format_version: 1,
          restore_contract_version: 2,
          snapshot_expires_at: '2026-07-14T12:00:00.000Z',
          database_size_bytes: 100,
          required_headroom_bytes: 200,
        },
        error: null,
      }
    }
    if (name === 'stage_classroom_archive_restore_rows_v2') {
      if (options.stageRpcThrows) throw new Error('staging transport unavailable')
      if (options.stageFailure) {
        return {
          data: {
            ok: false,
            status: 409,
            operation_id: OPERATION_ID,
            error_code: 'restore_staging_rejected',
            error: 'Restore staging rejected',
            retryable: false,
          },
          error: null,
        }
      }
      return {
        data: {
          ok: true,
          status: 202,
          operation_id: OPERATION_ID,
          table_name: args.p_table_name,
          staged_count: 1,
          expected_count: 1,
          restore_contract_version: 2,
        },
        error: null,
      }
    }
    if (name === 'stage_classroom_archive_object_upload') {
      return { data: true, error: null }
    }
    if (name === 'complete_classroom_archive_restore_v2') {
      if (options.completeMalformed) {
        return { data: { ok: true, status: 201 }, error: null }
      }
      return {
        data: {
          ok: true,
          status: 201,
          operation_id: OPERATION_ID,
          archive_id: ARCHIVE_ID,
          operation_status: 'completed',
          replayed: false,
          resource_counts: counts,
          verification: {
            ...(args.p_verification as Record<string, unknown>),
            referential_integrity_verified: true,
          },
        },
        error: null,
      }
    }
    if (name === 'fail_classroom_archive_restore') {
      if (options.failureRecordThrows) throw new Error('failure record unavailable')
      return { data: options.failureRecorded !== false, error: null }
    }
    return { data: true, error: null }
  })

  function from(table: string) {
    if (table === 'classroom_archives') {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        single: vi.fn(async () => {
          metadataReads += 1
          if (options.metadataErrorOnce && metadataReads === 1) {
            return { data: null, error: { code: 'PGRST503', message: 'temporarily unavailable' } }
          }
          return {
            data: {
            id: ARCHIVE_ID,
            classroom_id: CLASSROOM_ID,
            teacher_id: TEACHER_ID,
            format_version: 1,
            storage_bucket: 'classroom-archives',
            storage_path: 'teacher/classroom/archive/classroom-v1.tar.gz',
            artifact_sha256: bundle.artifactSha256,
            content_sha256: bundle.manifest.content_sha256,
            compressed_byte_size: bundle.archive.byteLength,
            uncompressed_byte_size: bundle.uncompressedByteSize,
            resource_counts: counts,
            },
            error: null,
          }
        }),
      }
      return query
    }
    const query = {
      select: vi.fn(() => query),
      in: vi.fn(async () => ({
        data: [
          { id: TEACHER_ID, email: 'teacher@example.test', role: 'teacher' },
          { id: STUDENT_ID, email: 'student@example.test', role: 'student' },
        ],
        error: null,
      })),
    }
    return query
  }

  const storage = {
    from: vi.fn((bucket: string) => ({
      download: vi.fn(async (path: string) => {
        const bytes = bucket === 'classroom-archives'
          ? archive
          : stored.get(`${bucket}/${path}`)
        if (
          bucket !== 'classroom-archives' &&
          bytes &&
          options.postUploadReadFailureOnce &&
          !postUploadReadFailed
        ) {
          postUploadReadFailed = true
          throw new Error('transient read failure')
        }
        return bytes
          ? {
              data: {
                type: bucket === 'classroom-archives' ? 'application/gzip' : 'image/png',
                arrayBuffer: async () => bytes.buffer.slice(
                  bytes.byteOffset,
                  bytes.byteOffset + bytes.byteLength,
                ),
              },
              error: null,
            }
          : { data: null, error: { message: 'not found' } }
      }),
      upload: vi.fn(async (path: string, bytes: Uint8Array) => {
        stored.set(`${bucket}/${path}`, Uint8Array.from(bytes))
        return { data: { path }, error: null }
      }),
      remove: vi.fn(async (paths: string[]) => {
        for (const path of paths) {
          stored.delete(`${bucket}/${path}`)
          removed.push(`${bucket}/${path}`)
        }
        return { data: paths, error: null }
      }),
    })),
  }
  return { client: { rpc, from, storage } as any, removed, rpc, stored }
}

describe('classroom archive restore coordinator', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  it('requires a separate restore flag, exact teacher allowlist, and explicit database budget', () => {
    expect(isClassroomArchiveRestoreAllowed(TEACHER_ID)).toBe(false)
    vi.stubEnv('CLASSROOM_ARCHIVE_RESTORE_ENABLED', 'true')
    vi.stubEnv('CLASSROOM_ARCHIVE_RESTORE_TEACHER_IDS', TEACHER_ID)
    vi.stubEnv('CLASSROOM_ARCHIVE_RESTORE_DATABASE_BUDGET_BYTES', '524288000')
    expect(isClassroomArchiveRestoreAllowed(TEACHER_ID)).toBe(true)
    expect(resolveClassroomArchiveRestoreDatabaseBudget()).toBe(524288000)
  })

  it('verifies, reconciles, adapts, stages parent-first, and completes through migration 105', async () => {
    const mock = createSupabaseMock()
    const result = await restoreClassroomArchive({
      supabase: mock.client,
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      teacherId: TEACHER_ID,
      classroomId: CLASSROOM_ID,
      databaseBudgetBytes: 524288000,
      supabaseUrl: 'https://project.supabase.co',
    })

    expect(result).toEqual(expect.objectContaining({ ok: true, status: 201, replayed: false }))
    expect(mock.rpc.mock.calls.map(([name]) => name)).toEqual([
      'begin_classroom_archive_restore_v2',
      'stage_classroom_archive_object_upload',
      'stage_classroom_archive_restore_rows_v2',
      'stage_classroom_archive_restore_rows_v2',
      'stage_classroom_archive_restore_rows_v2',
      'stage_classroom_archive_restore_rows_v2',
      'complete_classroom_archive_restore_v2',
    ])
    expect(mock.rpc.mock.calls[0][1]).toEqual(expect.objectContaining({
      p_source_contract_version: 1,
      p_restore_contract_version: 2,
      p_source_resource_counts: archiveV1ResourceCounts(),
    }))
    expect(mock.rpc.mock.calls[2][1]).toEqual(expect.objectContaining({
      p_restore_contract_version: 2,
    }))
    expect(mock.rpc.mock.calls[6][1]).toEqual(expect.objectContaining({
      p_restore_contract_version: 2,
    }))
    expect(mock.rpc.mock.calls[6][1].p_verification).not.toHaveProperty(
      'referential_integrity_verified',
    )
    expect(result.ok && result.verification.referential_integrity_verified).toBe(true)
    expect(mock.stored.size).toBe(1)
    expect(mock.removed).toEqual([])
  })

  it('rejects an outer checksum mismatch before starting a database operation', async () => {
    const mock = createSupabaseMock({ corruptArchive: true })
    const result = await restoreClassroomArchive({
      supabase: mock.client,
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      teacherId: TEACHER_ID,
      classroomId: CLASSROOM_ID,
      databaseBudgetBytes: 524288000,
      supabaseUrl: 'https://project.supabase.co',
    })
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'classroom_archive_artifact_mismatch',
      retryable: false,
    }))
    expect(mock.rpc).not.toHaveBeenCalled()
  })

  it('reports a missing migration without claiming a restore operation was recorded', async () => {
    const mock = createSupabaseMock({ beginError: { code: 'PGRST202', message: 'missing function' } })
    const result = await restoreClassroomArchive({
      supabase: mock.client,
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      teacherId: TEACHER_ID,
      classroomId: CLASSROOM_ID,
      databaseBudgetBytes: 524288000,
      supabaseUrl: 'https://project.supabase.co',
    })
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'classroom_archive_restore_migration_required',
      retryable: true,
    }))
    expect(mock.rpc.mock.calls.map(([name]) => name)).toEqual([
      'begin_classroom_archive_restore_v2',
    ])
  })

  it('records a terminal staging rejection against the begun operation', async () => {
    const mock = createSupabaseMock({ stageFailure: true })
    const result = await restoreClassroomArchive({
      supabase: mock.client,
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      teacherId: TEACHER_ID,
      classroomId: CLASSROOM_ID,
      databaseBudgetBytes: 524288000,
      supabaseUrl: 'https://project.supabase.co',
    })
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'restore_staging_rejected',
      retryable: false,
    }))
    expect(mock.rpc.mock.calls.map(([name]) => name)).toEqual([
      'begin_classroom_archive_restore_v2',
      'stage_classroom_archive_object_upload',
      'stage_classroom_archive_restore_rows_v2',
      'fail_classroom_archive_restore',
    ])
    expect(mock.stored.size).toBe(0)
    expect(mock.removed).toHaveLength(1)
  })

  it('retains restored objects when the finalization result is ambiguous', async () => {
    const mock = createSupabaseMock({ completeMalformed: true })
    const result = await restoreClassroomArchive({
      supabase: mock.client,
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      teacherId: TEACHER_ID,
      classroomId: CLASSROOM_ID,
      databaseBudgetBytes: 524288000,
      supabaseUrl: 'https://project.supabase.co',
    })
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'classroom_archive_restore_finalize_contract_invalid',
      retryable: true,
    }))
    expect(mock.stored.size).toBe(1)
    expect(mock.removed).toEqual([])
    expect(mock.rpc.mock.calls.map(([name]) => name).slice(-2)).toEqual([
      'complete_classroom_archive_restore_v2',
      'fail_classroom_archive_restore',
    ])
  })

  it('retains shared restore objects when the database did not authorize terminal cleanup', async () => {
    const mock = createSupabaseMock({ stageFailure: true, failureRecorded: false })
    const result = await restoreClassroomArchive({
      supabase: mock.client,
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      teacherId: TEACHER_ID,
      classroomId: CLASSROOM_ID,
      databaseBudgetBytes: 524288000,
      supabaseUrl: 'https://project.supabase.co',
    })

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'classroom_archive_restore_failure_recording_failed',
      retryable: true,
    }))
    expect(mock.stored.size).toBe(1)
    expect(mock.removed).toEqual([])
  })

  it('retries the same operation after a transient post-upload read failure', async () => {
    const mock = createSupabaseMock({ postUploadReadFailureOnce: true })
    const args = {
      supabase: mock.client,
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      teacherId: TEACHER_ID,
      classroomId: CLASSROOM_ID,
      databaseBudgetBytes: 524288000,
      supabaseUrl: 'https://project.supabase.co',
    }

    await expect(restoreClassroomArchive(args)).resolves.toEqual(expect.objectContaining({
      ok: false,
      operation_id: OPERATION_ID,
      error_code: 'restore_storage_readback_failed',
      retryable: true,
    }))
    expect(mock.stored.size).toBe(1)
    expect(mock.removed).toEqual([])

    await expect(restoreClassroomArchive(args)).resolves.toEqual(expect.objectContaining({
      ok: true,
      operation_id: OPERATION_ID,
    }))
  })

  it('returns a structured failure when durable failure recording throws', async () => {
    const mock = createSupabaseMock({ stageFailure: true, failureRecordThrows: true })
    await expect(restoreClassroomArchive({
      supabase: mock.client,
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      teacherId: TEACHER_ID,
      classroomId: CLASSROOM_ID,
      databaseBudgetBytes: 524288000,
      supabaseUrl: 'https://project.supabase.co',
    })).resolves.toEqual(expect.objectContaining({
      ok: false,
      error_code: 'classroom_archive_restore_failure_recording_failed',
      retryable: true,
    }))
    expect(mock.stored.size).toBe(1)
    expect(mock.removed).toEqual([])
  })

  it('keeps unexpected SDK failures retryable for the fixed operation id', async () => {
    const mock = createSupabaseMock({ stageRpcThrows: true })
    await expect(restoreClassroomArchive({
      supabase: mock.client,
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      teacherId: TEACHER_ID,
      classroomId: CLASSROOM_ID,
      databaseBudgetBytes: 524288000,
      supabaseUrl: 'https://project.supabase.co',
    })).resolves.toEqual(expect.objectContaining({
      ok: false,
      error_code: 'classroom_archive_restore_unexpected_failure',
      retryable: true,
    }))
  })

  it('does not remove a matching object that this invocation reused', async () => {
    const mock = createSupabaseMock({ stageFailure: true, preexistingRestoreObject: true })
    await expect(restoreClassroomArchive({
      supabase: mock.client,
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      teacherId: TEACHER_ID,
      classroomId: CLASSROOM_ID,
      databaseBudgetBytes: 524288000,
      supabaseUrl: 'https://project.supabase.co',
    })).resolves.toEqual(expect.objectContaining({
      ok: false,
      error_code: 'restore_staging_rejected',
    }))
    expect(mock.stored.size).toBe(1)
    expect(mock.removed).toEqual([])
  })

  it('retries the same operation after a transient archive metadata read error', async () => {
    const mock = createSupabaseMock({ metadataErrorOnce: true })
    const args = {
      supabase: mock.client,
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      teacherId: TEACHER_ID,
      classroomId: CLASSROOM_ID,
      databaseBudgetBytes: 524288000,
      supabaseUrl: 'https://project.supabase.co',
    }
    await expect(restoreClassroomArchive(args)).resolves.toEqual(expect.objectContaining({
      ok: false,
      error_code: 'classroom_archive_metadata_read_failed',
      retryable: true,
    }))
    await expect(restoreClassroomArchive(args)).resolves.toEqual(expect.objectContaining({
      ok: true,
      operation_id: OPERATION_ID,
    }))
  })
})
