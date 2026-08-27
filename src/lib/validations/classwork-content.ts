import { z } from 'zod'

const isoTimestampSchema = z.string().datetime({ offset: true })

export const createSurveyRequestSchema = z.object({
  classroom_id: z.string().min(1),
  title: z.string().optional(),
  show_results: z.boolean().optional().default(true),
  dynamic_responses: z.boolean().optional().default(false),
  due_at: isoTimestampSchema.nullable().optional(),
  due_policy: z.enum(['soft', 'hard']).optional().default('soft'),
}).strict()

export const updateSurveyRequestSchema = z.object({
  title: z.string().optional(),
  status: z.enum(['draft', 'active', 'closed']).optional(),
  show_results: z.boolean().optional(),
  dynamic_responses: z.boolean().optional(),
  opens_at: isoTimestampSchema.nullable().optional(),
  due_at: isoTimestampSchema.nullable().optional(),
  due_policy: z.enum(['soft', 'hard']).optional(),
}).strict()

export const createMaterialRequestSchema = z.object({
  title: z.string(),
  content: z.unknown(),
  is_draft: z.boolean().optional().default(true),
  released_at: isoTimestampSchema.nullable().optional(),
}).strict()

export const updateMaterialRequestSchema = z.object({
  title: z.string().optional(),
  content: z.unknown().optional(),
  is_draft: z.boolean().optional(),
  released_at: isoTimestampSchema.nullable().optional(),
}).strict()
