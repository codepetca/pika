import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BaraAttendanceClientError,
  getBaraAttendanceIntegrationState,
  getBaraSessionSnapshot,
  postBaraAttendanceMarks,
  postBaraCheckInPresentation,
  postBaraSessionCommand,
  postBaraStudentCheckIn,
  putBaraRosterSnapshot,
  putBaraScheduleSnapshot,
} from '@/lib/server/bara-attendance-client'
import { verifyV1RequestSignature } from '@/vendor/attendance-contract/v1/signing'
import type {
  V1AttendanceMarks,
  V1CheckInPresentationRequest,
  V1RosterSnapshot,
  V1ScheduleSnapshot,
  V1SessionCommand,
  V1StudentCheckIn,
} from '@/vendor/attendance-contract/v1/types'

const secret = 'test-bara-attendance-integration-secret-with-32-characters'
const payload: V1RosterSnapshot = {
  schema_version: 1,
  message_type: 'roster.snapshot',
  idempotency_key: 'roster:one:revision:1',
  correlation_ref: 'correlation_roster_one',
  installation_ref: 'pika_test_installation',
  roster_ref: 'roster_one',
  tenant_ref: 'tenant_one',
  revision: 1,
  owner_principal_ref: 'principal_teacher_owner',
  owner_display_name: 'Teacher Owner',
  display_name: 'Period 1',
  participants: [],
}

const schedulePayload: V1ScheduleSnapshot = {
  schema_version: 1,
  message_type: 'schedule.snapshot',
  idempotency_key: 'schedule:one:revision:1',
  correlation_ref: 'correlation_schedule_one',
  installation_ref: 'pika_test_installation',
  roster_ref: 'roster_one',
  revision: 1,
  timezone: 'America/Toronto',
  window_start: '2026-09-01',
  window_end: '2026-09-30',
  occurrences: [{
    occurrence_ref: 'occurrence_one',
    date: '2026-09-02',
    title: 'Period 1 attendance',
    opens_at: '2026-09-02T12:50:00Z',
    closes_at: '2026-09-02T13:20:00Z',
  }],
}

const commandPayload: V1SessionCommand = {
  schema_version: 1,
  message_type: 'session.command',
  idempotency_key: 'session:occurrence_one:open:one',
  correlation_ref: 'correlation_session_open',
  installation_ref: 'pika_test_installation',
  roster_ref: 'roster_one',
  occurrence_ref: 'occurrence_one',
  command: 'open',
  actor_principal_ref: 'principal_teacher_owner',
  actor_display_name: 'Teacher Owner',
}

const marksPayload: V1AttendanceMarks = {
  schema_version: 1,
  message_type: 'attendance.marks',
  idempotency_key: 'marks:occurrence_one:one',
  correlation_ref: 'correlation_marks_one',
  installation_ref: 'pika_test_installation',
  roster_ref: 'roster_one',
  occurrence_ref: 'occurrence_one',
  actor_principal_ref: 'principal_teacher_owner',
  actor_display_name: 'Teacher Owner',
  marks: [{
    command_ref: 'mark_participant_one',
    participant_ref: 'participant_one',
    status: 'present',
  }],
}

const checkInPresentationPayload: V1CheckInPresentationRequest = {
  schema_version: 1,
  message_type: 'check_in.presentation',
  idempotency_key: 'check-in:occurrence_one:one',
  correlation_ref: 'correlation_check_in_one',
  installation_ref: 'pika_test_installation',
  roster_ref: 'roster_one',
  occurrence_ref: 'occurrence_one',
  actor_principal_ref: 'principal_teacher_owner',
  actor_display_name: 'Teacher Owner',
}

const studentCheckInPayload: V1StudentCheckIn = {
  schema_version: 1,
  message_type: 'student_check_in',
  idempotency_key: 'student-check-in:occurrence_one:student_one',
  correlation_ref: 'student_check_in_one',
  installation_ref: 'pika_test_installation',
  roster_ref: 'roster_one',
  occurrence_ref: 'occurrence_one',
  check_in_token: 'check_in_token_1234567890',
  actor_principal_ref: 'principal_student_one',
  actor_display_name: 'Student One',
}

describe('Bara attendance server client', () => {
  beforeEach(() => {
    vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED', 'true')
    vi.stubEnv('BARA_ATTENDANCE_API_BASE_URL', 'https://attendance-api.example')
    vi.stubEnv('BARA_ATTENDANCE_INSTALLATION_REF', 'pika_test_installation')
    vi.stubEnv('BARA_ATTENDANCE_INTEGRATION_SECRET', secret)
  })

  afterEach(() => vi.unstubAllEnvs())

  it('reports disabled, not-configured, and ready states without making a request', () => {
    expect(getBaraAttendanceIntegrationState()).toBe('ready')

    vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED', 'false')
    expect(getBaraAttendanceIntegrationState()).toBe('disabled')

    vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED', 'true')
    vi.stubEnv('BARA_ATTENDANCE_API_BASE_URL', 'http://attendance-api.example')
    expect(getBaraAttendanceIntegrationState()).toBe('not_configured')
  })

  it('sends a closed roster snapshot with an exact v1 signature', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      new Response(JSON.stringify({
        ok: true,
        outcome: 'applied',
        roster_ref: 'roster_one',
        revision: 1,
        created_count: 0,
        updated_count: 0,
        deactivated_count: 0,
      }), { status: 200 }),
    )

    await expect(putBaraRosterSnapshot(payload, {
      fetcher: fetcher as typeof fetch,
      now: () => 1_786_917_600_000,
      nonce: () => 'nonce_request_one_12345',
    })).resolves.toEqual({
      outcome: 'applied',
      rosterRef: 'roster_one',
      revision: 1,
      createdCount: 0,
      updatedCount: 0,
      deactivatedCount: 0,
    })

    expect(fetcher).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('https://attendance-api.example/api/integrations/pika/v1/rosters/roster_one')
    const headers = init?.headers as Record<string, string>
    const body = init?.body as string
    await expect(verifyV1RequestSignature({
      secret,
      method: 'PUT',
      path: '/api/integrations/pika/v1/rosters/roster_one',
      timestamp: headers['X-Attendance-Timestamp'],
      nonce: headers['X-Attendance-Nonce'],
      body,
    }, headers['X-Attendance-Signature'])).resolves.toBe(true)
    expect(JSON.parse(body)).toEqual(payload)
  })

  it('fails closed while disabled or misconfigured', async () => {
    vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED', 'false')
    await expect(putBaraRosterSnapshot(payload)).rejects.toMatchObject({
      code: 'disabled',
      retryable: false,
    })

    vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED', 'true')
    vi.stubEnv('BARA_ATTENDANCE_API_BASE_URL', 'http://attendance-api.example')
    await expect(putBaraRosterSnapshot(payload)).rejects.toMatchObject({
      code: 'configuration',
      retryable: false,
    })
  })

  it('classifies remote conflicts and temporary failures without leaking response details', async () => {
    const conflict = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, code: 'stale_revision', detail: 'secret detail' }), {
        status: 409,
      }),
    )
    await expect(putBaraRosterSnapshot(payload, {
      fetcher: conflict as typeof fetch,
    })).rejects.toMatchObject({ code: 'stale_revision', retryable: false, status: 409 })

    const unavailable = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: 'temporarily_unavailable' }), { status: 503 }),
    )
    const failure = putBaraRosterSnapshot(payload, { fetcher: unavailable as typeof fetch })
    await expect(failure).rejects.toBeInstanceOf(BaraAttendanceClientError)
    await expect(failure).rejects.toMatchObject({ retryable: true, status: 503 })
  })

  it('retries only the generic not-found response used by a disabled Bara adapter', async () => {
    const disabled = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: 'not_found' }), { status: 404 }),
    )
    await expect(putBaraRosterSnapshot(payload, {
      fetcher: disabled as typeof fetch,
    })).rejects.toMatchObject({ code: 'not_found', retryable: true, status: 404 })

    const missingOccurrence = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, code: 'occurrence_not_found' }), { status: 404 }),
    )
    await expect(postBaraSessionCommand(commandPayload, {
      fetcher: missingOccurrence as typeof fetch,
    })).rejects.toMatchObject({
      code: 'occurrence_not_found',
      retryable: false,
      status: 404,
    })
  })

  it('rejects success responses containing internal fields', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        outcome: 'applied',
        roster_ref: 'roster_one',
        revision: 1,
        created_count: 0,
        updated_count: 0,
        deactivated_count: 0,
        roster_id: 'convex-internal-id',
      }), { status: 200 }),
    )

    await expect(putBaraRosterSnapshot(payload, {
      fetcher: fetcher as typeof fetch,
    })).rejects.toMatchObject({ code: 'invalid_response', retryable: true })
  })

  it('sends materialized schedule windows through the same signed boundary', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        outcome: 'applied',
        roster_ref: 'roster_one',
        revision: 1,
        scheduled_count: 1,
        updated_count: 0,
        cancelled_count: 0,
        preserved_count: 0,
      }), { status: 200 }),
    )

    await expect(putBaraScheduleSnapshot(schedulePayload, {
      fetcher: fetcher as typeof fetch,
      now: () => 1_786_917_600_000,
      nonce: () => 'nonce_schedule_one_12345',
    })).resolves.toEqual({
      outcome: 'applied',
      rosterRef: 'roster_one',
      revision: 1,
      scheduledCount: 1,
      updatedCount: 0,
      cancelledCount: 0,
      preservedCount: 0,
    })

    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('https://attendance-api.example/api/integrations/pika/v1/schedules/roster_one')
    const headers = init?.headers as Record<string, string>
    const body = init?.body as string
    await expect(verifyV1RequestSignature({
      secret,
      method: 'PUT',
      path: '/api/integrations/pika/v1/schedules/roster_one',
      timestamp: headers['X-Attendance-Timestamp'],
      nonce: headers['X-Attendance-Nonce'],
      body,
    }, headers['X-Attendance-Signature'])).resolves.toBe(true)
    expect(JSON.parse(body)).toEqual(schedulePayload)
  })

  it('sends staff session commands without receiving an internal session ID', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        outcome: 'applied',
        occurrence_ref: 'occurrence_one',
        status: 'open',
        session_revision: 2,
      }), { status: 200 }),
    )

    await expect(postBaraSessionCommand(commandPayload, {
      fetcher: fetcher as typeof fetch,
      now: () => 1_786_917_600_000,
      nonce: () => 'nonce_command_one_12345',
    })).resolves.toEqual({
      outcome: 'applied',
      occurrenceRef: 'occurrence_one',
      status: 'open',
      sessionRevision: 2,
    })

    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe(
      'https://attendance-api.example/api/integrations/pika/v1/sessions/occurrence_one/commands',
    )
    expect(init?.method).toBe('POST')
    const headers = init?.headers as Record<string, string>
    const body = init?.body as string
    await expect(verifyV1RequestSignature({
      secret,
      method: 'POST',
      path: '/api/integrations/pika/v1/sessions/occurrence_one/commands',
      timestamp: headers['X-Attendance-Timestamp'],
      nonce: headers['X-Attendance-Nonce'],
      body,
    }, headers['X-Attendance-Signature'])).resolves.toBe(true)
    expect(JSON.parse(body)).toEqual(commandPayload)
  })

  it('sends bounded attendance marks and accepts only aggregate results', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        outcome: 'applied',
        occurrence_ref: 'occurrence_one',
        session_revision: 2,
        applied_count: 1,
        unchanged_count: 0,
      }), { status: 200 }),
    )

    await expect(postBaraAttendanceMarks(marksPayload, {
      fetcher: fetcher as typeof fetch,
      now: () => 1_786_917_600_000,
      nonce: () => 'nonce_marks_one_1234567',
    })).resolves.toEqual({
      outcome: 'applied',
      occurrenceRef: 'occurrence_one',
      sessionRevision: 2,
      appliedCount: 1,
      unchangedCount: 0,
    })

    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe(
      'https://attendance-api.example/api/integrations/pika/v1/sessions/occurrence_one/marks',
    )
    const headers = init?.headers as Record<string, string>
    const body = init?.body as string
    await expect(verifyV1RequestSignature({
      secret,
      method: 'POST',
      path: '/api/integrations/pika/v1/sessions/occurrence_one/marks',
      timestamp: headers['X-Attendance-Timestamp'],
      nonce: headers['X-Attendance-Nonce'],
      body,
    }, headers['X-Attendance-Signature'])).resolves.toBe(true)
    expect(JSON.parse(body)).toEqual(marksPayload)
  })

  it('retrieves a closed, signed check-in presentation without service IDs', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        schema_version: 1,
        occurrence_ref: 'occurrence_one',
        session_revision: 2,
        check_in_path: '/check-in/23456789ABCDEFGHJKLMNPQRST',
        valid_until: '2026-09-02T13:20:00.000Z',
      }), { status: 200 }),
    )

    await expect(postBaraCheckInPresentation(checkInPresentationPayload, {
      fetcher: fetcher as typeof fetch,
      now: () => 1_786_917_600_000,
      nonce: () => 'nonce_check_in_one_12345',
    })).resolves.toEqual({
      occurrenceRef: 'occurrence_one',
      sessionRevision: 2,
      checkInPath: '/check-in/23456789ABCDEFGHJKLMNPQRST',
      validUntil: '2026-09-02T13:20:00.000Z',
    })

    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe(
      'https://attendance-api.example/api/integrations/pika/v1/sessions/occurrence_one/check-in',
    )
    const headers = init?.headers as Record<string, string>
    const body = init?.body as string
    await expect(verifyV1RequestSignature({
      secret,
      method: 'POST',
      path: '/api/integrations/pika/v1/sessions/occurrence_one/check-in',
      timestamp: headers['X-Attendance-Timestamp'],
      nonce: headers['X-Attendance-Nonce'],
      body,
    }, headers['X-Attendance-Signature'])).resolves.toBe(true)
    expect(JSON.parse(body)).toEqual(checkInPresentationPayload)

    const internalLeak = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        schema_version: 1,
        occurrence_ref: 'occurrence_one',
        session_revision: 2,
        check_in_path: '/check-in/23456789ABCDEFGHJKLMNPQRST',
        valid_until: '2026-09-02T13:20:00.000Z',
        session_id: 'convex-internal-id',
      }), { status: 200 }),
    )
    await expect(postBaraCheckInPresentation(checkInPresentationPayload, {
      fetcher: internalLeak as typeof fetch,
    })).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('retrieves a closed authoritative snapshot through a signed empty-body request', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        schema_version: 1,
        occurrence_ref: 'occurrence_one',
        roster_ref: 'roster_one',
        session_revision: 3,
        status: 'closed',
        opens_at: '2026-09-02T12:50:00.000Z',
        closes_at: '2026-09-02T13:20:00.000Z',
        records: [{
          participant_ref: 'participant_one',
          record_revision: 2,
          status: 'absent',
          source: 'staff_manual',
          actor_type: 'staff',
          modified_at: '2026-09-02T13:25:00.000Z',
        }],
      }), { status: 200 }),
    )

    await expect(getBaraSessionSnapshot('occurrence_one', {
      fetcher: fetcher as typeof fetch,
      now: () => 1_786_917_600_000,
      nonce: () => 'nonce_snapshot_one_12345',
    })).resolves.toMatchObject({
      occurrence_ref: 'occurrence_one',
      roster_ref: 'roster_one',
      status: 'closed',
      records: [{ participant_ref: 'participant_one', record_revision: 2 }],
    })

    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe(
      'https://attendance-api.example/api/integrations/pika/v1/sessions/occurrence_one',
    )
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
    const headers = init?.headers as Record<string, string>
    await expect(verifyV1RequestSignature({
      secret,
      method: 'GET',
      path: '/api/integrations/pika/v1/sessions/occurrence_one',
      timestamp: headers['X-Attendance-Timestamp'],
      nonce: headers['X-Attendance-Nonce'],
      body: '',
    }, headers['X-Attendance-Signature'])).resolves.toBe(true)
  })

  it('returns a closed synchronous student result and rejects unexpected fields', async () => {
    const response = {
      ok: true,
      schema_version: 1,
      outcome: 'applied',
      result_code: 'present_marked',
      occurrence_ref: 'occurrence_one',
      session_revision: 2,
      record: {
        participant_ref: 'participant_one',
        record_revision: 1,
        status: 'present',
        modified_at: '2026-09-02T13:01:00.000Z',
      },
    }
    const fetcher = vi.fn(async () => new Response(JSON.stringify(response), { status: 200 }))

    await expect(postBaraStudentCheckIn(studentCheckInPayload, {
      fetcher: fetcher as typeof fetch,
    })).resolves.toEqual({
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
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://attendance-api.example/api/integrations/pika/v1/sessions/occurrence_one/student-check-ins',
    )

    const leaked = vi.fn(async () => new Response(JSON.stringify({
      ...response,
      app_user_id: 'convex-internal-id',
    }), { status: 200 }))
    await expect(postBaraStudentCheckIn(studentCheckInPayload, {
      fetcher: leaked as typeof fetch,
    })).rejects.toMatchObject({ code: 'invalid_response' })
  })
})
