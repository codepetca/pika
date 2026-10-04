import { z } from 'zod'

export const surveyResponseSchema = z.object({
  responses: z.record(z.string(), z.unknown()),
})

export const surveyPatchSchema = z.object({
  title: z.string().trim().min(1, 'Title cannot be empty').optional(),
  status: z.enum(['draft', 'active', 'closed']).optional(),
  show_results: z.boolean().optional(),
  dynamic_responses: z.boolean().optional(),
  opens_at: z.string().refine((value) => !Number.isNaN(new Date(value).getTime()), 'Invalid open date').nullable().optional(),
})

export const surveyCreateSchema = z.object({
  classroom_id: z.string().min(1, 'classroom_id is required'),
  title: z.string().optional(),
  show_results: z.boolean().optional().default(true),
  dynamic_responses: z.boolean().optional().default(false),
})

// Shape validation precedes the canonical domain normalizer, which owns option
// counts, question-type constraints and text limits. PATCH remains partial.
export const surveyQuestionSchema = z.object({
  question_type: z.string().optional(),
  question_text: z.string().optional(),
  options: z.array(z.string()).optional(),
  response_max_chars: z.number().finite().optional(),
  position: z.number().finite().optional(),
})
