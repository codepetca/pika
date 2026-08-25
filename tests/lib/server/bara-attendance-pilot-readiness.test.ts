import { describe, expect, it, vi } from 'vitest'

import {
  readBaraAttendancePilotReadiness,
  summarizeBaraAttendancePilotReadiness,
} from '@/lib/server/bara-attendance-pilot-readiness'

const at = new Date('2026-08-25T16:00:00.000Z')
const classroomOne = '10000000-0000-4000-8000-000000000001'
const classroomTwo = '20000000-0000-4000-8000-000000000002'

const entitlement = {
  status: 'active',
  valid_from: '2026-08-20T12:00:00.000Z',
  valid_until: null,
  revision: 1,
}
const syncedMapping = {
  classroom_id: classroomOne,
  integration_state: 'active',
  roster_ref: `roster_${'a'.repeat(32)}`,
  source_revision: 2,
  synced_revision: 2,
  schedule_source_revision: 3,
  schedule_synced_revision: 3,
}

describe('Bara attendance entitled-teacher pilot readiness', () => {
  it('is ready only with configured and unconfigured active classrooms', () => {
    expect(summarizeBaraAttendancePilotReadiness({
      entitlement,
      classrooms: [{ id: classroomOne }, { id: classroomTwo }],
      policies: [{ classroom_id: classroomOne, enabled: true }],
      mappings: [syncedMapping],
      at,
    })).toEqual({
      readyForScopedSaveVerification: true,
      entitlementRevision: 1,
      activeClassrooms: 2,
      configuredClassrooms: 1,
      enabledPolicies: 1,
      unconfiguredClassrooms: 1,
      rosterMappings: 1,
      activeMappings: 1,
      fullySyncedMappings: 1,
      blockers: [],
    })
  })

  it('reports the current one-class shape without leaking identifiers', () => {
    const result = summarizeBaraAttendancePilotReadiness({
      entitlement,
      classrooms: [{ id: classroomOne }],
      policies: [{ classroom_id: classroomOne, enabled: true }],
      mappings: [syncedMapping],
      at,
    })

    expect(result.blockers).toEqual([
      'requires_at_least_two_active_classrooms',
      'requires_unconfigured_active_classroom',
    ])
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(classroomOne)
    expect(serialized).not.toContain(syncedMapping.roster_ref)
  })

  it('fails readiness for an expired grant or unsynced configured classroom', () => {
    const result = summarizeBaraAttendancePilotReadiness({
      entitlement: {
        ...entitlement,
        valid_until: '2026-08-25T15:59:59.000Z',
      },
      classrooms: [{ id: classroomOne }, { id: classroomTwo }],
      policies: [{ classroom_id: classroomOne, enabled: true }],
      mappings: [{ ...syncedMapping, schedule_synced_revision: 2 }],
      at,
    })

    expect(result.entitlementRevision).toBeNull()
    expect(result.blockers).toEqual([
      'teacher_entitlement_not_effective',
      'configured_classroom_not_fully_synced',
    ])
  })

  it('reads only the target teacher and scopes policy and mapping reads to active classes', async () => {
    const entitlementMaybeSingle = vi.fn().mockResolvedValue({
      data: entitlement,
      error: null,
    })
    const entitlementEq = vi.fn(() => ({ maybeSingle: entitlementMaybeSingle }))
    const activeClassroomsIs = vi.fn().mockResolvedValue({
      data: [{ id: classroomOne }, { id: classroomTwo }],
      error: null,
    })
    const activeClassroomsEq = vi.fn(() => ({ is: activeClassroomsIs }))
    const policiesIn = vi.fn().mockResolvedValue({
      data: [{ classroom_id: classroomOne, enabled: true }],
      error: null,
    })
    const mappingsIn = vi.fn().mockResolvedValue({ data: [syncedMapping], error: null })
    const from = vi.fn((table: string) => {
      if (table === 'attendance_teacher_entitlements') {
        return { select: vi.fn(() => ({ eq: entitlementEq })) }
      }
      if (table === 'classrooms') {
        return { select: vi.fn(() => ({ eq: activeClassroomsEq })) }
      }
      if (table === 'attendance_window_policies') {
        return { select: vi.fn(() => ({ in: policiesIn })) }
      }
      if (table === 'attendance_roster_mappings') {
        return { select: vi.fn(() => ({ in: mappingsIn })) }
      }
      throw new Error(`Unexpected table ${table}`)
    })

    await expect(readBaraAttendancePilotReadiness({
      supabase: { from },
      teacherId: '30000000-0000-4000-8000-000000000003',
      at,
    })).resolves.toMatchObject({ readyForScopedSaveVerification: true })
    expect(entitlementEq).toHaveBeenCalledWith(
      'teacher_id', '30000000-0000-4000-8000-000000000003',
    )
    expect(activeClassroomsIs).toHaveBeenCalledWith('archived_at', null)
    expect(policiesIn).toHaveBeenCalledWith('classroom_id', [classroomOne, classroomTwo])
    expect(mappingsIn).toHaveBeenCalledWith('classroom_id', [classroomOne, classroomTwo])
  })
})
