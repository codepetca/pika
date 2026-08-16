import { z } from 'zod'
import type { TiptapContent } from '@/types'

export const lessonPlanMutationVersionSchema = z.object({
  client_id: z.string().uuid(),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict()

export type LessonPlanMutationVersion = z.infer<typeof lessonPlanMutationVersionSchema>

const tiptapContentSchema = z.custom<TiptapContent>((value) => (
  typeof value === 'object' &&
  value !== null &&
  (value as { type?: unknown }).type === 'doc' &&
  (
    (value as { content?: unknown }).content === undefined ||
    Array.isArray((value as { content?: unknown }).content)
  )
), 'Invalid content format')

export const lessonPlanMutationBodySchema = z.object({
  content_markdown: z.string().optional(),
  content: tiptapContentSchema.optional(),
  mutation: lessonPlanMutationVersionSchema.optional(),
}).strict().superRefine((value, context) => {
  if (typeof value.content_markdown !== 'string' && !value.content) {
    context.addIssue({
      code: 'custom',
      message: 'Invalid content format',
      path: ['content'],
    })
  }
})

const bulkLessonPlanEntrySchema = z.object({
  date: z.string(),
  content_markdown: z.string().optional(),
  content: tiptapContentSchema.optional(),
}).strict()

export const bulkLessonPlanMutationBodySchema = z.object({
  plans: z.array(bulkLessonPlanEntrySchema).max(250, 'Too many plans. Maximum is 250 per request.').default([]),
  cleared_dates: z.array(z.string()).max(250, 'Too many plans. Maximum is 250 per request.').default([]),
  mutation: lessonPlanMutationVersionSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.plans.length === 0 && value.cleared_dates.length === 0) {
    context.addIssue({
      code: 'custom',
      message: 'plans or cleared_dates is required and must not be empty',
    })
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}$/
  const seenDates = new Set<string>()
  for (const [index, plan] of value.plans.entries()) {
    if (!datePattern.test(plan.date)) {
      context.addIssue({ code: 'custom', message: `Invalid date format: ${plan.date}`, path: ['plans', index, 'date'] })
    }
    if (seenDates.has(plan.date)) {
      context.addIssue({ code: 'custom', message: `Duplicate date: ${plan.date}`, path: ['plans', index, 'date'] })
    }
    seenDates.add(plan.date)
    if (typeof plan.content_markdown !== 'string' && !plan.content) {
      context.addIssue({ code: 'custom', message: `Invalid content for date ${plan.date}`, path: ['plans', index] })
    }
  }

  for (const [index, date] of value.cleared_dates.entries()) {
    if (!datePattern.test(date)) {
      context.addIssue({ code: 'custom', message: `Invalid date format: ${date}`, path: ['cleared_dates', index] })
    }
    if (seenDates.has(date)) {
      context.addIssue({ code: 'custom', message: `Duplicate date: ${date}`, path: ['cleared_dates', index] })
    }
    seenDates.add(date)
  }
})
