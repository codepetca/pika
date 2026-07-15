import { describe, expect, it } from 'vitest'
import {
  assignmentIdSchema,
  assignmentStudentIdsRequestSchema,
} from '@/lib/validations/assignment-identifiers'

const assignmentId = 'a0000000-0000-4000-8000-000000000001'
const studentId = 'b0000000-0000-4000-8000-000000000001'

describe('assignment identifier contracts', () => {
  it('accepts UUID assignment and student identifiers and deduplicates students', () => {
    expect(assignmentIdSchema.parse(assignmentId)).toBe(assignmentId)
    expect(assignmentStudentIdsRequestSchema.parse({
      student_ids: [studentId, studentId],
    })).toEqual({ studentIds: [studentId] })
  })

  it('rejects malformed assignment and student identifiers', () => {
    expect(assignmentIdSchema.safeParse('assignment-1').success).toBe(false)
    expect(assignmentStudentIdsRequestSchema.safeParse({
      student_ids: ['student-1'],
    }).success).toBe(false)
  })
})
