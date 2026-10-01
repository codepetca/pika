import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAuth, requireRole } from '@/lib/auth'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import {
  authorizeTeacherDailyReadActor, readContextualTeacherEntry,
  readContextualTeacherStudentHistory,
} from '@/lib/server/contextual-teacher-daily-read'

vi.mock('@/lib/auth', async (original) => ({
  ...await original<typeof import('@/lib/auth')>(), requireAuth: vi.fn(), requireRole: vi.fn(),
}))
vi.mock('@/lib/server/classroom-access', () => ({ resolveClassroomAccess: vi.fn() }))

const actorId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const studentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const entryId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const entry = { id: entryId, classroom_id: classroomId, student_id: studentId, date: '2026-10-01', text: 'Daily work', version: 2 }
const owner = { userId: actorId, classroomId, ownerId: actorId, relationship: 'owner' as const, archived: true }
const joinedEntry = () => ({ ...entry, student: { email: 'student@example.invalid' }, classroom: { id: classroomId, teacher_id: actorId } })
const joinedHistory = () => ({ ...entry, classroom: { id: classroomId, teacher_id: actorId, membership: [{ classroom_id: classroomId, student_id: studentId }] } })

function entryClient(data: unknown = joinedEntry(), error: unknown = null) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data, error }) }
  return { from: vi.fn(() => query), query }
}
function historyClient(data: unknown = [joinedHistory()], error: unknown = null, enrollment: unknown = { classroom_id: classroomId, student_id: studentId }) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), lt: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), then: vi.fn((resolve) => Promise.resolve(resolve({ data, error }))) }
  const enrollmentQuery = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: enrollment, error: null }) }
  return { from: vi.fn((table: string) => table === 'entries' ? query : enrollmentQuery), query, enrollmentQuery }
}
const historyInput = (supabase: ReturnType<typeof historyClient>, overrides = {}) => ({ supabase: supabase as never, actorId, classroomId, studentId, date: undefined, beforeDate: undefined, limit: 10, ...overrides })

describe('contextual teacher Daily Log reads', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(requireRole).mockResolvedValue({ id: actorId, role: 'teacher' } as never)
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'student' } as never)
    vi.mocked(resolveClassroomAccess).mockResolvedValue(owner)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('preserves role-first legacy authorization when absent', async () => {
    expect(await authorizeTeacherDailyReadActor()).toMatchObject({ mode: 'legacy' })
    expect(requireRole).toHaveBeenCalledWith('teacher')
    expect(requireAuth).not.toHaveBeenCalled()
  })
  it('authenticates before malformed admission, then fails 503', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', 'bad')
    vi.mocked(requireAuth).mockRejectedValueOnce({ name: 'AuthenticationError' })
    await expect(authorizeTeacherDailyReadActor()).rejects.toMatchObject({ name: 'AuthenticationError' })
    await expect(authorizeTeacherDailyReadActor()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('keeps nonadmitted teacher legacy and denies nonadmitted learner', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
    await expect(authorizeTeacherDailyReadActor()).rejects.toMatchObject({ name: 'AuthorizationError' })
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'teacher' } as never)
    expect(await authorizeTeacherDailyReadActor()).toMatchObject({ mode: 'legacy' })
  })
  it.each(['teacher', 'student'] as const)('admits globally %s owner without changing role', async (role) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role } as never)
    expect(await authorizeTeacherDailyReadActor()).toMatchObject({ mode: 'contextual', user: { id: actorId, role } })
  })
  it('binds a single entry and preserves student email and payload while stripping classroom metadata', async () => {
    const service = entryClient()
    expect(await readContextualTeacherEntry({ supabase: service as never, actorId, entryId })).toEqual({ ...entry, student: { email: 'student@example.invalid' } })
    expect(service.query.select).toHaveBeenCalledWith(expect.stringContaining('classroom:classrooms!inner(id, teacher_id)'))
    expect(service.query.eq).toHaveBeenCalledWith('id', entryId)
  })
  it('keeps 404 missing and 403 nonowner from the authoritative joined entry row', async () => {
    await expect(readContextualTeacherEntry({ supabase: entryClient(null, { code: 'PGRST116' }) as never, actorId, entryId })).rejects.toMatchObject({ statusCode: 404 })
    await expect(readContextualTeacherEntry({ supabase: entryClient({ ...joinedEntry(), classroom: { id: classroomId, teacher_id: otherId } }) as never, actorId, entryId })).rejects.toMatchObject({ statusCode: 403 })
  })
  it.each([() => ({ ...joinedEntry(), id: otherId }), () => ({ ...joinedEntry(), classroom_id: otherId }), () => ({ ...joinedEntry(), classroom: null }), () => ({ ...joinedEntry(), student_id: 'invalid' })])('fails closed on malformed or cross-bound entry rows %#', async (makeRow) => {
    await expect(readContextualTeacherEntry({ supabase: entryClient(makeRow()) as never, actorId, entryId })).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects bad entry UUID and database failure', async () => {
    await expect(readContextualTeacherEntry({ supabase: entryClient() as never, actorId, entryId: 'bad' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(readContextualTeacherEntry({ supabase: entryClient(null, { code: 'XX000' }) as never, actorId, entryId })).rejects.toMatchObject({ statusCode: 503 })
  })
  it('preflights current owner and enrollment, then binds both again in the final history query', async () => {
    const service = historyClient()
    expect(await readContextualTeacherStudentHistory(historyInput(service, { beforeDate: '2026-10-02', limit: 5 }))).toEqual([entry])
    expect(resolveClassroomAccess).toHaveBeenCalledWith(actorId, classroomId, { supabase: service })
    expect(service.enrollmentQuery.eq).toHaveBeenCalledWith('classroom_id', classroomId)
    expect(service.enrollmentQuery.eq).toHaveBeenCalledWith('student_id', studentId)
    expect(service.query.select).toHaveBeenCalledWith(expect.stringContaining('membership:classroom_enrollments!inner'))
    expect(service.query.eq).toHaveBeenCalledWith('classroom.teacher_id', actorId)
    expect(service.query.eq).toHaveBeenCalledWith('classroom.membership.student_id', studentId)
    expect(service.query.eq).toHaveBeenCalledWith('classroom_id', classroomId)
    expect(service.query.eq).toHaveBeenCalledWith('student_id', studentId)
    expect(service.query.lt).toHaveBeenCalledWith('date', '2026-10-02')
    expect(service.query.order).toHaveBeenCalledWith('date', { ascending: false })
    expect(service.query.limit).toHaveBeenCalledWith(5)
  })
  it('allows archived owner but requires current target membership', async () => {
    const service = historyClient()
    expect(await readContextualTeacherStudentHistory(historyInput(service))).toEqual([entry])
    expect(service.query.eq).not.toHaveBeenCalledWith('classroom.archived_at', null)
    const removed = historyClient([], null, null)
    await expect(readContextualTeacherStudentHistory(historyInput(removed))).rejects.toMatchObject({ statusCode: 404 })
    expect(removed.from).not.toHaveBeenCalledWith('entries')
  })
  it('rejects nonowner and missing classrooms before reading history', async () => {
    const service = historyClient()
    vi.mocked(resolveClassroomAccess).mockResolvedValueOnce(null).mockResolvedValueOnce({ ...owner, relationship: 'none' })
    await expect(readContextualTeacherStudentHistory(historyInput(service))).rejects.toMatchObject({ statusCode: 404 })
    await expect(readContextualTeacherStudentHistory(historyInput(service))).rejects.toMatchObject({ statusCode: 403 })
    expect(service.from).not.toHaveBeenCalled()
  })
  it.each(['member', 'none'] as const)('denies a verified %s relationship with another owner as forbidden, not unavailable', async (relationship) => {
    const service = historyClient()
    vi.mocked(resolveClassroomAccess).mockResolvedValue({ ...owner, ownerId: otherId, relationship })
    await expect(readContextualTeacherStudentHistory(historyInput(service))).rejects.toMatchObject({ statusCode: 403 })
    expect(service.from).not.toHaveBeenCalled()
  })
  it('returns empty when transfer or removal wins after preflight', async () => {
    expect(await readContextualTeacherStudentHistory(historyInput(historyClient([])))).toEqual([])
  })
  it.each([
    () => ({ ...joinedHistory(), id: 'bad' }),
    () => ({ ...joinedHistory(), classroom_id: otherId }),
    () => ({ ...joinedHistory(), student_id: otherId }),
    () => ({ ...joinedHistory(), date: 'bad' }),
    () => ({ ...joinedHistory(), date: '2026-10-03' }),
    () => ({ ...joinedHistory(), classroom: { ...joinedHistory().classroom, teacher_id: otherId } }),
    () => ({ ...joinedHistory(), classroom: { ...joinedHistory().classroom, membership: [] } }),
    () => ({ ...joinedHistory(), classroom: { ...joinedHistory().classroom, membership: [{ classroom_id: classroomId, student_id: otherId }] } }),
  ])('rejects malformed or cross-bound history row without partial disclosure %#', async (badRow) => {
    await expect(readContextualTeacherStudentHistory(historyInput(historyClient([joinedHistory(), badRow()]), { beforeDate: '2026-10-02' }))).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects invalid input, failed database, and malformed preflight', async () => {
    await expect(readContextualTeacherStudentHistory(historyInput(historyClient(), { studentId: 'bad' }))).rejects.toMatchObject({ statusCode: 400 })
    await expect(readContextualTeacherStudentHistory(historyInput(historyClient({}, { code: 'XX000' })))).rejects.toMatchObject({ statusCode: 503 })
    await expect(readContextualTeacherStudentHistory(historyInput(historyClient([], null, { student_id: otherId, classroom_id: classroomId })))).rejects.toMatchObject({ statusCode: 503 })
  })
})
