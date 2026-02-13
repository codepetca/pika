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

const ASSIGNMENT_POINTS_DEFAULT = 30
const QUIZ_POINTS_DEFAULT = 100

function round2(value: number): number {
  return Math.round(value * 100) / 100
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
    const selectedStudentId = request.nextUrl.searchParams.get('student_id')?.trim() || null

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
    if (selectedStudentId && !studentIds.includes(selectedStudentId)) {
      return NextResponse.json({ error: 'Student is not enrolled in this classroom' }, { status: 404 })
    }

    const { data: profiles } = studentIds.length
      ? await supabase
          .from('student_profiles')
          .select('user_id, first_name, last_name')
          .in('user_id', studentIds)
      : { data: [] as Array<{ user_id: string; first_name: string | null; last_name: string | null }> }

    const profileMap = new Map((profiles || []).map((p) => [p.user_id, p]))

    let assignments: Array<{
      id: string
      title: string
      due_at: string
      position: number
      is_draft: boolean
      points_possible: number
      include_in_final: boolean
    }> = []

    const { data: assignmentsWithMeta, error: assignmentsWithMetaError } = await supabase
      .from('assignments')
      .select('id, title, due_at, position, points_possible, include_in_final, is_draft')
      .eq('classroom_id', classroomId)
      .order('position', { ascending: true })

    if (!assignmentsWithMetaError) {
      assignments = (assignmentsWithMeta || []).map((assignment) => ({
        id: assignment.id,
        title: assignment.title,
        due_at: assignment.due_at || new Date(0).toISOString(),
        position: Number(assignment.position ?? 0),
        is_draft: assignment.is_draft,
        points_possible: Number(assignment.points_possible ?? ASSIGNMENT_POINTS_DEFAULT),
        include_in_final: assignment.include_in_final !== false,
      }))
    } else {
      // Backward-compatible fallback for databases that have not applied gradebook metadata columns yet.
      const { data: assignmentsLegacy, error: assignmentsLegacyError } = await supabase
        .from('assignments')
        .select('id, title, due_at, position, is_draft')
        .eq('classroom_id', classroomId)
        .order('position', { ascending: true })

      if (assignmentsLegacyError) {
        console.error('Error loading assignments for gradebook:', assignmentsWithMetaError, assignmentsLegacyError)
        return NextResponse.json({ error: 'Failed to load assignments for gradebook' }, { status: 500 })
      }

      assignments = (assignmentsLegacy || []).map((assignment) => ({
        id: assignment.id,
        title: assignment.title,
        due_at: assignment.due_at || new Date(0).toISOString(),
        position: Number(assignment.position ?? 0),
        is_draft: assignment.is_draft,
        points_possible: ASSIGNMENT_POINTS_DEFAULT,
        include_in_final: true,
      }))
    }

    const assignmentIds = assignments.map((a) => a.id)
    const { data: docs } = assignmentIds.length
      ? await supabase
          .from('assignment_docs')
          .select('assignment_id, student_id, score_completion, score_thinking, score_workflow')
          .in('assignment_id', assignmentIds)
      : { data: [] as Array<any> }

    const assignmentMap = new Map(assignments.map((a) => [a.id, a]))
    const assignmentRowsByStudent = new Map<string, Array<{ earned: number; possible: number }>>()
    const assignmentDocMap = new Map<string, {
      score_completion: number | null
      score_thinking: number | null
      score_workflow: number | null
    }>()
    const docsByAssignment = new Map<string, Array<{
      student_id: string
      score_completion: number | null
      score_thinking: number | null
      score_workflow: number | null
    }>>()

    for (const doc of docs || []) {
      const docsForAssignment = docsByAssignment.get(doc.assignment_id) || []
      docsForAssignment.push({
        student_id: doc.student_id,
        score_completion: doc.score_completion,
        score_thinking: doc.score_thinking,
        score_workflow: doc.score_workflow,
      })
      docsByAssignment.set(doc.assignment_id, docsForAssignment)

      assignmentDocMap.set(`${doc.student_id}:${doc.assignment_id}`, {
        score_completion: doc.score_completion,
        score_thinking: doc.score_thinking,
        score_workflow: doc.score_workflow,
      })

      const assignment = assignmentMap.get(doc.assignment_id)
      if (!assignment || assignment.include_in_final === false) continue
      if (assignment.is_draft) continue

      const sc = doc.score_completion
      const st = doc.score_thinking
      const sw = doc.score_workflow
      if (sc == null || st == null || sw == null) continue

      const raw = Number(sc) + Number(st) + Number(sw)
      const possible = Number(assignment.points_possible ?? ASSIGNMENT_POINTS_DEFAULT)
      const earned = (raw / 30) * possible

      const rows = assignmentRowsByStudent.get(doc.student_id) || []
      rows.push({ earned, possible })
      assignmentRowsByStudent.set(doc.student_id, rows)
    }

    let quizzes: Array<{
      id: string
      title: string
      status: 'draft' | 'active' | 'closed' | null
      points_possible: number
      include_in_final: boolean
    }> = []

    const { data: quizzesWithMeta, error: quizzesWithMetaError } = await supabase
      .from('quizzes')
      .select('id, title, status, points_possible, include_in_final')
      .eq('classroom_id', classroomId)

    if (!quizzesWithMetaError) {
      quizzes = (quizzesWithMeta || []).map((quiz) => ({
        id: quiz.id,
        title: quiz.title,
        status: quiz.status ?? null,
        points_possible: Number(quiz.points_possible ?? QUIZ_POINTS_DEFAULT),
        include_in_final: quiz.include_in_final !== false,
      }))
    } else {
      // Backward-compatible fallback for databases that have not applied gradebook metadata columns yet.
      const { data: quizzesLegacy, error: quizzesLegacyError } = await supabase
        .from('quizzes')
        .select('id, title, status')
        .eq('classroom_id', classroomId)

      if (quizzesLegacyError) {
        console.error('Error loading quizzes for gradebook:', quizzesWithMetaError, quizzesLegacyError)
        return NextResponse.json({ error: 'Failed to load quizzes for gradebook' }, { status: 500 })
      }

      quizzes = (quizzesLegacy || []).map((quiz) => ({
        id: quiz.id,
        title: quiz.title,
        status: quiz.status ?? null,
        points_possible: QUIZ_POINTS_DEFAULT,
        include_in_final: true,
      }))
    }

    const quizIds = quizzes.map((q) => q.id)

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

    const quizMap = new Map(quizzes.map((q) => [q.id, q]))

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
    const quizScoresByQuiz = new Map<string, Array<{ earned: number; possible: number }>>()
    const quizDetailsByStudent = new Map<string, Array<{
      quiz_id: string
      title: string
      earned: number
      possible: number
      percent: number
      status: 'active' | 'closed' | 'draft' | null
      is_manual_override: boolean
    }>>()

    for (const studentId of studentIds) {
      for (const quizId of quizIds) {
        const quiz = quizMap.get(quizId)
        if (!quiz || quiz.include_in_final === false) continue
        if (quiz.status === 'draft') continue

        const possible = Number(quiz.points_possible ?? QUIZ_POINTS_DEFAULT)
        const override = overrideMap.get(`${quizId}:${studentId}`)
        const hasManualOverride = override != null

        let earned: number | null = override ?? null
        if (earned == null) {
          const quizQuestionsForQuiz = questionIdsByQuiz.get(quizId) || []
          const scorable = quizQuestionsForQuiz.filter((q) => q.correct_option != null)
          if (scorable.length > 0) {
            const selected = responsesByStudentQuiz.get(studentId)?.get(quizId) || []
            if (selected.length === 0 && quiz.status !== 'closed') {
              continue
            }
            const selectedByQuestion = new Map(selected.map((s) => [s.question_id, s.selected_option]))

            let correctCount = 0
            for (const question of scorable) {
              const studentAnswer = selectedByQuestion.get(question.id)
              if (studentAnswer != null && studentAnswer === question.correct_option) {
                correctCount += 1
              }
            }
            earned = (correctCount / scorable.length) * possible
          }
        }

        if (earned == null) continue

        const rows = quizRowsByStudent.get(studentId) || []
        rows.push({ earned, possible })
        quizRowsByStudent.set(studentId, rows)

        const quizScores = quizScoresByQuiz.get(quiz.id) || []
        quizScores.push({ earned, possible })
        quizScoresByQuiz.set(quiz.id, quizScores)

        const details = quizDetailsByStudent.get(studentId) || []
        details.push({
          quiz_id: quiz.id,
          title: quiz.title,
          earned: round2(earned),
          possible: round2(possible),
          percent: round2((earned / possible) * 100),
          status: quiz.status,
          is_manual_override: hasManualOverride,
        })
        quizDetailsByStudent.set(studentId, details)
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

    const selectedStudent = selectedStudentId
      ? students.find((student) => student.student_id === selectedStudentId) || null
      : null

    const classAssignmentSummaries = assignments.map((assignment) => {
      const docsForAssignment = docsByAssignment.get(assignment.id) || []
      const graded = docsForAssignment
        .map((doc) => {
          const sc = doc.score_completion
          const st = doc.score_thinking
          const sw = doc.score_workflow
          if (sc == null || st == null || sw == null) return null
          const possible = Number(assignment.points_possible ?? ASSIGNMENT_POINTS_DEFAULT)
          const raw = Number(sc) + Number(st) + Number(sw)
          const earned = (raw / 30) * possible
          return round2((earned / possible) * 100)
        })
        .filter((value): value is number => value != null)

      const averagePercent = graded.length > 0
        ? round2(graded.reduce((sum, value) => sum + value, 0) / graded.length)
        : null

      return {
        assignment_id: assignment.id,
        title: assignment.title,
        due_at: assignment.due_at,
        is_draft: assignment.is_draft,
        possible: round2(assignment.points_possible),
        graded_count: graded.length,
        average_percent: averagePercent,
      }
    })

    const classQuizSummaries = quizzes
      .filter((quiz) => quiz.status !== 'draft')
      .map((quiz) => {
        const scored = quizScoresByQuiz.get(quiz.id) || []
        const averagePercent = scored.length > 0
          ? round2(
              scored.reduce((sum, row) => sum + (row.earned / row.possible) * 100, 0) / scored.length
            )
          : null

        return {
          quiz_id: quiz.id,
          title: quiz.title,
          status: quiz.status,
          possible: round2(quiz.points_possible),
          scored_count: scored.length,
          average_percent: averagePercent,
        }
      })

    const finalPercents = students
      .map((student) => student.final_percent)
      .filter((value): value is number => value != null)

    return NextResponse.json({
      settings,
      students,
      selected_student: selectedStudent
        ? {
            ...selectedStudent,
            assignments: assignments
              .map((assignment) => {
                const score = assignmentDocMap.get(`${selectedStudent.student_id}:${assignment.id}`)
                const sc = score?.score_completion
                const st = score?.score_thinking
                const sw = score?.score_workflow
                const hasGrade = sc != null && st != null && sw != null
                if (!hasGrade) {
                  return {
                    assignment_id: assignment.id,
                    title: assignment.title,
                    due_at: assignment.due_at,
                    is_draft: assignment.is_draft,
                    earned: null,
                    possible: round2(assignment.points_possible),
                    percent: null,
                    is_graded: false,
                  }
                }

                const possible = Number(assignment.points_possible ?? ASSIGNMENT_POINTS_DEFAULT)
                const raw = Number(sc) + Number(st) + Number(sw)
                const earned = (raw / 30) * possible
                return {
                  assignment_id: assignment.id,
                  title: assignment.title,
                  due_at: assignment.due_at,
                  is_draft: assignment.is_draft,
                  earned: round2(earned),
                  possible: round2(possible),
                  percent: round2((earned / possible) * 100),
                  is_graded: true,
                }
              }),
            quizzes: (quizDetailsByStudent.get(selectedStudent.student_id) || []).sort((a, b) =>
              a.title.localeCompare(b.title)
            ),
          }
        : null,
      class_summary: {
        total_students: studentIds.length,
        students_with_final: finalPercents.length,
        average_final_percent: finalPercents.length > 0
          ? round2(finalPercents.reduce((sum, value) => sum + value, 0) / finalPercents.length)
          : null,
        assignments: classAssignmentSummaries,
        quizzes: classQuizSummaries,
      },
      totals: {
        assignments: assignments.length || 0,
        quizzes: quizzes.filter((quiz) => quiz.status !== 'draft').length || 0,
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

    if (useWeights && assignmentsWeight + quizzesWeight !== 100) {
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
