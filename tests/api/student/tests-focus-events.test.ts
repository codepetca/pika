import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/student/tests/[id]/focus-events/route'
import { mockAuthenticationError } from '../setup'

const serverTestsMocks = vi.hoisted(() => ({
  assertStudentCanAccessTest: vi.fn(),
  getTestStudentAvailabilityState: vi.fn(),
}))

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

vi.mock('@/lib/server/tests', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/tests')>('@/lib/server/tests')
  return {
    ...actual,
    assertStudentCanAccessTest: serverTestsMocks.assertStudentCanAccessTest,
    getTestStudentAvailabilityState: serverTestsMocks.getTestStudentAvailabilityState,
  }
})

const mockSupabaseClient = { from: vi.fn() }
const activeTest = {
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
}

function buildRequest(body: unknown) {
  return new NextRequest('http://localhost:3000/api/student/tests/test-1/focus-events', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/student/tests/[id]/focus-events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serverTestsMocks.assertStudentCanAccessTest.mockResolvedValue({
      ok: true,
      test: activeTest,
    })
    serverTestsMocks.getTestStudentAvailabilityState.mockResolvedValue({
      state: null,
      missingTable: false,
      error: null,
    })
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
    const tables: string[] = []
    ;(assertStudentCanAccessTest as any).mockResolvedValueOnce({
      ok: true,
      test: {
        id: 'test-1',
        classroom_id: 'classroom-1',
        status: 'closed',
        classrooms: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: null },
      },
    })
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      tables.push(table)
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
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(buildRequest({ event_type: 'away_start', session_id: 's1' }), {
      params: Promise.resolve({ id: 'test-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('only available while the test is active')
    expect(tables).toEqual(['test_attempts'])
  })

  it('logs event when selected-student access is open on a closed test', async () => {
    const { assertStudentCanAccessTest } = await import('@/lib/server/tests')
    ;(assertStudentCanAccessTest as any).mockResolvedValueOnce({
      ok: true,
      test: {
        ...activeTest,
        status: 'closed',
      },
    })
    serverTestsMocks.getTestStudentAvailabilityState.mockResolvedValueOnce({
      state: 'open',
      missingTable: false,
      error: null,
    })
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
            then: vi.fn((resolve: any) => resolve({ data: [], error: null })),
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

    const response = await POST(buildRequest({ event_type: 'away_start', session_id: 's1' }), {
      params: Promise.resolve({ id: 'test-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
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

  it('rejects logging when selected-student access is closed', async () => {
    const tables: string[] = []
    serverTestsMocks.getTestStudentAvailabilityState.mockResolvedValueOnce({
      state: 'closed',
      missingTable: false,
      error: null,
    })
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      tables.push(table)
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
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(buildRequest({ event_type: 'away_start', session_id: 's1' }), {
      params: Promise.resolve({ id: 'test-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toContain('open for you')
    expect(serverTestsMocks.getTestStudentAvailabilityState).toHaveBeenCalledWith(
      mockSupabaseClient,
      'test-1',
      'student-1'
    )
    expect(tables).toEqual(['test_attempts'])
  })

  it('returns 500 when selected-student access validation fails', async () => {
    const tables: string[] = []
    serverTestsMocks.getTestStudentAvailabilityState.mockResolvedValueOnce({
      state: null,
      missingTable: false,
      error: { message: 'availability lookup failed' },
    })
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      tables.push(table)
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
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(buildRequest({ event_type: 'away_start', session_id: 's1' }), {
      params: Promise.resolve({ id: 'test-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to save focus event')
    expect(tables).toEqual(['test_attempts'])
  })

  it('continues logging when the selected-student access table is missing', async () => {
    serverTestsMocks.getTestStudentAvailabilityState.mockResolvedValueOnce({
      state: null,
      missingTable: true,
      error: { code: 'PGRST205' },
    })
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
            then: vi.fn((resolve: any) => resolve({ data: [], error: null })),
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

    const response = await POST(buildRequest({ event_type: 'away_start', session_id: 's1' }), {
      params: Promise.resolve({ id: 'test-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
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
            then: vi.fn((resolve: any) => resolve({ data: [], error: null })),
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
    expect(data.focus_summary.exit_count).toBe(1)
    expect(data.focus_summary.away_count).toBe(1)
    expect(data.focus_summary.window_unmaximize_attempts).toBe(0)
  })

  it('accepts window unmaximize telemetry events', async () => {
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
            then: vi.fn((resolve: any) => resolve({ data: [], error: null })),
          })),
        }
      }
      if (table === 'test_focus_events') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [{ event_type: 'window_unmaximize_attempt', occurred_at: '2026-02-24T12:00:00.000Z' }],
              error: null,
            }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(
      buildRequest({
        event_type: 'window_unmaximize_attempt',
        session_id: 'session-1',
        metadata: { source: 'fullscreen_exit' },
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.focus_summary.exit_count).toBe(1)
    expect(data.focus_summary.window_unmaximize_attempts).toBe(1)
  })
})
