import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({ id: 'teacher-1', role: 'teacher' })),
}))

vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherCanMutateClassroom: vi.fn(async () => ({ ok: true })),
}))

import { POST } from '@/app/api/teacher/assignments/reorder/route'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/teacher/assignments/reorder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.from.mockReset()
  })

  it('rejects missing params and duplicate assignment ids', async () => {
    const missing = await POST(new NextRequest('http://localhost/api/teacher/assignments/reorder', {
      method: 'POST',
      body: JSON.stringify({ classroom_id: 'classroom-1' }),
    }))
    expect(missing.status).toBe(400)

    const duplicate = await POST(new NextRequest('http://localhost/api/teacher/assignments/reorder', {
      method: 'POST',
      body: JSON.stringify({ classroom_id: 'classroom-1', assignment_ids: ['a-1', 'a-1'] }),
    }))
    expect(duplicate.status).toBe(400)
  })

  it('returns the classroom ownership failure', async () => {
    ;(assertTeacherCanMutateClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })

    const response = await POST(new NextRequest('http://localhost/api/teacher/assignments/reorder', {
      method: 'POST',
      body: JSON.stringify({ classroom_id: 'classroom-1', assignment_ids: ['a-1'] }),
    }))

    expect(response.status).toBe(403)
  })

  it('rejects ids that do not all belong to the classroom', async () => {
    mockSupabaseClient.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn(async () => ({ data: [{ id: 'a-1' }], error: null })),
        })),
      })),
    })

    const response = await POST(new NextRequest('http://localhost/api/teacher/assignments/reorder', {
      method: 'POST',
      body: JSON.stringify({ classroom_id: 'classroom-1', assignment_ids: ['a-1', 'a-2'] }),
    }))

    expect(response.status).toBe(400)
  })

  it('persists each assignment position in submitted order', async () => {
    const updates: unknown[] = []
    mockSupabaseClient.from.mockImplementation((table: string) => {
      if (table !== 'assignments') throw new Error(`Unexpected table: ${table}`)
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn(async () => ({
              data: [{ id: 'a-2' }, { id: 'a-1' }],
              error: null,
            })),
          })),
        })),
        update: vi.fn((payload: unknown) => {
          updates.push(payload)
          return {
            eq: vi.fn(async () => ({ error: null })),
          }
        }),
      }
    })

    const response = await POST(new NextRequest('http://localhost/api/teacher/assignments/reorder', {
      method: 'POST',
      body: JSON.stringify({ classroom_id: 'classroom-1', assignment_ids: ['a-2', 'a-1'] }),
    }))

    expect(response.status).toBe(200)
    expect(updates).toEqual([{ position: 0 }, { position: 1 }])
  })

  it('returns 500 when verifying or updating assignments fails', async () => {
    mockSupabaseClient.from.mockReturnValueOnce({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn(async () => ({ data: null, error: { message: 'verify failed' } })),
        })),
      })),
    })

    const verifyFailure = await POST(new NextRequest('http://localhost/api/teacher/assignments/reorder', {
      method: 'POST',
      body: JSON.stringify({ classroom_id: 'classroom-1', assignment_ids: ['a-1'] }),
    }))
    expect(verifyFailure.status).toBe(500)

    mockSupabaseClient.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn(async () => ({ data: [{ id: 'a-1' }], error: null })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(async () => ({ error: { message: 'update failed' } })),
      })),
    })

    const updateFailure = await POST(new NextRequest('http://localhost/api/teacher/assignments/reorder', {
      method: 'POST',
      body: JSON.stringify({ classroom_id: 'classroom-1', assignment_ids: ['a-1'] }),
    }))
    expect(updateFailure.status).toBe(500)
  })
})
