import { z } from 'zod'

/**
 * POST /api/teacher/classrooms
 */
export const createClassroomSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  classCode: z.string().optional(),
  termLabel: z.string().optional(),
})
