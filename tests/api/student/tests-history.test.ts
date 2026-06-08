import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/student/tests/[id]/history/route'
import * as serverTests from '@/lib/server/tests'

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => ({
    id: 'student-1',
    email: 'student1@example.com',
    role: 'student',
  })),
}))

vi.mock('@/lib/server/tests', async () => {
  const actual = await vi.importActual<any>('@/lib/server/tests')
  return {
    ...actual,
    assertStudentCanAccessTest: vi.fn(async () => ({
      ok: true,
      test: { id: 'test-1', classroom_id: 'classroom-1', status: 'active' },
    })),
    assertTeacherOwnsTest: vi.fn(async () => ({
      ok: true,
      test: { id: 'test-1', classroom_id: 'classroom-1', status: 'draft' },
    })),
    getTestStudentAvailabilityState: vi.fn(async () => ({
      state: null,
      missingTable: false,
      error: null,
    })),
  }
})

const mockSupabaseClient = { from: vi.fn() }

function mockMaybeSingle(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(() => ({
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(result),
    })),
  }
  return query
}

function mockThenableRows(result: { data: unknown; error: unknown }) {
  const chain = {
    eq: vi.fn(() => chain),
    then: vi.fn((resolve: (value: typeof result) => unknown) => resolve(result)),
  }
  return {
    select: vi.fn(() => chain),
  }
}

function mockHistoryRows(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue(result),
    })),
  }
}

function mockSingle(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue(result),
    })),
  }
}

describe('GET /api/student/tests/[id]/history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(serverTests.assertStudentCanAccessTest).mockResolvedValue({
      ok: true,
      test: { id: 'test-1', classroom_id: 'classroom-1', status: 'active' },
    } as any)
    vi.mocked(serverTests.assertTeacherOwnsTest).mockResolvedValue({
      ok: true,
      test: { id: 'test-1', classroom_id: 'classroom-1', status: 'draft' },
    } as any)
    vi.mocked(serverTests.getTestStudentAvailabilityState).mockResolvedValue({
      state: null,
      missingTable: false,
      error: null,
    })
  })

  it('returns empty history when no attempt exists', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_attempts') {
        return mockMaybeSingle({ data: null, error: null })
      }
      if (table === 'test_responses') {
        return mockThenableRows({ data: [], error: null })
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/tests/test-1/history'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.history).toEqual([])
    expect(data.attemptId).toBeNull()
  })

  it('hides draft tests from student history', async () => {
    vi.mocked(serverTests.assertStudentCanAccessTest).mockResolvedValueOnce({
      ok: true,
      test: { id: 'test-1', classroom_id: 'classroom-1', status: 'draft' },
    } as any)
    ;(mockSupabaseClient.from as any) = vi.fn()

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/tests/test-1/history'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Test not found')
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })

  it('hides active tests that are closed for this student before submission', async () => {
    vi.mocked(serverTests.getTestStudentAvailabilityState).mockResolvedValueOnce({
      state: 'closed',
      missingTable: false,
      error: null,
    })
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_attempts') {
        return mockMaybeSingle({
          data: {
            id: 'attempt-1',
            is_submitted: false,
            returned_at: null,
            closed_for_grading_at: null,
          },
          error: null,
        })
      }
      if (table === 'test_responses') {
        return mockThenableRows({ data: [], error: null })
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/tests/test-1/history'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Test not found')
  })

  it('returns history for a submitted closed test', async () => {
    vi.mocked(serverTests.assertStudentCanAccessTest).mockResolvedValueOnce({
      ok: true,
      test: { id: 'test-1', classroom_id: 'classroom-1', status: 'closed' },
    } as any)
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_attempts') {
        return mockMaybeSingle({
          data: {
            id: 'attempt-1',
            is_submitted: true,
            returned_at: null,
            closed_for_grading_at: null,
          },
          error: null,
        })
      }
      if (table === 'test_responses') {
        return mockThenableRows({ data: [], error: null })
      }
      if (table === 'test_attempt_history') {
        return mockHistoryRows({
          data: [{ id: 'history-1', test_attempt_id: 'attempt-1', patch: [], snapshot: {} }],
          error: null,
        })
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/tests/test-1/history'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.attemptId).toBe('attempt-1')
    expect(data.history).toHaveLength(1)
  })

  it('requires student_id for teacher requests', async () => {
    const { requireAuth } = await import('@/lib/auth')
    ;(requireAuth as any).mockResolvedValueOnce({
      id: 'teacher-1',
      email: 'teacher@example.com',
      role: 'teacher',
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/tests/test-1/history'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('student_id is required')
  })

  it('keeps teacher-owned history access independent from student availability state', async () => {
    const { requireAuth } = await import('@/lib/auth')
    ;(requireAuth as any).mockResolvedValueOnce({
      id: 'teacher-1',
      email: 'teacher@example.com',
      role: 'teacher',
    })
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classroom_enrollments') {
        return mockSingle({ data: { id: 'enrollment-1' }, error: null })
      }
      if (table === 'test_attempts') {
        return mockMaybeSingle({
          data: {
            id: 'attempt-1',
            is_submitted: false,
            returned_at: null,
            closed_for_grading_at: null,
          },
          error: null,
        })
      }
      if (table === 'test_attempt_history') {
        return mockHistoryRows({
          data: [{ id: 'history-1', test_attempt_id: 'attempt-1', patch: [], snapshot: {} }],
          error: null,
        })
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/tests/test-1/history?student_id=student-1'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.attemptId).toBe('attempt-1')
    expect(serverTests.getTestStudentAvailabilityState).not.toHaveBeenCalled()
  })
})
