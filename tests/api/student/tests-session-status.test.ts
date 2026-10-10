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

vi.mock('@/lib/server/tests', async () => {
  const actual = await vi.importActual<any>('@/lib/server/tests')
  return {
    ...actual,
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
  }
})

const mockSupabaseClient = { from: vi.fn(), rpc: vi.fn() }

describe('GET /api/student/tests/[id]/session-status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.get_student_test_session_status_projection' } })
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

  it('returns the results-available closure message when the test has been returned', async () => {
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
              data: { is_submitted: true, returned_at: '2026-01-02T00:00:00.000Z' },
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
    expect(data.student_status).toBe('can_view_results')
    expect(data.message).toBe('Your current work has been submitted. Results are now available from the tests list.')
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

  it('returns a draft-preserved message when selected-student access is closed mid-test', async () => {
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

      if (table === 'test_student_availability') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [{ student_id: 'student-1', state: 'closed' }],
              error: null,
            }),
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
    expect(data).not.toHaveProperty('quiz')
    expect(data.can_continue).toBe(false)
    expect(data.effective_access ?? data.test.effective_access).toBe('closed')
    expect(data.message).toContain('saved draft is preserved')
  })
})


describe('session-status database projection', () => {
  const projection = {
    ok: true, test: { id: 'test-1', status: 'active' },
    is_submitted: false, returned_at: null, closed_for_grading_at: null,
    has_meaningful_response: false, access_state: null,
  }
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.rpc.mockResolvedValue({ data: projection, error: null })
    mockSupabaseClient.from = vi.fn(() => { throw new Error('Projection must not fan out') })
  })
  const request = () => GET(new NextRequest('http://localhost/api/student/tests/test-1/session-status'), { params: Promise.resolve({ id: 'test-1' }) })
  it('uses one scoped domain RPC and returns the unchanged compact payload', async () => {
    const response = await request()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      test: { id: 'test-1', status: 'active', assessment_type: 'test', student_status: 'not_started', returned_at: null, access_state: null, effective_access: 'open' },
      student_status: 'not_started', returned_at: null, can_continue: true, message: null,
    })
    expect(mockSupabaseClient.rpc).toHaveBeenCalledExactlyOnceWith('get_student_test_session_status_projection', { p_student_id: 'student-1', p_test_id: 'test-1' })
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
    const serverTests = await import('@/lib/server/tests')
    expect(serverTests.assertStudentCanAccessTest).not.toHaveBeenCalled()
  })
  it.each([
    ['active', false, null, null, null, false, 200, 'not_started', true],
    ['closed', false, null, null, null, false, 404, null, null],
    ['draft', true, null, null, 'open', true, 404, null, null],
    ['closed', false, null, null, 'open', false, 200, 'not_started', true],
    ['active', false, null, null, 'closed', false, 200, 'not_started', false],
    ['closed', false, null, null, null, true, 200, 'responded', false],
    ['active', false, null, '2026-01-02T00:00:00Z', null, true, 200, 'responded', false],
    ['closed', false, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', null, false, 200, 'can_view_results', false],
    ['active', true, '2026-01-02T00:00:00Z', null, null, false, 200, 'responded', false],
  ])('preserves access/status for %s submitted=%s returned=%s locked=%s override=%s meaningful=%s', async (status, submitted, returned, locked, access, meaningful, http, studentStatus, canContinue) => {
    mockSupabaseClient.rpc.mockResolvedValue({ data: { ...projection, test: { id: 'test-1', status }, is_submitted: submitted, returned_at: returned, closed_for_grading_at: locked, access_state: access, has_meaningful_response: meaningful }, error: null })
    const response = await request()
    const body = await response.json()
    expect(response.status).toBe(http)
    if (http === 200) { expect(body.student_status).toBe(studentStatus); expect(body.can_continue).toBe(canContinue) }
  })
  it.each([[404, 'Test not found'], [403, 'Classroom is archived'], [403, 'Not enrolled in this classroom']])('preserves access denial %s %s', async (status, error) => {
    mockSupabaseClient.rpc.mockResolvedValue({ data: { ok: false, status, error }, error: null })
    const response = await request()
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error })
  })
  it.each([{ code: '42501', message: 'permission denied' }, { code: 'XX000', message: 'internal error' }, { code: 'PGRST202', message: 'Could not find another function' }, { code: 'PGRST202', message: 'Could not find the function public.get_student_test_session_status_projection_other' }])('fails closed for unexpected RPC error %o', async error => {
    mockSupabaseClient.rpc.mockResolvedValue({ data: null, error })
    expect((await request()).status).toBe(500)
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })
  it('fails closed on malformed projection', async () => {
    mockSupabaseClient.rpc.mockResolvedValue({ data: { ...projection, has_meaningful_response: 'yes' }, error: null })
    expect((await request()).status).toBe(500)
  })
  it('rejects a widened projection that accidentally contains answer text', async () => {
    mockSupabaseClient.rpc.mockResolvedValue({ data: { ...projection, response_text: 'private answer' }, error: null })
    expect((await request()).status).toBe(500)
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })
  it('rejects the wrong role before invoking the projection', async () => {
    const { requireRole } = await import('@/lib/auth')
    const { ApiError } = await import('@/lib/api-handler')
    vi.mocked(requireRole).mockRejectedValueOnce(new ApiError(403, 'Forbidden'))
    expect((await request()).status).toBe(403)
    expect(mockSupabaseClient.rpc).not.toHaveBeenCalled()
  })
  it('authenticates every poll before invoking the projection, including revoked sessions', async () => {
    const { requireRole } = await import('@/lib/auth')
    const { ApiError } = await import('@/lib/api-handler')
    vi.mocked(requireRole).mockRejectedValueOnce(new ApiError(401, 'Unauthorized'))
    expect((await request()).status).toBe(401)
    expect(mockSupabaseClient.rpc).not.toHaveBeenCalled()
    await request()
    expect(requireRole).toHaveBeenCalledTimes(2)
  })
})


describe('session-status rollout fallback', () => {
  it('preserves the legacy attempt-column fallback and does not broaden the response payload', async () => {
    mockSupabaseClient.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.get_student_test_session_status_projection(p_student_id, p_test_id) in the schema cache' } })
    const attemptRead = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST204', message: 'missing returned_at column' } })
      .mockResolvedValueOnce({ data: { is_submitted: true }, error: null })
    mockSupabaseClient.from = vi.fn((table: string) => {
      if (table === 'test_attempts') return { select: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), maybeSingle: attemptRead })) }
      if (table === 'test_responses') return { select: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), then: vi.fn((resolve: (value: unknown) => unknown) => resolve({ data: [{ selected_option: null, response_text: 'synthetic-answer-'.repeat(1000) }], error: null })) })) }
      if (table === 'test_student_availability') return { select: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: [], error: null }) })) }
      throw new Error(`Unexpected table: ${table}`)
    })
    const response = await GET(new NextRequest('http://localhost/api/student/tests/test-1/session-status'), { params: Promise.resolve({ id: 'test-1' }) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.student_status).toBe('responded')
    expect(body.returned_at).toBeNull()
    expect(body.can_continue).toBe(false)
    expect(JSON.stringify(body)).not.toContain('synthetic-answer-')
    expect(attemptRead).toHaveBeenCalledTimes(2)
  })
})


describe('legacy and installed projection payload parity', () => {
  it('matches the legacy route payload for all 144 access/submission/return/lock/response combinations', async () => {
    const serverTests = await import('@/lib/server/tests')
    let comparisons = 0
    for (const status of ['draft', 'active', 'closed'] as const)
    for (const access_state of [null, 'open', 'closed'] as const)
    for (const is_submitted of [false, true])
    for (const returned of [false, true])
    for (const locked of [false, true])
    for (const meaningful of [false, true]) {
      const attempt = { is_submitted, returned_at: returned ? '2026-01-02T00:00:00Z' : null, closed_for_grading_at: locked ? '2026-01-02T00:00:00Z' : null }
      const test = { id: 'test-1', status }
      vi.mocked(serverTests.assertStudentCanAccessTest).mockResolvedValueOnce({ ok: true, test } as never)
      mockSupabaseClient.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.get_student_test_session_status_projection' } })
      mockSupabaseClient.from = vi.fn((table: string) => {
        if (table === 'test_attempts') return { select: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: attempt, error: null }) })) }
        if (table === 'test_responses') return { select: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), then: vi.fn((resolve: (value: unknown) => unknown) => resolve({ data: [{ selected_option: null, response_text: meaningful ? 'answer' : '   ' }], error: null })) })) }
        if (table === 'test_student_availability') return { select: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: access_state ? [{ student_id: 'student-1', state: access_state }] : [], error: null }) })) }
        throw new Error(`Unexpected table: ${table}`)
      })
      const request = () => GET(new NextRequest('http://localhost/api/student/tests/test-1/session-status'), { params: Promise.resolve({ id: 'test-1' }) })
      const legacy = await request()
      mockSupabaseClient.rpc.mockResolvedValueOnce({ data: { ok: true, test, ...attempt, access_state, has_meaningful_response: meaningful }, error: null })
      const current = await request()
      expect(current.status).toBe(legacy.status)
      expect(await current.json()).toEqual(await legacy.json())
      comparisons++
    }
    expect(comparisons).toBe(144)
  })
})
