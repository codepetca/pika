import { beforeEach, describe, expect, it, vi } from 'vitest'

import { saveAssignmentsBulkForOwner } from '@/lib/server/contextual-assignment-bulk'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const assignmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const createdId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const rpc = vi.fn()
const supabase = { rpc }
const baseInput = {
  title: 'One',
  dueAt: '2026-09-30T20:00:00.000Z',
  instructionsMarkdown: 'Read this',
  description: 'Read this',
  richInstructions: { type: 'doc', content: [] },
  isDraft: true,
}

function assignment(id: string, createdBy = actorId) {
  return { id, classroom_id: classroomId, created_by: createdBy }
}

describe('contextual Assignment bulk adapter', () => {
  beforeEach(() => rpc.mockReset())

  it('calls the owner-bound RPC and verifies created and updated result bindings', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        actor_id: actorId,
        classroom_id: classroomId,
        created: 1,
        updated: 1,
        assignments: [assignment(createdId), assignment(assignmentId, '22222222-2222-4222-8222-222222222222')],
      },
      error: null,
    })

    await expect(saveAssignmentsBulkForOwner({
      supabase,
      actorId: actorId.toUpperCase(),
      classroomId: classroomId.toUpperCase(),
      assignments: [baseInput, { ...baseInput, id: assignmentId, title: 'Two' }],
    })).resolves.toMatchObject({ ok: true, created: 1, updated: 1 })

    expect(rpc).toHaveBeenCalledWith('save_assignments_bulk_for_owner_v1', {
      p_actor_id: actorId,
      p_classroom_id: classroomId,
      p_assignments: [
        {
          title: 'One',
          due_at: baseInput.dueAt,
          instructions_markdown: 'Read this',
          description: 'Read this',
          rich_instructions: baseInput.richInstructions,
          is_draft: true,
        },
        expect.objectContaining({ id: assignmentId, title: 'Two' }),
      ],
    })
  })

  it('preserves legacy validation errors returned by the atomic RPC', async () => {
    rpc.mockResolvedValue({
      data: { ok: false, status: 400, errors: [`Assignment ID not found: ${assignmentId}`] },
      error: null,
    })
    await expect(saveAssignmentsBulkForOwner({
      supabase,
      actorId,
      classroomId,
      assignments: [{ ...baseInput, id: assignmentId }],
    })).resolves.toEqual({ ok: false, errors: [`Assignment ID not found: ${assignmentId}`] })
  })

  it.each([
    { actor_id: '22222222-2222-4222-8222-222222222222' },
    { classroom_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
    { assignments: [{ ...assignment(createdId), classroom_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }] },
    { created: 0 },
  ])('rejects substituted or incomplete result evidence', async (override) => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        actor_id: actorId,
        classroom_id: classroomId,
        created: 1,
        updated: 0,
        assignments: [assignment(createdId)],
        ...override,
      },
      error: null,
    })
    await expect(saveAssignmentsBulkForOwner({
      supabase, actorId, classroomId, assignments: [baseInput],
    })).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    ['P0002', 'Classroom not found', 404],
    ['42501', 'Forbidden', 403],
    ['55000', 'assignment_bulk_archived', 403],
    ['40001', 'Assignment binding changed', 409],
    ['22023', 'Invalid assignment bulk request', 400],
    ['XX000', 'database unavailable', 503],
  ])('maps database error %s/%s to HTTP %s', async (code, message, statusCode) => {
    rpc.mockResolvedValue({ data: null, error: { code, message } })
    await expect(saveAssignmentsBulkForOwner({
      supabase, actorId, classroomId, assignments: [baseInput],
    })).rejects.toMatchObject({ statusCode })
  })
})
