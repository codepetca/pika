import { describe, expect, it } from 'vitest'
import {
  saveAssignmentGradeSchema,
  saveSelectedAssignmentGradesSchema,
} from '@/lib/validations/assignment-grading'

describe('assignment grading request contracts', () => {
  it('normalizes a final single-student grade', () => {
    expect(saveAssignmentGradeSchema.parse({
      student_id: 'b0000000-0000-4000-8000-000000000001',
      score_completion: '7',
      score_thinking: 8,
      score_workflow: 9,
      feedback: 'Strong work',
    })).toEqual({
      studentId: 'b0000000-0000-4000-8000-000000000001',
      grade: {
        score_completion: 7,
        score_thinking: 8,
        score_workflow: 9,
        feedback: 'Strong work',
        save_mode: 'graded',
        shouldMarkGraded: true,
        apply_target: 'grade-and-comments',
      },
    })
  })

  it('ignores the batch-only apply target for a single-student grade', () => {
    expect(saveAssignmentGradeSchema.parse({
      student_id: 'b0000000-0000-4000-8000-000000000001',
      score_completion: 7,
      score_thinking: 8,
      score_workflow: 9,
      feedback: 'Strong work',
      apply_target: 'comments',
    }).grade).toMatchObject({
      score_completion: 7,
      score_thinking: 8,
      score_workflow: 9,
      feedback: 'Strong work',
      apply_target: 'grade-and-comments',
    })
  })

  it('preserves an explicit single-document revision', () => {
    expect(saveAssignmentGradeSchema.parse({
      student_id: 'b0000000-0000-4000-8000-000000000001',
      expected_doc_updated_at: '2026-04-10T12:00:00Z',
      score_completion: 7,
      score_thinking: 8,
      score_workflow: 9,
      feedback: 'Strong work',
    })).toMatchObject({
      studentId: 'b0000000-0000-4000-8000-000000000001',
      expectedDocUpdatedAt: '2026-04-10T12:00:00Z',
    })
  })

  it('rejects an invalid single-document revision', () => {
    const result = saveAssignmentGradeSchema.safeParse({
      student_id: 'b0000000-0000-4000-8000-000000000001',
      expected_doc_updated_at: 'yesterday',
      score_completion: 7,
      score_thinking: 8,
      score_workflow: 9,
      feedback: 'Strong work',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'expected_doc_updated_at must be an ISO timestamp or null',
      )
    }
  })

  it('deduplicates selected students and preserves comments-only semantics', () => {
    expect(saveSelectedAssignmentGradesSchema.parse({
      student_ids: ['b0000000-0000-4000-8000-000000000001', 42, 'b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002'],
      apply_target: 'comments',
      feedback: 'Shared comment',
    })).toEqual({
      studentIds: ['b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002'],
      grade: {
        score_completion: null,
        score_thinking: null,
        score_workflow: null,
        feedback: 'Shared comment',
        save_mode: 'graded',
        shouldMarkGraded: true,
        apply_target: 'comments',
      },
    })
  })

  it('preserves selected-document revisions', () => {
    expect(saveSelectedAssignmentGradesSchema.parse({
      student_ids: ['b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002'],
      expected_doc_updated_at_by_student: {
        'b0000000-0000-4000-8000-000000000001': '2026-04-10T12:00:00Z',
        'b0000000-0000-4000-8000-000000000002': null,
      },
      apply_target: 'comments',
      feedback: 'Shared comment',
    })).toMatchObject({
      expectedDocUpdatedAtByStudent: {
        'b0000000-0000-4000-8000-000000000001': '2026-04-10T12:00:00Z',
        'b0000000-0000-4000-8000-000000000002': null,
      },
    })
  })

  it('rejects invalid selected-document revisions', () => {
    const result = saveSelectedAssignmentGradesSchema.safeParse({
      student_ids: ['b0000000-0000-4000-8000-000000000001'],
      expected_doc_updated_at_by_student: { 'b0000000-0000-4000-8000-000000000001': 'yesterday' },
      apply_target: 'comments',
      feedback: 'Shared comment',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'expected document revisions must be ISO timestamps or null',
      )
    }
  })

  it('normalizes blank draft scores without marking the grade complete', () => {
    expect(saveAssignmentGradeSchema.parse({
      student_id: 'b0000000-0000-4000-8000-000000000001',
      score_completion: 6,
      score_thinking: '',
      score_workflow: null,
      feedback: 'Draft feedback',
      save_mode: 'draft',
    }).grade).toMatchObject({
      score_completion: 6,
      score_thinking: null,
      score_workflow: null,
      save_mode: 'draft',
      shouldMarkGraded: false,
    })
  })

  it.each([
    [{ feedback: 'Missing student' }, 'student_id is required'],
    [{ student_id: 'b0000000-0000-4000-8000-000000000001', feedback: 'Missing scores' }, 'score_completion must be an integer 0–10'],
  ])('preserves the existing validation error for %j', (input, message) => {
    const result = saveAssignmentGradeSchema.safeParse(input)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toBe(message)
  })

  it('rejects an invalid batch apply target', () => {
    const result = saveSelectedAssignmentGradesSchema.safeParse({
      student_ids: ['b0000000-0000-4000-8000-000000000001'],
      score_completion: 1,
      score_thinking: 2,
      score_workflow: 3,
      feedback: 'Feedback',
      apply_target: 'invalid',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'apply_target must be "grade", "comments", or "grade-and-comments"',
      )
    }
  })

  it.each([null, [], 'invalid', 1])(
    'preserves the selected-grade error for non-object input %j',
    (input) => {
      const result = saveSelectedAssignmentGradesSchema.safeParse(input)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('student_ids array is required')
      }
    },
  )

  it.each([[], 'invalid', 1])(
    'preserves the single-grade error for non-object input %j',
    (input) => {
      const result = saveAssignmentGradeSchema.safeParse(input)
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.issues[0]?.message).toBe('student_id is required')
    },
  )
})
