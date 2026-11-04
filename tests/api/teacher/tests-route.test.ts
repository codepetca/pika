import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectContentFreeDiagnostic, privateDiagnosticError } from '../../helpers/diagnostics'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/teacher/tests/route'
import { assertTeacherOwnsClassroom } from '@/lib/server/classrooms'

const mockGetClassroomStudentIds = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({
    id: 'teacher-1',
    email: 'teacher@example.com',
    role: 'teacher',
  })),
}))

vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'classroom-1', teacher_id: 'teacher-1' },
  })),
  assertTeacherCanMutateClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'classroom-1', teacher_id: 'teacher-1' },
  })),
  getClassroomStudentIds: mockGetClassroomStudentIds,
}))

const mockSupabaseClient = { from: vi.fn() }

function buildStudentScopedStatsTable(options: {
  rows: Array<Record<string, any>>
  error?: unknown
  inCalls?: Array<{ table: string; column: string; values: string[] }>
  table: string
}) {
  return {
    select: vi.fn(() => {
      let selectedTestIds: string[] = []
      const query: any = {
        in: vi.fn((column: string, values: string[]) => {
          options.inCalls?.push({ table: options.table, column, values })
          if (column === 'test_id') {
            selectedTestIds = values
            return query
          }
          if (column === 'student_id') {
            if (options.error) {
              return Promise.resolve({ data: null, error: options.error })
            }
            return Promise.resolve({
              data: options.rows.filter(
                (row) => selectedTestIds.includes(row.test_id) && values.includes(row.student_id)
              ),
              error: null,
            })
          }
          return query
        }),
      }
      return query
    }),
  }
}

function buildTestIdStatsTable(options: {
  rows: Array<Record<string, any>>
  error?: unknown
  filterColumn?: string
  inCalls?: Array<{ table: string; column: string; values: string[] }>
  table: string
}) {
  return {
    select: vi.fn(() => ({
      in: vi.fn((column: string, values: string[]) => {
        options.inCalls?.push({ table: options.table, column, values })
        if (options.error) {
          return Promise.resolve({ data: null, error: options.error })
        }
        const filterColumn = options.filterColumn ?? column
        return Promise.resolve({
          data: options.rows.filter((row) => values.includes(row[filterColumn])),
          error: null,
        })
      }),
    })),
  }
}

function buildAssessmentDraftRows(rows: Array<{ assessment_id: string; content: Record<string, unknown> }>) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn((_column: string, values: string[]) =>
          Promise.resolve({
            data: rows.filter((row) => values.includes(row.assessment_id)),
            error: null,
          })
        ),
      })),
    })),
  }
}

describe('GET /api/teacher/tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetClassroomStudentIds.mockResolvedValue({
      studentIds: [],
      studentIdSet: new Set(),
      totalStudents: 0,
      error: null,
    })
  })

  function setupPagedStats(failTable?: string, questionCount = 1001) {
    const students = Array.from({ length: 40 }, (_, i) => `student-${i}`)
    const tests = Array.from({ length: 26 }, (_, i) => ({ id: `test-${i}`, status: 'active' }))
    mockGetClassroomStudentIds.mockResolvedValue({ studentIds: students, studentIdSet: new Set(students), totalStudents: students.length, error: null })
    const byTable: Record<string, Array<Record<string, unknown>>> = {
      test_questions: Array.from({ length: questionCount }, (_, i) => ({ id: `q-${String(i).padStart(4, '0')}`, test_id: 'test-0' })),
      test_attempts: tests.flatMap((test, t) => students.map((student, s) => ({ id: `a-${String(t * 40 + s).padStart(4, '0')}`, test_id: test.id, student_id: student, is_submitted: t !== 0 }))),
      test_student_availability: tests.flatMap((test, t) => students.map((student, s) => ({ id: `v-${String(t * 40 + s).padStart(4, '0')}`, test_id: test.id, student_id: student, state: 'closed' }))),
      test_responses: students.flatMap((student, s) => Array.from({ length: 30 }, (_, q) => ({ id: `r-${String(s * 30 + q).padStart(4, '0')}`, test_id: 'test-0', student_id: student, selected_option: 0, response_text: null }))),
    }
    const pages: Record<string, number[]> = {}
    mockSupabaseClient.from = vi.fn((table: string) => {
      const filters: Record<string, string[]> = {}
      let start = 0, end = 999
      const builder: any = {
        select: () => builder, eq: () => builder,
        in: (column: string, values: string[]) => { filters[column] = values; return builder },
        order: (column: string) => { if (byTable[table]) expect(column).toBe('id'); return builder },
        range: (from: number, to: number) => { start = from; end = to; return builder },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          if (table === 'tests') return Promise.resolve({ data: tests, error: null }).then(resolve, reject)
          if (table === 'assessment_drafts') return Promise.resolve({ data: [], error: null }).then(resolve, reject)
          ;(pages[table] ??= []).push(start)
          const rows = byTable[table].filter(row => Object.entries(filters).every(([key, values]) => values.includes(row[key] as string)))
          const result = failTable === table && start === 1000
            ? { data: null, error: { code: 'PAGE_FAILED' } }
            : { data: rows.slice(start, Math.min(end + 1, start + 1000)), error: null }
          return Promise.resolve(result).then(resolve, reject)
        },
      }
      return builder
    })
    return pages
  }

  it('reads all statistics beyond the PostgREST cap with stable ordering', async () => {
    const pages = setupPagedStats()
    const response = await GET(new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.tests[0].stats).toMatchObject({ questions_count: 1001, responded: 40, submitted: 0, closed_access: 40 })
    expect(body.tests[25].stats).toMatchObject({ submitted: 40, closed_access: 40 })
    for (const table of ['test_questions', 'test_attempts', 'test_responses', 'test_student_availability']) expect(pages[table]).toEqual([0, 1000])
  })

  it('requests an empty page at an exact 1000-row boundary', async () => {
    const pages = setupPagedStats(undefined, 1000)
    const response = await GET(new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1'))
    expect(response.status).toBe(200)
    expect((await response.json()).tests[0].stats.questions_count).toBe(1000)
    expect(pages.test_questions).toEqual([0, 1000])
  })

  it.each(['test_questions', 'test_attempts', 'test_responses', 'test_student_availability'])('fails instead of returning partial statistics when the second %s page fails', async (table) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const pages = setupPagedStats(table)
      const response = await GET(new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1'))
      expect(response.status).toBe(500)
      expect(pages[table]).toEqual([0, 1000])
    } finally { log.mockRestore() }
  })

  it('starts attempt reads while questions are pending and preserves the result', async () => {
    mockGetClassroomStudentIds.mockResolvedValueOnce({ studentIds: ['student-1'], studentIdSet: new Set(['student-1']), totalStudents: 1, error: null })
    let finishQuestions!: (value: unknown) => void
    const questions = new Promise(resolve => { finishQuestions = resolve })
    mockSupabaseClient.from = vi.fn((table: string) => {
      const result = table === 'tests' ? { data: [{ id: 'test-1', status: 'active' }], error: null }
        : table === 'test_attempts' ? { data: [{ test_id: 'test-1', student_id: 'student-1', is_submitted: true }], error: null }
          : { data: [], error: null }
      const pending = table === 'test_questions' ? questions : Promise.resolve(result)
      const builder: any = { select: () => builder, eq: () => builder, order: () => builder, in: () => builder, then: pending.then.bind(pending) }
      return builder
    })
    const response = GET(new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1'))
    await vi.waitFor(() => expect(mockSupabaseClient.from).toHaveBeenCalledWith('test_attempts'))
    expect(mockSupabaseClient.from).toHaveBeenCalledWith('test_questions')
    expect(mockSupabaseClient.from).not.toHaveBeenCalledWith('test_responses')
    finishQuestions({ data: [{ test_id: 'test-1' }], error: null })
    const result = await response
    expect(result.status).toBe(200)
    const body = await result.json()
    expect(body.tests[0].stats).toMatchObject({ questions_count: 1, submitted: 1, responded: 1 })
    expect(mockSupabaseClient.from.mock.calls.map(([table]) => table)).toEqual([
      'tests', 'test_questions', 'test_attempts', 'test_responses', 'test_student_availability', 'assessment_drafts',
    ])
  })

  it('returns a question error without waiting for a late rejected attempt', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetClassroomStudentIds.mockResolvedValueOnce({ studentIds: ['student-1'], studentIdSet: new Set(['student-1']), totalStudents: 1, error: null })
    let rejectAttempts!: (reason: Error) => void
    const attempts = new Promise((_resolve, reject) => { rejectAttempts = reject })
    mockSupabaseClient.from = vi.fn((table: string) => {
      const value = table === 'tests' ? { data: [{ id: 'test-1', status: 'active' }], error: null }
        : { data: null, error: { code: 'QUESTION_FAILURE' } }
      const pending = table === 'test_attempts' ? attempts : Promise.resolve(value)
      const builder: any = { select: () => builder, eq: () => builder, order: () => builder, in: () => builder, then: pending.then.bind(pending) }
      return builder
    })
    try {
      const response = await GET(new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1'))
      expect(response.status).toBe(500)
      expect(JSON.stringify(log.mock.calls)).toContain('test.list_questions')
      expect(JSON.stringify(log.mock.calls)).not.toContain('test.list_attempts')
      rejectAttempts(new Error('late attempt rejection'))
      await new Promise(resolve => setTimeout(resolve, 0))
    } finally { log.mockRestore() }
  })

  it('does not start an attempt read for an empty roster', async () => {
    mockSupabaseClient.from = vi.fn((table: string) => {
      const pending = Promise.resolve({ data: table === 'tests' ? [{ id: 'test-1', status: 'active' }] : [], error: null })
      const builder: any = { select: () => builder, eq: () => builder, order: () => builder, in: () => builder, then: pending.then.bind(pending) }
      return builder
    })
    const result = await GET(new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1'))
    expect(result.status).toBe(200)
    expect(mockSupabaseClient.from).not.toHaveBeenCalledWith('test_attempts')
  })

  it('observes an early attempt rejection while questions remain pending', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetClassroomStudentIds.mockResolvedValueOnce({ studentIds: ['student-1'], studentIdSet: new Set(['student-1']), totalStudents: 1, error: null })
    let finishQuestions!: (value: unknown) => void
    const questions = new Promise(resolve => { finishQuestions = resolve })
    mockSupabaseClient.from = vi.fn((table: string) => {
      const pending = table === 'test_questions' ? questions : table === 'test_attempts'
        ? Promise.reject(new Error('attempt failed'))
        : Promise.resolve({ data: [{ id: 'test-1', status: 'active' }], error: null })
      const builder: any = { select: () => builder, eq: () => builder, order: () => builder, in: () => builder, then: pending.then.bind(pending) }
      return builder
    })
    try {
      const pending = GET(new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1'))
      await vi.waitFor(() => expect(mockSupabaseClient.from).toHaveBeenCalledWith('test_attempts'))
      await new Promise(resolve => setTimeout(resolve, 0))
      finishQuestions({ data: [], error: null })
      expect((await pending).status).toBe(500)
    } finally { log.mockRestore() }
  })

  it('keeps the missing attempt table fallback', async () => {
    mockGetClassroomStudentIds.mockResolvedValueOnce({ studentIds: ['student-1'], studentIdSet: new Set(['student-1']), totalStudents: 1, error: null })
    mockSupabaseClient.from = vi.fn((table: string) => {
      const value = table === 'tests' ? { data: [{ id: 'test-1', status: 'active' }], error: null }
        : table === 'test_attempts' ? { data: null, error: { code: 'PGRST205' } } : { data: [], error: null }
      const pending = Promise.resolve(value)
      const builder: any = { select: () => builder, eq: () => builder, order: () => builder, in: () => builder, then: pending.then.bind(pending) }
      return builder
    })
    const result = await GET(new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1'))
    expect(result.status).toBe(200)
    expect((await result.json()).tests[0].stats.submitted).toBe(0)
  })

  it('starts the roster while the tests read is pending', async () => {
    let resolveTests!: (value: { data: never[]; error: null }) => void
    const tests = new Promise<{ data: never[]; error: null }>((resolve) => { resolveTests = resolve })
    const builder: any = { select: () => builder, eq: () => builder, order: () => builder, then: tests.then.bind(tests) }
    mockSupabaseClient.from = vi.fn(() => builder)
    const response = GET(new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1'))
    await vi.waitFor(() => expect(mockSupabaseClient.from).toHaveBeenCalledWith('tests'))
    await vi.waitFor(() => expect(mockGetClassroomStudentIds).toHaveBeenCalledOnce())
    resolveTests({ data: [], error: null })
    expect((await response).status).toBe(200)
    expect(mockGetClassroomStudentIds).toHaveBeenCalledOnce()
  })

  it('does not start either read when ownership is denied', async () => {
    vi.mocked(assertTeacherOwnsClassroom).mockResolvedValueOnce({ ok: false, status: 403, error: 'Forbidden' })
    mockSupabaseClient.from = vi.fn()
    const response = await GET(new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1'))
    expect(response.status).toBe(403)
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
    expect(mockGetClassroomStudentIds).not.toHaveBeenCalled()
  })

  it.each([
    [{ code: 'PGRST205' }, 200, { tests: [], migration_required: true }],
    [{ code: 'OTHER' }, 500, { error: 'Failed to fetch tests' }],
  ])('prioritizes tests errors over a rejected roster read', async (error, status, body) => {
    mockGetClassroomStudentIds.mockRejectedValueOnce(new Error('roster failed'))
    const builder: any = { select: () => builder, eq: () => builder, order: () => builder,
      then: (resolve: (value: unknown) => void) => resolve({ data: null, error }) }
    mockSupabaseClient.from = vi.fn(() => builder)
    const response = await GET(new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1'))
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual(body)
  })

  it('returns a tests error without waiting for a slow roster', async () => {
    let rejectRoster!: (error: Error) => void
    mockGetClassroomStudentIds.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectRoster = reject }))
    const builder: any = { select: () => builder, eq: () => builder, order: () => builder,
      then: (resolve: (value: unknown) => void) => resolve({ data: null, error: { code: 'OTHER' } }) }
    mockSupabaseClient.from = vi.fn(() => builder)
    const response = await GET(new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1'))
    expect(response.status).toBe(500)
    rejectRoster(new Error('late roster failure'))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('observes a rejecting roster thenable while the tests query remains pending', async () => {
    let resolveTests!: (value: { data: never[]; error: null }) => void
    const tests = new Promise<{ data: never[]; error: null }>((resolve) => { resolveTests = resolve })
    const builder: any = { select: () => builder, eq: () => builder, order: () => builder, then: tests.then.bind(tests) }
    mockSupabaseClient.from = vi.fn(() => builder)
    mockGetClassroomStudentIds.mockReturnValueOnce({ then: (_resolve: unknown, reject: (error: Error) => void) => reject(new Error('roster failure')) })
    const pending = GET(new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1'))
    await vi.waitFor(() => expect(mockGetClassroomStudentIds).toHaveBeenCalledOnce())
    resolveTests({ data: [], error: null })
    expect((await pending).status).toBe(500)
  })

  it('returns a rejected tests query without waiting for a slow roster', async () => {
    let resolveRoster!: (value: any) => void
    mockGetClassroomStudentIds.mockReturnValueOnce(new Promise((resolve) => { resolveRoster = resolve }))
    const rejected = Promise.reject(new Error('tests failure'))
    const builder: any = { select: () => builder, eq: () => builder, order: () => builder, then: rejected.then.bind(rejected) }
    mockSupabaseClient.from = vi.fn(() => builder)
    const response = await GET(new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1'))
    expect(response.status).toBe(500)
    resolveRoster({ studentIds: [], studentIdSet: new Set(), totalStudents: 0, error: null })
  })

  it('requests tests in descending position order with a descending created_at tie-breaker', async () => {
    const orderCalls: Array<{ column: string; ascending: boolean | undefined }> = []

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        const builder: any = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          order: vi.fn((column: string, options?: { ascending?: boolean }) => {
            orderCalls.push({ column, ascending: options?.ascending })
            return builder
          }),
          then: vi.fn((resolve: any) =>
            resolve({
              data: [
                { id: 'test-2', classroom_id: 'classroom-1', title: 'Newest', position: 2, created_at: '2026-03-02T00:00:00.000Z' },
                { id: 'test-1', classroom_id: 'classroom-1', title: 'Older', position: 1, created_at: '2026-03-01T00:00:00.000Z' },
              ],
              error: null,
            })
          ),
        }
        return builder
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
          })),
        }
      }

      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }

      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }

      if (table === 'test_responses') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(orderCalls).toEqual([
      { column: 'position', ascending: false },
      { column: 'created_at', ascending: false },
    ])
    expect(data).not.toHaveProperty('quizzes')
    expect((data.tests as Array<{ id: string }>).map((test) => test.id)).toEqual(['test-2', 'test-1'])
  })

  it('returns 500 when reading test responses fails', async () => {
    mockGetClassroomStudentIds.mockResolvedValueOnce({
      studentIds: ['student-1'],
      studentIdSet: new Set(['student-1']),
      totalStudents: 10,
      error: null,
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            then: vi.fn((resolve: any) =>
              resolve({
                data: [{ id: 'test-1', classroom_id: 'classroom-1', title: 'T1', position: 0 }],
                error: null,
              })
            ),
          })),
        }
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ count: 10, error: null }),
          })),
        }
      }

      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [{ test_id: 'test-1' }], error: null }),
          })),
        }
      }

      if (table === 'test_attempts') {
        return buildStudentScopedStatsTable({
          table,
          rows: [{ test_id: 'test-1', student_id: 'student-1', is_submitted: true }],
        })
      }

      if (table === 'test_responses') {
        return buildStudentScopedStatsTable({
          table,
          rows: [],
          error: { message: 'Database error' },
        })
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to fetch tests')
  })

  it('returns 500 when reading classroom enrollments fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetClassroomStudentIds.mockResolvedValueOnce({
      studentIds: [],
      studentIdSet: new Set(),
      totalStudents: 0,
      error: privateDiagnosticError,
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            then: vi.fn((resolve: any) =>
              resolve({
                data: [{ id: 'test-1', classroom_id: 'classroom-1', title: 'T1', position: 0 }],
                error: null,
              })
            ),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to fetch classroom enrollments')
    expectContentFreeDiagnostic(log.mock.calls, 'test.list_enrollments')
    log.mockRestore()
  })

  it('does not count placeholder graded rows as respondents', async () => {
    mockGetClassroomStudentIds.mockResolvedValueOnce({
      studentIds: ['student-1'],
      studentIdSet: new Set(['student-1']),
      totalStudents: 10,
      error: null,
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            then: vi.fn((resolve: any) =>
              resolve({
                data: [{ id: 'test-1', classroom_id: 'classroom-1', title: 'T1', position: 0 }],
                error: null,
              })
            ),
          })),
        }
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ count: 10, error: null }),
          })),
        }
      }

      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [{ test_id: 'test-1' }], error: null }),
          })),
        }
      }

      if (table === 'test_attempts') {
        return buildStudentScopedStatsTable({ table, rows: [] })
      }

      if (table === 'test_responses') {
        return buildStudentScopedStatsTable({
          table,
          rows: [
            {
              test_id: 'test-1',
              student_id: 'student-1',
              selected_option: null,
              response_text: '   ',
            },
          ],
        })
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.tests).toHaveLength(1)
    expect(data.tests[0].stats.responded).toBe(0)
  })

  it('counts only currently enrolled students as respondents', async () => {
    const scopedInCalls: Array<{ table: string; column: string; values: string[] }> = []
    mockGetClassroomStudentIds.mockResolvedValueOnce({
      studentIds: ['student-1', 'student-2'],
      studentIdSet: new Set(['student-1', 'student-2']),
      totalStudents: 2,
      error: null,
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            then: vi.fn((resolve: any) =>
              resolve({
                data: [{ id: 'test-1', classroom_id: 'classroom-1', title: 'T1', status: 'active', position: 0 }],
                error: null,
              })
            ),
          })),
        }
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [{ student_id: 'student-1' }, { student_id: 'student-2' }],
              count: 2,
              error: null,
            }),
          })),
        }
      }

      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [{ test_id: 'test-1' }], error: null }),
          })),
        }
      }

      if (table === 'test_attempts') {
        return buildStudentScopedStatsTable({
          table,
          inCalls: scopedInCalls,
          rows: [
            { test_id: 'test-1', student_id: 'student-1', is_submitted: true },
            { test_id: 'test-1', student_id: 'student-3', is_submitted: true },
          ],
        })
      }

      if (table === 'test_responses') {
        return buildStudentScopedStatsTable({
          table,
          inCalls: scopedInCalls,
          rows: [
            {
              test_id: 'test-1',
              student_id: 'student-2',
              selected_option: 0,
              response_text: null,
            },
            {
              test_id: 'test-1',
              student_id: 'student-4',
              selected_option: 1,
              response_text: null,
            },
          ],
        })
      }

      if (table === 'test_student_availability') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => ({
              in: vi.fn().mockResolvedValue({
                data: [{ test_id: 'test-1', student_id: 'student-1', state: 'closed' }],
                error: null,
              }),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.tests).toHaveLength(1)
    expect(data.tests[0].stats.total_students).toBe(2)
    expect(data.tests[0].stats.responded).toBe(2)
    expect(data.tests[0].stats.submitted).toBe(1)
    expect(data.tests[0].stats.open_access).toBe(1)
    expect(data.tests[0].stats.closed_access).toBe(1)
    expect(scopedInCalls).toContainEqual({
      table: 'test_attempts',
      column: 'student_id',
      values: ['student-1', 'student-2'],
    })
    expect(scopedInCalls).toContainEqual({
      table: 'test_responses',
      column: 'student_id',
      values: ['student-1', 'student-2'],
    })
  })

  it('chunks test stats filters for large rosters and test lists', async () => {
    const studentIds = Array.from({ length: 51 }, (_, index) => `student-${index + 1}`)
    const testRows = Array.from({ length: 51 }, (_, index) => ({
      id: `test-${index + 1}`,
      classroom_id: 'classroom-1',
      title: `Test ${index + 1}`,
      status: 'active',
      position: index,
    }))
    const questionRows = testRows.map((test) => ({ test_id: test.id }))
    const statsInCalls: Array<{ table: string; column: string; values: string[] }> = []

    mockGetClassroomStudentIds.mockResolvedValueOnce({
      studentIds,
      studentIdSet: new Set(studentIds),
      totalStudents: studentIds.length,
      error: null,
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            then: vi.fn((resolve: any) =>
              resolve({
                data: testRows,
                error: null,
              })
            ),
          })),
        }
      }

      if (table === 'test_questions') {
        return buildTestIdStatsTable({
          table,
          rows: questionRows,
          filterColumn: 'test_id',
          inCalls: statsInCalls,
        })
      }

      if (table === 'test_attempts') {
        return buildStudentScopedStatsTable({
          table,
          inCalls: statsInCalls,
          rows: [{ test_id: 'test-1', student_id: 'student-1', is_submitted: true }],
        })
      }

      if (table === 'test_responses') {
        return buildStudentScopedStatsTable({
          table,
          inCalls: statsInCalls,
          rows: [
            {
              test_id: 'test-1',
              student_id: 'student-2',
              selected_option: 0,
              response_text: null,
            },
          ],
        })
      }

      if (table === 'test_student_availability') {
        return buildStudentScopedStatsTable({
          table,
          inCalls: statsInCalls,
          rows: [{ test_id: 'test-1', student_id: 'student-1', state: 'closed' }],
        })
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.tests).toHaveLength(51)
    expect(data.tests[0].stats).toEqual({
      total_students: 51,
      responded: 2,
      submitted: 1,
      open_access: 50,
      closed_access: 1,
      questions_count: 1,
    })
    expect(statsInCalls.every((call) => call.values.length <= 50)).toBe(true)
    expect(statsInCalls).toContainEqual({
      table: 'test_questions',
      column: 'test_id',
      values: testRows.slice(0, 50).map((test) => test.id),
    })
    expect(statsInCalls).toContainEqual({
      table: 'test_questions',
      column: 'test_id',
      values: ['test-51'],
    })
    expect(statsInCalls).toContainEqual({
      table: 'test_attempts',
      column: 'student_id',
      values: studentIds.slice(0, 50),
    })
    expect(statsInCalls).toContainEqual({
      table: 'test_attempts',
      column: 'student_id',
      values: ['student-51'],
    })
  })

  it('applies draft overlays only to draft tests in the list', async () => {
    const testRows = [
      {
        id: 'test-draft',
        classroom_id: 'classroom-1',
        title: 'Canonical Draft Title',
        status: 'draft',
        show_results: false,
        position: 1,
      },
      {
        id: 'test-closed',
        classroom_id: 'classroom-1',
        title: 'Closed Test',
        status: 'closed',
        show_results: false,
        position: 0,
      },
    ]

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            then: vi.fn((resolve: any) =>
              resolve({
                data: testRows,
                error: null,
              })
            ),
          })),
        }
      }

      if (table === 'test_questions') {
        return buildTestIdStatsTable({
          table,
          rows: [
            { test_id: 'test-draft' },
            { test_id: 'test-closed' },
            { test_id: 'test-closed' },
          ],
          filterColumn: 'test_id',
        })
      }

      if (table === 'assessment_drafts') {
        return buildAssessmentDraftRows([
          {
            assessment_id: 'test-draft',
            content: {
              title: 'Draft Overlay Title',
              show_results: true,
              question_identity_version: 1,
              questions: [],
            },
          },
          {
            assessment_id: 'test-closed',
            content: {
              title: 'Stale Draft Title',
              show_results: true,
              question_identity_version: 1,
              questions: [],
            },
          },
        ])
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.tests[0].title).toBe('Draft Overlay Title')
    expect(data.tests[0].show_results).toBe(true)
    expect(data.tests[0].stats.questions_count).toBe(0)
    expect(data.tests[1].title).toBe('Closed Test')
    expect(data.tests[1].show_results).toBe(false)
    expect(data.tests[1].stats.questions_count).toBe(2)
  })
})

describe('POST /api/teacher/tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a new test at the next position and seeds an initial draft row', async () => {
    const deleteEqSpy = vi.fn().mockResolvedValue({ error: null })
    const deleteSpy = vi.fn(() => ({
      eq: deleteEqSpy,
    }))
    const assessmentDraftInsertSpy = vi.fn((payload: Record<string, unknown>) => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: 'draft-1', ...payload },
          error: null,
        }),
      })),
    }))

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { position: 2 },
                    error: null,
                  }),
                })),
              })),
            })),
          })),
          insert: vi.fn((payload: Record<string, unknown>) => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'test-1',
                  show_results: false,
                  documents: null,
                  ...payload,
                },
                error: null,
              }),
            })),
          })),
          delete: deleteSpy,
        }
      }

      if (table === 'assessment_drafts') {
        return {
          insert: assessmentDraftInsertSpy,
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/tests', {
        method: 'POST',
        body: JSON.stringify({ classroom_id: 'classroom-1', title: ' New Test ' }),
      })
    )
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data).not.toHaveProperty('quiz')
    expect(data.test.position).toBe(3)
    expect(data.test.title).toBe('New Test')
    expect(assessmentDraftInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        assessment_type: 'test',
        assessment_id: 'test-1',
        classroom_id: 'classroom-1',
        version: 1,
        created_by: 'teacher-1',
        updated_by: 'teacher-1',
        content: {
          title: 'New Test',
          show_results: false,
          question_identity_version: 1,
          questions: [],
          source_format: 'markdown',
        },
      })
    )
    expect(deleteSpy).not.toHaveBeenCalled()
  })

  it('creates an untitled draft when title is omitted', async () => {
    const assessmentDraftInsertSpy = vi.fn((payload: Record<string, unknown>) => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: 'draft-1', ...payload },
          error: null,
        }),
      })),
    }))

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: null,
                  }),
                })),
              })),
            })),
          })),
          insert: vi.fn((payload: Record<string, unknown>) => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'test-1',
                  show_results: false,
                  documents: null,
                  ...payload,
                },
                error: null,
              }),
            })),
          })),
          delete: vi.fn(),
        }
      }

      if (table === 'assessment_drafts') {
        return {
          insert: assessmentDraftInsertSpy,
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/tests', {
        method: 'POST',
        body: JSON.stringify({ classroom_id: 'classroom-1' }),
      })
    )
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.test.title).toMatch(/^Untitled \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(assessmentDraftInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          title: data.test.title,
        }),
      })
    )
  })

  it('rolls back the new test when the assessment drafts table is unavailable', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const deleteEqSpy = vi.fn().mockResolvedValue({ error: null })
    const deleteSpy = vi.fn(() => ({
      eq: deleteEqSpy,
    }))

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { position: 0 },
                    error: null,
                  }),
                })),
              })),
            })),
          })),
          insert: vi.fn((payload: Record<string, unknown>) => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'test-1',
                  show_results: false,
                  documents: null,
                  ...payload,
                },
                error: null,
              }),
            })),
          })),
          delete: deleteSpy,
        }
      }

      if (table === 'assessment_drafts') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: {
                  ...privateDiagnosticError,
                  code: 'PGRST205',
                  message: `relation "assessment_drafts" does not exist ${privateDiagnosticError.message}`,
                },
              }),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/tests', {
        method: 'POST',
        body: JSON.stringify({ classroom_id: 'classroom-1', title: 'Draftless Test' }),
      })
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Assessment drafts require migration 045 to be applied')
    expect(deleteSpy).toHaveBeenCalledTimes(1)
    expect(deleteEqSpy).toHaveBeenCalledWith('id', 'test-1')
    expectContentFreeDiagnostic(log.mock.calls, 'test.create_draft')
    log.mockRestore()
  })
})
