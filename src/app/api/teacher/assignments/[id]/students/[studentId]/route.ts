import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { calculateAssignmentStatus } from '@/lib/assignments'
import {
  extractRepoArtifactsFromContent,
  loadAssignmentRepoTarget,
  resolveAssignmentRepoTarget,
} from '@/lib/server/assignment-repo-targets'
import { submissionArtifactsToAssignmentArtifacts } from '@/lib/assignment-submission-requirements'
import {
  loadAssignmentSubmissionArtifactsForDoc,
  loadAssignmentSubmissionRequirements,
} from '@/lib/server/assignment-submission-artifacts'
import { loadAssignmentFeedbackEntries } from '@/lib/server/assignment-feedback'
import { getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import { parseContentField } from '@/lib/tiptap-content'
import { withErrorHandler } from '@/lib/api-handler'
import { ApiError } from '@/lib/api-error'
import {
  assertContextualAssignmentDetailArtifacts,
  assertContextualAssignmentDetailRequirements,
  assertContextualAssignmentStudentDoc,
  assertContextualAssignmentStudentEnrollment,
  assertContextualAssignmentStudentFeedback,
  assertContextualAssignmentStudentProfile,
  assertContextualAssignmentStudentRepoReview,
  assertContextualAssignmentStudentRepoTarget,
  authorizeClassroomAssignmentDetailRequest,
  canonicalizeContextualAssignmentStudentId,
  resolveContextualAssignmentDetailAccess,
} from '@/lib/server/classroom-assignment-detail-access'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/teacher/assignments/[id]/students/[studentId] - Get specific student's work
export const GET = withErrorHandler('GetTeacherAssignmentStudent', async (request, context) => {
  let resolvedParams: { id: string; studentId: string } | null = null
  const resolveParams = async () => {
    resolvedParams ??= await context.params as { id: string; studentId: string }
    return resolvedParams
  }
  const resolveAssignmentId = async () => (await resolveParams()).id
  const assignmentAccess = await authorizeClassroomAssignmentDetailRequest(resolveAssignmentId, {
    legacyRole: 'teacher',
  })
  const params = await resolveParams()
  const assignmentId = assignmentAccess.mode === 'contextual'
    ? assignmentAccess.assignmentId
    : params.id
  const studentId = assignmentAccess.mode === 'contextual'
    ? canonicalizeContextualAssignmentStudentId(params.studentId)
    : params.studentId
  const supabase = getServiceRoleClient()

  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .select(`
      *,
      classrooms!inner (
        id,
        teacher_id,
        title,
        archived_at
      )
    `)
    .eq('id', assignmentId)
    .single()

  if (assignmentAccess.mode === 'contextual') {
    if (assignmentError && assignmentError.code !== 'PGRST116') {
      throw new ApiError(503, 'Unable to verify assignment student access')
    }
    if (!assignment && !assignmentError) {
      throw new ApiError(503, 'Unable to verify assignment student access')
    }
  }

  if (assignmentError || !assignment) {
    return NextResponse.json(
      { error: 'Assignment not found' },
      { status: 404 }
    )
  }

  if (assignmentAccess.mode === 'contextual') {
    await resolveContextualAssignmentDetailAccess(assignmentAccess, assignment, { supabase })
  } else if (assignment.classrooms.teacher_id !== assignmentAccess.user.id) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 403 }
    )
  }

  const enrollmentQuery = supabase
    .from('classroom_enrollments')
    .select(`
      id,
      classroom_id,
      student_id,
      users!inner (
        id,
        email
      )
    `)
    .eq('classroom_id', assignment.classroom_id)
    .eq('student_id', studentId)

  const enrollmentResult: any = assignmentAccess.mode === 'contextual'
    ? await enrollmentQuery.limit(2)
    : await enrollmentQuery.single()
  const enrollmentRows = assignmentAccess.mode === 'contextual'
    ? enrollmentResult.data
    : null
  const enrollment: any = assignmentAccess.mode === 'contextual'
    ? (Array.isArray(enrollmentRows) ? enrollmentRows[0] ?? null : null)
    : enrollmentResult.data
  const enrollmentError = enrollmentResult.error

  if (assignmentAccess.mode === 'contextual') {
    if (enrollmentError || !Array.isArray(enrollmentRows) || enrollmentRows.length > 1) {
      throw new ApiError(503, 'Unable to verify assignment student roster')
    }
    if (!enrollment) {
      return NextResponse.json(
        { error: 'Student not found in classroom' },
        { status: 404 }
      )
    }
    assertContextualAssignmentStudentEnrollment(assignment.classroom_id, studentId, enrollment)
  }

  if (enrollmentError || !enrollment) {
    return NextResponse.json(
      { error: 'Student not found in classroom' },
      { status: 404 }
    )
  }

  const profileQuery = supabase
    .from('student_profiles')
    .select('user_id, first_name, last_name')
    .eq('user_id', studentId)
  const docQuery = supabase
    .from('assignment_docs')
    .select('*')
    .eq('assignment_id', assignmentId)
    .eq('student_id', studentId)

  let profileResult: any
  let docResult: any
  let feedbackEntries
  let repoTarget
  try {
    [profileResult, docResult, feedbackEntries, repoTarget] = await Promise.all([
      assignmentAccess.mode === 'contextual' ? profileQuery.limit(2) : profileQuery.single(),
      assignmentAccess.mode === 'contextual' ? docQuery.limit(2) : docQuery.single(),
      assignmentAccess.mode === 'contextual'
        ? loadAssignmentFeedbackEntries(assignmentId, studentId, {
            supabase,
            requireDataArray: true,
          })
        : loadAssignmentFeedbackEntries(assignmentId, studentId),
      assignmentAccess.mode === 'contextual'
        ? loadAssignmentRepoTarget(assignmentId, studentId, {
            supabase,
            requireEvidence: true,
          })
        : loadAssignmentRepoTarget(assignmentId, studentId),
    ])
  } catch (error) {
    if (assignmentAccess.mode === 'contextual') {
      throw new ApiError(503, 'Unable to verify assignment student evidence')
    }
    throw error
  }

  let profile: any = profileResult.data ?? null
  let docRow: any = docResult.data ?? null
  if (assignmentAccess.mode === 'contextual') {
    if (
      profileResult.error
      || !Array.isArray(profileResult.data)
      || profileResult.data.length > 1
    ) {
      throw new ApiError(503, 'Unable to verify assignment student profile')
    }
    if (
      docResult.error
      || !Array.isArray(docResult.data)
      || docResult.data.length > 1
    ) {
      throw new ApiError(503, 'Unable to verify assignment student document')
    }
    profile = profileResult.data[0] ?? null
    docRow = docResult.data[0] ?? null
    assertContextualAssignmentStudentProfile(studentId, profile)
    assertContextualAssignmentStudentDoc(assignmentId, studentId, docRow)
    assertContextualAssignmentStudentFeedback(assignmentId, studentId, feedbackEntries)
    assertContextualAssignmentStudentRepoTarget(assignmentId, studentId, repoTarget)
  }

  const doc = docRow || null
  if (doc) {
    doc.content = parseContentField(doc.content)
  }
  let structuredArtifacts
  let submissionRequirements
  try {
    structuredArtifacts = doc?.id
      ? assignmentAccess.mode === 'contextual'
        ? await loadAssignmentSubmissionArtifactsForDoc(
            supabase,
            doc.id,
            { requireDataArray: true },
          )
        : await loadAssignmentSubmissionArtifactsForDoc(supabase, doc.id)
      : []
    submissionRequirements = assignmentAccess.mode === 'contextual'
      ? await loadAssignmentSubmissionRequirements(
          supabase,
          assignmentId,
          { requireDataArray: true },
        )
      : await loadAssignmentSubmissionRequirements(supabase, assignmentId)
  } catch (error) {
    if (assignmentAccess.mode === 'contextual') {
      throw new ApiError(503, 'Unable to verify assignment student submissions')
    }
    throw error
  }
  if (assignmentAccess.mode === 'contextual') {
    assertContextualAssignmentDetailRequirements(assignmentId, submissionRequirements)
    assertContextualAssignmentDetailArtifacts(
      doc ? [doc] : [],
      submissionRequirements,
      structuredArtifacts,
    )
  }
  const structuredCandidateRepos = submissionArtifactsToAssignmentArtifacts(
    structuredArtifacts,
    submissionRequirements,
  )
    .filter((artifact) => artifact.type === 'repo')

  const status = calculateAssignmentStatus(assignment, doc)
  const repoSelection = resolveAssignmentRepoTarget({
    candidateRepos: structuredCandidateRepos.length > 0
      ? structuredCandidateRepos
      : extractRepoArtifactsFromContent(doc?.content),
    submittedRepoUrl: doc?.repo_url ?? null,
    submittedGitHubUsername: doc?.github_username ?? null,
    target: repoTarget,
  })

  const latestRepoReviewQuery = supabase
    .from('assignment_repo_review_results')
    .select('*, assignment_repo_review_runs!inner(status)')
    .eq('assignment_id', assignmentId)
    .eq('student_id', studentId)
    .eq('assignment_repo_review_runs.status', 'completed')
    .order('created_at', { ascending: false })

  let latestRepoReviewResult = null
  if (assignmentAccess.mode === 'contextual') {
    const { data, error } = await latestRepoReviewQuery.limit(1)
    if (error || !Array.isArray(data) || data.length > 1) {
      throw new ApiError(503, 'Unable to verify assignment student repository review')
    }
    latestRepoReviewResult = data[0] ?? null
    assertContextualAssignmentStudentRepoReview(
      assignmentId,
      studentId,
      latestRepoReviewResult,
    )
  } else {
    const { data } = await latestRepoReviewQuery.limit(1).maybeSingle()
    latestRepoReviewResult = data
  }

  return NextResponse.json({
    assignment: {
      id: assignment.id,
      classroom_id: assignment.classroom_id,
      title: assignment.title,
      description: assignment.description,
      instructions_markdown: getAssignmentInstructionsMarkdown(assignment).markdown,
      due_at: assignment.due_at,
      position: assignment.position ?? 0,
      submission_requirements: submissionRequirements,
      created_by: assignment.created_by,
      created_at: assignment.created_at,
      updated_at: assignment.updated_at,
    },
    classroom: {
      id: assignment.classrooms.id,
      teacher_id: assignment.classrooms.teacher_id,
      title: assignment.classrooms.title,
    },
    student: {
      id: studentId,
      email: (enrollment.users as unknown as { id: string; email: string }).email,
      name: profile ? `${profile.first_name} ${profile.last_name}` : null,
    },
    doc,
    submission_artifacts: structuredArtifacts,
    status,
    feedback_entries: feedbackEntries,
    repo_target: {
      ...repoSelection,
      latest_result: latestRepoReviewResult
        ? Object.fromEntries(
            Object.entries(latestRepoReviewResult).filter(
              ([key]) => key !== 'assignment_repo_review_runs',
            ),
          )
        : null,
    },
  })
})
