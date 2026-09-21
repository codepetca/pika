import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  reorderAssignmentsForOwner,
  reorderClassworkForOwner,
} from '@/lib/server/contextual-classwork-reorder'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const assignmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const materialId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const rpc = vi.fn()
const supabase = { rpc }

function success(overrides: Record<string, unknown> = {}) {
  return { ok: true, actor_id: actorId, classroom_id: classroomId, ...overrides }
}

describe('contextual classwork reorder adapters', () => {
  beforeEach(() => rpc.mockReset())

  it('calls the owner-bound assignment reorder and validates its binding evidence', async () => {
    rpc.mockResolvedValue({ data: success(), error: null })
    await expect(reorderAssignmentsForOwner({
      supabase,
      actorId: actorId.toUpperCase(),
      classroomId: classroomId.toUpperCase(),
      assignmentIds: [assignmentId],
    })).resolves.toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('reorder_assignments_for_owner_v1', {
      p_actor_id: actorId,
      p_classroom_id: classroomId,
      p_assignment_ids: [assignmentId],
    })
  })

  it('calls the owner-bound mixed-classwork reorder', async () => {
    rpc.mockResolvedValue({ data: success(), error: null })
    const items = [
      { type: 'material' as const, id: materialId },
      { type: 'assignment' as const, id: assignmentId },
    ]
    await expect(reorderClassworkForOwner({
      supabase, actorId, classroomId, items,
    })).resolves.toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('reorder_classwork_items_for_owner_v1', {
      p_actor_id: actorId,
      p_classroom_id: classroomId,
      p_items: items,
    })
  })

  it.each([
    success({ actor_id: '22222222-2222-4222-8222-222222222222' }),
    success({ classroom_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }),
    { ok: true },
  ])('rejects substituted or incomplete result evidence', async (data) => {
    rpc.mockResolvedValue({ data, error: null })
    await expect(reorderAssignmentsForOwner({
      supabase, actorId, classroomId, assignmentIds: [assignmentId],
    })).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    ['P0002', 'Classroom not found', 404],
    ['42501', 'Forbidden', 403],
    ['55000', 'classwork_reorder_archived', 403],
    ['P0001', 'Assignment list changed. Refresh and try again.', 409],
    ['P0001', 'One or more assignments not found in classroom', 400],
    ['22023', 'assignment_ids must be an array', 400],
    ['XX000', 'database unavailable', 503],
  ])('maps database error %s/%s to HTTP %s', async (code, message, statusCode) => {
    rpc.mockResolvedValue({ data: null, error: { code, message } })
    await expect(reorderAssignmentsForOwner({
      supabase, actorId, classroomId, assignmentIds: [assignmentId],
    })).rejects.toMatchObject({ statusCode })
  })
})
