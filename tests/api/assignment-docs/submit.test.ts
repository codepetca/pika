/**
 * API tests for POST /api/assignment-docs/[id]/submit
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/assignment-docs/[id]/submit/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'student-1', role: 'student' })) }))

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/assignment-docs/[id]/submit', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should return 404 when doc does not exist', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/assignment-docs/doc-999/submit', {
      method: 'POST',
    })

    const response = await POST(request, { params: { id: 'doc-999' } })
    expect(response.status).toBe(404)
  })

  it('should return 403 when not student owner', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'doc-1', student_id: 'other-student', assignment_id: 'assign-1' },
                error: null,
              }),
            })),
          })),
        }
      } else if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'assign-1', classroom_id: 'class-1' },
                error: null,
              }),
            })),
          })),
        }
      } else if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'enroll-1' },
              error: null,
            }),
          })),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/assignment-docs/doc-1/submit', {
      method: 'POST',
    })

    const response = await POST(request, { params: { id: 'doc-1' } })
    expect(response.status).toBe(403)
  })
})
