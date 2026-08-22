import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { isDeployedBaraAttendanceEnvironmentReady, runBaraAttendanceSmoke } = vi.hoisted(() => ({
  isDeployedBaraAttendanceEnvironmentReady: vi.fn(),
  runBaraAttendanceSmoke: vi.fn(),
}))

vi.mock('@/lib/server/bara-attendance-smoke', () => ({ runBaraAttendanceSmoke }))
vi.mock('@/lib/server/bara-attendance-deployed-preflight', () => ({
  isDeployedBaraAttendanceEnvironmentReady,
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
    isDeployedBaraAttendanceEnvironmentReady.mockReturnValue(true)
    runBaraAttendanceSmoke.mockResolvedValue({
      status: 'passed',
      checks: { canaryScope: true, pikaToBara: true, baraToPika: true },
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects the shared cron credential', async () => {
    const response = await POST(new Request('https://pika.example/api/cron/bara-attendance-smoke', {
      method: 'POST',
      headers: { Authorization: 'Bearer shared-cron-secret-that-must-not-authorize-smoke' },
    }) as never)

    expect(response.status).toBe(401)
    expect(runBaraAttendanceSmoke).not.toHaveBeenCalled()
  })

  it('accepts only the dedicated smoke operator credential', async () => {
    const response = await POST(new Request('https://pika.example/api/cron/bara-attendance-smoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer dedicated-smoke-operator-secret-at-least-32-characters',
        'X-Attendance-Rollout-Mode': 'pre-enable',
      },
    }) as never)

    expect(response.status).toBe(200)
    expect(isDeployedBaraAttendanceEnvironmentReady).toHaveBeenCalledWith('pre-enable')
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
    expect(isDeployedBaraAttendanceEnvironmentReady).not.toHaveBeenCalled()
    expect(runBaraAttendanceSmoke).not.toHaveBeenCalled()
  })

  it('fails closed before smoke state when the deployed environment audit fails', async () => {
    isDeployedBaraAttendanceEnvironmentReady.mockReturnValue(false)

    const response = await POST(new Request('https://pika.example/api/cron/bara-attendance-smoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer dedicated-smoke-operator-secret-at-least-32-characters',
        'X-Attendance-Rollout-Mode': 'enabled',
      },
    }) as never)

    expect(response.status).toBe(503)
    expect(isDeployedBaraAttendanceEnvironmentReady).toHaveBeenCalledWith('enabled')
    expect(runBaraAttendanceSmoke).not.toHaveBeenCalled()
  })

  it.each([
    'CRON_SECRET',
    'BARA_ATTENDANCE_INTEGRATION_SECRET',
    'BARA_ATTENDANCE_EVENT_SECRET',
  ])('fails closed when the operator secret overlaps %s', async (environmentName) => {
    vi.stubEnv(environmentName, 'dedicated-smoke-operator-secret-at-least-32-characters')

    const response = await POST(new Request('https://pika.example/api/cron/bara-attendance-smoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer dedicated-smoke-operator-secret-at-least-32-characters',
        'X-Attendance-Rollout-Mode': 'pre-enable',
      },
    }) as never)

    expect(response.status).toBe(503)
    expect(runBaraAttendanceSmoke).not.toHaveBeenCalled()
  })
})
