import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherCanMutateClassroom, assertTeacherOwnsClassroom, getClassroomStudentIds } from '@/lib/server/classrooms'
import {
  isMissingAssessmentDraftsError,
  validateQuizDraftContent,
  type QuizDraftContent,
} from '@/lib/server/assessment-drafts'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type QuizQuestionStatsRow = {
  quiz_id: string
}

type QuizResponseStatsRow = {
  quiz_id: string
  student_id: string
}

const QUIZ_LIST_STATS_FILTER_CHUNK_SIZE = 50
const QUIZ_LIST_STATS_PAGE_SIZE = 1000

function chunkIds(ids: string[], chunkSize: number): string[][] {
  const chunks: string[][] = []
  for (let index = 0; index < ids.length; index += chunkSize) {
    chunks.push(ids.slice(index, index + chunkSize))
  }
  return chunks
}

async function loadPagedRows<T>(buildQuery: () => any): Promise<{ rows: T[]; error: any }> {
  const rows: T[] = []
  let offset = 0

  while (true) {
    let query = buildQuery()
    const supportsRange = typeof query.range === 'function'
    if (supportsRange && typeof query.order === 'function') {
      query = query.order('id', { ascending: true })
    }
    if (supportsRange) {
      query = query.range(offset, offset + QUIZ_LIST_STATS_PAGE_SIZE - 1)
    }

    const { data, error } = await query
    if (error) {
      return { rows: [], error }
    }

    const pageRows = (data || []) as T[]
    rows.push(...pageRows)

    if (!supportsRange || pageRows.length < QUIZ_LIST_STATS_PAGE_SIZE) break
    offset += QUIZ_LIST_STATS_PAGE_SIZE
  }

  return { rows, error: null }
}

async function loadQuizQuestionRows(
  supabase: any,
  quizIds: string[]
): Promise<{ rows: QuizQuestionStatsRow[]; error: any }> {
  if (quizIds.length === 0) {
    return { rows: [], error: null }
  }

  const rows: QuizQuestionStatsRow[] = []
  for (const quizIdChunk of chunkIds(quizIds, QUIZ_LIST_STATS_FILTER_CHUNK_SIZE)) {
    const result = await loadPagedRows<QuizQuestionStatsRow>(() =>
      supabase
        .from('quiz_questions')
        .select('quiz_id')
        .in('quiz_id', quizIdChunk)
    )

    if (result.error) {
      return { rows: [], error: result.error }
    }

    rows.push(...result.rows)
  }

  return { rows, error: null }
}

async function loadQuizResponseRows(
  supabase: any,
  quizIds: string[],
  studentIds: string[]
): Promise<{ rows: QuizResponseStatsRow[]; error: any }> {
  if (quizIds.length === 0 || studentIds.length === 0) {
    return { rows: [], error: null }
  }

  const rows: QuizResponseStatsRow[] = []
  for (const quizIdChunk of chunkIds(quizIds, QUIZ_LIST_STATS_FILTER_CHUNK_SIZE)) {
    for (const studentIdChunk of chunkIds(studentIds, QUIZ_LIST_STATS_FILTER_CHUNK_SIZE)) {
      const result = await loadPagedRows<QuizResponseStatsRow>(() =>
        supabase
          .from('quiz_responses')
          .select('quiz_id, student_id')
          .in('quiz_id', quizIdChunk)
          .in('student_id', studentIdChunk)
      )

      if (result.error) {
        return { rows: [], error: result.error }
      }

      rows.push(...result.rows)
    }
  }

  return { rows, error: null }
}

// GET /api/teacher/quizzes?classroom_id=xxx - List quizzes for a classroom
export const GET = withErrorHandler('GetTeacherQuizzes', async (request) => {
  const user = await requireRole('teacher')
  const { searchParams } = new URL(request.url)
  const classroomId = searchParams.get('classroom_id')

  if (!classroomId) {
    return NextResponse.json(
      { error: 'classroom_id is required' },
      { status: 400 }
    )
  }

  const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
  if (!ownership.ok) {
    return NextResponse.json(
      { error: ownership.error },
      { status: ownership.status }
    )
  }

  const supabase = getServiceRoleClient()

  const { data: quizzes, error: quizzesError } = await supabase
    .from('quizzes')
    .select('*')
    .eq('classroom_id', classroomId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (quizzesError) {
    console.error('Error fetching quizzes:', quizzesError)
    return NextResponse.json({ error: 'Failed to fetch quizzes' }, { status: 500 })
  }

  const classroomStudentsResult = await getClassroomStudentIds(supabase, classroomId)
  if (classroomStudentsResult.error) {
    console.error('Error fetching classroom enrollments:', classroomStudentsResult.error)
    return NextResponse.json({ error: 'Failed to fetch classroom enrollments' }, { status: 500 })
  }

  const quizIds = (quizzes || []).map((q) => q.id)

  const questionCountMap: Record<string, number> = {}
  if (quizIds.length > 0) {
    const { rows: questionRows, error: questionRowsError } = await loadQuizQuestionRows(supabase, quizIds)

    if (questionRowsError) {
      console.error('Error fetching quiz question stats:', questionRowsError)
      return NextResponse.json({ error: 'Failed to fetch quiz question stats' }, { status: 500 })
    }

    for (const row of questionRows || []) {
      questionCountMap[row.quiz_id] = (questionCountMap[row.quiz_id] || 0) + 1
    }
  }

  const respondentCountMap: Record<string, number> = {}
  if (quizIds.length > 0 && classroomStudentsResult.studentIds.length > 0) {
    const {
      rows: responseRows,
      error: responseRowsError,
    } = await loadQuizResponseRows(supabase, quizIds, classroomStudentsResult.studentIds)

    if (responseRowsError) {
      console.error('Error fetching quiz response stats:', responseRowsError)
      return NextResponse.json({ error: 'Failed to fetch quiz response stats' }, { status: 500 })
    }

    const seen: Record<string, Set<string>> = {}
    for (const row of responseRows || []) {
      if (!classroomStudentsResult.studentIdSet.has(row.student_id)) continue
      if (!seen[row.quiz_id]) seen[row.quiz_id] = new Set()
      seen[row.quiz_id].add(row.student_id)
    }
    for (const [quizId, students] of Object.entries(seen)) {
      respondentCountMap[quizId] = students.size
    }
  }

  const draftByQuizId: Record<string, QuizDraftContent> = {}
  if (quizIds.length > 0) {
    for (const quizIdChunk of chunkIds(quizIds, QUIZ_LIST_STATS_FILTER_CHUNK_SIZE)) {
      try {
        const { data: draftRows, error: draftError } = await supabase
          .from('assessment_drafts')
          .select('assessment_id, content')
          .eq('assessment_type', 'quiz')
          .in('assessment_id', quizIdChunk)

        if (draftError && !isMissingAssessmentDraftsError(draftError)) {
          console.error('Error fetching quiz draft overlays:', draftError)
        }

        for (const row of draftRows || []) {
          const parsed = validateQuizDraftContent(row.content)
          if (!parsed.valid) continue
          draftByQuizId[row.assessment_id] = parsed.value
        }
      } catch {
        // Older test mocks may not implement this table query yet.
      }
    }
  }

  const quizzesWithStats = (quizzes || []).map((quiz) => ({
    ...quiz,
    title: draftByQuizId[quiz.id]?.title ?? quiz.title,
    show_results: draftByQuizId[quiz.id]?.show_results ?? quiz.show_results,
    assessment_type: 'quiz' as const,
    stats: {
      total_students: classroomStudentsResult.totalStudents,
      responded: respondentCountMap[quiz.id] || 0,
      questions_count: (draftByQuizId[quiz.id]?.questions.length ?? questionCountMap[quiz.id]) || 0,
    },
  }))

  return NextResponse.json({ quizzes: quizzesWithStats })
})

// POST /api/teacher/quizzes - Create a new quiz
export const POST = withErrorHandler('CreateTeacherQuiz', async (request) => {
  const user = await requireRole('teacher')
  const body = await request.json()
  const { classroom_id, title } = body

  if (!classroom_id) {
    return NextResponse.json({ error: 'classroom_id is required' }, { status: 400 })
  }
  if (!title || !title.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  const ownership = await assertTeacherCanMutateClassroom(user.id, classroom_id)
  if (!ownership.ok) {
    return NextResponse.json(
      { error: ownership.error },
      { status: ownership.status }
    )
  }

  const supabase = getServiceRoleClient()

  const { data: lastQuiz } = await supabase
    .from('quizzes')
    .select('position')
    .eq('classroom_id', classroom_id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextPosition = typeof lastQuiz?.position === 'number' ? lastQuiz.position + 1 : 0

  const { data: quiz, error } = await supabase
    .from('quizzes')
    .insert({
      classroom_id,
      title: title.trim(),
      created_by: user.id,
      position: nextPosition,
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating quiz:', error)
    return NextResponse.json({ error: 'Failed to create quiz' }, { status: 500 })
  }

  return NextResponse.json({ quiz: { ...quiz, assessment_type: 'quiz' } }, { status: 201 })
})
