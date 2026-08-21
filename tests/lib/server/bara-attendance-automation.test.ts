import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaraAttendanceSyncError } from '@/lib/server/bara-attendance-sync'
import {
  BaraAttendanceAutomationError,
  syncBaraAttendanceSchedules,
} from '@/lib/server/bara-attendance-automation'

const targets = [
  {
    classroom_id: '10000000-0000-4000-8000-000000000001',
    teacher_id: '20000000-0000-4000-8000-000000000001',
  },
  {
    classroom_id: '10000000-0000-4000-8000-000000000002',
    teacher_id: '20000000-0000-4000-8000-000000000002',
  },
]

describe('Bara attendance schedule automation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('materializes a Toronto rolling horizon for each eligible classroom', async () => {
    const rpc = vi.fn(async () => ({ data: targets, error: null }))
    const sync = vi.fn(async () => ({
      roster: { outcome: 'applied', revision: 1 },
      schedule: { outcome: 'applied', revision: 1 },
    }))

    await expect(syncBaraAttendanceSchedules({
      supabase: { rpc },
      now: new Date('2026-11-01T04:30:00.000Z'),
      horizonDays: 90,
      integrationState: 'ready',
      concurrency: 2,
      sync,
    })).resolves.toEqual({
      status: 'ok',
      windowStart: '2026-11-01',
      windowEnd: '2027-01-30',
      eligible: 2,
      attempted: 2,
      synced: 2,
      failed: 0,
      truncated: false,
      failures: {
        identity_not_linked: 0,
        policy_missing: 0,
        source_changed: 0,
        unavailable: 0,
      },
    })
    expect(rpc).toHaveBeenCalledWith('list_attendance_sync_targets_v1', { p_limit: 51 })
    expect(sync).toHaveBeenCalledTimes(2)
    expect(sync).toHaveBeenCalledWith(expect.objectContaining({
      teacherId: targets[0].teacher_id,
      classroomId: targets[0].classroom_id,
      windowStart: '2026-11-01',
      windowEnd: '2027-01-30',
      integrationState: 'ready',
    }))
  })

  it('returns aggregate-only partial health without exposing classroom IDs', async () => {
    const rpc = vi.fn(async () => ({ data: targets, error: null }))
    const sync = vi.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new BaraAttendanceSyncError('identity_not_linked'))

    const summary = await syncBaraAttendanceSchedules({
      supabase: { rpc },
      integrationState: 'ready',
      sync,
    })

    expect(summary).toMatchObject({
      status: 'partial',
      attempted: 2,
      synced: 1,
      failed: 1,
      failures: { identity_not_linked: 1 },
    })
    expect(JSON.stringify(summary)).not.toContain(targets[1].classroom_id)
    expect(JSON.stringify(summary)).not.toContain(targets[1].teacher_id)
  })

  it('does not read integration tables while disabled and surfaces a missing migration', async () => {
    const rpc = vi.fn()
    await expect(syncBaraAttendanceSchedules({
      supabase: { rpc },
      integrationState: 'disabled',
    })).resolves.toMatchObject({ status: 'disabled', attempted: 0 })
    expect(rpc).not.toHaveBeenCalled()

    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } })
    await expect(syncBaraAttendanceSchedules({
      supabase: { rpc },
      integrationState: 'ready',
    })).rejects.toMatchObject<BaraAttendanceAutomationError>({
      code: 'migration_required',
    })
  })
})
