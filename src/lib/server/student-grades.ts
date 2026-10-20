import { loadGradebookMaximumState } from '@/lib/server/gradebook-maximum'
import { ApiError } from '@/lib/api-error'
import type { StudentGradesResponse } from '@/lib/student-grades'
import { projectMemberGrades } from '@/lib/gradebook-member-projection'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { loadChunkedRows, loadPagedRows } from '@/lib/server/query-chunks'
import { getServiceRoleClient } from '@/lib/supabase'

const PAGE_SIZE = 1000
const CHUNK_SIZE = 50

export async function getStudentGrades(studentId: string, classroomId: string): Promise<StudentGradesResponse> {
  const access = await assertStudentCanAccessClassroom(studentId, classroomId)
  if (!access.ok) throw new ApiError(access.status, access.error)
  const visibility = access.classroom.feature_visibility
  if (!visibility.student_grades || (!visibility.classwork && !visibility.tests)) {
    throw new ApiError(403, 'Grades are hidden in this classroom')
  }

  const maximumState = await loadGradebookMaximumState(classroomId)
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

  const standaloneResult = visibility.classwork
    ? await loadPagedRows<any>(() => supabase
      .from('gradebook_item_scores')
      .select('item_id, earned, updated_at, gradebook_items!inner(id, classroom_id, title, points_possible, include_in_final, gradebook_weight, gradebook_category_id)')
      .eq('classroom_id', classroomId)
      .eq('student_id', studentId)
      .eq('gradebook_items.classroom_id', classroomId)
      .not('earned', 'is', null)
      .order('updated_at', { ascending: false })
      .order('item_id', { ascending: true }), PAGE_SIZE)
    : { rows: [] as any[], error: null }
  if (standaloneResult.error) throw new ApiError(500, 'Could not load returned grades')

  const maximumFields = (type: 'assignment' | 'test' | 'item', id: string) => ({ gradebook_maximum_override: maximumState.states.get(type + ':' + id)?.maximum ?? null, gradebook_score_scale: maximumState.states.get(type + ':' + id)?.score_scale ?? 1 })
  return projectMemberGrades({
    student_id: studentId, visibility: { classwork: visibility.classwork, tests: visibility.tests, student_grades: visibility.student_grades, gradebook_compact_zero_weight_assessments: visibility.gradebook_compact_zero_weight_assessments ?? true },
    categories: categories.map((row, position) => ({ ...row, classroom_id: classroomId, position, default_assessment_weight: 10, is_default: false })),
    assignments: assignmentResult.rows.filter(row => row.assignments).map(row => ({ ...row.assignments, due_at: new Date(0).toISOString(), position: 0, ...maximumFields('assignment', row.assignments.id) })),
    assignment_docs: assignmentResult.rows.map(row => ({ assignment_id: row.assignments?.id ?? row.assignment_id, student_id: studentId, score_completion: row.score_completion, score_thinking: row.score_thinking, score_workflow: row.score_workflow, returned_at: row.returned_at, is_submitted: false, submitted_at: null, teacher_cleared_at: null, graded_at: null })),
    tests: returnedTests.map(row => ({ ...row.tests, position: 0, ...maximumFields('test', row.tests.id) })),
    test_attempts: returnedTests.map(row => ({ test_id: row.test_id, student_id: studentId, returned_at: row.returned_at, is_submitted: false, submitted_at: null })),
    test_questions: questionResult.rows, test_responses: responseResult.rows.map(row => ({ ...row, student_id: studentId })),
    items: standaloneResult.rows.filter(row => row.gradebook_items).map(row => ({ ...row.gradebook_items, created_at: new Date(0).toISOString(), ...maximumFields('item', row.gradebook_items.id) })),
    item_scores: standaloneResult.rows.map(row => ({ item_id: row.item_id, classroom_id: classroomId, student_id: studentId, earned: row.earned, updated_at: row.updated_at, returned_at: null })),
    score_overrides: overrideResult.rows.map(row => ({ ...row, classroom_id: classroomId, student_id: studentId })),
  }, classroomId)
}
