import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockMintPalReadToken, mockRequireRole } = vi.hoisted(() => ({
  mockMintPalReadToken: vi.fn(),
  mockRequireRole: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireRole: mockRequireRole }))
vi.mock('@/lib/server/pal-read-token', () => ({
  mintPalReadToken: mockMintPalReadToken,
}))

import { POST } from '@/app/api/student/pal/read-token/route'

describe('POST /api/student/pal/read-token', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PAL_ENABLED', 'true')
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-32-characters-long')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-32-characters-long')
    mockRequireRole.mockResolvedValue({ id: 'student-1', role: 'student' })
    mockMintPalReadToken.mockResolvedValue({
      token: 'short-lived-token',
      expires_at: '2026-09-16T18:25:00.000Z',
    })
  })

  it('returns a no-store learner-scoped read token', async () => {
    const response = await POST(new Request('http://localhost/api/student/pal/read-token', {
      method: 'POST',
    }) as any, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mockMintPalReadToken).toHaveBeenCalledWith({ studentId: 'student-1' })
  })

  it('does not expose the endpoint while the pilot is disabled', async () => {
    vi.stubEnv('PAL_ENABLED', 'false')
    const response = await POST(new Request('http://localhost/api/student/pal/read-token', {
      method: 'POST',
    }) as any, { params: Promise.resolve({}) })

    expect(response.status).toBe(404)
    expect(mockMintPalReadToken).not.toHaveBeenCalled()
  })

  it('fails closed before minting when enabled configuration is incomplete', async () => {
    vi.stubEnv('PAL_INTEGRATION_SECRET', '')
    const response = await POST(new Request('http://localhost/api/student/pal/read-token', {
      method: 'POST',
    }) as any, { params: Promise.resolve({}) })

    expect(response.status).toBe(500)
    expect(mockMintPalReadToken).not.toHaveBeenCalled()
  })
})
