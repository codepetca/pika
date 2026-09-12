/**
 * API tests for POST /api/teacher/classrooms/[id]/roster/add
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/teacher/classrooms/[id]/roster/add/route'
import { NextRequest } from 'next/server'
import { assertStudentsCanBeAddedToRoster } from '@/lib/server/classroom-student-removal'
import { ApiError } from '@/lib/api-error'

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

  it('rejects a removed student before any roster write', async () => {
    vi.mocked(assertStudentsCanBeAddedToRoster).mockRejectedValueOnce(new ApiError(409, 'Student cannot be re-added'))
    const request = new NextRequest('http://localhost/roster/add', {
      method: 'POST', body: JSON.stringify({ students: [{ email: 'removed@example.com', firstName: 'A', lastName: 'B' }] }),
    })
    const response = await POST(request, { params: { id: 'c-1' } })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'Student cannot be re-added' })
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })

  it('maps a concurrent database removal denial to an actionable conflict', async () => {
    mockSupabaseClient.from.mockReturnValue({ upsert: vi.fn(() => ({ select: vi.fn().mockResolvedValue({
      data: null, error: { code: '55000', message: 'student_class_data_pending_purge' },
    }) })) })
    const request = new NextRequest('http://localhost/roster/add', {
      method: 'POST', body: JSON.stringify({ students: [{ email: 'removed@example.com', firstName: 'A', lastName: 'B' }] }),
    })
    const response = await POST(request, { params: { id: 'c-1' } })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('cannot be re-added') })
  })

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
    const upsertMock = vi.fn(() => ({
      select: vi.fn().mockResolvedValue({
        data: [{ id: 'r-1', email: 'a@student.com' }],
        error: null,
      }),
    }))
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
          upsert: upsertMock,
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/roster/add', {
      method: 'POST',
      body: JSON.stringify({
        students: [
          {
            email: 'A@student.com',
            firstName: 'A',
            lastName: 'B',
            studentNumber: '123',
            counselorEmail: 'Secondary@Student.com',
          },
        ],
      }),
    })

    const response = await POST(request, { params: { id: 'c-1' } })
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.upsertedCount).toBe(1)
    expect(upsertMock).toHaveBeenCalledWith([
      expect.objectContaining({
        email: 'a@student.com',
        counselor_email: 'secondary@student.com',
        join_source: 'manual',
      }),
    ], { onConflict: 'classroom_id,email' })
  })
})
vi.mock('@/lib/server/classroom-student-removal', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/classroom-student-removal')>(),
  assertStudentsCanBeAddedToRoster: vi.fn(async () => {}),
}))
