import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getStudentGrades } from '@/lib/server/student-grades'
import { DEFAULT_CLASSROOM_FEATURE_VISIBILITY } from '@/lib/classroom-feature-visibility'
import { calculateCategorizedFinalPercent } from '@/lib/gradebook'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  rpc: vi.fn(),
  loadPagedRows: vi.fn(),
  loadChunkedRows: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/server/classrooms', () => ({ assertStudentCanAccessClassroom: mocks.access }))
vi.mock('@/lib/server/query-chunks', () => ({
  loadPagedRows: mocks.loadPagedRows,
  loadChunkedRows: mocks.loadChunkedRows,
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }))

const classroomId = '11111111-1111-4111-8111-111111111111'
const studentId = '22222222-2222-4222-8222-222222222222'

type QueryRow = Record<string, unknown>

// Execute the actual query builders so mocked paging cannot bypass privacy or release predicates.
function queryTables(tables: Record<string, QueryRow[]>) {
  const queries = new Map<string, ReturnType<typeof makeQuery>>()
  function makeQuery(rows: QueryRow[]) {
    const predicates: Array<(row: QueryRow) => boolean> = []
    const value = (row: QueryRow, key: string) => key.split('.').reduce<unknown>((entry, field) => (entry as QueryRow)?.[field], row)
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((key: string, expected: unknown) => { predicates.push(row => value(row, key) === expected); return query }),
      not: vi.fn((key: string, _operator: string, expected: unknown) => { predicates.push(row => value(row, key) !== expected); return query }),
      order: vi.fn().mockReturnThis(),
      execute: () => ({ rows: rows.filter(row => predicates.every(predicate => predicate(row))), error: null }),
    }
    return query
  }
  mocks.from.mockImplementation((table: string) => {
    const query = makeQuery(tables[table] ?? [])
    queries.set(table, query)
    return query
  })
  mocks.loadPagedRows.mockImplementation(async (buildQuery: () => ReturnType<typeof makeQuery>) => buildQuery().execute())
  return queries
}

function standaloneScore(id: string, earned: number | null, rowChanges: QueryRow = {}, itemChanges: QueryRow = {}) {
  return {
    item_id: id, classroom_id: classroomId, student_id: studentId, earned,
    returned_at: null, updated_at: '2026-09-22T12:00:00Z',
    ...rowChanges,
    gradebook_items: {
      id, classroom_id: classroomId, title: id, points_possible: 10,
      include_in_final: true, gradebook_weight: 1, gradebook_category_id: 'term',
      ...itemChanges,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.loadPagedRows.mockReset()
  mocks.loadChunkedRows.mockReset()
  mocks.from.mockReset()
  mocks.loadChunkedRows.mockResolvedValue({ rows: [], error: null })
  mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
  mocks.access.mockResolvedValue({
    ok: true,
    classroom: { feature_visibility: { ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY, student_grades: true } },
  })
})

describe('student grades server projection', () => {
  it.each(['Not enrolled in this classroom', 'Classroom is archived'])('honors classroom access: %s', async error => {
    mocks.access.mockResolvedValueOnce({ ok: false, status: 403, error })
    await expect(getStudentGrades(studentId, classroomId)).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.access).toHaveBeenCalledWith(studentId, classroomId)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.loadPagedRows).not.toHaveBeenCalled()
  })

  it('rejects hidden grades before reading gradebook data', async () => {
    mocks.access.mockResolvedValueOnce({
      ok: true,
      classroom: { feature_visibility: DEFAULT_CLASSROOM_FEATURE_VISIBILITY },
    })

    await expect(getStudentGrades(studentId, classroomId)).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.loadPagedRows).not.toHaveBeenCalled()
  })

  it('rejects aggregate grades when both student grade sources are hidden', async () => {
    mocks.access.mockResolvedValueOnce({
      ok: true,
      classroom: {
        feature_visibility: {
          ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY,
          student_grades: true,
          classwork: false,
          tests: false,
        },
      },
    })

    await expect(getStudentGrades(studentId, classroomId)).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.loadPagedRows).not.toHaveBeenCalled()
  })

  it('counts saved standalone scores and deliberate zero with teacher calculation parity while assignments/tests still require return', async () => {
    const assignment = {
      assignment_id: 'returned-assignment', student_id: studentId,
      score_completion: 8, score_thinking: 8, score_workflow: 8, returned_at: '2026-09-20T12:00:00Z',
      assignments: { id: 'returned-assignment', classroom_id: classroomId, title: 'Essay', points_possible: 10, include_in_final: true, gradebook_weight: 1, gradebook_category_id: 'term', is_draft: false },
    }
    const test = {
      test_id: 'returned-test', student_id: studentId, returned_at: '2026-09-19T12:00:00Z',
      tests: { id: 'returned-test', classroom_id: classroomId, title: 'Unit test', status: 'published', include_in_final: true, gradebook_weight: 1, gradebook_category_id: 'final' },
    }
    const queries = queryTables({
      gradebook_categories: [
        { id: 'term', classroom_id: classroomId, name: 'Term', percentage: 70 },
        { id: 'final', classroom_id: classroomId, name: 'Final', percentage: 30 },
      ],
      assignment_docs: [
        assignment,
        { ...assignment, assignment_id: 'unreturned-assignment', returned_at: null, assignments: { ...assignment.assignments, id: 'unreturned-assignment' } },
        { ...assignment, student_id: 'another-student' },
        { ...assignment, assignments: { ...assignment.assignments, classroom_id: 'another-classroom' } },
        { ...assignment, assignments: { ...assignment.assignments, id: 'draft-assignment', is_draft: true } },
      ],
      test_attempts: [
        test,
        { ...test, test_id: 'unreturned-test', returned_at: null, tests: { ...test.tests, id: 'unreturned-test' } },
        { ...test, student_id: 'another-student' },
        { ...test, tests: { ...test.tests, classroom_id: 'another-classroom' } },
        { ...test, tests: { ...test.tests, id: 'draft-test', status: 'draft' } },
      ],
      gradebook_item_scores: [
        standaloneScore('new-score', 10, { updated_at: '2026-09-25T12:00:00Z' }, { gradebook_weight: 3 }),
        standaloneScore('legacy-edited', 0, { updated_at: '2026-09-24T12:00:00Z' }, { title: 'Participation revised' }),
        standaloneScore('external-exam', 16, { returned_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-23T12:00:00Z' }, { points_possible: 20, gradebook_category_id: 'final', gradebook_weight: 2 }),
        standaloneScore('excluded', 10, {}, { include_in_final: false }),
        standaloneScore('blank-unreturned', null),
        standaloneScore('blank-legacy', null, { returned_at: '2026-09-26T12:00:00Z' }),
        standaloneScore('other-student', 10, { student_id: 'another-student' }),
        standaloneScore('other-score-classroom', 10, { classroom_id: 'another-classroom' }),
        standaloneScore('other-item-classroom', 10, {}, { classroom_id: 'another-classroom' }),
      ],
    })
    mocks.loadChunkedRows
      .mockResolvedValueOnce({ rows: [{ id: 'q1', test_id: 'returned-test', points: 10 }], error: null })
      .mockResolvedValueOnce({ rows: [{ test_id: 'returned-test', question_id: 'q1', score: 6 }], error: null })

    const result = await getStudentGrades(studentId, classroomId)

    expect(result.items.map(item => item.id)).toEqual([
      'new-score', 'legacy-edited', 'external-exam', 'excluded', 'returned-assignment', 'returned-test',
    ])
    expect(result.items.find(item => item.id === 'legacy-edited')).toMatchObject({ title: 'Participation revised', earned: 0, percent: 0, included: true, href: null })
    expect(result.items.find(item => item.id === 'excluded')?.included).toBe(false)
    const teacherCalculation = calculateCategorizedFinalPercent({
      categories: [{ id: 'term', percentage: 70 }, { id: 'final', percentage: 30 }],
      items: [
        { earned: 8, possible: 10, weight: 1, categoryId: 'term' },
        { earned: 10, possible: 10, weight: 3, categoryId: 'term' },
        { earned: 0, possible: 10, weight: 1, categoryId: 'term' },
        { earned: 6, possible: 10, weight: 1, categoryId: 'final' },
        { earned: 16, possible: 20, weight: 2, categoryId: 'final' },
      ],
    })
    expect(result.currentPercent).toBe(75.2)
    expect(result.currentPercent).toBe(teacherCalculation.finalPercent)

    const standalone = queries.get('gradebook_item_scores')!
    expect(standalone.eq.mock.calls).toEqual([
      ['classroom_id', classroomId], ['student_id', studentId], ['gradebook_items.classroom_id', classroomId],
    ])
    expect(standalone.not.mock.calls).toEqual([['earned', 'is', null]])
    expect(standalone.select.mock.calls[0][0]).toContain('updated_at')
    expect(standalone.select.mock.calls[0][0]).not.toContain('returned_at')
    expect(standalone.order.mock.calls).toEqual([
      ['updated_at', { ascending: false }], ['item_id', { ascending: true }],
    ])
    for (const table of ['assignment_docs', 'test_attempts']) {
      expect(queries.get(table)!.not).toHaveBeenCalledWith('returned_at', 'is', null)
    }
    expect(mocks.loadChunkedRows.mock.calls[0][0].filters).toEqual([{ column: 'test_id', values: ['returned-test'] }])
    expect(mocks.loadChunkedRows.mock.calls[1][0].filters).toContainEqual({ column: 'student_id', values: [studentId] })
    for (const privateField of ['returned_at', 'updated_at', 'returnedAt', 'categoryId', 'student_id', 'classroom_id']) {
      expect(JSON.stringify(result)).not.toContain(privateField)
    }
  })

  it.each([null, 0])('treats blank and explicit zero saved standalone scores differently: %s', async earned => {
    queryTables({
      gradebook_categories: [{ id: 'term', classroom_id: classroomId, name: 'Term', percentage: 100 }],
      gradebook_item_scores: [standaloneScore('participation', earned)],
    })
    const result = await getStudentGrades(studentId, classroomId)
    expect(result.items).toHaveLength(earned === null ? 0 : 1)
    expect(result.currentPercent).toBe(earned === null ? null : 0)
    if (earned === 0) expect(result.items[0]).toMatchObject({ earned: 0, percent: 0, included: true })
  })

  it.each([false, true])('honors the Classwork source gate for saved marks, classwork=%s', async classwork => {
    mocks.access.mockResolvedValueOnce({
      ok: true,
      classroom: { feature_visibility: { ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY, student_grades: true, classwork, tests: true, gradebook: false } },
    })
    queryTables({
      gradebook_categories: [{ id: 'term', classroom_id: classroomId, name: 'Term', percentage: 100 }],
      gradebook_item_scores: [standaloneScore('participation', 8)],
    })
    const result = await getStudentGrades(studentId, classroomId)
    expect(result.items).toHaveLength(classwork ? 1 : 0)
    expect(result.currentPercent).toBe(classwork ? 80 : null)
    if (!classwork) {
      expect(mocks.from).not.toHaveBeenCalledWith('gradebook_item_scores')
      expect(mocks.from).not.toHaveBeenCalledWith('assignment_docs')
    }
  })

  it('projects returned assignments/tests and saved standalone items while honoring assessment overrides', async () => {
    mocks.loadPagedRows
      .mockResolvedValueOnce({ rows: [
        { id: 'term', name: 'Term', percentage: 70 },
        { id: 'final', name: 'Final', percentage: 30 },
      ], error: null })
      .mockResolvedValueOnce({ rows: [
        { assessment_type: 'assignment', assessment_id: 'assignment-1', earned: 9 },
        { assessment_type: 'final', assessment_id: studentId, earned: 100 },
      ], error: null })
      .mockResolvedValueOnce({ rows: [
        {
          assignment_id: 'assignment-1', score_completion: 8, score_thinking: 8, score_workflow: 8,
          returned_at: '2026-09-20T12:00:00Z',
          assignments: { id: 'assignment-1', title: 'Essay', points_possible: 10, include_in_final: true, gradebook_weight: 1, gradebook_category_id: 'term', is_draft: false },
        },
        {
          assignment_id: 'incomplete', score_completion: 8, score_thinking: null, score_workflow: 8,
          returned_at: '2026-09-21T12:00:00Z',
          assignments: { id: 'incomplete', title: 'Incomplete', points_possible: 10, include_in_final: true, gradebook_weight: 1, gradebook_category_id: 'term', is_draft: false },
        },
      ], error: null })
      .mockResolvedValueOnce({ rows: [{
        test_id: 'test-1', returned_at: '2026-09-19T12:00:00Z',
        tests: { id: 'test-1', title: 'Unit test', status: 'published', include_in_final: true, gradebook_weight: 1, gradebook_category_id: 'final' },
      }], error: null })
      .mockResolvedValueOnce({ rows: [{
        item_id: 'item-1', earned: 8, returned_at: null, updated_at: '2026-09-18T12:00:00Z',
        gradebook_items: { id: 'item-1', title: 'Practice', points_possible: 10, include_in_final: false, gradebook_weight: 1, gradebook_category_id: 'term' },
      }], error: null })
    mocks.loadChunkedRows
      .mockResolvedValueOnce({ rows: [
        { id: 'q1', test_id: 'test-1', points: 10 },
        { id: 'q2', test_id: 'test-1', points: 10 },
      ], error: null })
      .mockResolvedValueOnce({ rows: [
        { test_id: 'test-1', question_id: 'q1', score: 8 },
        { test_id: 'test-1', question_id: 'q2', score: 7 },
      ], error: null })

    const result = await getStudentGrades(studentId, classroomId)

    expect(result.items.map((item) => item.title)).toEqual(['Essay', 'Unit test', 'Practice'])
    expect(result.items[0]).toMatchObject({ earned: 9, possible: 10, percent: 90, included: true })
    expect(result.items[1]).toMatchObject({ earned: 15, possible: 20, percent: 75, included: true })
    expect(result.items[2]).toMatchObject({ included: false, href: null })
    expect(result.currentPercent).toBe(85.5)
    expect(JSON.stringify(result)).not.toContain('returned_at')
    expect(JSON.stringify(result)).not.toContain('updated_at')
    expect(JSON.stringify(result)).not.toContain('returnedAt')
    expect(JSON.stringify(result)).not.toContain('categoryId')
  })

  it.each([{ scale: 1, earned: 8, percent: 160 }, { scale: 0.5, earned: 4, percent: 80 }])('applies maximum scale $scale to returned student marks and final', async ({ scale, earned, percent }) => {
    mocks.rpc.mockResolvedValue({ data: [{ assessment_type: 'assignment', assessment_id: 'a1', maximum: 5, score_scale: scale }], error: null })
    mocks.loadPagedRows
      .mockResolvedValueOnce({ rows: [{ id: 'term', name: 'Term', percentage: 100 }], error: null })
      .mockResolvedValueOnce({ rows: [], error: null })
      .mockResolvedValueOnce({ rows: [{ assignment_id: 'a1', score_completion: 8, score_thinking: 8, score_workflow: 8, returned_at: '2026-09-20T12:00:00Z', assignments: { id: 'a1', title: 'Essay', points_possible: 10, include_in_final: true, gradebook_weight: 1, gradebook_category_id: 'term', is_draft: false } }], error: null })
      .mockResolvedValueOnce({ rows: [], error: null })
      .mockResolvedValueOnce({ rows: [], error: null })
    const result = await getStudentGrades(studentId, classroomId)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ earned, possible: 5, percent })
    expect(result.currentPercent).toBe(percent)
  })

  it('labels returned zero-weight work as not counted across all assessment kinds', async () => {
    mocks.loadPagedRows
      .mockResolvedValueOnce({ rows: [{ id: 'term', name: 'Term', percentage: 100 }], error: null })
      .mockResolvedValueOnce({ rows: [], error: null })
      .mockResolvedValueOnce({ rows: [
        {
          assignment_id: 'included', score_completion: 8, score_thinking: 8, score_workflow: 8,
          returned_at: '2026-09-20T12:00:00Z',
          assignments: { id: 'included', title: 'Included', points_possible: 10, include_in_final: true, gradebook_weight: 10, gradebook_category_id: 'term', is_draft: false },
        },
        {
          assignment_id: 'zero-assignment', score_completion: 0, score_thinking: 0, score_workflow: 0,
          returned_at: '2026-09-20T12:00:00Z',
          assignments: { id: 'zero-assignment', title: 'Zero assignment', points_possible: 10, include_in_final: true, gradebook_weight: 0, gradebook_category_id: 'term', is_draft: false },
        },
      ], error: null })
      .mockResolvedValueOnce({ rows: [{
        test_id: 'zero-test', returned_at: '2026-09-20T12:00:00Z',
        tests: { id: 'zero-test', title: 'Zero test', status: 'published', include_in_final: true, gradebook_weight: 0, gradebook_category_id: 'term' },
      }], error: null })
      .mockResolvedValueOnce({ rows: [{
        item_id: 'zero-item', earned: 0, returned_at: null, updated_at: '2026-09-20T12:00:00Z',
        gradebook_items: { id: 'zero-item', title: 'Zero item', points_possible: 10, include_in_final: true, gradebook_weight: 0, gradebook_category_id: 'term' },
      }], error: null })
    mocks.loadChunkedRows
      .mockResolvedValueOnce({ rows: [{ id: 'q1', test_id: 'zero-test', points: 10 }], error: null })
      .mockResolvedValueOnce({ rows: [{ test_id: 'zero-test', question_id: 'q1', score: 0 }], error: null })

    const result = await getStudentGrades(studentId, classroomId)
    expect(result.currentPercent).toBe(80)
    expect(result.items.find((item) => item.id === 'included')?.included).toBe(true)
    for (const id of ['zero-assignment', 'zero-test', 'zero-item']) {
      expect(result.items.find((item) => item.id === id)?.included).toBe(false)
    }
  })

  it.each([{ questions: [] }, { questions: [{ id: 'q1', test_id: 't1', points: 0 }] }])('returns manual marks on empty/zero-point Tests with a positive maximum (%j)', async ({ questions }) => {
    mocks.rpc.mockResolvedValue({ data: [{ assessment_type: 'test', assessment_id: 't1', maximum: 10, score_scale: 1 }], error: null })
    mocks.loadPagedRows
      .mockResolvedValueOnce({ rows: [{ id: 'term', name: 'Term', percentage: 100 }], error: null })
      .mockResolvedValueOnce({ rows: [{ assessment_type: 'test', assessment_id: 't1', earned: 7 }], error: null })
      .mockResolvedValueOnce({ rows: [], error: null })
      .mockResolvedValueOnce({ rows: [{ test_id: 't1', returned_at: '2026-09-21T12:00:00Z', tests: { id: 't1', title: 'Test', status: 'closed', include_in_final: true, gradebook_weight: 1, gradebook_category_id: 'term' } }], error: null })
      .mockResolvedValueOnce({ rows: [], error: null })
    mocks.loadChunkedRows.mockResolvedValueOnce({ rows: questions, error: null }).mockResolvedValueOnce({ rows: [], error: null })
    const result = await getStudentGrades(studentId, classroomId)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ earned: 7, possible: 10, percent: 70 })
    expect(result.currentPercent).toBe(70)
  })

  it.each([{ scored: true }, { scored: false }])('aligns calculated zero-point Test with teacher, scored=$scored', async ({ scored }) => {
    mocks.rpc.mockResolvedValue({ data: [{ assessment_type: 'test', assessment_id: 't1', maximum: 10, score_scale: 1 }], error: null })
    mocks.loadPagedRows
      .mockResolvedValueOnce({ rows: [{ id: 'term', name: 'Term', percentage: 100 }], error: null })
      .mockResolvedValueOnce({ rows: [], error: null })
      .mockResolvedValueOnce({ rows: [], error: null })
      .mockResolvedValueOnce({ rows: [{ test_id: 't1', returned_at: '2026-09-21T12:00:00Z', tests: { id: 't1', title: 'Test', status: 'closed', include_in_final: true, gradebook_weight: 1, gradebook_category_id: 'term' } }], error: null })
      .mockResolvedValueOnce({ rows: [], error: null })
    mocks.loadChunkedRows.mockResolvedValueOnce({ rows: scored ? [{ id: 'q1', test_id: 't1', points: 0 }] : [], error: null }).mockResolvedValueOnce({ rows: scored ? [{ test_id: 't1', question_id: 'q1', score: 0 }] : [], error: null })
    const result = await getStudentGrades(studentId, classroomId)
    expect(result.items).toHaveLength(scored ? 1 : 0)
    if (scored) expect(result.items[0]).toMatchObject({ earned: 0, possible: 10, percent: 0 })
    expect(result.currentPercent).toBe(scored ? 0 : null)
  })

  it('uses returned assessment overrides when underlying scores are incomplete', async () => {
    mocks.loadPagedRows
      .mockResolvedValueOnce({ rows: [
        { id: 'term', name: 'Term', percentage: 100 },
      ], error: null })
      .mockResolvedValueOnce({ rows: [
        { assessment_type: 'assignment', assessment_id: 'assignment-override', earned: 0 },
        { assessment_type: 'test', assessment_id: 'test-override', earned: 7 },
      ], error: null })
      .mockResolvedValueOnce({ rows: [
        {
          assignment_id: 'assignment-override', score_completion: 1, score_thinking: null, score_workflow: null,
          returned_at: '2026-09-20T12:00:00Z',
          assignments: { id: 'assignment-override', title: 'Overridden assignment', points_possible: 10, include_in_final: true, gradebook_weight: 1, gradebook_category_id: 'term', is_draft: false },
        },
        {
          assignment_id: 'assignment-incomplete', score_completion: 1, score_thinking: null, score_workflow: null,
          returned_at: '2026-09-20T12:00:00Z',
          assignments: { id: 'assignment-incomplete', title: 'Incomplete assignment', points_possible: 10, include_in_final: true, gradebook_weight: 1, gradebook_category_id: 'term', is_draft: false },
        },
      ], error: null })
      .mockResolvedValueOnce({ rows: [
        {
          test_id: 'test-override', returned_at: '2026-09-21T12:00:00Z',
          tests: { id: 'test-override', title: 'Overridden test', status: 'closed', include_in_final: true, gradebook_weight: 1, gradebook_category_id: 'term' },
        },
        {
          test_id: 'test-incomplete', returned_at: '2026-09-21T12:00:00Z',
          tests: { id: 'test-incomplete', title: 'Incomplete test', status: 'closed', include_in_final: true, gradebook_weight: 1, gradebook_category_id: 'term' },
        },
      ], error: null })
      .mockResolvedValueOnce({ rows: [], error: null })
    mocks.loadChunkedRows
      .mockResolvedValueOnce({ rows: [
        { id: 'q1', test_id: 'test-override', points: 10 },
        { id: 'q2', test_id: 'test-incomplete', points: 10 },
      ], error: null })
      .mockResolvedValueOnce({ rows: [], error: null })

    const result = await getStudentGrades(studentId, classroomId)

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'assignment-override', earned: 0, possible: 10, percent: 0 }),
      expect.objectContaining({ id: 'test-override', earned: 7, possible: 10, percent: 70 }),
    ]))
    expect(result.items.map((item) => item.id)).not.toContain('assignment-incomplete')
    expect(result.items.map((item) => item.id)).not.toContain('test-incomplete')
    expect(result.currentPercent).toBe(35)
  })
})
