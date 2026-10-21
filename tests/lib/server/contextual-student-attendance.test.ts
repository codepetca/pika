import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadContextualStudentAttendanceStatus } from '@/lib/server/contextual-student-attendance'
import { deriveStudentAttendanceMembershipOccurrenceBinding } from '@/lib/server/bara-attendance-entry-token'

const student = '30000000-0000-4000-8000-000000000001'
const classroom = '20000000-0000-4000-8000-000000000001'
const generation = '40000000-0000-4000-8000-000000000001'
const participant = `participant_${'a'.repeat(32)}`
const now = '2026-10-21T13:02:00.000Z'
const date = '2026-10-21'

function snapshot() {
  return { student_id: student, class_date: date, runtime_integration: 'ready',
    scope_mode: 'teacher_entitlements', installation_ref: 'pika_test', observed_at: now,
    classrooms: [{ classroom_id: classroom, generation_id: generation, participant_ref: participant,
      integration: 'ready', occurrence: { classroom_id: classroom, class_date: date,
        occurrence_ref: 'occurrence_one', opens_at: '2026-10-21T13:00:00.000Z',
        closes_at: '2026-10-21T14:00:00.000Z', present_through_at: '2026-10-21T13:05:00.000Z',
        absent_at: null, desired_state: 'scheduled' },
      session: { occurrence_ref: 'occurrence_one', status: 'open', opens_at: '2026-10-21T13:00:00.000Z', closes_at: '2026-10-21T14:00:00.000Z' },
      check_in: { classroom_id: classroom, occurrence_ref: 'occurrence_one', check_in_ref: 'check_in_one',
        check_in_revision: 1, accepted_at: '2026-10-21T13:01:00.000Z', invalidated_at: null },
      override: null }] }
}

function client(data: unknown = snapshot(), error: unknown = null) {
  const abortSignal = vi.fn().mockResolvedValue({ data, error, status: 200, statusText: 'OK', count: null })
  return { rpc: vi.fn().mockReturnValue({ abortSignal }), abortSignal }
}

describe('current-membership learner attendance status', () => {
  beforeEach(() => {
    vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED', 'true')
    vi.stubEnv('BARA_ATTENDANCE_API_BASE_URL', 'https://bara.example.test')
    vi.stubEnv('BARA_ATTENDANCE_INSTALLATION_REF', 'pika_test')
    vi.stubEnv('BARA_ATTENDANCE_INTEGRATION_SECRET', 's'.repeat(48))
    vi.stubEnv('BARA_ATTENDANCE_ENTRY_TOKEN_SECRET', 's'.repeat(48))
    vi.stubEnv('PIKA_BARA_ATTENDANCE_SCOPE_MODE', 'teacher_entitlements')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('uses one bounded snapshot and never exposes internal membership identifiers', async () => {
    const supabase = client()
    const result = await loadContextualStudentAttendanceStatus({ supabase: supabase as never, studentId: student, now: new Date(now) })
    expect(supabase.rpc).toHaveBeenCalledExactlyOnceWith('read_attendance_membership_status_v1', {
      p_student_id: student, p_class_date: date, p_runtime_integration: 'ready',
      p_scope_mode: 'teacher_entitlements', p_installation_ref: 'pika_test',
      p_canary_actor_id: null, p_canary_classroom_id: null,
    })
    expect(result.classrooms[0]).toMatchObject({ classroomId: classroom, state: 'confirmed', attendanceStatus: 'present',
      occurrenceBinding: deriveStudentAttendanceMembershipOccurrenceBinding({ studentId: student,
        classroomId: classroom, generationId: generation, participantRef: participant, occurrenceRef: 'occurrence_one' }) })
    expect(JSON.stringify(result)).not.toContain(generation)
    expect(JSON.stringify(result)).not.toContain(participant)
  })

  it('does not manufacture a confirmation when no attributed current evidence exists', async () => {
    const data = snapshot(); data.classrooms[0].check_in = null as never
    const result = await loadContextualStudentAttendanceStatus({ supabase: client(data) as never, studentId: student, now: new Date(now) })
    expect(result.classrooms[0].state).toBe('open')
  })

  it.each(['student', 'date', 'scope', 'installation', 'classroom', 'occurrence', 'missing-generation', 'unavailable-evidence', 'duplicate-classroom', 'future-clock', 'extra-field'])('rejects malformed or mismatched %s rather than falling back', async kind => {
    const data: any = snapshot()
    if (kind === 'student') data.student_id = classroom
    if (kind === 'date') data.class_date = '2026-10-20'
    if (kind === 'scope') data.scope_mode = 'exact_canary'
    if (kind === 'installation') data.installation_ref = 'other'
    if (kind === 'classroom') data.classrooms[0].check_in.classroom_id = student
    if (kind === 'occurrence') data.classrooms[0].session.occurrence_ref = 'other'
    if (kind === 'missing-generation') data.classrooms[0].generation_id = null
    if (kind === 'unavailable-evidence') data.classrooms[0].integration = 'disabled'
    if (kind === 'duplicate-classroom') data.classrooms.push(data.classrooms[0])
    if (kind === 'future-clock') data.observed_at = '2026-10-22T13:02:00.000Z'
    if (kind === 'extra-field') data.classrooms[0].private_identity = 'hidden'
    await expect(loadContextualStudentAttendanceStatus({ supabase: client(data) as never, studentId: student, now: new Date(now) })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('fails closed on absent schema, invalid RPC envelope or timeout', async () => {
    for (const supabase of [client(null, { code: 'PGRST202' }), client(null), { rpc: vi.fn().mockReturnValue({ abortSignal: vi.fn().mockRejectedValue(new Error('timeout')) }) }]) {
      await expect(loadContextualStudentAttendanceStatus({ supabase: supabase as never, studentId: student, now: new Date(now) })).rejects.toMatchObject({ statusCode: 503 })
    }
  })
})
