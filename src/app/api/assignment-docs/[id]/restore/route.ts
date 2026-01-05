import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { reconstructAssignmentDocContent } from '@/lib/assignment-doc-history'
import type { AssignmentDocHistoryEntry } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireRole('student')
    const { id: assignmentId } = params
    const body = await request.json()
    const { history_id: historyId } = body as { history_id?: string }

    if (!historyId) {
      return NextResponse.json(
        { error: 'history_id is required' },
        { status: 400 }
      )
    }

    const supabase = getServiceRoleClient()

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

    const { data: enrollment } = await supabase
      .from('classroom_enrollments')
      .select('id')
      .eq('classroom_id', assignment.classroom_id)
      .eq('student_id', user.id)
      .single()

    if (!enrollment) {
      return NextResponse.json(
        { error: 'Not enrolled in this classroom' },
        { status: 403 }
      )
    }

    const { data: doc, error: docError } = await supabase
      .from('assignment_docs')
      .select('id, is_submitted')
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
    const restoredContent = reconstructAssignmentDocContent(entries, historyId)
    if (!restoredContent) {
      return NextResponse.json(
        { error: 'History entry not found' },
        { status: 404 }
      )
    }

    const { data: updatedDoc, error: updateError } = await supabase
      .from('assignment_docs')
      .update({ content: restoredContent })
      .eq('id', doc.id)
      .select()
      .single()

    if (updateError) {
      console.error('Error restoring assignment doc:', updateError)
      return NextResponse.json(
        { error: 'Failed to restore document' },
        { status: 500 }
      )
    }

    return NextResponse.json({ doc: updatedDoc })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    console.error('Restore assignment doc error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
