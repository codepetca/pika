import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { countCharacters, countWords, isValidTiptapContent, parseContentField } from '@/lib/tiptap-content'
import { sanitizeDocForStudent } from '@/lib/assignments'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import {
  insertVersionedBaselineHistory,
  persistVersionedHistory,
} from '@/lib/server/versioned-history'
import { isAssignmentVisibleToStudents } from '@/lib/server/assignments'
import { withErrorHandler } from '@/lib/api-handler'
import { loadAssignmentFeedbackEntries } from '@/lib/server/assignment-feedback'
import type { AssignmentDocHistoryEntry, AssignmentDocHistoryTrigger, TiptapContent } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const HISTORY_MIN_INTERVAL_MS = 10_000
const HISTORY_SELECT_FIELDS =
  'id, assignment_doc_id, patch, snapshot, word_count, char_count, paste_word_count, keystroke_count, trigger, created_at'

function buildHistoryMetrics(
  content: TiptapContent,
  pasteWordCount: number,
  keystrokeCount: number
) {
  return {
    word_count: countWords(content),
    char_count: countCharacters(content),
    paste_word_count: pasteWordCount,
    keystroke_count: keystrokeCount,
  }
}

// GET /api/assignment-docs/[id] - Get assignment doc (creates if doesn't exist)
// The [id] here is the assignment_id, not the doc id
export const GET = withErrorHandler('GetAssignmentDoc', async (request, context) => {
  const user = await requireRole('student')
  const { id: assignmentId } = await context.params
  const supabase = getServiceRoleClient()

  // Get assignment and verify student is enrolled
  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .select('*')
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

  // Get or create assignment doc for this student
  const { data: existingDoc, error: docError } = await supabase
    .from('assignment_docs')
    .select('*')
    .eq('assignment_id', assignmentId)
    .eq('student_id', user.id)
    .single()

  // Track whether this is the first time viewing (for notification decrement)
  let wasFirstView = false

  if (docError) {
    if (docError.code === 'PGRST116') {
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
          return NextResponse.json({
            assignment,
            doc: raced ? sanitizeDocForStudent(raced) : raced,
            feedback_entries: feedbackEntries,
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
      return NextResponse.json({ assignment, doc: created, feedback_entries: [], wasFirstView: true })
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

  // Mark as viewed if not already (for notification tracking)
  if (existingDoc && existingDoc.viewed_at === null) {
    const { error: viewedError } = await supabase
      .from('assignment_docs')
      .update({ viewed_at: new Date().toISOString() })
      .eq('id', existingDoc.id)

    if (viewedError) {
      console.error('Error updating viewed_at:', viewedError)
      // Non-fatal: continue with response, but don't mark as first view
    } else {
      existingDoc.viewed_at = new Date().toISOString()
      wasFirstView = true
    }
  }

  const feedbackEntries = await loadAssignmentFeedbackEntries(assignmentId, user.id)

  return NextResponse.json({
    assignment,
    doc: sanitizeDocForStudent(existingDoc),
    feedback_entries: feedbackEntries,
    wasFirstView,
  })
})

// PATCH /api/assignment-docs/[id] - Save content (autosave)
export const PATCH = withErrorHandler('PatchAssignmentDoc', async (request, context) => {
  const user = await requireRole('student')
  const { id: assignmentId } = await context.params
  const body = await request.json()
  const { content, trigger } = body as {
    content: TiptapContent
    trigger?: AssignmentDocHistoryTrigger
  }
  const repoUrl = typeof body.repo_url === 'string' ? body.repo_url.trim() : undefined
  const githubUsername = typeof body.github_username === 'string' ? body.github_username.trim() : undefined
  // Clamp client-reported tracking values to non-negative integers
  const paste_word_count = Math.max(0, Math.round(Number(body.paste_word_count) || 0))
  const keystroke_count = Math.max(0, Math.round(Number(body.keystroke_count) || 0))

  if (content === undefined) {
    return NextResponse.json(
      { error: 'Content is required' },
      { status: 400 }
    )
  }

  if (trigger && trigger !== 'autosave' && trigger !== 'blur') {
    return NextResponse.json(
      { error: 'Invalid trigger' },
      { status: 400 }
    )
  }

  if (!isValidTiptapContent(content)) {
    return NextResponse.json(
      { error: 'Invalid content format' },
      { status: 400 }
    )
  }

  const supabase = getServiceRoleClient()
  let historyEntry: AssignmentDocHistoryEntry | null = null

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
    .select('id, student_id, is_submitted, content, repo_url, github_username')
    .eq('assignment_id', assignmentId)
    .eq('student_id', user.id)
    .single()

  if (docFetchError) {
    if (docFetchError.code === 'PGRST116') {
      const { data: created, error: createError } = await supabase
        .from('assignment_docs')
        .insert({
          assignment_id: assignmentId,
          student_id: user.id,
          content,
          repo_url: repoUrl ?? null,
          github_username: githubUsername ?? null,
          is_submitted: false,
          submitted_at: null,
        })
        .select()
        .single()

      if (createError || !created) {
        console.error('Error creating assignment doc:', createError)
        return NextResponse.json(
          { error: 'Failed to save' },
          { status: 500 }
        )
      }

      try {
        historyEntry = await insertVersionedBaselineHistory<TiptapContent>({
          supabase,
          table: 'assignment_doc_history',
          ownerColumn: 'assignment_doc_id',
          ownerId: created.id,
          content,
          selectFields: HISTORY_SELECT_FIELDS,
          trigger: 'baseline',
          buildMetrics: (currentContent: TiptapContent) =>
            buildHistoryMetrics(currentContent, paste_word_count, keystroke_count),
        })
      } catch (historyError) {
        console.error('Error saving assignment doc history:', historyError)
      }

      return NextResponse.json({ doc: created, historyEntry })
    }
    console.error('Error fetching assignment doc:', docFetchError)
    return NextResponse.json(
      { error: 'Failed to fetch assignment doc' },
      { status: 500 }
    )
  }

  if (existingDoc.is_submitted) {
    return NextResponse.json(
      { error: 'Cannot edit a submitted document' },
      { status: 403 }
    )
  }

  const beforeContent = parseContentField(existingDoc.content)

  const { data: doc, error } = await supabase
    .from('assignment_docs')
    .update({
      content,
      ...(repoUrl !== undefined ? { repo_url: repoUrl || null } : {}),
      ...(githubUsername !== undefined ? { github_username: githubUsername || null } : {}),
    })
    .eq('id', existingDoc.id)
    .select()
    .single()

  if (error) {
    console.error('Error saving assignment doc:', error)
    return NextResponse.json(
      { error: 'Failed to save' },
      { status: 500 }
    )
  }

  // Parse content if it's a string (for backwards compatibility)
  if (doc) {
    doc.content = parseContentField(doc.content)
  }

  try {
    historyEntry = await persistVersionedHistory<TiptapContent>({
      supabase,
      table: 'assignment_doc_history',
      ownerColumn: 'assignment_doc_id',
      ownerId: existingDoc.id,
      previousContent: beforeContent,
      nextContent: content,
      selectFields: HISTORY_SELECT_FIELDS,
      trigger: trigger ?? 'autosave',
      historyMinIntervalMs: HISTORY_MIN_INTERVAL_MS,
      buildMetrics: (currentContent: TiptapContent) =>
        buildHistoryMetrics(currentContent, paste_word_count, keystroke_count),
    })
  } catch (historyError) {
    console.error('Error saving assignment doc history:', historyError)
  }

  return NextResponse.json({ doc, historyEntry })
})
