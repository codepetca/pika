import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { POST as assignmentReorderPOST } from '@/app/api/teacher/assignments/reorder/route'
import { POST as classworkReorderPOST } from '@/app/api/teacher/classrooms/[id]/classwork/reorder/route'
import { authorizeContextualClassworkReorderRequest } from '@/lib/server/contextual-classwork-reorder-access'
import {
  reorderAssignmentsForOwner,
  reorderClassworkForOwner,
} from '@/lib/server/contextual-classwork-reorder'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const assignmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const materialId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const user = { id: actorId, role: 'student', email: 'owner@example.com' }
const mockSupabase = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabase) }))
vi.mock('@/lib/server/contextual-classwork-reorder-access', () => ({
  authorizeContextualClassworkReorderRequest: vi.fn(),
}))
vi.mock('@/lib/server/contextual-classwork-reorder', () => ({
  reorderAssignmentsForOwner: vi.fn(),
  reorderClassworkForOwner: vi.fn(),
}))

describe('contextual classwork reorder routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authorizeContextualClassworkReorderRequest).mockResolvedValue({
      mode: 'contextual', user: user as any, classroomId,
    })
  })

  it('routes a student-valued owner assignment reorder through the fenced RPC', async () => {
    const assignmentIds = [assignmentId]
    const response = await assignmentReorderPOST(new NextRequest(
      'http://localhost/api/teacher/assignments/reorder',
      { method: 'POST', body: JSON.stringify({ classroom_id: classroomId, assignment_ids: assignmentIds }) },
    ))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
    expect(reorderAssignmentsForOwner).toHaveBeenCalledWith({
      supabase: mockSupabase,
      actorId,
      classroomId,
      assignmentIds,
    })
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('routes a student-valued owner mixed-classwork reorder through the fenced RPC', async () => {
    const items = [
      { type: 'material', id: materialId },
      { type: 'assignment', id: assignmentId },
    ]
    const response = await classworkReorderPOST(new NextRequest(
      `http://localhost/api/teacher/classrooms/${classroomId}/classwork/reorder`,
      { method: 'POST', body: JSON.stringify({ items }) },
    ), { params: Promise.resolve({ id: classroomId }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
    expect(reorderClassworkForOwner).toHaveBeenCalledWith({
      supabase: mockSupabase,
      actorId,
      classroomId,
      items,
    })
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('validates duplicate assignment ids before invoking the contextual RPC', async () => {
    const response = await assignmentReorderPOST(new NextRequest(
      'http://localhost/api/teacher/assignments/reorder',
      {
        method: 'POST',
        body: JSON.stringify({ classroom_id: classroomId, assignment_ids: [assignmentId, assignmentId] }),
      },
    ))
    expect(response.status).toBe(400)
    expect(reorderAssignmentsForOwner).not.toHaveBeenCalled()
  })
})
