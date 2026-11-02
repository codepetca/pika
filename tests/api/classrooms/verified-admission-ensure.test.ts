import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { requireAuth, ensureVerifiedClassroomAdmission } = vi.hoisted(() => ({
  requireAuth: vi.fn(), ensureVerifiedClassroomAdmission: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAuth }))
vi.mock('@/lib/server/verified-classroom-auto-admission', () => ({ ensureVerifiedClassroomAdmission }))
import { POST } from '@/app/api/classrooms/admission/ensure/route'

const request = (origin: string, body = '{}') => new NextRequest('https://pika.example/api/classrooms/admission/ensure', {
  method: 'POST', headers: { origin, 'content-type': 'application/json' }, body,
})

describe('explicit verified classroom admission retry', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('uses only the server-authenticated actor even if the body supplies another ID', async () => {
    requireAuth.mockResolvedValue({ id: 'server-actor' })
    ensureVerifiedClassroomAdmission.mockResolvedValue({ version: 1, outcome: 'already_admitted', registry_revision: 4 })
    const response = await POST(request('https://pika.example', '{"actorId":"attacker-selected"}'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ outcome: 'already_admitted' })
    expect(ensureVerifiedClassroomAdmission).toHaveBeenCalledWith('server-actor')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('rejects a cross-origin request before authentication or admission', async () => {
    const response = await POST(request('https://attacker.example'))
    expect(response.status).toBe(403)
    expect(requireAuth).not.toHaveBeenCalled()
    expect(ensureVerifiedClassroomAdmission).not.toHaveBeenCalled()
  })

  it('requires an authenticated session before attempting admission', async () => {
    const error = new Error('not signed in')
    error.name = 'AuthenticationError'
    requireAuth.mockRejectedValue(error)
    const response = await POST(request('https://pika.example'))
    expect(response.status).toBe(401)
    expect(ensureVerifiedClassroomAdmission).not.toHaveBeenCalled()
  })

  it('returns a bounded unavailable response rather than leaking registry errors', async () => {
    requireAuth.mockResolvedValue({ id: 'server-actor' })
    ensureVerifiedClassroomAdmission.mockRejectedValue(new Error('private detail'))
    const response = await POST(request('https://pika.example'))
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('private detail')
  })
})
