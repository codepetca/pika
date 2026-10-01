import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import { readContextualTeacherLogs } from '@/lib/server/contextual-teacher-daily-logs'

vi.mock('@/lib/server/classroom-access', () => ({ resolveClassroomAccess: vi.fn() }))

const actorId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const studentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const enrollmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const entryId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const owner = { userId: actorId, classroomId, ownerId: actorId, relationship: 'owner' as const, archived: true }
const entry = { id: entryId, student_id: studentId, classroom_id: classroomId, date: '2026-10-01', text: 'Work', rich_content: null, version: 1, minutes_reported: null, mood: null, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z', on_time: true }
const row = () => ({ id: enrollmentId, classroom_id: classroomId, student_id: studentId, classroom: { id: classroomId, teacher_id: actorId }, learner: { id: studentId, email: 'a@example.invalid', profile: { id: otherId, user_id: studentId, first_name: 'A', last_name: 'B' }, selected: [entry], preview: [entry] } })

function client(pages: unknown[][] = [[row()]]) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), gt: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), then: vi.fn((resolve) => Promise.resolve(resolve({ data: pages.shift() ?? [], error: null }))) }
  return { from: vi.fn(() => query), query }
}

describe('contextual teacher logs roster read', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.mocked(resolveClassroomAccess).mockResolvedValue(owner) })

  it('binds owner, enrollment, learner and both entry aliases in each statement, with exact projection', async () => {
    const service = client([[{ ...row(), learner: { ...row().learner, password_hash: 'private', preview: [{ ...entry, secret: 'private' }] } }]])
    const result = await readContextualTeacherLogs({ supabase: service as never, actorId, classroomId, date: '2026-10-01' })
    expect(result).toEqual({ classroom_id: classroomId, date: '2026-10-01', logs: [{ student_id: studentId, student_email: 'a@example.invalid', student_first_name: 'A', student_last_name: 'B', entry, history_preview: [entry] }] })
    expect(service.query.select).toHaveBeenCalledWith(expect.stringContaining('preview:entries!entries_student_id_fkey'))
    expect(service.query.eq).toHaveBeenCalledWith('classroom.teacher_id', actorId)
    expect(service.query.eq).toHaveBeenCalledWith('learner.preview.classroom_id', classroomId)
    expect(service.query.eq).toHaveBeenCalledWith('learner.selected.classroom_id', classroomId)
    expect(service.query.eq).toHaveBeenCalledWith('learner.selected.date', '2026-10-01')
    expect(service.query.limit).toHaveBeenCalledWith(5, { referencedTable: 'learner.preview' })
  })

  it('retains status preflights while accepting an archived owner and an empty roster', async () => {
    expect(await readContextualTeacherLogs({ supabase: client([[]]) as never, actorId, classroomId })).toEqual({ classroom_id: classroomId, date: null, logs: [] })
    const service = client()
    vi.mocked(resolveClassroomAccess).mockResolvedValueOnce(null).mockResolvedValueOnce({ ...owner, ownerId: otherId, relationship: 'none' })
    await expect(readContextualTeacherLogs({ supabase: service as never, actorId, classroomId })).rejects.toMatchObject({ statusCode: 404 })
    await expect(readContextualTeacherLogs({ supabase: service as never, actorId, classroomId })).rejects.toMatchObject({ statusCode: 403 })
    expect(service.from).not.toHaveBeenCalled()
  })

  it('uses an enrollment keyset cursor across a full page without imposing a roster cap', async () => {
    const suffix = (value: number) => value.toString(16).padStart(12, '0')
    const learner = (number: number) => {
      const id = `bbbbbbbb-bbbb-4bbb-8bbb-${suffix(number)}`
      return {
        ...row(), id: `cccccccc-cccc-4ccc-8ccc-${suffix(number)}`, student_id: id,
        learner: { ...row().learner, id, email: `${number}@example.invalid`,
          profile: null, selected: [], preview: [{ ...entry, student_id: id }] },
      }
    }
    const service = client([Array.from({ length: 1000 }, (_, index) => learner(index + 1)), [learner(1001)]])
    const result = await readContextualTeacherLogs({ supabase: service as never, actorId, classroomId })
    expect(result.logs).toHaveLength(1001)
    expect(result.logs.find(log => log.student_id.endsWith(suffix(1001)))).toMatchObject({ student_first_name: '', entry: null })
    expect(service.query.gt).toHaveBeenCalledWith('id', `cccccccc-cccc-4ccc-8ccc-${suffix(1000)}`)
    expect(service.from).toHaveBeenCalledTimes(2)
    expect(service.query.limit).toHaveBeenCalledWith(0, { referencedTable: 'learner.selected' })
  })

  it('fails closed on reversed page order, malformed rows, returned errors and rejected queries', async () => {
    await expect(readContextualTeacherLogs({ supabase: client([[{ ...row(), id: 'bad' }]]) as never, actorId, classroomId, date: '2026-10-01' })).rejects.toMatchObject({ statusCode: 503 })
    await expect(readContextualTeacherLogs({ supabase: client([[{ ...row(), learner: { ...row().learner, preview: [entry, { ...entry, date: '2026-10-02' }] } }]]) as never, actorId, classroomId, date: '2026-10-01' })).rejects.toMatchObject({ statusCode: 503 })
    const errored = client()
    errored.query.then.mockImplementationOnce(resolve => { resolve({ data: null, error: { code: 'XX000' } }) })
    await expect(readContextualTeacherLogs({ supabase: errored as never, actorId, classroomId })).rejects.toMatchObject({ statusCode: 503 })
    const rejected = client()
    rejected.query.then.mockImplementationOnce((_resolve, reject) => { reject(new Error('unavailable')) })
    await expect(readContextualTeacherLogs({ supabase: rejected as never, actorId, classroomId })).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    () => ({ ...row(), classroom: { id: classroomId, teacher_id: otherId } }),
    () => ({ ...row(), classroom_id: otherId }),
    () => ({ ...row(), learner: { ...row().learner, id: otherId } }),
    () => ({ ...row(), learner: { ...row().learner, profile: { ...row().learner.profile, user_id: otherId } } }),
    () => ({ ...row(), learner: { ...row().learner, selected: [{ ...entry, student_id: otherId }] } }),
    () => ({ ...row(), learner: { ...row().learner, preview: [{ ...entry, classroom_id: otherId }] } }),
  ])('fails closed for cross-bound evidence %#', async (makeRow) => {
    await expect(readContextualTeacherLogs({ supabase: client([[makeRow()]]) as never, actorId, classroomId, date: '2026-10-01' })).rejects.toMatchObject({ statusCode: 503 })
  })
})
