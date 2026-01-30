import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { gradeStudentWork } from '@/lib/ai-grading'
import { extractPlainText } from '@/lib/tiptap-content'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const CONCURRENCY_LIMIT = 5

// POST /api/teacher/assignments/[id]/auto-grade - AI grade selected students
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id } = await params
    const body = await request.json()
    const { student_ids } = body

    if (!Array.isArray(student_ids) || student_ids.length === 0) {
      return NextResponse.json({ error: 'student_ids array is required' }, { status: 400 })
    }

    const supabase = getServiceRoleClient()

    // Verify teacher owns this assignment
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select('*, classrooms!inner(teacher_id)')
      .eq('id', id)
      .single()

    if (assignmentError || !assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })
    }

    if (assignment.classrooms.teacher_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Fetch all docs for the given students
    const { data: docs, error: docsError } = await supabase
      .from('assignment_docs')
      .select('*')
      .eq('assignment_id', id)
      .in('student_id', student_ids)

    if (docsError) {
      console.error('Error fetching docs for auto-grade:', docsError)
      return NextResponse.json({ error: 'Failed to fetch student docs' }, { status: 500 })
    }

    const instructionsText = assignment.rich_instructions
      ? extractPlainText(assignment.rich_instructions)
      : assignment.description || ''

    // Process with concurrency limit
    let gradedCount = 0
    let skippedCount = 0
    const errors: string[] = []

    const queue = [...(docs || [])]

    async function processOne() {
      while (queue.length > 0) {
        const doc = queue.shift()!

        // Skip docs with no content (empty work)
        if (!doc.content || (typeof doc.content === 'object' && (!doc.content.content || doc.content.content.length === 0))) {
          skippedCount++
          continue
        }

        try {
          const result = await gradeStudentWork({
            assignmentTitle: assignment.title,
            instructions: instructionsText,
            studentWork: doc.content,
            previousFeedback: doc.feedback,
          })

          const { error: updateError } = await supabase
            .from('assignment_docs')
            .update({
              score_completion: result.score_completion,
              score_thinking: result.score_thinking,
              score_workflow: result.score_workflow,
              feedback: result.feedback,
              graded_at: new Date().toISOString(),
              graded_by: `ai:${result.model}`,
            })
            .eq('id', doc.id)

          if (updateError) {
            errors.push(`Failed to save grade for student ${doc.student_id}`)
          } else {
            gradedCount++
          }
        } catch (err: any) {
          errors.push(`${doc.student_id}: ${err.message}`)
          skippedCount++
        }
      }
    }

    // Run workers in parallel up to concurrency limit
    const workers = Array.from(
      { length: Math.min(CONCURRENCY_LIMIT, queue.length) },
      () => processOne()
    )
    await Promise.all(workers)

    // Count students with no doc at all as skipped
    const docsStudentIds = new Set((docs || []).map((d) => d.student_id))
    const noDocCount = student_ids.filter((sid) => !docsStudentIds.has(sid)).length
    skippedCount += noDocCount

    return NextResponse.json({
      graded_count: gradedCount,
      skipped_count: skippedCount,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Auto-grade error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
