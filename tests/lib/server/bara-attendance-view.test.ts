import { describe, expect, it, vi } from 'vitest'
import {
  buildTeacherAttendanceView,
  loadTeacherAttendanceView,
} from '@/lib/server/bara-attendance-view'

const occurrence = {
  occurrenceRef: 'occurrence_one',
  opensAt: '2026-09-02T12:50:00.000Z',
  sessionStartsAt: '2026-09-02T13:00:00.000Z',
  presentThroughAt: '2026-09-02T13:05:00.000Z',
  closesAt: '2026-09-02T13:50:00.000Z',
  absentAt: '2026-09-02T14:00:00.000Z',
  sessionEndsAt: '2026-09-02T14:00:00.000Z',
}
const students = [
  { studentId: '10000000-0000-4000-8000-000000000001', firstName: 'Ada', lastName: 'Lovelace' },
  { studentId: '20000000-0000-4000-8000-000000000002', firstName: 'Grace', lastName: 'Hopper' },
]

function build(overrides: Partial<Parameters<typeof buildTeacherAttendanceView>[0]> = {}) {
  return buildTeacherAttendanceView({
    classroomId: '30000000-0000-4000-8000-000000000003',
    classDate: '2026-09-02', integration: 'ready', students,
    occurrence, sessionProjection: null, now: '2026-09-02T13:30:00.000Z',
    ...overrides,
  })
}

function queryResult(data: unknown) {
  const result = { data, error: null }
  const query: any = {
    select: () => query,
    eq: () => query,
    in: () => query,
    is: () => query,
    order: () => query,
    range: () => query,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return query
}

function attendanceViewSupabase() {
  const activeCheckInRef = 'check_in_active'
  const invalidatedCheckInRef = 'check_in_already_removed'
  const rows: Record<string, unknown> = {
    classroom_enrollments: students.map((student, index) => ({
      id: `enrollment_${index + 1}`,
      student_id: student.studentId,
      users: { id: student.studentId, email: `${index + 1}@example.com` },
    })),
    student_profiles: students.map((student, index) => ({
      id: `profile_${index + 1}`,
      user_id: student.studentId,
      first_name: student.firstName,
      last_name: student.lastName,
    })),
    attendance_participant_mappings: students.map((student, index) => ({
      student_id: student.studentId,
      participant_ref: `participant_${index + 1}`,
    })),
    attendance_occurrence_mappings: {
      occurrence_ref: occurrence.occurrenceRef,
      opens_at: occurrence.opensAt,
      closes_at: occurrence.closesAt,
      session_starts_at: occurrence.sessionStartsAt,
      session_ends_at: occurrence.sessionEndsAt,
      present_through_at: occurrence.presentThroughAt,
      absent_at: occurrence.absentAt,
    },
    attendance_window_policies: { enabled: true },
    attendance_session_projection: {
      occurrence_ref: occurrence.occurrenceRef,
      status: 'open',
      opens_at: occurrence.opensAt,
      closes_at: occurrence.closesAt,
      session_revision: 1,
      updated_at: '2026-09-02T13:00:00.000Z',
    },
    attendance_check_in_facts: [
      {
        student_id: students[0].studentId,
        check_in_ref: activeCheckInRef,
        check_in_revision: 1,
        accepted_at: '2026-09-02T13:01:00.000Z',
        invalidated_at: null,
        updated_at: '2026-09-02T13:01:00.000Z',
      },
      {
        student_id: students[1].studentId,
        check_in_ref: invalidatedCheckInRef,
        check_in_revision: 2,
        accepted_at: '2026-09-02T13:02:00.000Z',
        invalidated_at: '2026-09-02T13:10:00.000Z',
        updated_at: '2026-09-02T13:10:00.000Z',
      },
    ],
    attendance_status_overrides: [],
    attendance_integration_outbox: [{
      message_type: 'check_in.invalidate',
      status: 'non_retryable',
      lease_expires_at: null,
      updated_at: '2026-09-02T13:05:00.000Z',
      payload: {
        schema_version: 1,
        message_type: 'check_in.invalidate',
        idempotency_key: 'invalidate:occurrence_one:failed',
        correlation_ref: 'correlation_invalidate_failed',
        installation_ref: 'pika_test_installation',
        roster_ref: 'roster_one',
        occurrence_ref: occurrence.occurrenceRef,
        actor_principal_ref: 'principal_teacher_owner',
        actor_display_name: 'Teacher Owner',
        invalidations: [
          {
            command_ref: 'invalidate_active',
            check_in_ref: activeCheckInRef,
            reason_code: 'staff_reset',
          },
          {
            command_ref: 'invalidate_already_removed',
            check_in_ref: invalidatedCheckInRef,
            reason_code: 'staff_reset',
          },
        ],
      },
    }],
  }
  return {
    from: vi.fn((table: string) => queryResult(rows[table] ?? [])),
  }
}

describe('Pika attendance derivation', () => {
  it('treats the Present cutoff as inclusive and the next instant as Late', () => {
    const result = build({ checkInFacts: [
      {
        studentId: students[0].studentId, checkInRef: 'check_in_boundary', revision: 1,
        acceptedAt: '2026-09-02T13:05:00.000Z', invalidatedAt: null,
        updatedAt: '2026-09-02T13:05:00.000Z',
      },
      {
        studentId: students[1].studentId, checkInRef: 'check_in_after', revision: 1,
        acceptedAt: '2026-09-02T13:05:00.001Z', invalidatedAt: null,
        updatedAt: '2026-09-02T13:05:00.001Z',
      },
    ] })
    expect(result.students.map((student) => student.status)).toEqual(['present', 'late'])
  })

  it('keeps no-scan students Unmarked before the cutoff and makes them Absent at it', () => {
    expect(build({ now: '2026-09-02T13:59:59.999Z' }).students[0].status).toBe('unmarked')
    expect(build({ now: occurrence.absentAt }).students[0].status).toBe('absent')
  })

  it('lets an active teacher override win and Undo reveal the automatic result', () => {
    const fact = {
      studentId: students[0].studentId, checkInRef: 'check_in_late', revision: 1,
      acceptedAt: '2026-09-02T13:10:00.000Z', invalidatedAt: null,
      updatedAt: '2026-09-02T13:10:00.000Z',
    }
    expect(build({
      checkInFacts: [fact],
      statusOverrides: [{
        studentId: students[0].studentId, status: 'present', active: true,
        revision: 2, updatedAt: '2026-09-02T13:15:00.000Z',
      }],
    }).students[0]).toMatchObject({ status: 'present', source: 'staff', hasManualOverride: true })
    expect(build({
      checkInFacts: [fact],
      statusOverrides: [{
        studentId: students[0].studentId, status: null, active: false,
        revision: 3, updatedAt: '2026-09-02T13:16:00.000Z',
      }],
    }).students[0]).toMatchObject({ status: 'late', source: 'student_qr', hasManualOverride: false })
  })

  it('ignores invalidated check-ins while retaining their audit facts', () => {
    const result = build({
      now: occurrence.absentAt,
      checkInFacts: [{
        studentId: students[0].studentId, checkInRef: 'check_in_removed', revision: 2,
        acceptedAt: '2026-09-02T13:01:00.000Z',
        invalidatedAt: '2026-09-02T13:20:00.000Z',
        updatedAt: '2026-09-02T13:20:00.000Z',
      }],
    })
    expect(result.students[0]).toMatchObject({ status: 'absent', hasQrCheckIn: false })
  })

  it('exposes terminal check-in command failure only for the affected student', () => {
    const result = build({ failedStudentIds: [students[0].studentId] })

    expect(result.students[0].commandFailed).toBe(true)
    expect(result.students[1].commandFailed).toBe(false)
  })

  it('prioritizes current pending ownership over retained session and check-in failures', () => {
    const checkIn = {
      studentId: students[0].studentId,
      checkInRef: 'check_in_retry',
      revision: 1,
      acceptedAt: '2026-09-02T13:01:00.000Z',
      invalidatedAt: null,
      updatedAt: '2026-09-02T13:01:00.000Z',
    }
    const result = build({
      checkInFacts: [checkIn],
      pendingCheckInRefs: [checkIn.checkInRef],
      failedStudentIds: [students[0].studentId],
      pendingSessionCommand: true,
      failedSessionCommand: true,
    })

    expect(result.sync.state).toBe('pending')
    expect(result.session.commandFailed).toBe(false)
    expect(result.students[0]).toMatchObject({
      pendingCommand: true,
      commandFailed: false,
    })
  })

  it('maps a non-retryable invalidation only to a still-active check-in', async () => {
    const result = await loadTeacherAttendanceView({
      supabase: attendanceViewSupabase(),
      classroomId: '30000000-0000-4000-8000-000000000003',
      classDate: '2026-09-02',
      integration: 'ready',
      installationRef: 'pika_test_installation',
    })

    expect(result.students[0].commandFailed).toBe(true)
    expect(result.students[1].commandFailed).toBe(false)
    expect(JSON.stringify(result)).not.toContain('check_in_active')
    expect(JSON.stringify(result)).not.toContain('check_in_already_removed')
  })

  it('does not expose provider references in the browser contract', () => {
    const result = build({
      checkInFacts: [{
        studentId: students[0].studentId,
        checkInRef: 'check_in_private_reference',
        revision: 1,
        acceptedAt: '2026-09-02T13:01:00.000Z',
        invalidatedAt: null,
        updatedAt: '2026-09-02T13:01:00.000Z',
      }],
    })
    expect(result.students[0]).toMatchObject({ hasQrCheckIn: true })
    expect(JSON.stringify(result)).not.toContain('occurrence_one')
    expect(JSON.stringify(result)).not.toContain('participant_')
    expect(JSON.stringify(result)).not.toContain('check_in_private_reference')
  })
})
