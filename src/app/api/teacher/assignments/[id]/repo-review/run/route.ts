import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler, apiErrors } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { analyzeRepoReviewAssignment, buildRepoReviewWindow, formatRepoReviewRepoName } from '@/lib/repo-review'
import { gradeRepoReviewFeedback } from '@/lib/repo-review-ai'
import {
  assertTeacherOwnsAssignment,
  loadRepoReviewConfig,
  loadRepoReviewRosterStudents,
} from '@/lib/server/repo-review'

export const POST = withErrorHandler('RunTeacherAssignmentRepoReview', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const assignment = await assertTeacherOwnsAssignment(user.id, id)

  if ((assignment.evaluation_mode ?? 'document') !== 'repo_review') {
    throw apiErrors.badRequest('Assignment is not configured for repo review')
  }

  const [config, rosterStudents] = await Promise.all([
    loadRepoReviewConfig(id),
    loadRepoReviewRosterStudents(assignment.classroom_id),
  ])

  if (!config) {
    throw apiErrors.badRequest('Repo review config is missing')
  }

  const identities = rosterStudents.map((student) => ({
    studentId: student.student_id,
    email: student.student_email,
    name: student.student_name,
    githubLogin: student.github_identity?.github_login || null,
    commitEmails: student.github_identity?.commit_emails?.length
      ? student.github_identity.commit_emails
      : [student.student_email],
  }))

  const supabase = getServiceRoleClient()
  const { data: run, error: runError } = await supabase
    .from('assignment_repo_review_runs')
    .insert({
      assignment_id: id,
      status: 'running',
      triggered_by: user.id,
      started_at: new Date().toISOString(),
      source_ref: config.default_branch,
      metrics_version: 'v1',
      prompt_version: 'v1',
      warnings_json: [],
    })
    .select()
    .single()

  if (runError || !run) {
    throw apiErrors.conflict('Failed to start repo review run')
  }

  const reviewWindow = buildRepoReviewWindow({
    dueAt: assignment.due_at,
    releasedAt: assignment.released_at,
    reviewStartAt: config.review_start_at,
    reviewEndAt: config.review_end_at,
  })

  try {
    const analysis = await analyzeRepoReviewAssignment({
      config,
      identities,
      reviewWindow,
    })

    const runWarnings = [...analysis.warnings]
    for (const identity of identities) {
      if (!identity.githubLogin && identity.commitEmails.length === 0) {
        runWarnings.push({
          code: 'missing-identity',
          message: `No GitHub mapping is set for ${identity.name || identity.email}.`,
          student_id: identity.studentId,
        })
      }
    }

    const repoName = formatRepoReviewRepoName(config)
    const results = await Promise.all(
      analysis.students.map(async (student) => {
        const rosterStudent = rosterStudents.find((item) => item.student_id === student.studentId)
        const feedback = await gradeRepoReviewFeedback({
          assignmentTitle: assignment.title,
          repoName,
          studentName: rosterStudent?.student_name || rosterStudent?.student_email || 'Student',
          githubLogin: student.githubLogin,
          commitCount: student.commitCount,
          activeDays: student.activeDays,
          sessionCount: student.sessionCount,
          burstRatio: student.burstRatio,
          weightedContribution: student.weightedContribution,
          relativeContributionShare: student.relativeContributionShare,
          spreadScore: student.spreadScore,
          iterationScore: student.iterationScore,
          reviewActivityCount: student.reviewActivityCount,
          areas: student.areas,
          semanticBreakdown: student.semanticBreakdown,
          evidence: student.evidence,
          warnings: runWarnings
            .filter((warning) => !warning.student_id || warning.student_id === student.studentId)
            .map((warning) => warning.message),
          confidence: analysis.confidence,
        })

        return {
          run_id: run.id,
          assignment_id: id,
          student_id: student.studentId,
          github_login: student.githubLogin,
          commit_count: student.commitCount,
          active_days: student.activeDays,
          session_count: student.sessionCount,
          burst_ratio: student.burstRatio,
          weighted_contribution: student.weightedContribution,
          relative_contribution_share: student.relativeContributionShare,
          spread_score: student.spreadScore,
          iteration_score: student.iterationScore,
          semantic_breakdown_json: student.semanticBreakdown,
          timeline_json: student.timeline,
          evidence_json: student.evidence,
          draft_score_completion: feedback.score_completion,
          draft_score_thinking: feedback.score_thinking,
          draft_score_workflow: feedback.score_workflow,
          draft_feedback: feedback.feedback,
          confidence: Math.min(1, Math.max(0, (feedback.confidence + analysis.confidence) / 2)),
        }
      })
    )

    const { error: resultsError } = await supabase
      .from('assignment_repo_review_results')
      .insert(results)

    if (resultsError) {
      throw apiErrors.conflict('Failed to save repo review results')
    }

    const { data: completedRun, error: completeError } = await supabase
      .from('assignment_repo_review_runs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        source_ref: analysis.sourceRef || config.default_branch,
        model: 'repo-review-v1',
        warnings_json: runWarnings,
      })
      .eq('id', run.id)
      .select()
      .single()

    if (completeError || !completedRun) {
      throw apiErrors.conflict('Failed to finalize repo review run')
    }

    return NextResponse.json({
      run: completedRun,
      review_window: reviewWindow,
      analyzed_students: results.length,
    })
  } catch (error) {
    await supabase
      .from('assignment_repo_review_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        warnings_json: [
          { code: 'run-failed', message: error instanceof Error ? error.message : 'Repo review run failed' },
        ],
      })
      .eq('id', run.id)

    throw error
  }
})
