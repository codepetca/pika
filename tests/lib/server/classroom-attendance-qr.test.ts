import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  open?: boolean
}

function fakeSupabase({
  currentHandle = handleId,
  enrolled = true,
  open = true,
}: Scenario = {}) {
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
            return Promise.resolve({ data: enrolled ? { id: 'enrollment-1' } : null, error: null })
          }
          if (table === 'attendance_participant_mappings') {
            return Promise.resolve({
              data: enrolled ? { student_id: studentId, active: true } : null,
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
              data: { teacher_id: teacherId, title: 'Physics', archived_at: null }, error: null,
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
      loadPresentation,
      executeCheckIn,
    })

    expect(result.state).toBe('checked_in')
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

  it('blocks a student from another classroom before occurrence or Bara resolution', async () => {
    const loadPresentation = vi.fn()
    await expect(executeClassroomQrStudentCheckIn({
      supabase: fakeSupabase({ enrolled: false }),
      pikaUser: { id: studentId, email: 'student@example.com', role: 'student' },
      classroomQrToken: createClassroomAttendanceQrToken(handleId, secret),
      attemptId: '55555555-5555-4555-8555-555555555555',
      loadPresentation,
    })).rejects.toMatchObject({ code: 'not_enrolled' })
    expect(loadPresentation).not.toHaveBeenCalled()
  })
})
