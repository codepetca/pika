import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireRole('teacher')
    const body = await request.json()

    const classroomId = String(body.classroom_id || '').trim()
    const quizId = String(body.quiz_id || '').trim()
    const studentId = String(body.student_id || '').trim()
    const override = body.manual_override_score

    if (!classroomId || !quizId || !studentId) {
      return NextResponse.json(
        { error: 'classroom_id, quiz_id, and student_id are required' },
        { status: 400 }
      )
    }

    if (override != null && (typeof override !== 'number' || Number.isNaN(override) || override < 0)) {
      return NextResponse.json({ error: 'manual_override_score must be null or a non-negative number' }, { status: 400 })
    }

    const supabase = getServiceRoleClient()

    const { data: quiz, error: quizError } = await supabase
      .from('quizzes')
      .select('id, classroom_id, points_possible, classrooms!inner(teacher_id)')
      .eq('id', quizId)
      .single()

    if (quizError || !quiz) {
      return NextResponse.json({ error: 'Quiz not found' }, { status: 404 })
    }

    if (quiz.classroom_id !== classroomId) {
      return NextResponse.json({ error: 'Quiz does not belong to classroom' }, { status: 400 })
    }

    if (quiz.classrooms.teacher_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const max = Number(quiz.points_possible ?? 100)
    if (override != null && override > max) {
      return NextResponse.json({ error: `manual_override_score cannot exceed points_possible (${max})` }, { status: 400 })
    }

    const { data: enrollment } = await supabase
      .from('classroom_enrollments')
      .select('id')
      .eq('classroom_id', classroomId)
      .eq('student_id', studentId)
      .maybeSingle()

    if (!enrollment) {
      return NextResponse.json({ error: 'Student is not enrolled in this classroom' }, { status: 400 })
    }

    const { error } = await supabase
      .from('quiz_student_scores')
      .upsert({
        quiz_id: quizId,
        student_id: studentId,
        manual_override_score: override,
        graded_at: new Date().toISOString(),
        graded_by: 'teacher',
      }, { onConflict: 'quiz_id,student_id' })

    if (error) {
      console.error('Error saving quiz override:', error)
      return NextResponse.json({ error: 'Failed to save quiz override' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Quiz override PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
