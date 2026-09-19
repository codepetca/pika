import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openContextualAssignmentDoc } from '@/lib/server/contextual-assignment-doc-open'
import { buildLearningItemViewedEvent } from '@/lib/server/pal-events'

const actorId = '11111111-1111-4111-8111-111111111111'
const assignmentId = '22222222-2222-4222-8222-222222222222'
const classroomId = '33333333-3333-4333-8333-333333333333'
const docId = '44444444-4444-4444-8444-444444444444'
const viewedAt = '2026-09-19T18:00:00.000Z'
const rpc = vi.fn()
const result = {
  ok: true,
  created: true,
  viewed_at_changed: true,
  assignment: {
    id: assignmentId,
    classroom_id: classroomId,
    is_draft: false,
    created_at: '2026-09-01T12:00:00.000Z',
    released_at: '2026-09-19T12:00:00.000Z',
  },
  doc: {
    id: docId,
    assignment_id: assignmentId,
    student_id: actorId,
    viewed_at: viewedAt,
  },
}

describe('contextual assignment document open', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpc.mockResolvedValue({ data: result, error: null })
  })

  it('binds trusted actor and assignment identity to the transactional RPC', async () => {
    const event = buildLearningItemViewedEvent({
      learnerId: actorId,
      itemId: assignmentId,
      occurredAt: new Date(viewedAt),
      releasedAt: result.assignment.released_at,
      pseudonymSecret: 'test-pseudonym-secret-at-least-32-chars',
    })
    await expect(openContextualAssignmentDoc({
      supabase: { rpc }, actorId, assignmentId, viewedAt, event,
    })).resolves.toEqual(result)
    expect(rpc).toHaveBeenCalledWith('open_assignment_doc_for_member_v1', {
      p_actor_id: actorId,
      p_assignment_id: assignmentId,
      p_viewed_at: viewedAt,
      p_pal_event: event,
    })
  })

  it.each([
    ['P0002', 404],
    ['42501', 403],
    ['22023', 400],
    ['22007', 400],
    ['40001', 409],
    ['PGRST202', 503],
    ['42883', 503],
    ['08006', 503],
  ])('maps RPC %s to %i without leaking database details', async (code, statusCode) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'private database detail' } })
    const operation = openContextualAssignmentDoc({
      supabase: { rpc }, actorId, assignmentId, viewedAt, event: null,
    })
    await expect(operation).rejects.toMatchObject({ statusCode })
    await expect(operation).rejects.not.toThrow('private database detail')
  })

  it.each([
    null,
    { ...result, ok: false },
    { ...result, assignment: { ...result.assignment, id: docId } },
    { ...result, assignment: { ...result.assignment, is_draft: true } },
    { ...result, doc: { ...result.doc, assignment_id: docId } },
    { ...result, doc: { ...result.doc, student_id: docId } },
    { ...result, created: true, viewed_at_changed: false },
    { ...result, doc: { ...result.doc, viewed_at: '2026-09-19T18:00:01.000Z' } },
    { ...result, unexpected: true },
  ])('fails closed on invalid database evidence %#', async (data) => {
    rpc.mockResolvedValue({ data, error: null })
    await expect(openContextualAssignmentDoc({
      supabase: { rpc }, actorId, assignmentId, viewedAt, event: null,
    })).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    { actorId: 'not-a-uuid', assignmentId, viewedAt },
    { actorId, assignmentId: 'not-a-uuid', viewedAt },
    { actorId, assignmentId, viewedAt: 'not-a-time' },
  ])('rejects malformed trusted inputs before the RPC %#', async (invalid) => {
    await expect(openContextualAssignmentDoc({
      supabase: { rpc }, ...invalid, event: null,
    })).rejects.toMatchObject({ statusCode: 400 })
    expect(rpc).not.toHaveBeenCalled()
  })
})
