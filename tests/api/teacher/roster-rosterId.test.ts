/**
 * API tests for DELETE /api/teacher/classrooms/[id]/roster/[rosterId]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DELETE, PATCH } from '@/app/api/teacher/classrooms/[id]/roster/[rosterId]/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherCanMutateClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'c-1', teacher_id: 'teacher-1', archived_at: null },
  })),
}))

const mockSupabaseClient = { from: vi.fn(), rpc: vi.fn() }

describe('PATCH /api/teacher/classrooms/[id]/roster/[rosterId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.from = vi.fn()
    mockSupabaseClient.rpc = vi.fn()
  })

  it('validates counselor_email input and requires a valid update field', async () => {
    const invalidType = await PATCH(new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/roster/r-1', {
      method: 'PATCH',
      body: JSON.stringify({ counselor_email: 123 }),
    }), { params: { id: 'c-1', rosterId: 'r-1' } })
    expect(invalidType.status).toBe(400)

    const noFields = await PATCH(new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/roster/r-1', {
      method: 'PATCH',
      body: JSON.stringify({ first_name: 'Ignored' }),
    }), { params: { id: 'c-1', rosterId: 'r-1' } })
    expect(noFields.status).toBe(400)
  })

  it('trims counselor_email, persists null for blanks, and returns the updated row', async () => {
    const update = vi.fn((payload: unknown) => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { id: 'r-1', counselor_email: null },
              error: null,
            }),
          })),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table !== 'classroom_roster') throw new Error(`Unexpected table: ${table}`)
      return { update }
    })

    const response = await PATCH(new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/roster/r-1', {
      method: 'PATCH',
      body: JSON.stringify({ counselor_email: '   ' }),
    }), { params: { id: 'c-1', rosterId: 'r-1' } })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith({ counselor_email: null })
    expect(data).toEqual({ success: true, roster: { id: 'r-1', counselor_email: null } })
  })

  it('returns 404 when the update completes without a row', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
          })),
        })),
      })),
    }))

    const response = await PATCH(new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/roster/r-1', {
      method: 'PATCH',
      body: JSON.stringify({ counselor_email: 'counselor@example.com' }),
    }), { params: { id: 'c-1', rosterId: 'r-1' } })

    expect(response.status).toBe(404)
  })
})

describe('DELETE /api/teacher/classrooms/[id]/roster/[rosterId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.from = vi.fn()
  })

  it('should return 403 when not classroom owner', async () => {
    const { assertTeacherCanMutateClassroom } = await import('@/lib/server/classrooms')
    ;(assertTeacherCanMutateClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/roster/s-1', {
      method: 'DELETE',
    })

    const response = await DELETE(request, { params: { id: 'c-1', rosterId: 'r-1' } })
    expect(response.status).toBe(403)
    expect(mockSupabaseClient.rpc).not.toHaveBeenCalled()
  })

  it('removes one roster entry through the atomic roster removal RPC', async () => {
    mockSupabaseClient.rpc = vi.fn().mockResolvedValue({
      data: {
        requested_count: 1,
        deleted_roster_entries: 1,
        deleted_entries: 2,
        deleted_assignment_docs: 3,
        deleted_enrollments: 1,
      },
      error: null,
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/roster/s-1', {
      method: 'DELETE',
    })

    const response = await DELETE(request, { params: { id: 'c-1', rosterId: 'r-1' } })
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data).toEqual({
      success: true,
      requested_count: 1,
      deleted_roster_entries: 1,
      deleted_entries: 2,
      deleted_assignment_docs: 3,
      deleted_enrollments: 1,
    })
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('remove_classroom_roster_entries_atomic', {
      p_classroom_id: 'c-1',
      p_roster_ids: ['r-1'],
    })
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })

  it('returns 404 when the atomic removal RPC reports a missing roster entry', async () => {
    mockSupabaseClient.rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'One or more roster entries not found in classroom' },
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/roster/s-1', {
      method: 'DELETE',
    })

    const response = await DELETE(request, { params: { id: 'c-1', rosterId: 'r-1' } })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('One or more roster entries not found in classroom')
  })

  it('returns migration guidance when the atomic removal RPC is missing', async () => {
    mockSupabaseClient.rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find function remove_classroom_roster_entries_atomic',
      },
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/roster/s-1', {
      method: 'DELETE',
    })

    const response = await DELETE(request, { params: { id: 'c-1', rosterId: 'r-1' } })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Roster removal requires migration 071 to be applied')
  })
})
