import { z } from 'zod'
import type { TiptapContent } from '@/types'

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
