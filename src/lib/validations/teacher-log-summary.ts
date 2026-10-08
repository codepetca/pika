import { z } from 'zod'

const uuid = z.string().uuid().transform((value) => value.toLowerCase())
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const timestamp = z.string().datetime({ offset: true })
const nonblank = z.string().refine((value) => value.trim().length > 0)

export const teacherLogSummaryQuerySchema = z.object({
  classroomId: uuid,
  date,
})

export const teacherLogSummaryClassroomSchema = z.object({
  id: uuid,
  teacher_id: uuid,
  archived_at: timestamp.nullable(),
})

export const teacherLogSummaryStatSchema = z.object({
  classroom_id: uuid,
  date,
  updated_at: timestamp,
  classroom: z.object({ id: uuid, teacher_id: uuid }),
})

export const teacherLogSummaryCacheSchema = z.object({
  id: uuid,
  classroom_id: uuid,
  date,
  summary_items: z.unknown(),
  initials_map: z.unknown(),
  entry_count: z.number().int().nonnegative().safe(),
  entries_updated_at: timestamp.nullable(),
  generated_at: timestamp,
  classroom: z.object({ id: uuid, teacher_id: uuid }),
})

export const teacherLogSummaryCurrentItemsSchema = z.object({
  overview: z.string(),
  action_items: z.array(z.object({
    text: z.string(),
    initials: nonblank,
    detail: z.string().trim().min(1).max(240),
  })),
})

export const teacherLogSummaryInitialsMapSchema = z.record(nonblank, nonblank)

export const teacherLogSummaryPreflightResultSchema = z.object({
  data: teacherLogSummaryClassroomSchema.nullable(),
  error: z.null(),
})

export const teacherLogSummaryStatsResultSchema = z.object({
  data: z.array(teacherLogSummaryStatSchema).max(1),
  error: z.null(),
})

export const teacherLogSummaryCountResultSchema = z.object({
  data: z.null(),
  count: z.number().int().nonnegative().safe(),
  error: z.null(),
})

export const teacherLogSummaryCacheResultSchema = z.object({
  data: teacherLogSummaryCacheSchema.nullable(),
  error: z.null(),
})
