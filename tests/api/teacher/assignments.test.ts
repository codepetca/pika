/**
 * API tests for GET/POST /api/teacher/assignments
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, POST } from '@/app/api/teacher/assignments/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/teacher/assignments', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should return 400 when classroom_id is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/assignments')
    const response = await GET(request)
    expect(response.status).toBe(400)
  })

  it('should return assignments for owned classroom', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: 'c1', teacher_id: 'teacher-1' }, error: null }),
          })),
        }
      } else if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          })),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments?classroom_id=c1')
    const response = await GET(request)
    expect(response.status).toBe(200)
  })
})

describe('POST /api/teacher/assignments', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should return 400 when required fields are missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/assignments', {
      method: 'POST',
      body: JSON.stringify({}),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })
})
