import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getStudentGrades } from '@/lib/server/student-grades'
import { DEFAULT_CLASSROOM_FEATURE_VISIBILITY } from '@/lib/classroom-feature-visibility'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  loadPagedRows: vi.fn(),
  loadChunkedRows: vi.fn(),
}))

vi.mock('@/lib/server/classrooms', () => ({ assertStudentCanAccessClassroom: mocks.access }))
vi.mock('@/lib/server/query-chunks', () => ({
  loadPagedRows: mocks.loadPagedRows,
  loadChunkedRows: mocks.loadChunkedRows,
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ from: vi.fn() }) }))

const classroomId = '11111111-1111-4111-8111-111111111111'
const studentId = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({
    ok: true,
    classroom: { feature_visibility: { ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY, student_grades: true } },
  })
})

describe('student grades server projection', () => {
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

  it('projects returned assignments, tests, and standalone items while honoring assessment overrides', async () => {
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
        item_id: 'item-1', earned: 8, returned_at: '2026-09-18T12:00:00Z',
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
    expect(JSON.stringify(result)).not.toContain('categoryId')
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
        item_id: 'zero-item', earned: 0, returned_at: '2026-09-20T12:00:00Z',
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
