import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { parseContentField } from '@/lib/tiptap-content'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { isAssignmentVisibleToStudents } from '@/lib/server/assignments'
import { analyzeAuthenticity } from '@/lib/authenticity'
import { withErrorHandler } from '@/lib/api-handler'
import { hasAssignmentSubmissionContent, sanitizeDocForStudent } from '@/lib/assignments'
import {
  getAssignmentAttachmentSubmissionGate,
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
import { isPalEnabled, isClassroomPalRequested } from '@/lib/server/pal-config'
import { buildLearningItemCompletedEvent } from '@/lib/server/pal-events'
import { attemptImmediatePalEventDelivery } from '@/lib/server/pal-outbox'
import { authorizeContextualAssignmentDocSubmissionRequest } from '@/lib/server/contextual-assignment-doc-access'
import {
  assertContextualAssignmentSubmissionResourceEvidence,
  submitContextualAssignmentDoc,
  verifyContextualAssignmentSubmissionAssignmentEvidence,
  verifyContextualAssignmentSubmissionDocEvidence,
  type ContextualAssignmentSubmissionClient,
} from '@/lib/server/contextual-assignment-doc-submission'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const STUDENT_ASSIGNMENT_DOC_SELECT = 'id, assignment_id, student_id, content, repo_url, github_username, is_submitted, submitted_at, viewed_at, score_completion, score_thinking, score_workflow, feedback, feedback_returned_at, teacher_cleared_at, graded_at, graded_by, returned_at, authenticity_score, authenticity_flags, created_at, updated_at' as const

type AssignmentDocSubmitRequest = ReturnType<typeof assignmentDocSubmitRequestSchema.parse>

async function submitContextualMemberAssignment(input: {
  userId: string
  assignmentId: string
  submitRequest: AssignmentDocSubmitRequest
  supabase: ReturnType<typeof getServiceRoleClient>
}) {
  const { userId, assignmentId, submitRequest, supabase } = input
  const { data: assignmentRows, error: assignmentError } = await supabase
    .from('assignments')
    .select('id, classroom_id, due_at')
    .eq('id', assignmentId)
    .limit(2)
  if (assignmentError) {
    return NextResponse.json({ error: 'Unable to verify assignment submission' }, { status: 503 })
  }
  const assignment = verifyContextualAssignmentSubmissionAssignmentEvidence({
    assignmentId,
    rows: assignmentRows,
  })
  if (!assignment) {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })
  }

  const { data: docRows, error: docError } = await supabase
    .from('assignment_docs')
    .select('id, assignment_id, student_id, content, is_submitted, submitted_at, updated_at, returned_at, teacher_cleared_at')
    .eq('assignment_id', assignmentId)
    .eq('student_id', userId)
    .limit(2)
  if (docError) {
    return NextResponse.json({ error: 'Unable to verify assignment document' }, { status: 503 })
  }
  const existingDoc = verifyContextualAssignmentSubmissionDocEvidence({
    actorId: userId,
    assignmentId,
    rows: docRows,
  })
  if (!existingDoc) {
    return NextResponse.json(
      { error: 'No work to submit. Please save your work first.' },
      { status: 400 },
    )
  }

  let submissionRequirements
  let submissionArtifacts
  try {
    submissionRequirements = await loadAssignmentSubmissionRequirements(
      supabase,
      assignmentId,
      { requireDataArray: true },
    )
    submissionArtifacts = await loadAssignmentSubmissionArtifactsForDoc(
      supabase,
      existingDoc.id,
      { requireDataArray: true },
    )
    assertContextualAssignmentSubmissionResourceEvidence({
      assignmentId,
      assignmentDocId: existingDoc.id,
      requirements: submissionRequirements,
      artifacts: submissionArtifacts,
    })
  } catch {
    return NextResponse.json(
      { error: 'Unable to verify assignment submission resources' },
      { status: 503 },
    )
  }

  const submissionCompletion = getSubmissionRequirementCompletion(
    submissionRequirements,
    submissionArtifacts,
  )
  const requestedAcknowledgementIds = submitRequest.acknowledged_missing_attachment_ids
  const acknowledgedMissingAttachmentIds = new Set(requestedAcknowledgementIds)
  const currentMissingAttachmentIds = submissionCompletion.missingRequiredRequirementIds
  const acknowledgesExactCurrentMissingAttachments =
    submitRequest.allow_missing_attachments
    && requestedAcknowledgementIds.length === acknowledgedMissingAttachmentIds.size
    && acknowledgedMissingAttachmentIds.size === currentMissingAttachmentIds.length
    && currentMissingAttachmentIds.every(
      (requirementId) => acknowledgedMissingAttachmentIds.has(requirementId),
    )
  const attachmentGate = getAssignmentAttachmentSubmissionGate(
    submissionCompletion,
    acknowledgesExactCurrentMissingAttachments,
  )

  if (!attachmentGate.ok && attachmentGate.reason === 'invalid_attachments') {
    return NextResponse.json({ error: 'Fix invalid attachments before submitting.' }, { status: 400 })
  }
  if (!attachmentGate.ok && attachmentGate.reason === 'missing_confirmation_required') {
    return NextResponse.json({
      error: 'Confirm that you want to submit without the missing attachments.',
      error_code: 'assignment_attachments_confirmation_required',
      missing_attachment_ids: currentMissingAttachmentIds,
    }, { status: 400 })
  }

  const submissionContent = submitRequest.content
  const hasStructuredArtifacts = submissionArtifacts.some(isSubmissionArtifactPresent)
  const hasAcknowledgedMissingAttachments =
    attachmentGate.ok && attachmentGate.acknowledgedMissingAttachments
  if (
    !hasAssignmentSubmissionContent({ content: submissionContent })
    && !hasStructuredArtifacts
    && !hasAcknowledgedMissingAttachments
  ) {
    return NextResponse.json(
      { error: 'No work to submit. Please write something or add an attachment first.' },
      { status: 400 },
    )
  }

  if (
    existingDoc.is_submitted
    && createJsonPatch(existingDoc.content, submissionContent).length > 0
  ) {
    return NextResponse.json(
      { error: 'This assignment is already submitted and cannot be changed.' },
      { status: 409 },
    )
  }

  const palEnabled = isPalEnabled()
  const palEvent = palEnabled && !isClassroomPalRequested()
    ? buildLearningItemCompletedEvent({
        learnerId: userId,
        itemId: assignmentId,
        occurredAt: new Date(),
        dueAt: assignment.due_at,
      })
    : null
  const submitResult = await submitContextualAssignmentDoc({
    supabase: supabase as unknown as ContextualAssignmentSubmissionClient,
    actorId: userId,
    assignmentId,
    content: submissionContent as TiptapContent,
    expectedUpdatedAt: submitRequest.expected_updated_at,
    acknowledgedMissingRequirementIds: hasAcknowledgedMissingAttachments
      ? currentMissingAttachmentIds
      : [],
    ...(palEnabled ? { palEvent } : {}),
  })

  if (!submitResult.ok) {
    if (submitResult.errorCode === 'assignment_submission_requirements_missing') {
      try {
        const latestRequirements = await loadAssignmentSubmissionRequirements(
          supabase,
          assignmentId,
          { requireDataArray: true },
        )
        const latestArtifacts = await loadAssignmentSubmissionArtifactsForDoc(
          supabase,
          existingDoc.id,
          { requireDataArray: true },
        )
        assertContextualAssignmentSubmissionResourceEvidence({
          assignmentId,
          assignmentDocId: existingDoc.id,
          requirements: latestRequirements,
          artifacts: latestArtifacts,
        })
        const latestCompletion = getSubmissionRequirementCompletion(
          latestRequirements,
          latestArtifacts,
        )
        if (latestCompletion.missingRequiredRequirementIds.length === 0) {
          return NextResponse.json({
            error: 'Attachment requirements changed before submission. Review them and try again.',
            error_code: 'assignment_submission_requirements_changed',
          }, { status: 409 })
        }
        return NextResponse.json({
          error: 'Confirm that you want to submit without the missing attachments.',
          error_code: 'assignment_attachments_confirmation_required',
          missing_attachment_ids: latestCompletion.missingRequiredRequirementIds,
        }, { status: 400 })
      } catch {
        return NextResponse.json(
          { error: 'Unable to verify assignment submission resources' },
          { status: 503 },
        )
      }
    }
    return NextResponse.json(
      { error: submitResult.error, error_code: submitResult.errorCode },
      { status: submitResult.status },
    )
  }

  const palDelivery = palEnabled && (palEvent || isClassroomPalRequested())
    ? await attemptImmediatePalEventDelivery({
        event: palEvent,
        supabase,
        membership: { studentId: userId, classroomId: submitResult.classroomId },
      })
    : undefined

  const doc = submitResult.doc
  doc.content = parseContentField(doc.content)
  try {
    const { data: historyEntries } = await supabase
      .from('assignment_doc_history')
      .select('id, assignment_doc_id, patch, snapshot, word_count, char_count, paste_word_count, keystroke_count, trigger, created_at')
      .eq('assignment_doc_id', doc.id)
      .order('created_at', { ascending: true })
    if (
      historyEntries
      && historyEntries.length > 1
      && historyEntries.every((entry) => entry.assignment_doc_id === doc.id)
    ) {
      const result = analyzeAuthenticity(historyEntries as AssignmentDocHistoryEntry[])
      if (result.score !== null) {
        const { error: authError } = await supabase
          .from('assignment_docs')
          .update({ authenticity_score: result.score, authenticity_flags: result.flags })
          .eq('id', doc.id)
          .eq('assignment_id', assignmentId)
          .eq('student_id', userId)
        if (!authError) {
          doc.authenticity_score = result.score
          doc.authenticity_flags = result.flags
        }
      }
    }
  } catch (authError) {
    console.error('Error computing authenticity score:', authError)
  }

  return NextResponse.json({
    doc: sanitizeDocForStudent(doc),
    pal_delivery: palDelivery,
  })
}

// POST /api/assignment-docs/[id]/submit - Submit assignment
export const POST = withErrorHandler('PostAssignmentDocSubmit', async (request, context) => {
  const assignmentAccess = await authorizeContextualAssignmentDocSubmissionRequest(async () => (
    await context.params
  ).id)
  const user = assignmentAccess.user
  const assignmentId = assignmentAccess.assignmentId
  if (!request.body) {
    return NextResponse.json(
      { error: 'Reload this assignment before submitting from an older browser tab.' },
      { status: 409 }
    )
  }
  const submitRequest = assignmentDocSubmitRequestSchema.parse(await request.json())
  const supabase = getServiceRoleClient()

  if (assignmentAccess.mode === 'contextual') {
    return submitContextualMemberAssignment({
      userId: user.id,
      assignmentId,
      submitRequest,
      supabase,
    })
  }

  // Get assignment and verify enrollment
  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .select('classroom_id, is_draft, released_at, due_at')
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
  const requestedAcknowledgementIds = submitRequest.acknowledged_missing_attachment_ids
  const acknowledgedMissingAttachmentIds = new Set(requestedAcknowledgementIds)
  const currentMissingAttachmentIds = submissionCompletion.missingRequiredRequirementIds
  const acknowledgesExactCurrentMissingAttachments =
    submitRequest.allow_missing_attachments
    && requestedAcknowledgementIds.length === acknowledgedMissingAttachmentIds.size
    && acknowledgedMissingAttachmentIds.size === currentMissingAttachmentIds.length
    && currentMissingAttachmentIds.every(
      (requirementId) => acknowledgedMissingAttachmentIds.has(requirementId)
    )
  const attachmentGate = getAssignmentAttachmentSubmissionGate(
    submissionCompletion,
    acknowledgesExactCurrentMissingAttachments
  )

  if (!attachmentGate.ok && attachmentGate.reason === 'invalid_attachments') {
    return NextResponse.json(
      { error: 'Fix invalid attachments before submitting.' },
      { status: 400 }
    )
  }

  if (!attachmentGate.ok && attachmentGate.reason === 'missing_confirmation_required') {
    return NextResponse.json(
      {
        error: 'Confirm that you want to submit without the missing attachments.',
        error_code: 'assignment_attachments_confirmation_required',
        missing_attachment_ids: submissionCompletion.missingRequiredRequirementIds,
      },
      { status: 400 }
    )
  }

  const hasStructuredArtifacts = submissionArtifacts.some(isSubmissionArtifactPresent)

  const hasAcknowledgedMissingAttachments =
    attachmentGate.ok && attachmentGate.acknowledgedMissingAttachments

  if (
    !existingDoc
    || (
      !hasAssignmentSubmissionContent({ content: submissionContent })
      && !hasStructuredArtifacts
      && !hasAcknowledgedMissingAttachments
    )
  ) {
    return NextResponse.json(
      { error: 'No work to submit. Please write something or add an attachment first.' },
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

  const palEnabled = isPalEnabled()
  const palEvent = palEnabled && !isClassroomPalRequested()
    ? buildLearningItemCompletedEvent({
        learnerId: user.id,
        itemId: assignmentId,
        occurredAt: new Date(),
        dueAt: assignment.due_at,
      })
    : null

  const submitResult = await submitAssignmentDocAtomic({
    supabase,
    assignmentId,
    studentId: user.id,
    content: submissionContent as TiptapContent,
    expectedUpdatedAt: submitRequest.expected_updated_at,
    acknowledgedMissingRequirementIds: hasAcknowledgedMissingAttachments
      ? currentMissingAttachmentIds
      : [],
    ...(palEnabled ? { palEvent } : {}),
  })

  if (!submitResult.ok) {
    if (submitResult.errorCode === 'assignment_submission_requirements_missing') {
      const latestRequirements = await loadAssignmentSubmissionRequirements(supabase, assignmentId)
      const latestArtifacts = await loadAssignmentSubmissionArtifactsForDoc(supabase, existingDoc.id)
      const latestCompletion = getSubmissionRequirementCompletion(latestRequirements, latestArtifacts)
      if (latestCompletion.missingRequiredRequirementIds.length === 0) {
        return NextResponse.json(
          {
            error: 'Attachment requirements changed before submission. Review them and try again.',
            error_code: 'assignment_submission_requirements_changed',
          },
          { status: 409 }
        )
      }
      return NextResponse.json(
        {
          error: 'Confirm that you want to submit without the missing attachments.',
          error_code: 'assignment_attachments_confirmation_required',
          missing_attachment_ids: latestCompletion.missingRequiredRequirementIds,
        },
        { status: 400 }
      )
    }
    return NextResponse.json(
      { error: submitResult.error, error_code: submitResult.errorCode },
      { status: submitResult.status }
    )
  }

  const palDelivery = palEnabled && (palEvent || isClassroomPalRequested())
    ? await attemptImmediatePalEventDelivery({ event: palEvent, supabase, membership: { studentId: user.id, classroomId: assignment.classroom_id } })
    : undefined

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

  return NextResponse.json({
    doc: sanitizeDocForStudent(doc),
    pal_delivery: palDelivery,
  })
})
