import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createSupabaseAttendanceCommandStore,
  executeTeacherAttendanceMarks,
  executeTeacherAttendanceSessionCommand,
  executeTeacherCheckInInvalidations,
  type AttendanceCommandStore,
} from '@/lib/server/bara-attendance-commands'
import { BaraAttendanceClientError } from '@/lib/server/bara-attendance-client'
import { BaraAttendanceOutboxError } from '@/lib/server/bara-attendance-outbox'

const teacherId = '30000000-0000-4000-8000-000000000003'
const classroomId = '20000000-0000-4000-8000-000000000002'
const studentOne = '10000000-0000-4000-8000-000000000001'
const studentTwo = '10000000-0000-4000-8000-000000000002'
const requestId = '40000000-0000-4000-8000-000000000004'

function store(): AttendanceCommandStore {
  return {
    loadContext: vi.fn().mockResolvedValue({
      installationRef: 'installation_staging',
      rosterRef: 'roster_private',
      occurrenceRef: 'occurrence_private',
      actorPrincipalRef: 'principal_teacher',
      actorDisplayName: 'Teacher One',
    }),
    loadParticipantRefs: vi.fn().mockResolvedValue(new Map([
      [studentOne, 'participant_one'],
      [studentTwo, 'participant_two'],
    ])),
  }
}

describe('teacher Bara attendance commands', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('keeps local WorkOS verification separate from the outbound Pika principal', async () => {
    vi.stubEnv('BARA_ATTENDANCE_INSTALLATION_REF', 'installation_staging')
    const rows: Record<string, unknown> = {
      users: { workos_user_id: 'user_teacher' },
      attendance_principal_mappings: { principal_ref: 'principal_teacher' },
      attendance_roster_mappings: { roster_ref: 'roster_private' },
      attendance_occurrence_mappings: {
        occurrence_ref: 'occurrence_private',
        opens_at: '2026-09-08T12:45:00.000Z',
        closes_at: '2026-09-08T14:15:00.000Z',
      },
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

    await expect(createSupabaseAttendanceCommandStore(supabase).loadContext({
      teacherId,
      classroomId,
      classDate: '2026-09-08',
      actor: { workosSubject: 'user_teacher', displayName: 'Teacher One' },
    })).resolves.toMatchObject({
      actorPrincipalRef: 'principal_teacher',
      actorDisplayName: 'Teacher One',
    })
  })

  it('translates a Pika session command and returns no service reference', async () => {
    const send = vi.fn().mockResolvedValue({
      outcome: 'applied',
      occurrenceRef: 'occurrence_private',
      status: 'open',
      sessionRevision: 3,
    })
    const result = await executeTeacherAttendanceSessionCommand({
      supabase: {},
      teacherId,
      classroomId,
      classDate: '2026-09-08',
      requestId,
      command: 'open',
      integrationState: 'ready',
      store: store(),
      send,
    })

    expect(send).toHaveBeenCalledWith({
      schema_version: 1,
      message_type: 'session.command',
      idempotency_key: 'session:occurrence_private:40000000000040008000000000000004',
      correlation_ref: 'correlation_40000000000040008000000000000004',
      installation_ref: 'installation_staging',
      roster_ref: 'roster_private',
      occurrence_ref: 'occurrence_private',
      command: 'open',
      actor_principal_ref: 'principal_teacher',
      actor_display_name: 'Teacher One',
    })
    expect(result).toEqual({ outcome: 'applied', state: 'open', revision: 3 })
    expect(JSON.stringify(result)).not.toMatch(/occurrence_|roster_|installation_|user_/)
  })

  it('stores bounded Pika-owned status overrides without calling Bara', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      outcome: 'applied', occurrence_ref: 'occurrence_private',
      applied_count: 1, unchanged_count: 1,
    }, error: null })
    const result = await executeTeacherAttendanceMarks({
      supabase: { rpc },
      teacherId,
      classroomId,
      classDate: '2026-09-08',
      requestId,
      marks: [
        { studentId: studentOne, status: 'present' },
        { studentId: studentTwo, status: 'late', reasonCode: 'late_arrival' },
      ],
      integrationState: 'ready',
    })

    expect(rpc).toHaveBeenCalledWith('apply_attendance_status_overrides_v1', {
      p_teacher_id: teacherId,
      p_classroom_id: classroomId,
      p_class_date: '2026-09-08',
      p_request_id: requestId,
      p_marks: [
        { student_id: studentOne, status: 'present' },
        { student_id: studentTwo, status: 'late', reason_code: 'late_arrival' },
      ],
    })
    expect(result).toEqual({
      outcome: 'applied',
      appliedCount: 1,
      unchangedCount: 1,
    })
    expect(JSON.stringify(result)).not.toContain('participant_')
  })

  it('invalidates the latest active QR fact per selected student through Bara', async () => {
    const facts = [
      {
        student_id: studentOne,
        check_in_ref: 'check_in_old',
        accepted_at: '2026-09-08T12:55:00.000Z',
      },
      {
        student_id: studentOne,
        check_in_ref: 'check_in_new',
        accepted_at: '2026-09-08T13:02:00.000Z',
      },
      {
        student_id: studentTwo,
        check_in_ref: 'check_in_two',
        accepted_at: '2026-09-08T12:59:00.000Z',
      },
    ]
    const query: any = {}
    for (const method of ['select', 'eq', 'is', 'in', 'order']) {
      query[method] = vi.fn(() => query)
    }
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({
      data: facts,
      error: null,
    }).then(resolve)
    const send = vi.fn().mockResolvedValue({
      outcome: 'applied',
      occurrenceRef: 'occurrence_private',
      sessionRevision: 4,
      appliedCount: 2,
      unchangedCount: 0,
    })

    const result = await executeTeacherCheckInInvalidations({
      supabase: { from: vi.fn(() => query) },
      teacherId,
      classroomId,
      classDate: '2026-09-08',
      requestId,
      actor: { workosSubject: 'user_teacher', displayName: 'Teacher One' },
      studentIds: [studentOne, studentTwo],
      integrationState: 'ready',
      store: store(),
      send,
    })

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      schema_version: 1,
      message_type: 'check_in.invalidate',
      installation_ref: 'installation_staging',
      roster_ref: 'roster_private',
      occurrence_ref: 'occurrence_private',
      invalidations: [
        expect.objectContaining({ check_in_ref: 'check_in_new', reason_code: 'staff_reset' }),
        expect.objectContaining({ check_in_ref: 'check_in_two', reason_code: 'staff_reset' }),
      ],
    }))
    expect(result).toEqual({ outcome: 'applied', appliedCount: 2, unchangedCount: 0 })
  })

  it('turns provider conflicts and outages into stable command errors', async () => {
    await expect(executeTeacherAttendanceSessionCommand({
      supabase: {},
      teacherId,
      classroomId,
      classDate: '2026-09-08',
      requestId,
      command: 'close',
      integrationState: 'ready',
      store: store(),
      send: vi.fn().mockRejectedValue(new BaraAttendanceClientError(
        'remote detail', 'stale_revision', false, 409,
      )),
    })).rejects.toMatchObject({ code: 'conflict' })

    await expect(executeTeacherAttendanceSessionCommand({
      supabase: {},
      teacherId,
      classroomId,
      classDate: '2026-09-08',
      requestId,
      command: 'close',
      integrationState: 'ready',
      store: store(),
      send: vi.fn().mockRejectedValue(new BaraAttendanceClientError(
        'remote detail', 'network_error', true,
      )),
    })).rejects.toMatchObject({ code: 'upstream_unavailable' })
  })

  it('returns a durable pending outcome after a retryable delivery timeout', async () => {
    await expect(executeTeacherAttendanceSessionCommand({
      supabase: {},
      teacherId,
      classroomId,
      classDate: '2026-09-08',
      requestId,
      command: 'open',
      integrationState: 'ready',
      store: store(),
      send: vi.fn().mockRejectedValue(new BaraAttendanceOutboxError(
        'queued after timeout',
        'delivery_pending',
        true,
      )),
    })).resolves.toEqual({ outcome: 'pending' })
  })

  it('does not resolve mappings while the integration flag is disabled', async () => {
    const commandStore = store()
    await expect(executeTeacherAttendanceSessionCommand({
      supabase: {},
      teacherId,
      classroomId,
      classDate: '2026-09-08',
      requestId,
      command: 'open',
      integrationState: 'disabled',
      store: commandStore,
      send: vi.fn(),
    })).rejects.toMatchObject({ code: 'disabled' })
    expect(commandStore.loadContext).not.toHaveBeenCalled()
  })
})
