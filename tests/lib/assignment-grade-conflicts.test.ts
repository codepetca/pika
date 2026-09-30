import { describe, expect, it, vi } from 'vitest'
import { saveAssignmentGradesAtomic, saveAssignmentGradesForOwner } from '@/lib/server/assignment-grades'

const studentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'

describe('Assignment manual grading conflict compatibility', () => {
  it.each(['40001', 'PT409'])('returns one conflict without retrying %s on both grading boundaries', async (code) => {
    for (const contextual of [false, true]) {
      const rpc = vi.fn().mockResolvedValue({ data: null, error: { code, message: 'Assignment grade changed; reload and retry' } })
      const common = {
        supabase: { rpc } as never,
        assignmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        studentIds: [studentId],
        expectedDocUpdatedAtByStudent: { [studentId]: '2026-09-30T16:00:00Z' },
        grade: {
          apply_target: 'grade-and-comments',
          score_completion: 7,
          score_thinking: 8,
          score_workflow: 9,
          feedback: 'Feedback',
          save_mode: 'graded',
          shouldMarkGraded: true,
        } as const,
      }
      const operation = contextual
        ? saveAssignmentGradesForOwner({ ...common, actorId: 'teacher' })
        : saveAssignmentGradesAtomic({ ...common, teacherId: 'teacher' })

      await expect(operation).rejects.toMatchObject({ statusCode: 409, message: 'Assignment grade changed; reload and retry' })
      expect(rpc).toHaveBeenCalledTimes(1)
      expect(rpc).toHaveBeenCalledWith(contextual ? 'save_assignment_grades_for_owner_v1' : 'save_assignment_grades_atomic', expect.any(Object))
    }
  })
})
