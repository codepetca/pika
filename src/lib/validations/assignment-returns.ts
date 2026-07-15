import { z } from 'zod'

function normalizeRequestObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function addIssue(ctx: z.RefinementCtx, message: string): void {
  ctx.addIssue({ code: 'custom', message })
}

const uuidSchema = z.string().uuid()
const requestRevisionSchema = z.string().datetime({ offset: true }).nullable()

export const returnAssignmentFeedbackSchema = z.preprocess(
  normalizeRequestObject,
  z.object({
    student_id: z.unknown().optional(),
    feedback: z.string().nullable().optional(),
    expected_doc_updated_at: requestRevisionSchema.optional(),
  }),
).transform((body, ctx) => {
  if (!body.student_id || typeof body.student_id !== 'string') {
    addIssue(ctx, 'student_id is required')
    return z.NEVER
  }
  if (!uuidSchema.safeParse(body.student_id).success) {
    addIssue(ctx, 'student_id must be a valid UUID')
    return z.NEVER
  }
  if (body.expected_doc_updated_at === undefined) {
    addIssue(ctx, 'expected_doc_updated_at is required')
    return z.NEVER
  }

  return {
    studentId: body.student_id,
    feedback: typeof body.feedback === 'string' ? body.feedback.trim() : undefined,
    expectedDocUpdatedAt: body.expected_doc_updated_at,
  }
})

export const returnAssignmentsSchema = z.preprocess(
  normalizeRequestObject,
  z.object({
    student_ids: z.unknown().optional(),
  }),
).transform((body, ctx) => {
  if (!Array.isArray(body.student_ids) || body.student_ids.length === 0) {
    addIssue(ctx, 'student_ids array is required')
    return z.NEVER
  }

  if (body.student_ids.length > 100) {
    addIssue(ctx, 'Cannot return more than 100 students at once')
    return z.NEVER
  }

  const studentIds = Array.from(
    new Set(body.student_ids.filter((studentId): studentId is string => typeof studentId === 'string')),
  )
  if (studentIds.length === 0) {
    addIssue(ctx, 'student_ids array is required')
    return z.NEVER
  }
  if (studentIds.some((studentId) => !uuidSchema.safeParse(studentId).success)) {
    addIssue(ctx, 'student_ids must contain valid UUIDs')
    return z.NEVER
  }

  return { studentIds }
})

const uuidArraySchema = z.array(uuidSchema)
const nullableTimestampSchema = requestRevisionSchema
const assignmentDocReturnRowSchema = z.object({
  id: uuidSchema,
  assignment_id: uuidSchema,
  student_id: uuidSchema,
  updated_at: z.string().datetime({ offset: true }),
  feedback: z.string().nullable(),
  teacher_feedback_draft: z.string().nullable(),
  feedback_returned_at: nullableTimestampSchema,
}).passthrough()
const assignmentFeedbackEntryRowSchema = z.object({
  id: uuidSchema,
  assignment_id: uuidSchema,
  student_id: uuidSchema,
  entry_kind: z.enum(['teacher_feedback', 'grading_feedback']),
  author_type: z.enum(['teacher', 'ai']),
  body: z.string(),
  returned_at: z.string().datetime({ offset: true }),
  created_at: z.string().datetime({ offset: true }),
  created_by: uuidSchema.nullable(),
}).passthrough()

export const assignmentFeedbackReturnResultSchema = z.discriminatedUnion('applied', [
  z.object({
    applied: z.literal(true),
    doc: assignmentDocReturnRowSchema,
    entry: assignmentFeedbackEntryRowSchema,
    created_doc: z.boolean().optional(),
  }),
  z.object({
    applied: z.literal(false),
    doc: assignmentDocReturnRowSchema.nullable(),
    entry: z.null(),
  }),
])

export const assignmentReturnResultSchema = z.object({
  returned_count: z.number().int().nonnegative(),
  cleared_count: z.number().int().nonnegative(),
  updated_count: z.number().int().nonnegative(),
  created_count: z.number().int().nonnegative(),
  created_student_ids: uuidArraySchema,
  returned_student_ids: uuidArraySchema,
  blocked_count: z.number().int().nonnegative(),
  blocked_student_ids: uuidArraySchema,
  already_returned_count: z.number().int().nonnegative(),
  already_returned_student_ids: uuidArraySchema,
  missing_count: z.number().int().nonnegative(),
  missing_student_ids: uuidArraySchema,
  not_enrolled_count: z.number().int().nonnegative(),
  not_enrolled_student_ids: uuidArraySchema,
  mailbox_tracking_available: z.boolean(),
})

export type AssignmentReturnResult = z.infer<typeof assignmentReturnResultSchema>
