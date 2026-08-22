import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  auditBaraAttendanceCanaryDatabaseScope,
  assertBaraAttendanceCanaryClassroom,
  assertBaraAttendanceCanaryClassroomOwner,
  BaraAttendanceCanaryError,
  getBaraAttendanceCanaryScope,
  getBaraAttendanceClassroomIntegrationState,
} from '@/lib/server/bara-attendance-canary'

const teacherId = '10000000-0000-4000-8000-000000000001'
const classroomId = '20000000-0000-4000-8000-000000000002'

describe('Bara attendance exact canary', () => {
  beforeEach(() => {
    vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED', 'true')
    vi.stubEnv('BARA_ATTENDANCE_API_BASE_URL', 'https://attendance-api.example')
    vi.stubEnv('BARA_ATTENDANCE_INSTALLATION_REF', 'pika_test')
    vi.stubEnv('BARA_ATTENDANCE_INTEGRATION_SECRET', 'integration-secret-with-at-least-32-characters')
    vi.stubEnv('PIKA_BARA_ATTENDANCE_CANARY_TEACHER_ID', teacherId)
    vi.stubEnv('PIKA_BARA_ATTENDANCE_CANARY_CLASSROOM_ID', classroomId)
  })

  afterEach(() => vi.unstubAllEnvs())

  it('opens only for the exact teacher and classroom pair', () => {
    expect(getBaraAttendanceCanaryScope()).toEqual({
      state: 'ready', teacherId, classroomId,
    })
    expect(getBaraAttendanceClassroomIntegrationState({ teacherId, classroomId })).toBe('ready')
    expect(getBaraAttendanceClassroomIntegrationState({
      teacherId: '30000000-0000-4000-8000-000000000003',
      classroomId,
    })).toBe('disabled')
    expect(getBaraAttendanceClassroomIntegrationState({
      teacherId,
      classroomId: '40000000-0000-4000-8000-000000000004',
    })).toBe('disabled')
  })

  it('fails closed for missing or malformed scope and while globally disabled', () => {
    vi.stubEnv('PIKA_BARA_ATTENDANCE_CANARY_CLASSROOM_ID', '')
    expect(getBaraAttendanceCanaryScope().state).toBe('not_configured')
    expect(() => assertBaraAttendanceCanaryClassroom({ teacherId, classroomId }))
      .toThrowError(new BaraAttendanceCanaryError('not_configured'))

    vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED', 'false')
    expect(getBaraAttendanceCanaryScope().state).toBe('disabled')
  })

  it('revalidates current classroom ownership for student token use', async () => {
    const owner = vi.fn().mockResolvedValue({
      data: { teacher_id: teacherId, archived_at: null }, error: null,
    })
    const query: any = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: owner,
    }
    const supabase = { from: vi.fn(() => query) }

    await expect(assertBaraAttendanceCanaryClassroomOwner({ supabase, classroomId }))
      .resolves.toBeUndefined()
    owner.mockResolvedValueOnce({
      data: {
        teacher_id: '30000000-0000-4000-8000-000000000003', archived_at: null,
      },
      error: null,
    })
    await expect(assertBaraAttendanceCanaryClassroomOwner({ supabase, classroomId }))
      .rejects.toEqual(new BaraAttendanceCanaryError('not_configured'))
  })

  it.each([
    ['wrong owner', {
      data: { teacher_id: '30000000-0000-4000-8000-000000000003', archived_at: null },
      error: null,
    }],
    ['missing classroom', { data: null, error: null }],
    ['archived classroom', {
      data: { teacher_id: teacherId, archived_at: '2026-08-21T12:00:00.000Z' },
      error: null,
    }],
  ])('fails database preflight for a %s', async (_label, result) => {
    const query: any = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn().mockResolvedValue(result),
    }
    const audit = await auditBaraAttendanceCanaryDatabaseScope({
      supabase: { from: vi.fn(() => query) },
      teacherId,
      classroomId,
    })
    expect(audit).toEqual({
      ready: false,
      failedChecks: ['attendance_canary_database_scope'],
    })
  })
})
