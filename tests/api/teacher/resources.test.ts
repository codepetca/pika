/**
 * API tests for GET/PUT /api/teacher/classrooms/[id]/resources
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, POST, PUT } from '@/app/api/teacher/classrooms/[id]/resources/route'
import { NextRequest } from 'next/server'
import type { TiptapContent } from '@/types'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom: vi.fn(async () => ({ ok: true })),
  assertTeacherCanMutateClassroom: vi.fn(async () => ({ ok: true })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/teacher/classrooms/[id]/resources', () => {
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
      'http://localhost:3000/api/teacher/classrooms/c-1/resources'
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
      'http://localhost:3000/api/teacher/classrooms/c-1/resources'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.resources.id).toBe('m-1')
    expect(data.resources.content.content[0].content[0].text).toBe('Test')
  })

  it('should return 403 when teacher does not own classroom', async () => {
    const { assertTeacherOwnsClassroom } = await import('@/lib/server/classrooms')
    ;(assertTeacherOwnsClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/resources'
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
      'http://localhost:3000/api/teacher/classrooms/c-1/resources'
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
      'http://localhost:3000/api/teacher/classrooms/c-1/resources'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(500)
  })
})

describe('PUT /api/teacher/classrooms/[id]/resources', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 400 for invalid content format', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/resources',
      {
        method: 'PUT',
        body: JSON.stringify({ content: { type: 'invalid', content: [] }, saveRevision: 1 }),
      }
    )
    const response = await PUT(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('Invalid resource save payload')
  })

  it('should return 400 for missing content', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/resources',
      {
        method: 'PUT',
        body: JSON.stringify({ saveRevision: 1 }),
      }
    )
    const response = await PUT(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('Invalid resource save payload')
  })

  it('should upsert resources successfully', async () => {
    const mockResources = {
      id: 'm-1',
      classroom_id: 'c-1',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Test' }] }] },
      updated_at: '2025-01-15T12:00:00Z',
      updated_by: 'teacher-1',
    }

    const mockFrom = vi.fn(() => ({
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: mockResources, error: null }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/resources',
      {
        method: 'PUT',
        body: JSON.stringify({ content: mockResources.content, saveRevision: 1 }),
      }
    )
    const response = await PUT(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.resources.id).toBe('m-1')
  })

  it('should return 403 when classroom is archived', async () => {
    const { assertTeacherCanMutateClassroom } = await import('@/lib/server/classrooms')
    ;(assertTeacherCanMutateClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Classroom is archived',
    })

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/resources',
      {
        method: 'PUT',
        body: JSON.stringify({ content: { type: 'doc', content: [] }, saveRevision: 1 }),
      }
    )
    const response = await PUT(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(403)
    const data = await response.json()
    expect(data.error).toBe('Classroom is archived')
  })

  it('should return 403 when teacher does not own classroom', async () => {
    const { assertTeacherCanMutateClassroom } = await import('@/lib/server/classrooms')
    ;(assertTeacherCanMutateClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/resources',
      {
        method: 'PUT',
        body: JSON.stringify({ content: { type: 'doc', content: [] }, saveRevision: 1 }),
      }
    )
    const response = await PUT(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(403)
  })

  it('should return 401 when not authenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    const authError = new Error('Not authenticated')
    authError.name = 'AuthenticationError'
    ;(requireRole as any).mockRejectedValueOnce(authError)

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/resources',
      {
        method: 'PUT',
        body: JSON.stringify({ content: { type: 'doc', content: [] }, saveRevision: 1 }),
      }
    )
    const response = await PUT(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(401)
  })

  it('should return 500 on database error', async () => {
    const mockFrom = vi.fn(() => ({
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/resources',
      {
        method: 'PUT',
        body: JSON.stringify({ content: { type: 'doc', content: [] }, saveRevision: 1 }),
      }
    )
    const response = await PUT(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(500)
  })

  it('returns 409 when the database rejects an older save revision', async () => {
    const mockFrom = vi.fn(() => ({
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/resources',
      {
        method: 'PUT',
        body: JSON.stringify({ content: { type: 'doc', content: [] }, saveRevision: 1 }),
      },
    )
    const response = await PUT(request, { params: Promise.resolve({ id: 'c-1' }) })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'A newer resource draft has already been saved',
    })
  })
})

describe('POST /api/teacher/classrooms/[id]/resources', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists a valid unload beacon through the same guarded upsert', async () => {
    const content = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Unload draft' }] }],
    }
    const upsert = vi.fn(() => ({
      select: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'm-1', classroom_id: 'c-1', content, save_revision: 2 },
          error: null,
        }),
      })),
    }))
    ;(mockSupabaseClient.from as any) = vi.fn(() => ({ upsert }))

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/resources',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, saveRevision: 2 }),
      },
    )
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })

    expect(response.status).toBe(200)
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      classroom_id: 'c-1',
      content,
      save_revision: 2,
      updated_by: 'teacher-1',
    }), { onConflict: 'classroom_id' })
  })

  it('keeps a newer beacon when an older PUT reaches the database afterward', async () => {
    const olderContent = { type: 'doc', content: [{ type: 'paragraph' }] }
    const newerContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Newest unload draft' }] }],
    }
    let stored: { content: TiptapContent; save_revision: number } = {
      content: { type: 'doc', content: [] },
      save_revision: 0,
    }
    let releaseOlderWrite: (() => void) | null = null

    const upsert = vi.fn((candidate: { content: TiptapContent; save_revision: number }) => ({
      select: vi.fn(() => ({
        maybeSingle: vi.fn(async () => {
          if (candidate.save_revision === 1) {
            await new Promise<void>((resolve) => {
              releaseOlderWrite = resolve
            })
          }
          if (candidate.save_revision < stored.save_revision) {
            return { data: null, error: null }
          }
          stored = { content: candidate.content, save_revision: candidate.save_revision }
          return { data: stored, error: null }
        }),
      })),
    }))
    ;(mockSupabaseClient.from as any) = vi.fn(() => ({ upsert }))

    const olderRequest = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/resources',
      {
        method: 'PUT',
        body: JSON.stringify({ content: olderContent, saveRevision: 1 }),
      },
    )
    const olderResponsePromise = PUT(olderRequest, { params: Promise.resolve({ id: 'c-1' }) })
    await vi.waitFor(() => expect(releaseOlderWrite).not.toBeNull())

    const beaconRequest = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/resources',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newerContent, saveRevision: 2 }),
      },
    )
    const beaconResponse = await POST(beaconRequest, { params: Promise.resolve({ id: 'c-1' }) })
    expect(beaconResponse.status).toBe(200)

    releaseOlderWrite?.()
    const olderResponse = await olderResponsePromise

    expect(olderResponse.status).toBe(409)
    expect(stored).toEqual({ content: newerContent, save_revision: 2 })
  })
})
