/**
 * API tests for GET /api/teacher/classrooms/[id]/roster
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/teacher/classrooms/[id]/roster/route'
import { NextRequest } from 'next/server'

const purgeAvailability = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'c-1', teacher_id: 'teacher-1', archived_at: null },
  })),
}))
vi.mock('@/lib/server/student-purge', () => ({
  getStudentPurgeEnabledStudentIds: (...args: unknown[]) => purgeAvailability(...args),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/teacher/classrooms/[id]/roster', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.from = vi.fn()
    purgeAvailability.mockResolvedValue([])
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
                  join_source: 'open_join',
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
                  join_source: null,
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

      if (table === 'classroom_roster_student_bindings') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST205', message: 'missing' } }),
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
        join_source: 'open_join',
        joined: true,
        student_id: 'student-1',
        joined_at: '2026-04-05T12:00:00.000Z',
      }),
      expect.objectContaining({
        id: 'r-2',
        email: 'waiting@example.com',
        join_source: 'manual',
        joined: false,
        student_id: null,
        joined_at: null,
      }),
    ])
    expect(data.student_purge_enabled_ids).toEqual([])
    expect(purgeAvailability).toHaveBeenCalledWith('teacher-1', 'c-1', ['student-1'])
  })

  it('prefers stable joined-student bindings over edited roster email', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue(table === 'classroom_roster'
          ? { data: [{
              id: 'r-1', email: 'edited@example.com', student_number: null,
              first_name: 'Ada', last_name: 'Lovelace', counselor_email: null,
              join_source: 'manual', created_at: '2026-04-01T12:00:00.000Z',
              updated_at: '2026-04-02T12:00:00.000Z',
            }], error: null }
          : table === 'classroom_enrollments'
            ? { data: [{
                student_id: 'student-1', created_at: '2026-04-05T12:00:00.000Z',
                users: { email: 'original@example.com' },
              }], error: null }
            : { data: [{ roster_id: 'r-1', student_id: 'student-1' }], error: null }),
      })),
    }))

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/roster'),
      { params: { id: 'c-1' } },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.roster[0]).toEqual(expect.objectContaining({
      email: 'edited@example.com',
      joined: true,
      student_id: 'student-1',
    }))
  })
})
