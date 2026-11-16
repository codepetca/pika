import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-error'

const { mockStart, mockSavePending, mockRpc } = vi.hoisted(() => ({
  mockStart: vi.fn(),
  mockSavePending: vi.fn(),
  mockRpc: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: () => ({ rpc: mockRpc }),
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
    vi.stubEnv('WORKOS_MAGIC_AUTH_PILOT', 'true')
    vi.stubEnv('SESSION_SECRET', 'local-test-session-secret-for-rate-limits')
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null })
    mockStart.mockResolvedValue({
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      radarAuthAttemptId: 'radar_attempt_1',
      code: 'should-never-leak',
    })
  })

  it('is unavailable while the pilot flag is off', async () => {
    vi.stubEnv('WORKOS_MAGIC_AUTH_PILOT', 'false')
    const response = await POST(request({ email: 'student@example.com' }))

    expect(response.status).toBe(404)
    expect(mockRpc).not.toHaveBeenCalled()
    expect(mockStart).not.toHaveBeenCalled()
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
    expect(mockRpc).not.toHaveBeenCalled()
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('shares the normalized recipient limit across signup and sign-in and blocks the sixth delivery', async () => {
    const recipientAttempts = new Map<string, number>()
    mockRpc.mockImplementation(async (name, args) => {
      if (args.p_scope !== 'workos_code_identifier') return { data: { ok: true }, error: null }
      expect(name).toBe('consume_auth_rate_limit')
      expect(args.p_max_attempts).toBe(5)
      expect(args.p_window_seconds).toBe(3600)
      const count = recipientAttempts.get(args.p_key_hash) ?? 0
      if (count >= args.p_max_attempts) {
        return { data: { ok: false, retry_after_seconds: 300 }, error: null }
      }
      recipientAttempts.set(args.p_key_hash, count + 1)
      return { data: { ok: true }, error: null }
    })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await POST(request({ email: 'student@example.com', intent: 'sign-up' }))
      expect(response.status).toBe(200)
    }
    const excess = await POST(request({ email: ' Student@Example.com ', intent: 'sign-in' }))

    expect(excess.status).toBe(429)
    expect(recipientAttempts.size).toBe(1)
    expect(mockStart).toHaveBeenCalledTimes(5)
    expect(mockSavePending).toHaveBeenCalledTimes(5)
  })

  it('stops at an exhausted client budget before touching the recipient budget or provider', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: false, retry_after_seconds: 30 }, error: null })

    const response = await POST(request({ email: 'student@example.com' }))

    expect(response.status).toBe(429)
    expect(mockRpc).toHaveBeenCalledExactlyOnceWith('consume_auth_rate_limit', expect.objectContaining({
      p_scope: 'workos_code_client',
      p_max_attempts: 90,
      p_window_seconds: 3600,
    }))
    expect(mockStart).not.toHaveBeenCalled()
    expect(mockSavePending).not.toHaveBeenCalled()
  })

  it('prevents a provider call when the limiter is unavailable', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: '57014' } })

    const response = await POST(request({ email: 'student@example.com' }))

    expect(response.status).toBe(503)
    expect(mockStart).not.toHaveBeenCalled()
    expect(mockSavePending).not.toHaveBeenCalled()
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
