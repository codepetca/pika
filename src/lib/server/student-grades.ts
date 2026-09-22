import { ApiError } from '@/lib/api-error'
import { buildStudentGradesResponse, type StudentGradeCalculationItem, type StudentGradesResponse } from '@/lib/student-grades'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { loadChunkedRows, loadPagedRows } from '@/lib/server/query-chunks'
import { getServiceRoleClient } from '@/lib/supabase'

const PAGE_SIZE = 1000
const CHUNK_SIZE = 50

function itemKey(type: 'assignment' | 'test', id: string): string {
  return `${type}:${id}`
}

export async function getStudentGrades(studentId: string, classroomId: string): Promise<StudentGradesResponse> {
  const access = await assertStudentCanAccessClassroom(studentId, classroomId)
  if (!access.ok) throw new ApiError(access.status, access.error)
  const visibility = access.classroom.feature_visibility
  if (!visibility.student_grades || (!visibility.classwork && !visibility.tests)) {
    throw new ApiError(403, 'Grades are hidden in this classroom')
  }

  const supabase = getServiceRoleClient()
  const categoryResult = await loadPagedRows<{
    id: string
    name: string
    percentage: number
  }>(() => supabase
    .from('gradebook_categories')
    .select('id, name, percentage')
    .eq('classroom_id', classroomId)
    .order('position', { ascending: true }), PAGE_SIZE)
  if (categoryResult.error) throw new ApiError(500, 'Could not load returned grades')

  const categories = categoryResult.rows.map((category) => ({
    id: category.id,
    name: category.name,
    percentage: Number(category.percentage),
  }))
  const categoryMap = new Map(categories.map((category) => [category.id, category]))

  const overrideResult = await loadPagedRows<{
    assessment_type: 'assignment' | 'test' | 'final'
    assessment_id: string
    earned: number
  }>(() => supabase
    .from('gradebook_score_overrides')
    .select('assessment_type, assessment_id, earned')
    .eq('classroom_id', classroomId)
    .eq('student_id', studentId), PAGE_SIZE)
  if (overrideResult.error) throw new ApiError(500, 'Could not load returned grades')
  const overrides = new Map<string, number>()
  for (const row of overrideResult.rows) {
    if (row.assessment_type === 'final') continue
    overrides.set(itemKey(row.assessment_type, row.assessment_id), Number(row.earned))
  }

  const assignmentResult = visibility.classwork
    ? await loadPagedRows<any>(() => supabase
      .from('assignment_docs')
      .select('assignment_id, score_completion, score_thinking, score_workflow, returned_at, assignments!inner(id, classroom_id, title, points_possible, include_in_final, gradebook_weight, gradebook_category_id, is_draft)')
      .eq('student_id', studentId)
      .eq('assignments.classroom_id', classroomId)
      .not('returned_at', 'is', null)
      .order('returned_at', { ascending: false }), PAGE_SIZE)
    : { rows: [] as any[], error: null }
  if (assignmentResult.error) throw new ApiError(500, 'Could not load returned grades')

  const items: StudentGradeCalculationItem[] = []
  for (const row of assignmentResult.rows) {
    const assignment = row.assignments
    if (!assignment || assignment.is_draft || !row.returned_at) continue
    const possible = Number(assignment.points_possible)
    if (!(possible > 0)) continue
    const override = overrides.get(itemKey('assignment', assignment.id))
    let earned: number
    if (override !== undefined) {
      earned = override
    } else {
      if (row.score_completion == null || row.score_thinking == null || row.score_workflow == null) continue
      earned = ((Number(row.score_completion) + Number(row.score_thinking) + Number(row.score_workflow)) / 30) * possible
    }
    const category = assignment.gradebook_category_id ? categoryMap.get(assignment.gradebook_category_id) : null
    items.push({
      id: assignment.id,
      kind: 'Classwork',
      title: assignment.title,
      earned,
      possible,
      percent: (earned / possible) * 100,
      included: assignment.include_in_final !== false && Boolean(category && category.percentage > 0),
      href: `/classrooms/${classroomId}?tab=assignments&assignmentId=${assignment.id}`,
      categoryId: category?.id ?? null,
      weight: Number(assignment.gradebook_weight),
      returnedAt: row.returned_at,
    })
  }

  const attemptResult = visibility.tests
    ? await loadPagedRows<any>(() => supabase
      .from('test_attempts')
      .select('test_id, returned_at, tests!inner(id, classroom_id, title, status, include_in_final, gradebook_weight, gradebook_category_id)')
      .eq('student_id', studentId)
      .eq('tests.classroom_id', classroomId)
      .not('returned_at', 'is', null)
      .order('returned_at', { ascending: false }), PAGE_SIZE)
    : { rows: [] as any[], error: null }
  if (attemptResult.error) throw new ApiError(500, 'Could not load returned grades')

  const returnedTests = attemptResult.rows.filter((row) => row.tests && row.tests.status !== 'draft' && row.returned_at)
  const testIds = returnedTests.map((row) => row.test_id)
  const questionResult = await loadChunkedRows<any>({
    supabase,
    table: 'test_questions',
    select: 'id, test_id, points',
    filters: [{ column: 'test_id', values: testIds }],
    chunkSize: CHUNK_SIZE,
    pageSize: PAGE_SIZE,
  })
  const responseResult = await loadChunkedRows<any>({
    supabase,
    table: 'test_responses',
    select: 'test_id, question_id, score',
    filters: [
      { column: 'test_id', values: testIds },
      { column: 'student_id', values: [studentId] },
    ],
    chunkSize: CHUNK_SIZE,
    pageSize: PAGE_SIZE,
  })
  if (questionResult.error || responseResult.error) throw new ApiError(500, 'Could not load returned grades')

  const questionsByTest = new Map<string, Array<{ id: string; points: number }>>()
  for (const question of questionResult.rows) {
    const questions = questionsByTest.get(question.test_id) ?? []
    questions.push({ id: question.id, points: Number(question.points) })
    questionsByTest.set(question.test_id, questions)
  }
  const responsesByTest = new Map<string, Map<string, number | null>>()
  for (const response of responseResult.rows) {
    const responses = responsesByTest.get(response.test_id) ?? new Map<string, number | null>()
    responses.set(response.question_id, response.score == null ? null : Number(response.score))
    responsesByTest.set(response.test_id, responses)
  }

  for (const row of returnedTests) {
    const test = row.tests
    const questions = questionsByTest.get(row.test_id) ?? []
    if (questions.length === 0) continue
    const possible = questions.reduce((sum, question) => sum + question.points, 0)
    if (!(possible > 0)) continue
    const override = overrides.get(itemKey('test', test.id))
    let earned: number
    if (override !== undefined) {
      earned = override
    } else {
      const responses = responsesByTest.get(row.test_id)
      if (!responses || questions.some((question) => responses.get(question.id) == null)) continue
      earned = questions.reduce((sum, question) => sum + Number(responses.get(question.id)), 0)
    }
    const category = test.gradebook_category_id ? categoryMap.get(test.gradebook_category_id) : null
    items.push({
      id: test.id,
      kind: 'Test',
      title: test.title,
      earned,
      possible,
      percent: (earned / possible) * 100,
      included: test.include_in_final !== false && Boolean(category && category.percentage > 0),
      href: `/classrooms/${classroomId}?tab=tests&testId=${test.id}`,
      categoryId: category?.id ?? null,
      weight: Number(test.gradebook_weight),
      returnedAt: row.returned_at,
    })
  }

  const standaloneResult = visibility.classwork
    ? await loadPagedRows<any>(() => supabase
      .from('gradebook_item_scores')
      .select('item_id, earned, returned_at, gradebook_items!inner(id, classroom_id, title, points_possible, include_in_final, gradebook_weight, gradebook_category_id)')
      .eq('classroom_id', classroomId)
      .eq('student_id', studentId)
      .eq('gradebook_items.classroom_id', classroomId)
      .not('returned_at', 'is', null)
      .not('earned', 'is', null)
      .order('returned_at', { ascending: false }), PAGE_SIZE)
    : { rows: [] as any[], error: null }
  if (standaloneResult.error) throw new ApiError(500, 'Could not load returned grades')

  for (const row of standaloneResult.rows) {
    const item = row.gradebook_items
    if (!item || row.earned == null || !row.returned_at) continue
    const possible = Number(item.points_possible)
    if (!(possible > 0)) continue
    const earned = Number(row.earned)
    const category = item.gradebook_category_id ? categoryMap.get(item.gradebook_category_id) : null
    items.push({
      id: item.id,
      kind: 'Gradebook item',
      title: item.title,
      earned,
      possible,
      percent: (earned / possible) * 100,
      included: item.include_in_final !== false && Boolean(category && category.percentage > 0),
      href: null,
      categoryId: category?.id ?? null,
      weight: Number(item.gradebook_weight),
      returnedAt: row.returned_at,
    })
  }

  return buildStudentGradesResponse({
    categories: categories.map(({ id, percentage }) => ({ id, percentage })),
    items,
  })
}
