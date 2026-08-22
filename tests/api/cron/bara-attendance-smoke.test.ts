import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { runBaraAttendanceSmoke } = vi.hoisted(() => ({
  runBaraAttendanceSmoke: vi.fn(),
}))

vi.mock('@/lib/server/bara-attendance-smoke', () => ({ runBaraAttendanceSmoke }))

import { POST } from '@/app/api/cron/bara-attendance-smoke/route'

describe('POST /api/cron/bara-attendance-smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv(
      'BARA_ATTENDANCE_SMOKE_OPERATOR_SECRET',
      'dedicated-smoke-operator-secret-at-least-32-characters',
    )
    vi.stubEnv('CRON_SECRET', 'shared-cron-secret-that-must-not-authorize-smoke')
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
      },
    }) as never)

    expect(response.status).toBe(200)
    expect(runBaraAttendanceSmoke).toHaveBeenCalledOnce()
  })
})
