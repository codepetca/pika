/**
 * API tests for GET/PATCH /api/assignment-docs/[id]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, PATCH } from '@/app/api/assignment-docs/[id]/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'student-1', role: 'student' })) }))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/assignment-docs/[id]', () => {
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

    const request = new NextRequest('http://localhost:3000/api/assignment-docs/doc-999')
    const response = await GET(request, { params: { id: 'doc-999' } })
    expect(response.status).toBe(404)
  })

  it('should return 403 when not student owner', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { id: 'doc-1', student_id: 'other-student' },
            error: null,
          }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/assignment-docs/doc-1')
    const response = await GET(request, { params: { id: 'doc-1' } })
    expect(response.status).toBe(403)
  })
})

describe('PATCH /api/assignment-docs/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should return 403 when trying to update submitted doc', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { id: 'doc-1', student_id: 'student-1', is_submitted: true },
            error: null,
          }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/assignment-docs/doc-1', {
      method: 'PATCH',
      body: JSON.stringify({ content: 'new content' }),
    })

    const response = await PATCH(request, { params: { id: 'doc-1' } })
    expect(response.status).toBe(403)
  })
})
