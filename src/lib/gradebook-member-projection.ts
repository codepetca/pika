import { buildStudentGradesResponse, type StudentGradeCalculationItem } from '@/lib/student-grades'
import { gradebookSourceMaximumState } from '@/lib/gradebook-projection'
import type { GradebookMemberSource } from '@/lib/validations/contextual-gradebook'
import type { GradebookMaximumState } from '@/lib/gradebook-maximum'

export function projectGradebookItemMark(item: {
  id: string; title: string; points_possible: number; include_in_final: boolean; gradebook_weight: number
}, earnedMark: number, category: { name: string; percentage: number } | null | undefined, state?: GradebookMaximumState) {
  const earned = Number(earnedMark) * (state?.score_scale ?? 1)
  const possible = state?.maximum ?? Number(item.points_possible)
  return { id: item.id, title: item.title, earned, possible, percent: Math.round(earned / possible * 10000) / 100,
    categoryName: category?.name ?? null, isZeroWeight: Number(item.gradebook_weight) === 0,
    included: item.include_in_final && item.gradebook_weight > 0 && (category?.percentage ?? 0) > 0 }
}

function itemKey(type: 'assignment' | 'test', id: string) { return type + ':' + id }
export function projectMemberGrades(source: GradebookMemberSource, classroomId: string) {
  const visibility = source.visibility
  const maximumState = { states: gradebookSourceMaximumState(source) }
  const categories = source.categories
  const categoryMap = new Map(categories.map(row => [row.id, row]))
  const overrides = new Map(source.score_overrides.filter(row => row.assessment_type !== 'final').map(row => [itemKey(row.assessment_type as 'assignment' | 'test', row.assessment_id), row.earned]))
  const assignmentMap = new Map(source.assignments.map(row => [row.id, row]))
  const assignmentResult = { rows: source.assignment_docs.map(row => ({ ...row, assignments: assignmentMap.get(row.assignment_id) })) }
  const items: StudentGradeCalculationItem[] = []
  for (const row of assignmentResult.rows) {
    const assignment = row.assignments
    if (!assignment || assignment.is_draft || !row.returned_at) continue
    const possible = Number(assignment.points_possible)
    if (!((maximumState.states.get(`assignment:${assignment.id}`)?.maximum ?? possible) > 0)) continue
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
      percent: possible > 0 ? (earned / possible) * 100 : 0,
      included: assignment.include_in_final !== false && Number(assignment.gradebook_weight) > 0
        && Boolean(category && category.percentage > 0),
      href: `/classrooms/${classroomId}?tab=assignments&assignmentId=${assignment.id}`,
      categoryId: category?.id ?? null,
      weight: Number(assignment.gradebook_weight),
      returnedAt: row.returned_at,
    })
  }

  const testMap = new Map(source.tests.map(row => [row.id, row]))
  const returnedTests = source.test_attempts.map(row => ({ ...row, tests: testMap.get(row.test_id) }))
  const questionResult = { rows: source.test_questions }
  const responseResult = { rows: source.test_responses }
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
    if (!test || test.status === 'draft' || !row.returned_at) continue
    const questions = questionsByTest.get(row.test_id) ?? []
    const sourcePossible = questions.reduce((sum, question) => sum + question.points, 0)
    const possible = maximumState.states.get(`test:${test.id}`)?.maximum ?? sourcePossible
    if (!(possible > 0)) continue
    const override = overrides.get(itemKey('test', test.id))
    let earned: number
    if (override !== undefined) {
      earned = override
    } else {
      if (questions.length === 0) continue
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
      included: test.include_in_final !== false && Number(test.gradebook_weight) > 0
        && Boolean(category && category.percentage > 0),
      href: `/classrooms/${classroomId}?tab=tests&testId=${test.id}`,
      categoryId: category?.id ?? null,
      weight: Number(test.gradebook_weight),
      returnedAt: row.returned_at,
    })
  }

  const itemMap = new Map(source.items.map(row => [row.id, row]))
  const standaloneResult = { rows: source.item_scores.map(row => ({ ...row, gradebook_items: itemMap.get(row.item_id) })) }
  for (const row of standaloneResult.rows) {
    const item = row.gradebook_items
    if (!item || row.earned == null) continue
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
      included: item.include_in_final !== false && Number(item.gradebook_weight) > 0
        && Boolean(category && category.percentage > 0),
      href: null,
      categoryId: category?.id ?? null,
      weight: Number(item.gradebook_weight),
      // Standalone marks are disclosed on save; this timestamp only sorts the list.
      returnedAt: row.updated_at,
    })
  }

  for (const item of items) {
    const type = item.kind === 'Classwork' ? 'assignment' : item.kind === 'Test' ? 'test' : 'item'
    const state = maximumState.states.get(`${type}:${item.id}`)
    if (!state) continue
    item.possible = state.maximum ?? item.possible
    item.earned *= state.score_scale
    item.percent = item.earned / item.possible * 100
  }
  return buildStudentGradesResponse({
    categories: categories.map(({ id, percentage }) => ({ id, percentage })),
    items,
    compactZeroWeightAssessments: visibility.gradebook_compact_zero_weight_assessments ?? true,
  })
}

export function projectMemberGradebookItems(source: GradebookMemberSource) {
  const states = gradebookSourceMaximumState(source)
  const categories = new Map(source.categories.map(row => [row.id, row]))
  const parents = new Map(source.items.map(row => [row.id, row]))
  const items = [...source.item_scores].sort((a,b) => b.updated_at.localeCompare(a.updated_at) || a.item_id.localeCompare(b.item_id)).flatMap(score => {
    const item = parents.get(score.item_id)
    if (!item || score.earned == null) return []
    const state = states.get('item:' + item.id)
    const category = item.gradebook_category_id ? categories.get(item.gradebook_category_id) : undefined
    return [projectGradebookItemMark(item, score.earned, category, state)]
  })
  return { items, compactZeroWeightAssessments: source.visibility.gradebook_compact_zero_weight_assessments }
}
