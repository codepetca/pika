import { beforeEach, describe, expect, it, vi } from 'vitest'

const { deliverBaraAttendanceMessage } = vi.hoisted(() => ({
  deliverBaraAttendanceMessage: vi.fn(),
}))

vi.mock('@/lib/server/bara-attendance-outbox', () => ({
  deliverBaraAttendanceMessage,
}))

import {
  BaraAttendanceSyncError,
  syncTeacherAttendanceSources,
} from '@/lib/server/bara-attendance-sync'

const teacherId = '30000000-0000-4000-8000-000000000003'
const classroomId = '20000000-0000-4000-8000-000000000002'
const outboxOne = '40000000-0000-4000-8000-000000000004'
const outboxTwo = '50000000-0000-4000-8000-000000000005'

const prepared = {
  classroom_id: classroomId,
  roster_ref: 'roster_11111111111111111111111111111111',
  title: 'Evening Science',
  owner_principal_ref: 'principal_teacher',
  roster_source_token: 'a'.repeat(32),
  roster_revision: 2,
  schedule_source_token: 'b'.repeat(32),
  schedule_revision: 4,
  policy: {
    timezone: 'America/Toronto',
    session_starts_local: '23:40',
    session_ends_local: '00:25',
    session_end_day_offset: 1,
    entry_opens_minutes_before: 10,
    present_grace_minutes: 5,
    entry_closes_minutes_before_end: 10,
    absent_minutes_before_end: 0,
    enabled: true,
    policy_revision: 3,
  },
  participants: [
    {
      student_id: '10000000-0000-4000-8000-000000000001',
      participant_ref: 'participant_22222222222222222222222222222222',
      display_name: 'Alex Morgan',
      active: true,
      principal_ref: 'principal_student',
    },
    {
      student_id: '10000000-0000-4000-8000-000000000002',
      participant_ref: 'participant_33333333333333333333333333333333',
      display_name: 'Former Student',
      active: false,
      principal_ref: null,
    },
  ],
  class_days: [
    {
      date: '2026-11-02',
      is_class_day: true,
      occurrence_ref: 'occurrence_44444444444444444444444444444444',
    },
    { date: '2026-11-03', is_class_day: false, occurrence_ref: null },
  ],
}

function client(rpc: ReturnType<typeof vi.fn>, rows: unknown[] = []) {
  const lte = vi.fn().mockResolvedValue({ data: rows, error: null })
  const gte = vi.fn(() => ({ lte }))
  const eq = vi.fn(() => ({ gte }))
  const select = vi.fn(() => ({ eq }))
  return { rpc, from: vi.fn(() => ({ select })) }
}

describe('Pika attendance source snapshot sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.BARA_ATTENDANCE_INSTALLATION_REF = 'pika_staging'
    process.env.BARA_ATTENDANCE_TENANT_REF = 'tenant_staging'
  })

  it('prepares, stages, and delivers roster before the DST-safe schedule', async () => {
    const order: string[] = []
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      order.push(name)
      if (name === 'prepare_attendance_snapshot_v1') return { data: prepared, error: null }
      if (name === 'stage_attendance_roster_snapshot_v1') {
        const message = args.p_message as Record<string, unknown>
        expect(JSON.stringify(message)).not.toContain('10000000-0000-4000')
        expect(message).toMatchObject({
          message_type: 'roster.snapshot',
          revision: 2,
          display_name: 'Evening Science',
        })
        return {
          data: {
            outbox_id: outboxOne,
            idempotency_key: 'roster:roster_11111111111111111111111111111111:revision:2',
            revision: 2,
            status: 'pending',
          },
          error: null,
        }
      }
      if (name === 'stage_attendance_timing_schedule_v1') {
        expect(args.p_message).toMatchObject({
          message_type: 'schedule.snapshot',
          revision: 4,
          occurrences: [{
            occurrence_ref: 'occurrence_44444444444444444444444444444444',
            accepts_at: '2026-11-03T04:30:00.000Z',
            stops_accepting_at: '2026-11-03T05:15:00.000Z',
          }],
        })
        return {
          data: {
            outbox_id: outboxTwo,
            idempotency_key: 'schedule:roster_11111111111111111111111111111111:revision:4',
            revision: 4,
            status: 'pending',
          },
          error: null,
        }
      }
      throw new Error(`unexpected rpc ${name}`)
    })
    deliverBaraAttendanceMessage
      .mockImplementationOnce(async (input) => {
        order.push(`deliver:${input.message.message_type}`)
        return {
          outcome: 'applied',
          rosterRef: prepared.roster_ref,
          revision: 2,
          createdCount: 1,
          updatedCount: 0,
          deactivatedCount: 1,
        }
      })
      .mockImplementationOnce(async (input) => {
        order.push(`deliver:${input.message.message_type}`)
        return {
          outcome: 'applied',
          rosterRef: prepared.roster_ref,
          revision: 4,
          scheduledCount: 1,
          updatedCount: 0,
          cancelledCount: 0,
          preservedCount: 0,
        }
      })

    await expect(syncTeacherAttendanceSources({
      supabase: client(rpc),
      teacherId,
      classroomId,
      windowStart: '2026-11-02',
      windowEnd: '2026-11-03',
      integrationState: 'ready',
      verifiedActor: { workosSubject: 'user_teacher', displayName: 'Teacher One' },
    })).resolves.toEqual({
      roster: { outcome: 'applied', revision: 2 },
      schedule: { outcome: 'applied', revision: 4 },
    })
    expect(order).toEqual([
      'prepare_attendance_snapshot_v1',
      'stage_attendance_roster_snapshot_v1',
      'stage_attendance_timing_schedule_v1',
      'deliver:roster.snapshot',
      'deliver:schedule.snapshot',
    ])
  })

  it('rejects a provider-shaped subject in place of an opaque principal mapping', async () => {
    const rpc = vi.fn(async () => ({
      data: { ...prepared, owner_principal_ref: 'user_teacher' },
      error: null,
    }))

    await expect(syncTeacherAttendanceSources({
      supabase: client(rpc),
      teacherId,
      classroomId,
      windowStart: '2026-11-02',
      windowEnd: '2026-11-03',
      integrationState: 'ready',
      verifiedActor: { workosSubject: 'user_teacher', displayName: 'Teacher One' },
    })).rejects.toMatchObject<BaraAttendanceSyncError>({ code: 'invalid_source' })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(deliverBaraAttendanceMessage).not.toHaveBeenCalled()
  })

  it('builds the same durable roster payload for manual and automated retries', async () => {
    const rosterPayloads: unknown[] = []
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'prepare_attendance_snapshot_v1') return { data: prepared, error: null }
      if (name === 'stage_attendance_roster_snapshot_v1') {
        rosterPayloads.push(args.p_message)
        return {
          data: {
            outbox_id: outboxOne,
            idempotency_key: 'roster:roster_11111111111111111111111111111111:revision:2',
            revision: 2,
            status: 'pending',
          },
          error: null,
        }
      }
      if (name === 'stage_attendance_timing_schedule_v1') {
        return {
          data: {
            outbox_id: outboxTwo,
            idempotency_key: 'schedule:roster_11111111111111111111111111111111:revision:4',
            revision: 4,
            status: 'pending',
          },
          error: null,
        }
      }
      throw new Error(`unexpected rpc ${name}`)
    })
    deliverBaraAttendanceMessage.mockImplementation(async ({ message }) =>
      message.message_type === 'roster.snapshot'
        ? {
            outcome: 'duplicate',
            rosterRef: prepared.roster_ref,
            revision: 2,
            createdCount: 0,
            updatedCount: 0,
            deactivatedCount: 0,
          }
        : {
            outcome: 'duplicate',
            rosterRef: prepared.roster_ref,
            revision: 4,
            scheduledCount: 0,
            updatedCount: 0,
            cancelledCount: 0,
            preservedCount: 0,
          },
    )

    const common = {
      supabase: client(rpc),
      teacherId,
      classroomId,
      windowStart: '2026-11-02',
      windowEnd: '2026-11-03',
      integrationState: 'ready' as const,
    }
    await syncTeacherAttendanceSources({
      ...common,
      verifiedActor: { workosSubject: 'user_teacher', displayName: 'Teacher One' },
    })
    await syncTeacherAttendanceSources(common)

    expect(rosterPayloads).toHaveLength(2)
    expect(rosterPayloads[0]).toEqual(rosterPayloads[1])
    expect(rosterPayloads[0]).toMatchObject({ owner_display_name: 'Pika teacher' })
  })

  it('fails before mapping reads when the integration is disabled', async () => {
    const rpc = vi.fn()
    await expect(syncTeacherAttendanceSources({
      supabase: client(rpc),
      teacherId,
      classroomId,
      windowStart: '2026-11-02',
      windowEnd: '2026-11-03',
      integrationState: 'disabled',
    })).rejects.toMatchObject<BaraAttendanceSyncError>({ code: 'disabled' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('turns an optimistic source-token conflict into a stable retry signal', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'prepare_attendance_snapshot_v1') return { data: prepared, error: null }
      return {
        data: null,
        error: { code: '40001', message: 'database detail' },
      }
    })
    await expect(syncTeacherAttendanceSources({
      supabase: client(rpc),
      teacherId,
      classroomId,
      windowStart: '2026-11-02',
      windowEnd: '2026-11-03',
      integrationState: 'ready',
    })).rejects.toMatchObject<BaraAttendanceSyncError>({ code: 'source_changed' })
    expect(deliverBaraAttendanceMessage).not.toHaveBeenCalled()
  })

  it('stages only a higher-revision empty schedule while a revoked classroom deactivates', async () => {
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'prepare_attendance_snapshot_v2') {
        return {
          data: {
            integration_mode: 'deactivating',
            classroom_id: classroomId,
            roster_ref: prepared.roster_ref,
            title: prepared.title,
            schedule_source_token: 'c'.repeat(32),
            schedule_revision: 5,
            window_start: '2026-11-02',
            window_end: '2026-11-03',
            policy: {
              timezone: 'America/Toronto', opens_local: '00:00', closes_local: '00:01',
              close_day_offset: 0, enabled: false, policy_revision: 1,
            },
            class_days: [],
          },
          error: null,
        }
      }
      if (name === 'stage_attendance_schedule_snapshot_v2') {
        expect(args.p_message).toMatchObject({
          message_type: 'schedule.snapshot',
          revision: 5,
          window_start: '2026-11-02',
          window_end: '2026-11-03',
          occurrences: [],
        })
        return {
          data: {
            outbox_id: outboxTwo,
            idempotency_key: `schedule:${prepared.roster_ref}:revision:5`,
            revision: 5,
            status: 'pending',
          },
          error: null,
        }
      }
      throw new Error(`unexpected rpc ${name}`)
    })
    deliverBaraAttendanceMessage.mockResolvedValue({
      outcome: 'applied',
      rosterRef: prepared.roster_ref,
      revision: 5,
      scheduledCount: 0,
      updatedCount: 0,
      cancelledCount: 2,
      preservedCount: 1,
    })

    await expect(syncTeacherAttendanceSources({
      supabase: client(rpc),
      teacherId,
      classroomId,
      windowStart: '2026-11-02',
      windowEnd: '2026-11-03',
      integrationState: 'ready',
      scopeMode: 'teacher_entitlements',
    })).resolves.toEqual({
      roster: { outcome: 'not_required', revision: 0 },
      schedule: { outcome: 'applied', revision: 5 },
    })
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'prepare_attendance_snapshot_v2',
      'stage_attendance_schedule_snapshot_v2',
    ])
    expect(deliverBaraAttendanceMessage).toHaveBeenCalledWith(expect.objectContaining({
      teacherId,
      classroomId,
      scopeMode: 'teacher_entitlements',
      message: expect.objectContaining({ occurrences: [] }),
    }))
  })

  it('clamps an entitled schedule before its conservative expiry date', async () => {
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'prepare_attendance_snapshot_v2') {
        expect(args.p_window_end).toBe('2026-11-02')
        return { data: { ...prepared, integration_mode: 'active', class_days: [] }, error: null }
      }
      if (name === 'stage_attendance_roster_snapshot_v2') {
        return { data: {
          outbox_id: outboxOne,
          idempotency_key: `roster:${prepared.roster_ref}:revision:2`,
          revision: 2,
          status: 'pending',
        }, error: null }
      }
      if (name === 'stage_attendance_timing_schedule_v1') {
        expect(args.p_message).toMatchObject({ window_end: '2026-11-02', occurrences: [] })
        return { data: {
          outbox_id: outboxTwo,
          idempotency_key: `schedule:${prepared.roster_ref}:revision:4`,
          revision: 4,
          status: 'pending',
        }, error: null }
      }
      throw new Error(`unexpected rpc ${name}`)
    })
    deliverBaraAttendanceMessage
      .mockResolvedValueOnce({
        outcome: 'applied', rosterRef: prepared.roster_ref, revision: 2,
        createdCount: 0, updatedCount: 0, deactivatedCount: 0,
      })
      .mockResolvedValueOnce({
        outcome: 'applied', rosterRef: prepared.roster_ref, revision: 4,
        scheduledCount: 0, updatedCount: 0, cancelledCount: 0, preservedCount: 0,
      })

    await expect(syncTeacherAttendanceSources({
      supabase: client(rpc), teacherId, classroomId,
      windowStart: '2026-11-02', windowEnd: '2026-11-30',
      scheduleThrough: '2026-11-02',
      integrationState: 'ready', scopeMode: 'teacher_entitlements',
    })).resolves.toMatchObject({ schedule: { revision: 4 } })
  })
})
