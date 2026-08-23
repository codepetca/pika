import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildStudentAttendanceClassroomState,
  loadStudentAttendanceStatusView,
} from '@/lib/server/bara-attendance-student-view'

const classroomOne = '20000000-0000-4000-8000-000000000001'
const classroomTwo = '20000000-0000-4000-8000-000000000002'
const teacherOne = '10000000-0000-4000-8000-000000000001'
const teacherTwo = '10000000-0000-4000-8000-000000000002'
const studentOne = '30000000-0000-4000-8000-000000000001'

function queryClient(rows: Record<string, unknown>) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = []
  const client = {
    from: vi.fn((table: string) => {
      const result = { data: rows[table] ?? [], error: null }
      const query: any = {}
      for (const method of ['select', 'eq', 'in', 'is', 'order', 'limit', 'lte', 'or']) {
        query[method] = vi.fn((...args: unknown[]) => {
          calls.push({ table, method, args })
          return query
        })
      }
      query.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve)
      return query
    }),
  }
  return { client, calls }
}

describe('student attendance status view', () => {
  beforeEach(() => {
    vi.stubEnv('PIKA_BARA_ATTENDANCE_SCOPE_MODE', 'teacher_entitlements')
    vi.stubEnv('BARA_ATTENDANCE_INSTALLATION_REF', 'pika_test')
  })

  afterEach(() => vi.unstubAllEnvs())

  it('turns an open session into a QR-only prompt and expires it at close', () => {
    const occurrence = {
      classroom_id: classroomOne,
      class_date: '2026-08-23',
      occurrence_ref: 'occurrence_one',
      opens_at: '2026-08-23T13:00:00.000Z',
      closes_at: '2026-08-23T14:00:00.000Z',
      desired_state: 'scheduled' as const,
    }
    const session = {
      occurrence_ref: 'occurrence_one',
      status: 'open' as const,
      opens_at: occurrence.opens_at,
      closes_at: occurrence.closes_at,
    }

    expect(buildStudentAttendanceClassroomState({
      classroomId: classroomOne,
      occurrence,
      session,
      record: null,
      now: new Date('2026-08-23T13:30:00.000Z'),
    }).state.state).toBe('open')

    expect(buildStudentAttendanceClassroomState({
      classroomId: classroomOne,
      occurrence,
      session,
      record: null,
      now: new Date(occurrence.closes_at),
    }).state.state).toBe('closed')
  })

  it('returns only the signed-in student confirmation and its event time', () => {
    const result = buildStudentAttendanceClassroomState({
      classroomId: classroomOne,
      occurrence: {
        classroom_id: classroomOne,
        class_date: '2026-08-23',
        occurrence_ref: 'occurrence_one',
        opens_at: '2026-08-23T13:00:00.000Z',
        closes_at: '2026-08-23T14:00:00.000Z',
        desired_state: 'scheduled',
      },
      session: {
        occurrence_ref: 'occurrence_one',
        status: 'closed',
        opens_at: '2026-08-23T13:00:00.000Z',
        closes_at: '2026-08-23T14:00:00.000Z',
      },
      record: {
        classroom_id: classroomOne,
        occurrence_ref: 'occurrence_one',
        status: 'late',
        last_event_at: '2026-08-23T13:07:00.000Z',
      },
      now: new Date('2026-08-23T14:30:00.000Z'),
    })

    expect(result.state).toEqual(expect.objectContaining({
      classroomId: classroomOne,
      state: 'confirmed',
      attendanceStatus: 'late',
      confirmedAt: '2026-08-23T13:07:00.000Z',
    }))
  })

  it('keeps classrooms independently enrolled and entitlement scoped in bounded batch reads', async () => {
    const { client, calls } = queryClient({
      classroom_enrollments: [
        { classroom_id: classroomOne },
        { classroom_id: classroomTwo },
      ],
      classrooms: [
        { id: classroomOne, teacher_id: teacherOne },
        { id: classroomTwo, teacher_id: teacherTwo },
      ],
      attendance_teacher_entitlements: [{ teacher_id: teacherOne }],
      attendance_roster_mappings: [
        { classroom_id: classroomOne, integration_state: 'active' },
        { classroom_id: classroomTwo, integration_state: 'active' },
      ],
      attendance_occurrence_mappings: [{
        classroom_id: classroomOne,
        class_date: '2026-08-23',
        occurrence_ref: 'occurrence_one',
        opens_at: '2026-08-23T13:00:00.000Z',
        closes_at: '2026-08-23T14:00:00.000Z',
        desired_state: 'scheduled',
      }],
      attendance_session_projection: [{
        occurrence_ref: 'occurrence_one',
        status: 'open',
        opens_at: '2026-08-23T13:00:00.000Z',
        closes_at: '2026-08-23T14:00:00.000Z',
      }],
      attendance_record_projection: [],
    })

    const result = await loadStudentAttendanceStatusView({
      supabase: client,
      studentId: studentOne,
      now: new Date('2026-08-23T13:30:00.000Z'),
      integrationState: 'ready',
    })

    expect(result.classrooms).toEqual([
      expect.objectContaining({ classroomId: classroomOne, state: 'open' }),
      expect.objectContaining({ classroomId: classroomTwo, state: 'unavailable' }),
    ])
    expect(calls).toContainEqual({
      table: 'attendance_record_projection',
      method: 'eq',
      args: ['student_id', studentOne],
    })
    expect(calls.filter((call) => call.method === 'limit').every(
      (call) => typeof call.args[0] === 'number' && call.args[0] <= 100,
    )).toBe(true)
    expect(JSON.stringify(result)).not.toContain('occurrence_one')
    expect(JSON.stringify(result)).not.toContain(teacherOne)
  })

  it('selects an open previous-day occurrence through its next-day close', async () => {
    const { client, calls } = queryClient({
      classroom_enrollments: [{ classroom_id: classroomOne }],
      classrooms: [{ id: classroomOne, teacher_id: teacherOne }],
      attendance_teacher_entitlements: [{ teacher_id: teacherOne }],
      attendance_roster_mappings: [{ classroom_id: classroomOne, integration_state: 'active' }],
      attendance_occurrence_mappings: [
        {
          classroom_id: classroomOne,
          class_date: '2026-08-23',
          occurrence_ref: 'overnight_occurrence',
          opens_at: '2026-08-24T03:00:00.000Z',
          closes_at: '2026-08-24T05:00:00.000Z',
          desired_state: 'scheduled',
        },
        {
          classroom_id: classroomOne,
          class_date: '2026-08-24',
          occurrence_ref: 'today_occurrence',
          opens_at: '2026-08-24T13:00:00.000Z',
          closes_at: '2026-08-24T14:00:00.000Z',
          desired_state: 'scheduled',
        },
      ],
      attendance_session_projection: [
        {
          occurrence_ref: 'overnight_occurrence',
          status: 'open',
          opens_at: '2026-08-24T03:00:00.000Z',
          closes_at: '2026-08-24T05:00:00.000Z',
        },
        {
          occurrence_ref: 'today_occurrence',
          status: 'scheduled',
          opens_at: '2026-08-24T13:00:00.000Z',
          closes_at: '2026-08-24T14:00:00.000Z',
        },
      ],
      attendance_record_projection: [],
    })

    const result = await loadStudentAttendanceStatusView({
      supabase: client,
      studentId: studentOne,
      now: new Date('2026-08-24T04:30:00.000Z'),
      integrationState: 'ready',
    })

    expect(result.classrooms).toEqual([
      expect.objectContaining({
        classroomId: classroomOne,
        state: 'open',
        closesAt: '2026-08-24T05:00:00.000Z',
      }),
    ])
    expect(calls).toContainEqual({
      table: 'attendance_occurrence_mappings',
      method: 'in',
      args: ['class_date', ['2026-08-23', '2026-08-24']],
    })
  })

  it('keeps an overnight confirmation until close, then selects today', async () => {
    const rows = {
      classroom_enrollments: [{ classroom_id: classroomOne }],
      classrooms: [{ id: classroomOne, teacher_id: teacherOne }],
      attendance_teacher_entitlements: [{ teacher_id: teacherOne }],
      attendance_roster_mappings: [{ classroom_id: classroomOne, integration_state: 'active' }],
      attendance_occurrence_mappings: [
        {
          classroom_id: classroomOne,
          class_date: '2026-08-23',
          occurrence_ref: 'overnight_occurrence',
          opens_at: '2026-08-24T03:00:00.000Z',
          closes_at: '2026-08-24T05:00:00.000Z',
          desired_state: 'scheduled',
        },
        {
          classroom_id: classroomOne,
          class_date: '2026-08-24',
          occurrence_ref: 'today_occurrence',
          opens_at: '2026-08-24T13:00:00.000Z',
          closes_at: '2026-08-24T14:00:00.000Z',
          desired_state: 'scheduled',
        },
      ],
      attendance_session_projection: [{
        occurrence_ref: 'overnight_occurrence',
        status: 'closed',
        opens_at: '2026-08-24T03:00:00.000Z',
        closes_at: '2026-08-24T05:00:00.000Z',
      }],
      attendance_record_projection: [{
        classroom_id: classroomOne,
        occurrence_ref: 'overnight_occurrence',
        status: 'present',
        last_event_at: '2026-08-24T03:15:00.000Z',
      }],
    }

    const beforeClose = await loadStudentAttendanceStatusView({
      supabase: queryClient(rows).client,
      studentId: studentOne,
      now: new Date('2026-08-24T04:30:00.000Z'),
      integrationState: 'ready',
    })
    expect(beforeClose.classrooms[0]).toEqual(expect.objectContaining({
      state: 'confirmed',
      confirmedAt: '2026-08-24T03:15:00.000Z',
    }))

    const afterClose = await loadStudentAttendanceStatusView({
      supabase: queryClient(rows).client,
      studentId: studentOne,
      now: new Date('2026-08-24T05:00:00.000Z'),
      integrationState: 'ready',
    })
    expect(afterClose.classrooms[0]).toEqual(expect.objectContaining({
      state: 'scheduled',
      opensAt: '2026-08-24T13:00:00.000Z',
    }))
  })

  it('revalidates a closed confirmation at the next Toronto midnight', () => {
    const result = buildStudentAttendanceClassroomState({
      classroomId: classroomOne,
      occurrence: {
        classroom_id: classroomOne,
        class_date: '2026-08-23',
        occurrence_ref: 'occurrence_one',
        opens_at: '2026-08-23T13:00:00.000Z',
        closes_at: '2026-08-23T14:00:00.000Z',
        desired_state: 'scheduled',
      },
      session: {
        occurrence_ref: 'occurrence_one',
        status: 'closed',
        opens_at: '2026-08-23T13:00:00.000Z',
        closes_at: '2026-08-23T14:00:00.000Z',
      },
      record: {
        classroom_id: classroomOne,
        occurrence_ref: 'occurrence_one',
        status: 'present',
        last_event_at: '2026-08-23T13:07:00.000Z',
      },
      now: new Date('2026-08-23T20:00:00.000Z'),
    })

    expect(result.nextRefreshAt).toBe('2026-08-24T04:00:00.000Z')
  })
})
