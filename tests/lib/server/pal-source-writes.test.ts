import { describe, expect, it, vi } from 'vitest'

import {
  createAssignmentDocWithPalEvent,
  createClassroomEnrollmentWithPalEvent,
  upsertStudentEntryWithPalEvent,
} from '@/lib/server/pal-source-writes'
import {
  buildClassroomJoinedEvent,
  buildDailyLogCompletedEvent,
  buildLearningItemViewedEvent,
} from '@/lib/server/pal-events'

const occurredAt = new Date('2026-09-16T18:20:00.000Z')
const pseudonymSecret = 'test-pseudonym-secret-32-characters-long'
const studentId = 'student-1'

function clientFor(result: unknown) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: result, error: null }),
  }
}

describe('Pal transactional source writes', () => {
  it('creates enrolment and classroom.joined in one RPC', async () => {
    const supabase = clientFor({
      ok: true,
      created: true,
      enrollment: { id: 'enrollment-1' },
    })
    const event = buildClassroomJoinedEvent({
      learnerId: studentId,
      classroomId: 'classroom-1',
      occurredAt,
      pseudonymSecret,
    })

    await createClassroomEnrollmentWithPalEvent({
      supabase,
      classroomId: 'classroom-1',
      studentId,
      event,
    })

    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_classroom_enrollment_with_pal_event_atomic',
      expect.objectContaining({ p_pal_event: event }),
    )
  })

  it('saves the log and learner/date completion fact in one RPC', async () => {
    const supabase = clientFor({
      ok: true,
      created: false,
      entry: { id: 'entry-1' },
    })
    const event = buildDailyLogCompletedEvent({
      learnerId: studentId,
      activityDay: '2026-09-16',
      occurredAt,
      pseudonymSecret,
    })

    await upsertStudentEntryWithPalEvent({
      supabase,
      studentId,
      classroomId: 'classroom-1',
      date: '2026-09-16',
      text: 'Reflection',
      richContent: { type: 'doc', content: [] },
      onTime: true,
      expectedVersion: 4,
      event,
    })

    expect(supabase.rpc).toHaveBeenCalledWith(
      'upsert_student_entry_with_pal_event_atomic',
      expect.objectContaining({
        p_expected_version: 4,
        p_pal_event: event,
      }),
    )
  })

  it('creates the first assignment doc and first-view fact in one RPC', async () => {
    const supabase = clientFor({
      ok: true,
      created: true,
      doc: { id: 'doc-1' },
    })
    const event = buildLearningItemViewedEvent({
      learnerId: studentId,
      itemId: 'assignment-1',
      releasedAt: '2026-09-16T12:00:00.000Z',
      occurredAt,
      pseudonymSecret,
    })

    await createAssignmentDocWithPalEvent({
      supabase,
      assignmentId: 'assignment-1',
      studentId,
      viewedAt: occurredAt.toISOString(),
      event,
    })

    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_assignment_doc_with_pal_event_atomic',
      expect.objectContaining({ p_pal_event: event }),
    )
  })
})
