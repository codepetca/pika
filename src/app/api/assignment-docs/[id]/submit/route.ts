import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { parseContentField } from '@/lib/tiptap-content'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { isAssignmentVisibleToStudents } from '@/lib/server/assignments'
import { analyzeAuthenticity } from '@/lib/authenticity'
import { withErrorHandler } from '@/lib/api-handler'
import { hasAssignmentSubmissionContent, sanitizeDocForStudent } from '@/lib/assignments'
import {
  getSubmissionRequirementCompletion,
  isSubmissionArtifactPresent,
} from '@/lib/assignment-submission-requirements'
import {
  loadAssignmentSubmissionArtifactsForDoc,
  loadAssignmentSubmissionRequirements,
} from '@/lib/server/assignment-submission-artifacts'
import { assignmentDocSubmitRequestSchema } from '@/lib/validations/assignment-doc-submissions'
import { submitAssignmentDocAtomic } from '@/lib/server/assignment-doc-submissions'
import { createJsonPatch } from '@/lib/json-patch'
import type { AssignmentDocHistoryEntry, TiptapContent } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const STUDENT_ASSIGNMENT_DOC_SELECT = 'id, assignment_id, student_id, content, repo_url, github_username, is_submitted, submitted_at, viewed_at, score_completion, score_thinking, score_workflow, feedback, feedback_returned_at, teacher_cleared_at, graded_at, graded_by, returned_at, authenticity_score, authenticity_flags, created_at, updated_at' as const

// POST /api/assignment-docs/[id]/submit - Submit assignment
export const POST = withErrorHandler('PostAssignmentDocSubmit', async (request, context) => {
  const user = await requireRole('student')
  const { id: assignmentId } = await context.params
  const supabase = getServiceRoleClient()
  if (!request.body) {
    return NextResponse.json(
      { error: 'Reload this assignment before submitting from an older browser tab.' },
      { status: 409 }
    )
  }
  const submitRequest = assignmentDocSubmitRequestSchema.parse(await request.json())

  // Get assignment and verify enrollment
  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .select('classroom_id, is_draft, released_at')
    .eq('id', assignmentId)
    .single()

  if (assignmentError || !assignment) {
    return NextResponse.json(
      { error: 'Assignment not found' },
      { status: 404 }
    )
  }

  if (!isAssignmentVisibleToStudents(assignment)) {
    return NextResponse.json(
      { error: 'Assignment not found' },
      { status: 404 }
    )
  }

  const access = await assertStudentCanAccessClassroom(user.id, assignment.classroom_id)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status }
    )
  }

  // Check if doc exists
  const { data: existingDoc, error: docError } = await supabase
    .from('assignment_docs')
    .select(STUDENT_ASSIGNMENT_DOC_SELECT)
    .eq('assignment_id', assignmentId)
    .eq('student_id', user.id)
    .single()

  if (docError && docError.code === 'PGRST116') {
    return NextResponse.json(
      { error: 'No work to submit. Please save your work first.' },
      { status: 400 }
    )
  }

  if (docError) {
    console.error('Error fetching assignment doc:', docError)
    return NextResponse.json(
      { error: 'Failed to fetch assignment doc' },
      { status: 500 }
    )
  }

  // Parse content if it's a string (for backwards compatibility)
  if (existingDoc) {
    existingDoc.content = parseContentField(existingDoc.content)
  }
  const requestedContent = submitRequest.content
  const submissionContent = requestedContent

  const submissionRequirements = existingDoc
    ? await loadAssignmentSubmissionRequirements(supabase, assignmentId)
    : []
  const submissionArtifacts = existingDoc
    ? await loadAssignmentSubmissionArtifactsForDoc(supabase, existingDoc.id)
    : []
  const submissionCompletion = getSubmissionRequirementCompletion(submissionRequirements, submissionArtifacts)

  if (submissionRequirements.length > 0 && !submissionCompletion.canSubmit) {
    return NextResponse.json(
      { error: 'Complete the required submissions before submitting.' },
      { status: 400 }
    )
  }

  const hasStructuredArtifacts = submissionArtifacts.some(isSubmissionArtifactPresent)

  if (!existingDoc || (!hasAssignmentSubmissionContent({ content: submissionContent }) && !hasStructuredArtifacts)) {
    return NextResponse.json(
      { error: 'No work to submit. Please write something or add a required submission first.' },
      { status: 400 }
    )
  }

  if (existingDoc.is_submitted) {
    if (requestedContent && createJsonPatch(existingDoc.content, requestedContent).length > 0) {
      return NextResponse.json(
        { error: 'This assignment is already submitted and cannot be changed.' },
        { status: 409 }
      )
    }
  }

  const submitResult = await submitAssignmentDocAtomic({
    supabase,
    assignmentId,
    studentId: user.id,
    content: submissionContent as TiptapContent,
    expectedUpdatedAt: submitRequest.expected_updated_at,
  })

  if (!submitResult.ok) {
    return NextResponse.json({ error: submitResult.error }, { status: submitResult.status })
  }

  const doc = submitResult.doc

  // Parse content if it's a string (for backwards compatibility)
  if (doc) {
    doc.content = parseContentField(doc.content)
  }

  // Compute authenticity score from history.
  try {
    const { data: historyEntries } = await supabase
      .from('assignment_doc_history')
      .select('id, assignment_doc_id, patch, snapshot, word_count, char_count, paste_word_count, keystroke_count, trigger, created_at')
      .eq('assignment_doc_id', existingDoc.id)
      .order('created_at', { ascending: true })

    if (historyEntries && historyEntries.length > 1) {
      const result = analyzeAuthenticity(historyEntries as AssignmentDocHistoryEntry[])
      if (result.score !== null) {
        const { error: authError } = await supabase
          .from('assignment_docs')
          .update({
            authenticity_score: result.score,
            authenticity_flags: result.flags,
          })
          .eq('id', existingDoc.id)

        if (!authError && doc) {
          doc.authenticity_score = result.score
          doc.authenticity_flags = result.flags
        }
      }
    }
  } catch (authError) {
    console.error('Error computing authenticity score:', authError)
  }

  return NextResponse.json({ doc: sanitizeDocForStudent(doc) })
})
