import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/assignment-docs/[id]/history/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(async () => ({ id: 'student-1', role: 'student' })) }))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/assignment-docs/[id]/history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty history when no doc exists', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'assign-1', classroom_id: 'class-1', classrooms: { id: 'class-1', teacher_id: 'teacher-1' } },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: 'enroll-1' }, error: null }),
          })),
        }
      }
      if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
          })),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/history')
    const response = await GET(request, { params: { id: 'assign-1' } })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.history).toEqual([])
    expect(data.docId).toBe(null)
  })
})
