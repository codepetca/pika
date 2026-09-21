import { z } from 'zod'

import { assignmentSubmissionContentSchema } from '@/lib/validations/assignment-doc-submissions'

export const contextualMaterialCreateSchema = z.object({
  title: z.string().trim().min(1).max(500),
  content: assignmentSubmissionContentSchema,
  is_draft: z.boolean().optional().default(true),
}).strict()

export const contextualSurveyCreateSchema = z.object({
  classroom_id: z.string().uuid(),
  title: z.string().max(500).optional(),
  show_results: z.boolean().optional().default(true),
  dynamic_responses: z.boolean().optional().default(false),
}).strict()
