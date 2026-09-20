import { describe, expect, it, vi } from 'vitest'

import { saveAssignmentGradesForOwner } from '@/lib/server/assignment-grades'

const actorId = '11111111-1111-4111-8111-111111111111'
const assignmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const studentOne = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const studentTwo = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
const revision = '2026-09-20T18:00:00.000Z'
const grade = {
  score_completion: 7,
  score_thinking: 8,
  score_workflow: 9,
  feedback: 'Strong work',
  save_mode: 'graded' as const,
  shouldMarkGraded: true,
  apply_target: 'grade-and-comments' as const,
}

function doc(studentId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `doc-${studentId}`,
    assignment_id: assignmentId,
    student_id: studentId,
    updated_at: revision,
    score_completion: 7,
    score_thinking: 8,
    score_workflow: 9,
    teacher_feedback_draft: 'Strong work',
    teacher_feedback_draft_updated_at: revision,
    graded_at: revision,
    graded_by: 'teacher',
    ...overrides,
  }
}

function input(rpc: ReturnType<typeof vi.fn>, studentIds = [studentOne]) {
  return {
    supabase: { rpc } as never,
    assignmentId,
    actorId,
    studentIds,
    expectedDocUpdatedAtByStudent: Object.fromEntries(studentIds.map((id) => [id, revision])),
    grade,
  }
}

describe('saveAssignmentGradesForOwner', () => {
  it('calls the fenced owner RPC and returns exact bound documents', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { docs: [doc(studentOne), doc(studentTwo)] },
      error: null,
    })

    await expect(saveAssignmentGradesForOwner(input(rpc, [studentOne, studentTwo])))
      .resolves.toHaveLength(2)
    expect(rpc).toHaveBeenCalledWith('save_assignment_grades_for_owner_v1', expect.objectContaining({
      p_actor_id: actorId,
      p_assignment_id: assignmentId,
      p_student_ids: [studentOne, studentTwo],
      p_mark_graded: true,
    }))
  })

  it.each([
    { docs: [doc(studentOne, { assignment_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })] },
    { docs: [doc(studentTwo)] },
    { docs: [doc(studentOne), doc(studentOne)] },
    { docs: [{ student_id: studentOne }] },
  ])('rejects substituted or malformed result evidence', async (data) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null })
    await expect(saveAssignmentGradesForOwner(input(rpc))).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    ['P0002', 404],
    ['42501', 403],
    ['55000', 409],
    ['40001', 409],
    ['55P03', 409],
    ['22023', 400],
    ['XX000', 503],
  ])('maps database error %s to HTTP %s', async (code, statusCode) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code, message: 'Database error' } })
    await expect(saveAssignmentGradesForOwner(input(rpc))).rejects.toMatchObject({ statusCode })
  })

  it('maps only the wrapper archive sentinel to the stable archived denial', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '55000', message: 'assignment_grading_archived' },
    })
    await expect(saveAssignmentGradesForOwner(input(rpc))).rejects.toMatchObject({
      statusCode: 403,
      message: 'Assignment is archived',
    })
  })
})
