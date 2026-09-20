import { beforeEach, describe, expect, it, vi } from 'vitest'

import { returnAssignmentFeedbackForOwner, returnAssignmentsForOwner } from '@/lib/server/assignment-returns'
import { getServiceRoleClient } from '@/lib/supabase'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))

const actorId = '11111111-1111-4111-8111-111111111111'
const assignmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const studentOne = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const studentTwo = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
const now = '2026-09-20T20:00:00.000Z'
const rpc = vi.fn()

function feedbackResult(overrides: Record<string, unknown> = {}) {
  return {
    applied: true,
    doc: {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', assignment_id: assignmentId,
      student_id: studentOne, updated_at: now, feedback: 'Good',
      teacher_feedback_draft: null, feedback_returned_at: now,
    },
    entry: {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', assignment_id: assignmentId,
      student_id: studentOne, entry_kind: 'teacher_feedback', author_type: 'teacher',
      body: 'Good', returned_at: now, created_at: now, created_by: actorId,
    },
    ...overrides,
  }
}

function batchResult(overrides: Record<string, unknown> = {}) {
  return {
    returned_count: 1, cleared_count: 1, updated_count: 1, created_count: 0,
    created_student_ids: [], returned_student_ids: [studentOne],
    blocked_count: 0, blocked_student_ids: [], already_returned_count: 0,
    already_returned_student_ids: [], missing_count: 1, missing_student_ids: [studentTwo],
    not_enrolled_count: 1, not_enrolled_student_ids: [studentTwo], mailbox_tracking_available: true,
    ...overrides,
  }
}

beforeEach(() => {
  rpc.mockReset()
  vi.mocked(getServiceRoleClient).mockReturnValue({ rpc } as never)
})

describe('contextual assignment feedback return adapters', () => {
  it('binds a feedback-only result to the exact assignment, learner and owner', async () => {
    rpc.mockResolvedValue({ data: feedbackResult(), error: null })
    await expect(returnAssignmentFeedbackForOwner({
      actorId, assignmentId, studentId: studentOne, feedback: 'Good', expectedDocUpdatedAt: now,
    })).resolves.toMatchObject({ doc: { student_id: studentOne } })
    expect(rpc).toHaveBeenCalledWith('return_assignment_feedback_for_owner_v1', expect.objectContaining({
      p_actor_id: actorId, p_assignment_id: assignmentId, p_student_id: studentOne,
    }))
  })

  it.each([
    feedbackResult({ doc: { ...feedbackResult().doc, assignment_id: studentTwo } }),
    feedbackResult({ entry: { ...feedbackResult().entry, created_by: studentTwo } }),
    feedbackResult({ entry: { ...feedbackResult().entry, returned_at: '2026-09-20T21:00:00.000Z' } }),
    feedbackResult({ entry: { ...feedbackResult().entry, body: 'Contradictory feedback' } }),
  ])('rejects substituted feedback-only evidence', async (data) => {
    rpc.mockResolvedValue({ data, error: null })
    await expect(returnAssignmentFeedbackForOwner({
      actorId, assignmentId, studentId: studentOne, expectedDocUpdatedAt: now,
    })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('accepts an exact batch partition and rejects extra or inconsistent students', async () => {
    rpc.mockResolvedValueOnce({ data: batchResult(), error: null })
    await expect(returnAssignmentsForOwner({ actorId, assignmentId, studentIds: [studentOne, studentTwo] }))
      .resolves.toMatchObject({ returned_count: 1, missing_count: 1 })
    rpc.mockResolvedValueOnce({ data: batchResult({ returned_student_ids: [studentOne, actorId] }), error: null })
    await expect(returnAssignmentsForOwner({ actorId, assignmentId, studentIds: [studentOne, studentTwo] }))
      .rejects.toMatchObject({ statusCode: 503 })
  })

  it('rejects duplicate created-student evidence', async () => {
    rpc.mockResolvedValue({
      data: batchResult({
        returned_count: 2,
        cleared_count: 2,
        updated_count: 0,
        created_count: 2,
        created_student_ids: [studentOne, studentOne],
        returned_student_ids: [studentOne, studentTwo],
        missing_count: 0,
        missing_student_ids: [],
        not_enrolled_count: 0,
        not_enrolled_student_ids: [],
      }),
      error: null,
    })

    await expect(returnAssignmentsForOwner({ actorId, assignmentId, studentIds: [studentOne, studentTwo] }))
      .rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([['P0002', 404], ['42501', 403], ['55000', 409], ['40001', 409], ['22023', 400], ['XX000', 503]])(
    'maps database error %s to HTTP %s',
    async (code, statusCode) => {
      rpc.mockResolvedValue({ data: null, error: { code, message: 'Database error' } })
      await expect(returnAssignmentsForOwner({ actorId, assignmentId, studentIds: [studentOne] }))
        .rejects.toMatchObject({ statusCode })
    },
  )

  it('reserves the archived denial for the exact wrapper sentinel', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '55000', message: 'assignment_feedback_return_archived' } })
    await expect(returnAssignmentsForOwner({ actorId, assignmentId, studentIds: [studentOne] }))
      .rejects.toMatchObject({ statusCode: 403, message: 'Assignment is archived' })
  })
})
