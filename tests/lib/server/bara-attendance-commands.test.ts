import { describe, expect, it, vi } from 'vitest'
import {
  executeTeacherAttendanceMarks,
  executeTeacherAttendanceSessionCommand,
  type AttendanceCommandStore,
} from '@/lib/server/bara-attendance-commands'
import { BaraAttendanceClientError } from '@/lib/server/bara-attendance-client'

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
      actorWorkosSubject: 'user_teacher',
      actorDisplayName: 'Teacher One',
    }),
    loadParticipantRefs: vi.fn().mockResolvedValue(new Map([
      [studentOne, 'participant_one'],
      [studentTwo, 'participant_two'],
    ])),
  }
}

describe('teacher Bara attendance commands', () => {
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
      actor_workos_subject: 'user_teacher',
      actor_display_name: 'Teacher One',
    })
    expect(result).toEqual({ outcome: 'applied', state: 'open', revision: 3 })
    expect(JSON.stringify(result)).not.toMatch(/occurrence_|roster_|installation_|user_/)
  })

  it('maps Pika student IDs to bounded private mark commands', async () => {
    const send = vi.fn().mockResolvedValue({
      outcome: 'applied',
      occurrenceRef: 'occurrence_private',
      sessionRevision: 4,
      appliedCount: 1,
      unchangedCount: 1,
    })
    const result = await executeTeacherAttendanceMarks({
      supabase: {},
      teacherId,
      classroomId,
      classDate: '2026-09-08',
      requestId,
      marks: [
        { studentId: studentOne, status: 'present' },
        { studentId: studentTwo, status: 'late', reasonCode: 'late_arrival' },
      ],
      integrationState: 'ready',
      store: store(),
      send,
    })

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      message_type: 'attendance.marks',
      idempotency_key: 'marks:occurrence_private:40000000000040008000000000000004',
      actor_display_name: 'Teacher One',
      marks: [
        {
          command_ref: 'mark_40000000000040008000000000000004_1',
          participant_ref: 'participant_one',
          status: 'present',
        },
        {
          command_ref: 'mark_40000000000040008000000000000004_2',
          participant_ref: 'participant_two',
          status: 'late',
          reason_code: 'late_arrival',
        },
      ],
    }))
    expect(result).toEqual({
      outcome: 'applied',
      sessionRevision: 4,
      appliedCount: 1,
      unchangedCount: 1,
    })
    expect(JSON.stringify(result)).not.toContain('participant_')
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
