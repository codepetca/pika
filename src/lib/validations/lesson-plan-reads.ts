import { z } from 'zod'
import { lessonPlanDateSchema } from '@/lib/validations/lesson-plan-mutations'

export const lessonPlanReadQuerySchema = z.object({
  classroomId: z.string().uuid(),
  start: lessonPlanDateSchema,
  end: lessonPlanDateSchema,
}).strict().superRefine(({ start, end }, context) => {
  if (start > end) {
    context.addIssue({ code: 'custom', path: ['end'], message: 'end must be on or after start' })
  }
})

const uuid = z.string().uuid().transform(value => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true })

export const lessonPlanReadClassroomEnvelopeSchema = z.object({
  data: z.object({ id: uuid, teacher_id: uuid, archived_at: timestamp.nullable() }).nullable(),
  error: z.null(),
})

export const lessonPlanReadEnrollmentEnvelopeSchema = z.object({
  data: z.object({ classroom_id: uuid, student_id: uuid }).nullable(),
  error: z.null(),
})

export const lessonPlanReadVisibilitySchema = z.enum(['current_week', 'one_week_ahead', 'all']).nullable()
export const lessonPlanReadPlanSchema = z.object({
  id: uuid, classroom_id: uuid, date: lessonPlanDateSchema,
  content: z.unknown().refine(value => value !== null && value !== undefined),
  content_markdown: z.string().nullable(),
  created_at: timestamp, updated_at: timestamp,
  artifact_id: uuid, source_artifact_id: uuid.nullable(),
  source_blueprint_version_id: uuid.nullable(), blueprint_archived_at: timestamp.nullable(),
})
export const lessonPlanReadMembershipSchema = z.array(z.object({ classroom_id: uuid, student_id: uuid })).min(1)
const rootSchema = z.object({
  id: uuid, teacher_id: uuid, archived_at: timestamp.nullable(),
  lesson_plan_visibility: lessonPlanReadVisibilitySchema,
  plans: z.array(lessonPlanReadPlanSchema).max(1000),
})
export const lessonPlanReadOwnerEnvelopeSchema = z.object({ data: rootSchema.nullable(), error: z.null() })
export const lessonPlanReadMemberEnvelopeSchema = z.object({
  data: rootSchema.extend({ membership: lessonPlanReadMembershipSchema }).nullable(),
  error: z.null(),
})
