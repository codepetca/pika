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
    const rpc = vi.fn(async () => ({ data: [targets[0]], error: null }))
    const sync = vi.fn(async () => ({
      roster: { outcome: 'applied', revision: 1 },
      schedule: { outcome: 'applied', revision: 1 },
    }))

    await expect(syncBaraAttendanceSchedules({
      supabase: { rpc },
      now: new Date('2026-11-01T04:30:00.000Z'),
      horizonDays: 90,
      integrationState: 'ready',
      teacherId: targets[0].teacher_id,
      classroomId: targets[0].classroom_id,
      concurrency: 2,
      sync,
    })).resolves.toEqual({
      status: 'ok',
      windowStart: '2026-11-01',
      windowEnd: '2027-01-30',
      eligible: 1,
      attempted: 1,
      synced: 1,
      failed: 0,
      truncated: false,
      failures: {
        identity_not_linked: 0,
        policy_missing: 0,
        source_changed: 0,
        unavailable: 0,
      },
    })
    expect(rpc).toHaveBeenCalledWith('list_attendance_sync_targets_v2', {
      p_teacher_id: targets[0].teacher_id,
      p_classroom_id: targets[0].classroom_id,
      p_limit: 51,
    })
    expect(sync).toHaveBeenCalledTimes(1)
    expect(sync).toHaveBeenCalledWith(expect.objectContaining({
      teacherId: targets[0].teacher_id,
      classroomId: targets[0].classroom_id,
      windowStart: '2026-11-01',
      windowEnd: '2027-01-30',
      integrationState: 'ready',
    }))
  })

  it('returns aggregate-only partial health without exposing classroom IDs', async () => {
    const rpc = vi.fn(async () => ({ data: [targets[0]], error: null }))
    const sync = vi.fn()
      .mockRejectedValueOnce(new BaraAttendanceSyncError('identity_not_linked'))

    const summary = await syncBaraAttendanceSchedules({
      supabase: { rpc },
      integrationState: 'ready',
      teacherId: targets[0].teacher_id,
      classroomId: targets[0].classroom_id,
      sync,
    })

    expect(summary).toMatchObject({
      status: 'partial',
      attempted: 1,
      synced: 0,
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
      teacherId: targets[0].teacher_id,
      classroomId: targets[0].classroom_id,
    })).rejects.toMatchObject<BaraAttendanceAutomationError>({
      code: 'migration_required',
    })
  })

  it('loads bounded entitlement targets without a canary pair and prioritizes cleanup mode', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        ...targets[0],
        integration_mode: 'deactivating',
        schedule_through: null,
      }, {
        ...targets[1],
        integration_mode: 'active',
        schedule_through: '2026-11-30',
      }],
      error: null,
    })
    const sync = vi.fn().mockResolvedValue({
      roster: { outcome: 'not_required', revision: 0 },
      schedule: { outcome: 'applied', revision: 2 },
    })
    const now = new Date('2026-08-23T12:00:00.000Z')

    await expect(syncBaraAttendanceSchedules({
      supabase: { rpc },
      now,
      integrationState: 'ready',
      scopeMode: 'teacher_entitlements',
      sync,
    })).resolves.toMatchObject({ status: 'ok', eligible: 2, synced: 2 })
    expect(rpc).toHaveBeenCalledWith('list_attendance_sync_targets_v3', {
      p_at: now.toISOString(),
      p_limit: 51,
    })
    expect(sync).toHaveBeenNthCalledWith(1, expect.objectContaining({
      teacherId: targets[0].teacher_id,
      classroomId: targets[0].classroom_id,
      scheduleThrough: null,
      scopeMode: 'teacher_entitlements',
    }))
    expect(sync).toHaveBeenNthCalledWith(2, expect.objectContaining({
      scheduleThrough: '2026-11-30',
    }))
  })
})
