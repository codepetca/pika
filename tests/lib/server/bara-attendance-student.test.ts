import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BaraAttendanceClientError } from '@/lib/server/bara-attendance-client'
import { sealAttendanceEntryToken } from '@/lib/server/bara-attendance-entry-token'
import {
  executeStudentAttendanceCheckIn,
  StudentAttendanceCheckInError,
} from '@/lib/server/bara-attendance-student'

const entrySecret = 'entry-token-secret-that-is-long-enough-for-tests'
const pikaUser = { id: 'student-one', email: 'student@example.com', role: 'student' }
const actor = { workosSubject: 'user_student_one', displayName: 'Student One' }

function entryToken() {
  return sealAttendanceEntryToken({
    rosterRef: 'roster_one',
    occurrenceRef: 'occurrence_one',
    checkInToken: 'check_in_token_1234567890',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }, { secret: entrySecret })
}

describe('native Pika student attendance check-in', () => {
  beforeEach(() => {
    vi.stubEnv('BARA_ATTENDANCE_ENTRY_TOKEN_SECRET', entrySecret)
    vi.stubEnv('BARA_ATTENDANCE_INSTALLATION_REF', 'pika_test')
  })
  afterEach(() => vi.unstubAllEnvs())

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
      actor_workos_subject: 'user_student_one',
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
      integrationState: 'ready',
      resolveActor: vi.fn().mockResolvedValue(actor),
      send,
    })).resolves.toMatchObject({ state: 'already_checked_in' })

    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0])
  })

  it('does not retry a closed transport rejection or expose it as success', async () => {
    const send = vi.fn().mockRejectedValue(
      new BaraAttendanceClientError('rejected', 'invalid_payload', false),
    )

    await expect(executeStudentAttendanceCheckIn({
      supabase: {},
      pikaUser,
      entryToken: entryToken(),
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
      integrationState: 'ready',
      resolveActor,
      send,
    })).rejects.toEqual(new StudentAttendanceCheckInError('invalid_entry'))
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
