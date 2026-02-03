/**
 * API tests for GET/POST /api/teacher/classrooms/[id]/announcements
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, POST } from '@/app/api/teacher/classrooms/[id]/announcements/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom: vi.fn(async () => ({ ok: true })),
  assertTeacherCanMutateClassroom: vi.fn(async () => ({ ok: true })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/teacher/classrooms/[id]/announcements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return empty array when no announcements exist', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/announcements'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.announcements).toEqual([])
  })

  it('should return announcements sorted by created_at desc', async () => {
    const mockAnnouncements = [
      { id: 'a-2', content: 'Content 2', created_at: '2025-01-16T12:00:00Z' },
      { id: 'a-1', content: 'Content 1', created_at: '2025-01-15T12:00:00Z' },
    ]

    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({ data: mockAnnouncements, error: null }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/announcements'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.announcements).toHaveLength(2)
    expect(data.announcements[0].id).toBe('a-2')
  })

  it('should return 403 when teacher does not own classroom', async () => {
    const { assertTeacherOwnsClassroom } = await import('@/lib/server/classrooms')
    ;(assertTeacherOwnsClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/announcements'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(403)
  })

  it('should return 401 when not authenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    const authError = new Error('Not authenticated')
    authError.name = 'AuthenticationError'
    ;(requireRole as any).mockRejectedValueOnce(authError)

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/announcements'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(401)
  })

  it('should return 500 on database error', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/announcements'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(500)
  })
})

describe('POST /api/teacher/classrooms/[id]/announcements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create announcement successfully', async () => {
    const mockAnnouncement = {
      id: 'a-1',
      classroom_id: 'c-1',
      content: 'Test Content',
      created_by: 'teacher-1',
      created_at: '2025-01-15T12:00:00Z',
      updated_at: '2025-01-15T12:00:00Z',
    }

    const mockFrom = vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: mockAnnouncement, error: null }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/announcements',
      {
        method: 'POST',
        body: JSON.stringify({ content: 'Test Content' }),
      }
    )
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(201)

    const data = await response.json()
    expect(data.announcement.id).toBe('a-1')
    expect(data.announcement.content).toBe('Test Content')
  })

  it('should return 400 when content is missing', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/announcements',
      {
        method: 'POST',
        body: JSON.stringify({}),
      }
    )
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(400)

    const data = await response.json()
    expect(data.error).toBe('Content is required')
  })

  it('should return 400 when content is empty', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/announcements',
      {
        method: 'POST',
        body: JSON.stringify({ content: '   ' }),
      }
    )
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(400)

    const data = await response.json()
    expect(data.error).toBe('Content is required')
  })

  it('should return 403 when classroom is archived', async () => {
    const { assertTeacherCanMutateClassroom } = await import('@/lib/server/classrooms')
    ;(assertTeacherCanMutateClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Classroom is archived',
    })

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/announcements',
      {
        method: 'POST',
        body: JSON.stringify({ content: 'Test Content' }),
      }
    )
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })
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
      'http://localhost:3000/api/teacher/classrooms/c-1/announcements',
      {
        method: 'POST',
        body: JSON.stringify({ content: 'Test Content' }),
      }
    )
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(401)
  })

  it('should return 500 on database error', async () => {
    const mockFrom = vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/announcements',
      {
        method: 'POST',
        body: JSON.stringify({ content: 'Test Content' }),
      }
    )
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(500)
  })
})
