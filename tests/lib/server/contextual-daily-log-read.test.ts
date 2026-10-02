import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAuth, requireRole } from '@/lib/auth'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import { authorizeDailyLogReadActor, readContextualDailyLogs } from '@/lib/server/contextual-daily-log-read'

vi.mock('@/lib/auth', async (original) => ({
  ...await original<typeof import('@/lib/auth')>(), requireAuth: vi.fn(), requireRole: vi.fn(),
}))
vi.mock('@/lib/server/classroom-access', () => ({ resolveClassroomAccess: vi.fn() }))

const actorId = '11111111-1111-4111-8111-111111111111'
const ownerId = '22222222-2222-4222-8222-222222222222'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherClassroomId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const user = { id: actorId, role: 'teacher' as const, email: 'learner@example.invalid' }
const member = { userId: actorId, classroomId, ownerId, relationship: 'member' as const, archived: false }
const entry = {
  id: '33333333-3333-4333-8333-333333333333', student_id: actorId,
  classroom_id: classroomId, date: '2026-10-01', text: 'My log', version: 1,
}
function row() {
  return { ...entry, classroom: {
    id: classroomId, teacher_id: ownerId, archived_at: null,
    membership: [{ classroom_id: classroomId, student_id: actorId }],
  } }
}
function client(data: unknown = [row()], error: unknown = null) {
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error }),
  }
  return { from: vi.fn(() => query), query }
}

describe('contextual Daily Log reads', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(requireRole).mockResolvedValue({ ...user, role: 'student' })
    vi.mocked(requireAuth).mockResolvedValue(user)
    vi.mocked(resolveClassroomAccess).mockResolvedValue(member)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('retains the role-first legacy guard with no admission configuration', async () => {
    expect(await authorizeDailyLogReadActor()).toMatchObject({ mode: 'legacy' })
    expect(requireRole).toHaveBeenCalledWith('student')
    expect(requireAuth).not.toHaveBeenCalled()
  })
  it('authenticates before reporting malformed configuration', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', 'bad')
    vi.mocked(requireAuth).mockRejectedValueOnce({ name: 'AuthenticationError' })
    await expect(authorizeDailyLogReadActor()).rejects.toMatchObject({ name: 'AuthenticationError' })
    await expect(authorizeDailyLogReadActor()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('denies a non-admitted global teacher without classroom reads', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
    await expect(authorizeDailyLogReadActor()).rejects.toMatchObject({ name: 'AuthorizationError' })
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
    vi.mocked(requireAuth).mockResolvedValue({ ...user, role: 'student' })
    expect(await authorizeDailyLogReadActor()).toMatchObject({ mode: 'legacy' })
  })
  it.each(['teacher', 'student'] as const)('admits the configured %s account independently of global role', async (role) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.mocked(requireAuth).mockResolvedValue({ ...user, role })
    expect(await authorizeDailyLogReadActor()).toMatchObject({ mode: 'contextual', user: { id: actorId, role } })
    expect(requireRole).not.toHaveBeenCalled()
  })
  it('binds broad reads to live non-owned memberships in the entry query and strips relationship metadata', async () => {
    const service = client()
    expect(await readContextualDailyLogs({ supabase: service as never, actorId, classroomId: null, limit: 100 })).toEqual([entry])
    expect(service.from).toHaveBeenCalledExactlyOnceWith('entries')
    expect(service.query.select).toHaveBeenCalledWith(expect.stringContaining('membership:classroom_enrollments!inner'))
    expect(service.query.eq).toHaveBeenCalledWith('student_id', actorId)
    expect(service.query.eq).toHaveBeenCalledWith('classroom.membership.student_id', actorId)
    expect(service.query.is).toHaveBeenCalledWith('classroom.archived_at', null)
    expect(service.query.neq).toHaveBeenCalledWith('classroom.teacher_id', actorId)
    expect(service.query.limit).toHaveBeenCalledWith(100)
    expect(service.query.order).toHaveBeenCalledWith('date', { ascending: false })
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
  })
  it('authorizes a scoped member and preserves unlimited classroom history', async () => {
    const service = client()
    expect(await readContextualDailyLogs({ supabase: service as never, actorId, classroomId, limit: null })).toEqual([entry])
    expect(resolveClassroomAccess).toHaveBeenCalledWith(actorId, classroomId, { supabase: service })
    expect(service.query.eq).toHaveBeenCalledWith('classroom_id', classroomId)
    expect(service.query.limit).not.toHaveBeenCalled()
  })
  it.each([
    [null, 404], [{ ...member, relationship: 'owner', ownerId: actorId }, 403],
    [{ ...member, archived: true }, 403], [{ ...member, relationship: 'none' }, 403],
  ])('rejects a denied scoped context before entry lookup %#', async (context, statusCode) => {
    vi.mocked(resolveClassroomAccess).mockResolvedValue(context as never)
    const service = client()
    await expect(readContextualDailyLogs({ supabase: service as never, actorId, classroomId, limit: null })).rejects.toMatchObject({ statusCode })
    expect(service.from).not.toHaveBeenCalled()
  })
  it('validates scoped UUIDs and fails closed on relationship lookup failure', async () => {
    const service = client()
    await expect(readContextualDailyLogs({ supabase: service as never, actorId, classroomId: 'bad', limit: null })).rejects.toMatchObject({ statusCode: 400 })
    vi.mocked(resolveClassroomAccess).mockRejectedValueOnce(new Error('database unavailable'))
    await expect(readContextualDailyLogs({ supabase: service as never, actorId, classroomId, limit: null })).rejects.toThrow('database unavailable')
    expect(service.from).not.toHaveBeenCalled()
  })
  it.each([
    () => ({ ...row(), student_id: ownerId }),
    () => ({ ...row(), classroom_id: otherClassroomId }),
    () => ({ ...row(), classroom: { ...row().classroom, teacher_id: actorId } }),
    () => ({ ...row(), classroom: { ...row().classroom, archived_at: '2026-10-01T12:00:00Z' } }),
    () => ({ ...row(), classroom: { ...row().classroom, membership: [] } }),
    () => ({ ...row(), classroom: { ...row().classroom, membership: [{ classroom_id: classroomId, student_id: ownerId }] } }),
    () => ({ ...row(), classroom: null }),
  ])('rejects malformed or unauthorized service-role results without disclosing any entry %#', async (badRow) => {
    const service = client([row(), badRow()])
    await expect(readContextualDailyLogs({ supabase: service as never, actorId, classroomId, limit: null })).rejects.toMatchObject({ statusCode: 503 })
  })
  it('returns an empty snapshot after membership removal/archive wins rather than falling back', async () => {
    const service = client([])
    expect(await readContextualDailyLogs({ supabase: service as never, actorId, classroomId, limit: null })).toEqual([])
    expect(service.from).toHaveBeenCalledOnce()
  })
  it('redacts database failures and rejects a non-array result', async () => {
    for (const service of [client([], { message: 'private database detail' }), client({ entry })]) {
      await expect(readContextualDailyLogs({ supabase: service as never, actorId, classroomId: null, limit: 100 })).rejects.toMatchObject({
        statusCode: 503, message: 'Unable to verify Daily Log entries',
      })
    }
  })
})
