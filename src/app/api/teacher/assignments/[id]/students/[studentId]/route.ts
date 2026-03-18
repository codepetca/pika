import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { calculateAssignmentStatus } from '@/lib/assignments'
import {
  extractRepoArtifactsFromContent,
  loadAssignmentRepoTarget,
  resolveAssignmentRepoTarget,
} from '@/lib/server/assignment-repo-targets'
import { loadAssignmentFeedbackEntries } from '@/lib/server/assignment-feedback'
import { parseContentField } from '@/lib/tiptap-content'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/teacher/assignments/[id]/students/[studentId] - Get specific student's work
export const GET = withErrorHandler('GetTeacherAssignmentStudent', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: assignmentId, studentId } = await context.params
  const supabase = getServiceRoleClient()

  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .select(`
      *,
      classrooms!inner (
        id,
        teacher_id,
        title
      )
    `)
    .eq('id', assignmentId)
    .single()

  if (assignmentError || !assignment) {
    return NextResponse.json(
      { error: 'Assignment not found' },
      { status: 404 }
    )
  }

  if (assignment.classrooms.teacher_id !== user.id) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 403 }
    )
  }

  const { data: enrollment, error: enrollmentError } = await supabase
    .from('classroom_enrollments')
    .select(`
      student_id,
      users!inner (
        id,
        email
      )
    `)
    .eq('classroom_id', assignment.classroom_id)
    .eq('student_id', studentId)
    .single()

  if (enrollmentError || !enrollment) {
    return NextResponse.json(
      { error: 'Student not found in classroom' },
      { status: 404 }
    )
  }

  const [{ data: profile }, { data: docRow }, { data: githubIdentity }, feedbackEntries, repoTarget] = await Promise.all([
    supabase
      .from('student_profiles')
      .select('first_name, last_name')
      .eq('user_id', studentId)
      .single(),
    supabase
      .from('assignment_docs')
      .select('*')
      .eq('assignment_id', assignmentId)
      .eq('student_id', studentId)
      .single(),
    supabase
      .from('user_github_identities')
      .select('*')
      .eq('user_id', studentId)
      .maybeSingle(),
    loadAssignmentFeedbackEntries(assignmentId, studentId),
    loadAssignmentRepoTarget(assignmentId, studentId),
  ])

  const doc = docRow || null
  if (doc) {
    doc.content = parseContentField(doc.content)
  }

  const status = calculateAssignmentStatus(assignment, doc)
  const candidateRepos = doc ? extractRepoArtifactsFromContent(doc.content) : []
  const repoSelection = resolveAssignmentRepoTarget({
    candidateRepos,
    target: repoTarget,
  })

  const { data: latestRepoReviewResult } = await supabase
    .from('assignment_repo_review_results')
    .select('*')
    .eq('assignment_id', assignmentId)
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({
    assignment: {
      id: assignment.id,
      classroom_id: assignment.classroom_id,
      title: assignment.title,
      description: assignment.description,
      due_at: assignment.due_at,
      position: assignment.position ?? 0,
      evaluation_mode: assignment.evaluation_mode ?? 'document',
      created_by: assignment.created_by,
      created_at: assignment.created_at,
      updated_at: assignment.updated_at,
    },
    classroom: assignment.classrooms,
    student: {
      id: studentId,
      email: (enrollment.users as unknown as { id: string; email: string }).email,
      name: profile ? `${profile.first_name} ${profile.last_name}` : null,
    },
    doc,
    status,
    feedback_entries: feedbackEntries,
    github_identity: githubIdentity || null,
    repo_target: {
      ...repoSelection,
      latest_result: latestRepoReviewResult || null,
    },
  })
})
