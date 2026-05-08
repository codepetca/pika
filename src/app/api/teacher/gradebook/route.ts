import { NextRequest, NextResponse } from 'next/server'
import type { Assignment, AssignmentDoc } from '@/types'
import { requireRole } from '@/lib/auth'
import { calculateAssignmentStatus } from '@/lib/assignments'
import { calculateFinalPercent } from '@/lib/gradebook'
import { getServiceRoleClient } from '@/lib/supabase'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const DEFAULT_SETTINGS = {
  use_weights: false,
  assignments_weight: 50,
  quizzes_weight: 20,
  tests_weight: 30,
}

const ASSIGNMENT_POINTS_DEFAULT = 30
const QUIZ_POINTS_DEFAULT = 100
const ASSESSMENT_WEIGHT_DEFAULT = 10
const ASSESSMENT_WEIGHT_MAX = 999

type GradebookAssessmentType = 'assignment' | 'quiz' | 'test'
type GradebookAssessmentStatus =
  | 'missing'
  | 'late'
  | 'not_submitted'
  | 'started'
  | 'submitted'
  | 'submitted_late'
  | 'resubmitted'

type GradebookAssessmentCell = {
  assessment_id: string
  assessment_type: GradebookAssessmentType
  earned: number | null
  possible: number
  percent: number | null
  is_graded: boolean
  is_manual_override?: boolean
  status?: GradebookAssessmentStatus | null
}

type GradebookSettingsRow = {
  use_weights: boolean
  assignments_weight: number
  quizzes_weight: number
  tests_weight?: number | null
}

function mentionsMissingField(
  error: { code?: string; message?: string; details?: string; hint?: string } | null | undefined,
  field: string
): boolean {
  if (!error) return false
  const combined = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase()
  return combined.includes(field.toLowerCase()) && (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    combined.includes('column')
  )
}

function isMissingTableError(
  error: { code?: string; message?: string; details?: string; hint?: string } | null | undefined
): boolean {
  if (!error) return false
  const combined = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase()
  return error.code === 'PGRST205' || combined.includes('could not find the table') || combined.includes('does not exist')
}

function normalizeSettings(row: GradebookSettingsRow | null | undefined) {
  if (!row) return DEFAULT_SETTINGS
  return {
    use_weights: row.use_weights,
    assignments_weight: Number(row.assignments_weight ?? DEFAULT_SETTINGS.assignments_weight),
    quizzes_weight: Number(row.quizzes_weight ?? DEFAULT_SETTINGS.quizzes_weight),
    tests_weight: Number(row.tests_weight ?? 0),
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return round2((sorted[mid - 1] + sorted[mid]) / 2)
  }
  return round2(sorted[mid])
}

function comparePositionThenTitle(
  a: { position: number; title: string; id: string },
  b: { position: number; title: string; id: string }
): number {
  return a.position - b.position || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
}

function assessmentCode(prefix: string, index: number): string {
  return `${prefix}${index + 1}`
}

function cellKey(studentId: string, assessmentId: string): string {
  return `${studentId}:${assessmentId}`
}

function blankAssessmentCell(
  assessmentType: GradebookAssessmentType,
  assessmentId: string,
  possible: number,
  isManualOverride?: boolean,
  status?: GradebookAssessmentStatus | null
): GradebookAssessmentCell {
  return {
    assessment_id: assessmentId,
    assessment_type: assessmentType,
    earned: null,
    possible: round2(possible),
    percent: null,
    is_graded: false,
    ...(isManualOverride == null ? {} : { is_manual_override: isManualOverride }),
    ...(status ? { status } : {}),
  }
}

function normalizeAssessmentWeight(value: unknown): number {
  const weight = Number(value ?? ASSESSMENT_WEIGHT_DEFAULT)
  return Number.isFinite(weight) && weight > 0 ? Math.round(weight) : ASSESSMENT_WEIGHT_DEFAULT
}

function assessmentTableName(assessmentType: GradebookAssessmentType): 'assignments' | 'quizzes' | 'tests' {
  if (assessmentType === 'assignment') return 'assignments'
  if (assessmentType === 'quiz') return 'quizzes'
  return 'tests'
}

function isGradebookAssessmentType(value: unknown): value is GradebookAssessmentType {
  return value === 'assignment' || value === 'quiz' || value === 'test'
}

function isPastDue(dueAt: string): boolean {
  return new Date(dueAt).getTime() < Date.now()
}

function getAssignmentGradebookStatus(
  assignment: {
    id: string
    title: string
    due_at: string
    position: number
    is_draft: boolean
  },
  doc: ({
    student_id: string
    score_completion: number | null
    score_thinking: number | null
    score_workflow: number | null
    is_submitted?: boolean | null
    submitted_at?: string | null
    returned_at?: string | null
    teacher_cleared_at?: string | null
    graded_at?: string | null
  } | null | undefined),
  isGraded: boolean
): GradebookAssessmentStatus | null {
  if (assignment.is_draft) return null

  const normalizedDoc = doc
    ? {
        ...doc,
        is_submitted: Boolean(doc.is_submitted ?? isGraded),
        submitted_at: doc.submitted_at ?? (isGraded ? assignment.due_at : null),
        returned_at: doc.returned_at ?? null,
        teacher_cleared_at: doc.teacher_cleared_at ?? null,
        graded_at: doc.graded_at ?? null,
      } as AssignmentDoc
    : null

  const status = calculateAssignmentStatus({
    id: assignment.id,
    classroom_id: '',
    title: assignment.title,
    description: '',
    instructions_markdown: null,
    rich_instructions: null,
    due_at: assignment.due_at,
    position: assignment.position,
    is_draft: assignment.is_draft,
    released_at: null,
    track_authenticity: false,
    created_by: '',
    created_at: '',
    updated_at: '',
  } as Assignment, normalizedDoc)

  if (status === 'not_started') return isPastDue(assignment.due_at) ? 'missing' : null
  if (status === 'in_progress_late') return 'late'
  if (status === 'submitted_late') return 'submitted_late'
  if (status === 'resubmitted') return 'resubmitted'
  if (!isGraded && status === 'submitted_on_time') return 'submitted'
  return null
}

function getQuizGradebookStatus(input: {
  quizStatus: 'draft' | 'active' | 'closed' | null
  hasResponses: boolean
  hasManualOverride: boolean
  isGraded: boolean
}): GradebookAssessmentStatus | null {
  if (input.quizStatus === 'draft') return null
  if (input.quizStatus === 'closed' && !input.hasResponses && !input.hasManualOverride) return 'not_submitted'
  if (!input.isGraded && input.hasResponses) return 'started'
  return null
}

function getTestGradebookStatus(input: {
  testStatus: 'draft' | 'active' | 'closed' | null
  hasResponses: boolean
  isSubmitted: boolean
  isGraded: boolean
}): GradebookAssessmentStatus | null {
  if (input.testStatus === 'draft') return null
  if (input.testStatus === 'closed' && !input.isSubmitted) return 'not_submitted'
  if (!input.isGraded && input.isSubmitted) return 'submitted'
  if (!input.isGraded && input.hasResponses) return 'started'
  return null
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

export const GET = withErrorHandler('GetGradebook', async (request: NextRequest) => {
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

  const { data: settingsWithTests, error: settingsWithTestsError } = await supabase
    .from('gradebook_settings')
    .select('use_weights, assignments_weight, quizzes_weight, tests_weight')
    .eq('classroom_id', classroomId)
    .maybeSingle()

  let settingsRow = settingsWithTests as GradebookSettingsRow | null
  if (settingsWithTestsError) {
    if (!mentionsMissingField(settingsWithTestsError, 'tests_weight')) {
      console.error('Error loading gradebook settings:', settingsWithTestsError)
      return NextResponse.json({ error: 'Failed to load gradebook settings' }, { status: 500 })
    }

    const { data: legacySettingsRow, error: legacySettingsError } = await supabase
      .from('gradebook_settings')
      .select('use_weights, assignments_weight, quizzes_weight')
      .eq('classroom_id', classroomId)
      .maybeSingle()

    if (legacySettingsError) {
      console.error('Error loading legacy gradebook settings:', settingsWithTestsError, legacySettingsError)
      return NextResponse.json({ error: 'Failed to load gradebook settings' }, { status: 500 })
    }

    settingsRow = legacySettingsRow as GradebookSettingsRow | null
  }

  const settings = normalizeSettings(settingsRow)

  const { data: enrollments, error: enrollmentError } = await supabase
    .from('classroom_enrollments')
    .select('student_id, users!inner(email)')
    .eq('classroom_id', classroomId)

  if (enrollmentError) {
    console.error('Error loading enrollments:', enrollmentError)
    return NextResponse.json({ error: 'Failed to load roster' }, { status: 500 })
  }

  const studentIds = (enrollments || []).map((row) => row.student_id)
  const enrolledStudentIds = new Set(studentIds)
  if (selectedStudentId && !studentIds.includes(selectedStudentId)) {
    return NextResponse.json({ error: 'Student is not enrolled in this classroom' }, { status: 404 })
  }

  const { data: profiles } = studentIds.length
    ? await supabase
        .from('student_profiles')
        .select('user_id, student_number, first_name, last_name')
        .in('user_id', studentIds)
    : { data: [] as Array<{ user_id: string; student_number: string | null; first_name: string | null; last_name: string | null }> }

  const profileMap = new Map((profiles || []).map((p) => [p.user_id, p]))

  let assignments: Array<{
    id: string
    title: string
    due_at: string
    position: number
    is_draft: boolean
    points_possible: number
    include_in_final: boolean
    gradebook_weight: number
  }> = []

  const { data: assignmentsWithMeta, error: assignmentsWithMetaError } = await supabase
    .from('assignments')
    .select('id, title, due_at, position, points_possible, include_in_final, is_draft, gradebook_weight')
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
      gradebook_weight: normalizeAssessmentWeight(assignment.gradebook_weight),
    }))
  } else {
    const assignmentSelection = mentionsMissingField(assignmentsWithMetaError, 'gradebook_weight')
      ? 'id, title, due_at, position, points_possible, include_in_final, is_draft'
      : 'id, title, due_at, position, is_draft'

    // Backward-compatible fallback for databases that have not applied gradebook metadata columns yet.
    const { data: assignmentsLegacy, error: assignmentsLegacyError } = await supabase
      .from('assignments')
      .select(assignmentSelection)
      .eq('classroom_id', classroomId)
      .order('position', { ascending: true })

    if (assignmentsLegacyError) {
      console.error('Error loading assignments for gradebook:', assignmentsWithMetaError, assignmentsLegacyError)
      return NextResponse.json({ error: 'Failed to load assignments for gradebook' }, { status: 500 })
    }

    assignments = ((assignmentsLegacy || []) as Array<any>).map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      due_at: assignment.due_at || new Date(0).toISOString(),
      position: Number(assignment.position ?? 0),
      is_draft: assignment.is_draft,
      points_possible: Number(assignment.points_possible ?? ASSIGNMENT_POINTS_DEFAULT),
      include_in_final: assignment.include_in_final !== false,
      gradebook_weight: normalizeAssessmentWeight(assignment.gradebook_weight),
    }))
  }
  assignments.sort(comparePositionThenTitle)

  const assignmentIds = assignments.map((a) => a.id)
  const { data: docs } = assignmentIds.length
    ? await supabase
        .from('assignment_docs')
        .select('assignment_id, student_id, score_completion, score_thinking, score_workflow, is_submitted, submitted_at, returned_at, teacher_cleared_at, graded_at')
        .in('assignment_id', assignmentIds)
    : { data: [] as Array<any> }

  type GradebookAssignmentDoc = {
    student_id: string
    score_completion: number | null
    score_thinking: number | null
    score_workflow: number | null
    is_submitted?: boolean | null
    submitted_at?: string | null
    returned_at?: string | null
    teacher_cleared_at?: string | null
    graded_at?: string | null
  }

  const assignmentMap = new Map(assignments.map((a) => [a.id, a]))
  const assignmentRowsByStudent = new Map<string, Array<{ earned: number; possible: number; weight: number }>>()
  const assignmentDocMap = new Map<string, GradebookAssignmentDoc>()
  const docsByAssignment = new Map<string, GradebookAssignmentDoc[]>()

  for (const doc of docs || []) {
    const docsForAssignment = docsByAssignment.get(doc.assignment_id) || []
    const gradebookDoc = {
      student_id: doc.student_id,
      score_completion: doc.score_completion,
      score_thinking: doc.score_thinking,
      score_workflow: doc.score_workflow,
      is_submitted: doc.is_submitted,
      submitted_at: doc.submitted_at,
      returned_at: doc.returned_at,
      teacher_cleared_at: doc.teacher_cleared_at,
      graded_at: doc.graded_at,
    }
    docsForAssignment.push(gradebookDoc)
    docsByAssignment.set(doc.assignment_id, docsForAssignment)

    assignmentDocMap.set(`${doc.student_id}:${doc.assignment_id}`, gradebookDoc)

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
    rows.push({ earned, possible, weight: assignment.gradebook_weight })
    assignmentRowsByStudent.set(doc.student_id, rows)
  }

  let quizzes: Array<{
    id: string
    title: string
    position: number
    status: 'draft' | 'active' | 'closed' | null
    points_possible: number
    include_in_final: boolean
    gradebook_weight: number
  }> = []

  const { data: quizzesWithMeta, error: quizzesWithMetaError } = await supabase
    .from('quizzes')
    .select('id, title, status, position, points_possible, include_in_final, gradebook_weight')
    .eq('classroom_id', classroomId)

  if (!quizzesWithMetaError) {
    quizzes = (quizzesWithMeta || []).map((quiz) => ({
      id: quiz.id,
      title: quiz.title,
      position: Number(quiz.position ?? 0),
      status: quiz.status ?? null,
      points_possible: Number(quiz.points_possible ?? QUIZ_POINTS_DEFAULT),
      include_in_final: quiz.include_in_final !== false,
      gradebook_weight: normalizeAssessmentWeight(quiz.gradebook_weight),
    }))
  } else {
    const quizSelection = mentionsMissingField(quizzesWithMetaError, 'gradebook_weight')
      ? 'id, title, status, position, points_possible, include_in_final'
      : 'id, title, status, position'

    // Backward-compatible fallback for databases that have not applied gradebook metadata columns yet.
    const { data: quizzesLegacy, error: quizzesLegacyError } = await supabase
      .from('quizzes')
      .select(quizSelection)
      .eq('classroom_id', classroomId)

    if (quizzesLegacyError) {
      console.error('Error loading quizzes for gradebook:', quizzesWithMetaError, quizzesLegacyError)
      return NextResponse.json({ error: 'Failed to load quizzes for gradebook' }, { status: 500 })
    }

    quizzes = ((quizzesLegacy || []) as Array<any>).map((quiz) => ({
      id: quiz.id,
      title: quiz.title,
      position: Number(quiz.position ?? 0),
      status: quiz.status ?? null,
      points_possible: Number(quiz.points_possible ?? QUIZ_POINTS_DEFAULT),
      include_in_final: quiz.include_in_final !== false,
      gradebook_weight: normalizeAssessmentWeight(quiz.gradebook_weight),
    }))
  }
  quizzes.sort(comparePositionThenTitle)

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

  const quizRowsByStudent = new Map<string, Array<{ earned: number; possible: number; weight: number }>>()
  const quizScoresByQuiz = new Map<string, Array<{ earned: number; possible: number }>>()
  const quizCellMap = new Map<string, GradebookAssessmentCell>()
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
      if (!quiz) continue

      const possible = Number(quiz.points_possible ?? QUIZ_POINTS_DEFAULT)
      const override = overrideMap.get(`${quizId}:${studentId}`)
      const hasManualOverride = override != null
      const selected = responsesByStudentQuiz.get(studentId)?.get(quizId) || []

      let earned: number | null = override ?? null
      if (quiz.status === 'draft') {
        earned = null
      } else if (earned == null) {
        const quizQuestionsForQuiz = questionIdsByQuiz.get(quizId) || []
        const scorable = quizQuestionsForQuiz.filter((q) => q.correct_option != null)
        if (scorable.length > 0) {
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

      const quizCellStatus = getQuizGradebookStatus({
        quizStatus: quiz.status,
        hasResponses: selected.length > 0,
        hasManualOverride,
        isGraded: earned != null,
      })

      quizCellMap.set(cellKey(studentId, quizId), earned == null
        ? blankAssessmentCell('quiz', quizId, possible, hasManualOverride, quizCellStatus)
        : {
            assessment_id: quizId,
            assessment_type: 'quiz',
            earned: round2(earned),
            possible: round2(possible),
            percent: round2((earned / possible) * 100),
            is_graded: true,
            is_manual_override: hasManualOverride,
            ...(quizCellStatus ? { status: quizCellStatus } : {}),
          }
      )

      if (quiz.include_in_final === false) continue
      if (quiz.status === 'draft') continue
      if (earned == null) continue

      const rows = quizRowsByStudent.get(studentId) || []
      rows.push({ earned, possible, weight: quiz.gradebook_weight })
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

  let tests: Array<{
    id: string
    title: string
    position: number
    status: 'draft' | 'active' | 'closed' | null
    include_in_final: boolean
    gradebook_weight: number
  }> = []

  const { data: testsWithMeta, error: testsWithMetaError } = await supabase
    .from('tests')
    .select('id, title, status, position, include_in_final, gradebook_weight')
    .eq('classroom_id', classroomId)

  if (!testsWithMetaError) {
    tests = (testsWithMeta || []).map((test) => ({
      id: test.id,
      title: test.title,
      position: Number(test.position ?? 0),
      status: test.status ?? null,
      include_in_final: test.include_in_final !== false,
      gradebook_weight: normalizeAssessmentWeight(test.gradebook_weight),
    }))
  } else if (
    mentionsMissingField(testsWithMetaError, 'include_in_final') ||
    mentionsMissingField(testsWithMetaError, 'gradebook_weight')
  ) {
    const testSelection = mentionsMissingField(testsWithMetaError, 'gradebook_weight')
      ? 'id, title, status, position, include_in_final'
      : 'id, title, status, position'

    const { data: testsLegacy, error: testsLegacyError } = await supabase
      .from('tests')
      .select(testSelection)
      .eq('classroom_id', classroomId)

    if (!testsLegacyError) {
      tests = ((testsLegacy || []) as Array<any>).map((test) => ({
        id: test.id,
        title: test.title,
        position: Number(test.position ?? 0),
        status: test.status ?? null,
        include_in_final: test.include_in_final !== false,
        gradebook_weight: normalizeAssessmentWeight(test.gradebook_weight),
      }))
    } else if (!isMissingTableError(testsLegacyError)) {
      console.error('Error loading tests for gradebook:', testsWithMetaError, testsLegacyError)
      return NextResponse.json({ error: 'Failed to load tests for gradebook' }, { status: 500 })
    }
  } else if (!isMissingTableError(testsWithMetaError)) {
    console.error('Error loading tests for gradebook:', testsWithMetaError)
    return NextResponse.json({ error: 'Failed to load tests for gradebook' }, { status: 500 })
  }
  tests.sort(comparePositionThenTitle)

  const testIds = tests.map((test) => test.id)
  const { data: testQuestions, error: testQuestionsError } = testIds.length
    ? await supabase
        .from('test_questions')
        .select('id, test_id, points')
        .in('test_id', testIds)
    : { data: [] as Array<any>, error: null }

  if (testQuestionsError && !isMissingTableError(testQuestionsError)) {
    console.error('Error loading test questions for gradebook:', testQuestionsError)
    return NextResponse.json({ error: 'Failed to load test questions for gradebook' }, { status: 500 })
  }

  const { data: testResponses, error: testResponsesError } = testIds.length && studentIds.length
    ? await supabase
        .from('test_responses')
        .select('test_id, question_id, student_id, score')
        .in('test_id', testIds)
        .in('student_id', studentIds)
    : { data: [] as Array<any>, error: null }

  if (testResponsesError && !isMissingTableError(testResponsesError)) {
    console.error('Error loading test responses for gradebook:', testResponsesError)
    return NextResponse.json({ error: 'Failed to load test responses for gradebook' }, { status: 500 })
  }

  const { data: testAttempts, error: testAttemptsError } = testIds.length && studentIds.length
    ? await supabase
        .from('test_attempts')
        .select('test_id, student_id, is_submitted, submitted_at')
        .in('test_id', testIds)
        .in('student_id', studentIds)
    : { data: [] as Array<any>, error: null }

  if (testAttemptsError && !isMissingTableError(testAttemptsError)) {
    console.error('Error loading test attempts for gradebook:', testAttemptsError)
    return NextResponse.json({ error: 'Failed to load test attempts for gradebook' }, { status: 500 })
  }

  const testMap = new Map(tests.map((test) => [test.id, test]))
  const testQuestionsByTest = new Map<string, Array<{ id: string; points: number }>>()
  for (const question of testQuestions || []) {
    const rows = testQuestionsByTest.get(question.test_id) || []
    rows.push({ id: question.id, points: Number(question.points ?? 0) })
    testQuestionsByTest.set(question.test_id, rows)
  }

  const submittedTestAttempts = new Set<string>()
  const testAttemptMap = new Map<string, { is_submitted: boolean; submitted_at: string | null }>()
  for (const attempt of testAttempts || []) {
    testAttemptMap.set(`${attempt.test_id}:${attempt.student_id}`, {
      is_submitted: Boolean(attempt.is_submitted),
      submitted_at: attempt.submitted_at ?? null,
    })
    if (!attempt.is_submitted) continue
    submittedTestAttempts.add(`${attempt.test_id}:${attempt.student_id}`)
  }

  const testResponsesByStudentTest = new Map<string, Map<string, { score: number | null }>>()
  for (const response of testResponses || []) {
    const key = `${response.test_id}:${response.student_id}`
    const byQuestion = testResponsesByStudentTest.get(key) || new Map<string, { score: number | null }>()
    byQuestion.set(response.question_id, {
      score: response.score == null ? null : Number(response.score),
    })
    testResponsesByStudentTest.set(key, byQuestion)
  }

  const testRowsByStudent = new Map<string, Array<{ earned: number; possible: number; weight: number }>>()
  const testScoresByTest = new Map<string, Array<{ earned: number; possible: number }>>()
  const testCellMap = new Map<string, GradebookAssessmentCell>()
  const testDetailsByStudent = new Map<string, Array<{
    test_id: string
    title: string
    earned: number
    possible: number
    percent: number
    status: 'active' | 'closed' | 'draft' | null
  }>>()

  for (const studentId of studentIds) {
    for (const testId of testIds) {
      const test = testMap.get(testId)
      if (!test) continue

      const questionsForTest = testQuestionsByTest.get(testId) || []
      const possible = questionsForTest.reduce((sum, question) => sum + question.points, 0)
      let earned: number | null = null
      const responseKey = `${testId}:${studentId}`
      const responsesForStudent = testResponsesByStudentTest.get(responseKey)
      const attempt = testAttemptMap.get(responseKey)
      const isSubmitted = Boolean(attempt?.is_submitted)
      const hasResponses = Boolean(responsesForStudent?.size)

      if (
        test.status !== 'draft' &&
        possible > 0 &&
        (submittedTestAttempts.has(responseKey) || hasResponses)
      ) {
        let scoredEarned = 0
        let isFullyScored = true
        for (const question of questionsForTest) {
          const response = responsesForStudent?.get(question.id)
          if (!response || response.score == null) {
            isFullyScored = false
            break
          }
          scoredEarned += response.score
        }
        earned = isFullyScored ? scoredEarned : null
      }

      const testCellStatus = getTestGradebookStatus({
        testStatus: test.status,
        hasResponses,
        isSubmitted,
        isGraded: earned != null && possible > 0,
      })

      testCellMap.set(cellKey(studentId, testId), earned == null || possible <= 0
        ? blankAssessmentCell('test', testId, possible, undefined, testCellStatus)
        : {
            assessment_id: testId,
            assessment_type: 'test',
            earned: round2(earned),
            possible: round2(possible),
            percent: round2((earned / possible) * 100),
            is_graded: true,
            ...(testCellStatus ? { status: testCellStatus } : {}),
          }
      )

      if (test.include_in_final === false) continue
      if (test.status === 'draft') continue
      if (possible <= 0) continue
      if (earned == null) continue

      const rows = testRowsByStudent.get(studentId) || []
      rows.push({ earned, possible, weight: test.gradebook_weight })
      testRowsByStudent.set(studentId, rows)

      const testScores = testScoresByTest.get(test.id) || []
      testScores.push({ earned, possible })
      testScoresByTest.set(test.id, testScores)

      const details = testDetailsByStudent.get(studentId) || []
      details.push({
        test_id: test.id,
        title: test.title,
        earned: round2(earned),
        possible: round2(possible),
        percent: round2((earned / possible) * 100),
        status: test.status,
      })
      testDetailsByStudent.set(studentId, details)
    }
  }

  function getAssignmentCell(
    studentId: string,
    assignment: typeof assignments[number]
  ): GradebookAssessmentCell {
    const score = assignmentDocMap.get(cellKey(studentId, assignment.id))
    const sc = score?.score_completion
    const st = score?.score_thinking
    const sw = score?.score_workflow
    const possible = Number(assignment.points_possible ?? ASSIGNMENT_POINTS_DEFAULT)
    const isGraded = sc != null && st != null && sw != null
    const status = getAssignmentGradebookStatus(assignment, score, isGraded)
    if (sc == null || st == null || sw == null) {
      return blankAssessmentCell('assignment', assignment.id, possible, undefined, status)
    }

    const raw = Number(sc) + Number(st) + Number(sw)
    const earned = (raw / 30) * possible
    return {
      assessment_id: assignment.id,
      assessment_type: 'assignment',
      earned: round2(earned),
      possible: round2(possible),
      percent: round2((earned / possible) * 100),
      is_graded: true,
      ...(status ? { status } : {}),
    }
  }

  const assessmentColumns = [
    ...assignments.map((assignment, index) => ({
      assessment_id: assignment.id,
      assessment_type: 'assignment' as const,
      code: assessmentCode('A', index),
      title: assignment.title,
      possible: round2(assignment.points_possible),
      weight: assignment.gradebook_weight,
      due_at: assignment.due_at,
      is_draft: assignment.is_draft,
      include_in_final: assignment.include_in_final,
    })),
    ...quizzes.map((quiz, index) => ({
      assessment_id: quiz.id,
      assessment_type: 'quiz' as const,
      code: assessmentCode('Q', index),
      title: quiz.title,
      possible: round2(quiz.points_possible),
      weight: quiz.gradebook_weight,
      status: quiz.status,
      include_in_final: quiz.include_in_final,
    })),
    ...tests.map((test, index) => {
      const questionsForTest = testQuestionsByTest.get(test.id) || []
      const possible = questionsForTest.reduce((sum, question) => sum + question.points, 0)
      return {
        assessment_id: test.id,
        assessment_type: 'test' as const,
        code: assessmentCode('T', index),
        title: test.title,
        possible: round2(possible),
        weight: test.gradebook_weight,
        status: test.status,
        include_in_final: test.include_in_final,
      }
    }),
  ]

  const students = (enrollments || []).map((enrollment) => {
    const studentId = enrollment.student_id
    const profile = profileMap.get(studentId)
    const assignmentRows = assignmentRowsByStudent.get(studentId) || []
    const quizRows = quizRowsByStudent.get(studentId) || []
    const testRows = testRowsByStudent.get(studentId) || []
    const calc = calculateFinalPercent({
      useWeights: false,
      assignmentsWeight: settings.assignments_weight,
      quizzesWeight: settings.quizzes_weight,
      testsWeight: settings.tests_weight,
      assignments: assignmentRows,
      quizzes: quizRows,
      tests: testRows,
    })
    const assignmentTotals = assignmentRows.reduce(
      (totals, row) => ({
        earned: totals.earned + row.earned,
        possible: totals.possible + row.possible,
      }),
      { earned: 0, possible: 0 }
    )
    const quizTotals = quizRows.reduce(
      (totals, row) => ({
        earned: totals.earned + row.earned,
        possible: totals.possible + row.possible,
      }),
      { earned: 0, possible: 0 }
    )
    const testTotals = testRows.reduce(
      (totals, row) => ({
        earned: totals.earned + row.earned,
        possible: totals.possible + row.possible,
      }),
      { earned: 0, possible: 0 }
    )

    return {
      student_id: studentId,
      student_email: (enrollment.users as unknown as { email: string }).email,
      student_number: profile?.student_number ?? null,
      student_first_name: profile?.first_name ?? null,
      student_last_name: profile?.last_name ?? null,
      assignments_earned: assignmentTotals.possible > 0 ? round2(assignmentTotals.earned) : null,
      assignments_possible: assignmentTotals.possible > 0 ? round2(assignmentTotals.possible) : null,
      assignments_percent: calc.assignmentsPercent,
      quizzes_earned: quizTotals.possible > 0 ? round2(quizTotals.earned) : null,
      quizzes_possible: quizTotals.possible > 0 ? round2(quizTotals.possible) : null,
      quizzes_percent: calc.quizzesPercent,
      tests_earned: testTotals.possible > 0 ? round2(testTotals.earned) : null,
      tests_possible: testTotals.possible > 0 ? round2(testTotals.possible) : null,
      tests_percent: calc.testsPercent,
      final_percent: calc.finalPercent,
      assessment_scores: [
        ...assignments.map((assignment) => getAssignmentCell(studentId, assignment)),
        ...quizzes.map((quiz) =>
          quizCellMap.get(cellKey(studentId, quiz.id)) ||
          blankAssessmentCell('quiz', quiz.id, quiz.points_possible, false)
        ),
        ...tests.map((test) => {
          const questionsForTest = testQuestionsByTest.get(test.id) || []
          const possible = questionsForTest.reduce((sum, question) => sum + question.points, 0)
          return testCellMap.get(cellKey(studentId, test.id)) || blankAssessmentCell('test', test.id, possible)
        }),
      ],
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
      .filter((doc) => enrolledStudentIds.has(doc.student_id))
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
    const medianPercent = median(graded)

    return {
      assignment_id: assignment.id,
      title: assignment.title,
      due_at: assignment.due_at,
      is_draft: assignment.is_draft,
      possible: round2(assignment.points_possible),
      graded_count: graded.length,
      average_percent: averagePercent,
      median_percent: medianPercent,
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

  const classTestSummaries = tests
    .filter((test) => test.status !== 'draft')
    .map((test) => {
      const questionsForTest = testQuestionsByTest.get(test.id) || []
      const possible = questionsForTest.reduce((sum, question) => sum + question.points, 0)
      const scored = testScoresByTest.get(test.id) || []
      const averagePercent = scored.length > 0
        ? round2(
            scored.reduce((sum, row) => sum + (row.earned / row.possible) * 100, 0) / scored.length
          )
        : null

      return {
        test_id: test.id,
        title: test.title,
        status: test.status,
        possible: round2(possible),
        scored_count: scored.length,
        average_percent: averagePercent,
      }
    })

  const finalPercents = students
    .map((student) => student.final_percent)
    .filter((value): value is number => value != null)

  return NextResponse.json({
    settings,
    assessment_columns: assessmentColumns,
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
          quizzes: quizDetailsByStudent.get(selectedStudent.student_id) || [],
          tests: testDetailsByStudent.get(selectedStudent.student_id) || [],
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
      tests: classTestSummaries,
    },
    totals: {
      assignments: assignments.length || 0,
      quizzes: quizzes.filter((quiz) => quiz.status !== 'draft').length || 0,
      tests: tests.filter((test) => test.status !== 'draft').length || 0,
    },
  })
})

export const PATCH = withErrorHandler('PatchGradebook', async (request: NextRequest) => {
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

  const hasAssessmentWeightUpdate =
    body.assessment_type != null ||
    body.assessment_id != null ||
    body.gradebook_weight != null

  if (hasAssessmentWeightUpdate) {
    if (!isGradebookAssessmentType(body.assessment_type)) {
      return NextResponse.json({ error: 'assessment_type must be assignment, quiz, or test' }, { status: 400 })
    }

    const assessmentId = String(body.assessment_id || '').trim()
    if (!assessmentId) {
      return NextResponse.json({ error: 'assessment_id is required' }, { status: 400 })
    }

    const gradebookWeight = Number(body.gradebook_weight)
    if (
      !Number.isInteger(gradebookWeight) ||
      gradebookWeight < 1 ||
      gradebookWeight > ASSESSMENT_WEIGHT_MAX
    ) {
      return NextResponse.json(
        { error: `gradebook_weight must be an integer 1-${ASSESSMENT_WEIGHT_MAX}` },
        { status: 400 }
      )
    }

    const supabase = getServiceRoleClient()
    const { data, error } = await supabase
      .from(assessmentTableName(body.assessment_type))
      .update({ gradebook_weight: gradebookWeight })
      .eq('id', assessmentId)
      .eq('classroom_id', classroomId)
      .select('id, gradebook_weight')
      .maybeSingle()

    if (error && mentionsMissingField(error, 'gradebook_weight')) {
      return NextResponse.json(
        { error: 'Assessment weights are not available until the database migration is applied' },
        { status: 409 }
      )
    }

    if (error) {
      console.error('Error saving assessment weight:', error)
      return NextResponse.json({ error: 'Failed to save assessment weight' }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ error: 'Assessment not found' }, { status: 404 })
    }

    return NextResponse.json({
      assessment: {
        assessment_id: data.id,
        assessment_type: body.assessment_type,
        weight: normalizeAssessmentWeight(data.gradebook_weight),
      },
    })
  }

  const useWeights = body.use_weights == null ? DEFAULT_SETTINGS.use_weights : Boolean(body.use_weights)
  const assignmentsWeight = body.assignments_weight == null
    ? DEFAULT_SETTINGS.assignments_weight
    : Number(body.assignments_weight)
  const quizzesWeight = body.quizzes_weight == null
    ? DEFAULT_SETTINGS.quizzes_weight
    : Number(body.quizzes_weight)
  const testsWeight = body.tests_weight == null
    ? DEFAULT_SETTINGS.tests_weight
    : Number(body.tests_weight)

  if (!Number.isInteger(assignmentsWeight) || assignmentsWeight < 0 || assignmentsWeight > 100) {
    return NextResponse.json({ error: 'assignments_weight must be an integer 0-100' }, { status: 400 })
  }

  if (!Number.isInteger(quizzesWeight) || quizzesWeight < 0 || quizzesWeight > 100) {
    return NextResponse.json({ error: 'quizzes_weight must be an integer 0-100' }, { status: 400 })
  }

  if (!Number.isInteger(testsWeight) || testsWeight < 0 || testsWeight > 100) {
    return NextResponse.json({ error: 'tests_weight must be an integer 0-100' }, { status: 400 })
  }

  if (useWeights && assignmentsWeight + quizzesWeight + testsWeight !== 100) {
    return NextResponse.json({ error: 'assignments_weight + quizzes_weight + tests_weight must equal 100' }, { status: 400 })
  }

  const supabase = getServiceRoleClient()
  let { data, error } = await supabase
    .from('gradebook_settings')
    .upsert({
      classroom_id: classroomId,
      use_weights: useWeights,
      assignments_weight: assignmentsWeight,
      quizzes_weight: quizzesWeight,
      tests_weight: testsWeight,
    }, { onConflict: 'classroom_id' })
    .select('use_weights, assignments_weight, quizzes_weight, tests_weight')
    .single()

  if (error && mentionsMissingField(error, 'tests_weight')) {
    const legacyResult = await supabase
      .from('gradebook_settings')
      .upsert({
        classroom_id: classroomId,
        use_weights: useWeights,
        assignments_weight: assignmentsWeight,
        quizzes_weight: quizzesWeight,
      }, { onConflict: 'classroom_id' })
      .select('use_weights, assignments_weight, quizzes_weight')
      .single()
    data = legacyResult.data ? { ...legacyResult.data, tests_weight: 0 } : legacyResult.data
    error = legacyResult.error
  }

  if (error || !data) {
    console.error('Error saving gradebook settings:', error)
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }

  return NextResponse.json({ settings: normalizeSettings(data as GradebookSettingsRow) })
})
