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

import { POST } from '@/app/api/teacher/classrooms/[id]/classwork/reorder/route'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'

const mockSupabaseClient = { rpc: vi.fn() }
const params = { params: Promise.resolve({ id: 'classroom-1' }) }

describe('POST /api/teacher/classrooms/[id]/classwork/reorder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.rpc.mockResolvedValue({ data: null, error: null })
  })

  it('rejects missing, invalid, and duplicate items', async () => {
    const missing = await POST(new NextRequest('http://localhost/api/teacher/classrooms/classroom-1/classwork/reorder', {
      method: 'POST',
      body: JSON.stringify({}),
    }), params)
    expect(missing.status).toBe(400)

    const invalid = await POST(new NextRequest('http://localhost/api/teacher/classrooms/classroom-1/classwork/reorder', {
      method: 'POST',
      body: JSON.stringify({ items: [{ type: 'note', id: 'x-1' }] }),
    }), params)
    expect(invalid.status).toBe(400)

    const duplicate = await POST(new NextRequest('http://localhost/api/teacher/classrooms/classroom-1/classwork/reorder', {
      method: 'POST',
      body: JSON.stringify({ items: [{ type: 'material', id: 'm-1' }, { type: 'material', id: 'm-1' }] }),
    }), params)
    expect(duplicate.status).toBe(400)
  })

  it('returns classroom mutation failures before verifying items', async () => {
    ;(assertTeacherCanMutateClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Classroom is archived',
    })

    const response = await POST(new NextRequest('http://localhost/api/teacher/classrooms/classroom-1/classwork/reorder', {
      method: 'POST',
      body: JSON.stringify({ items: [{ type: 'assignment', id: 'a-1' }] }),
    }), params)

    expect(response.status).toBe(403)
    expect(mockSupabaseClient.rpc).not.toHaveBeenCalled()
  })

  it('rejects classwork ids that do not belong to the classroom', async () => {
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'One or more classwork items not found in classroom' },
    })

    const response = await POST(new NextRequest('http://localhost/api/teacher/classrooms/classroom-1/classwork/reorder', {
      method: 'POST',
      body: JSON.stringify({
        items: [
          { type: 'assignment', id: 'a-1' },
          { type: 'material', id: 'm-1' },
        ],
      }),
    }), params)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'One or more classwork items not found in classroom' })
  })

  it('rejects stale reorder requests that omit current classwork items', async () => {
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Classwork list changed. Refresh and try again.' },
    })

    const response = await POST(new NextRequest('http://localhost/api/teacher/classrooms/classroom-1/classwork/reorder', {
      method: 'POST',
      body: JSON.stringify({
        items: [
          { type: 'material', id: 'm-1' },
          { type: 'assignment', id: 'a-1' },
        ],
      }),
    }), params)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Classwork list changed. Refresh and try again.' })
  })

  it('returns 500 without row writes when the transactional reorder fails unexpectedly', async () => {
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'column classwork_materials.position does not exist' },
    })

    const response = await POST(new NextRequest('http://localhost/api/teacher/classrooms/classroom-1/classwork/reorder', {
      method: 'POST',
      body: JSON.stringify({
        items: [
          { type: 'assignment', id: 'a-2' },
          { type: 'assignment', id: 'a-1' },
        ],
      }),
    }), params)

    expect(response.status).toBe(500)
    expect(mockSupabaseClient.rpc).toHaveBeenCalledTimes(1)
  })

  it('persists mixed assignment and material positions transactionally', async () => {
    const response = await POST(new NextRequest('http://localhost/api/teacher/classrooms/classroom-1/classwork/reorder', {
      method: 'POST',
      body: JSON.stringify({
        items: [
          { type: 'material', id: 'm-1' },
          { type: 'assignment', id: 'a-2' },
          { type: 'assignment', id: 'a-1' },
        ],
      }),
    }), params)

    expect(response.status).toBe(200)
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('reorder_classwork_items', {
      p_classroom_id: 'classroom-1',
      p_items: [
        { type: 'material', id: 'm-1' },
        { type: 'assignment', id: 'a-2' },
        { type: 'assignment', id: 'a-1' },
      ],
    })
  })
})
