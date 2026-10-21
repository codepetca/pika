import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sealAttendanceEntryToken } from '@/lib/server/bara-attendance-entry-token'

const mocks = vi.hoisted(() => ({ generation: vi.fn(), membershipGeneration: vi.fn(), classroomId: vi.fn() }))
vi.mock('@/lib/server/attendance-generation', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server/attendance-generation')>(),
  resolveAttendanceScanGeneration: mocks.generation,
  resolveAttendanceMembershipScanGeneration: mocks.membershipGeneration,
}))
vi.mock('@/lib/server/classroom-attendance-qr', () => ({
  resolveClassroomAttendanceQrId: mocks.classroomId,
}))
import { loadStudentAttendanceEntryClassroomName } from '@/lib/server/student-attendance-entry-context'

const classroomId = '20000000-0000-4000-8000-000000000002'
const studentId = '30000000-0000-4000-8000-000000000001'
const secret = 'entry-display-context-secret-with-at-least-32-characters'
const pikaUser = { id: studentId, role: 'student' }
const membershipRead = vi.fn()
const filters: Record<string, string> = {}
const supabase = {
  from: vi.fn((table: string) => {
    expect(table).toBe('classroom_enrollments')
    const query = {
      select: vi.fn((selection: string) => {
        expect(selection).toBe('classrooms(title)')
        return query
      }),
      eq: vi.fn((column: string, value: string) => { filters[column] = value; return query }),
      maybeSingle: membershipRead,
    }
    return query
  }),
} as unknown as Parameters<typeof loadStudentAttendanceEntryClassroomName>[0]['supabase']

function entryToken(expiresAt = new Date(Date.now() + 60_000).toISOString()) {
  return sealAttendanceEntryToken({ classroomId, rosterRef: 'roster_one',
    occurrenceRef: 'occurrence_one', checkInToken: 'check_in_token_1234567890', expiresAt }, { secret })
}

describe('attendance entry classroom display context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('BARA_ATTENDANCE_ENTRY_TOKEN_SECRET', secret)
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    mocks.generation.mockReset().mockResolvedValue({ status: 'legacy' })
    mocks.membershipGeneration.mockReset().mockResolvedValue({ status: 'active',
      generation_id: '40000000-0000-4000-8000-000000000001', participant_ref: `participant_${'a'.repeat(32)}` })
    mocks.classroomId.mockReset().mockResolvedValue(classroomId)
    membershipRead.mockReset().mockResolvedValue({ data: { classrooms: { title: 'Health for Life' } }, error: null })
    for (const key of Object.keys(filters)) delete filters[key]
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each(['student', 'teacher'])('uses and rechecks strict current membership for an admitted %s label', async role => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [studentId] }))
    expect(await loadStudentAttendanceEntryClassroomName({ supabase, pikaUser: { ...pikaUser, role }, entryToken: entryToken() }))
      .toBe('Health for Life')
    expect(mocks.membershipGeneration).toHaveBeenCalledTimes(2)
    expect(mocks.membershipGeneration).toHaveBeenCalledWith({ supabase, classroomId, studentId })
    expect(mocks.generation).not.toHaveBeenCalled()
    expect(filters).toEqual({ classroom_id: classroomId, student_id: studentId })
  })

  it.each(['occurrence', 'classroom'] as const)('withholds %s title when current membership changes during its read', async mode => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [studentId] }))
    mocks.membershipGeneration.mockResolvedValueOnce({ status: 'active',
      generation_id: '40000000-0000-4000-8000-000000000001', participant_ref: `participant_${'a'.repeat(32)}` })
      .mockResolvedValue({ status: 'active', generation_id: '40000000-0000-4000-8000-000000000002', participant_ref: `participant_${'b'.repeat(32)}` })
    expect(await loadStudentAttendanceEntryClassroomName({ supabase, pikaUser, mode,
      entryToken: mode === 'classroom' ? 'a'.repeat(43) : entryToken() })).toBeUndefined()
    expect(mocks.membershipGeneration).toHaveBeenCalledTimes(2)
  })

  it.each(['forbidden', 'unavailable'])('discloses no title when admitted membership is %s', async state => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [studentId] }))
    if (state === 'forbidden') mocks.membershipGeneration.mockResolvedValue({ status: 'forbidden' })
    else mocks.membershipGeneration.mockRejectedValue(new Error('missing membership resolver'))
    expect(await loadStudentAttendanceEntryClassroomName({ supabase, pikaUser, entryToken: entryToken() })).toBeUndefined()
    expect(membershipRead).not.toHaveBeenCalled()
    expect(mocks.generation).not.toHaveBeenCalled()
  })

  it('withholds admitted metadata for malformed admission or a missing enrollment', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{')
    expect(await loadStudentAttendanceEntryClassroomName({ supabase, pikaUser, entryToken: entryToken() })).toBeUndefined()
    expect(membershipRead).not.toHaveBeenCalled()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [studentId] }))
    membershipRead.mockResolvedValue({ data: null, error: null })
    expect(await loadStudentAttendanceEntryClassroomName({ supabase, pikaUser, entryToken: entryToken() })).toBeUndefined()
    expect(mocks.membershipGeneration).toHaveBeenCalledTimes(1)
  })

  it('loads only the signed-in student’s enrolled classroom for a verified occurrence token', async () => {
    expect(await loadStudentAttendanceEntryClassroomName({ supabase, pikaUser, entryToken: entryToken() }))
      .toBe('Health for Life')
    expect(filters).toEqual({ classroom_id: classroomId, student_id: studentId })
    expect(mocks.generation).toHaveBeenCalledTimes(2)
  })

  it('can label an expired occurrence without authorizing a check-in', async () => {
    expect(await loadStudentAttendanceEntryClassroomName({ supabase, pikaUser,
      entryToken: entryToken(new Date(Date.now() - 60_000).toISOString()),
    })).toBe('Health for Life')
  })

  it('uses the current verified classroom QR handle', async () => {
    expect(await loadStudentAttendanceEntryClassroomName({ supabase, pikaUser,
      entryToken: 'a'.repeat(43), mode: 'classroom',
    })).toBe('Health for Life')
    expect(mocks.classroomId).toHaveBeenCalledWith(supabase, 'a'.repeat(43))
  })

  it('does not expose a name for a revoked classroom QR or a tampered occurrence token', async () => {
    mocks.classroomId.mockRejectedValue(new Error('revoked'))
    expect(await loadStudentAttendanceEntryClassroomName({ supabase, pikaUser,
      entryToken: 'a'.repeat(43), mode: 'classroom',
    })).toBeUndefined()
    expect(await loadStudentAttendanceEntryClassroomName({ supabase, pikaUser, entryToken: 'invalid' })).toBeUndefined()
    expect(membershipRead).not.toHaveBeenCalled()
  })

  it('does not look up names for non-student accounts or forbidden membership', async () => {
    expect(await loadStudentAttendanceEntryClassroomName({ supabase,
      pikaUser: { id: studentId, role: 'teacher' }, entryToken: entryToken(),
    })).toBeUndefined()
    mocks.generation.mockResolvedValue({ status: 'forbidden' })
    expect(await loadStudentAttendanceEntryClassroomName({ supabase, pikaUser, entryToken: entryToken() })).toBeUndefined()
    expect(membershipRead).not.toHaveBeenCalled()
  })

  it.each([
    { data: null, error: null },
    { data: null, error: { message: 'unavailable' } },
  ])('keeps metadata unavailable for missing enrollment or database failure', async response => {
    membershipRead.mockResolvedValue(response)
    expect(await loadStudentAttendanceEntryClassroomName({ supabase, pikaUser, entryToken: entryToken() })).toBeUndefined()
  })

  it('discards a name when membership changes during the read', async () => {
    mocks.generation.mockResolvedValueOnce({ status: 'legacy' }).mockResolvedValue({ status: 'forbidden' })
    expect(await loadStudentAttendanceEntryClassroomName({ supabase, pikaUser, entryToken: entryToken() })).toBeUndefined()
  })
})
