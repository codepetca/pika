import { z } from 'zod'

export const assignmentIdSchema = z.string().uuid('assignment id must be a valid UUID')

export const assignmentStudentIdsRequestSchema = z.object({
  student_ids: z.array(z.string().uuid('student_ids must contain valid UUIDs'))
    .min(1, 'student_ids array is required')
    .max(100, 'Cannot process more than 100 students at once'),
}).transform(({ student_ids }) => ({
  studentIds: Array.from(new Set(student_ids)),
}))
