import { describe, expect, it, vi } from 'vitest'
import { BaraAttendanceClientError } from '@/lib/server/bara-attendance-client'
import {
  loadTeacherAttendanceQrPresentation,
  TeacherAttendanceQrError,
} from '@/lib/server/bara-attendance-qr'

const context = {
  installationRef: 'pika_test_installation',
  rosterRef: 'roster_one',
  occurrenceRef: 'occurrence_one',
  actorWorkosSubject: 'user_teacher_one',
  actorDisplayName: 'Teacher One',
}

function store() {
  return {
    loadContext: vi.fn(async () => context),
    loadParticipantRefs: vi.fn(async () => new Map()),
  }
}

describe('teacher attendance QR presentation boundary', () => {
  it('translates private mappings into a signed request and returns only a Pika entry path', async () => {
    const send = vi.fn(async () => ({
      occurrenceRef: 'occurrence_one',
      sessionRevision: 2,
      checkInPath: '/check-in/23456789ABCDEFGHJKLMNPQRST',
      validUntil: '2026-09-02T13:20:00.000Z',
    }))

    await expect(loadTeacherAttendanceQrPresentation({
      supabase: {},
      teacherId: 'teacher-one',
      classroomId: '11111111-1111-4111-8111-111111111111',
      classDate: '2026-09-02',
      requestId: '22222222-2222-4222-8222-222222222222',
      integrationState: 'ready',
      store: store(),
      send,
      sealEntryToken: () => 'sealed_pika_entry_token',
    })).resolves.toEqual({
      entryPath: '/attendance/check-in/sealed_pika_entry_token',
      expiresAt: '2026-09-02T13:20:00.000Z',
      revision: 2,
    })

    expect(send).toHaveBeenCalledWith({
      schema_version: 1,
      message_type: 'check_in.presentation',
      idempotency_key: 'check-in:occurrence_one:22222222222242228222222222222222',
      correlation_ref: 'correlation_22222222222242228222222222222222',
      installation_ref: 'pika_test_installation',
      roster_ref: 'roster_one',
      occurrence_ref: 'occurrence_one',
      actor_workos_subject: 'user_teacher_one',
      actor_display_name: 'Teacher One',
    })
  })

  it('fails closed when the session is not open or Bara returns an unsafe path', async () => {
    const notOpen = loadTeacherAttendanceQrPresentation({
      supabase: {},
      teacherId: 'teacher-one',
      classroomId: '11111111-1111-4111-8111-111111111111',
      classDate: '2026-09-02',
      requestId: crypto.randomUUID(),
      integrationState: 'ready',
      store: store(),
      sealEntryToken: () => 'sealed_pika_entry_token',
      send: async () => {
        throw new BaraAttendanceClientError('closed', 'invalid_session_state', false, 409)
      },
    })
    await expect(notOpen).rejects.toEqual(new TeacherAttendanceQrError('session_not_open'))

    const unsafe = loadTeacherAttendanceQrPresentation({
      supabase: {},
      teacherId: 'teacher-one',
      classroomId: '11111111-1111-4111-8111-111111111111',
      classDate: '2026-09-02',
      requestId: crypto.randomUUID(),
      integrationState: 'ready',
      store: store(),
      sealEntryToken: () => 'sealed_pika_entry_token',
      send: async () => ({
        occurrenceRef: 'occurrence_one',
        sessionRevision: 2,
        checkInPath: 'https://evil.example/check-in/token',
        validUntil: '2026-09-02T13:20:00.000Z',
      }),
    })
    await expect(unsafe).rejects.toEqual(new TeacherAttendanceQrError('upstream_unavailable'))
  })
})
