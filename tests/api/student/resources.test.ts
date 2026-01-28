/**
 * API tests for GET /api/student/classrooms/[id]/resources
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/student/classrooms/[id]/resources/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'student-1' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(async () => ({ ok: true })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/student/classrooms/[id]/resources', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return null when no resources exist', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/resources'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.resources).toBeNull()
  })

  it('should return existing resources', async () => {
    const mockResources = {
      id: 'm-1',
      classroom_id: 'c-1',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Test' }] }] },
      updated_at: '2025-01-15T12:00:00Z',
      updated_by: 'teacher-1',
    }

    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: mockResources, error: null }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/resources'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.resources.id).toBe('m-1')
    expect(data.resources.content.content[0].content[0].text).toBe('Test')
  })

  it('should return 403 when student is not enrolled', async () => {
    const { assertStudentCanAccessClassroom } = await import('@/lib/server/classrooms')
    ;(assertStudentCanAccessClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Not enrolled in this classroom',
    })

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/resources'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(403)
    const data = await response.json()
    expect(data.error).toBe('Not enrolled in this classroom')
  })

  it('should return 403 when classroom is archived', async () => {
    const { assertStudentCanAccessClassroom } = await import('@/lib/server/classrooms')
    ;(assertStudentCanAccessClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Classroom is archived',
    })

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/resources'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(403)
    const data = await response.json()
    expect(data.error).toBe('Classroom is archived')
  })

  it('should return 401 when not authenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    const authError = new Error('Not authenticated')
    authError.name = 'AuthenticationError'
    ;(requireRole as any).mockRejectedValueOnce(authError)

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/resources'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(401)
  })

  it('should return 500 on database error', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/resources'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(500)
  })
})
