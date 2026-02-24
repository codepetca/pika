import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/student/tests/[id]/attempt/route'
import { mockAuthenticationError } from '../setup'

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({
    id: 'student-1',
    email: 'student1@example.com',
    role: 'student',
  })),
}))

vi.mock('@/lib/server/tests', () => ({
  assertStudentCanAccessTest: vi.fn(async () => ({
    ok: true,
    test: {
      id: 'test-1',
      classroom_id: 'classroom-1',
      status: 'active',
      title: 'Unit Test',
      show_results: false,
      position: 0,
      created_by: 'teacher-1',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      classrooms: {
        id: 'classroom-1',
        teacher_id: 'teacher-1',
        archived_at: null,
      },
    },
  })),
}))

const mockSupabaseClient = { from: vi.fn() }

function buildRequest(body: unknown) {
  return new NextRequest('http://localhost:3000/api/student/tests/test-1/attempt', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

function createQuestionsMock() {
  return {
    select: vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({
        data: [
          { id: 'q-1', options: ['A', 'B'] },
          { id: 'q-2', options: ['A', 'B'] },
        ],
        error: null,
      }),
    })),
  }
}

describe('PATCH /api/student/tests/[id]/attempt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError())

    const response = await PATCH(
      buildRequest({ responses: { 'q-1': 1 } }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('rejects draft save when test attempt is already submitted', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') return createQuestionsMock()
      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'attempt-1', responses: { 'q-1': 0 }, is_submitted: true },
              error: null,
            }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await PATCH(
      buildRequest({ responses: { 'q-1': 1 } }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toContain('submitted test')
  })

  it('creates a draft attempt and baseline history entry', async () => {
    const historyInsert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'history-1',
            test_attempt_id: 'attempt-1',
            trigger: 'baseline',
            created_at: '2026-02-24T00:00:00.000Z',
          },
          error: null,
        }),
      })),
    }))

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') return createQuestionsMock()
      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'attempt-1',
                  test_id: 'test-1',
                  student_id: 'student-1',
                  responses: { 'q-1': 1 },
                  is_submitted: false,
                },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'test_responses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }
      if (table === 'test_attempt_history') {
        return {
          insert: historyInsert,
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await PATCH(
      buildRequest({ responses: { 'q-1': 1 } }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.attempt.id).toBe('attempt-1')
    expect(data.historyEntry.id).toBe('history-1')
    expect(historyInsert).toHaveBeenCalled()
  })
})
