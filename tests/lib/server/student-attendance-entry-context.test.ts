import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sealAttendanceEntryToken } from '@/lib/server/bara-attendance-entry-token'

const mocks = vi.hoisted(() => ({ generation: vi.fn(), classroomId: vi.fn() }))
vi.mock('@/lib/server/attendance-generation', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server/attendance-generation')>(),
  resolveAttendanceScanGeneration: mocks.generation,
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
    mocks.generation.mockReset().mockResolvedValue({ status: 'legacy' })
    mocks.classroomId.mockReset().mockResolvedValue(classroomId)
    membershipRead.mockReset().mockResolvedValue({ data: { classrooms: { title: 'Health for Life' } }, error: null })
    for (const key of Object.keys(filters)) delete filters[key]
  })
  afterEach(() => vi.unstubAllEnvs())

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
