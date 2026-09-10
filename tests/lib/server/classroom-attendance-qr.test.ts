import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/bara-attendance-scope', () => ({
  getBaraAttendanceClassroomIdAccess: vi.fn().mockResolvedValue({
    state: 'ready', scheduleThrough: '2026-09-30',
  }),
}))

import {
  ClassroomAttendanceQrError,
  createClassroomAttendanceQrToken,
  executeClassroomQrStudentCheckIn,
  openClassroomAttendanceQrToken,
} from '@/lib/server/classroom-attendance-qr'

const secret = 'stable-classroom-qr-test-secret-1234567890'
const classroomId = '11111111-1111-4111-8111-111111111111'
const teacherId = '22222222-2222-4222-8222-222222222222'
const studentId = '33333333-3333-4333-8333-333333333333'
const handleId = '44444444-4444-4444-8444-444444444444'
const occurrenceRef = 'occurrence_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

type Scenario = {
  currentHandle?: string | null
  enrolled?: boolean
  enrollmentReads?: boolean[]
  participant?: boolean
  participantReads?: boolean[]
  open?: boolean
  enabled?: boolean | null
  isClassDay?: boolean | null
}

function fakeSupabase({
  currentHandle = handleId,
  enrolled = true,
  enrollmentReads,
  participant = enrolled,
  participantReads,
  open = true,
  enabled = true,
  isClassDay = true,
}: Scenario = {}) {
  let enrollmentRead = 0
  let participantRead = 0
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      const query: any = {
        select() { return query },
        eq(column: string, value: unknown) { filters[column] = value; return query },
        lte(column: string, value: unknown) { filters[column] = value; return query },
        gt(column: string, value: unknown) { filters[column] = value; return query },
        limit() {
          if (table !== 'attendance_occurrence_mappings') throw new Error(`Unexpected limit ${table}`)
          expect(filters.classroom_id).toBe(classroomId)
          expect(filters.desired_state).toBe('scheduled')
          expect(filters.opens_at).toBe(filters.closes_at)
          return Promise.resolve({
            data: [{ occurrence_ref: occurrenceRef, class_date: '2026-09-01',
              opens_at: '2026-09-01T12:00:00.000Z', closes_at: '2026-09-01T13:00:00.000Z',
              desired_state: 'scheduled' }], error: null,
          })
        },
        maybeSingle() {
          if (table === 'attendance_window_policies') {
            expect(filters.classroom_id).toBe(classroomId)
            return Promise.resolve({ data: enabled === null ? null : { enabled }, error: null })
          }
          if (table === 'class_days') {
            expect(filters).toEqual({ classroom_id: classroomId, date: '2026-09-01' })
            return Promise.resolve({ data: isClassDay === null ? null : { is_class_day: isClassDay }, error: null })
          }
          if (table === 'attendance_classroom_qr_handles') {
            const matches = currentHandle && filters.handle_id === currentHandle
            return Promise.resolve({
              data: matches ? {
                classroom_id: classroomId,
                handle_id: currentHandle,
                generation: 1,
                rotated_at: '2026-09-01T12:00:00.000Z',
              } : null,
              error: null,
            })
          }
          if (table === 'classroom_enrollments') {
            const present = enrollmentReads?.[enrollmentRead++] ?? enrolled
            return Promise.resolve({ data: present ? { id: 'enrollment-1' } : null, error: null })
          }
          if (table === 'attendance_participant_mappings') {
            const present = participantReads?.[participantRead++] ?? participant
            return Promise.resolve({
              data: present ? { student_id: studentId, active: true } : null,
              error: null,
            })
          }
          if (table === 'attendance_session_projection') {
            expect(filters).toEqual({ classroom_id: classroomId, installation_ref: 'installation_test',
              occurrence_ref: occurrenceRef, status: 'open' })
            return Promise.resolve({
              data: open ? { occurrence_ref: occurrenceRef } : null,
              error: null,
            })
          }
          if (table === 'classrooms') {
            return Promise.resolve({
              data: {
                teacher_id: teacherId,
                title: 'Physics',
                class_code: 'PHYSICS1',
                archived_at: null,
              },
              error: null,
            })
          }
          if (table === 'users') {
            return Promise.resolve({ data: { workos_user_id: 'user_teacher' }, error: null })
          }
          throw new Error(`Unexpected maybeSingle ${table}`)
        },
      }
      return query
    },
  }
}

describe('stable classroom attendance QR', () => {
  afterEach(() => vi.unstubAllEnvs())
  beforeEach(() => {
    vi.stubEnv('BARA_ATTENDANCE_ENTRY_TOKEN_SECRET', secret)
    vi.stubEnv('BARA_ATTENDANCE_INSTALLATION_REF', 'installation_test')
  })

  it('round-trips an opaque handle without embedding a classroom identifier', () => {
    const token = createClassroomAttendanceQrToken(handleId, secret)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(token).not.toContain(handleId)
    expect(token).not.toContain(classroomId)
    expect(openClassroomAttendanceQrToken(token, secret)).toBe(handleId)
    expect(() => openClassroomAttendanceQrToken(`${token.slice(0, -1)}A`, secret))
      .toThrowError(new ClassroomAttendanceQrError('invalid_or_revoked'))
  })

  it('resolves one currently open occurrence and keeps the Bara entry token server-side', async () => {
    const joinClassroom = vi.fn()
    const syncSources = vi.fn()
    const loadPresentation = vi.fn().mockResolvedValue({
      entryPath: `/attendance/check-in/${'e'.repeat(100)}`,
      expiresAt: '2026-09-01T13:00:00.000Z',
      revision: 3,
    })
    const executeCheckIn = vi.fn().mockResolvedValue({
      state: 'checked_in', title: 'You are checked in', description: 'Recorded',
    })

    const result = await executeClassroomQrStudentCheckIn({
      supabase: fakeSupabase(),
      pikaUser: { id: studentId, email: 'student@example.com', role: 'student' },
      classroomQrToken: createClassroomAttendanceQrToken(handleId, secret),
      attemptId: '55555555-5555-4555-8555-555555555555',
      now: new Date('2026-09-01T12:30:00.000Z'),
      joinClassroom,
      syncSources,
      loadPresentation,
      executeCheckIn,
    })

    expect(result.state).toBe('checked_in')
    expect(joinClassroom).not.toHaveBeenCalled()
    expect(syncSources).not.toHaveBeenCalled()
    expect(loadPresentation).toHaveBeenCalledWith(expect.objectContaining({
      teacherId,
      classroomId,
      classDate: '2026-09-01',
      actor: { workosSubject: 'user_teacher', displayName: 'Physics attendance' },
      integrationState: 'ready',
    }))
    expect(executeCheckIn).toHaveBeenCalledWith(expect.objectContaining({
      entryToken: 'e'.repeat(100),
      integrationState: 'ready',
    }))
  })

  it('shows closed without requesting a Bara token when no occurrence is open', async () => {
    const loadPresentation = vi.fn()
    await expect(executeClassroomQrStudentCheckIn({
      supabase: fakeSupabase({ open: false }),
      pikaUser: { id: studentId, email: 'student@example.com', role: 'student' },
      classroomQrToken: createClassroomAttendanceQrToken(handleId, secret),
      attemptId: '55555555-5555-4555-8555-555555555555',
      now: new Date('2026-09-01T12:30:00.000Z'),
      loadPresentation,
    })).rejects.toMatchObject({ code: 'not_open' })
    expect(loadPresentation).not.toHaveBeenCalled()
  })

  it('rejects a rotated handle before occurrence or Bara resolution', async () => {
    const loadPresentation = vi.fn()
    await expect(executeClassroomQrStudentCheckIn({
      supabase: fakeSupabase({ currentHandle: '66666666-6666-4666-8666-666666666666' }),
      pikaUser: { id: studentId, email: 'student@example.com', role: 'student' },
      classroomQrToken: createClassroomAttendanceQrToken(handleId, secret),
      attemptId: '55555555-5555-4555-8555-555555555555',
      loadPresentation,
    })).rejects.toMatchObject({ code: 'invalid_or_revoked' })
    expect(loadPresentation).not.toHaveBeenCalled()
  })

  it.each([
    { enabled: false }, { enabled: null }, { isClassDay: false }, { isClassDay: null },
  ])('rejects locally ineligible attendance despite an open provider projection: %j', async (scenario) => {
    const loadPresentation = vi.fn()
    const executeCheckIn = vi.fn()
    await expect(executeClassroomQrStudentCheckIn({
      supabase: fakeSupabase(scenario),
      pikaUser: { id: studentId, email: 'student@example.com', role: 'student' },
      classroomQrToken: createClassroomAttendanceQrToken(handleId, secret),
      attemptId: '55555555-5555-4555-8555-555555555555',
      now: new Date('2026-09-01T12:30:00.000Z'),
      loadPresentation, executeCheckIn,
    })).rejects.toMatchObject({ code: 'not_open' })
    expect(loadPresentation).not.toHaveBeenCalled()
    expect(executeCheckIn).not.toHaveBeenCalled()
  })

  it('blocks an authenticated student who is not on this classroom roster', async () => {
    const joinClassroom = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      error_code: 'not_on_roster',
    })
    const loadPresentation = vi.fn()
    await expect(executeClassroomQrStudentCheckIn({
      supabase: fakeSupabase({ enrolled: false }),
      pikaUser: {
        id: studentId,
        email: 'student@example.com',
        role: 'student',
        authSource: 'workos',
        workosUserId: 'user_student',
      },
      classroomQrToken: createClassroomAttendanceQrToken(handleId, secret),
      attemptId: '55555555-5555-4555-8555-555555555555',
      joinClassroom,
      loadPresentation,
    })).rejects.toMatchObject({ code: 'not_on_roster' })
    expect(loadPresentation).not.toHaveBeenCalled()
  })

  it('atomically enrolls a verified roster match, syncs attendance, and checks them in', async () => {
    const joinClassroom = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      created: true,
      already_enrolled: false,
      classroom: { id: classroomId, title: 'Physics', term_label: null },
      enrollment: { id: '77777777-7777-4777-8777-777777777777', created_at: '2026-09-01T12:30:00.000Z' },
    })
    const syncSources = vi.fn().mockResolvedValue({
      roster: { outcome: 'delivered', revision: 2 },
      schedule: { outcome: 'delivered', revision: 2 },
    })
    const loadPresentation = vi.fn().mockResolvedValue({
      entryPath: `/attendance/check-in/${'e'.repeat(100)}`,
      expiresAt: '2026-09-01T13:00:00.000Z',
      revision: 3,
    })
    const executeCheckIn = vi.fn().mockResolvedValue({
      state: 'checked_in', title: 'You are checked in', description: 'Recorded',
    })

    const result = await executeClassroomQrStudentCheckIn({
      supabase: fakeSupabase({
        enrolled: false,
        participant: false,
        enrollmentReads: [false, true],
        participantReads: [false, true],
      }),
      pikaUser: {
        id: studentId,
        email: 'Student@Example.com',
        role: 'student',
        authSource: 'workos',
        workosUserId: 'user_student',
      },
      classroomQrToken: createClassroomAttendanceQrToken(handleId, secret),
      attemptId: '55555555-5555-4555-8555-555555555555',
      now: new Date('2026-09-01T12:30:00.000Z'),
      joinClassroom,
      syncSources,
      loadPresentation,
      executeCheckIn,
    })

    expect(joinClassroom).toHaveBeenCalledWith(expect.objectContaining({
      actorId: studentId,
      expectedClassroomId: classroomId,
      classCode: 'PHYSICS1',
      firstName: null,
      lastName: null,
      studentNumber: null,
    }))
    expect(syncSources).toHaveBeenCalledWith(expect.objectContaining({
      teacherId,
      classroomId,
      windowStart: '2026-09-01',
      windowEnd: '2026-11-30',
      integrationState: 'ready',
      scheduleThrough: '2026-09-30',
    }))
    expect(result).toMatchObject({
      state: 'checked_in',
      description: 'You joined the classroom and your attendance was recorded.',
    })
  })

  it.each([
    ['not_on_roster', 'not_on_roster'],
    ['profile_required', 'not_on_roster'],
    ['enrollment_closed', 'enrollment_closed'],
  ] as const)('does not join when atomic admission returns %s', async (errorCode, expectedCode) => {
    const joinClassroom = vi.fn().mockResolvedValue({
      ok: false,
      status: errorCode === 'profile_required' ? 400 : 403,
      error_code: errorCode,
      ...(errorCode === 'profile_required' ? { required_fields: ['firstName', 'lastName'] } : {}),
    })
    const syncSources = vi.fn()
    const loadPresentation = vi.fn()

    await expect(executeClassroomQrStudentCheckIn({
      supabase: fakeSupabase({ enrolled: false, participant: false }),
      pikaUser: {
        id: studentId,
        email: 'student@example.com',
        role: 'student',
        authSource: 'workos',
        workosUserId: 'user_student',
      },
      classroomQrToken: createClassroomAttendanceQrToken(handleId, secret),
      attemptId: '55555555-5555-4555-8555-555555555555',
      now: new Date('2026-09-01T12:30:00.000Z'),
      joinClassroom,
      syncSources,
      loadPresentation,
    })).rejects.toMatchObject({ code: expectedCode })
    expect(syncSources).not.toHaveBeenCalled()
    expect(loadPresentation).not.toHaveBeenCalled()
  })

  it('does not auto-enroll a password session that cannot satisfy attendance identity', async () => {
    const joinClassroom = vi.fn()
    await expect(executeClassroomQrStudentCheckIn({
      supabase: fakeSupabase({ enrolled: false, participant: false }),
      pikaUser: {
        id: studentId,
        email: 'student@example.com',
        role: 'student',
        authSource: 'password',
      },
      classroomQrToken: createClassroomAttendanceQrToken(handleId, secret),
      attemptId: '55555555-5555-4555-8555-555555555555',
      now: new Date('2026-09-01T12:30:00.000Z'),
      joinClassroom,
    })).rejects.toMatchObject({ code: 'identity_not_linked' })
    expect(joinClassroom).not.toHaveBeenCalled()
  })

  it('does not auto-enroll from the stable poster while attendance is closed', async () => {
    const joinClassroom = vi.fn()
    await expect(executeClassroomQrStudentCheckIn({
      supabase: fakeSupabase({ enrolled: false, participant: false, open: false }),
      pikaUser: {
        id: studentId,
        email: 'student@example.com',
        role: 'student',
        authSource: 'workos',
        workosUserId: 'user_student',
      },
      classroomQrToken: createClassroomAttendanceQrToken(handleId, secret),
      attemptId: '55555555-5555-4555-8555-555555555555',
      now: new Date('2026-09-01T12:30:00.000Z'),
      joinClassroom,
    })).rejects.toMatchObject({ code: 'not_open' })
    expect(joinClassroom).not.toHaveBeenCalled()
  })

  it('returns a retryable failure when a newly joined student is not yet accepted upstream', async () => {
    const joinClassroom = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      created: true,
      already_enrolled: false,
      classroom: { id: classroomId, title: 'Physics', term_label: null },
      enrollment: { id: '77777777-7777-4777-8777-777777777777', created_at: '2026-09-01T12:30:00.000Z' },
    })
    const syncSources = vi.fn().mockResolvedValue({
      roster: { outcome: 'delivered', revision: 2 },
      schedule: { outcome: 'delivered', revision: 2 },
    })
    const loadPresentation = vi.fn().mockResolvedValue({
      entryPath: `/attendance/check-in/${'e'.repeat(100)}`,
      expiresAt: '2026-09-01T13:00:00.000Z',
      revision: 3,
    })
    const executeCheckIn = vi.fn().mockResolvedValue({
      state: 'needs_staff', title: 'Your teacher needs to help', description: 'Not on roster',
    })

    await expect(executeClassroomQrStudentCheckIn({
      supabase: fakeSupabase({
        enrolled: false,
        participant: false,
        enrollmentReads: [false, true],
        participantReads: [false, true],
      }),
      pikaUser: {
        id: studentId,
        email: 'student@example.com',
        role: 'student',
        authSource: 'workos',
        workosUserId: 'user_student',
      },
      classroomQrToken: createClassroomAttendanceQrToken(handleId, secret),
      attemptId: '55555555-5555-4555-8555-555555555555',
      now: new Date('2026-09-01T12:30:00.000Z'),
      joinClassroom,
      syncSources,
      loadPresentation,
      executeCheckIn,
    })).rejects.toMatchObject({ code: 'unavailable' })
  })
})
