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
  }),
).transform((body, ctx) => {
  if (!body.student_id || typeof body.student_id !== 'string') {
    addIssue(ctx, 'student_id is required')
    return z.NEVER
  }

  const grade = parseGradeFields(body, ctx)
  if (!grade) return z.NEVER

  return { studentId: body.student_id, grade }
})

export const saveSelectedAssignmentGradesSchema = z.preprocess(
  normalizeRequestObject,
  selectedAssignmentGradeFieldsSchema.extend({
    student_ids: z.unknown().optional(),
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

  const grade = parseGradeFields(body, ctx)
  if (!grade) return z.NEVER

  return { studentIds, grade }
})
