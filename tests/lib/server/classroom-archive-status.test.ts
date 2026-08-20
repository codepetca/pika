import { afterEach, describe, expect, it, vi } from 'vitest'
import { listTeacherHotArchiveRecovery } from '@/lib/server/classroom-archive-status'

const TEACHER_ID = '00000000-0000-4000-8000-000000000001'
const CLASSROOM_ID = '00000000-0000-4000-8000-000000000002'

function createQuery(result: { data: unknown; error: { code?: string } | null }, withOperationType = false) {
  const order = vi.fn().mockResolvedValue(result)
  const inFilter = vi.fn(() => ({ order }))
  const operationType = vi.fn(() => ({ in: inFilter }))
  const teacher = vi.fn(() => withOperationType
    ? { eq: operationType }
    : { in: inFilter })
  const select = vi.fn(() => ({ eq: teacher }))
  return { select, teacher, operationType, inFilter, order }
}

function createSupabaseMock(args: {
  archives: { data: unknown; error: { code?: string } | null }
  operations: { data: unknown; error: { code?: string } | null }
  revisions?: { data: unknown; error: { code?: string } | null }
}) {
  const archives = createQuery(args.archives)
  const operations = createQuery(args.operations, true)
  const revisionsResult = args.revisions ?? {
    data: [{ classroom_id: CLASSROOM_ID, revision: 7 }],
    error: null,
  }
  const revisionsIn = vi.fn().mockResolvedValue(revisionsResult)
  const revisionsSelect = vi.fn(() => ({ in: revisionsIn }))
  const from = vi.fn((table: string) => {
    if (table === 'classroom_archives') return { select: archives.select }
    if (table === 'classroom_archive_operations') return { select: operations.select }
    if (table === 'classroom_archive_revisions') return { select: revisionsSelect }
    throw new Error(`Unexpected table: ${table}`)
  })
  return { client: { from } as any, from, archives, operations, revisionsIn }
}

describe('teacher hot archive recovery status', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns the latest privacy-safe recovery evidence for the scoped teacher classrooms', async () => {
    vi.stubEnv('CLASSROOM_ARCHIVE_EXPORT_ENABLED', 'true')
    vi.stubEnv('CLASSROOM_ARCHIVE_EXPORT_TEACHER_IDS', TEACHER_ID)
    const mock = createSupabaseMock({
      archives: {
        data: [{
          id: '00000000-0000-4000-8000-000000000003',
          operation_id: '00000000-0000-4000-8000-000000000004',
          classroom_id: CLASSROOM_ID,
          source_revision: 7,
          created_at: '2026-08-19T12:00:00.000Z',
          verified_at: '2026-08-19T12:01:00.000Z',
          compressed_byte_size: 2_489_962,
          retention: { mode: 'teacher_managed', delete_after: null },
        }],
        error: null,
      },
      operations: {
        data: [{
          id: '00000000-0000-4000-8000-000000000004',
          classroom_id: CLASSROOM_ID,
          source_revision: 7,
          status: 'completed',
          retryable: null,
          retention: { mode: 'teacher_managed', delete_after: null },
          updated_at: '2026-08-19T12:01:00.000Z',
        }],
        error: null,
      },
    })

    await expect(listTeacherHotArchiveRecovery({
      supabase: mock.client,
      teacherId: TEACHER_ID,
      classroomIds: [CLASSROOM_ID, CLASSROOM_ID],
    })).resolves.toEqual({
      ok: true,
      summaries: [{
        classroom_id: CLASSROOM_ID,
        current_revision: 7,
        export_available: true,
        latest_archive: {
          archive_id: '00000000-0000-4000-8000-000000000003',
          operation_id: '00000000-0000-4000-8000-000000000004',
          source_revision: 7,
          created_at: '2026-08-19T12:00:00.000Z',
          verified_at: '2026-08-19T12:01:00.000Z',
          compressed_byte_size: 2_489_962,
          retention: { mode: 'teacher_managed', delete_after: null },
        },
        latest_operation: {
          operation_id: '00000000-0000-4000-8000-000000000004',
          source_revision: 7,
          status: 'completed',
          retryable: null,
          retention: { mode: 'teacher_managed', delete_after: null },
          updated_at: '2026-08-19T12:01:00.000Z',
        },
      }],
    })
    expect(mock.archives.teacher).toHaveBeenCalledWith('teacher_id', TEACHER_ID)
    expect(mock.archives.inFilter).toHaveBeenCalledWith('classroom_id', [CLASSROOM_ID])
    expect(mock.operations.operationType).toHaveBeenCalledWith('operation_type', 'export')
  })

  it.each(['PGRST205', '42P01'])('keeps archived classrooms visible when archive status tables return %s', async (code) => {
    const mock = createSupabaseMock({
      archives: { data: null, error: { code } },
      operations: { data: null, error: { code } },
    })

    await expect(listTeacherHotArchiveRecovery({
      supabase: mock.client,
      teacherId: TEACHER_ID,
      classroomIds: [CLASSROOM_ID],
    })).resolves.toEqual({
      ok: true,
      summaries: [{
        classroom_id: CLASSROOM_ID,
        current_revision: null,
        export_available: false,
        latest_archive: null,
        latest_operation: null,
      }],
    })
  })

  it('fails closed when stored recovery evidence violates its contract', async () => {
    const mock = createSupabaseMock({
      archives: {
        data: [{
          id: 'not-a-uuid',
          operation_id: '00000000-0000-4000-8000-000000000004',
          classroom_id: CLASSROOM_ID,
          source_revision: 7,
          created_at: '2026-08-19T12:00:00.000Z',
          verified_at: '2026-08-19T12:01:00.000Z',
          compressed_byte_size: 10,
          retention: { mode: 'teacher_managed', delete_after: null },
        }],
        error: null,
      },
      operations: { data: [], error: null },
    })

    await expect(listTeacherHotArchiveRecovery({
      supabase: mock.client,
      teacherId: TEACHER_ID,
      classroomIds: [CLASSROOM_ID],
    })).resolves.toEqual({
      ok: false,
      error_code: 'hot_archive_recovery_contract_invalid',
      summaries: [{
        classroom_id: CLASSROOM_ID,
        current_revision: null,
        export_available: false,
        latest_archive: null,
        latest_operation: null,
      }],
    })
  })

  it('fails closed when a completed operation has no verified archive record', async () => {
    const mock = createSupabaseMock({
      archives: { data: [], error: null },
      operations: {
        data: [{
          id: '00000000-0000-4000-8000-000000000004',
          classroom_id: CLASSROOM_ID,
          source_revision: 7,
          status: 'completed',
          retryable: null,
          retention: { mode: 'teacher_managed', delete_after: null },
          updated_at: '2026-08-19T12:01:00.000Z',
        }],
        error: null,
      },
    })

    await expect(listTeacherHotArchiveRecovery({
      supabase: mock.client,
      teacherId: TEACHER_ID,
      classroomIds: [CLASSROOM_ID],
    })).resolves.toEqual({
      ok: false,
      error_code: 'hot_archive_recovery_contract_invalid',
      summaries: [{
        classroom_id: CLASSROOM_ID,
        current_revision: null,
        export_available: false,
        latest_archive: null,
        latest_operation: null,
      }],
    })
  })

  it('does not let a missing table hide an unrelated status query failure', async () => {
    const mock = createSupabaseMock({
      archives: { data: null, error: { code: 'PGRST205' } },
      operations: { data: null, error: { code: 'XX000' } },
    })

    await expect(listTeacherHotArchiveRecovery({
      supabase: mock.client,
      teacherId: TEACHER_ID,
      classroomIds: [CLASSROOM_ID],
    })).resolves.toEqual({
      ok: false,
      error_code: 'hot_archive_recovery_list_failed',
      summaries: [{
        classroom_id: CLASSROOM_ID,
        current_revision: null,
        export_available: false,
        latest_archive: null,
        latest_operation: null,
      }],
    })
  })

  it('marks an older verified copy stale while keeping the current revision exportable', async () => {
    vi.stubEnv('CLASSROOM_ARCHIVE_EXPORT_ENABLED', 'true')
    vi.stubEnv('CLASSROOM_ARCHIVE_EXPORT_TEACHER_IDS', TEACHER_ID)
    const mock = createSupabaseMock({
      archives: {
        data: [{
          id: '00000000-0000-4000-8000-000000000003',
          operation_id: '00000000-0000-4000-8000-000000000004',
          classroom_id: CLASSROOM_ID,
          source_revision: 6,
          created_at: '2026-08-19T12:00:00.000Z',
          verified_at: '2026-08-19T12:01:00.000Z',
          compressed_byte_size: 10,
          retention: { mode: 'teacher_managed', delete_after: null },
        }],
        error: null,
      },
      operations: { data: [], error: null },
    })

    await expect(listTeacherHotArchiveRecovery({
      supabase: mock.client,
      teacherId: TEACHER_ID,
      classroomIds: [CLASSROOM_ID],
    })).resolves.toEqual({
      ok: true,
      summaries: [expect.objectContaining({
        current_revision: 7,
        export_available: true,
        latest_archive: expect.objectContaining({ source_revision: 6 }),
      })],
    })
  })
})
