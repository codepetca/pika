import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as getEntry } from '@/app/api/teacher/entry/[id]/route'
import { GET as getHistory } from '@/app/api/teacher/student-history/route'
import { mockAuthenticationError } from '../setup'
import {
  authorizeTeacherDailyReadActor, readContextualTeacherEntry,
  readContextualTeacherStudentHistory,
} from '@/lib/server/contextual-teacher-daily-read'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const studentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const entryId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const service = { from: vi.fn() }
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => service) }))
vi.mock('@/lib/server/contextual-teacher-daily-read', () => ({
  authorizeTeacherDailyReadActor: vi.fn(),
  readContextualTeacherEntry: vi.fn(),
  readContextualTeacherStudentHistory: vi.fn(),
}))

describe('contextual teacher Daily Log route wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authorizeTeacherDailyReadActor).mockResolvedValue({ mode: 'contextual', user: { id: actorId, role: 'student' } as never })
  })
  it('sends admitted entry reads through the bound helper and preserves response shape', async () => {
    vi.mocked(readContextualTeacherEntry).mockResolvedValue({ id: entryId, text: 'Daily work' } as never)
    const response = await getEntry(new NextRequest(`http://localhost/api/teacher/entry/${entryId}`), { params: { id: entryId } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ entry: { id: entryId, text: 'Daily work' } })
    expect(readContextualTeacherEntry).toHaveBeenCalledWith({ supabase: service, actorId, entryId })
    expect(service.from).not.toHaveBeenCalled()
  })
  it('parses existing history limit and date before invoking the contextual helper', async () => {
    vi.mocked(readContextualTeacherStudentHistory).mockResolvedValue([{ id: entryId }] as never)
    const response = await getHistory(new NextRequest(`http://localhost/api/teacher/student-history?classroom_id=${classroomId}&student_id=${studentId}&before_date=2026-10-02&limit=500`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ entries: [{ id: entryId }] })
    expect(readContextualTeacherStudentHistory).toHaveBeenCalledWith({ supabase: service, actorId, classroomId, studentId, beforeDate: '2026-10-02', date: undefined, limit: 50 })
    expect(service.from).not.toHaveBeenCalled()
  })
  it('authenticates before parsing query or entry IDs and rejects invalid history query before data access', async () => {
    vi.mocked(authorizeTeacherDailyReadActor).mockRejectedValueOnce(mockAuthenticationError())
    const unauthenticated = await getHistory(new NextRequest('http://localhost/api/teacher/student-history'))
    expect(unauthenticated.status).toBe(401)
    expect(readContextualTeacherStudentHistory).not.toHaveBeenCalled()
    const invalid = await getHistory(new NextRequest(`http://localhost/api/teacher/student-history?classroom_id=${classroomId}&student_id=${studentId}&date=bad`))
    expect(invalid.status).toBe(400)
    expect(readContextualTeacherStudentHistory).not.toHaveBeenCalled()
    vi.mocked(authorizeTeacherDailyReadActor).mockRejectedValueOnce(mockAuthenticationError())
    const entryResponse = await getEntry(new NextRequest('http://localhost/api/teacher/entry/bad'), { params: { id: 'bad' } })
    expect(entryResponse.status).toBe(401)
    expect(readContextualTeacherEntry).not.toHaveBeenCalled()
  })
})
