import { z } from 'zod'
const uuid = z.string().uuid().transform(value => value.toLowerCase())
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const ids = z.array(uuid).max(100)
export const ownerRecoveryParamsSchema = z.object({ id: uuid, studentId: uuid.optional() }).strict()
export const ownerRecoverySelectionSchema = z.object({ student_ids: ids.min(1).transform(values => [...new Set(values)]) }).strict()
const attempt = z.object({ id: uuid, student_id: uuid, draft_revision: count.positive(), responses: z.json() }).strict()
export const ownerUnsubmitPlanSchema = z.object({ student_ids: ids, eligible_student_ids: ids, attempts: z.array(attempt).max(100) }).strict()
export const ownerUnsubmitResultSchema = z.object({ student_ids: ids, unsubmitted_count: count.max(100), skipped_count: count.max(100),
  skipped_enrollment_count: count.max(100), history_written_count: count.max(100) }).strict()
export const ownerSingleDeleteResultSchema = z.object({ student_ids: ids, deleted_attempts: count.max(100), deleted_responses: count.max(10000),
  deleted_focus_events: count.max(10000), deleted_ai_grading_items: count.max(10000) }).strict()
export const ownerBulkDeleteResultSchema = ownerSingleDeleteResultSchema.extend({ requested_count: count.max(100), deleted_student_count: count.max(100) }).strict()
