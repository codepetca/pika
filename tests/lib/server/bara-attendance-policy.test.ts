import { describe, expect, it, vi } from 'vitest'
import {
  loadTeacherAttendancePolicy,
  saveTeacherAttendancePolicy,
} from '@/lib/server/bara-attendance-policy'

const classroomId = '20000000-0000-4000-8000-000000000002'
const teacherId = '30000000-0000-4000-8000-000000000003'

function readClient(result: { data: unknown; error: any }) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { client: { from }, from, select, eq, maybeSingle }
}

describe('Bara attendance policy persistence', () => {
  it('loads and normalizes the private Toronto policy', async () => {
    const { client } = readClient({
      data: {
        classroom_id: classroomId,
        timezone: 'America/Toronto',
        opens_local: '08:45:00',
        closes_local: '10:15:00',
        close_day_offset: 0,
        enabled: true,
        policy_revision: 4,
        updated_at: '2026-08-16T20:00:00.000Z',
      },
      error: null,
    })

    await expect(loadTeacherAttendancePolicy({
      supabase: client,
      classroomId,
    })).resolves.toEqual({
      classroomId,
      timezone: 'America/Toronto',
      opensLocal: '08:45',
      closesLocal: '10:15',
      closeDayOffset: 0,
      enabled: true,
      revision: 4,
      updatedAt: '2026-08-16T20:00:00.000Z',
    })
  })

  it('returns null for an unconfigured classroom and fails closed when migration is absent', async () => {
    await expect(loadTeacherAttendancePolicy({
      supabase: readClient({ data: null, error: null }).client,
      classroomId,
    })).resolves.toBeNull()

    await expect(loadTeacherAttendancePolicy({
      supabase: readClient({ data: null, error: { code: '42P01' } }).client,
      classroomId,
    })).rejects.toMatchObject({ code: 'migration_required' })
  })

  it('saves through the owner-bound optimistic-concurrency RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        classroom_id: classroomId,
        timezone: 'America/Toronto',
        opens_local: '08:45',
        closes_local: '10:15',
        close_day_offset: 0,
        enabled: true,
        revision: 5,
        updated_at: '2026-08-16T20:01:00.000Z',
      },
      error: null,
    })

    await expect(saveTeacherAttendancePolicy({
      supabase: { rpc },
      teacherId,
      classroomId,
      opensLocal: '08:45',
      closesLocal: '10:15',
      closeDayOffset: 0,
      enabled: true,
      expectedRevision: 4,
    })).resolves.toMatchObject({ revision: 5, opensLocal: '08:45' })

    expect(rpc).toHaveBeenCalledWith('upsert_attendance_window_policy_v1', {
      p_teacher_id: teacherId,
      p_classroom_id: classroomId,
      p_opens_local: '08:45',
      p_closes_local: '10:15',
      p_close_day_offset: 0,
      p_enabled: true,
      p_expected_revision: 4,
    })
  })

  it('classifies revision conflicts without exposing database detail', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '40001', message: 'attendance_policy_revision_conflict' },
    })
    await expect(saveTeacherAttendancePolicy({
      supabase: { rpc },
      teacherId,
      classroomId,
      opensLocal: '20:00',
      closesLocal: '01:00',
      closeDayOffset: 1,
      enabled: true,
      expectedRevision: 4,
    })).rejects.toMatchObject({ code: 'conflict' })
  })
})
