import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as getStudentTests } from '@/app/api/student/tests/route'
import { GET as getStudentTestDetail } from '@/app/api/student/tests/[id]/route'
import { GET as getStudentTestResults } from '@/app/api/student/tests/[id]/results/route'
import { POST as returnTeacherTest } from '@/app/api/teacher/tests/[id]/return/route'

type Role = 'student' | 'teacher'

let currentUser: { id: string; role: Role } = { id: 'student-1', role: 'student' }

const state = {
  tests: [
    {
      id: 'test-1',
      classroom_id: 'classroom-1',
      title: 'Integration Test',
      status: 'closed',
      show_results: false,
      position: 0,
      documents: [],
      created_by: 'teacher-1',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
    },
  ],
  testQuestions: [
    {
      id: 'q-open-1',
      test_id: 'test-1',
      question_type: 'open_response',
      question_text: 'Explain your reasoning.',
      options: [],
      correct_option: null,
      points: 5,
      response_max_chars: 5000,
      response_monospace: false,
      position: 0,
    },
  ],
  testResponses: [
    {
      id: 'response-1',
      test_id: 'test-1',
      question_id: 'q-open-1',
      student_id: 'student-1',
      selected_option: null,
      response_text: 'My explanation',
      score: 4,
      feedback: 'Solid reasoning',
      graded_at: '2026-03-05T12:00:00.000Z',
      submitted_at: '2026-03-05T11:30:00.000Z',
    },
  ],
  testAttempts: [
    {
      test_id: 'test-1',
      student_id: 'student-1',
      responses: {
        'q-open-1': {
          question_type: 'open_response',
          response_text: 'My explanation',
        },
      },
      is_submitted: true,
      submitted_at: '2026-03-05T11:30:00.000Z',
      returned_at: null as string | null,
      returned_by: null as string | null,
    },
  ],
  testStudentAvailability: [] as Array<{
    test_id: string
    student_id: string
    state: 'open' | 'closed'
  }>,
}

const mockSupabaseClient = { from: vi.fn(), rpc: vi.fn() }

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async (role: Role) => {
    if (role !== currentUser.role) {
      const err = new Error('Forbidden')
      err.name = 'AuthorizationError'
      throw err
    }
    return {
      id: currentUser.id,
      email: `${currentUser.role}@example.com`,
      role: currentUser.role,
    }
  }),
}))

vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'classroom-1', archived_at: null },
  })),
}))

vi.mock('@/lib/server/tests', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/tests')>('@/lib/server/tests')
  return {
    ...actual,
    isMissingTestAttemptReturnColumnsError: vi.fn(() => false),
    assertStudentCanAccessTest: vi.fn(async () => ({
      ok: true,
      test: {
        ...state.tests[0],
        classrooms: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: null },
      },
    })),
    assertTeacherOwnsTest: vi.fn(async () => ({
      ok: true,
      test: {
        ...state.tests[0],
        classrooms: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: null },
      },
    })),
  }
})

function setupSupabaseMock() {
  mockSupabaseClient.rpc = vi.fn(async (fnName: string, params?: Record<string, any>) => {
    if (fnName === 'finalize_test_attempts_for_grading_atomic') {
      return {
        data: { finalized_attempts: 0, inserted_responses: 0 },
        error: null,
      }
    }
    if (fnName === 'return_test_attempts_atomic') {
      const testId = params?.p_test_id
      const studentIds = params?.p_student_ids || []
      const returnedBy = params?.p_returned_by
      const submittedAtByStudent = params?.p_submitted_at_by_student || {}
      const returnedAt = new Date().toISOString()
      let updatedCount = 0
      let insertedCount = 0

      for (const studentId of studentIds) {
        const attempt = state.testAttempts.find(
          (row) => row.test_id === testId && row.student_id === studentId
        )
        if (attempt) {
          attempt.returned_at = returnedAt
          attempt.returned_by = returnedBy
          updatedCount += 1
          continue
        }

        state.testAttempts.push({
          test_id: testId,
          student_id: studentId,
          responses: {},
          is_submitted: true,
          submitted_at: submittedAtByStudent[studentId] || returnedAt,
          returned_at: returnedAt,
          returned_by: returnedBy,
        })
        insertedCount += 1
      }

      return {
        data: {
          returned_count: updatedCount + insertedCount,
          updated_count: updatedCount,
          inserted_count: insertedCount,
        },
        error: null,
      }
    }
    throw new Error(`Unexpected RPC: ${fnName}`)
  })

  ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
    if (table === 'tests') {
      let classroomId: string | null = null
      let status: string | null = null
      const builder: any = {
        select: vi.fn(() => builder),
        eq: vi.fn((column: string, value: string) => {
          if (column === 'classroom_id') classroomId = value
          if (column === 'status') status = value
          return builder
        }),
        order: vi.fn(async () => ({
          data: state.tests.filter(
            (test) =>
              (classroomId ? test.classroom_id === classroomId : true) &&
              (status ? test.status === status : true)
          ),
          error: null,
        })),
        update: vi.fn((updates: Record<string, unknown>) => {
          const updateFilters: Record<string, string> = {}
          const updateChain: any = {
            eq: vi.fn((column: string, value: string) => {
              updateFilters[column] = value

              if (updateFilters.id && updateFilters.status) {
                for (const test of state.tests) {
                  if (test.id === updateFilters.id && test.status === updateFilters.status) {
                    Object.assign(test, updates)
                  }
                }
                return Promise.resolve({ error: null })
              }

              return updateChain
            }),
          }
          return updateChain
        }),
      }
      return builder
    }

    if (table === 'test_questions') {
      return {
        select: vi.fn((_columns: string) => {
          let testId: string | null = null
          const chain: any = {
            eq: vi.fn((column: string, value: string) => {
              if (column === 'test_id') {
                testId = value
                return chain
              }
              if (column === 'question_type') {
                return Promise.resolve({
                  data: state.testQuestions
                    .filter((q) => (testId ? q.test_id === testId : true))
                    .filter((q) => q.question_type === value)
                    .map((q) => ({ id: q.id })),
                  error: null,
                })
              }
              return chain
            }),
            order: vi.fn(async () => ({
              data: state.testQuestions
                .filter((q) => (testId ? q.test_id === testId : true))
                .sort((a, b) => a.position - b.position),
              error: null,
            })),
          }
          return chain
        }),
      }
    }

    if (table === 'test_responses') {
      return {
        select: vi.fn((_columns: string) => {
          let eqFilters: Record<string, string> = {}
          const chain: any = {
            eq: vi.fn((column: string, value: string) => {
              eqFilters[column] = value
              return chain
            }),
            in: vi.fn(async (column: string, values: string[]) => ({
              data: state.testResponses.filter((row) => {
                const eqMatch = Object.entries(eqFilters).every(([key, val]) => String((row as any)[key]) === val)
                return eqMatch && values.includes(String((row as any)[column]))
              }),
              error: null,
            })),
            limit: vi.fn(async (count: number) => ({
              data: state.testResponses
                .filter((row) =>
                  Object.entries(eqFilters).every(([key, val]) => String((row as any)[key]) === val)
                )
                .slice(0, count),
              error: null,
            })),
            then: vi.fn((resolve: any) =>
              resolve({
                data: state.testResponses.filter((row) =>
                  Object.entries(eqFilters).every(([key, val]) => String((row as any)[key]) === val)
                ),
                error: null,
              })
            ),
          }
          return chain
        }),
      }
    }

    if (table === 'test_attempts') {
      return {
        select: vi.fn((_columns: string) => {
          let eqFilters: Record<string, string> = {}
          const chain: any = {
            eq: vi.fn((column: string, value: string) => {
              eqFilters[column] = value
              return chain
            }),
            in: vi.fn(async (column: string, values: string[]) => ({
              data: state.testAttempts.filter((row) => {
                const eqMatch = Object.entries(eqFilters).every(([key, val]) => String((row as any)[key]) === val)
                return eqMatch && values.includes(String((row as any)[column]))
              }),
              error: null,
            })),
            maybeSingle: vi.fn(async () => {
              const found = state.testAttempts.find((row) =>
                Object.entries(eqFilters).every(([key, val]) => String((row as any)[key]) === val)
              )
              return { data: found || null, error: null }
            }),
          }
          return chain
        }),
        update: vi.fn((updates: Record<string, unknown>) => ({
          eq: vi.fn((column: string, value: string) => ({
            in: vi.fn(async (inColumn: string, values: string[]) => {
              for (const attempt of state.testAttempts) {
                if (
                  String((attempt as any)[column]) === value &&
                  values.includes(String((attempt as any)[inColumn]))
                ) {
                  Object.assign(attempt, updates)
                }
              }
              return { error: null }
            }),
          })),
        })),
        insert: vi.fn(async (rows: Array<Record<string, unknown>>) => {
          state.testAttempts.push(...(rows as any))
          return { error: null }
        }),
      }
    }

    if (table === 'test_focus_events') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          order: vi.fn(async () => ({ data: [], error: null })),
        })),
      }
    }

    if (table === 'test_student_availability') {
      return {
        select: vi.fn(() => {
          const eqFilters: Record<string, string> = {}
          const chain: any = {
            eq: vi.fn((column: string, value: string) => {
              eqFilters[column] = value
              return chain
            }),
            in: vi.fn(async (column: string, values: string[]) => ({
              data: state.testStudentAvailability.filter((row) => {
                const eqMatch = Object.entries(eqFilters).every(
                  ([key, val]) => String((row as any)[key]) === val
                )
                return eqMatch && values.includes(String((row as any)[column]))
              }),
              error: null,
            })),
            maybeSingle: vi.fn(async () => {
              const found = state.testStudentAvailability.find((row) =>
                Object.entries(eqFilters).every(([key, val]) => String((row as any)[key]) === val)
              )
              return { data: found || null, error: null }
            }),
          }
          return chain
        }),
      }
    }

    throw new Error(`Unexpected table: ${table}`)
  })
}

describe('Test Return Visibility Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentUser = { id: 'student-1', role: 'student' }
    state.tests[0].status = 'closed'
    state.testAttempts[0].returned_at = null
    state.testAttempts[0].returned_by = null
    state.testStudentAvailability = []
    setupSupabaseMock()
  })

  it('reveals student test results only after teacher returns test work', async () => {
    const listBefore = await getStudentTests(
      new NextRequest('http://localhost:3000/api/student/tests?classroom_id=classroom-1')
    )
    const listBeforeData = await listBefore.json()
    expect(listBefore.status).toBe(200)
    expect(listBeforeData.quizzes[0].student_status).toBe('responded')

    const detailBefore = await getStudentTestDetail(
      new NextRequest('http://localhost:3000/api/student/tests/test-1'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const detailBeforeData = await detailBefore.json()
    expect(detailBefore.status).toBe(200)
    expect(detailBeforeData.student_status).toBe('responded')

    const resultsBefore = await getStudentTestResults(
      new NextRequest('http://localhost:3000/api/student/tests/test-1/results'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const resultsBeforeData = await resultsBefore.json()
    expect(resultsBefore.status).toBe(403)
    expect(resultsBeforeData.error).toContain('after your teacher returns this test')

    currentUser = { id: 'teacher-1', role: 'teacher' }
    const returnResponse = await returnTeacherTest(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/return', {
        method: 'POST',
        body: JSON.stringify({ student_ids: ['student-1'] }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const returnData = await returnResponse.json()
    expect(returnResponse.status).toBe(200)
    expect(returnData.returned_count).toBe(1)
    expect(state.testAttempts[0].returned_at).not.toBeNull()

    currentUser = { id: 'student-1', role: 'student' }
    const listAfter = await getStudentTests(
      new NextRequest('http://localhost:3000/api/student/tests?classroom_id=classroom-1')
    )
    const listAfterData = await listAfter.json()
    expect(listAfter.status).toBe(200)
    expect(listAfterData.quizzes[0].student_status).toBe('can_view_results')

    const detailAfter = await getStudentTestDetail(
      new NextRequest('http://localhost:3000/api/student/tests/test-1'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const detailAfterData = await detailAfter.json()
    expect(detailAfter.status).toBe(200)
    expect(detailAfterData.student_status).toBe('can_view_results')
    expect(detailAfterData.quiz.returned_at).not.toBeNull()

    const resultsAfter = await getStudentTestResults(
      new NextRequest('http://localhost:3000/api/student/tests/test-1/results'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const resultsAfterData = await resultsAfter.json()
    expect(resultsAfter.status).toBe(200)
    expect(resultsAfterData.quiz.returned_at).not.toBeNull()
    expect(resultsAfterData.summary.earned_points).toBe(4)
  })

  it('returns selected work during an active test after selected access is closed', async () => {
    state.tests[0].status = 'active'

    currentUser = { id: 'teacher-1', role: 'teacher' }
    const returnWithoutClose = await returnTeacherTest(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/return', {
        method: 'POST',
        body: JSON.stringify({ student_ids: ['student-1'] }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const returnWithoutCloseData = await returnWithoutClose.json()
    expect(returnWithoutClose.status).toBe(409)
    expect(returnWithoutCloseData.error).toContain('Close selected students')
    expect(state.tests[0].status).toBe('active')
    expect(state.testAttempts[0].returned_at).toBeNull()

    state.testStudentAvailability = [
      { test_id: 'test-1', student_id: 'student-1', state: 'closed' },
    ]

    const returnAfterSelectedClose = await returnTeacherTest(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/return', {
        method: 'POST',
        body: JSON.stringify({ student_ids: ['student-1'] }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const returnAfterSelectedCloseData = await returnAfterSelectedClose.json()
    expect(returnAfterSelectedClose.status).toBe(200)
    expect(returnAfterSelectedCloseData.test_closed).toBe(false)
    expect(state.tests[0].status).toBe('active')
    expect(state.testAttempts[0].returned_at).not.toBeNull()

    currentUser = { id: 'student-1', role: 'student' }
    const listAfter = await getStudentTests(
      new NextRequest('http://localhost:3000/api/student/tests?classroom_id=classroom-1')
    )
    const listAfterData = await listAfter.json()
    expect(listAfter.status).toBe(200)
    expect(listAfterData.quizzes[0].student_status).toBe('can_view_results')

    const detailAfter = await getStudentTestDetail(
      new NextRequest('http://localhost:3000/api/student/tests/test-1'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const detailAfterData = await detailAfter.json()
    expect(detailAfter.status).toBe(200)
    expect(detailAfterData.student_status).toBe('can_view_results')

    const resultsAfter = await getStudentTestResults(
      new NextRequest('http://localhost:3000/api/student/tests/test-1/results'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    expect(resultsAfter.status).toBe(200)
  })
})
