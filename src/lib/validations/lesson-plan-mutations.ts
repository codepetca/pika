import { z } from 'zod'
import type { TiptapContent } from '@/types'
import { isValidTiptapContent } from '@/lib/tiptap-content'

export const lessonPlanMutationVersionSchema = z.object({
  client_id: z.string().uuid(),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict()

export type LessonPlanMutationVersion = z.infer<typeof lessonPlanMutationVersionSchema>

function isRealCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1 || month < 1 || month > 12 || day < 1) return false

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= daysInMonth[month - 1]
}

export const lessonPlanDateSchema = z.string().superRefine((value, context) => {
  if (!isRealCalendarDate(value)) {
    context.addIssue({ code: 'custom', message: `Invalid date format: ${value}` })
  }
})

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())

export const contextualLessonPlanDateParamsSchema = z.object({
  id: canonicalUuid,
  date: lessonPlanDateSchema,
}).strict()

export const contextualLessonPlanBulkParamsSchema = z.object({
  id: canonicalUuid,
}).strict()

export const contextualLessonPlanRowSchema = z.object({
  id: canonicalUuid,
  classroom_id: canonicalUuid,
  date: lessonPlanDateSchema,
  content: z.custom<TiptapContent>(isValidTiptapContent),
  content_markdown: z.string().nullable(),
  artifact_id: canonicalUuid,
  source_artifact_id: canonicalUuid.nullable(),
  source_blueprint_version_id: canonicalUuid.nullable(),
  blueprint_archived_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
}).strict()

export const contextualLessonPlanRpcResultSchema = z.object({
  applied: z.boolean(),
  lesson_plan: contextualLessonPlanRowSchema.nullable(),
}).strict()

const sdkResponseMetadata = {
  count: z.number().nullable().optional(),
  status: z.number().int().optional(),
  statusText: z.string().optional(),
}

export const contextualLessonPlanRpcEnvelopeSchema = z.union([
  z.object({
    data: contextualLessonPlanRpcResultSchema,
    error: z.null(),
    ...sdkResponseMetadata,
  }).strict(),
  z.object({
    data: z.null(),
    error: z.object({
      code: z.string(),
      message: z.string().nullable().optional(),
      details: z.string().nullable().optional(),
      hint: z.string().nullable().optional(),
    }).strict(),
    ...sdkResponseMetadata,
  }).strict(),
])

export const contextualLessonPlanBulkResultSchema = z.object({
  date: lessonPlanDateSchema,
  operation: z.enum(['upsert', 'clear']),
  applied: z.boolean(),
  lesson_plan: contextualLessonPlanRowSchema.nullable(),
}).strict()

export const contextualLessonPlanBulkRpcEnvelopeSchema = z.union([
  z.object({
    data: z.object({ results: z.array(contextualLessonPlanBulkResultSchema) }).strict(),
    error: z.null(),
    ...sdkResponseMetadata,
  }).strict(),
  z.object({
    data: z.null(),
    error: z.object({
      code: z.string(),
      message: z.string().nullable().optional(),
      details: z.string().nullable().optional(),
      hint: z.string().nullable().optional(),
    }).strict(),
    ...sdkResponseMetadata,
  }).strict(),
])

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
  date: lessonPlanDateSchema,
  content_markdown: z.string().optional(),
  content: tiptapContentSchema.optional(),
}).strict()

export const bulkLessonPlanMutationBodySchema = z.object({
  plans: z.array(bulkLessonPlanEntrySchema).max(250, 'Too many plans. Maximum is 250 per request.').default([]),
  cleared_dates: z.array(lessonPlanDateSchema).max(250, 'Too many plans. Maximum is 250 per request.').default([]),
  mutation: lessonPlanMutationVersionSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.plans.length === 0 && value.cleared_dates.length === 0) {
    context.addIssue({
      code: 'custom',
      message: 'plans or cleared_dates is required and must not be empty',
    })
  }

  const seenDates = new Set<string>()
  for (const [index, plan] of value.plans.entries()) {
    if (seenDates.has(plan.date)) {
      context.addIssue({ code: 'custom', message: `Duplicate date: ${plan.date}`, path: ['plans', index, 'date'] })
    }
    seenDates.add(plan.date)
    if (typeof plan.content_markdown !== 'string' && !plan.content) {
      context.addIssue({ code: 'custom', message: `Invalid content for date ${plan.date}`, path: ['plans', index] })
    }
  }

  for (const [index, date] of value.cleared_dates.entries()) {
    if (seenDates.has(date)) {
      context.addIssue({ code: 'custom', message: `Duplicate date: ${date}`, path: ['cleared_dates', index] })
    }
    seenDates.add(date)
  }
})
