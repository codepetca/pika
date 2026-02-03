/**
 * API tests for PATCH/DELETE /api/teacher/classrooms/[id]/announcements/[announcementId]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PATCH, DELETE } from '@/app/api/teacher/classrooms/[id]/announcements/[announcementId]/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))

const mockSupabaseClient = { from: vi.fn() }

// Helper to create ownership check mock
function mockOwnershipCheck(opts: { found?: boolean; owned?: boolean; archived?: boolean } = {}) {
  const { found = true, owned = true, archived = false } = opts

  return vi.fn((table: string) => {
    if (table === 'announcements') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: found ? {
              id: 'a-1',
              classroom_id: 'c-1',
              content: 'Content',
              classrooms: {
                id: 'c-1',
                teacher_id: owned ? 'teacher-1' : 'other-teacher',
                archived_at: archived ? '2025-01-01T00:00:00Z' : null,
              },
            } : null,
            error: found ? null : { code: 'PGRST116' },
          }),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'a-1', content: 'Updated Content' },
                error: null,
              }),
            })),
          })),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      }
    }
    return { select: vi.fn() }
  })
}

describe('PATCH /api/teacher/classrooms/[id]/announcements/[announcementId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should update announcement successfully', async () => {
    ;(mockSupabaseClient.from as any) = mockOwnershipCheck()

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/announcements/a-1',
      {
        method: 'PATCH',
        body: JSON.stringify({ content: 'Updated Content' }),
      }
    )
    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'c-1', announcementId: 'a-1' }),
    })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.announcement).toBeDefined()
  })

  it('should return 400 when content is missing', async () => {
    ;(mockSupabaseClient.from as any) = mockOwnershipCheck()

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/announcements/a-1',
      {
        method: 'PATCH',
        body: JSON.stringify({}),
      }
    )
    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'c-1', announcementId: 'a-1' }),
    })
    expect(response.status).toBe(400)

    const data = await response.json()
    expect(data.error).toBe('Content is required')
  })

  it('should return 400 when content is empty string', async () => {
    ;(mockSupabaseClient.from as any) = mockOwnershipCheck()

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/announcements/a-1',
      {
        method: 'PATCH',
        body: JSON.stringify({ content: '   ' }),
      }
    )
    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'c-1', announcementId: 'a-1' }),
    })
    expect(response.status).toBe(400)

    const data = await response.json()
    expect(data.error).toBe('Content is required')
  })

  it('should return 404 when announcement not found', async () => {
    ;(mockSupabaseClient.from as any) = mockOwnershipCheck({ found: false })

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/announcements/a-999',
      {
        method: 'PATCH',
        body: JSON.stringify({ content: 'Updated' }),
      }
    )
    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'c-1', announcementId: 'a-999' }),
    })
    expect(response.status).toBe(404)

    const data = await response.json()
    expect(data.error).toBe('Announcement not found')
  })

  it('should return 403 when teacher does not own classroom', async () => {
    ;(mockSupabaseClient.from as any) = mockOwnershipCheck({ owned: false })

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/announcements/a-1',
      {
        method: 'PATCH',
        body: JSON.stringify({ content: 'Updated' }),
      }
    )
    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'c-1', announcementId: 'a-1' }),
    })
    expect(response.status).toBe(403)

    const data = await response.json()
    expect(data.error).toBe('Unauthorized')
  })

  it('should return 403 when classroom is archived', async () => {
    ;(mockSupabaseClient.from as any) = mockOwnershipCheck({ archived: true })

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/announcements/a-1',
      {
        method: 'PATCH',
        body: JSON.stringify({ content: 'Updated' }),
      }
    )
    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'c-1', announcementId: 'a-1' }),
    })
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
      'http://localhost:3000/api/teacher/classrooms/c-1/announcements/a-1',
      {
        method: 'PATCH',
        body: JSON.stringify({ content: 'Updated' }),
      }
    )
    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'c-1', announcementId: 'a-1' }),
    })
    expect(response.status).toBe(401)
  })
})

describe('DELETE /api/teacher/classrooms/[id]/announcements/[announcementId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should delete announcement successfully', async () => {
    ;(mockSupabaseClient.from as any) = mockOwnershipCheck()

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/announcements/a-1',
      { method: 'DELETE' }
    )
    const response = await DELETE(request, {
      params: Promise.resolve({ id: 'c-1', announcementId: 'a-1' }),
    })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.success).toBe(true)
  })

  it('should return 404 when announcement not found', async () => {
    ;(mockSupabaseClient.from as any) = mockOwnershipCheck({ found: false })

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/announcements/a-999',
      { method: 'DELETE' }
    )
    const response = await DELETE(request, {
      params: Promise.resolve({ id: 'c-1', announcementId: 'a-999' }),
    })
    expect(response.status).toBe(404)

    const data = await response.json()
    expect(data.error).toBe('Announcement not found')
  })

  it('should return 403 when teacher does not own classroom', async () => {
    ;(mockSupabaseClient.from as any) = mockOwnershipCheck({ owned: false })

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/announcements/a-1',
      { method: 'DELETE' }
    )
    const response = await DELETE(request, {
      params: Promise.resolve({ id: 'c-1', announcementId: 'a-1' }),
    })
    expect(response.status).toBe(403)

    const data = await response.json()
    expect(data.error).toBe('Unauthorized')
  })

  it('should return 403 when classroom is archived', async () => {
    ;(mockSupabaseClient.from as any) = mockOwnershipCheck({ archived: true })

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/announcements/a-1',
      { method: 'DELETE' }
    )
    const response = await DELETE(request, {
      params: Promise.resolve({ id: 'c-1', announcementId: 'a-1' }),
    })
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
      'http://localhost:3000/api/teacher/classrooms/c-1/announcements/a-1',
      { method: 'DELETE' }
    )
    const response = await DELETE(request, {
      params: Promise.resolve({ id: 'c-1', announcementId: 'a-1' }),
    })
    expect(response.status).toBe(401)
  })
})
