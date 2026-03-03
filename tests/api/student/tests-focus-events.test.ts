import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/student/tests/[id]/focus-events/route'
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
  return new NextRequest('http://localhost:3000/api/student/tests/test-1/focus-events', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/student/tests/[id]/focus-events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError())

    const response = await POST(buildRequest({ event_type: 'away_start', session_id: 's1' }), {
      params: Promise.resolve({ id: 'test-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('rejects logging when test is not active', async () => {
    const { assertStudentCanAccessTest } = await import('@/lib/server/tests')
    ;(assertStudentCanAccessTest as any).mockResolvedValueOnce({
      ok: true,
      test: {
        id: 'test-1',
        classroom_id: 'classroom-1',
        status: 'closed',
        classrooms: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: null },
      },
    })

    const response = await POST(buildRequest({ event_type: 'away_start', session_id: 's1' }), {
      params: Promise.resolve({ id: 'test-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('only available while the test is active')
  })

  it('rejects logging after the student has already submitted', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'attempt-1', is_submitted: true },
              error: null,
            }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(buildRequest({ event_type: 'away_start', session_id: 's1' }), {
      params: Promise.resolve({ id: 'test-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('before submitting')
  })

  it('logs event successfully for active, unanswered test', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'attempt-1', is_submitted: false },
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
      if (table === 'test_focus_events') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [{ event_type: 'away_start', occurred_at: '2026-02-24T12:00:00.000Z' }],
              error: null,
            }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(
      buildRequest({
        event_type: 'away_start',
        session_id: 'session-1',
        metadata: { source: 'visibility' },
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.focus_summary.away_count).toBe(1)
  })
})
