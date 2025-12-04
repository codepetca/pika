/**
 * API tests for GET/PATCH/DELETE /api/teacher/classrooms/[id]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, PATCH, DELETE } from '@/app/api/teacher/classrooms/[id]/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/teacher/classrooms/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should return 404 when classroom does not exist', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-999')
    const response = await GET(request, { params: { id: 'c-999' } })
    expect(response.status).toBe(404)
  })

  it('should return 403 when not owner', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { teacher_id: 'other' }, error: null }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1')
    const response = await GET(request, { params: { id: 'c-1' } })
    expect(response.status).toBe(403)
  })
})

describe('PATCH /api/teacher/classrooms/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should return 400 when no fields to update', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { teacher_id: 'teacher-1' }, error: null }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1', {
      method: 'PATCH',
      body: JSON.stringify({}),
    })

    const response = await PATCH(request, { params: { id: 'c-1' } })
    expect(response.status).toBe(400)
  })
})

describe('DELETE /api/teacher/classrooms/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should return 403 when not owner', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { teacher_id: 'other' }, error: null }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1', {
      method: 'DELETE',
    })

    const response = await DELETE(request, { params: { id: 'c-1' } })
    expect(response.status).toBe(403)
  })
})
