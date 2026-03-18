import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler, apiErrors } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { calculateAssignmentStatus } from '@/lib/assignments'
import {
  assertTeacherOwnsAssignment,
  loadLatestCompletedRepoReviewRun,
  loadLatestRepoReviewRun,
  loadRepoReviewConfig,
  loadRepoReviewResults,
  loadRepoReviewRosterStudents,
} from '@/lib/server/repo-review'
import type { AssignmentRepoReviewResult, RepoReviewTimelinePoint } from '@/types'

function aggregateTimeline(results: AssignmentRepoReviewResult[]): RepoReviewTimelinePoint[] {
  const byDate = new Map<string, RepoReviewTimelinePoint>()
  for (const result of results) {
    for (const point of result.timeline_json || []) {
      const existing = byDate.get(point.date) || { date: point.date, weighted_contribution: 0, commit_count: 0 }
      existing.weighted_contribution += Number(point.weighted_contribution || 0)
      existing.commit_count += Number(point.commit_count || 0)
      byDate.set(point.date, existing)
    }
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date))
}

export const GET = withErrorHandler('GetTeacherAssignmentRepoReview', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const assignment = await assertTeacherOwnsAssignment(user.id, id)

  if ((assignment.evaluation_mode ?? 'document') !== 'repo_review') {
    throw apiErrors.badRequest('Assignment is not configured for repo review')
  }

  const [config, rosterStudents, latestRun, latestCompletedRun] = await Promise.all([
    loadRepoReviewConfig(id),
    loadRepoReviewRosterStudents(assignment.classroom_id),
    loadLatestRepoReviewRun(id),
    loadLatestCompletedRepoReviewRun(id),
  ])

  const resultsRun = latestCompletedRun || latestRun
  const latestResults = resultsRun ? await loadRepoReviewResults(resultsRun.id) : []
  const resultsByStudent = new Map(latestResults.map((result) => [result.student_id, result]))

  const supabase = getServiceRoleClient()
  const studentIds = rosterStudents.map((student) => student.student_id)
  const { data: docs } = studentIds.length > 0
    ? await supabase
        .from('assignment_docs')
        .select('student_id, submitted_at, updated_at, score_completion, score_thinking, score_workflow, graded_at, returned_at, is_submitted')
        .eq('assignment_id', id)
        .in('student_id', studentIds)
    : { data: [] as Array<any> }

  const docsByStudent = new Map((docs || []).map((doc) => [doc.student_id, doc]))
  const teamTimeline = aggregateTimeline(latestResults)
  const confidence = latestResults.length > 0
    ? latestResults.reduce((sum, result) => sum + Number(result.confidence || 0), 0) / latestResults.length
    : 0

  return NextResponse.json({
    assignment: {
      ...assignment,
      evaluation_mode: assignment.evaluation_mode ?? 'document',
    },
    classroom: assignment.classrooms,
    config,
    latest_run: latestRun,
    latest_completed_run: latestCompletedRun,
    summary: {
      confidence,
      team_timeline: teamTimeline,
      contribution_total: latestResults.reduce((sum, result) => sum + Number(result.weighted_contribution || 0), 0),
      warnings: latestRun?.warnings_json || latestCompletedRun?.warnings_json || [],
    },
    students: rosterStudents.map((student) => {
      const doc = docsByStudent.get(student.student_id) || null
      const result = resultsByStudent.get(student.student_id) || null
      return {
        student_id: student.student_id,
        student_email: student.student_email,
        student_name: student.student_name,
        github_login: student.github_identity?.github_login || null,
        commit_emails: student.github_identity?.commit_emails || [],
        status: calculateAssignmentStatus(assignment, doc),
        doc,
        result,
      }
    }),
  })
})
