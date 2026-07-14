import { afterEach, describe, expect, it, vi } from 'vitest'
import { listTeacherColdClassroomArchives } from '@/lib/server/classroom-archive-recovery-list'

const TEACHER_ID = '00000000-0000-4000-8000-000000000001'
const CLASSROOM_ID = '00000000-0000-4000-8000-000000000002'
const ARCHIVE_ID = '00000000-0000-4000-8000-000000000003'

const coldArchive = {
  classroom_id: CLASSROOM_ID,
  archive_id: ARCHIVE_ID,
  title: 'Stored history classroom',
  archived_at: '2026-07-01T12:00:00.000Z',
  compacted_at: '2026-07-10T12:00:00.000Z',
}

function createSupabaseMock(result: { data: unknown; error: { code?: string } | null }) {
  const order = vi.fn().mockResolvedValue(result)
  const eq = vi.fn(() => ({ order }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { client: { from } as any, eq, from, order, select }
}

describe('teacher cold classroom archive list', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns only the teacher-scoped validated tombstones with restore availability', async () => {
    vi.stubEnv('CLASSROOM_ARCHIVE_RESTORE_ENABLED', 'true')
    vi.stubEnv('CLASSROOM_ARCHIVE_RESTORE_TEACHER_IDS', TEACHER_ID)
    vi.stubEnv('CLASSROOM_ARCHIVE_RESTORE_DATABASE_BUDGET_BYTES', '524288000')
    const mock = createSupabaseMock({ data: [coldArchive], error: null })

    const result = await listTeacherColdClassroomArchives({
      supabase: mock.client,
      teacherId: TEACHER_ID,
    })

    expect(result).toEqual({
      ok: true,
      cold_archives: [coldArchive],
      cold_archive_restore_enabled: true,
      migration_ready: true,
    })
    expect(mock.from).toHaveBeenCalledWith('classroom_cold_tombstones')
    expect(mock.select).toHaveBeenCalledWith(
      'classroom_id,archive_id,title,archived_at,compacted_at',
    )
    expect(mock.eq).toHaveBeenCalledWith('teacher_id', TEACHER_ID)
    expect(mock.order).toHaveBeenCalledWith('compacted_at', { ascending: false })
  })

  it('keeps valid cold archives visible while restore configuration is disabled', async () => {
    vi.stubEnv('CLASSROOM_ARCHIVE_RESTORE_ENABLED', 'false')
    const mock = createSupabaseMock({ data: [coldArchive], error: null })

    const result = await listTeacherColdClassroomArchives({
      supabase: mock.client,
      teacherId: TEACHER_ID,
    })

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      cold_archives: [coldArchive],
      cold_archive_restore_enabled: false,
    }))
  })

  it.each(['PGRST205', '42P01'])('returns the backward-compatible empty state for %s', async (code) => {
    const mock = createSupabaseMock({ data: null, error: { code } })

    const result = await listTeacherColdClassroomArchives({
      supabase: mock.client,
      teacherId: TEACHER_ID,
    })

    expect(result).toEqual({
      ok: true,
      cold_archives: [],
      cold_archive_restore_enabled: false,
      migration_ready: false,
    })
  })

  it('fails closed when the query fails unexpectedly', async () => {
    const mock = createSupabaseMock({ data: null, error: { code: 'XX000' } })

    await expect(listTeacherColdClassroomArchives({
      supabase: mock.client,
      teacherId: TEACHER_ID,
    })).resolves.toEqual({ ok: false, error_code: 'cold_archive_list_failed' })
  })

  it('fails closed when the database row violates the response contract', async () => {
    const mock = createSupabaseMock({
      data: [{ ...coldArchive, archive_id: 'not-a-uuid' }],
      error: null,
    })

    await expect(listTeacherColdClassroomArchives({
      supabase: mock.client,
      teacherId: TEACHER_ID,
    })).resolves.toEqual({ ok: false, error_code: 'cold_archive_list_contract_invalid' })
  })
})
