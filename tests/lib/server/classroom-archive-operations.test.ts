import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CLASSROOM_ARCHIVE_V2_RESOURCES } from '@/lib/contracts/classroom-archive-resources'
import {
  verifyClassroomArchiveBundle,
} from '@/lib/server/classroom-archive-format'
import {
  CLASSROOM_ARCHIVE_BUCKET,
  exportClassroomArchive,
  isClassroomArchiveExportAllowed,
} from '@/lib/server/classroom-archive-operations'

const OPERATION_ID = '00000000-0000-4000-8000-000000000001'
const CLASSROOM_ID = '00000000-0000-4000-8000-000000000002'
const TEACHER_ID = '00000000-0000-4000-8000-000000000003'
const STUDENT_ID = '00000000-0000-4000-8000-000000000004'
const SNAPSHOT_AT = '2026-07-13T12:00:00.000Z'

function v2ResourceCounts(rows: Record<string, unknown[]> = {}) {
  return Object.fromEntries(
    CLASSROOM_ARCHIVE_V2_RESOURCES.map((resource) => [
      resource.table,
      rows[resource.table]?.length || (resource.table === 'classrooms' ? 1 : 0),
    ]),
  )
}

type QueryState = {
  table: string
  filters: Record<string, unknown>
  inFilter?: { column: string; values: string[] }
}

function createSupabaseMock(options: {
  completionFailure?: boolean
  sourceRows?: Record<string, Array<Record<string, unknown>>>
  v2BeginError?: { code?: string; message?: string }
  v2Unavailable?: boolean
} = {}) {
  const sourceRows: Record<string, Array<Record<string, unknown>>> = {
    classrooms: [{
      id: CLASSROOM_ID,
      teacher_id: TEACHER_ID,
      title: 'Archive fixture',
      archived_at: SNAPSHOT_AT,
    }],
    ...options.sourceRows,
  }
  const counts = v2ResourceCounts(sourceRows)
  const stored = new Map<string, Uint8Array>()
  const removed: string[] = []
  const queriedTables: string[] = []
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'begin_classroom_archive_export_v2') {
      if (options.v2Unavailable) {
        return { data: null, error: { code: 'PGRST202', message: 'missing v2 function' } }
      }
      if (options.v2BeginError) return { data: null, error: options.v2BeginError }
      return {
        data: {
          ok: true,
          status: 202,
          operation_id: OPERATION_ID,
          archive_id: OPERATION_ID,
          operation_status: 'snapshot_ready',
          replayed: false,
          snapshot_created_at: SNAPSHOT_AT,
          snapshot_expires_at: '2026-07-14T12:00:00.000Z',
          source_revision: 4,
          resource_counts: counts,
          source_contract_version: 2,
          archive_format_version: 2,
        },
        error: null,
      }
    }
    if (name === 'complete_classroom_archive_export_v2') {
      if (options.completionFailure) {
        return {
          data: {
            ok: false,
            status: 409,
            operation_id: OPERATION_ID,
            error_code: 'classroom_changed_during_export',
            error: 'Classroom data changed during archive export',
            retryable: false,
          },
          error: null,
        }
      }
      return {
        data: {
          ok: true,
          status: 201,
          operation_id: OPERATION_ID,
          archive_id: OPERATION_ID,
          operation_status: 'completed',
          replayed: false,
          storage_bucket: CLASSROOM_ARCHIVE_BUCKET,
          storage_path: args.p_storage_path,
          artifact_sha256: args.p_artifact_sha256,
          content_sha256: args.p_content_sha256,
          compressed_byte_size: args.p_compressed_byte_size,
          uncompressed_byte_size: args.p_uncompressed_byte_size,
          resource_counts: args.p_archive_resource_counts,
          storage_object_counts: args.p_storage_object_counts,
          verification: args.p_verification,
          source_contract_version: 2,
          archive_format_version: 2,
        },
        error: null,
      }
    }
    return { data: true, error: null }
  })

  function executeQuery(state: QueryState) {
    if (state.table === 'classroom_archive_snapshot_resources') {
      return {
        data: (sourceRows[String(state.filters.table_name)] || []).map((row) => ({
          row_id: row.id,
        })),
        error: null,
      }
    }
    if (state.table === 'classroom_archive_snapshot_actors') {
      return {
        data: [{
          snapshot: {
            id: TEACHER_ID,
            email: 'teacher@example.test',
            role: 'teacher',
            profile: null,
          },
        }, ...(options.sourceRows
          ? [{
              snapshot: {
                id: STUDENT_ID,
                email: 'student@example.test',
                role: 'student',
                profile: null,
              },
            }]
          : [])],
        error: null,
      }
    }
    if (state.inFilter) {
      return {
        data: (sourceRows[state.table] || []).filter((row) =>
          state.inFilter?.values.includes(String(row[state.inFilter.column])),
        ),
        error: null,
      }
    }
    return { data: [], error: null }
  }

  function from(table: string) {
    queriedTables.push(table)
    const state: QueryState = { table, filters: {} }
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((column: string, value: unknown) => {
        state.filters[column] = value
        return query
      }),
      in: vi.fn((column: string, values: string[]) => {
        state.inFilter = { column, values }
        return query
      }),
      order: vi.fn(() => query),
      range: vi.fn(() => query),
      then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) =>
        Promise.resolve(executeQuery(state)).then(resolve, reject),
    }
    return query
  }

  const storage = {
    from: vi.fn((bucket: string) => ({
      download: vi.fn(async (path: string) => {
        const bytes = stored.get(`${bucket}/${path}`)
        return bytes
          ? {
              data: {
                type: 'application/gzip',
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

  return {
    client: { rpc, from, storage } as any,
    rpc,
    stored,
    removed,
    queriedTables,
  }
}

describe('classroom archive export coordinator', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  it('requires both the server enable flag and an exact teacher canary match', () => {
    expect(isClassroomArchiveExportAllowed(TEACHER_ID)).toBe(false)

    vi.stubEnv('CLASSROOM_ARCHIVE_EXPORT_ENABLED', 'true')
    vi.stubEnv(
      'CLASSROOM_ARCHIVE_EXPORT_TEACHER_IDS',
      `00000000-0000-4000-8000-000000000099, ${TEACHER_ID}`,
    )
    expect(isClassroomArchiveExportAllowed(TEACHER_ID)).toBe(true)
    expect(isClassroomArchiveExportAllowed('00000000-0000-4000-8000-000000000099')).toBe(true)
    expect(isClassroomArchiveExportAllowed('00000000-0000-4000-8000-000000000098')).toBe(false)
  })

  it('captures, builds, uploads, reads back, verifies, and finalizes an archive', async () => {
    const mock = createSupabaseMock()
    const result = await exportClassroomArchive({
      supabase: mock.client,
      operationId: OPERATION_ID,
      teacherId: TEACHER_ID,
      classroomId: CLASSROOM_ID,
      retention: { mode: 'teacher_managed', delete_after: null },
      sourceAppCommit: 'abcdef1234567890',
      supabaseUrl: 'https://project.supabase.co',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.resource_counts).toEqual(v2ResourceCounts())
    expect(result.verification.read_back_verified).toBe(true)
    expect(result.compressed_byte_size).toBeGreaterThan(0)
    expect(mock.rpc.mock.calls.map(([name]) => name)).toEqual([
      'begin_classroom_archive_export_v2',
      'stage_classroom_archive_object_upload',
      'complete_classroom_archive_export_v2',
    ])
    expect([...mock.stored.keys()]).toEqual([
      `${CLASSROOM_ARCHIVE_BUCKET}/${TEACHER_ID}/${CLASSROOM_ID}/${OPERATION_ID}/classroom-v2.tar.gz`,
    ])
    expect(mock.rpc.mock.calls[2][1]).toEqual(expect.objectContaining({
      p_resource_counts: v2ResourceCounts(),
      p_archive_resource_counts: v2ResourceCounts(),
    }))
    const storedArchive = [...mock.stored.values()][0]
    const verification = verifyClassroomArchiveBundle(storedArchive)
    expect(verification.ok && verification.manifest.version).toBe(2)
  })

  it('fails closed instead of falling back when migration 107 is unavailable', async () => {
    const mock = createSupabaseMock({ v2Unavailable: true })
    const result = await exportClassroomArchive({
      supabase: mock.client,
      operationId: OPERATION_ID,
      teacherId: TEACHER_ID,
      classroomId: CLASSROOM_ID,
      retention: { mode: 'teacher_managed', delete_after: null },
      sourceAppCommit: 'abcdef1234567890',
      supabaseUrl: 'https://project.supabase.co',
    })

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'classroom_archive_migration_required',
    }))
    expect(mock.rpc.mock.calls.map(([name]) => name)).toEqual([
      'begin_classroom_archive_export_v2',
      'fail_classroom_archive_export',
    ])
  })

  it('does not fall back when the archive-v2 begin RPC returns a domain failure', async () => {
    const mock = createSupabaseMock({
      v2BeginError: { code: '40001', message: 'source changed' },
    })
    const result = await exportClassroomArchive({
      supabase: mock.client,
      operationId: OPERATION_ID,
      teacherId: TEACHER_ID,
      classroomId: CLASSROOM_ID,
      retention: { mode: 'teacher_managed', delete_after: null },
      sourceAppCommit: 'abcdef1234567890',
      supabaseUrl: 'https://project.supabase.co',
    })

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'archive_snapshot_begin_failed',
    }))
    expect(mock.rpc.mock.calls.map(([name]) => name)).toEqual([
      'begin_classroom_archive_export_v2',
      'fail_classroom_archive_export',
    ])
  })

  it('removes a newly uploaded orphan when finalization rejects a changed classroom', async () => {
    const mock = createSupabaseMock({ completionFailure: true })
    const result = await exportClassroomArchive({
      supabase: mock.client,
      operationId: OPERATION_ID,
      teacherId: TEACHER_ID,
      classroomId: CLASSROOM_ID,
      retention: { mode: 'teacher_managed', delete_after: null },
      sourceAppCommit: 'abcdef1234567890',
      supabaseUrl: 'https://project.supabase.co',
    })

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_code: 'classroom_changed_during_export',
      retryable: false,
    }))
    expect(mock.stored.size).toBe(0)
    expect(mock.removed).toHaveLength(1)
  })

  it('does not read retired Quiz tables into direct archive-v2 exports', async () => {
    const quizId = '10000000-0000-4000-8000-000000000001'
    const questionId = '10000000-0000-4000-8000-000000000002'
    const mock = createSupabaseMock({
      sourceRows: {
        quizzes: [{
          id: quizId,
          classroom_id: CLASSROOM_ID,
          created_by: TEACHER_ID,
          title: 'Retired quiz',
          created_at: SNAPSHOT_AT,
          updated_at: SNAPSHOT_AT,
        }],
        quiz_questions: [{
          id: questionId,
          quiz_id: quizId,
          question_text: 'Retired question',
        }],
        quiz_responses: [{
          id: '10000000-0000-4000-8000-000000000003',
          quiz_id: quizId,
          question_id: questionId,
          student_id: STUDENT_ID,
          selected_option: 1,
        }],
        quiz_student_scores: [{
          id: '10000000-0000-4000-8000-000000000004',
          quiz_id: quizId,
          student_id: STUDENT_ID,
          manual_override_score: 9,
        }],
      },
    })

    const result = await exportClassroomArchive({
      supabase: mock.client,
      operationId: OPERATION_ID,
      teacherId: TEACHER_ID,
      classroomId: CLASSROOM_ID,
      retention: { mode: 'teacher_managed', delete_after: null },
      sourceAppCommit: 'abcdef1234567890',
      supabaseUrl: 'https://project.supabase.co',
    })

    expect(result.ok).toBe(true)
    const verification = verifyClassroomArchiveBundle([...mock.stored.values()][0])
    expect(verification.ok).toBe(true)
    if (!verification.ok) throw new Error(verification.error)
    expect(verification.manifest.version).toBe(2)
    expect(mock.rpc.mock.calls[2][1]).toEqual(expect.objectContaining({
      p_resource_counts: v2ResourceCounts(),
      p_archive_resource_counts: v2ResourceCounts(),
    }))
    expect(mock.queriedTables).not.toEqual(expect.arrayContaining([
      'quizzes',
      'quiz_questions',
      'quiz_responses',
      'quiz_student_scores',
    ]))
  })

  it('fails closed with a migration-required result when the begin RPC is unavailable', async () => {
    const mock = createSupabaseMock({
      v2Unavailable: true,
    })
    const result = await exportClassroomArchive({
      supabase: mock.client,
      operationId: OPERATION_ID,
      teacherId: TEACHER_ID,
      classroomId: CLASSROOM_ID,
      retention: { mode: 'teacher_managed', delete_after: null },
      sourceAppCommit: 'abcdef1234567890',
      supabaseUrl: 'https://project.supabase.co',
    })

    expect(result).toEqual({
      ok: false,
      status: 503,
      operation_id: OPERATION_ID,
      error_code: 'classroom_archive_migration_required',
      error: 'Classroom archive export requires migration 107',
      retryable: true,
    })
    expect(mock.rpc.mock.calls.map(([name]) => name)).toEqual([
      'begin_classroom_archive_export_v2',
      'fail_classroom_archive_export',
    ])
  })
})
