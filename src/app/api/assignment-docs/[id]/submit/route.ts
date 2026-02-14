import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { countCharacters, countWords, isEmpty } from '@/lib/tiptap-content'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { awardAssignmentSubmission } from '@/lib/server/world-engine'
import { analyzeAuthenticity } from '@/lib/authenticity'
import type { AssignmentDocHistoryEntry, TiptapContent } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Parse content field from database, handling both JSONB and legacy TEXT columns
 */
function parseContentField(content: any): TiptapContent {
  if (typeof content === 'string') {
    try {
      return JSON.parse(content) as TiptapContent
    } catch {
      return { type: 'doc', content: [] }
    }
  }
  return content as TiptapContent
}

// POST /api/assignment-docs/[id]/submit - Submit assignment
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireRole('student')
    const { id: assignmentId } = params
    const supabase = getServiceRoleClient()

    // Get assignment and verify enrollment
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select('classroom_id, track_authenticity, due_at')
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

    // Check if doc exists
    const { data: existingDoc, error: docError } = await supabase
      .from('assignment_docs')
      .select('id, student_id, content')
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

    if (!existingDoc || isEmpty(existingDoc.content)) {
      return NextResponse.json(
        { error: 'No work to submit. Please write something first.' },
        { status: 400 }
      )
    }

    // Update to submitted state
    const { data: doc, error } = await supabase
      .from('assignment_docs')
      .update({
        is_submitted: true,
        submitted_at: new Date().toISOString()
      })
      .eq('id', existingDoc.id)
      .select()
      .single()

    if (error) {
      console.error('Error submitting assignment:', error)
      return NextResponse.json(
        { error: 'Failed to submit' },
        { status: 500 }
      )
    }

    // Parse content if it's a string (for backwards compatibility)
    if (doc) {
      doc.content = parseContentField(doc.content)
    }

    // Award world XP for submission (idempotent per assignment)
    let achievementsResult: { achievements: { achievementId: string; label: string; xp: number }[]; totalXpAwarded: number; newLevel: number; newUnlocks: number[] } | null = null
    try {
      const isOnTime =
        Boolean(doc.submitted_at) &&
        Boolean(assignment.due_at) &&
        new Date(doc.submitted_at as string).getTime() <= new Date(assignment.due_at as string).getTime()

      const response = await awardAssignmentSubmission(
        user.id,
        assignment.classroom_id,
        assignmentId,
        isOnTime
      )
      if (response.ok) {
        achievementsResult = {
          achievements: response.data.xpAwarded > 0
            ? [{
                achievementId: response.data.source,
                label: isOnTime ? 'On-time Submission' : 'Late Submission',
                xp: response.data.xpAwarded,
              }]
            : [],
          totalXpAwarded: response.data.xpAwarded,
          newLevel: response.data.newLevel,
          newUnlocks: response.data.newUnlocks,
        }
      }
    } catch (err) {
      console.error('Assignment world reward:', err)
    }

    try {
      await supabase.from('assignment_doc_history').insert({
        assignment_doc_id: existingDoc.id,
        patch: null,
        snapshot: existingDoc.content,
        word_count: countWords(existingDoc.content),
        char_count: countCharacters(existingDoc.content),
        trigger: 'submit',
      })
    } catch (historyError) {
      console.error('Error saving assignment doc history:', historyError)
    }

    // Compute authenticity score from history (if tracking is enabled).
    if (assignment.track_authenticity !== false) {
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
    }

    return NextResponse.json({ doc, achievements: achievementsResult })
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
    console.error('Submit assignment error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
