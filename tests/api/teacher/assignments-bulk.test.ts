/**
 * API tests for POST /api/teacher/assignments/bulk
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/teacher/assignments/bulk/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherCanMutateClassroom: vi.fn(async () => ({ ok: true })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/teacher/assignments/bulk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 400 when classroom_id is missing', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/teacher/assignments/bulk',
      {
        method: 'POST',
        body: JSON.stringify({ assignments: [] }),
      }
    )
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('classroom_id is required')
  })

  it('should return 400 when assignments array is missing', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/teacher/assignments/bulk',
      {
        method: 'POST',
        body: JSON.stringify({ classroom_id: 'c-1' }),
      }
    )
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('assignments array is required')
  })

  it('should return 400 when assignments exceeds max limit (50)', async () => {
    const assignments = Array.from({ length: 51 }, (_, i) => ({
      title: `Assignment ${i}`,
      due_at: '2025-01-20T23:59:00Z',
      instructions: 'Test',
      is_draft: true,
      position: i,
    }))

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/assignments/bulk',
      {
        method: 'POST',
        body: JSON.stringify({ classroom_id: 'c-1', assignments }),
      }
    )
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('Maximum is 50')
  })

  it('should return 400 for assignment without title', async () => {
    const assignments = [
      { title: '', due_at: '2025-01-20T23:59:00Z', instructions: 'Test', is_draft: true, position: 0 },
    ]

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/assignments/bulk',
      {
        method: 'POST',
        body: JSON.stringify({ classroom_id: 'c-1', assignments }),
      }
    )
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.errors).toContain('Assignment at position 0 has no title')
  })

  it('should return 400 for assignment without due date', async () => {
    const assignments = [
      { title: 'Test', due_at: '', instructions: 'Test', is_draft: true, position: 0 },
    ]

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/assignments/bulk',
      {
        method: 'POST',
        body: JSON.stringify({ classroom_id: 'c-1', assignments }),
      }
    )
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.errors).toContain('Assignment "Test" has no due date')
  })

  it('should return 400 when trying to un-release assignment', async () => {
    // Mock existing released assignment
    const mockIn = vi.fn().mockResolvedValue({
      data: [
        { id: 'a-1', is_draft: false, released_at: '2025-01-01T00:00:00Z', title: 'Released' },
      ],
      error: null,
    })
    const mockEq = vi.fn(() => ({ in: mockIn }))
    const mockSelect = vi.fn(() => ({ eq: mockEq }))
    const mockFrom = vi.fn(() => ({ select: mockSelect }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const assignments = [
      { id: 'a-1', title: 'Released', due_at: '2025-01-20T23:59:00Z', instructions: 'Test', is_draft: true, position: 0 },
    ]

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/assignments/bulk',
      {
        method: 'POST',
        body: JSON.stringify({ classroom_id: 'c-1', assignments }),
      }
    )
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.errors.some((e: string) => e.includes('Cannot un-release'))).toBe(true)
  })

  it('should return 403 when teacher cannot mutate classroom', async () => {
    const { assertTeacherCanMutateClassroom } = await import('@/lib/server/classrooms')
    ;(assertTeacherCanMutateClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })

    const assignments = [
      { title: 'Test', due_at: '2025-01-20T23:59:00Z', instructions: 'Test', is_draft: true, position: 0 },
    ]

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/assignments/bulk',
      {
        method: 'POST',
        body: JSON.stringify({ classroom_id: 'c-1', assignments }),
      }
    )
    const response = await POST(request)
    expect(response.status).toBe(403)
  })

  it('should create new assignments as drafts', async () => {
    // Mock: no existing assignments with the given IDs
    const mockSelect = vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn().mockResolvedValue({ data: [], error: null }),
      })),
    }))
    const mockInsert = vi.fn(() => ({
      select: vi.fn().mockResolvedValue({
        data: [
          { id: 'new-1', title: 'New Assignment', is_draft: true, position: 0 },
        ],
        error: null,
      }),
    }))
    const mockFrom = vi.fn((table: string) => {
      if (table === 'assignments') {
        return { select: mockSelect, insert: mockInsert, update: vi.fn() }
      }
      return { select: mockSelect }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const assignments = [
      { title: 'New Assignment', due_at: '2025-01-20T23:59:00Z', instructions: 'Test', is_draft: true, position: 0 },
    ]

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/assignments/bulk',
      {
        method: 'POST',
        body: JSON.stringify({ classroom_id: 'c-1', assignments }),
      }
    )
    const response = await POST(request)
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.created).toBe(1)
    expect(data.updated).toBe(0)
  })

  it('should update existing assignments', async () => {
    // Mock: existing assignment via select().eq().in()
    const mockIn = vi.fn().mockResolvedValue({
      data: [
        { id: 'a-1', title: 'Old Title', is_draft: true, released_at: null },
      ],
      error: null,
    })
    const mockSelectEq = vi.fn(() => ({ in: mockIn }))
    const mockSelect = vi.fn(() => ({ eq: mockSelectEq }))

    // Mock: update().eq().select()
    const mockUpdateSelect = vi.fn().mockResolvedValue({
      data: [{ id: 'a-1', title: 'Updated Title', is_draft: true, position: 0 }],
      error: null,
    })
    const mockUpdateEq = vi.fn(() => ({ select: mockUpdateSelect }))
    const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }))

    const mockFrom = vi.fn(() => ({
      select: mockSelect,
      update: mockUpdate,
      insert: vi.fn(),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const assignments = [
      { id: 'a-1', title: 'Updated Title', due_at: '2025-01-20T23:59:00Z', instructions: 'Updated', is_draft: true, position: 0 },
    ]

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/assignments/bulk',
      {
        method: 'POST',
        body: JSON.stringify({ classroom_id: 'c-1', assignments }),
      }
    )
    const response = await POST(request)
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.updated).toBe(1)
    expect(data.created).toBe(0)
  })

  it('should allow releasing a draft assignment', async () => {
    // Mock: existing draft assignment via select().eq().in()
    const mockIn = vi.fn().mockResolvedValue({
      data: [
        { id: 'a-1', title: 'Draft', is_draft: true, released_at: null },
      ],
      error: null,
    })
    const mockSelectEq = vi.fn(() => ({ in: mockIn }))
    const mockSelect = vi.fn(() => ({ eq: mockSelectEq }))

    // Mock: update().eq().select()
    const mockUpdateSelect = vi.fn().mockResolvedValue({
      data: [{ id: 'a-1', title: 'Released', is_draft: false, released_at: '2025-01-15T00:00:00Z', position: 0 }],
      error: null,
    })
    const mockUpdateEq = vi.fn(() => ({ select: mockUpdateSelect }))
    const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }))

    const mockFrom = vi.fn(() => ({
      select: mockSelect,
      update: mockUpdate,
      insert: vi.fn(),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const assignments = [
      { id: 'a-1', title: 'Released', due_at: '2025-01-20T23:59:00Z', instructions: 'Instructions', is_draft: false, position: 0 },
    ]

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/assignments/bulk',
      {
        method: 'POST',
        body: JSON.stringify({ classroom_id: 'c-1', assignments }),
      }
    )
    const response = await POST(request)
    expect(response.status).toBe(200)
  })

  it('should return 401 when not authenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    const authError = new Error('Not authenticated')
    authError.name = 'AuthenticationError'
    ;(requireRole as any).mockRejectedValueOnce(authError)

    const assignments = [
      { title: 'Test', due_at: '2025-01-20T23:59:00Z', instructions: 'Test', is_draft: true, position: 0 },
    ]

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/assignments/bulk',
      {
        method: 'POST',
        body: JSON.stringify({ classroom_id: 'c-1', assignments }),
      }
    )
    const response = await POST(request)
    expect(response.status).toBe(401)
  })

  it('should return 500 on database error', async () => {
    // Mock: select().eq().in() returns error
    const mockIn = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'DB error' },
    })
    const mockEq = vi.fn(() => ({ in: mockIn }))
    const mockSelect = vi.fn(() => ({ eq: mockEq }))
    const mockFrom = vi.fn(() => ({
      select: mockSelect,
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const assignments = [
      { id: 'a-1', title: 'Test', due_at: '2025-01-20T23:59:00Z', instructions: 'Test', is_draft: true, position: 0 },
    ]

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/assignments/bulk',
      {
        method: 'POST',
        body: JSON.stringify({ classroom_id: 'c-1', assignments }),
      }
    )
    const response = await POST(request)
    expect(response.status).toBe(500)
  })
})
