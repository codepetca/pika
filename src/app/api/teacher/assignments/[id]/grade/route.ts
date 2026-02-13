import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/assignments/[id]/grade - Save grade for a student
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id } = await params
    const body = await request.json()
    const { student_id, score_completion, score_thinking, score_workflow, feedback } = body

    if (!student_id || typeof student_id !== 'string') {
      return NextResponse.json({ error: 'student_id is required' }, { status: 400 })
    }

    // Validate scores
    for (const [name, val] of Object.entries({ score_completion, score_thinking, score_workflow })) {
      const n = Number(val)
      if (!Number.isInteger(n) || n < 0 || n > 10) {
        return NextResponse.json({ error: `${name} must be an integer 0–10` }, { status: 400 })
      }
    }

    if (typeof feedback !== 'string') {
      return NextResponse.json({ error: 'feedback must be a string' }, { status: 400 })
    }

    const supabase = getServiceRoleClient()

    // Verify teacher owns this assignment
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select(`
        *,
        classrooms!inner (
          teacher_id
        )
      `)
      .eq('id', id)
      .single()

    if (assignmentError || !assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })
    }

    if (assignment.classrooms.teacher_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { data: enrollment } = await supabase
      .from('classroom_enrollments')
      .select('id')
      .eq('classroom_id', assignment.classroom_id)
      .eq('student_id', student_id)
      .maybeSingle()

    if (!enrollment) {
      return NextResponse.json({ error: 'Student is not enrolled in this classroom' }, { status: 400 })
    }

    // Upsert supports grading students even when no submission/doc exists yet.
    const { data: doc, error: upsertError } = await supabase
      .from('assignment_docs')
      .upsert({
        assignment_id: id,
        student_id,
        score_completion: Number(score_completion),
        score_thinking: Number(score_thinking),
        score_workflow: Number(score_workflow),
        feedback,
        graded_at: new Date().toISOString(),
        graded_by: 'teacher',
      }, { onConflict: 'assignment_id,student_id' })
      .select()
      .single()

    if (upsertError) {
      console.error('Error saving grade:', upsertError)
      return NextResponse.json({ error: 'Failed to save grade' }, { status: 500 })
    }

    return NextResponse.json({ doc })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Grade assignment error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
