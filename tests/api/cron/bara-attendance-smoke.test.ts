import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { auditDeployedBaraAttendanceEnvironment, runBaraAttendanceSmoke } = vi.hoisted(() => ({
  auditDeployedBaraAttendanceEnvironment: vi.fn(),
  runBaraAttendanceSmoke: vi.fn(),
}))

vi.mock('@/lib/server/bara-attendance-smoke', () => ({ runBaraAttendanceSmoke }))
vi.mock('@/lib/server/bara-attendance-deployed-preflight', () => ({
  auditDeployedBaraAttendanceEnvironment,
}))

import { POST } from '@/app/api/cron/bara-attendance-smoke/route'

describe('POST /api/cron/bara-attendance-smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv(
      'BARA_ATTENDANCE_SMOKE_OPERATOR_SECRET',
      'dedicated-smoke-operator-secret-at-least-32-characters',
    )
    vi.stubEnv('CRON_SECRET', 'shared-cron-secret-that-must-not-authorize-smoke')
    vi.stubEnv('BARA_ATTENDANCE_INTEGRATION_SECRET', 'pika-to-bara-secret-that-is-distinct-and-long')
    vi.stubEnv('BARA_ATTENDANCE_EVENT_SECRET', 'bara-to-pika-secret-that-is-distinct-and-long')
    auditDeployedBaraAttendanceEnvironment.mockReturnValue({
      ready: true,
      stage: 'production',
      attendanceMode: 'pre-enable',
      passedCount: 22,
      checkCount: 22,
      failedChecks: [],
    })
    runBaraAttendanceSmoke.mockResolvedValue({
      status: 'passed',
      checks: { canaryScope: true, pikaToBara: true, baraToPika: true },
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects the shared cron credential without authentication diagnostics', async () => {
    const response = await POST(new Request('https://pika.example/api/cron/bara-attendance-smoke', {
      method: 'POST',
      headers: { Authorization: 'Bearer shared-cron-secret-that-must-not-authorize-smoke' },
    }) as never)

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(auditDeployedBaraAttendanceEnvironment).not.toHaveBeenCalled()
    expect(runBaraAttendanceSmoke).not.toHaveBeenCalled()
  })

  it('accepts only the dedicated smoke operator credential', async () => {
    const response = await POST(new Request('https://pika.example/api/cron/bara-attendance-smoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer dedicated-smoke-operator-secret-at-least-32-characters',
        'X-Attendance-Rollout-Mode': 'pre-enable',
        'X-Attendance-Scope-Mode': 'exact_canary',
      },
    }) as never)

    expect(response.status).toBe(200)
    expect(auditDeployedBaraAttendanceEnvironment)
      .toHaveBeenCalledWith('pre-enable', 'exact_canary')
    expect(runBaraAttendanceSmoke).toHaveBeenCalledWith({ attendanceMode: 'pre-enable' })
  })

  it.each([null, '', 'preview', 'all'])('rejects invalid rollout mode %s', async (mode) => {
    const headers = new Headers({
      Authorization: 'Bearer dedicated-smoke-operator-secret-at-least-32-characters',
    })
    if (mode !== null) headers.set('X-Attendance-Rollout-Mode', mode)

    const response = await POST(new Request('https://pika.example/api/cron/bara-attendance-smoke', {
      method: 'POST',
      headers,
    }) as never)

    expect(response.status).toBe(400)
    expect(auditDeployedBaraAttendanceEnvironment).not.toHaveBeenCalled()
    expect(runBaraAttendanceSmoke).not.toHaveBeenCalled()
  })

  it.each([null, '', 'all'])('rejects invalid runtime scope mode %s', async (mode) => {
    const headers = new Headers({
      Authorization: 'Bearer dedicated-smoke-operator-secret-at-least-32-characters',
      'X-Attendance-Rollout-Mode': 'pre-enable',
    })
    if (mode !== null) headers.set('X-Attendance-Scope-Mode', mode)

    const response = await POST(new Request(
      'https://pika.example/api/cron/bara-attendance-smoke',
      { method: 'POST', headers },
    ) as never)
    expect(response.status).toBe(400)
    expect(auditDeployedBaraAttendanceEnvironment).not.toHaveBeenCalled()
    expect(runBaraAttendanceSmoke).not.toHaveBeenCalled()
  })

  it('fails closed before smoke state when the deployed environment audit fails', async () => {
    auditDeployedBaraAttendanceEnvironment.mockReturnValue({
      ready: false,
      stage: 'production',
      attendanceMode: 'enabled',
      passedCount: 20,
      checkCount: 22,
      failedChecks: ['attendance_enabled', 'distinct_integration_secrets'],
    })

    const response = await POST(new Request('https://pika.example/api/cron/bara-attendance-smoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer dedicated-smoke-operator-secret-at-least-32-characters',
        'X-Attendance-Rollout-Mode': 'enabled',
        'X-Attendance-Scope-Mode': 'teacher_entitlements',
      },
    }) as never)

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await response.json()).toEqual({
      error: 'Deployed attendance preflight failed',
      failedChecks: ['attendance_enabled', 'distinct_integration_secrets'],
      passedCount: 20,
      checkCount: 22,
    })
    expect(auditDeployedBaraAttendanceEnvironment)
      .toHaveBeenCalledWith('enabled', 'teacher_entitlements')
    expect(runBaraAttendanceSmoke).not.toHaveBeenCalled()
  })

  it.each([
    ['missing operator secret', 'BARA_ATTENDANCE_SMOKE_OPERATOR_SECRET', ''],
    ['short operator secret', 'BARA_ATTENDANCE_SMOKE_OPERATOR_SECRET', 'too-short'],
    [
      'operator secret overlapping CRON_SECRET',
      'CRON_SECRET',
      'dedicated-smoke-operator-secret-at-least-32-characters',
    ],
    [
      'operator secret overlapping BARA_ATTENDANCE_INTEGRATION_SECRET',
      'BARA_ATTENDANCE_INTEGRATION_SECRET',
      'dedicated-smoke-operator-secret-at-least-32-characters',
    ],
    [
      'operator secret overlapping BARA_ATTENDANCE_EVENT_SECRET',
      'BARA_ATTENDANCE_EVENT_SECRET',
      'dedicated-smoke-operator-secret-at-least-32-characters',
    ],
  ])('rejects %s without authentication diagnostics', async (_case, environmentName, value) => {
    vi.stubEnv(environmentName, value)

    const response = await POST(new Request('https://pika.example/api/cron/bara-attendance-smoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer wrong-or-unusable-operator-credential',
        'X-Attendance-Rollout-Mode': 'pre-enable',
        'X-Attendance-Scope-Mode': 'exact_canary',
      },
    }) as never)

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(auditDeployedBaraAttendanceEnvironment).not.toHaveBeenCalled()
    expect(runBaraAttendanceSmoke).not.toHaveBeenCalled()
  })
})
