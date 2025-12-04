/**
 * API tests for GET /api/teacher/assignments/[id]/students/[studentId]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/teacher/assignments/[id]/students/[studentId]/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/teacher/assignments/[id]/students/[studentId]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should return 404 when assignment does not exist', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/a-999/students/s-1')
    const response = await GET(request, { params: { id: 'a-999', studentId: 's-1' } })
    expect(response.status).toBe(404)
  })

  it('should return 403 when not creator', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'a-1',
              created_by: 'other',
              classrooms: { teacher_id: 'other' },
            },
            error: null,
          }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/a-1/students/s-1')
    const response = await GET(request, { params: { id: 'a-1', studentId: 's-1' } })
    expect(response.status).toBe(403)
  })
})
