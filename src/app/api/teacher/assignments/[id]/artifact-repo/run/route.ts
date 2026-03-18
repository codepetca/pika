import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler, apiErrors } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  analyzeRepoReviewAssignment,
  buildRepoReviewWindow,
  formatRepoReviewRepoName,
  REPO_REVIEW_METRICS_VERSION,
  REPO_REVIEW_PROMPT_VERSION,
} from '@/lib/repo-review'
import { gradeRepoReviewFeedback } from '@/lib/repo-review-ai'
import {
  extractRepoArtifactsFromContent,
  loadAssignmentRepoTarget,
  resolveAssignmentRepoTarget,
  saveAssignmentRepoTarget,
  validatePublicGitHubRepo,
} from '@/lib/server/assignment-repo-targets'
import { assertTeacherOwnsAssignment } from '@/lib/server/repo-review'
import { parseContentField } from '@/lib/tiptap-content'
import type { AssignmentRepoReviewConfig, UserGitHubIdentity } from '@/types'

type GroupedStudent = {
  studentId: string
  email: string
  name: string | null
  githubIdentity: UserGitHubIdentity | null
}

function createConfigForResolvedRepo(opts: {
  assignmentId: string
  repoOwner: string
  repoName: string
  defaultBranch: string
}): AssignmentRepoReviewConfig {
  const now = new Date().toISOString()
  return {
    assignment_id: opts.assignmentId,
    provider: 'github',
    repo_owner: opts.repoOwner,
    repo_name: opts.repoName,
    default_branch: opts.defaultBranch,
    review_start_at: null,
    review_end_at: null,
    include_pr_reviews: true,
    config_json: {},
    created_at: now,
    updated_at: now,
  }
}

export const POST = withErrorHandler('RunTeacherAssignmentArtifactRepoAnalysis', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: assignmentId } = await context.params
  const assignment = await assertTeacherOwnsAssignment(user.id, assignmentId)
  const body = await request.json()
  const studentIds = Array.isArray(body.student_ids) ? body.student_ids.filter((value): value is string => typeof value === 'string') : []

  if (studentIds.length === 0) {
    throw apiErrors.badRequest('student_ids array is required')
  }
  if (studentIds.length > 100) {
    throw apiErrors.badRequest('Cannot analyze more than 100 students at once')
  }

  const supabase = getServiceRoleClient()
  const { data: enrollments, error: enrollmentsError } = await supabase
    .from('classroom_enrollments')
    .select(`
      student_id,
      users!inner (
        email
      )
    `)
    .eq('classroom_id', assignment.classroom_id)
    .in('student_id', studentIds)

  if (enrollmentsError) {
    throw new Error('Failed to load student enrollments')
  }

  const enrolledStudentIds = (enrollments || []).map((row) => row.student_id)
  const { data: profiles } = enrolledStudentIds.length > 0
    ? await supabase
        .from('student_profiles')
        .select('user_id, first_name, last_name')
        .in('user_id', enrolledStudentIds)
    : { data: [] as Array<{ user_id: string; first_name: string | null; last_name: string | null }> }
  const { data: githubIdentities } = enrolledStudentIds.length > 0
    ? await supabase
        .from('user_github_identities')
        .select('*')
        .in('user_id', enrolledStudentIds)
    : { data: [] as UserGitHubIdentity[] }
  const { data: docs } = enrolledStudentIds.length > 0
    ? await supabase
        .from('assignment_docs')
        .select('*')
        .eq('assignment_id', assignmentId)
        .in('student_id', enrolledStudentIds)
    : { data: [] as Array<any> }
  const { data: repoTargets } = enrolledStudentIds.length > 0
    ? await supabase
        .from('assignment_repo_targets')
        .select('*')
        .eq('assignment_id', assignmentId)
        .in('student_id', enrolledStudentIds)
    : { data: [] as Array<any> }

  const profileMap = new Map(
    (profiles || []).map((profile) => [
      profile.user_id,
      `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || null,
    ])
  )
  const githubIdentityMap = new Map(
    (githubIdentities || []).map((identity) => [identity.user_id, identity as UserGitHubIdentity])
  )
  const docMap = new Map((docs || []).map((doc) => [doc.student_id, doc]))
  const repoTargetMap = new Map((repoTargets || []).map((target) => [target.student_id, target]))

  const skippedReasons = new Map<string, number>()
  const groups = new Map<string, { repoOwner: string; repoName: string; repoUrl: string; defaultBranch: string; students: GroupedStudent[] }>()

  for (const enrollment of enrollments || []) {
    const studentId = enrollment.student_id
    const doc = docMap.get(studentId)
    const candidateRepos = doc ? extractRepoArtifactsFromContent(parseContentField(doc.content)) : []
    const resolved = resolveAssignmentRepoTarget({
      candidateRepos,
      target: repoTargetMap.get(studentId) || null,
    })

    if (!resolved.effectiveRepoUrl) {
      const reason = resolved.validationMessage || 'No valid repo selected'
      skippedReasons.set(reason, (skippedReasons.get(reason) || 0) + 1)
      continue
    }

    const validation = await validatePublicGitHubRepo(resolved.effectiveRepoUrl)
    await saveAssignmentRepoTarget({
      assignmentId,
      studentId,
      repoUrl: validation.repoUrl,
      selectionMode: resolved.selectionMode,
      validationStatus: validation.validationStatus,
      validationMessage: validation.validationMessage,
      repoOwner: validation.repoOwner || null,
      repoName: validation.repoName || null,
    })

    if (validation.validationStatus !== 'valid') {
      const reason = validation.validationMessage || 'Repo validation failed'
      skippedReasons.set(reason, (skippedReasons.get(reason) || 0) + 1)
      continue
    }

    const key = validation.repoUrl
    const existing = groups.get(key)
    const groupedStudent = {
      studentId,
      email: (enrollment.users as unknown as { email: string }).email,
      name: profileMap.get(studentId) || null,
      githubIdentity: githubIdentityMap.get(studentId) || null,
    }
    if (existing) {
      existing.students.push(groupedStudent)
    } else {
      groups.set(key, {
        repoOwner: validation.repoOwner,
        repoName: validation.repoName,
        repoUrl: validation.repoUrl,
        defaultBranch: validation.defaultBranch,
        students: [groupedStudent],
      })
    }
  }

  if (groups.size === 0) {
    return NextResponse.json({
      analyzed_students: 0,
      repo_groups: 0,
      skipped_reasons: Object.fromEntries(skippedReasons),
    })
  }

  const reviewWindow = buildRepoReviewWindow({
    dueAt: assignment.due_at,
    releasedAt: assignment.released_at,
  })

  let analyzedStudents = 0
  let repoGroups = 0

  for (const group of groups.values()) {
    const config = createConfigForResolvedRepo({
      assignmentId,
      repoOwner: group.repoOwner,
      repoName: group.repoName,
      defaultBranch: group.defaultBranch,
    })

    const { data: run, error: runError } = await supabase
      .from('assignment_repo_review_runs')
      .insert({
        assignment_id: assignmentId,
        repo_owner: group.repoOwner,
        repo_name: group.repoName,
        status: 'running',
        triggered_by: user.id,
        started_at: new Date().toISOString(),
        source_ref: group.defaultBranch,
        metrics_version: REPO_REVIEW_METRICS_VERSION,
        prompt_version: REPO_REVIEW_PROMPT_VERSION,
        warnings_json: [],
      })
      .select()
      .single()

    if (runError || !run) {
      throw apiErrors.conflict('Failed to start repo analysis run')
    }

    try {
      const identities = group.students.map((student) => ({
        studentId: student.studentId,
        email: student.email,
        name: student.name,
        githubLogin: student.githubIdentity?.github_login || null,
        commitEmails: student.githubIdentity?.commit_emails?.length
          ? student.githubIdentity.commit_emails
          : [student.email],
      }))

      const analysis = await analyzeRepoReviewAssignment({
        config,
        identities,
        reviewWindow,
      })
      const repoName = formatRepoReviewRepoName(config)
      const results = await Promise.all(
        analysis.students.map(async (student) => {
          const studentMeta = group.students.find((item) => item.studentId === student.studentId)
          const feedback = await gradeRepoReviewFeedback({
            assignmentTitle: assignment.title,
            repoName,
            studentName: studentMeta?.name || studentMeta?.email || 'Student',
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
            warnings: analysis.warnings
              .filter((warning) => !warning.student_id || warning.student_id === student.studentId)
              .map((warning) => warning.message),
            confidence: analysis.confidence,
          })

          return {
            run_id: run.id,
            assignment_id: assignmentId,
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
        throw apiErrors.conflict('Failed to save repo analysis results')
      }

      const docRows = results.map((result) => {
        const existingDoc = docMap.get(result.student_id)
        return {
          assignment_id: assignmentId,
          student_id: result.student_id,
          content: existingDoc?.content || { type: 'doc', content: [] },
          is_submitted: existingDoc?.is_submitted ?? false,
          submitted_at: existingDoc?.submitted_at ?? null,
          score_completion: result.draft_score_completion,
          score_thinking: result.draft_score_thinking,
          score_workflow: result.draft_score_workflow,
          ai_feedback_suggestion: result.draft_feedback,
          ai_feedback_suggested_at: new Date().toISOString(),
          ai_feedback_model: 'repo-review-v2',
          graded_at: null,
          graded_by: null,
        }
      })

      const { error: docsError } = await supabase
        .from('assignment_docs')
        .upsert(docRows, { onConflict: 'assignment_id,student_id' })
      if (docsError) {
        throw apiErrors.conflict('Failed to save repo analysis draft grades')
      }

      const { error: completeError } = await supabase
        .from('assignment_repo_review_runs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          source_ref: analysis.sourceRef || group.defaultBranch,
          model: 'repo-review-v2',
          warnings_json: analysis.warnings,
        })
        .eq('id', run.id)
      if (completeError) {
        throw apiErrors.conflict('Failed to finalize repo analysis run')
      }

      analyzedStudents += results.length
      repoGroups += 1
    } catch (error) {
      await supabase
        .from('assignment_repo_review_runs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          warnings_json: [
            { code: 'run-failed', message: error instanceof Error ? error.message : 'Repo analysis failed' },
          ],
        })
        .eq('id', run.id)
      throw error
    }
  }

  return NextResponse.json({
    analyzed_students: analyzedStudents,
    repo_groups: repoGroups,
    skipped_reasons: Object.fromEntries(skippedReasons),
  })
})
