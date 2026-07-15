import { describe, expect, it } from 'vitest'
import {
  assignmentFeedbackReturnResultSchema,
  assignmentReturnResultSchema,
  returnAssignmentFeedbackSchema,
  returnAssignmentsSchema,
} from '@/lib/validations/assignment-returns'

const studentId = '10000000-0000-4000-8000-000000000001'
const assignmentId = '20000000-0000-4000-8000-000000000001'
const docId = '30000000-0000-4000-8000-000000000001'
const entryId = '40000000-0000-4000-8000-000000000001'
const teacherId = '50000000-0000-4000-8000-000000000001'
const now = '2026-07-14T12:00:00.000Z'

describe('assignment return request contracts', () => {
  it('normalizes an explicit feedback return without changing the student id', () => {
    expect(returnAssignmentFeedbackSchema.parse({
      student_id: studentId,
      feedback: '  Ready to review  ',
      expected_doc_updated_at: now,
    })).toEqual({
      studentId,
      feedback: 'Ready to review',
      expectedDocUpdatedAt: now,
    })
  })

  it('leaves null feedback absent so the stored draft can be used', () => {
    expect(returnAssignmentFeedbackSchema.parse({
      student_id: studentId,
      feedback: null,
      expected_doc_updated_at: now,
    })).toEqual({
      studentId,
      feedback: undefined,
      expectedDocUpdatedAt: now,
    })
  })

  it.each([42, {}, []])('rejects malformed feedback %j', (feedback) => {
    expect(returnAssignmentFeedbackSchema.safeParse({
      student_id: studentId,
      feedback,
      expected_doc_updated_at: now,
    }).success).toBe(false)
  })

  it('requires the client document revision and accepts null for a missing document', () => {
    expect(returnAssignmentFeedbackSchema.safeParse({
      student_id: studentId,
    }).success).toBe(false)
    expect(returnAssignmentFeedbackSchema.parse({
      student_id: studentId,
      expected_doc_updated_at: null,
    }).expectedDocUpdatedAt).toBeNull()
  })

  it.each([{}, null, [], 'invalid', 1])(
    'preserves the missing student error for feedback input %j',
    (input) => {
      const result = returnAssignmentFeedbackSchema.safeParse(input)
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.issues[0]?.message).toBe('student_id is required')
    },
  )

  it('preserves selected student order while filtering invalid values and duplicates', () => {
    const student2 = '10000000-0000-4000-8000-000000000002'
    expect(returnAssignmentsSchema.parse({
      student_ids: [studentId, 42, studentId, student2],
    })).toEqual({
      studentIds: [studentId, student2],
    })
  })

  it.each([{}, null, [], 'invalid', { student_ids: [] }])(
    'preserves the missing student array error for return input %j',
    (input) => {
      const result = returnAssignmentsSchema.safeParse(input)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('student_ids array is required')
      }
    },
  )

  it('preserves the maximum batch size error', () => {
    const result = returnAssignmentsSchema.safeParse({
      student_ids: Array.from({ length: 101 }, (_, index) => `student-${index}`),
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'Cannot return more than 100 students at once',
      )
    }
  })

  it('rejects a batch without any string student ids', () => {
    const result = returnAssignmentsSchema.safeParse({
      student_ids: [42],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('student_ids array is required')
    }
  })

  it('rejects malformed UUIDs before database access', () => {
    const feedbackResult = returnAssignmentFeedbackSchema.safeParse({ student_id: 'student-1' })
    const batchResult = returnAssignmentsSchema.safeParse({ student_ids: [studentId, 'student-2'] })

    expect(feedbackResult.success).toBe(false)
    if (!feedbackResult.success) {
      expect(feedbackResult.error.issues[0]?.message).toBe('student_id must be a valid UUID')
    }
    expect(batchResult.success).toBe(false)
    if (!batchResult.success) {
      expect(batchResult.error.issues[0]?.message).toBe('student_ids must contain valid UUIDs')
    }
  })

  it('accepts the complete atomic batch result contract', () => {
    expect(assignmentReturnResultSchema.parse({
      returned_count: 1,
      cleared_count: 1,
      updated_count: 1,
      created_count: 0,
      created_student_ids: [],
      returned_student_ids: [studentId],
      blocked_count: 0,
      blocked_student_ids: [],
      already_returned_count: 0,
      already_returned_student_ids: [],
      missing_count: 0,
      missing_student_ids: [],
      not_enrolled_count: 0,
      not_enrolled_student_ids: [],
      mailbox_tracking_available: true,
    })).toEqual(expect.objectContaining({ returned_student_ids: [studentId] }))
  })

  it('requires both document and history shapes from an applied feedback result', () => {
    expect(assignmentFeedbackReturnResultSchema.safeParse({
      applied: true,
      doc: {
        id: docId,
        assignment_id: assignmentId,
        student_id: studentId,
        updated_at: now,
        feedback: 'Feedback',
        teacher_feedback_draft: null,
        feedback_returned_at: now,
      },
      entry: {
        id: entryId,
        assignment_id: assignmentId,
        student_id: studentId,
        entry_kind: 'teacher_feedback',
        author_type: 'teacher',
        body: 'Feedback',
        returned_at: now,
        created_at: now,
        created_by: teacherId,
      },
    }).success).toBe(true)
    expect(assignmentFeedbackReturnResultSchema.safeParse({
      applied: true,
      doc: {},
      entry: null,
    }).success).toBe(false)
  })
})
