import { z } from 'zod'

/**
 * POST /api/teacher/classrooms
 */
export const createClassroomSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  classCode: z.string().optional(),
  termLabel: z.string().optional(),
  blueprintId: z.string().uuid().optional(),
})

export const createCourseBlueprintSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  subject: z.string().optional().default(''),
  grade_level: z.string().optional().default(''),
  course_code: z.string().optional().default(''),
  term_template: z.string().optional().default(''),
})

export const updateCourseBlueprintSchema = z.object({
  title: z.string().min(1, 'Title is required').optional(),
  subject: z.string().optional(),
  grade_level: z.string().optional(),
  course_code: z.string().optional(),
  term_template: z.string().optional(),
  overview_markdown: z.string().optional(),
  outline_markdown: z.string().optional(),
  resources_markdown: z.string().optional(),
  position: z.number().int().optional(),
})

export const createClassroomFromBlueprintSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  classCode: z.string().optional(),
  termLabel: z.string().optional(),
  semester: z.enum(['semester1', 'semester2']).optional(),
  year: z.number().int().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export const courseBlueprintAiSuggestSchema = z.object({
  target: z.enum(['analyze', 'overview', 'outline', 'resources', 'assignments', 'quizzes', 'tests', 'lesson-plans']),
  prompt: z.string().optional().default(''),
})

export const courseBlueprintAiApplySchema = z.object({
  target: z.enum(['overview', 'outline', 'resources', 'assignments', 'quizzes', 'tests', 'lesson-plans']),
  content: z.string(),
})
