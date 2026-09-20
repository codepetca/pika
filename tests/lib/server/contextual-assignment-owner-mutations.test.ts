import { describe, expect, it, vi } from 'vitest'

import {
  deleteAssignmentForOwner,
  discardPristineAssignmentDraftForOwner,
  releaseAssignmentForOwner,
  updateAssignmentForOwner,
} from '@/lib/server/contextual-assignment-owner-mutations'

const actorId = '11111111-1111-4111-8111-111111111111'
const assignmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const classroomId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const requirementId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function assignment() {
  return { id: assignmentId, classroom_id: classroomId, title: 'Updated' }
}

describe('contextual assignment owner mutation adapters', () => {
  it('binds an update and every returned requirement to the requested assignment', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        assignment: assignment(),
        submission_requirements: [{ id: requirementId, assignment_id: assignmentId }],
      },
      error: null,
    })

    await expect(updateAssignmentForOwner({
      supabase: { rpc },
      actorId,
      assignmentId,
      updates: { title: 'Updated' },
    })).resolves.toMatchObject({ ok: true, assignment: { id: assignmentId } })
    expect(rpc).toHaveBeenCalledWith('update_assignment_for_owner_v1', {
      p_actor_id: actorId,
      p_assignment_id: assignmentId,
      p_updates: { title: 'Updated' },
      p_requirements: null,
    })
  })

  it('fails closed when an update returns cross-assignment evidence', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        assignment: assignment(),
        submission_requirements: [{
          id: requirementId,
          assignment_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        }],
      },
      error: null,
    })
    await expect(updateAssignmentForOwner({
      supabase: { rpc }, actorId, assignmentId, updates: { title: 'Updated' },
    })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('propagates atomic business errors without collapsing their status', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ok: false,
        status: 409,
        error_code: 'assignment_requirements_submitted',
        error: 'Submission requirements cannot be changed after a student submits.',
      },
      error: null,
    })
    await expect(updateAssignmentForOwner({
      supabase: { rpc }, actorId, assignmentId, updates: {}, requirements: [],
    })).resolves.toMatchObject({ ok: false, status: 409 })
  })

  it('calls release, delete, and discard with the authenticated actor', async () => {
    const releaseRpc = vi.fn().mockResolvedValue({
      data: { ok: true, assignment: assignment() }, error: null,
    })
    await releaseAssignmentForOwner({
      supabase: { rpc: releaseRpc }, actorId, assignmentId,
      releasedAt: '2099-01-01T00:00:00.000Z', scheduled: true,
    })
    expect(releaseRpc).toHaveBeenCalledWith('release_assignment_for_owner_v1', expect.objectContaining({
      p_actor_id: actorId,
      p_assignment_id: assignmentId,
      p_scheduled: true,
    }))

    const deleteRpc = vi.fn().mockResolvedValue({
      data: { ok: true, classroom_id: classroomId, deleted: true }, error: null,
    })
    await expect(deleteAssignmentForOwner({
      supabase: { rpc: deleteRpc }, actorId, assignmentId,
    })).resolves.toEqual({ ok: true, classroomId })

    const discardRpc = vi.fn().mockResolvedValue({
      data: { discarded: false, assignment: assignment() }, error: null,
    })
    await expect(discardPristineAssignmentDraftForOwner({
      supabase: { rpc: discardRpc }, actorId, assignmentId,
      expectedUpdatedAt: '2026-09-20T12:00:00.000Z',
    })).resolves.toMatchObject({ discarded: false, assignment: { id: assignmentId } })
  })

  it.each([
    [{ code: 'P0002' }, 404],
    [{ code: '42501' }, 403],
    [{ code: '55000' }, 403],
    [{ code: '40001' }, 409],
    [{ code: '22023' }, 400],
    [{ code: 'XX000' }, 503],
  ] as const)('maps database error %s to HTTP %s', async (error, statusCode) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error })
    await expect(deleteAssignmentForOwner({
      supabase: { rpc }, actorId, assignmentId,
    })).rejects.toMatchObject({ statusCode })
  })
})
