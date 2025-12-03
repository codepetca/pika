/**
 * API tests for GET /api/teacher/class-days
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/teacher/class-days/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/calendar', () => ({ getClassDaysForDateRange: vi.fn(() => []) }))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/teacher/class-days', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should return 400 when classroom_id is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/class-days')
    const response = await GET(request)
    expect(response.status).toBe(400)
  })

  it('should return 403 when teacher does not own classroom', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { teacher_id: 'other' }, error: null }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/class-days?classroom_id=c1')
    const response = await GET(request)
    expect(response.status).toBe(403)
  })
})
