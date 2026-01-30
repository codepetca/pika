import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { countCharacters, countWords, isValidTiptapContent } from '@/lib/tiptap-content'
import { sanitizeDocForStudent } from '@/lib/assignments'
import { createJsonPatch, shouldStoreSnapshot } from '@/lib/json-patch'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import type { AssignmentDocHistoryEntry, AssignmentDocHistoryTrigger, TiptapContent } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const HISTORY_MIN_INTERVAL_MS = 10_000
const HISTORY_SELECT_FIELDS =
  'id, assignment_doc_id, patch, snapshot, word_count, char_count, trigger, created_at'

/**
 * Parse content field from database, handling both JSONB and legacy TEXT columns
 * If content is a string (from TEXT column), parse it as JSON
 * If content is already an object (from JSONB column), return as-is
 */
function parseContentField(content: any): TiptapContent {
  if (typeof content === 'string') {
    try {
      return JSON.parse(content) as TiptapContent
    } catch {
      // If parsing fails, return empty doc
      return { type: 'doc', content: [] }
    }
  }
  return content as TiptapContent
}

// GET /api/assignment-docs/[id] - Get assignment doc (creates if doesn't exist)
// The [id] here is the assignment_id, not the doc id
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireRole('student')
    const { id: assignmentId } = params
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
            return NextResponse.json({ assignment, doc: raced ? sanitizeDocForStudent(raced) : raced, wasFirstView: false })
          }

          console.error('Error creating assignment doc:', createError)
          return NextResponse.json(
            { error: 'Failed to create assignment doc' },
            { status: 500 }
          )
        }

        // New doc created = first view
        return NextResponse.json({ assignment, doc: created, wasFirstView: true })
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

    return NextResponse.json({ assignment, doc: sanitizeDocForStudent(existingDoc), wasFirstView })
  } catch (error: any) {
    // Authentication error (401)
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Authorization error (403)
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // All other errors (500)
    console.error('Get assignment doc error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// PATCH /api/assignment-docs/[id] - Save content (autosave)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireRole('student')
    const { id: assignmentId } = params
    const body = await request.json()
    const { content, trigger } = body as { content: TiptapContent; trigger?: AssignmentDocHistoryTrigger }

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
      .select('classroom_id')
      .eq('id', assignmentId)
      .single()

    if (assignmentError || !assignment) {
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
      .select('id, student_id, is_submitted, content')
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
          const { data: createdHistory, error: historyError } = await supabase
            .from('assignment_doc_history')
            .insert({
              assignment_doc_id: created.id,
              patch: null,
              snapshot: content,
              word_count: countWords(content),
              char_count: countCharacters(content),
              trigger: 'baseline',
            })
            .select(HISTORY_SELECT_FIELDS)
            .single()

          if (historyError) {
            throw historyError
          }

          historyEntry = createdHistory
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
    const patch = createJsonPatch(beforeContent, content)

    const { data: doc, error } = await supabase
      .from('assignment_docs')
      .update({
        content
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

    if (patch.length > 0) {
      const { data: lastHistory, error: lastHistoryError } = await supabase
        .from('assignment_doc_history')
        .select('id, created_at, snapshot')
        .eq('assignment_doc_id', existingDoc.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (lastHistoryError) {
        console.error('Error fetching assignment doc history:', lastHistoryError)
      }

      const now = Date.now()
      const lastCreatedAt = lastHistory?.created_at
        ? new Date(lastHistory.created_at).getTime()
        : null
      const isRateLimited = lastCreatedAt !== null && now - lastCreatedAt < HISTORY_MIN_INTERVAL_MS

      if (!lastHistory) {
        try {
          const { data: createdHistory, error: historyError } = await supabase
            .from('assignment_doc_history')
            .insert({
              assignment_doc_id: existingDoc.id,
              patch: null,
              snapshot: content,
              word_count: countWords(content),
              char_count: countCharacters(content),
              trigger: 'baseline',
            })
            .select(HISTORY_SELECT_FIELDS)
            .single()

          if (historyError) {
            throw historyError
          }

          historyEntry = createdHistory
        } catch (historyError) {
          console.error('Error saving assignment doc history:', historyError)
        }
      } else if (isRateLimited) {
        try {
          const { data: updatedHistory, error: historyError } = await supabase
            .from('assignment_doc_history')
            .update({
              patch: null,
              snapshot: content,
              word_count: countWords(content),
              char_count: countCharacters(content),
              trigger: trigger ?? 'autosave',
              created_at: new Date().toISOString(),
            })
            .eq('id', lastHistory.id)
            .select(HISTORY_SELECT_FIELDS)
            .single()

          if (historyError) {
            throw historyError
          }

          historyEntry = updatedHistory
        } catch (historyError) {
          console.error('Error updating assignment doc history:', historyError)
        }
      } else {
        const storeSnapshot = shouldStoreSnapshot(patch, content)
        try {
          const { data: createdHistory, error: historyError } = await supabase
            .from('assignment_doc_history')
            .insert({
              assignment_doc_id: existingDoc.id,
              patch: storeSnapshot ? null : patch,
              snapshot: storeSnapshot ? content : null,
              word_count: countWords(content),
              char_count: countCharacters(content),
              trigger: trigger ?? 'autosave',
            })
            .select(HISTORY_SELECT_FIELDS)
            .single()

          if (historyError) {
            throw historyError
          }

          historyEntry = createdHistory
        } catch (historyError) {
          console.error('Error saving assignment doc history:', historyError)
        }
      }
    }

    return NextResponse.json({ doc, historyEntry })
  } catch (error: any) {
    // Authentication error (401)
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Authorization error (403)
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // All other errors (500)
    console.error('Save assignment doc error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
