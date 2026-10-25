import { ApiError } from '@/lib/api-error'
import { repoLightImportResultSchema, type ImportRepoLightRequest, type RepoLightTarget } from '@/lib/validations/repolight'
import { repoLightDatabase, repoLightRpc, readAssignmentRepoLightRun, type RepoLightDependencies } from './assignment-repolight-runs'

export async function importAssignmentRepoLightFeedback(actorId: string, target: RepoLightTarget, runId: string, input: ImportRepoLightRequest, deps: RepoLightDependencies = {}) {
  const row = await readAssignmentRepoLightRun(actorId, target, runId, false, deps)
  if (row.detached) throw new ApiError(409, 'repolight_detached_read_only')
  const result = repoLightImportResultSchema.safeParse(await repoLightRpc(repoLightDatabase(deps).importFeedback({ p_actor_id: actorId, p_assignment_id: target.assignmentId, p_student_id: target.studentId, p_run_id: runId,
    p_request_id: input.requestId, p_scope_key: input.scopeKey, p_expected_doc_updated_at: input.expectedDocUpdatedAt,
    p_expected_report_digest: input.expectedReportDigest, p_feedback_text: input.feedbackText ?? null })))
  if (!result.success) throw new ApiError(503, 'repolight_invalid_storage')
  if (result.data.doc.assignment_id !== target.assignmentId || result.data.doc.student_id !== target.studentId) throw new ApiError(403, 'Forbidden')
  return result.data
}
