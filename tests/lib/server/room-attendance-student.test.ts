import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ candidates: vi.fn(), boundary: vi.fn(), access: vi.fn(), execute: vi.fn(), seal: vi.fn() }))
vi.mock('@/lib/server/bara-attendance-client', () => ({ postBaraRoomCommand: mocks.candidates }))
vi.mock('@/lib/server/classroom-attendance-qr', () => ({ assertStudentRosterBoundary: mocks.boundary, ClassroomAttendanceQrError: class extends Error { constructor(readonly code: string) { super(code) } } }))
vi.mock('@/lib/server/bara-attendance-scope', () => ({ getBaraAttendanceClassroomIdAccess: mocks.access }))
vi.mock('@/lib/server/bara-attendance-entry-token', () => ({ sealAttendanceEntryToken: mocks.seal }))
vi.mock('@/lib/server/bara-attendance-student', () => ({ executeStudentAttendanceCheckIn: mocks.execute }))
import { checkInRoom } from '@/lib/server/room-attendance-student'

const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const studentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const candidate = { roster_ref: 'roster_a', occurrence_ref: 'occurrence_a' }
const input = { supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { classroom_id: classroomId }, error: null }) }) }) }) },
  pikaUser: { id: studentId, email: 'student@example.com', role: 'student' }, roomId: 'room123456789012', continuation: 'a'.repeat(40), browserKey: 'b'.repeat(43), attemptId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }

describe('room student check-in', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.candidates.mockResolvedValue({ ok: true, candidates: [candidate] }); mocks.boundary.mockResolvedValue(undefined); mocks.access.mockResolvedValue({ state: 'ready' }); mocks.seal.mockReturnValue('sealed'); mocks.execute.mockResolvedValue({ state: 'checked_in' }) })
  it('deduplicates candidates and reuses the guarded attendance check-in', async () => {
    mocks.candidates.mockResolvedValue({ ok: true, candidates: [candidate, candidate] })
    await expect(checkInRoom(input)).resolves.toEqual([{ state: 'checked_in' }])
    expect(mocks.seal).toHaveBeenCalledWith(expect.objectContaining({ classroomId, rosterRef: candidate.roster_ref,
      occurrenceRef: candidate.occurrence_ref, checkInToken: `room_${input.continuation}.${input.browserKey}` }))
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ requireActiveMembership: true }))
  })
  it('maps each candidate to its own classroom and retries with the same attempt', async () => {
    const secondId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const second = { roster_ref: 'roster_b', occurrence_ref: 'occurrence_b' }
    mocks.candidates.mockResolvedValue({ ok: true, candidates: [candidate, second] })
    const supabase = { from: () => ({ select: () => ({ eq: (_column: string, value: string) => ({
      maybeSingle: async () => ({ data: { classroom_id: value === candidate.roster_ref ? classroomId : secondId }, error: null }),
    }) }) }) }
    mocks.execute.mockResolvedValueOnce({ state: 'checked_in' }).mockRejectedValueOnce(new Error('timeout'))
    await expect(checkInRoom({ ...input, supabase })).resolves.toEqual([
      { state: 'checked_in' }, expect.objectContaining({ state: 'needs_staff' }),
    ])
    await expect(checkInRoom({ ...input, supabase })).resolves.toHaveLength(2)
    expect(mocks.seal.mock.calls.map(call => call[0].classroomId)).toEqual([classroomId, secondId, classroomId, secondId])
    expect(mocks.execute.mock.calls.every(call => call[0].attemptId === input.attemptId)).toBe(true)
  })
  it('does not check into a classroom outside the integration scope', async () => {
    mocks.access.mockResolvedValue({ state: 'outside_scope' })
    await expect(checkInRoom(input)).resolves.toEqual([])
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('reports an expired continuation without sending a check-in', async () => {
    mocks.candidates.mockResolvedValue({ ok: true, candidates: null })
    await expect(checkInRoom(input)).resolves.toBeNull()
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
