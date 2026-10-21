import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BaraAttendanceClientError } from '@/lib/server/bara-attendance-client'
import {
  deriveStudentAttendanceOccurrenceBinding,
  deriveStudentAttendanceMembershipOccurrenceBinding,
  sealAttendanceEntryToken,
} from '@/lib/server/bara-attendance-entry-token'
import {
  executeStudentAttendanceCheckIn,
  resolveVerifiedPikaAttendanceStudent,
  StudentAttendanceCheckInError,
} from '@/lib/server/bara-attendance-student'
import { BaraAttendanceCanaryError } from '@/lib/server/bara-attendance-canary'

const { withAuth } = vi.hoisted(() => ({ withAuth: vi.fn() }))
const { resolveGeneration, resolveMembershipGeneration } = vi.hoisted(() => ({ resolveGeneration: vi.fn(), resolveMembershipGeneration: vi.fn() }))
vi.mock('@workos-inc/authkit-nextjs', () => ({ withAuth }))
vi.mock('@/lib/server/attendance-generation', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server/attendance-generation')>(),
  resolveAttendanceScanGeneration: resolveGeneration,
  resolveAttendanceMembershipScanGeneration: resolveMembershipGeneration,
}))

const entrySecret = 'entry-token-secret-that-is-long-enough-for-tests'
const studentId = '30000000-0000-4000-8000-000000000001'
const pikaUser = { id: studentId, email: 'student@example.com', role: 'student' }
const actor = { principalRef: 'principal_student_one', displayName: 'Student One' }
const attemptId = '11111111-1111-4111-8111-111111111111'
const classroomId = '20000000-0000-4000-8000-000000000002'
const classroomName = 'PPZ3C — Health for Life'
const classroomRead = vi.fn()
const occurrenceRead = vi.fn()
const supabase = {
  from: vi.fn((table: string) => {
    const query: any = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: table === 'classrooms' ? classroomRead : occurrenceRead,
    }
    return query
  }),
}

function entryToken() {
  return sealAttendanceEntryToken({
    classroomId,
    rosterRef: 'roster_one',
    occurrenceRef: 'occurrence_one',
    checkInToken: 'check_in_token_1234567890',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }, { secret: entrySecret })
}

describe('native Pika student attendance check-in', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-02T13:02:00.000Z'))
    occurrenceRead.mockResolvedValue({ data: { class_date: '2026-09-02', present_through_at: '2026-09-02T13:05:00.000Z' }, error: null })
    classroomRead.mockResolvedValue({ data: { title: classroomName }, error: null })
    resolveGeneration.mockReset().mockResolvedValue({ status: 'legacy' })
    resolveMembershipGeneration.mockReset()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    vi.stubEnv('BARA_ATTENDANCE_ENTRY_TOKEN_SECRET', entrySecret)
    vi.stubEnv('BARA_ATTENDANCE_INSTALLATION_REF', 'pika_test')
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

  const membership = { status: 'active', generation_id: attemptId, participant_ref: `participant_${'a'.repeat(32)}` }
  function admit() {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [studentId] }))
    vi.stubEnv('STUDENT_PROVIDER_CLEANUP_ENABLED', 'false')
    resolveMembershipGeneration.mockResolvedValue(membership)
  }
  function accepted(participantRef = membership.participant_ref) {
    return { outcome: 'applied', resultCode: 'check_in_accepted', occurrenceRef: 'occurrence_one', sessionRevision: 1,
      checkIn: { checkInRef: 'check_in_one', participantRef, checkInRevision: 1, acceptedAt: '2026-09-02T13:01:00.000Z' } }
  }

  it.each(['student', 'teacher'])('binds admitted %s scans to exact membership with cleanup paused', async role => {
    admit()
    const send = vi.fn().mockResolvedValue(accepted())
    const result = await executeStudentAttendanceCheckIn({ supabase, pikaUser: { ...pikaUser, role },
      entryToken: entryToken(), attemptId, integrationState: 'ready', resolveActor: vi.fn().mockResolvedValue(actor), send })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ participant_ref: membership.participant_ref }))
    expect(resolveGeneration).not.toHaveBeenCalled()
    expect(resolveMembershipGeneration).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({ state: 'checked_in', occurrenceBinding: deriveStudentAttendanceMembershipOccurrenceBinding({
      studentId, classroomId, occurrenceRef: 'occurrence_one', generationId: membership.generation_id, participantRef: membership.participant_ref,
    }) })
  })

  it('keeps unadmitted scans on the legacy resolver', async () => {
    await executeStudentAttendanceCheckIn({ supabase, pikaUser, entryToken: entryToken(), attemptId,
      integrationState: 'ready', resolveActor: vi.fn().mockResolvedValue(actor), send: vi.fn().mockResolvedValue(accepted()) })
    expect(resolveMembershipGeneration).not.toHaveBeenCalled()
    expect(resolveGeneration).toHaveBeenCalled()
  })

  it.each(['student', 'teacher'])('does not dispatch an occurrence scan for an admitted self-enrolled %s owner denied by the strict RPC', async role => {
    admit()
    const actual = await vi.importActual<typeof import('@/lib/server/attendance-generation')>('@/lib/server/attendance-generation')
    resolveMembershipGeneration.mockImplementation(actual.resolveAttendanceMembershipScanGeneration)
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'forbidden' }, error: null })
    const send = vi.fn()
    const result = await executeStudentAttendanceCheckIn({ supabase: { ...supabase, rpc },
      pikaUser: { ...pikaUser, role }, entryToken: entryToken(), attemptId,
      integrationState: 'ready', resolveActor: vi.fn().mockResolvedValue(actor), send })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('resolve_attendance_membership_scan_generation', {
      p_classroom_id: classroomId, p_student_id: studentId,
    })
    expect(resolveGeneration).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(result).toMatchObject({ state: 'needs_staff' })
    expect(result).not.toHaveProperty('occurrenceBinding')
    expect(result).not.toHaveProperty('checkedInAt')
  })

  it.each(['before-send', 'retry', 'response'])('rejects admitted membership removed %s', async gap => {
    admit()
    resolveMembershipGeneration.mockReset().mockResolvedValueOnce(membership)
    if (gap !== 'before-send') resolveMembershipGeneration.mockResolvedValueOnce(membership)
    resolveMembershipGeneration.mockResolvedValue({ status: 'forbidden' })
    const send = gap === 'retry'
      ? vi.fn().mockRejectedValue(new BaraAttendanceClientError('timeout', 'network_error', true))
      : vi.fn().mockResolvedValue(accepted())
    const result = await executeStudentAttendanceCheckIn({ supabase, pikaUser, entryToken: entryToken(), attemptId,
      integrationState: 'ready', resolveActor: vi.fn().mockResolvedValue(actor), send })
    expect(result).toMatchObject({ state: 'needs_staff' })
    expect(result).not.toHaveProperty('occurrenceBinding')
    expect(send).toHaveBeenCalledTimes(gap === 'before-send' ? 0 : 1)
  })

  it('fails closed on missing strict membership schema without legacy fallback', async () => {
    admit()
    const { resolveAttendanceMembershipScanGeneration } = await vi.importActual<typeof import('@/lib/server/attendance-generation')>('@/lib/server/attendance-generation')
    resolveMembershipGeneration.mockImplementation(resolveAttendanceMembershipScanGeneration)
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'resolve_attendance_membership_scan_generation' } })
    const send = vi.fn()
    await expect(executeStudentAttendanceCheckIn({ supabase: { ...supabase, rpc }, pikaUser,
      entryToken: entryToken(), attemptId, integrationState: 'ready', resolveActor: vi.fn().mockResolvedValue(actor), send }))
      .rejects.toEqual(new StudentAttendanceCheckInError('upstream_unavailable'))
    expect(rpc).toHaveBeenCalledWith('resolve_attendance_membership_scan_generation', { p_classroom_id: classroomId, p_student_id: studentId })
    expect(send).not.toHaveBeenCalled()
    expect(resolveGeneration).not.toHaveBeenCalled()
  })

  it('rejects a provider echo from another participant even with cleanup paused', async () => {
    admit()
    await expect(executeStudentAttendanceCheckIn({ supabase, pikaUser, entryToken: entryToken(), attemptId,
      integrationState: 'ready', resolveActor: vi.fn().mockResolvedValue(actor), send: vi.fn().mockResolvedValue(accepted('participant_wrong')) }))
      .rejects.toEqual(new StudentAttendanceCheckInError('upstream_unavailable'))
  })

  it('changes command identity for a replacement admitted generation with the same attempt', async () => {
    admit()
    const send = vi.fn().mockImplementation(async payload => accepted(payload.participant_ref))
    const input = { supabase, pikaUser, entryToken: entryToken(), attemptId,
      integrationState: 'ready' as const, resolveActor: vi.fn().mockResolvedValue(actor), send }
    await executeStudentAttendanceCheckIn(input)
    resolveMembershipGeneration.mockResolvedValue({ ...membership, generation_id: '22222222-2222-4222-8222-222222222222' })
    await executeStudentAttendanceCheckIn(input)
    expect(send.mock.calls[0][0].idempotency_key).not.toBe(send.mock.calls[1][0].idempotency_key)
  })

  it('does not accept a legacy active mapping as proof of current admitted membership', async () => {
    admit()
    resolveGeneration.mockResolvedValue(membership)
    resolveMembershipGeneration.mockResolvedValue({ status: 'forbidden' })
    const send = vi.fn()
    await expect(executeStudentAttendanceCheckIn({ supabase, pikaUser, entryToken: entryToken(), attemptId,
      integrationState: 'ready', resolveActor: vi.fn().mockResolvedValue(actor), send })).resolves.toMatchObject({ state: 'needs_staff' })
    expect(send).not.toHaveBeenCalled()
    expect(resolveGeneration).not.toHaveBeenCalled()
  })

  it('retries an admitted timeout with the identical membership command', async () => {
    admit()
    const send = vi.fn().mockRejectedValueOnce(new BaraAttendanceClientError('timeout', 'network_error', true))
      .mockResolvedValueOnce(accepted())
    await expect(executeStudentAttendanceCheckIn({ supabase, pikaUser, entryToken: entryToken(), attemptId,
      integrationState: 'ready', resolveActor: vi.fn().mockResolvedValue(actor), send })).resolves.toMatchObject({ state: 'checked_in' })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0])
    expect(resolveMembershipGeneration).toHaveBeenCalledTimes(4)
  })

  it.each(['before-send', 'response'])('rejects an active replacement generation %s', async gap => {
    admit()
    resolveMembershipGeneration.mockReset().mockResolvedValueOnce(membership)
    if (gap === 'response') resolveMembershipGeneration.mockResolvedValueOnce(membership)
    resolveMembershipGeneration.mockResolvedValue({ ...membership, generation_id: classroomId })
    const send = vi.fn().mockResolvedValue(accepted())
    await expect(executeStudentAttendanceCheckIn({ supabase, pikaUser, entryToken: entryToken(), attemptId,
      integrationState: 'ready', resolveActor: vi.fn().mockResolvedValue(actor), send })).resolves.toMatchObject({ state: 'needs_staff' })
    expect(send).toHaveBeenCalledTimes(gap === 'before-send' ? 0 : 1)
  })

  it.each(['student', 'teacher'])('requires exact verified identity for an admitted %s label', async role => {
    admit()
    const current = { ...pikaUser, role }
    const workos = { id: 'user_student_one', email: current.email, emailVerified: true }
    const userRow = { role, email: current.email, workos_user_id: workos.id }
    const rows: Record<string, unknown> = {
      users: userRow,
      student_profiles: { first_name: 'Student', last_name: 'One' },
      attendance_principal_mappings: { principal_ref: actor.principalRef },
    }
    const database = { from: vi.fn((table: string) => {
      const query: any = { select: vi.fn(() => query), eq: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({ data: rows[table], error: null })) }
      return query
    }) }
    withAuth.mockResolvedValue({ user: workos })
    await expect(resolveVerifiedPikaAttendanceStudent({ supabase: database, pikaUser: current })).resolves.toEqual(actor)

    for (const altered of [
      { ...userRow, role: role === 'teacher' ? 'student' : 'teacher' },
      { ...userRow, email: 'other@example.com' },
      { ...userRow, workos_user_id: 'user_other' },
    ]) {
      rows.users = altered
      await expect(resolveVerifiedPikaAttendanceStudent({ supabase: database, pikaUser: current }))
        .rejects.toEqual(new StudentAttendanceCheckInError('identity_not_linked'))
    }
    rows.users = userRow
    for (const altered of [{ ...workos, emailVerified: false }, { ...workos, email: 'other@example.com' }, { ...workos, id: 'user_other' }]) {
      withAuth.mockResolvedValue({ user: altered })
      await expect(resolveVerifiedPikaAttendanceStudent({ supabase: database, pikaUser: current }))
        .rejects.toEqual(new StudentAttendanceCheckInError('identity_not_linked'))
    }
  })

  it('does not verify a teacher label as a learner when admission is absent', async () => {
    withAuth.mockResolvedValue({ user: { id: 'user_student_one', email: pikaUser.email, emailVerified: true } })
    const database = { from: vi.fn() }
    await expect(resolveVerifiedPikaAttendanceStudent({ supabase: database, pikaUser: { ...pikaUser, role: 'teacher' } }))
      .rejects.toEqual(new StudentAttendanceCheckInError('identity_not_linked'))
    expect(database.from).not.toHaveBeenCalled()
  })

  it('uses the exact current participant on enabled scans and checks the same generation after the response', async () => {
    vi.stubEnv('STUDENT_PROVIDER_CLEANUP_ENABLED', 'true')
    const generation = { status: 'active', generation_id: attemptId, participant_ref: `participant_${'a'.repeat(32)}` }
    resolveGeneration.mockResolvedValue(generation)
    const send = vi.fn().mockResolvedValue({ outcome: 'no_op', resultCode: 'not_authorized',
      occurrenceRef: 'occurrence_one', sessionRevision: 1 })
    await executeStudentAttendanceCheckIn({ supabase, pikaUser, entryToken: entryToken(), attemptId,
      integrationState: 'ready', resolveActor: vi.fn().mockResolvedValue(actor), send })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ participant_ref: generation.participant_ref }))
    expect(resolveGeneration).toHaveBeenCalledTimes(2)
    expect(resolveGeneration).toHaveBeenLastCalledWith({ supabase, classroomId, studentId })
  })

  it('still rejects removed membership when the new rollout gate is paused', async () => {
    vi.stubEnv('STUDENT_PROVIDER_CLEANUP_ENABLED', 'false')
    resolveGeneration.mockResolvedValue({ status: 'forbidden' })
    const send = vi.fn()
    await expect(executeStudentAttendanceCheckIn({ supabase, pikaUser, entryToken: entryToken(), attemptId,
      integrationState: 'ready', resolveActor: vi.fn().mockResolvedValue(actor), send })).resolves.toMatchObject({ state: 'needs_staff' })
    expect(send).not.toHaveBeenCalled()
    expect(classroomRead).not.toHaveBeenCalled()
  })

  it.each(['retry', 'response'] as const)('discards a removed generation during the %s gap', async gap => {
    resolveGeneration.mockResolvedValueOnce({ status: 'active', generation_id: attemptId,
      participant_ref: `participant_${'a'.repeat(32)}` }).mockResolvedValue({ status: 'forbidden' })
    const send = vi.fn()
    if (gap === 'retry') send.mockRejectedValueOnce(new BaraAttendanceClientError('timeout', 'network_error', true))
    else send.mockResolvedValue({ outcome: 'applied', resultCode: 'check_in_accepted',
      occurrenceRef: 'occurrence_one', sessionRevision: 1,
      checkIn: { checkInRef: 'check_in_one', participantRef: 'participant_one', checkInRevision: 1,
        acceptedAt: '2026-09-02T13:01:00.000Z' } })
    const result = await executeStudentAttendanceCheckIn({ supabase, pikaUser, entryToken: entryToken(), attemptId,
      integrationState: 'ready', resolveActor: vi.fn().mockResolvedValue(actor), send,
      loadOccurrenceMetadata: vi.fn().mockResolvedValue({ classDate: '2026-09-02', presentThroughAt: '2026-09-02T13:05:00.000Z' }) })
    expect(result).toMatchObject({ state: 'needs_staff' })
    expect(result).not.toHaveProperty('recordedAt')
    expect(result).not.toHaveProperty('classroomName')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('does not send a check-in when the classroom name cannot be loaded', async () => {
    classroomRead.mockResolvedValue({ data: null, error: { message: 'read unavailable' } })
    const send = vi.fn()
    await expect(executeStudentAttendanceCheckIn({ supabase, pikaUser,
      entryToken: entryToken(), attemptId, integrationState: 'ready',
      resolveActor: vi.fn().mockResolvedValue(actor), send,
    })).rejects.toEqual(new StudentAttendanceCheckInError('upstream_unavailable'))
    expect(send).not.toHaveBeenCalled()
  })

  it.each(['Health and Wellness '.repeat(20), ' '])('accepts a stored classroom title without imposing new naming rules', async title => {
    classroomRead.mockResolvedValue({ data: { title }, error: null })
    const send = vi.fn().mockResolvedValue({
      outcome: 'applied', resultCode: 'check_in_accepted',
      occurrenceRef: 'occurrence_one', sessionRevision: 1,
      checkIn: { checkInRef: 'check_in_one', participantRef: 'participant_one', checkInRevision: 1, acceptedAt: '2026-09-02T13:01:00.000Z' },
    })
    await expect(executeStudentAttendanceCheckIn({ supabase, pikaUser,
      entryToken: entryToken(), attemptId, integrationState: 'ready',
      resolveActor: vi.fn().mockResolvedValue(actor), send,
    })).resolves.toMatchObject({ state: 'checked_in', classroomName: title })
    expect(send).toHaveBeenCalledTimes(1)
  })


  it.each([
    ['2026-09-02', '2026-09-03T03:30:00.000Z', '2026-09-03T04:00:00.000Z'],
    ['2026-03-08', '2026-03-08T07:30:00.000Z', '2026-03-09T04:00:00.000Z'],
    ['2026-11-01', '2026-11-01T07:30:00.000Z', '2026-11-02T05:00:00.000Z'],
  ])('returns Toronto date %s and its DST-safe midnight', async (classDate, serverNow, validUntil) => {
    vi.setSystemTime(new Date(serverNow))
    occurrenceRead.mockResolvedValue({ data: { class_date: classDate, present_through_at: serverNow }, error: null })
    const result = await executeStudentAttendanceCheckIn({ supabase, pikaUser, entryToken: entryToken(), attemptId,
      integrationState: 'ready', resolveActor: vi.fn().mockResolvedValue(actor),
      send: vi.fn().mockResolvedValue({ outcome: 'applied', resultCode: 'check_in_accepted', occurrenceRef: 'occurrence_one', sessionRevision: 1,
        checkIn: { checkInRef: 'check_in_one', participantRef: 'participant_one', checkInRevision: 1, acceptedAt: serverNow } }) })
    expect(result).toMatchObject({ state: 'checked_in', classDate, serverNow, validUntil })
  })

  it('does not send when occurrence metadata is unavailable', async () => {
    occurrenceRead.mockResolvedValue({ data: null, error: { message: 'unavailable' } })
    const send = vi.fn()
    await expect(executeStudentAttendanceCheckIn({ supabase, pikaUser, entryToken: entryToken(), attemptId,
      integrationState: 'ready', resolveActor: vi.fn().mockResolvedValue(actor), send }))
      .rejects.toEqual(new StudentAttendanceCheckInError('upstream_unavailable'))
    expect(send).not.toHaveBeenCalled()
  })

  it.each(['missing_record', 'different_occurrence'])('does not confirm a success with %s', async invalid => {
    const result = await executeStudentAttendanceCheckIn({ supabase, pikaUser, entryToken: entryToken(), attemptId,
      integrationState: 'ready', resolveActor: vi.fn().mockResolvedValue(actor),
      send: vi.fn().mockResolvedValue({ outcome: 'applied', resultCode: 'check_in_accepted',
        occurrenceRef: invalid === 'different_occurrence' ? 'occurrence_other' : 'occurrence_one', sessionRevision: 1,
        ...(invalid === 'missing_record' ? {} : { checkIn: { checkInRef: 'check_in_one', participantRef: 'participant_one', checkInRevision: 1, acceptedAt: '2026-09-02T13:01:00.000Z' } }) }) })
    expect(result.state).toBe('closed')
    expect(result).not.toHaveProperty('recordedAt')
  })

  it('refuses yesterday occurrence before sending even when its QR entry has not expired', async () => {
    occurrenceRead.mockResolvedValue({ data: { class_date: '2026-09-01', present_through_at: '2026-09-01T13:05:00.000Z' }, error: null })
    const send = vi.fn()
    const result = await executeStudentAttendanceCheckIn({ supabase, pikaUser, entryToken: entryToken(), attemptId,
      integrationState: 'ready', resolveActor: vi.fn().mockResolvedValue(actor), send })
    expect(result.state).toBe('closed')
    expect(result).not.toHaveProperty('recordedAt')
    expect(send).not.toHaveBeenCalled()
  })

  it.each(['check_in_accepted', 'already_checked_in'] as const)('does not confirm %s with an older accepted event', async resultCode => {
    const result = await executeStudentAttendanceCheckIn({ supabase, pikaUser, entryToken: entryToken(), attemptId,
      integrationState: 'ready', resolveActor: vi.fn().mockResolvedValue(actor),
      send: vi.fn().mockResolvedValue({ outcome: 'duplicate', resultCode, occurrenceRef: 'occurrence_one', sessionRevision: 1,
        checkIn: { checkInRef: 'check_in_old', participantRef: 'participant_one', checkInRevision: 1, acceptedAt: '2026-09-01T13:01:00.000Z' } }) })
    expect(result.state).toBe('closed')
    expect(result).not.toHaveProperty('recordedAt')
  })

  it('rechecks Toronto today after the command crosses midnight', async () => {
    vi.setSystemTime(new Date('2026-09-03T03:59:59.000Z'))
    const result = await executeStudentAttendanceCheckIn({ supabase, pikaUser, entryToken: entryToken(), attemptId,
      integrationState: 'ready', resolveActor: vi.fn().mockResolvedValue(actor),
      send: vi.fn().mockImplementation(async () => {
        vi.setSystemTime(new Date('2026-09-03T04:00:00.000Z'))
        return { outcome: 'duplicate', resultCode: 'already_checked_in', occurrenceRef: 'occurrence_one', sessionRevision: 1,
          checkIn: { checkInRef: 'check_in_old', participantRef: 'participant_one', checkInRevision: 1, acceptedAt: '2026-09-02T13:01:00.000Z' } }
      }) })
    expect(result.state).toBe('closed')
  })

  it('maps the verified local WorkOS link to an opaque Pika principal', async () => {
    withAuth.mockResolvedValue({
      user: {
        id: 'user_student_one',
        email: 'student@example.com',
        emailVerified: true,
      },
    })
    const rows: Record<string, unknown> = {
      users: {
        email: 'student@example.com',
        role: 'student',
        workos_user_id: 'user_student_one',
      },
      student_profiles: { first_name: 'Student', last_name: 'One' },
      attendance_principal_mappings: { principal_ref: 'principal_student_one' },
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

    await expect(resolveVerifiedPikaAttendanceStudent({
      supabase,
      pikaUser,
    })).resolves.toEqual(actor)
  })

  it('derives a stable command from the verified server actor and returns Bara synchronously', async () => {
    const resolveActor = vi.fn().mockResolvedValue(actor)
    const send = vi.fn().mockResolvedValue({
      outcome: 'applied',
      resultCode: 'check_in_accepted',
      occurrenceRef: 'occurrence_one',
      sessionRevision: 2,
      checkIn: {
        checkInRef: 'check_in_one',
        participantRef: 'participant_one',
        checkInRevision: 1,
        acceptedAt: '2026-09-02T13:01:00.000Z',
      },
    })

    const result = await executeStudentAttendanceCheckIn({
      supabase,
      pikaUser,
      entryToken: entryToken(),
      attemptId,
      integrationState: 'ready',
      resolveActor,
      send,
      loadOccurrenceMetadata: vi.fn().mockResolvedValue({ classDate: '2026-09-02', presentThroughAt: '2026-09-02T13:05:00.000Z' }),
    })

    expect(resolveActor).toHaveBeenCalledWith({ supabase, pikaUser })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      schema_version: 1,
      message_type: 'student_check_in',
      installation_ref: 'pika_test',
      roster_ref: 'roster_one',
      occurrence_ref: 'occurrence_one',
      check_in_token: 'check_in_token_1234567890',
      actor_principal_ref: 'principal_student_one',
      actor_display_name: 'Student One',
      idempotency_key: expect.stringMatching(/^student-check-in:occurrence_one:[a-f0-9]{40}$/),
    }))
    expect(result).toEqual({
      state: 'checked_in',
      title: 'You are checked in',
      description: 'Your attendance was recorded.',
      attendanceStatus: 'present',
      recordedAt: '2026-09-02T13:01:00.000Z',
      classDate: '2026-09-02',
      serverNow: '2026-09-02T13:02:00.000Z',
      validUntil: '2026-09-03T04:00:00.000Z',
      classroomId,
      classroomName,
      studentId,
      occurrenceBinding: deriveStudentAttendanceOccurrenceBinding({
        studentId,
        occurrenceRef: 'occurrence_one',
        secret: entrySecret,
      }),
    })
  })

  it('retries an uncertain outcome once with the identical idempotency key', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new BaraAttendanceClientError('timeout', 'network_error', true))
      .mockResolvedValueOnce({
        outcome: 'duplicate',
        resultCode: 'already_checked_in',
        occurrenceRef: 'occurrence_one',
        sessionRevision: 2,
        checkIn: { checkInRef: 'check_in_one', participantRef: 'participant_one', checkInRevision: 1, acceptedAt: '2026-09-02T13:01:00.000Z' },
      })

    await expect(executeStudentAttendanceCheckIn({
      supabase,
      pikaUser,
      entryToken: entryToken(),
      attemptId,
      integrationState: 'ready',
      resolveActor: vi.fn().mockResolvedValue(actor),
      send,
    })).resolves.toMatchObject({ state: 'already_checked_in', classroomId, classroomName })

    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0])
  })

  it('uses a new idempotency key for each independent scan attempt', async () => {
    const send = vi.fn().mockResolvedValue({
      outcome: 'duplicate',
      resultCode: 'already_checked_in',
      occurrenceRef: 'occurrence_one',
      sessionRevision: 2,
    })
    for (const logicalAttempt of [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]) {
      await executeStudentAttendanceCheckIn({
        supabase,
        pikaUser,
        entryToken: entryToken(),
        attemptId: logicalAttempt,
        integrationState: 'ready',
        resolveActor: vi.fn().mockResolvedValue(actor),
        send,
      })
    }

    expect(send.mock.calls[0][0].idempotency_key)
      .not.toBe(send.mock.calls[1][0].idempotency_key)
  })

  it('does not retry a closed transport rejection or expose it as success', async () => {
    const send = vi.fn().mockRejectedValue(
      new BaraAttendanceClientError('rejected', 'invalid_payload', false),
    )

    await expect(executeStudentAttendanceCheckIn({
      supabase,
      pikaUser,
      entryToken: entryToken(),
      attemptId,
      integrationState: 'ready',
      resolveActor: vi.fn().mockResolvedValue(actor),
      send,
    })).rejects.toEqual(new StudentAttendanceCheckInError('upstream_unavailable'))
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('does not resolve an actor or send when the public entry token is invalid', async () => {
    const resolveActor = vi.fn()
    const send = vi.fn()
    await expect(executeStudentAttendanceCheckIn({
      supabase,
      pikaUser,
      entryToken: 'invalid',
      attemptId,
      integrationState: 'ready',
      resolveActor,
      send,
    })).rejects.toEqual(new StudentAttendanceCheckInError('invalid_entry'))
    expect(resolveActor).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('does not resolve a student or call Bara for a non-canary classroom token', async () => {
    vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED', 'true')
    vi.stubEnv('BARA_ATTENDANCE_API_BASE_URL', 'https://attendance-api.example')
    vi.stubEnv('BARA_ATTENDANCE_INTEGRATION_SECRET', 'integration-secret-with-at-least-32-characters')
    vi.stubEnv('PIKA_BARA_ATTENDANCE_CANARY_TEACHER_ID', '10000000-0000-4000-8000-000000000001')
    vi.stubEnv('PIKA_BARA_ATTENDANCE_CANARY_CLASSROOM_ID', '30000000-0000-4000-8000-000000000003')
    const resolveActor = vi.fn()
    const send = vi.fn()

    await expect(executeStudentAttendanceCheckIn({
      supabase,
      pikaUser,
      entryToken: entryToken(),
      attemptId,
      resolveActor,
      send,
    })).rejects.toEqual(new StudentAttendanceCheckInError('disabled'))
    expect(resolveActor).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects a transferred canary classroom before resolving the student', async () => {
    vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED', 'true')
    vi.stubEnv('BARA_ATTENDANCE_API_BASE_URL', 'https://attendance-api.example')
    vi.stubEnv('BARA_ATTENDANCE_INTEGRATION_SECRET', 'integration-secret-with-at-least-32-characters')
    vi.stubEnv('PIKA_BARA_ATTENDANCE_CANARY_TEACHER_ID', '10000000-0000-4000-8000-000000000001')
    vi.stubEnv('PIKA_BARA_ATTENDANCE_CANARY_CLASSROOM_ID', classroomId)
    const resolveActor = vi.fn()
    const send = vi.fn()
    const verifyCanaryClassroom = vi.fn().mockRejectedValue(
      new BaraAttendanceCanaryError('disabled'),
    )

    await expect(executeStudentAttendanceCheckIn({
      supabase,
      pikaUser,
      entryToken: entryToken(),
      attemptId,
      resolveActor,
      send,
      verifyCanaryClassroom,
    })).rejects.toEqual(new StudentAttendanceCheckInError('disabled'))
    expect(resolveActor).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it.each([
    ['session_not_accepting', 'closed'],
    ['invalid_check_in_token', 'invalid'],
    ['not_on_roster', 'needs_staff'],
  ] as const)('maps %s to a native %s state', async (resultCode, state) => {
    await expect(executeStudentAttendanceCheckIn({
      supabase,
      pikaUser,
      entryToken: entryToken(),
      attemptId,
      integrationState: 'ready',
      resolveActor: vi.fn().mockResolvedValue(actor),
      send: vi.fn().mockResolvedValue({
        outcome: 'rejected',
        resultCode,
        occurrenceRef: 'occurrence_one',
        sessionRevision: 2,
      }),
    })).resolves.toMatchObject({ state })
  })
})
