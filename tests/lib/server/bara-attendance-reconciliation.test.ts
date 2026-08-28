import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: () => ({ rpc }),
}))

import {
  reconcileBaraAttendanceSession,
  reconcileBaraAttendanceSessions,
} from '@/lib/server/bara-attendance-reconciliation'

const snapshotResponse = {
  ok: true,
  schema_version: 1,
  occurrence_ref: 'occurrence_one',
  roster_ref: 'roster_one',
  session_revision: 3,
  status: 'closed',
  accepts_at: '2026-09-02T12:50:00.000Z',
  stops_accepting_at: '2026-09-02T13:20:00.000Z',
  check_ins: [{
    check_in_ref: 'check_in_one',
    participant_ref: 'participant_one',
    check_in_revision: 2,
    accepted_at: '2026-09-02T13:01:00.000Z',
    invalidated_at: '2026-09-02T13:25:00.000Z',
  }],
}

describe('Bara attendance reconciliation', () => {
  beforeEach(() => {
    vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED', 'true')
    vi.stubEnv('BARA_ATTENDANCE_API_BASE_URL', 'https://attendance-api.example')
    vi.stubEnv('BARA_ATTENDANCE_INSTALLATION_REF', 'pika_test_installation')
    vi.stubEnv(
      'BARA_ATTENDANCE_INTEGRATION_SECRET',
      'test-bara-attendance-integration-secret-with-32-characters',
    )
    rpc.mockReset()
  })

  afterEach(() => vi.unstubAllEnvs())

  it('applies the closed authoritative snapshot through the service-role RPC', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify(snapshotResponse), { status: 200 }),
    )
    rpc.mockResolvedValue({
      data: {
        applied: true,
        session_projection_applied: true,
        check_in_projection_count: 1,
      },
      error: null,
    })

    await expect(reconcileBaraAttendanceSession('occurrence_one', {
      fetcher: fetcher as typeof fetch,
      now: () => 1_786_917_600_000,
      nonce: () => 'nonce_reconcile_one_12345',
    })).resolves.toEqual({
      occurrenceRef: 'occurrence_one',
      sessionProjectionApplied: true,
      checkInProjectionCount: 1,
    })

    expect(rpc).toHaveBeenCalledWith('apply_attendance_session_snapshot_v1', {
      p_installation_ref: 'pika_test_installation',
      p_snapshot: {
        schema_version: 1,
        occurrence_ref: 'occurrence_one',
        roster_ref: 'roster_one',
        session_revision: 3,
        status: 'closed',
        accepts_at: '2026-09-02T12:50:00.000Z',
        stops_accepting_at: '2026-09-02T13:20:00.000Z',
        check_ins: snapshotResponse.check_ins,
      },
    })
  })

  it('rejects an invalid persistence acknowledgement', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify(snapshotResponse), { status: 200 }),
    )
    rpc.mockResolvedValue({ data: { applied: true, internal_id: 'not-allowed' }, error: null })

    await expect(reconcileBaraAttendanceSession('occurrence_one', {
      fetcher: fetcher as typeof fetch,
    })).rejects.toThrow('Attendance reconciliation returned an invalid result')
  })

  it('accepts authoritative cleanup snapshots after entitlement revocation', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify(snapshotResponse), { status: 200 }),
    )
    rpc.mockResolvedValue({
      data: {
        applied: true,
        session_projection_applied: true,
        check_in_projection_count: 1,
      },
      error: null,
    })

    await reconcileBaraAttendanceSession('occurrence_one', {
      fetcher: fetcher as typeof fetch,
      scopeMode: 'teacher_entitlements',
    })
    expect(rpc).toHaveBeenCalledWith(
      'apply_attendance_session_snapshot_for_entitled_mapping_v1',
      expect.objectContaining({ p_installation_ref: 'pika_test_installation' }),
    )
  })

  it('reconciles a bounded least-recent batch and returns aggregate-only health', async () => {
    const targets = [
      { occurrence_ref: 'occurrence_one' },
      { occurrence_ref: 'occurrence_two' },
      { occurrence_ref: 'occurrence_three' },
    ]
    const batchRpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe('list_attendance_reconciliation_targets_v2')
      expect(args).toEqual({
        p_teacher_id: '10000000-0000-4000-8000-000000000001',
        p_classroom_id: '20000000-0000-4000-8000-000000000002',
        p_now: '2026-09-02T14:00:00.000Z',
        p_lookback_hours: 48,
        p_limit: 3,
      })
      return { data: targets, error: null }
    })
    const reconcile = vi.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('remote detail'))

    const summary = await reconcileBaraAttendanceSessions({
      supabase: { rpc: batchRpc } as never,
      enabled: true,
      teacherId: '10000000-0000-4000-8000-000000000001',
      classroomId: '20000000-0000-4000-8000-000000000002',
      now: new Date('2026-09-02T14:00:00.000Z'),
      targetLimit: 2,
      concurrency: 2,
      reconcile,
    })

    expect(summary).toEqual({
      status: 'partial',
      eligible: 3,
      attempted: 2,
      reconciled: 1,
      failed: 1,
      truncated: true,
    })
    expect(reconcile).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(summary)).not.toContain('occurrence_')
    expect(JSON.stringify(summary)).not.toContain('remote detail')
  })

  it('does not read reconciliation state while disabled', async () => {
    const batchRpc = vi.fn()
    await expect(reconcileBaraAttendanceSessions({
      supabase: { rpc: batchRpc } as never,
      enabled: false,
    })).resolves.toEqual({
      status: 'disabled',
      eligible: 0,
      attempted: 0,
      reconciled: 0,
      failed: 0,
      truncated: false,
    })
    expect(batchRpc).not.toHaveBeenCalled()
  })

  it('loads bounded cleanup targets without caller-provided classroom identifiers', async () => {
    const now = new Date('2026-09-02T14:00:00.000Z')
    const batchRpc = vi.fn().mockResolvedValue({ data: [], error: null })

    await expect(reconcileBaraAttendanceSessions({
      supabase: { rpc: batchRpc } as never,
      enabled: true,
      scopeMode: 'teacher_entitlements',
      now,
    })).resolves.toMatchObject({ status: 'ok', eligible: 0 })
    expect(batchRpc).toHaveBeenCalledWith('list_attendance_reconciliation_targets_v3', {
      p_now: now.toISOString(),
      p_lookback_hours: 48,
      p_limit: 51,
    })
  })
})
