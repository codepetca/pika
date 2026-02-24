import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/student/tests/[id]/respond/route'

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
  return new NextRequest('http://localhost:3000/api/student/tests/test-1/respond', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/student/tests/[id]/respond', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects submit when student already has a submitted attempt', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'attempt-1', is_submitted: true, responses: { 'q-1': 1 } },
              error: null,
            }),
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
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [{ id: 'q-1', options: ['A', 'B'] }],
              error: null,
            }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(
      buildRequest({ responses: { 'q-1': 1 } }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('already responded')
  })

  it('submits responses and updates an existing test attempt', async () => {
    const responsesInsert = vi.fn().mockResolvedValue({ error: null })
    const attemptsUpdate = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }))
    const historyInsert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: 'history-1', trigger: 'submit' },
          error: null,
        }),
      })),
    }))

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'attempt-1', is_submitted: false, responses: { 'q-1': 0 } },
              error: null,
            }),
          })),
          update: attemptsUpdate,
        }
      }
      if (table === 'test_responses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
          insert: responsesInsert,
        }
      }
      if (table === 'test_questions') {
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
      if (table === 'test_attempt_history') {
        return {
          insert: historyInsert,
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(
      buildRequest({ responses: { 'q-1': 1, 'q-2': 0 } }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.success).toBe(true)
    expect(responsesInsert).toHaveBeenCalledOnce()
    expect(attemptsUpdate).toHaveBeenCalledOnce()
    expect(historyInsert).toHaveBeenCalledOnce()
  })
})
