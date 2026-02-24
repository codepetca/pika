import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { assertStudentCanAccessTest, assertTeacherOwnsTest } from '@/lib/server/tests'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/student/tests/[id]/history - Get test draft history for student/teacher
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth()
    const { id: testId } = await params
    const { searchParams } = new URL(request.url)
    const requestedStudentId = searchParams.get('student_id')
    const supabase = getServiceRoleClient()

    let studentId = user.id

    if (user.role === 'teacher') {
      if (!requestedStudentId) {
        return NextResponse.json({ error: 'student_id is required' }, { status: 400 })
      }

      const access = await assertTeacherOwnsTest(user.id, testId)
      if (!access.ok) {
        return NextResponse.json({ error: access.error }, { status: access.status })
      }

      studentId = requestedStudentId
      const { data: enrollment } = await supabase
        .from('classroom_enrollments')
        .select('id')
        .eq('classroom_id', access.test.classroom_id)
        .eq('student_id', studentId)
        .single()

      if (!enrollment) {
        return NextResponse.json({ error: 'Not enrolled in this classroom' }, { status: 403 })
      }
    } else {
      const access = await assertStudentCanAccessTest(user.id, testId)
      if (!access.ok) {
        return NextResponse.json({ error: access.error }, { status: access.status })
      }
    }

    const { data: attempt, error: attemptError } = await supabase
      .from('test_attempts')
      .select('id')
      .eq('test_id', testId)
      .eq('student_id', studentId)
      .maybeSingle()

    if (attemptError?.code === 'PGRST205') {
      return NextResponse.json({ history: [], attemptId: null, migration_required: true })
    }

    if (attemptError) {
      console.error('Error fetching test attempt for history:', attemptError)
      return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 })
    }

    if (!attempt) {
      return NextResponse.json({ history: [], attemptId: null })
    }

    const { data: history, error: historyError } = await supabase
      .from('test_attempt_history')
      .select('id, test_attempt_id, patch, snapshot, word_count, char_count, paste_word_count, keystroke_count, trigger, created_at')
      .eq('test_attempt_id', attempt.id)
      .order('created_at', { ascending: false })

    if (historyError) {
      console.error('Error fetching test attempt history:', historyError)
      return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 })
    }

    return NextResponse.json({ history: history || [], attemptId: attempt.id })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.error('Get test history error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
