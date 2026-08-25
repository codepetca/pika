import { describe, expect, it, vi } from 'vitest'

import {
  createAttendancePilotReadOnlyFetch,
  readBaraAttendancePilotReadiness,
  summarizeBaraAttendancePilotReadiness,
} from '@/lib/server/bara-attendance-pilot-readiness'

const teacherId = '30000000-0000-4000-8000-000000000003'
const at = new Date('2026-08-25T16:00:00.000Z')
const readyAggregate = {
  effective_entitlement_count: 1,
  active_classrooms: 2,
  configured_classrooms: 1,
  enabled_policies: 1,
  unconfigured_classrooms: 1,
  roster_mappings: 1,
  active_mappings: 1,
  fully_synced_configured_classrooms: 1,
}

describe('Bara attendance entitled-teacher pilot readiness', () => {
  it('is ready only with configured and unconfigured active classrooms', () => {
    expect(summarizeBaraAttendancePilotReadiness(readyAggregate)).toEqual({
      readyForScopedSaveVerification: true,
      effectiveEntitlements: 1,
      activeClassrooms: 2,
      configuredClassrooms: 1,
      enabledPolicies: 1,
      unconfiguredClassrooms: 1,
      rosterMappings: 1,
      activeMappings: 1,
      fullySyncedConfiguredClassrooms: 1,
      blockers: [],
    })
  })

  it('reports the current one-class shape without revisions or identifiers', () => {
    const result = summarizeBaraAttendancePilotReadiness({
      ...readyAggregate,
      active_classrooms: 1,
      unconfigured_classrooms: 0,
    })

    expect(result.blockers).toEqual([
      'requires_at_least_two_active_classrooms',
      'requires_unconfigured_active_classroom',
    ])
    expect(JSON.stringify(result)).not.toContain('revision')
    expect(JSON.stringify(result)).not.toContain(teacherId)
  })

  it('blocks when the configured classroom is not itself fully synced', () => {
    const result = summarizeBaraAttendancePilotReadiness({
      ...readyAggregate,
      roster_mappings: 2,
      active_mappings: 2,
      fully_synced_configured_classrooms: 0,
    })

    expect(result.readyForScopedSaveVerification).toBe(false)
    expect(result.blockers).toEqual(['configured_classroom_not_fully_synced'])
  })

  it('uses one aggregate RPC with the exact teacher and observation time', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: readyAggregate, error: null })

    await expect(readBaraAttendancePilotReadiness({
      supabase: { rpc },
      teacherId,
      at,
    })).resolves.toMatchObject({ readyForScopedSaveVerification: true })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('get_attendance_pilot_readiness_v1', {
      p_teacher_id: teacherId,
      p_at: '2026-08-25T16:00:00.000Z',
    })
  })

  it('allows only the exact aggregate read RPC for the exact teacher', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    const readOnlyFetch = createAttendancePilotReadOnlyFetch({
      expectedOrigin: 'https://abcdefghijklmnopqrst.supabase.co',
      teacherId,
      fetchImpl,
    })
    const validBody = JSON.stringify({
      p_teacher_id: teacherId,
      p_at: '2026-08-25T16:00:00.000Z',
    })

    await expect(readOnlyFetch(
      'https://abcdefghijklmnopqrst.supabase.co/rest/v1/rpc/get_attendance_pilot_readiness_v1',
      { method: 'POST', body: validBody },
    )).resolves.toBeInstanceOf(Response)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    for (const [url, method, body] of [
      ['https://abcdefghijklmnopqrst.supabase.co/rest/v1/classrooms', 'PATCH', '{}'],
      ['https://abcdefghijklmnopqrst.supabase.co/rest/v1/rpc/other_function', 'POST', '{}'],
      [
        'https://abcdefghijklmnopqrst.supabase.co/rest/v1/rpc/get_attendance_pilot_readiness_v1',
        'POST',
        JSON.stringify({
          p_teacher_id: '40000000-0000-4000-8000-000000000004',
          p_at: '2026-08-25T16:00:00.000Z',
        }),
      ],
    ] as const) {
      await expect(readOnlyFetch(url, { method, body })).rejects.toThrow(
        'Attendance pilot read transport rejected request',
      )
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
