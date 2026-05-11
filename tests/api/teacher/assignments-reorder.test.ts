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

const mockSupabaseClient = { rpc: vi.fn() }

describe('POST /api/teacher/assignments/reorder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.rpc.mockResolvedValue({ data: null, error: null })
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
    expect(mockSupabaseClient.rpc).not.toHaveBeenCalled()
  })

  it('rejects ids that do not all belong to the classroom', async () => {
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'One or more assignments not found in classroom' },
    })

    const response = await POST(new NextRequest('http://localhost/api/teacher/assignments/reorder', {
      method: 'POST',
      body: JSON.stringify({ classroom_id: 'classroom-1', assignment_ids: ['a-1', 'a-2'] }),
    }))

    expect(response.status).toBe(400)
  })

  it('persists each assignment position through the material-aware reorder RPC', async () => {
    const response = await POST(new NextRequest('http://localhost/api/teacher/assignments/reorder', {
      method: 'POST',
      body: JSON.stringify({ classroom_id: 'classroom-1', assignment_ids: ['a-2', 'a-1'] }),
    }))

    expect(response.status).toBe(200)
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('reorder_assignments_preserve_materials', {
      p_classroom_id: 'classroom-1',
      p_assignment_ids: ['a-2', 'a-1'],
    })
  })

  it('returns 409 for stale assignment lists', async () => {
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Assignment list changed. Refresh and try again.' },
    })

    const response = await POST(new NextRequest('http://localhost/api/teacher/assignments/reorder', {
      method: 'POST',
      body: JSON.stringify({ classroom_id: 'classroom-1', assignment_ids: ['a-1'] }),
    }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Assignment list changed. Refresh and try again.' })
  })

  it('returns 500 when the material-aware reorder RPC fails unexpectedly', async () => {
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'database unavailable' },
    })

    const response = await POST(new NextRequest('http://localhost/api/teacher/assignments/reorder', {
      method: 'POST',
      body: JSON.stringify({ classroom_id: 'classroom-1', assignment_ids: ['a-1'] }),
    }))

    expect(response.status).toBe(500)
  })
})
