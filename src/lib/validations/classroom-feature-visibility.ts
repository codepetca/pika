import { z } from 'zod'

export const classroomFeatureVisibilitySchema = z.object({
  attendance: z.boolean(),
  classwork: z.boolean(),
  tests: z.boolean(),
  gradebook: z.boolean(),
  calendar: z.boolean(),
  syllabus: z.boolean(),
  announcements: z.boolean(),
  achievements: z.boolean(),
}).strict()
