import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BaraAttendanceClientError } from '@/lib/server/bara-attendance-client'
import { sealAttendanceEntryToken } from '@/lib/server/bara-attendance-entry-token'
import {
  executeStudentAttendanceCheckIn,
  resolveVerifiedPikaAttendanceStudent,
  StudentAttendanceCheckInError,
} from '@/lib/server/bara-attendance-student'
import { BaraAttendanceCanaryError } from '@/lib/server/bara-attendance-canary'

const { withAuth } = vi.hoisted(() => ({ withAuth: vi.fn() }))
vi.mock('@workos-inc/authkit-nextjs', () => ({ withAuth }))

const entrySecret = 'entry-token-secret-that-is-long-enough-for-tests'
const pikaUser = { id: 'student-one', email: 'student@example.com', role: 'student' }
const actor = { principalRef: 'principal_student_one', displayName: 'Student One' }
const attemptId = '11111111-1111-4111-8111-111111111111'
const classroomId = '20000000-0000-4000-8000-000000000002'

function entryToken() {
  return sealAttendanceEntryToken({
    classroomId,
    rosterRef: 'roster_one',
    occurrenceRef: 'occurrence_one',
    checkInToken: 'check_in_token_1234567890',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }, { secret: entrySecret })
}

describe('native Pika student attendance check-in', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('BARA_ATTENDANCE_ENTRY_TOKEN_SECRET', entrySecret)
    vi.stubEnv('BARA_ATTENDANCE_INSTALLATION_REF', 'pika_test')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('maps the verified local WorkOS link to an opaque Pika principal', async () => {
    withAuth.mockResolvedValue({
      user: {
        id: 'user_student_one',
        email: 'student@example.com',
        emailVerified: true,
      },
    })
    const rows: Record<string, unknown> = {
      users: {
        email: 'student@example.com',
        role: 'student',
        workos_user_id: 'user_student_one',
      },
      student_profiles: { first_name: 'Student', last_name: 'One' },
      attendance_principal_mappings: { principal_ref: 'principal_student_one' },
    }
    const supabase = {
      from: vi.fn((table: string) => {
        const result = Promise.resolve({ data: rows[table] ?? null, error: null })
        const query: any = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          maybeSingle: vi.fn(() => result),
        }
        return query
      }),
    }

    await expect(resolveVerifiedPikaAttendanceStudent({
      supabase,
      pikaUser: { id: 'student-one', email: 'student@example.com', role: 'student' },
    })).resolves.toEqual(actor)
  })

  it('derives a stable command from the verified server actor and returns Bara synchronously', async () => {
    const resolveActor = vi.fn().mockResolvedValue(actor)
    const send = vi.fn().mockResolvedValue({
      outcome: 'applied',
      resultCode: 'present_marked',
      occurrenceRef: 'occurrence_one',
      sessionRevision: 2,
      record: {
        participantRef: 'participant_one',
        recordRevision: 1,
        status: 'present',
        modifiedAt: '2026-09-02T13:01:00.000Z',
      },
    })

    const result = await executeStudentAttendanceCheckIn({
      supabase: {},
      pikaUser,
      entryToken: entryToken(),
      attemptId,
      integrationState: 'ready',
      resolveActor,
      send,
    })

    expect(resolveActor).toHaveBeenCalledWith({ supabase: {}, pikaUser })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      schema_version: 1,
      message_type: 'student_check_in',
      installation_ref: 'pika_test',
      roster_ref: 'roster_one',
      occurrence_ref: 'occurrence_one',
      check_in_token: 'check_in_token_1234567890',
      actor_principal_ref: 'principal_student_one',
      actor_display_name: 'Student One',
      idempotency_key: expect.stringMatching(/^student-check-in:occurrence_one:[a-f0-9]{40}$/),
    }))
    expect(result).toEqual({
      state: 'checked_in',
      title: 'You are checked in',
      description: 'Your attendance was recorded.',
      attendanceStatus: 'present',
      recordedAt: '2026-09-02T13:01:00.000Z',
    })
  })

  it('retries an uncertain outcome once with the identical idempotency key', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new BaraAttendanceClientError('timeout', 'network_error', true))
      .mockResolvedValueOnce({
        outcome: 'duplicate',
        resultCode: 'already_present',
        occurrenceRef: 'occurrence_one',
        sessionRevision: 2,
      })

    await expect(executeStudentAttendanceCheckIn({
      supabase: {},
      pikaUser,
      entryToken: entryToken(),
      attemptId,
      integrationState: 'ready',
      resolveActor: vi.fn().mockResolvedValue(actor),
      send,
    })).resolves.toMatchObject({ state: 'already_checked_in' })

    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0])
  })

  it('uses a new idempotency key for each independent scan attempt', async () => {
    const send = vi.fn().mockResolvedValue({
      outcome: 'duplicate',
      resultCode: 'already_present',
      occurrenceRef: 'occurrence_one',
      sessionRevision: 2,
    })
    for (const logicalAttempt of [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]) {
      await executeStudentAttendanceCheckIn({
        supabase: {},
        pikaUser,
        entryToken: entryToken(),
        attemptId: logicalAttempt,
        integrationState: 'ready',
        resolveActor: vi.fn().mockResolvedValue(actor),
        send,
      })
    }

    expect(send.mock.calls[0][0].idempotency_key)
      .not.toBe(send.mock.calls[1][0].idempotency_key)
  })

  it('does not retry a closed transport rejection or expose it as success', async () => {
    const send = vi.fn().mockRejectedValue(
      new BaraAttendanceClientError('rejected', 'invalid_payload', false),
    )

    await expect(executeStudentAttendanceCheckIn({
      supabase: {},
      pikaUser,
      entryToken: entryToken(),
      attemptId,
      integrationState: 'ready',
      resolveActor: vi.fn().mockResolvedValue(actor),
      send,
    })).rejects.toEqual(new StudentAttendanceCheckInError('upstream_unavailable'))
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('does not resolve an actor or send when the public entry token is invalid', async () => {
    const resolveActor = vi.fn()
    const send = vi.fn()
    await expect(executeStudentAttendanceCheckIn({
      supabase: {},
      pikaUser,
      entryToken: 'invalid',
      attemptId,
      integrationState: 'ready',
      resolveActor,
      send,
    })).rejects.toEqual(new StudentAttendanceCheckInError('invalid_entry'))
    expect(resolveActor).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('does not resolve a student or call Bara for a non-canary classroom token', async () => {
    vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED', 'true')
    vi.stubEnv('BARA_ATTENDANCE_API_BASE_URL', 'https://attendance-api.example')
    vi.stubEnv('BARA_ATTENDANCE_INTEGRATION_SECRET', 'integration-secret-with-at-least-32-characters')
    vi.stubEnv('PIKA_BARA_ATTENDANCE_CANARY_TEACHER_ID', '10000000-0000-4000-8000-000000000001')
    vi.stubEnv('PIKA_BARA_ATTENDANCE_CANARY_CLASSROOM_ID', '30000000-0000-4000-8000-000000000003')
    const resolveActor = vi.fn()
    const send = vi.fn()

    await expect(executeStudentAttendanceCheckIn({
      supabase: {},
      pikaUser,
      entryToken: entryToken(),
      attemptId,
      resolveActor,
      send,
    })).rejects.toEqual(new StudentAttendanceCheckInError('disabled'))
    expect(resolveActor).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects a transferred canary classroom before resolving the student', async () => {
    vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED', 'true')
    vi.stubEnv('BARA_ATTENDANCE_API_BASE_URL', 'https://attendance-api.example')
    vi.stubEnv('BARA_ATTENDANCE_INTEGRATION_SECRET', 'integration-secret-with-at-least-32-characters')
    vi.stubEnv('PIKA_BARA_ATTENDANCE_CANARY_TEACHER_ID', '10000000-0000-4000-8000-000000000001')
    vi.stubEnv('PIKA_BARA_ATTENDANCE_CANARY_CLASSROOM_ID', classroomId)
    const resolveActor = vi.fn()
    const send = vi.fn()
    const verifyCanaryClassroom = vi.fn().mockRejectedValue(
      new BaraAttendanceCanaryError('disabled'),
    )

    await expect(executeStudentAttendanceCheckIn({
      supabase: {},
      pikaUser,
      entryToken: entryToken(),
      attemptId,
      resolveActor,
      send,
      verifyCanaryClassroom,
    })).rejects.toEqual(new StudentAttendanceCheckInError('disabled'))
    expect(resolveActor).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it.each([
    ['session_closed', 'closed'],
    ['invalid_check_in_token', 'invalid'],
    ['not_on_roster', 'needs_staff'],
  ] as const)('maps %s to a native %s state', async (resultCode, state) => {
    await expect(executeStudentAttendanceCheckIn({
      supabase: {},
      pikaUser,
      entryToken: entryToken(),
      attemptId,
      integrationState: 'ready',
      resolveActor: vi.fn().mockResolvedValue(actor),
      send: vi.fn().mockResolvedValue({
        outcome: 'rejected',
        resultCode,
        occurrenceRef: 'occurrence_one',
        sessionRevision: 2,
      }),
    })).resolves.toMatchObject({ state })
  })
})
