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
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.from = vi.fn()
  })

  it('should return 403 when not classroom owner', async () => {
    const { assertTeacherOwnsClassroom } = await import('@/lib/server/classrooms')
    ;(assertTeacherOwnsClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/roster')
    const response = await GET(request, { params: { id: 'c-1' } })
    expect(response.status).toBe(403)
  })

  it('returns roster rows annotated with joined enrollment metadata', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classroom_roster') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'r-1',
                  email: 'Joined@Example.com',
                  student_number: '1001',
                  first_name: 'Ada',
                  last_name: 'Lovelace',
                  counselor_email: 'c@example.com',
                  created_at: '2026-04-01T12:00:00.000Z',
                  updated_at: '2026-04-02T12:00:00.000Z',
                },
                {
                  id: 'r-2',
                  email: 'waiting@example.com',
                  student_number: null,
                  first_name: null,
                  last_name: null,
                  counselor_email: null,
                  created_at: '2026-04-03T12:00:00.000Z',
                  updated_at: '2026-04-04T12:00:00.000Z',
                },
              ],
              error: null,
            }),
          })),
        }
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [
                {
                  student_id: 'student-1',
                  created_at: '2026-04-05T12:00:00.000Z',
                  users: { email: 'joined@example.com' },
                },
              ],
              error: null,
            }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/roster')
    const response = await GET(request, { params: { id: 'c-1' } })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.roster).toEqual([
      expect.objectContaining({
        id: 'r-1',
        email: 'Joined@Example.com',
        joined: true,
        student_id: 'student-1',
        joined_at: '2026-04-05T12:00:00.000Z',
      }),
      expect.objectContaining({
        id: 'r-2',
        email: 'waiting@example.com',
        joined: false,
        student_id: null,
        joined_at: null,
      }),
    ])
  })
})
