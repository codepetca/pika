import { NextResponse } from 'next/server'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { createContextualTestOwnerWorkflow } from '@/lib/server/contextual-test-owner-workflow'
import { buildTestAttemptHistoryMetrics, normalizeTestResponses } from '@/lib/test-attempts'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import { ownerRecoveryParamsSchema, ownerRecoverySelectionSchema, ownerUnsubmitPlanSchema, ownerUnsubmitResultSchema,
  ownerSingleDeleteResultSchema, ownerBulkDeleteResultSchema } from '@/lib/validations/contextual-test-owner-recovery'
import { readContextualTestOwnerBody, resolveContextualTestOwnerParams, TEST_OWNER_WORKFLOW_DEADLINE_MS } from '@/lib/validations/contextual-test-owner-workflow'

const unavailable = () => new ApiError(503, 'Unable to verify test operation')
const sameIds = (left: string[], right: string[]) => left.length === right.length && new Set(left).size === left.length && left.every(id => right.includes(id))
type Operation = 'unsubmit' | 'delete-single' | 'delete-bulk'

/** Shared admission grants no authority. Each transaction proves current owner,
 * parent and membership. An admitted failure never returns to the legacy route. */
export async function handleContextualTestOwnerRecoveryRequest(operation: Operation, request: Request, params: Promise<unknown>): Promise<NextResponse | null> {
  if (!isClassroomExperienceAdmissionConfigured()) return null
  const actor = await requireAuth()
  if (resolveClassroomExperienceAdmission(actor).status !== 'admitted') return null
  const deadline = Date.now() + TEST_OWNER_WORKFLOW_DEADLINE_MS
  const identity = ownerRecoveryParamsSchema.parse(await resolveContextualTestOwnerParams(request, params, deadline))
  const payload = operation === 'delete-single' ? { student_ids: [ownerRecoveryParamsSchema.required().parse(identity).studentId] }
    : ownerRecoverySelectionSchema.parse(await readContextualTestOwnerBody(request, deadline))
  const flow = createContextualTestOwnerWorkflow({ supabase: getServiceRoleClient(), actorId: actor.id, testId: identity.id, deadline, signal: request.signal })
  await flow.inspect()
  if (operation === 'unsubmit') {
    const raw = (await flow.run('unsubmit-plan', payload)).result
    const parsed = ownerUnsubmitPlanSchema.safeParse(raw)
    if (!parsed.success || !boundedAssignmentListJson(raw, 1048576)) throw unavailable()
    const plan = parsed.data
    if (!sameIds(plan.student_ids, payload.student_ids) || new Set(plan.eligible_student_ids).size !== plan.eligible_student_ids.length
      || plan.eligible_student_ids.length === 0 || plan.eligible_student_ids.some(id => id === actor.id || !payload.student_ids.includes(id))
      || new Set(plan.attempts.map(row => row.id)).size !== plan.attempts.length
      || new Set(plan.attempts.map(row => row.student_id)).size !== plan.attempts.length
      || plan.attempts.some(row => !plan.eligible_student_ids.includes(row.student_id))) throw unavailable()
    const attempts = plan.attempts.map(row => {
      const snapshot = normalizeTestResponses(row.responses)
      return { ...row, snapshot, ...buildTestAttemptHistoryMetrics(snapshot) }
    })
    const result = ownerUnsubmitResultSchema.safeParse((await flow.run('unsubmit', { ...plan, attempts })).result)
    if (!result.success || !sameIds(result.data.student_ids, payload.student_ids)
      || result.data.unsubmitted_count !== plan.attempts.length
      || result.data.skipped_count !== payload.student_ids.length - plan.attempts.length
      || result.data.skipped_enrollment_count !== payload.student_ids.length - plan.eligible_student_ids.length
      || result.data.history_written_count > result.data.unsubmitted_count) throw unavailable()
    const { student_ids: _ids, history_written_count: _history, ...counts } = result.data
    return NextResponse.json(counts)
  }
  const raw = (await flow.run(operation, payload)).result
  const parsed = operation === 'delete-single' ? ownerSingleDeleteResultSchema.safeParse(raw) : ownerBulkDeleteResultSchema.safeParse(raw)
  if (!parsed.success || !sameIds(parsed.data.student_ids, payload.student_ids) || parsed.data.deleted_attempts > payload.student_ids.length) throw unavailable()
  const { student_ids: _ids, ...counts } = parsed.data
  if (operation === 'delete-bulk') {
    const bulk = ownerBulkDeleteResultSchema.parse(raw)
    if (bulk.requested_count !== payload.student_ids.length || bulk.deleted_student_count > bulk.requested_count
      || bulk.deleted_student_count < bulk.deleted_attempts
      || (bulk.deleted_student_count === 0) !== (bulk.deleted_attempts + bulk.deleted_responses + bulk.deleted_focus_events + bulk.deleted_ai_grading_items === 0)) throw unavailable()
    const { student_ids: _ids, ...bulkCounts } = bulk
    return NextResponse.json({ success: true, ...bulkCounts })
  }
  return NextResponse.json(counts)
}
