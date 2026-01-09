/**
 * API tests for GET /api/teacher/classrooms/[id]/roster
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/teacher/classrooms/[id]/roster/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'c-1', teacher_id: 'teacher-1', archived_at: null },
  })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/teacher/classrooms/[id]/roster', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should return 403 when not classroom owner', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { teacher_id: 'other' }, error: null }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/roster')
    const response = await GET(request, { params: { id: 'c-1' } })
    expect(response.status).toBe(403)
  })
})
