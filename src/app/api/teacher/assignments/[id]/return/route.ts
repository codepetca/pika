import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/assignments/[id]/return - Return graded work to students
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

    if (student_ids.length > 100) {
      return NextResponse.json({ error: 'Cannot return more than 100 students at once' }, { status: 400 })
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

    const now = new Date().toISOString()
    const { data: rpcData, error: rpcError } = await supabase.rpc('return_assignment_docs_atomic', {
      p_assignment_id: id,
      p_student_ids: student_ids,
      p_teacher_id: user.id,
      p_now: now,
    })

    if (rpcError) {
      console.error('Error returning assignment docs:', rpcError)
      return NextResponse.json({ error: 'Failed to return docs' }, { status: 500 })
    }

    const resultRow = Array.isArray(rpcData) ? rpcData[0] : rpcData
    const returnedCount = Number(resultRow?.returned_count ?? 0)
    const skippedCount = Number(resultRow?.skipped_count ?? Math.max(student_ids.length - returnedCount, 0))

    return NextResponse.json({
      returned_count: returnedCount,
      skipped_count: skippedCount,
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Return assignment error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
