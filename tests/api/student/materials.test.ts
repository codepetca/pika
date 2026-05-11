import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/student/classrooms/[id]/materials/route'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'student-1' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(async () => ({ ok: true })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/student/classrooms/[id]/materials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns only published materials for enrolled students in classwork order', async () => {
    const materials = [{ id: 'mat-1', title: 'Reference', is_draft: false, position: 1 }]
    const order = vi
      .fn()
      .mockImplementationOnce(() => ({ order }))
      .mockResolvedValue({ data: materials, error: null })
    const eqDraft = vi.fn(() => ({ order }))
    const eqClassroom = vi.fn(() => ({ eq: eqDraft }))
    const select = vi.fn(() => ({ eq: eqClassroom }))
    ;(mockSupabaseClient.from as any) = vi.fn(() => ({ select }))

    const request = new NextRequest('http://localhost:3000/api/student/classrooms/c-1/materials')
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })

    expect(response.status).toBe(200)
    expect(mockSupabaseClient.from).toHaveBeenCalledWith('classwork_materials')
    expect(eqClassroom).toHaveBeenCalledWith('classroom_id', 'c-1')
    expect(eqDraft).toHaveBeenCalledWith('is_draft', false)
    expect(order).toHaveBeenNthCalledWith(1, 'position', { ascending: true })
    expect(order).toHaveBeenNthCalledWith(2, 'released_at', { ascending: true })
    await expect(response.json()).resolves.toEqual({ materials })
  })

  it('returns an empty list before the materials migration is applied', async () => {
    const order = vi
      .fn()
      .mockImplementationOnce(() => ({ order }))
      .mockResolvedValue({
        data: null,
        error: { code: 'PGRST205', message: "Could not find the table 'public.classwork_materials'" },
      })
    const eqDraft = vi.fn(() => ({ order }))
    const eqClassroom = vi.fn(() => ({ eq: eqDraft }))
    const select = vi.fn(() => ({ eq: eqClassroom }))
    ;(mockSupabaseClient.from as any) = vi.fn(() => ({ select }))

    const request = new NextRequest('http://localhost:3000/api/student/classrooms/c-1/materials')
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ materials: [] })
  })

  it('returns access errors before querying materials', async () => {
    const { assertStudentCanAccessClassroom } = await import('@/lib/server/classrooms')
    ;(assertStudentCanAccessClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Not enrolled in this classroom',
    })

    const request = new NextRequest('http://localhost:3000/api/student/classrooms/c-1/materials')
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })

    expect(response.status).toBe(403)
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({ error: 'Not enrolled in this classroom' })
  })
})
