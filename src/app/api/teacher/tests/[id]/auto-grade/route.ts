import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { suggestTestOpenResponseGrade } from '@/lib/ai-test-grading'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const CONCURRENCY_LIMIT = 5

// POST /api/teacher/tests/[id]/auto-grade - AI grade open responses for selected students
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: testId } = await params
    const body = await request.json()

    if (!Array.isArray(body?.student_ids) || body.student_ids.length === 0) {
      return NextResponse.json({ error: 'student_ids array is required' }, { status: 400 })
    }

    const studentIds: string[] = Array.from(
      new Set(
        body.student_ids
          .filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
          .map((value: string) => value.trim())
      )
    )

    if (studentIds.length === 0) {
      return NextResponse.json({ error: 'student_ids array is required' }, { status: 400 })
    }
    if (studentIds.length > 100) {
      return NextResponse.json({ error: 'Cannot auto-grade more than 100 students at once' }, { status: 400 })
    }

    const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    const testTitle = access.test.title

    const supabase = getServiceRoleClient()
    const { data: openQuestionRows, error: openQuestionError } = await supabase
      .from('test_questions')
      .select('id')
      .eq('test_id', testId)
      .eq('question_type', 'open_response')

    if (openQuestionError) {
      console.error('Error fetching open test questions:', openQuestionError)
      return NextResponse.json({ error: 'Failed to load test questions' }, { status: 500 })
    }

    const openQuestionIds = (openQuestionRows || []).map((row) => row.id)
    if (openQuestionIds.length === 0) {
      return NextResponse.json({
        graded_students: 0,
        skipped_students: studentIds.length,
        graded_responses: 0,
        errors: ['This test has no open-response questions to auto-grade.'],
      })
    }

    const { data: responses, error: responsesError } = await supabase
      .from('test_responses')
      .select(`
        id,
        student_id,
        response_text,
        test_questions!inner (
          question_text,
          points
        )
      `)
      .eq('test_id', testId)
      .in('student_id', studentIds)
      .in('question_id', openQuestionIds)

    if (responsesError) {
      console.error('Error loading test open responses for auto-grade:', responsesError)
      return NextResponse.json({ error: 'Failed to load test responses' }, { status: 500 })
    }

    type GradeTask = {
      responseId: string
      studentId: string
      questionText: string
      responseText: string
      maxPoints: number
    }

    const tasksByStudent = new Map<string, GradeTask[]>()
    for (const row of responses || []) {
      const studentId = typeof row.student_id === 'string' ? row.student_id : null
      if (!studentId) continue

      const question = Array.isArray(row.test_questions)
        ? row.test_questions[0]
        : row.test_questions
      if (!question) continue

      const responseText = typeof row.response_text === 'string' ? row.response_text.trim() : ''
      if (!responseText) continue

      const task: GradeTask = {
        responseId: row.id,
        studentId,
        questionText: String(question.question_text || ''),
        responseText,
        maxPoints: Number(question.points ?? 0),
      }

      const current = tasksByStudent.get(studentId) || []
      current.push(task)
      tasksByStudent.set(studentId, current)
    }

    const queue: GradeTask[] = []
    for (const studentId of studentIds) {
      queue.push(...(tasksByStudent.get(studentId) || []))
    }

    const eligibleStudentIds = new Set(
      studentIds.filter((studentId) => (tasksByStudent.get(studentId)?.length || 0) > 0)
    )

    let gradedResponses = 0
    const gradedStudentIds = new Set<string>()
    const failedStudentIds = new Set<string>()
    const errors: string[] = []

    async function runWorker() {
      while (queue.length > 0) {
        const task = queue.shift()
        if (!task) return

        try {
          const suggestion = await suggestTestOpenResponseGrade({
            testTitle,
            questionText: task.questionText,
            responseText: task.responseText,
            maxPoints: task.maxPoints,
          })

          const { error: updateError } = await supabase
            .from('test_responses')
            .update({
              score: suggestion.score,
              feedback: suggestion.feedback,
              graded_at: new Date().toISOString(),
              graded_by: user.id,
            })
            .eq('id', task.responseId)
            .eq('test_id', testId)

          if (updateError) {
            throw new Error(updateError.message || 'Failed to save AI grade')
          }

          gradedResponses += 1
          gradedStudentIds.add(task.studentId)
        } catch (error: any) {
          failedStudentIds.add(task.studentId)
          const message = error?.message || 'Failed to auto-grade response'
          errors.push(`${task.studentId}: ${message}`)
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(CONCURRENCY_LIMIT, queue.length || 1) },
      () => runWorker()
    )
    await Promise.all(workers)

    const fullyGradedStudents = Array.from(gradedStudentIds).filter(
      (studentId) => !failedStudentIds.has(studentId)
    )

    const gradedStudents = fullyGradedStudents.length
    const skippedStudents = studentIds.length - gradedStudents

    return NextResponse.json({
      graded_students: gradedStudents,
      skipped_students: skippedStudents,
      eligible_students: eligibleStudentIds.size,
      graded_responses: gradedResponses,
      errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Auto-grade test responses error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
