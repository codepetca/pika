/**
 * API tests for GET /api/teacher/entry/[id]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/teacher/entry/[id]/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/teacher/entry/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should return 404 when entry does not exist', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/entry/entry-999')
    const response = await GET(request, { params: { id: 'entry-999' } })
    expect(response.status).toBe(404)
  })
})
