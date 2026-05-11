import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/teacher/classrooms/[id]/materials/route'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom: vi.fn(async () => ({ ok: true })),
  assertTeacherCanMutateClassroom: vi.fn(async () => ({ ok: true })),
}))

const mockSupabaseClient = { from: vi.fn() }
const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Read this' }] }] }

describe('GET /api/teacher/classrooms/[id]/materials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns teacher materials in classwork order', async () => {
    const materials = [{ id: 'mat-1', title: 'Reference', content: doc, is_draft: false, position: 1 }]
    const order = vi
      .fn()
      .mockImplementationOnce(() => ({ order }))
      .mockResolvedValue({ data: materials, error: null })
    const eq = vi.fn(() => ({ order }))
    const select = vi.fn(() => ({ eq }))
    ;(mockSupabaseClient.from as any) = vi.fn(() => ({ select }))

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/materials')
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })

    expect(response.status).toBe(200)
    expect(mockSupabaseClient.from).toHaveBeenCalledWith('classwork_materials')
    expect(eq).toHaveBeenCalledWith('classroom_id', 'c-1')
    expect(order).toHaveBeenNthCalledWith(1, 'position', { ascending: true })
    expect(order).toHaveBeenNthCalledWith(2, 'created_at', { ascending: true })
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
    const eq = vi.fn(() => ({ order }))
    const select = vi.fn(() => ({ eq }))
    ;(mockSupabaseClient.from as any) = vi.fn(() => ({ select }))

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/materials')
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ materials: [] })
  })
})

describe('POST /api/teacher/classrooms/[id]/materials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a posted material without assignment docs or grades', async () => {
    const material = {
      id: 'mat-1',
      classroom_id: 'c-1',
      title: 'Reference',
      content: doc,
      is_draft: false,
      released_at: '2026-05-06T14:00:00.000Z',
      position: 4,
      created_by: 'teacher-1',
    }
    const insert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: material, error: null }),
      })),
    }))
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { position: 2 }, error: null }),
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'classwork_materials') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { position: 3 }, error: null }),
                })),
              })),
            })),
          })),
          insert,
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/materials', {
      method: 'POST',
      body: JSON.stringify({ title: ' Reference ', content: doc, is_draft: false }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })

    expect(response.status).toBe(201)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      classroom_id: 'c-1',
      title: 'Reference',
      content: doc,
      is_draft: false,
      released_at: expect.any(String),
      position: 4,
      created_by: 'teacher-1',
    }))
    await expect(response.json()).resolves.toEqual({ material })
  })

  it('fails material creation when mixed order lookup has an unexpected error', async () => {
    const insert = vi.fn()
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'database unavailable' } }),
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'classwork_materials') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { position: 3 }, error: null }),
                })),
              })),
            })),
          })),
          insert,
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/materials', {
      method: 'POST',
      body: JSON.stringify({ title: 'Reference', content: doc, is_draft: false }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })

    expect(response.status).toBe(500)
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects missing titles', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/materials', {
      method: 'POST',
      body: JSON.stringify({ title: ' ', content: doc }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Title is required' })
  })

  it('rejects invalid content', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/materials', {
      method: 'POST',
      body: JSON.stringify({ title: 'Reference', content: { type: 'paragraph' } }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid content format' })
  })
})
