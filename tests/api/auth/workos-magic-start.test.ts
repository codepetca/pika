import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-error'

const { mockStart, mockSavePending } = vi.hoisted(() => ({
  mockStart: vi.fn(),
  mockSavePending: vi.fn(),
}))

vi.mock('@/lib/server/workos-magic-auth', () => ({
  startWorkOSMagicAuth: mockStart,
}))
vi.mock('@/lib/server/workos-magic-pending', () => ({
  savePendingWorkOSMagicAuth: mockSavePending,
}))

import { POST } from '@/app/api/auth/workos/magic/start/route'

function request(body: unknown) {
  return new NextRequest('http://localhost:3000/api/auth/workos/magic/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'test-browser' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/workos/magic/start', () => {
  afterEach(() => vi.unstubAllEnvs())

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_LEGACY_PASSWORD_AUTH', 'false')
    mockStart.mockResolvedValue({
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      radarAuthAttemptId: 'radar_attempt_1',
      code: 'should-never-leak',
    })
  })

  it('is unavailable while the explicit legacy password override is on', async () => {
    vi.stubEnv('PIKA_LEGACY_PASSWORD_AUTH', 'true')
    const response = await POST(request({ email: 'student@example.com' }))

    expect(response.status).toBe(404)
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('fails before requesting a code when the Pika session secret is incomplete', async () => {
    vi.stubEnv('SESSION_SECRET', 'short')

    const response = await POST(request({ email: 'student@example.com' }))

    expect(response.status).toBe(503)
    expect(mockStart).not.toHaveBeenCalled()
    expect(mockSavePending).not.toHaveBeenCalled()
  })

  it('normalizes email, stores only pending server state, and never returns the code', async () => {
    const req = request({
      email: ' Student@Example.com ',
      intent: 'sign-up',
      next: '/attendance/check-in/token-123',
    })
    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mockStart).toHaveBeenCalledWith('student@example.com', req)
    expect(mockSavePending).toHaveBeenCalledWith(expect.objectContaining({
      email: 'student@example.com',
      intent: 'sign-up',
      nextPath: '/attendance/check-in/token-123',
      radarAuthAttemptId: 'radar_attempt_1',
    }))
    expect(JSON.stringify(data)).not.toContain('should-never-leak')
    expect(JSON.stringify(data)).not.toContain('radar_attempt_1')
  })

  it('rejects unsafe return paths', async () => {
    const response = await POST(request({
      email: 'student@example.com',
      next: '//evil.example',
    }))

    expect(response.status).toBe(400)
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('does not save pending state when provider or email delivery fails', async () => {
    mockStart.mockRejectedValueOnce(
      new ApiError(503, 'Authentication is temporarily unavailable'),
    )

    const response = await POST(request({ email: 'student@example.com' }))
    const data = await response.json()

    expect(response.status).toBe(503)
    expect(data.error).toBe('Authentication is temporarily unavailable')
    expect(mockSavePending).not.toHaveBeenCalled()
  })
})
