import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/classrooms/[id]/roster/bulk-delete/route'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'

const mockSupabaseClient = { rpc: vi.fn() }

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({ id: 'teacher-1', role: 'teacher' })),
}))

vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherCanMutateClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'c-1', teacher_id: 'teacher-1', archived_at: null },
  })),
}))

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/roster/bulk-delete', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ id: 'c-1' }) }

describe('POST /api/teacher/classrooms/[id]/roster/bulk-delete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.rpc = vi.fn().mockResolvedValue({
      data: {
        requested_count: 2,
        deleted_roster_entries: 2,
        deleted_entries: 4,
        deleted_assignment_docs: 5,
        deleted_enrollments: 2,
      },
      error: null,
    })
  })

  it('validates roster_ids input', async () => {
    const missing = await POST(makeRequest({}), params)
    expect(missing.status).toBe(400)
    await expect(missing.json()).resolves.toEqual({ error: 'roster_ids array is required' })

    const tooMany = await POST(
      makeRequest({ roster_ids: Array.from({ length: 101 }, (_, index) => `roster-${index}`) }),
      params,
    )
    expect(tooMany.status).toBe(400)
    await expect(tooMany.json()).resolves.toEqual({
      error: 'Cannot remove more than 100 roster entries at once',
    })
  })

  it('returns classroom mutation failures before calling the RPC', async () => {
    vi.mocked(assertTeacherCanMutateClassroom).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Classroom is archived',
    })

    const response = await POST(makeRequest({ roster_ids: ['r-1'] }), params)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Classroom is archived' })
    expect(mockSupabaseClient.rpc).not.toHaveBeenCalled()
  })

  it('removes selected roster entries atomically through the RPC', async () => {
    const response = await POST(makeRequest({ roster_ids: ['r-1', 'r-2', 'r-1', '  r-2  '] }), params)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('remove_classroom_roster_entries_atomic', {
      p_classroom_id: 'c-1',
      p_roster_ids: ['r-1', 'r-2'],
    })
    expect(data).toEqual({
      success: true,
      requested_count: 2,
      deleted_roster_entries: 2,
      deleted_entries: 4,
      deleted_assignment_docs: 5,
      deleted_enrollments: 2,
    })
  })

  it('maps known RPC validation errors to client errors', async () => {
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'One or more roster entries not found in classroom' },
    })

    const response = await POST(makeRequest({ roster_ids: ['r-1', 'r-2'] }), params)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'One or more roster entries not found in classroom',
    })
  })

  it('returns migration guidance when the atomic removal RPC is missing', async () => {
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find function remove_classroom_roster_entries_atomic',
      },
    })

    const response = await POST(makeRequest({ roster_ids: ['r-1'] }), params)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Roster removal requires migration 071 to be applied',
    })
  })
})
