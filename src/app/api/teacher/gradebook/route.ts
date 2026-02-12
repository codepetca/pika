import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { calculateFinalPercent } from '@/lib/gradebook'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const DEFAULT_SETTINGS = {
  use_weights: false,
  assignments_weight: 70,
  quizzes_weight: 30,
}

async function assertTeacherOwnsClassroom(teacherId: string, classroomId: string) {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase
    .from('classrooms')
    .select('id, teacher_id, archived_at')
    .eq('id', classroomId)
    .single()

  if (error || !data) return { ok: false as const, status: 404 as const, error: 'Classroom not found' }
  if (data.teacher_id !== teacherId) return { ok: false as const, status: 403 as const, error: 'Forbidden' }
  return { ok: true as const, classroom: data }
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireRole('teacher')
    const classroomId = request.nextUrl.searchParams.get('classroom_id')

    if (!classroomId) {
      return NextResponse.json({ error: 'classroom_id is required' }, { status: 400 })
    }

    const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }

    const supabase = getServiceRoleClient()

    const { data: settingsRow } = await supabase
      .from('gradebook_settings')
      .select('use_weights, assignments_weight, quizzes_weight')
      .eq('classroom_id', classroomId)
      .maybeSingle()

    const settings = settingsRow || DEFAULT_SETTINGS

    const { data: enrollments, error: enrollmentError } = await supabase
      .from('classroom_enrollments')
      .select('student_id, users!inner(email)')
      .eq('classroom_id', classroomId)

    if (enrollmentError) {
      console.error('Error loading enrollments:', enrollmentError)
      return NextResponse.json({ error: 'Failed to load roster' }, { status: 500 })
    }

    const studentIds = (enrollments || []).map((row) => row.student_id)
    const { data: profiles } = studentIds.length
      ? await supabase
          .from('student_profiles')
          .select('user_id, first_name, last_name')
          .in('user_id', studentIds)
      : { data: [] as Array<{ user_id: string; first_name: string | null; last_name: string | null }> }

    const profileMap = new Map((profiles || []).map((p) => [p.user_id, p]))

    const { data: assignments } = await supabase
      .from('assignments')
      .select('id, title, points_possible, include_in_final, is_draft')
      .eq('classroom_id', classroomId)
      .eq('is_draft', false)

    const assignmentIds = (assignments || []).map((a) => a.id)
    const { data: docs } = assignmentIds.length
      ? await supabase
          .from('assignment_docs')
          .select('assignment_id, student_id, score_completion, score_thinking, score_workflow')
          .in('assignment_id', assignmentIds)
      : { data: [] as Array<any> }

    const assignmentMap = new Map((assignments || []).map((a) => [a.id, a]))
    const assignmentRowsByStudent = new Map<string, Array<{ earned: number; possible: number }>>()

    for (const doc of docs || []) {
      const assignment = assignmentMap.get(doc.assignment_id)
      if (!assignment || assignment.include_in_final === false) continue

      const sc = doc.score_completion
      const st = doc.score_thinking
      const sw = doc.score_workflow
      if (sc == null || st == null || sw == null) continue

      const raw = Number(sc) + Number(st) + Number(sw)
      const possible = Number(assignment.points_possible ?? 30)
      const earned = (raw / 30) * possible

      const rows = assignmentRowsByStudent.get(doc.student_id) || []
      rows.push({ earned, possible })
      assignmentRowsByStudent.set(doc.student_id, rows)
    }

    const { data: quizzes } = await supabase
      .from('quizzes')
      .select('id, title, points_possible, include_in_final')
      .eq('classroom_id', classroomId)

    const quizIds = (quizzes || []).map((q) => q.id)

    const { data: quizQuestions } = quizIds.length
      ? await supabase
          .from('quiz_questions')
          .select('id, quiz_id, correct_option')
          .in('quiz_id', quizIds)
      : { data: [] as Array<any> }

    const { data: quizResponses } = quizIds.length && studentIds.length
      ? await supabase
          .from('quiz_responses')
          .select('quiz_id, question_id, student_id, selected_option')
          .in('quiz_id', quizIds)
          .in('student_id', studentIds)
      : { data: [] as Array<any> }

    const { data: overrides } = quizIds.length && studentIds.length
      ? await supabase
          .from('quiz_student_scores')
          .select('quiz_id, student_id, manual_override_score')
          .in('quiz_id', quizIds)
          .in('student_id', studentIds)
      : { data: [] as Array<any> }

    const quizMap = new Map((quizzes || []).map((q) => [q.id, q]))
    const questionMap = new Map<string, { quiz_id: string; correct_option: number | null }>()
    for (const q of quizQuestions || []) {
      questionMap.set(q.id, { quiz_id: q.quiz_id, correct_option: q.correct_option })
    }

    const responsesByStudentQuiz = new Map<string, Map<string, Array<{ question_id: string; selected_option: number }>>>()
    for (const response of quizResponses || []) {
      const byQuiz = responsesByStudentQuiz.get(response.student_id) || new Map<string, Array<{ question_id: string; selected_option: number }>>()
      const rows = byQuiz.get(response.quiz_id) || []
      rows.push({ question_id: response.question_id, selected_option: response.selected_option })
      byQuiz.set(response.quiz_id, rows)
      responsesByStudentQuiz.set(response.student_id, byQuiz)
    }

    const overrideMap = new Map<string, number | null>()
    for (const row of overrides || []) {
      overrideMap.set(`${row.quiz_id}:${row.student_id}`, row.manual_override_score)
    }

    const questionIdsByQuiz = new Map<string, Array<{ id: string; correct_option: number | null }>>()
    for (const question of quizQuestions || []) {
      const rows = questionIdsByQuiz.get(question.quiz_id) || []
      rows.push({ id: question.id, correct_option: question.correct_option })
      questionIdsByQuiz.set(question.quiz_id, rows)
    }

    const quizRowsByStudent = new Map<string, Array<{ earned: number; possible: number }>>()

    for (const studentId of studentIds) {
      for (const quizId of quizIds) {
        const quiz = quizMap.get(quizId)
        if (!quiz || quiz.include_in_final === false) continue

        const possible = Number(quiz.points_possible ?? 100)
        const override = overrideMap.get(`${quizId}:${studentId}`)

        let earned: number | null = override ?? null
        if (earned == null) {
          const quizQuestionsForQuiz = questionIdsByQuiz.get(quizId) || []
          const scorable = quizQuestionsForQuiz.filter((q) => q.correct_option != null)
          if (scorable.length > 0) {
            const selected = responsesByStudentQuiz.get(studentId)?.get(quizId) || []
            const selectedByQuestion = new Map(selected.map((s) => [s.question_id, s.selected_option]))

            let correctCount = 0
            for (const question of scorable) {
              const studentAnswer = selectedByQuestion.get(question.id)
              if (studentAnswer != null && studentAnswer === question.correct_option) {
                correctCount += 1
              }
            }

            // A quiz with no responses still participates as 0 when it has scorable questions.
            earned = (correctCount / scorable.length) * possible
          }
        }

        if (earned == null) continue

        const rows = quizRowsByStudent.get(studentId) || []
        rows.push({ earned, possible })
        quizRowsByStudent.set(studentId, rows)
      }
    }

    const students = (enrollments || []).map((enrollment) => {
      const studentId = enrollment.student_id
      const profile = profileMap.get(studentId)
      const calc = calculateFinalPercent({
        useWeights: settings.use_weights,
        assignmentsWeight: settings.assignments_weight,
        quizzesWeight: settings.quizzes_weight,
        assignments: assignmentRowsByStudent.get(studentId) || [],
        quizzes: quizRowsByStudent.get(studentId) || [],
      })

      return {
        student_id: studentId,
        student_email: (enrollment.users as unknown as { email: string }).email,
        student_first_name: profile?.first_name ?? null,
        student_last_name: profile?.last_name ?? null,
        assignments_percent: calc.assignmentsPercent,
        quizzes_percent: calc.quizzesPercent,
        final_percent: calc.finalPercent,
      }
    })

    students.sort((a, b) => {
      const aName = `${a.student_last_name || ''} ${a.student_first_name || ''}`.trim() || a.student_email
      const bName = `${b.student_last_name || ''} ${b.student_first_name || ''}`.trim() || b.student_email
      return aName.localeCompare(bName)
    })

    return NextResponse.json({
      settings,
      students,
      totals: {
        assignments: assignments?.length || 0,
        quizzes: quizzes?.length || 0,
      },
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Gradebook GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireRole('teacher')
    const body = await request.json()
    const classroomId = String(body.classroom_id || '').trim()

    if (!classroomId) {
      return NextResponse.json({ error: 'classroom_id is required' }, { status: 400 })
    }

    const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }

    const useWeights = body.use_weights == null ? DEFAULT_SETTINGS.use_weights : Boolean(body.use_weights)
    const assignmentsWeight = body.assignments_weight == null
      ? DEFAULT_SETTINGS.assignments_weight
      : Number(body.assignments_weight)
    const quizzesWeight = body.quizzes_weight == null
      ? DEFAULT_SETTINGS.quizzes_weight
      : Number(body.quizzes_weight)

    if (!Number.isInteger(assignmentsWeight) || assignmentsWeight < 0 || assignmentsWeight > 100) {
      return NextResponse.json({ error: 'assignments_weight must be an integer 0-100' }, { status: 400 })
    }

    if (!Number.isInteger(quizzesWeight) || quizzesWeight < 0 || quizzesWeight > 100) {
      return NextResponse.json({ error: 'quizzes_weight must be an integer 0-100' }, { status: 400 })
    }

    if (assignmentsWeight + quizzesWeight !== 100) {
      return NextResponse.json({ error: 'assignments_weight + quizzes_weight must equal 100' }, { status: 400 })
    }

    const supabase = getServiceRoleClient()
    const { data, error } = await supabase
      .from('gradebook_settings')
      .upsert({
        classroom_id: classroomId,
        use_weights: useWeights,
        assignments_weight: assignmentsWeight,
        quizzes_weight: quizzesWeight,
      }, { onConflict: 'classroom_id' })
      .select('use_weights, assignments_weight, quizzes_weight')
      .single()

    if (error || !data) {
      console.error('Error saving gradebook settings:', error)
      return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
    }

    return NextResponse.json({ settings: data })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Gradebook PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
