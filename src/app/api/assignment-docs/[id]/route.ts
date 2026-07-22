import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireAuth, requireRole } from '@/lib/auth'
import { getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import { parseContentField } from '@/lib/tiptap-content'
import { sanitizeDocForStudent } from '@/lib/assignments'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { saveAssignmentDocAtomic } from '@/lib/server/assignment-doc-submissions'
import { isAssignmentVisibleToStudents } from '@/lib/server/assignments'
import { withErrorHandler } from '@/lib/api-handler'
import { loadAssignmentFeedbackEntries } from '@/lib/server/assignment-feedback'
import {
  loadAssignmentSubmissionArtifactsForDoc,
  loadAssignmentSubmissionRequirements,
  loadUserGitHubIdentity,
} from '@/lib/server/assignment-submission-artifacts'
import { assignmentDocSaveRequestSchema } from '@/lib/validations/assignment-doc-submissions'

export const dynamic = 'force-dynamic'
export const revalidate = 0
function parseTimestamp(value: unknown) {
  if (typeof value !== 'string' || value.length === 0) return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

function shouldRefreshViewedAt(doc: {
  viewed_at?: unknown
  returned_at?: unknown
  feedback_returned_at?: unknown
}) {
  const viewedTime = parseTimestamp(doc.viewed_at)
  if (viewedTime === null) return true

  const latestReturnTime = Math.max(
    parseTimestamp(doc.returned_at) ?? 0,
    parseTimestamp(doc.feedback_returned_at) ?? 0
  )

  return latestReturnTime > viewedTime
}

async function loadStudentSubmissionContext(
  supabase: ReturnType<typeof getServiceRoleClient>,
  assignmentId: string,
  docId: string | null,
  studentId: string
) {
  const [submissionRequirements, submissionArtifacts, githubIdentity] = await Promise.all([
    loadAssignmentSubmissionRequirements(supabase, assignmentId),
    docId ? loadAssignmentSubmissionArtifactsForDoc(supabase, docId) : Promise.resolve([]),
    loadUserGitHubIdentity(supabase, studentId),
  ])

  return {
    submission_requirements: submissionRequirements,
    submission_artifacts: submissionArtifacts,
    github_identity: githubIdentity,
  }
}

// GET /api/assignment-docs/[id] - Get assignment doc (creates if doesn't exist)
// The [id] here is the assignment_id, not the doc id
export const GET = withErrorHandler('GetAssignmentDoc', async (request, context) => {
  const user = await requireAuth()
  const { id: assignmentId } = await context.params
  const { searchParams } = new URL(request.url)
  const requestedStudentId = searchParams.get('student_id')
  const supabase = getServiceRoleClient()

  // Get assignment and verify student is enrolled
  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .select(`
      *,
      classrooms!inner (
        id,
        teacher_id
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

  let studentId = user.id
  const assignmentData = assignment as typeof assignment & {
    classroom_id: string
    classrooms?: { teacher_id?: string } | Array<{ teacher_id?: string }>
  }

  const classroomTeacherId = Array.isArray(assignmentData.classrooms)
    ? assignmentData.classrooms[0]?.teacher_id
    : assignmentData.classrooms?.teacher_id

  if (user.role === 'teacher') {
    if (classroomTeacherId !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }
    if (!requestedStudentId) {
      return NextResponse.json(
        { error: 'student_id is required' },
        { status: 400 }
      )
    }
    studentId = requestedStudentId

    const { data: enrollment } = await supabase
      .from('classroom_enrollments')
      .select('id')
      .eq('classroom_id', assignmentData.classroom_id)
      .eq('student_id', studentId)
      .single()

    if (!enrollment) {
      return NextResponse.json(
        { error: 'Not enrolled in this classroom' },
        { status: 403 }
      )
    }
  } else {
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
  }

  // Get or create assignment doc for this student
  const { data: existingDoc, error: docError } = await supabase
    .from('assignment_docs')
    .select('*')
    .eq('assignment_id', assignmentId)
    .eq('student_id', studentId)
    .single()

  // Track whether this request cleared an assignment notification.
  let wasFirstView = false

  if (docError) {
    if (docError.code === 'PGRST116') {
      if (user.role === 'teacher') {
        const submissionContext = await loadStudentSubmissionContext(supabase, assignmentId, null, studentId)
        const feedbackEntries = await loadAssignmentFeedbackEntries(assignmentId, studentId)
        return NextResponse.json({
          assignment: {
            ...assignment,
            instructions_markdown: getAssignmentInstructionsMarkdown(assignment).markdown,
          },
          doc: null,
          feedback_entries: feedbackEntries,
          ...submissionContext,
          wasFirstView: false,
        })
      }

      const { data: created, error: createError } = await supabase
        .from('assignment_docs')
        .insert({
          assignment_id: assignmentId,
          student_id: user.id,
          content: { type: 'doc', content: [] },
          repo_url: null,
          github_username: null,
          is_submitted: false,
          submitted_at: null,
          viewed_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (createError || !created) {
        // If we raced another create, re-fetch.
        if (createError?.code === '23505') {
          const { data: raced } = await supabase
            .from('assignment_docs')
            .select('*')
            .eq('assignment_id', assignmentId)
            .eq('student_id', user.id)
            .single()
          // Parse content if it's a string (for backwards compatibility)
          if (raced) {
            raced.content = parseContentField(raced.content)
          }
          // Race condition: another request created the doc, so this wasn't first view
          const feedbackEntries = raced ? await loadAssignmentFeedbackEntries(assignmentId, user.id) : []
          const submissionContext = await loadStudentSubmissionContext(supabase, assignmentId, raced?.id ?? null, user.id)
          return NextResponse.json({
            assignment: {
              ...assignment,
              instructions_markdown: getAssignmentInstructionsMarkdown(assignment).markdown,
            },
            doc: raced ? sanitizeDocForStudent(raced) : raced,
            feedback_entries: feedbackEntries,
            ...submissionContext,
            wasFirstView: false,
          })
        }

        console.error('Error creating assignment doc:', createError)
        return NextResponse.json(
          { error: 'Failed to create assignment doc' },
          { status: 500 }
        )
      }

      // New doc created = first view
      const submissionContext = await loadStudentSubmissionContext(supabase, assignmentId, created.id, user.id)
      return NextResponse.json({
        assignment: {
          ...assignment,
          instructions_markdown: getAssignmentInstructionsMarkdown(assignment).markdown,
        },
        doc: sanitizeDocForStudent(created),
        feedback_entries: [],
        ...submissionContext,
        wasFirstView: true,
      })
    }
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

  if (user.role === 'teacher') {
    const feedbackEntries = await loadAssignmentFeedbackEntries(assignmentId, studentId)
    const submissionContext = await loadStudentSubmissionContext(supabase, assignmentId, existingDoc.id, studentId)
    return NextResponse.json({
      assignment: {
        ...assignment,
        instructions_markdown: getAssignmentInstructionsMarkdown(assignment).markdown,
      },
      doc: existingDoc,
      feedback_entries: feedbackEntries,
      ...submissionContext,
      wasFirstView: false,
    })
  }

  // Mark as viewed if this request clears a first-view or returned-feedback notification.
  if (existingDoc && shouldRefreshViewedAt(existingDoc)) {
    const viewedAt = new Date().toISOString()
    const { data: viewedDoc, error: viewedError } = await supabase
      .from('assignment_docs')
      .update({ viewed_at: viewedAt })
      .eq('id', existingDoc.id)
      .select('updated_at')
      .single()

    if (viewedError) {
      console.error('Error updating assignment viewed_at:', viewedError)
      // Non-fatal: continue with response, but don't clear local notification count.
    } else {
      existingDoc.viewed_at = viewedAt
      existingDoc.updated_at = viewedDoc.updated_at
      wasFirstView = true
    }
  }

  const feedbackEntries = await loadAssignmentFeedbackEntries(assignmentId, user.id)
  const submissionContext = await loadStudentSubmissionContext(supabase, assignmentId, existingDoc.id, user.id)

  return NextResponse.json({
    assignment: {
      ...assignment,
      instructions_markdown: getAssignmentInstructionsMarkdown(assignment).markdown,
    },
    doc: sanitizeDocForStudent(existingDoc),
    feedback_entries: feedbackEntries,
    ...submissionContext,
    wasFirstView,
  })
})

// PATCH /api/assignment-docs/[id] - Save content (autosave)
export const PATCH = withErrorHandler('PatchAssignmentDoc', async (request, context) => {
  const user = await requireRole('student')
  const { id: assignmentId } = await context.params
  const body = assignmentDocSaveRequestSchema.parse(await request.json())
  const { content, trigger } = body
  const isLegacySave = !('save_session_id' in body)
  const paste_word_count = body.paste_word_count ?? 0
  const keystroke_count = body.keystroke_count ?? 0

  const supabase = getServiceRoleClient()
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

  // Fetch doc to enforce ownership and submission rules
  const { data: existingDoc, error: docFetchError } = await supabase
    .from('assignment_docs')
    .select('id, student_id, is_submitted, content, updated_at')
    .eq('assignment_id', assignmentId)
    .eq('student_id', user.id)
    .single()

  if (docFetchError && docFetchError.code !== 'PGRST116') {
    console.error('Error fetching assignment doc:', docFetchError)
    return NextResponse.json(
      { error: 'Failed to fetch assignment doc' },
      { status: 500 }
    )
  }

  if (existingDoc?.is_submitted) {
    return NextResponse.json(
      { error: 'Cannot edit a submitted document' },
      { status: 403 }
    )
  }

  const saveSessionId = isLegacySave ? crypto.randomUUID() : body.save_session_id
  const saveResult = await saveAssignmentDocAtomic({
    supabase,
    assignmentId,
    studentId: user.id,
    previousContent: existingDoc
      ? parseContentField(existingDoc.content)
      : { type: 'doc', content: [] },
    content,
    expectedUpdatedAt: isLegacySave ? existingDoc?.updated_at ?? null : body.expected_updated_at,
    trigger: trigger ?? 'autosave',
    pasteWordCount: paste_word_count,
    keystrokeCount: keystroke_count,
    saveSessionId,
    saveSequence: isLegacySave ? 1 : body.save_sequence,
    metricSessionId: isLegacySave ? saveSessionId : body.metric_session_id,
  })

  if (!saveResult.ok) {
    return NextResponse.json(
      { error: saveResult.error, error_code: saveResult.errorCode },
      { status: saveResult.status }
    )
  }

  const doc = saveResult.doc

  // Parse content if it's a string (for backwards compatibility)
  if (doc) {
    doc.content = parseContentField(doc.content)
  }

  return NextResponse.json({
    doc: sanitizeDocForStudent(doc),
    historyEntry: saveResult.historyEntry,
  })
})
