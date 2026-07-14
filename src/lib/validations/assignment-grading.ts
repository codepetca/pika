import { z } from 'zod'

export type AssignmentGradeSaveMode = 'draft' | 'graded'
export type AssignmentGradeApplyTarget = 'grade' | 'comments' | 'grade-and-comments'

export interface ParsedAssignmentGradePayload {
  score_completion: number | null
  score_thinking: number | null
  score_workflow: number | null
  feedback: string
  save_mode: AssignmentGradeSaveMode
  shouldMarkGraded: boolean
  apply_target: AssignmentGradeApplyTarget
}

const assignmentGradeFieldsSchema = z.object({
  score_completion: z.unknown().optional(),
  score_thinking: z.unknown().optional(),
  score_workflow: z.unknown().optional(),
  feedback: z.unknown().optional(),
  save_mode: z.unknown().optional(),
})

const selectedAssignmentGradeFieldsSchema = assignmentGradeFieldsSchema.extend({
  apply_target: z.unknown().optional(),
})
const timestampSchema = z.string().datetime({ offset: true })
const uuidSchema = z.string().uuid()

function normalizeRequestObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function addIssue(ctx: z.RefinementCtx, message: string): null {
  ctx.addIssue({ code: 'custom', message })
  return null
}

function parseDraftScore(value: unknown): number | null | typeof Number.NaN {
  if (value === '' || value === null || value === undefined) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10) return Number.NaN
  return parsed
}

function normalizeStudentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(value.filter((studentId): studentId is string => typeof studentId === 'string')),
  )
}

function parseGradeFields(
  body: z.infer<typeof selectedAssignmentGradeFieldsSchema>,
  ctx: z.RefinementCtx,
): ParsedAssignmentGradePayload | null {
  const applyTarget = body.apply_target === undefined
    ? 'grade-and-comments'
    : body.apply_target
  if (applyTarget !== 'grade' && applyTarget !== 'comments' && applyTarget !== 'grade-and-comments') {
    return addIssue(ctx, 'apply_target must be "grade", "comments", or "grade-and-comments"')
  }

  const shouldApplyGrade = applyTarget === 'grade' || applyTarget === 'grade-and-comments'
  const shouldApplyComments = applyTarget === 'comments' || applyTarget === 'grade-and-comments'

  let feedback = ''
  if (shouldApplyComments) {
    if (typeof body.feedback !== 'string') {
      return addIssue(ctx, 'feedback must be a string')
    }
    feedback = body.feedback
  }

  if (body.save_mode !== undefined && body.save_mode !== 'draft' && body.save_mode !== 'graded') {
    return addIssue(ctx, 'save_mode must be "draft" or "graded"')
  }

  const saveMode: AssignmentGradeSaveMode = body.save_mode === 'draft' ? 'draft' : 'graded'
  const shouldMarkGraded = saveMode === 'graded'
  const parseScore = (value: unknown) => shouldMarkGraded ? Number(value) : parseDraftScore(value)
  const scores = {
    score_completion: shouldApplyGrade ? parseScore(body.score_completion) : null,
    score_thinking: shouldApplyGrade ? parseScore(body.score_thinking) : null,
    score_workflow: shouldApplyGrade ? parseScore(body.score_workflow) : null,
  }

  if (shouldApplyGrade) {
    for (const [name, value] of Object.entries(scores)) {
      if (shouldMarkGraded) {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10) {
          return addIssue(ctx, `${name} must be an integer 0–10`)
        }
        continue
      }

      if (Number.isNaN(value)) {
        return addIssue(ctx, `${name} must be blank or an integer 0–10`)
      }
    }
  }

  return {
    ...scores,
    feedback,
    save_mode: saveMode,
    shouldMarkGraded,
    apply_target: applyTarget,
  }
}

export const saveAssignmentGradeSchema = z.preprocess(
  normalizeRequestObject,
  assignmentGradeFieldsSchema.extend({
    student_id: z.unknown().optional(),
    expected_doc_updated_at: z.unknown().optional(),
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

  const grade = parseGradeFields(body, ctx)
  if (!grade) return z.NEVER

  const rawExpectedDocUpdatedAt = body.expected_doc_updated_at
  if (
    rawExpectedDocUpdatedAt !== undefined
    && rawExpectedDocUpdatedAt !== null
    && !timestampSchema.safeParse(rawExpectedDocUpdatedAt).success
  ) {
    addIssue(ctx, 'expected_doc_updated_at must be an ISO timestamp or null')
    return z.NEVER
  }
  const expectedDocUpdatedAt = rawExpectedDocUpdatedAt as string | null | undefined

  return {
    studentId: body.student_id,
    ...(expectedDocUpdatedAt === undefined ? {} : { expectedDocUpdatedAt }),
    grade,
  }
})

export const saveSelectedAssignmentGradesSchema = z.preprocess(
  normalizeRequestObject,
  selectedAssignmentGradeFieldsSchema.extend({
    student_ids: z.unknown().optional(),
    expected_doc_updated_at_by_student: z.unknown().optional(),
  }),
).transform((body, ctx) => {
  const studentIds = normalizeStudentIds(body.student_ids)
  if (studentIds.length === 0) {
    addIssue(ctx, 'student_ids array is required')
    return z.NEVER
  }
  if (studentIds.length > 100) {
    addIssue(ctx, 'Cannot grade more than 100 students at once')
    return z.NEVER
  }
  if (studentIds.some((studentId) => !uuidSchema.safeParse(studentId).success)) {
    addIssue(ctx, 'student_ids must contain valid UUIDs')
    return z.NEVER
  }

  const grade = parseGradeFields(body, ctx)
  if (!grade) return z.NEVER

  const rawExpected = body.expected_doc_updated_at_by_student
  const expectedDocUpdatedAtByStudent: Record<string, string | null> = {}
  if (rawExpected !== undefined) {
    if (!rawExpected || typeof rawExpected !== 'object' || Array.isArray(rawExpected)) {
      addIssue(ctx, 'expected_doc_updated_at_by_student must be an object')
      return z.NEVER
    }

    for (const studentId of studentIds) {
      if (!Object.prototype.hasOwnProperty.call(rawExpected, studentId)) continue
      const value = (rawExpected as Record<string, unknown>)[studentId]
      if (value !== null && !timestampSchema.safeParse(value).success) {
        addIssue(ctx, 'expected document revisions must be ISO timestamps or null')
        return z.NEVER
      }
      expectedDocUpdatedAtByStudent[studentId] = value as string | null
    }
  }

  return {
    studentIds,
    ...(rawExpected === undefined ? {} : { expectedDocUpdatedAtByStudent }),
    grade,
  }
})

const assignmentGradeDocSchema = z.object({
  id: z.string().min(1),
  assignment_id: z.string().min(1),
  student_id: z.string().min(1),
  updated_at: timestampSchema,
  score_completion: z.number().int().min(0).max(10).nullable(),
  score_thinking: z.number().int().min(0).max(10).nullable(),
  score_workflow: z.number().int().min(0).max(10).nullable(),
  teacher_feedback_draft: z.string().nullable(),
  teacher_feedback_draft_updated_at: timestampSchema.nullable(),
  graded_at: timestampSchema.nullable(),
  graded_by: z.string().nullable(),
}).passthrough()

export const assignmentGradeSaveResultSchema = z.object({
  docs: z.array(assignmentGradeDocSchema),
})
