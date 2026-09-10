import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { mockAuthenticationError } from '../setup'

const classroomId = '33333333-3333-4333-8333-333333333333'
const studentId = '11111111-1111-4111-8111-111111111111'
const enrollmentId = '44444444-4444-4444-8444-444444444444'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: mocks.requireRole,
  requireAuth: vi.fn(),
  AuthorizationError: class AuthorizationError extends Error {},
}))
vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}))
vi.mock('@/lib/server/pal-outbox', () => ({
  attemptImmediatePalEventDelivery: vi.fn(async () => 'delivered'),
}))

import { POST } from '@/app/api/student/classrooms/join/route'

function request(body: unknown) {
  return new NextRequest('http://localhost:3000/api/student/classrooms/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function installClassroomLookup() {
  const limit = vi.fn().mockResolvedValue({ data: [{ id: classroomId }], error: null })
  const ilike = vi.fn(() => ({ limit }))
  mocks.from.mockImplementation((table: string) => {
    if (table !== 'classrooms') throw new Error(`Unexpected table: ${table}`)
    return {
      select: vi.fn(() => ({
        ilike,
      })),
    }
  })
  return { ilike, limit }
}

function installMissingClassroomLookup(error: { code: string } | null = { code: 'PGRST116' }) {
  const limit = vi.fn().mockResolvedValue({ data: [], error: error?.code === 'PGRST116' ? null : error })
  mocks.from.mockImplementation((table: string) => {
    if (table !== 'classrooms') throw new Error(`Unexpected table: ${table}`)
    return {
      select: vi.fn(() => ({
        ilike: vi.fn(() => ({ limit })),
      })),
    }
  })
}

function installExistingDirectIdLookup() {
  function query(data: unknown, error: unknown = null) {
    const builder: any = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      single: vi.fn().mockResolvedValue({ data, error }),
    }
    return builder
  }
  mocks.from.mockImplementation((table: string) => {
    if (table === 'classrooms') {
      return query({
        id: classroomId,
        title: 'Biology',
        class_code: 'BIO101',
        term_label: 'Fall 2026',
        allow_enrollment: true,
        join_policy: 'roster',
        archived_at: null,
      })
    }
    if (table === 'classroom_enrollments') return query({ id: enrollmentId })
    if (table === 'classroom_roster') return query(null, { code: 'PGRST116' })
    throw new Error(`Unexpected table: ${table}`)
  })
}

function rpcSuccess(alreadyEnrolled = false) {
  return {
    ok: true,
    status: alreadyEnrolled ? 200 : 201,
    created: !alreadyEnrolled,
    already_enrolled: alreadyEnrolled,
    classroom: { id: classroomId, title: 'Biology', term_label: 'Fall 2026' },
    enrollment: {
      id: enrollmentId,
      created_at: '2026-09-10T12:00:00.000Z',
    },
  }
}

describe('POST /api/student/classrooms/join roster-matched link', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SESSION_SECRET', 'session-secret-that-is-at-least-32-characters')
    mocks.requireRole.mockResolvedValue({
      id: studentId,
      email: 'student@example.com',
      role: 'student',
      authSource: 'password',
    })
    installClassroomLookup()
    mocks.rpc.mockResolvedValue({ data: rpcSuccess(), error: null })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('authenticates before reading the join request', async () => {
    mocks.requireRole.mockRejectedValueOnce(mockAuthenticationError())
    const response = await POST(request({ classCode: 'BIO101' }))
    expect(response.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rejects a request without a code or classroom identifier', async () => {
    const response = await POST(request({}))
    expect(response.status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('joins through the existing atomic roster-matched contract without attendance writes', async () => {
    const lookup = installClassroomLookup()
    const response = await POST(request({
      classCode: ' bio_101% ',
      firstName: 'Ignored',
      lastName: 'Profile',
    }))
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      success: true,
      classroom: { id: classroomId, title: 'Biology' },
      enrollment: { id: enrollmentId },
    })
    expect(mocks.rpc).toHaveBeenCalledWith(
      'join_classroom_by_code_atomic_v1',
      expect.objectContaining({
        p_actor_id: studentId,
        p_expected_classroom_id: classroomId,
        p_class_code: 'BIO_101%',
        p_first_name: undefined,
        p_last_name: undefined,
        p_student_number: undefined,
      }),
    )
    expect(lookup.ilike).toHaveBeenCalledWith('class_code', 'BIO\\_101\\%')
    expect(lookup.limit).toHaveBeenCalledWith(2)
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(['classrooms'])
  })

  it('resolves a legacy space-padded stored code with one bounded fallback lookup', async () => {
    const limit = vi.fn()
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [{ id: classroomId }], error: null })
    const ilike = vi.fn(() => ({ limit }))
    mocks.from.mockReturnValue({ select: vi.fn(() => ({ ilike })) })

    const response = await POST(request({ classCode: ' bio101 ' }))

    expect(response.status).toBe(201)
    expect(ilike).toHaveBeenNthCalledWith(1, 'class_code', 'BIO101')
    expect(ilike).toHaveBeenNthCalledWith(2, 'class_code', ' bio101 ')
    expect(limit).toHaveBeenNthCalledWith(1, 2)
    expect(limit).toHaveBeenNthCalledWith(2, 2)
    expect(mocks.rpc).toHaveBeenCalledWith(
      'join_classroom_by_code_atomic_v1',
      expect.objectContaining({ p_class_code: 'BIO101' }),
    )
  })

  it('returns an explicit already-enrolled result', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: rpcSuccess(true), error: null })
    const response = await POST(request({ classCode: 'BIO101' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      alreadyEnrolled: true,
    })
  })

  it('preserves an already-issued direct-ID link even when the request also contains a classCode', async () => {
    installExistingDirectIdLookup()

    const response = await POST(request({ classCode: classroomId, classroomId }))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, alreadyEnrolled: true })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('charges a rejected invitation guess before returning not found', async () => {
    installMissingClassroomLookup()
    mocks.rpc.mockResolvedValueOnce({ data: { ok: true }, error: null })

    const response = await POST(request({ classCode: 'UNKNOWN' }))

    expect(response.status).toBe(404)
    expect(mocks.rpc).toHaveBeenCalledWith(
      'consume_classroom_join_guess_v1',
      expect.objectContaining({
        p_actor_key_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        p_invitation_key_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    )
  })

  it('fails unavailable when invitation resolution has a database error', async () => {
    installMissingClassroomLookup({ code: 'XX000' })

    const response = await POST(request({ classCode: 'BIO101' }))

    expect(response.status).toBe(500)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['not_on_roster', 403, 'not_on_roster'],
    ['profile_required', 400, 'not_on_roster'],
    ['roster_ambiguous', 409, 'roster_ambiguous'],
    ['roster_binding_conflict', 409, 'roster_binding_conflict'],
  ] as const)('projects %s without creating membership or attendance', async (errorCode, status, expectedCode) => {
    mocks.rpc.mockResolvedValueOnce({
      data: errorCode === 'profile_required'
        ? {
          ok: false,
          status,
          error_code: errorCode,
          required_fields: ['firstName', 'lastName'],
        }
        : { ok: false, status, error_code: errorCode },
      error: null,
    })
    const response = await POST(request({ classCode: 'BIO101' }))
    expect(response.status).toBe(errorCode === 'profile_required' ? 403 : status)
    expect(await response.json()).toMatchObject({ code: expectedCode })
    expect(mocks.from.mock.calls.map(([table]) => table)).not.toContain('attendance_check_ins')
  })

  it('fails unavailable on a malformed atomic result rather than falling back to multi-step writes', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ok: true }, error: null })
    const response = await POST(request({ classCode: 'BIO101' }))
    expect(response.status).toBe(503)
    expect(mocks.from).toHaveBeenCalledTimes(1)
  })
})
