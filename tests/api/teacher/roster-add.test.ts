/**
 * API tests for POST /api/teacher/classrooms/[id]/roster/add
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/teacher/classrooms/[id]/roster/add/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherCanMutateClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'c-1', teacher_id: 'teacher-1', archived_at: null },
  })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/teacher/classrooms/[id]/roster/add', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should return 400 when students array is missing', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { teacher_id: 'teacher-1' }, error: null }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/roster/add', {
      method: 'POST',
      body: JSON.stringify({}),
    })

    const response = await POST(request, { params: { id: 'c-1' } })
    expect(response.status).toBe(400)
  })

  it('upserts into classroom_roster', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: { teacher_id: 'teacher-1' }, error: null }),
            })),
          })),
        }
      }
      if (table === 'classroom_roster') {
        return {
          upsert: vi.fn(() => ({
            select: vi.fn().mockResolvedValue({
              data: [{ id: 'r-1', email: 'a@student.com' }],
              error: null,
            }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/roster/add', {
      method: 'POST',
      body: JSON.stringify({
        students: [
          { email: 'A@student.com', firstName: 'A', lastName: 'B', studentNumber: '123' },
        ],
      }),
    })

    const response = await POST(request, { params: { id: 'c-1' } })
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.upsertedCount).toBe(1)
  })
})
