import { z } from 'zod'

export const teacherClassroomQrQuerySchema = z.object({
  classroom_id: z.string().uuid(),
}).strict()

export const rotateTeacherClassroomQrSchema = z.object({
  classroom_id: z.string().uuid(),
  expected_generation: z.number().int().safe().positive(),
}).strict()
