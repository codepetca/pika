import { z } from 'zod'
import { postDateSchema } from '@/lib/validations/post-date'

import { materialScheduledForSchema, validateMaterialPublication } from '@/lib/validations/material-scheduling'
import { assignmentSubmissionContentSchema } from '@/lib/validations/assignment-doc-submissions'

export const contextualMaterialCreateSchema = z.object({
  title: z.string().trim().min(1).max(500),
  content: assignmentSubmissionContentSchema,
  is_draft: z.boolean().optional().default(true),
  scheduled_for: materialScheduledForSchema.optional(),
  posted_on: postDateSchema.optional(),
}).strict().superRefine(validateMaterialPublication)

export const contextualSurveyCreateSchema = z.object({
  classroom_id: z.string().uuid(),
  title: z.string().max(500).optional(),
  show_results: z.boolean().optional().default(true),
  dynamic_responses: z.boolean().optional().default(false),
}).strict()
