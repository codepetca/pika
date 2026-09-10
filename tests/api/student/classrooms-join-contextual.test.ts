import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { POST } from '@/app/api/student/classrooms/join/route'

const actorId = '11111111-1111-4111-8111-111111111111'
const ownerId = '22222222-2222-4222-8222-222222222222'
const classroomId = '33333333-3333-4333-8333-333333333333'
const enrollmentId = '44444444-4444-4444-8444-444444444444'

const { mockSupabaseClient, mockAttemptImmediatePalEventDelivery } = vi.hoisted(() => ({
  mockSupabaseClient: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
  mockAttemptImmediatePalEventDelivery: vi.fn(async () => 'delivered'),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>()
  return {
    ...actual,
    requireRole: vi.fn(),
    requireAuth: vi.fn(),
  }
})

vi.mock('@/lib/server/pal-outbox', () => ({
  attemptImmediatePalEventDelivery: mockAttemptImmediatePalEventDelivery,
}))

function request(body: unknown) {
  return new NextRequest('http://localhost:3000/api/student/classrooms/join', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function configurePilot(pairs = [{ userId: actorId, classroomId }]) {
  vi.stubEnv('PIKA_CLASSROOM_ENROLLMENT_ACCESS_ENABLED', 'true')
  vi.stubEnv('PIKA_CLASSROOM_ENROLLMENT_ACCESS_PAIRS', JSON.stringify(pairs))
  vi.stubEnv('SESSION_SECRET', 'session-secret-that-is-at-least-32-characters')
}

function contextualClassroom(overrides: Record<string, unknown> = {}) {
  return {
    id: classroomId,
    title: 'Biology',
    term_label: 'Fall 2026',
    teacher_id: ownerId,
    allow_enrollment: true,
    join_policy: 'roster',
    archived_at: null,
    ...overrides,
  }
}

function installContextualQueries(args: {
  classroom: ReturnType<typeof contextualClassroom> | null
  enrollment?: { id: string; created_at: string } | null
  roster?: { id: string } | null
}) {
  const classroomSingle = vi.fn().mockResolvedValue({
    data: args.classroom,
    error: args.classroom ? null : { code: 'PGRST116' },
  })
  const classroomEq = vi.fn(() => ({ single: classroomSingle }))
  const classroomIlike = vi.fn(() => ({ single: classroomSingle }))
  const classroomIn = vi.fn(() => ({ eq: classroomEq, ilike: classroomIlike }))

  mockSupabaseClient.from.mockImplementation((table: string) => {
    if (table === 'classrooms') {
      return { select: vi.fn(() => ({ in: classroomIn })) }
    }
    if (table === 'classroom_enrollments') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: args.enrollment ?? null,
            error: args.enrollment ? null : { code: 'PGRST116' },
          }),
        })),
      }
    }
    if (table === 'classroom_roster') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: args.roster ?? null,
            error: args.roster ? null : { code: 'PGRST116' },
          }),
        })),
      }
    }
    throw new Error(`Unexpected table: ${table}`)
  })

  return { classroomEq, classroomIlike, classroomIn }
}

describe('POST /api/student/classrooms/join contextual pilot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configurePilot()
    vi.mocked(requireAuth).mockResolvedValue({
      id: actorId,
      email: 'teacher@example.com',
      role: 'teacher',
    })
    mockSupabaseClient.rpc.mockResolvedValue({ data: { ok: true }, error: null })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects a wrong-role noncohort user before reading the body or querying a classroom', async () => {
    configurePilot([])
    const malformedRequest = new NextRequest(
      'http://localhost:3000/api/student/classrooms/join',
      { method: 'POST', body: '{' },
    )

    const response = await POST(malformedRequest)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Forbidden')
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })

  it('joins an exact pilot classroom through the atomic service path', async () => {
    vi.stubEnv('PAL_ENABLED', 'true')
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-that-is-at-least-32-characters')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-that-is-at-least-32-characters')
    const { classroomIlike, classroomIn } = installContextualQueries({
      classroom: contextualClassroom(),
      roster: { id: '55555555-5555-4555-8555-555555555555' },
    })
    mockSupabaseClient.rpc.mockResolvedValue({
      data: {
        ok: true,
        status: 201,
        created: true,
        already_enrolled: false,
        classroom: { id: classroomId, title: 'Biology', term_label: 'Fall 2026' },
        enrollment: {
          id: enrollmentId,
          created_at: '2026-09-10T12:00:00.000Z',
        },
      },
      error: null,
    })

    const response = await POST(request({ classCode: ' bio-101 ' }))
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data).toMatchObject({
      success: true,
      classroom: { id: classroomId, title: 'Biology', term_label: 'Fall 2026' },
      enrollment: { id: enrollmentId },
      pal_delivery: 'delivered',
    })
    expect(data.classroom).not.toHaveProperty('class_code')
    expect(data.classroom).not.toHaveProperty('teacher_id')
    expect(classroomIn).toHaveBeenCalledWith('id', [classroomId])
    expect(classroomIlike).toHaveBeenCalledWith('class_code', 'BIO-101')
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'join_classroom_by_code_atomic_v1',
      expect.objectContaining({
        p_actor_id: actorId,
        p_expected_classroom_id: classroomId,
        p_class_code: 'BIO-101',
        p_pal_event: expect.objectContaining({ event_type: 'classroom.joined' }),
      }),
    )
    expect(mockAttemptImmediatePalEventDelivery).toHaveBeenCalledTimes(1)
  })

  it('makes an out-of-scope or invalid code look like the same missing classroom', async () => {
    const { classroomIn } = installContextualQueries({ classroom: null })

    const response = await POST(request({ classCode: 'OUTSIDE' }))
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Classroom not found' })
    expect(classroomIn).toHaveBeenCalledWith('id', [classroomId])
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'consume_classroom_join_guess_v1',
      {
        p_actor_key_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        p_invitation_key_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    )
  })

  it('rate-limits repeated out-of-scope or invalid code guesses', async () => {
    installContextualQueries({ classroom: null })
    mockSupabaseClient.rpc.mockResolvedValue({
      data: {
        ok: false,
        status: 429,
        error_code: 'rate_limited',
        retry_after_seconds: 30,
      },
      error: null,
    })

    const response = await POST(request({ classCode: 'OUTSIDE' }))
    const data = await response.json()

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('30')
    expect(data.code).toBe('rate_limited')
  })

  it('does not create membership from a direct classroom ID', async () => {
    installContextualQueries({ classroom: contextualClassroom() })

    const response = await POST(request({ classroomId }))
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.code).toBe('code_required')
    expect(mockSupabaseClient.rpc).not.toHaveBeenCalled()
  })

  it('allows a direct classroom ID to recognize an existing membership', async () => {
    installContextualQueries({
      classroom: contextualClassroom(),
      enrollment: {
        id: enrollmentId,
        created_at: '2026-09-10T12:00:00.000Z',
      },
    })

    const response = await POST(request({ classroomId }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      success: true,
      classroom: { id: classroomId, title: 'Biology', term_label: 'Fall 2026' },
      alreadyEnrolled: true,
    })
    expect(mockSupabaseClient.rpc).not.toHaveBeenCalled()
  })

  it('keeps code-based retries idempotent without republishing a Pal fact', async () => {
    vi.stubEnv('PAL_ENABLED', 'true')
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-that-is-at-least-32-characters')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-that-is-at-least-32-characters')
    installContextualQueries({
      classroom: contextualClassroom(),
      enrollment: {
        id: enrollmentId,
        created_at: '2026-09-10T12:00:00.000Z',
      },
    })
    mockSupabaseClient.rpc.mockResolvedValue({
      data: {
        ok: true,
        status: 200,
        created: false,
        already_enrolled: true,
        classroom: { id: classroomId, title: 'Biology', term_label: 'Fall 2026' },
        enrollment: {
          id: enrollmentId,
          created_at: '2026-09-10T12:00:00.000Z',
        },
      },
      error: null,
    })

    const response = await POST(request({ classCode: 'BIO-101' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.alreadyEnrolled).toBe(true)
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'join_classroom_by_code_atomic_v1',
      expect.any(Object),
    )
    expect(mockAttemptImmediatePalEventDelivery).not.toHaveBeenCalled()
  })

  it('preserves the atomic rate-limit response and Retry-After header', async () => {
    installContextualQueries({
      classroom: contextualClassroom(),
      roster: { id: '55555555-5555-4555-8555-555555555555' },
    })
    mockSupabaseClient.rpc.mockResolvedValue({
      data: {
        ok: false,
        status: 429,
        error_code: 'rate_limited',
        retry_after_seconds: 45,
      },
      error: null,
    })

    const response = await POST(request({ classCode: 'BIO-101' }))
    const data = await response.json()

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('45')
    expect(data).toEqual({
      error: 'Too many attempts. Try again later.',
      code: 'rate_limited',
      retryAfterSeconds: 45,
    })
  })
})
