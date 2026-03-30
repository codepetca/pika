import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/student/tests/[id]/session-status/route'

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
  isMissingTestAttemptReturnColumnsError: vi.fn((error: { code?: string; message?: string } | null | undefined) => {
    if (!error) return false
    const message = (error.message || '').toLowerCase()
    return error.code === 'PGRST204' && message.includes('returned_at')
  }),
  assertStudentCanAccessTest: vi.fn(async () => ({
    ok: true,
    test: {
      id: 'test-1',
      classroom_id: 'classroom-1',
      title: 'Unit Test',
      status: 'active',
      show_results: false,
      position: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/student/tests/[id]/session-status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns can_continue for an active in-progress test', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { is_submitted: false, returned_at: null },
              error: null,
            }),
          })),
        }
      }

      if (table === 'test_responses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            then: vi.fn((resolve: any) => resolve({ data: [], error: null })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/tests/test-1/session-status'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.can_continue).toBe(true)
    expect(data.student_status).toBe('not_started')
    expect(data.message).toBeNull()
  })

  it('returns a closure message when the test has been closed and submitted', async () => {
    const serverTests = await import('@/lib/server/tests')
    vi.mocked(serverTests.assertStudentCanAccessTest).mockResolvedValueOnce({
      ok: true,
      test: {
        id: 'test-1',
        classroom_id: 'classroom-1',
        title: 'Unit Test',
        status: 'closed',
        show_results: false,
        position: 0,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    } as any)

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { is_submitted: true, returned_at: null },
              error: null,
            }),
          })),
        }
      }

      if (table === 'test_responses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            then: vi.fn((resolve: any) => resolve({ data: [], error: null })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/tests/test-1/session-status'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.can_continue).toBe(false)
    expect(data.student_status).toBe('responded')
    expect(data.message).toBe('Your current work has been submitted.')
  })

  it('returns 404 when a closed test has no submitted work to preserve student access rules', async () => {
    const serverTests = await import('@/lib/server/tests')
    vi.mocked(serverTests.assertStudentCanAccessTest).mockResolvedValueOnce({
      ok: true,
      test: {
        id: 'test-1',
        classroom_id: 'classroom-1',
        title: 'Unit Test',
        status: 'closed',
        show_results: false,
        position: 0,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    } as any)

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          })),
        }
      }

      if (table === 'test_responses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            then: vi.fn((resolve: any) =>
              resolve({
                data: [{ selected_option: null, response_text: '   ' }],
                error: null,
              })
            ),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/tests/test-1/session-status'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Test not found')
  })
})
