/**
 * API tests for GET/POST /api/teacher/classrooms
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, POST } from '@/app/api/teacher/classrooms/route'
import { getNextTeacherClassroomPosition, listActiveTeacherClassrooms } from '@/lib/server/classroom-order'
import { listTeacherArchivedClassrooms } from '@/lib/server/classroom-archive-recovery-list'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async (role: string) => {
    if (role === 'teacher') {
      return { id: 'teacher-1', email: 'test@teacher.com', role: 'teacher' }
    }
    throw new Error('Unauthorized')
  }),
}))
vi.mock('@/lib/server/classroom-order', () => ({
  listActiveTeacherClassrooms: vi.fn(),
  getNextTeacherClassroomPosition: vi.fn(),
}))
vi.mock('@/lib/server/classroom-archive-recovery-list', () => ({
  listTeacherArchivedClassrooms: vi.fn(),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/teacher/classrooms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(listActiveTeacherClassrooms as any).mockResolvedValue({
      data: [{ id: 'classroom-1', title: 'Math 101' }],
      error: null,
    })
    vi.mocked(listTeacherArchivedClassrooms).mockResolvedValue({
      ok: true,
      hot_classrooms: [],
      cold_archives: [],
      cold_archive_restore_enabled: false,
    })
  })

  it('should return list of active teacher classrooms', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.classrooms).toHaveLength(1)
    expect(data.classrooms[0].theme_color).toBe('blue')
    expect(listActiveTeacherClassrooms).toHaveBeenCalled()
  })

  it('should return archived classrooms when requested', async () => {
    vi.mocked(listTeacherArchivedClassrooms).mockResolvedValueOnce({
      ok: true,
      hot_classrooms: [{ id: 'classroom-archived', title: 'History 101' }],
      cold_archives: [{
        classroom_id: '00000000-0000-4000-8000-000000000001',
        archive_id: '00000000-0000-4000-8000-000000000002',
        title: 'Stored history classroom',
        archived_at: '2026-07-01T12:00:00.000Z',
        compacted_at: '2026-07-10T12:00:00.000Z',
      }],
      cold_archive_restore_enabled: true,
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms?archived=true')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.classrooms).toHaveLength(1)
    expect(data.cold_archives).toHaveLength(1)
    expect(data.cold_archive_restore_enabled).toBe(true)
    expect(listTeacherArchivedClassrooms).toHaveBeenCalledWith({
      supabase: mockSupabaseClient,
      teacherId: 'teacher-1',
    })
  })

  it('fails closed when cold archive recovery state cannot be loaded', async () => {
    vi.mocked(listTeacherArchivedClassrooms).mockResolvedValueOnce({
      ok: false,
      error_code: 'cold_archive_list_failed',
    })

    const response = await GET(new NextRequest(
      'http://localhost:3000/api/teacher/classrooms?archived=true',
    ))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: 'Failed to fetch classroom archives',
    }))
  })

  it('returns a retryable response when archived lifecycle state does not stabilize', async () => {
    vi.mocked(listTeacherArchivedClassrooms).mockResolvedValueOnce({
      ok: false,
      error_code: 'classroom_archive_state_unstable',
    })

    const response = await GET(new NextRequest(
      'http://localhost:3000/api/teacher/classrooms?archived=true',
    ))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: 'Failed to fetch classroom archives',
    }))
  })
})

describe('POST /api/teacher/classrooms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getNextTeacherClassroomPosition as any).mockResolvedValue(-1)
    ;(listActiveTeacherClassrooms as any).mockResolvedValue({ data: [], error: null })
  })

  it('should return 400 when title is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms', {
      method: 'POST',
      body: JSON.stringify({}),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
  })

  it('should create classroom with generated code', async () => {
    const mockInsert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: 'classroom-1', title: 'Math 101' },
          error: null,
        }),
      })),
    }))

    const mockFrom = vi.fn(() => ({
      insert: mockInsert,
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms', {
      method: 'POST',
      body: JSON.stringify({ title: 'Math 101', termLabel: 'Fall 2024' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(201)
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Math 101',
      term_label: 'Fall 2024',
      position: -1,
      theme_color: expect.any(String),
    }))
  })

  it('should create classroom with selected theme color', async () => {
    const mockInsert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: 'classroom-1', title: 'Math 101', theme_color: 'teal' },
          error: null,
        }),
      })),
    }))

    ;(mockSupabaseClient.from as any) = vi.fn(() => ({ insert: mockInsert }))

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms', {
      method: 'POST',
      body: JSON.stringify({ title: 'Math 101', themeColor: 'teal' }),
    })

    const response = await POST(request)

    expect(response.status).toBe(201)
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      theme_color: 'teal',
    }))
    expect(listActiveTeacherClassrooms).not.toHaveBeenCalled()
  })

  it('should default new classrooms to a seeded unused teacher theme color', async () => {
    ;(listActiveTeacherClassrooms as any).mockResolvedValueOnce({
      data: [
        { id: 'classroom-1', theme_color: 'blue' },
        { id: 'classroom-2', theme_color: 'teal' },
        { id: 'classroom-3', theme_color: 'green' },
      ],
      error: null,
    })
    const mockInsert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: 'classroom-4', title: 'History 101', theme_color: 'rose' },
          error: null,
        }),
      })),
    }))

    ;(mockSupabaseClient.from as any) = vi.fn(() => ({ insert: mockInsert }))

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms', {
      method: 'POST',
      body: JSON.stringify({ title: 'History 101' }),
    })

    const response = await POST(request)

    expect(response.status).toBe(201)
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      theme_color: 'rose',
    }))
  })

  it('should reject invalid classroom theme colors', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms', {
      method: 'POST',
      body: JSON.stringify({ title: 'Math 101', themeColor: 'magenta' }),
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
  })
})
