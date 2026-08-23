import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  assertBaraAttendanceClassroomAccess,
  getBaraAttendanceClassroomAccess,
  getBaraAttendanceScopeMode,
  getBaraAttendanceWorkerScope,
} from '@/lib/server/bara-attendance-scope'
import { BaraAttendanceCanaryError } from '@/lib/server/bara-attendance-canary'

const teacherId = '10000000-0000-4000-8000-000000000001'
const classroomId = '20000000-0000-4000-8000-000000000002'

function enableTransport() {
  vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED', 'true')
  vi.stubEnv('BARA_ATTENDANCE_API_BASE_URL', 'https://attendance-api.example')
  vi.stubEnv('BARA_ATTENDANCE_INSTALLATION_REF', 'pika_test_installation')
  vi.stubEnv('BARA_ATTENDANCE_INTEGRATION_SECRET', 'integration-secret-with-at-least-32-characters')
}

describe('Bara attendance runtime scope', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('defaults to the exact canary and does not expand without an explicit mode', async () => {
    enableTransport()
    vi.stubEnv('PIKA_BARA_ATTENDANCE_CANARY_TEACHER_ID', teacherId)
    vi.stubEnv('PIKA_BARA_ATTENDANCE_CANARY_CLASSROOM_ID', classroomId)

    expect(getBaraAttendanceScopeMode()).toBe('exact_canary')
    await expect(assertBaraAttendanceClassroomAccess({
      supabase: { rpc: vi.fn() },
      teacherId,
      classroomId,
    })).resolves.toMatchObject({ state: 'ready', scheduleThrough: null })
    await expect(assertBaraAttendanceClassroomAccess({
      supabase: { rpc: vi.fn() },
      teacherId,
      classroomId: '30000000-0000-4000-8000-000000000003',
    })).rejects.toEqual(new BaraAttendanceCanaryError('disabled'))
  })

  it('uses only the service-role entitlement predicate in expansion mode', async () => {
    enableTransport()
    vi.stubEnv('PIKA_BARA_ATTENDANCE_SCOPE_MODE', 'teacher_entitlements')
    const rpc = vi.fn().mockResolvedValue({
      data: { state: 'ready', schedule_through: '2026-09-30' },
      error: null,
    })

    await expect(getBaraAttendanceClassroomAccess({
      supabase: { rpc },
      teacherId,
      classroomId,
      now: new Date('2026-08-23T12:00:00.000Z'),
    })).resolves.toEqual({ state: 'ready', scheduleThrough: '2026-09-30' })
    expect(rpc).toHaveBeenCalledWith('get_attendance_classroom_access_v1', {
      p_teacher_id: teacherId,
      p_classroom_id: classroomId,
      p_at: '2026-08-23T12:00:00.000Z',
    })
    expect(getBaraAttendanceWorkerScope()).toEqual({
      mode: 'teacher_entitlements',
      state: 'ready',
      teacherId: null,
      classroomId: null,
    })
  })

  it('fails closed when the entitlement migration is unavailable', async () => {
    enableTransport()
    vi.stubEnv('PIKA_BARA_ATTENDANCE_SCOPE_MODE', 'teacher_entitlements')
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202' } })

    await expect(getBaraAttendanceClassroomAccess({
      supabase: { rpc }, teacherId, classroomId,
    })).resolves.toEqual({ state: 'not_configured', scheduleThrough: null })
  })
})
