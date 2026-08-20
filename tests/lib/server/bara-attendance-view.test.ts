import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildTeacherAttendanceView,
  loadTeacherAttendanceView,
  TeacherAttendanceViewReadError,
} from '@/lib/server/bara-attendance-view'

const { loadAttendanceRoster } = vi.hoisted(() => ({ loadAttendanceRoster: vi.fn() }))
vi.mock('@/lib/server/attendance-report', () => ({ loadAttendanceRoster }))

const students = [
  { studentId: 'student-2', firstName: 'Grace', lastName: 'Hopper' },
  { studentId: 'student-1', firstName: 'Ada', lastName: 'Lovelace' },
]

describe('buildTeacherAttendanceView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  it('returns a provider-neutral disabled state without exposing opaque references', () => {
    const view = buildTeacherAttendanceView({
      classroomId: 'classroom-1',
      classDate: '2026-09-08',
      integration: 'disabled',
      students,
      participantMappings: [],
      occurrence: null,
      sessionProjection: null,
      recordProjections: [],
      pendingStudentIds: [],
    })

    expect(view).toEqual({
      classroomId: 'classroom-1',
      classDate: '2026-09-08',
      integration: 'disabled',
      session: {
        state: 'not_scheduled',
        opensAt: null,
        closesAt: null,
        revision: null,
      },
      sync: { state: 'unavailable', confirmedAt: null },
      students: [
        {
          studentId: 'student-2',
          firstName: 'Grace',
          lastName: 'Hopper',
          status: 'unmarked',
          source: null,
          revision: null,
          pendingCommand: false,
        },
        {
          studentId: 'student-1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          status: 'unmarked',
          source: null,
          revision: null,
          pendingCommand: false,
        },
      ],
    })
    expect(JSON.stringify(view)).not.toMatch(/participant_|occurrence_|roster_|convex/i)
  })

  it('joins authoritative projections through internal mappings and normalizes sources', () => {
    const view = buildTeacherAttendanceView({
      classroomId: 'classroom-1',
      classDate: '2026-09-08',
      integration: 'ready',
      students,
      participantMappings: [
        { studentId: 'student-1', participantRef: 'participant_ada' },
        { studentId: 'student-2', participantRef: 'participant_grace' },
      ],
      occurrence: {
        occurrenceRef: 'occurrence_first_day',
        opensAt: '2026-09-08T12:45:00.000Z',
        closesAt: '2026-09-08T14:15:00.000Z',
      },
      sessionProjection: {
        occurrenceRef: 'occurrence_first_day',
        state: 'open',
        opensAt: '2026-09-08T12:45:00.000Z',
        closesAt: '2026-09-08T14:15:00.000Z',
        revision: 4,
        updatedAt: '2026-09-08T13:00:00.000Z',
      },
      recordProjections: [
        {
          participantRef: 'participant_ada',
          status: 'present',
          source: 'student_qr',
          revision: 2,
          updatedAt: '2026-09-08T13:01:00.000Z',
        },
        {
          participantRef: 'participant_grace',
          status: 'late',
          source: 'staff_manual',
          revision: 3,
          updatedAt: '2026-09-08T13:02:00.000Z',
        },
      ],
      pendingStudentIds: ['student-2'],
    })

    expect(view.session).toEqual({
      state: 'open',
      opensAt: '2026-09-08T12:45:00.000Z',
      closesAt: '2026-09-08T14:15:00.000Z',
      revision: 4,
    })
    expect(view.sync).toEqual({
      state: 'pending',
      confirmedAt: '2026-09-08T13:02:00.000Z',
    })
    expect(view.students).toEqual([
      expect.objectContaining({
        studentId: 'student-2', status: 'late', source: 'staff', pendingCommand: true,
      }),
      expect.objectContaining({
        studentId: 'student-1', status: 'present', source: 'student_qr', pendingCommand: false,
      }),
    ])
    expect(JSON.stringify(view)).not.toContain('participant_')
    expect(JSON.stringify(view)).not.toContain('occurrence_')
  })

  it('keeps an unconfirmed occurrence visibly stale instead of claiming it is current', () => {
    const view = buildTeacherAttendanceView({
      classroomId: 'classroom-1',
      classDate: '2026-09-08',
      integration: 'ready',
      students: [],
      participantMappings: [],
      occurrence: {
        occurrenceRef: 'occurrence_first_day',
        opensAt: '2026-09-08T12:45:00.000Z',
        closesAt: '2026-09-08T14:15:00.000Z',
      },
      sessionProjection: null,
      recordProjections: [],
      pendingStudentIds: [],
    })

    expect(view.session.state).toBe('scheduled')
    expect(view.sync).toEqual({ state: 'stale', confirmedAt: null })
  })

  it('does not age a confirmed closed session into a stale live state', () => {
    const view = buildTeacherAttendanceView({
      classroomId: 'classroom-1',
      classDate: '2026-09-01',
      integration: 'ready',
      students: [],
      participantMappings: [],
      occurrence: {
        occurrenceRef: 'occurrence_old',
        opensAt: '2026-09-01T12:45:00.000Z',
        closesAt: '2026-09-01T14:15:00.000Z',
      },
      sessionProjection: {
        occurrenceRef: 'occurrence_old',
        state: 'closed',
        opensAt: '2026-09-01T12:45:00.000Z',
        closesAt: '2026-09-01T14:15:00.000Z',
        revision: 9,
        updatedAt: '2026-09-01T14:15:01.000Z',
      },
      recordProjections: [],
      pendingStudentIds: [],
    })

    expect(view.sync.state).toBe('current')
  })

  it('does not infer an outage from a quiet open session without reconciliation evidence', () => {
    const view = buildTeacherAttendanceView({
      classroomId: 'classroom-1',
      classDate: '2026-09-08',
      integration: 'ready',
      students: [],
      participantMappings: [],
      occurrence: {
        occurrenceRef: 'occurrence_quiet',
        opensAt: '2026-09-08T12:45:00.000Z',
        closesAt: '2026-09-08T14:15:00.000Z',
      },
      sessionProjection: {
        occurrenceRef: 'occurrence_quiet',
        state: 'open',
        opensAt: '2026-09-08T12:45:00.000Z',
        closesAt: '2026-09-08T14:15:00.000Z',
        revision: 2,
        updatedAt: '2026-09-08T12:45:01.000Z',
      },
      recordProjections: [],
      pendingStudentIds: [],
    })

    expect(view.sync.state).toBe('current')
  })
})

function projectionClient(results: Record<string, { data: unknown; error: any }>) {
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => {
        const result = Promise.resolve(results[table] ?? { data: [], error: null })
        const query: any = {
          eq: vi.fn(() => query),
          maybeSingle: vi.fn(() => result),
          then: result.then.bind(result),
        }
        return query
      }),
    })),
  }
}

describe('loadTeacherAttendanceView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadAttendanceRoster.mockResolvedValue({
      students: [{
        id: '10000000-0000-4000-8000-000000000001',
        email: 'ada@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
      }],
      studentIds: ['10000000-0000-4000-8000-000000000001'],
      enrollmentsError: null,
      profilesError: null,
    })
  })

  it('does not touch unapplied integration tables while the feature is disabled', async () => {
    const supabase = projectionClient({})
    const view = await loadTeacherAttendanceView({
      supabase,
      classroomId: '20000000-0000-4000-8000-000000000002',
      classDate: '2026-09-08',
      integration: 'disabled',
    })

    expect(view.integration).toBe('disabled')
    expect(view.students[0]).toMatchObject({
      studentId: '10000000-0000-4000-8000-000000000001',
      firstName: 'Ada',
      status: 'unmarked',
    })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('loads and strips the private mapping/projection rows when configured', async () => {
    const supabase = projectionClient({
      attendance_participant_mappings: {
        data: [{
          student_id: '10000000-0000-4000-8000-000000000001',
          participant_ref: 'participant_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        }],
        error: null,
      },
      attendance_occurrence_mappings: {
        data: {
          occurrence_ref: 'occurrence_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          opens_at: '2026-09-08T12:45:00.000Z',
          closes_at: '2026-09-08T14:15:00.000Z',
        },
        error: null,
      },
      attendance_window_policies: { data: { enabled: true }, error: null },
      attendance_session_projection: {
        data: {
          occurrence_ref: 'occurrence_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          status: 'open',
          opens_at: '2026-09-08T12:45:00.000Z',
          closes_at: '2026-09-08T14:15:00.000Z',
          session_revision: 3,
          updated_at: '2026-09-08T13:00:00.000Z',
        },
        error: null,
      },
      attendance_record_projection: {
        data: [{
          participant_ref: 'participant_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          status: 'present',
          source: 'student_qr',
          record_revision: 2,
          updated_at: '2026-09-08T13:01:00.000Z',
        }],
        error: null,
      },
    })

    const view = await loadTeacherAttendanceView({
      supabase,
      classroomId: '20000000-0000-4000-8000-000000000002',
      classDate: '2026-09-08',
      integration: 'ready',
      installationRef: 'installation_test',
    })

    expect(view).toMatchObject({
      integration: 'ready',
      session: { state: 'open', revision: 3 },
      sync: { state: 'current', confirmedAt: '2026-09-08T13:01:00.000Z' },
      students: [{ status: 'present', source: 'student_qr', revision: 2 }],
    })
    expect(JSON.stringify(view)).not.toMatch(/participant_|occurrence_|installation_/)
  })

  it('fails with a migration-specific error when the projection tables are absent', async () => {
    const supabase = projectionClient({
      attendance_participant_mappings: {
        data: null,
        error: { code: '42P01', message: 'relation does not exist' },
      },
      attendance_occurrence_mappings: { data: null, error: null },
      attendance_window_policies: { data: null, error: null },
    })

    await expect(loadTeacherAttendanceView({
      supabase,
      classroomId: '20000000-0000-4000-8000-000000000002',
      classDate: '2026-09-08',
      integration: 'ready',
      installationRef: 'installation_test',
    })).rejects.toEqual(expect.objectContaining<TeacherAttendanceViewReadError>({
      code: 'migration_required',
    }))
  })
})
