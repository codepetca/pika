import { z } from 'zod'

export const classroomFeatureVisibilitySchema = z.object({
  attendance: z.boolean(),
  classwork: z.boolean(),
  tests: z.boolean(),
  gradebook: z.boolean(),
  student_grades: z.boolean(),
  gradebook_hide_zero_weight_student: z.boolean().optional(),
  calendar: z.boolean(),
  syllabus: z.boolean(),
  announcements: z.boolean(),
  achievements: z.boolean(),
}).strict()
