import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/classrooms/reorder/route'
import { getNextTeacherClassroomPosition } from '@/lib/server/classroom-order'

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({ id: 'teacher-1', role: 'teacher' })),
}))

vi.mock('@/lib/server/classroom-order', () => ({
  getNextTeacherClassroomPosition: vi.fn(),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/teacher/classrooms/reorder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should reject duplicate classroom ids', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/reorder', {
      method: 'POST',
      body: JSON.stringify({ classroom_ids: ['c-1', 'c-1'] }),
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
  })

  it('should require the migration before persisting order', async () => {
    ;(getNextTeacherClassroomPosition as any).mockResolvedValueOnce(null)

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/reorder', {
      method: 'POST',
      body: JSON.stringify({ classroom_ids: ['c-1', 'c-2'] }),
    })

    const response = await POST(request)

    expect(response.status).toBe(409)
  })

  it('should persist the submitted classroom order', async () => {
    ;(getNextTeacherClassroomPosition as any).mockResolvedValueOnce(0)

    const mockUpdate = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn().mockResolvedValue({
                data: [{ id: 'c-1' }, { id: 'c-2' }],
                error: null,
              }),
            })),
          })),
          update: mockUpdate,
        }
      }
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/reorder', {
      method: 'POST',
      body: JSON.stringify({ classroom_ids: ['c-2', 'c-1'] }),
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith({ position: 0 })
    expect(mockUpdate).toHaveBeenCalledWith({ position: 1 })
  })
})
