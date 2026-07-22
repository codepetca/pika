import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { reconstructAssignmentDocContent } from '@/lib/assignment-doc-history'
import { parseContentField } from '@/lib/tiptap-content'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { isAssignmentVisibleToStudents } from '@/lib/server/assignments'
import type { AssignmentDocHistoryEntry } from '@/types'
import { withErrorHandler } from '@/lib/api-handler'
import { sanitizeDocForStudent } from '@/lib/assignments'
import { saveAssignmentDocAtomic } from '@/lib/server/assignment-doc-submissions'
import { assignmentDocRestoreRequestSchema } from '@/lib/validations/assignment-doc-submissions'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostRestoreAssignmentDoc', async (request, context) => {
  const user = await requireRole('student')
  const { id: assignmentId } = await context.params
  const { history_id: historyId } = assignmentDocRestoreRequestSchema.parse(await request.json())

  const supabase = getServiceRoleClient()

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

  const { data: doc, error: docError } = await supabase
    .from('assignment_docs')
    .select('id, is_submitted, content, updated_at')
    .eq('assignment_id', assignmentId)
    .eq('student_id', user.id)
    .single()

  if (docError || !doc) {
    return NextResponse.json(
      { error: 'Assignment doc not found' },
      { status: 404 }
    )
  }

  if (doc.is_submitted) {
    return NextResponse.json(
      { error: 'Cannot restore a submitted document' },
      { status: 403 }
    )
  }

  const { data: history, error: historyError } = await supabase
    .from('assignment_doc_history')
    .select('id, assignment_doc_id, patch, snapshot, word_count, char_count, trigger, created_at')
    .eq('assignment_doc_id', doc.id)
    .order('created_at', { ascending: true })

  if (historyError) {
    console.error('Error fetching assignment doc history:', historyError)
    return NextResponse.json(
      { error: 'Failed to fetch history' },
      { status: 500 }
    )
  }

  const entries = (history || []) as AssignmentDocHistoryEntry[]

  // Verify the history entry belongs to this document
  const targetEntry = entries.find(entry => entry.id === historyId)
  if (!targetEntry) {
    return NextResponse.json(
      { error: 'History entry not found' },
      { status: 404 }
    )
  }

  if (targetEntry.assignment_doc_id !== doc.id) {
    return NextResponse.json(
      { error: 'History entry does not belong to this document' },
      { status: 403 }
    )
  }

  const restoredContent = reconstructAssignmentDocContent(entries, historyId)
  if (!restoredContent) {
    return NextResponse.json(
      { error: 'Failed to reconstruct document content' },
      { status: 500 }
    )
  }

  const saveSessionId = randomUUID()
  const restoreResult = await saveAssignmentDocAtomic({
    supabase,
    assignmentId,
    studentId: user.id,
    previousContent: parseContentField(doc.content),
    content: restoredContent,
    expectedUpdatedAt: doc.updated_at,
    trigger: 'restore',
    pasteWordCount: 0,
    keystrokeCount: 0,
    saveSessionId,
    saveSequence: 1,
    metricSessionId: saveSessionId,
  })

  if (!restoreResult.ok) {
    return NextResponse.json(
      { error: restoreResult.error },
      { status: restoreResult.status }
    )
  }

  return NextResponse.json({ doc: sanitizeDocForStudent(restoreResult.doc) })
})
