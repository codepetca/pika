/**
 * API tests for GET/POST /api/student/classrooms/[id]/announcements
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, POST } from '@/app/api/student/classrooms/[id]/announcements/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'student-1' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(async () => ({ ok: true })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/student/classrooms/[id]/announcements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return empty array when no announcements exist', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          or: vi.fn(() => ({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/announcements'
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
          or: vi.fn(() => ({
            order: vi.fn().mockResolvedValue({ data: mockAnnouncements, error: null }),
          })),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/announcements'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.announcements).toHaveLength(2)
    expect(data.announcements[0].id).toBe('a-2')
  })

  it('should return 403 when student is not enrolled', async () => {
    const { assertStudentCanAccessClassroom } = await import('@/lib/server/classrooms')
    ;(assertStudentCanAccessClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Not enrolled in this classroom',
    })

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/announcements'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(403)

    const data = await response.json()
    expect(data.error).toBe('Not enrolled in this classroom')
  })

  it('should return 401 when not authenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    const authError = new Error('Not authenticated')
    authError.name = 'AuthenticationError'
    ;(requireRole as any).mockRejectedValueOnce(authError)

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/announcements'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(401)
  })

  it('should return 500 on database error', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          or: vi.fn(() => ({
            order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          })),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/announcements'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(500)
  })
})

describe('POST /api/student/classrooms/[id]/announcements (mark all as read)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should mark all announcements as read', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'announcements') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              or: vi.fn().mockResolvedValue({
                data: [{ id: 'a-1' }, { id: 'a-2' }],
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'announcement_reads') {
        return {
          upsert: vi.fn().mockResolvedValue({ error: null }),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/announcements',
      { method: 'POST' }
    )
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.marked).toBe(2)
  })

  it('should return success with marked=0 when no announcements exist', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'announcements') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              or: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            })),
          })),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/announcements',
      { method: 'POST' }
    )
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.marked).toBe(0)
  })

  it('should return 403 when student is not enrolled', async () => {
    const { assertStudentCanAccessClassroom } = await import('@/lib/server/classrooms')
    ;(assertStudentCanAccessClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Not enrolled in this classroom',
    })

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/announcements',
      { method: 'POST' }
    )
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(403)

    const data = await response.json()
    expect(data.error).toBe('Not enrolled in this classroom')
  })

  it('should return 401 when not authenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    const authError = new Error('Not authenticated')
    authError.name = 'AuthenticationError'
    ;(requireRole as any).mockRejectedValueOnce(authError)

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/announcements',
      { method: 'POST' }
    )
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(401)
  })

  it('should return 500 when fetching announcements fails', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'announcements') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              or: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'DB error' },
              }),
            })),
          })),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/announcements',
      { method: 'POST' }
    )
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(500)
  })

  it('should return 500 when upserting read records fails', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'announcements') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              or: vi.fn().mockResolvedValue({
                data: [{ id: 'a-1' }],
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'announcement_reads') {
        return {
          upsert: vi.fn().mockResolvedValue({ error: { message: 'DB error' } }),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/announcements',
      { method: 'POST' }
    )
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(500)
  })
})
