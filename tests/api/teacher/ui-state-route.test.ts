import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PATCH } from '@/app/api/teacher/ui-state/route'

const maybeSingle = vi.fn()
const upsert = vi.fn(() => ({ error: null }))
const eq2 = vi.fn(() => ({ maybeSingle }))
const eq1 = vi.fn(() => ({ eq: eq2 }))
const select = vi.fn(() => ({ eq: eq1 }))
const from = vi.fn(() => ({ select, upsert }))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => ({ from })),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({ id: 'teacher-1', role: 'teacher' })),
}))

describe('GET /api/teacher/ui-state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsert.mockReturnValue({ error: null })
  })

  it('returns the stored value for the authenticated teacher and key', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { value: { dismissed: true }, updated_at: '2026-01-01' }, error: null })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/ui-state?key=onboarding:classroom:c1'),
      { params: Promise.resolve({}) },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ value: { dismissed: true } })
    expect(from).toHaveBeenCalledWith('teacher_ui_state')
    expect(eq1).toHaveBeenCalledWith('teacher_id', 'teacher-1')
    expect(eq2).toHaveBeenCalledWith('key', 'onboarding:classroom:c1')
  })

  it('returns value: null when nothing has been stored yet', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/ui-state?key=onboarding:classroom:c1'),
      { params: Promise.resolve({}) },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ value: null })
  })

  it('rejects a missing key', async () => {
    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/ui-state'),
      { params: Promise.resolve({}) },
    )

    expect(response.status).toBe(400)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request', async () => {
    const { requireRole } = await import('@/lib/auth')
    vi.mocked(requireRole).mockRejectedValueOnce(Object.assign(new Error('Not authenticated'), { name: 'AuthenticationError' }))

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/ui-state?key=onboarding:classroom:c1'),
      { params: Promise.resolve({}) },
    )

    expect(response.status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/teacher/ui-state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsert.mockReturnValue({ error: null })
  })

  it('upserts the value scoped to the authenticated teacher', async () => {
    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/ui-state', {
        method: 'PATCH',
        body: JSON.stringify({ key: 'onboarding:classroom:c1', value: { dismissed: true } }),
      }),
      { params: Promise.resolve({}) },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ teacher_id: 'teacher-1', key: 'onboarding:classroom:c1', value: { dismissed: true } }),
      { onConflict: 'teacher_id,key' },
    )
  })

  it('rejects an oversized value', async () => {
    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/ui-state', {
        method: 'PATCH',
        body: JSON.stringify({ key: 'onboarding:classroom:c1', value: { blob: 'x'.repeat(5_000) } }),
      }),
      { params: Promise.resolve({}) },
    )

    expect(response.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('rejects a key with characters outside the allowed set', async () => {
    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/ui-state', {
        method: 'PATCH',
        body: JSON.stringify({ key: 'not a valid key!', value: {} }),
      }),
      { params: Promise.resolve({}) },
    )

    expect(response.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })
})
