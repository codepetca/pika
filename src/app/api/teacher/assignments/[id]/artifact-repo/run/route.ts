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
  resolveAssignmentRepoTarget,
  saveAssignmentRepoTarget,
  validatePublicGitHubRepo,
} from '@/lib/server/assignment-repo-targets'
import { submissionArtifactsToAssignmentArtifacts } from '@/lib/assignment-submission-requirements'
import { loadAssignmentSubmissionArtifactsForDocs } from '@/lib/server/assignment-submission-artifacts'
import { assertTeacherCanMutateAssignment } from '@/lib/server/repo-review'
import { loadClassroomAiSanitizationContext } from '@/lib/server/ai-sanitization'
import { completeAssignmentRepoReviewRunAtomic } from '@/lib/server/assignment-grades'
import {
  assignmentIdSchema,
  assignmentStudentIdsRequestSchema,
} from '@/lib/validations/assignment-identifiers'
import type { AssignmentRepoReviewConfig, AssignmentSubmissionArtifact } from '@/types'

type GroupedStudent = {
  studentId: string
  email: string
  name: string | null
  effectiveGitHubUsername: string
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
  const assignmentId = assignmentIdSchema.parse((await context.params).id)
  const assignment = await assertTeacherCanMutateAssignment(user.id, assignmentId)
  const { studentIds } = assignmentStudentIdsRequestSchema.parse(await request.json())

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
  const docMap = new Map((docs || []).map((doc) => [doc.student_id, doc]))
  const repoTargetMap = new Map((repoTargets || []).map((target) => [target.student_id, target]))
  const docIds = (docs || [])
    .map((doc) => doc.id)
    .filter((id): id is string => typeof id === 'string')
  const structuredArtifacts = await loadAssignmentSubmissionArtifactsForDocs(supabase, docIds)
  const structuredArtifactsByDocId = new Map<string, AssignmentSubmissionArtifact[]>()
  for (const artifact of structuredArtifacts) {
    if (artifact.type !== 'repo_link') continue
    const current = structuredArtifactsByDocId.get(artifact.assignment_doc_id) || []
    current.push(artifact)
    structuredArtifactsByDocId.set(artifact.assignment_doc_id, current)
  }

  const skippedReasons = new Map<string, number>()
  const groups = new Map<string, { repoOwner: string; repoName: string; repoUrl: string; defaultBranch: string; students: GroupedStudent[] }>()

  for (const enrollment of enrollments || []) {
    const studentId = enrollment.student_id
    const doc = docMap.get(studentId)
    const structuredCandidateRepos = doc?.id
      ? submissionArtifactsToAssignmentArtifacts(structuredArtifactsByDocId.get(doc.id) || [])
          .filter((artifact) => artifact.type === 'repo')
      : []
    const resolved = resolveAssignmentRepoTarget({
      candidateRepos: structuredCandidateRepos.length > 0
        ? structuredCandidateRepos
        : extractRepoArtifactsFromContent(doc?.content),
      submittedRepoUrl: typeof doc?.repo_url === 'string' ? doc.repo_url : null,
      submittedGitHubUsername: typeof doc?.github_username === 'string' ? doc.github_username : null,
      target: repoTargetMap.get(studentId) || null,
    })

    if (!resolved.effectiveRepoUrl || !resolved.effectiveGitHubUsername) {
      const reason = resolved.validationMessage || 'No valid repo selected'
      skippedReasons.set(reason, (skippedReasons.get(reason) || 0) + 1)
      continue
    }

    const validation = await validatePublicGitHubRepo(resolved.effectiveRepoUrl)
    await saveAssignmentRepoTarget({
      assignmentId,
      studentId,
      repoUrl: resolved.selectionMode === 'teacher_override' ? validation.repoUrl : null,
      overrideGitHubUsername: resolved.selectionMode === 'teacher_override' ? resolved.effectiveGitHubUsername : null,
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
      effectiveGitHubUsername: resolved.effectiveGitHubUsername,
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
  const sanitizationContext = await loadClassroomAiSanitizationContext(
    supabase,
    assignment.classroom_id,
  )

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
        githubLogin: student.effectiveGitHubUsername,
        commitEmails: [student.email],
      }))

      const analysis = await analyzeRepoReviewAssignment({
        config,
        identities,
        reviewWindow,
        sanitizationContext,
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
            sanitizationContext,
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
            grading_model: feedback.model,
            grading_provenance: feedback.provenance,
          }
        })
      )

      const gradeSavedAt = new Date().toISOString()
      const gradingModels = [...new Set(results.map((result) => result.grading_model))]
      await completeAssignmentRepoReviewRunAtomic({
        supabase,
        runId: run.id,
        teacherId: user.id,
        results,
        sourceRef: analysis.sourceRef || group.defaultBranch,
        model: gradingModels.length === 1 ? gradingModels[0] : 'mixed',
        warnings: analysis.warnings,
        now: gradeSavedAt,
        grades: results.map((result) => {
          const existingDoc = docMap.get(result.student_id)
          return {
            studentId: result.student_id,
            expectedDocUpdatedAt: existingDoc?.updated_at ?? null,
            scoreCompletion: result.draft_score_completion,
            scoreThinking: result.draft_score_thinking,
            scoreWorkflow: result.draft_score_workflow,
            feedback: result.draft_feedback,
            applyTeacherFeedbackDraft: false,
            markGraded: false,
            aiFeedbackSuggestion: result.draft_feedback,
            aiFeedbackModel: result.grading_model,
            aiGradingProvenance: result.grading_provenance,
            gradedBy: null,
          }
        }),
      })

      analyzedStudents += results.length
      repoGroups += 1
    } catch (analysisError) {
      await supabase
        .from('assignment_repo_review_runs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          warnings_json: [
            { code: 'run-failed', message: analysisError instanceof Error ? analysisError.message : 'Repo analysis failed' },
          ],
        })
        .eq('id', run.id)
        .eq('status', 'running')
      throw analysisError
    }
  }

  return NextResponse.json({
    analyzed_students: analyzedStudents,
    repo_groups: repoGroups,
    skipped_reasons: Object.fromEntries(skippedReasons),
  })
})
