import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler, apiErrors } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  assertTeacherOwnsAssignment,
  loadLatestCompletedRepoReviewRun,
  loadLatestRepoReviewRun,
  loadRepoReviewResults,
} from '@/lib/server/repo-review'

export const POST = withErrorHandler('ApplyTeacherAssignmentRepoReview', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const assignment = await assertTeacherOwnsAssignment(user.id, id)

  if ((assignment.evaluation_mode ?? 'document') !== 'repo_review') {
    throw apiErrors.badRequest('Assignment is not configured for repo review')
  }

  const [latestRun, latestCompletedRun] = await Promise.all([
    loadLatestRepoReviewRun(id),
    loadLatestCompletedRepoReviewRun(id),
  ])

  if (!latestCompletedRun) {
    throw apiErrors.badRequest('A completed repo review run is required before applying results')
  }

  const results = await loadRepoReviewResults(latestCompletedRun.id)
  const supabase = getServiceRoleClient()
  const studentIds = results.map((result) => result.student_id)
  const { data: existingDocs, error: docsError } = studentIds.length > 0
    ? await supabase
        .from('assignment_docs')
        .select('student_id')
        .eq('assignment_id', id)
        .in('student_id', studentIds)
    : { data: [] as Array<{ student_id: string }>, error: null }

  if (docsError) {
    throw apiErrors.conflict('Failed to load existing assignment docs')
  }

  const existingStudentIds = new Set((existingDocs || []).map((doc) => doc.student_id))
  const rows = results
    .filter((result) =>
      result.draft_score_completion != null
      && result.draft_score_thinking != null
      && result.draft_score_workflow != null
    )
    .map((result) => {
      const row: Record<string, unknown> = {
        assignment_id: id,
        student_id: result.student_id,
        score_completion: result.draft_score_completion,
        score_thinking: result.draft_score_thinking,
        score_workflow: result.draft_score_workflow,
        feedback: result.draft_feedback,
        graded_at: null,
        graded_by: null,
      }

      if (!existingStudentIds.has(result.student_id)) {
        row.content = { type: 'doc', content: [] }
        row.is_submitted = false
      }

      return row
    })

  if (rows.length === 0) {
    throw apiErrors.badRequest('No provisional repo review scores are available to apply')
  }

  const { error } = await supabase
    .from('assignment_docs')
    .upsert(rows, { onConflict: 'assignment_id,student_id' })

  if (error) {
    throw apiErrors.conflict('Failed to apply provisional repo review grades')
  }

  return NextResponse.json({
    applied_count: rows.length,
    run_id: latestCompletedRun.id,
    latest_run_id: latestRun?.id || null,
  })
})
