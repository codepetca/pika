import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAuth, requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { authorizeClassroomCoreRequest } from '@/lib/server/classroom-core-access'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(), requireAuth: vi.fn(), requireRole: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
const ownerId = '11111111-1111-4111-8111-111111111111'
const memberId = '22222222-2222-4222-8222-222222222222'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherClassroomId = '44444444-4444-4444-8444-444444444444'
const classroom = { id: classroomId, teacher_id: ownerId, archived_at: null, title: 'Math' }
const user = (id = ownerId, role = 'student') => ({ id, role, email: 'private@example.com' } as AuthenticatedUser)
const query = (data: unknown, error: unknown = null) => ({
  select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data, error }),
})
function database(row: unknown = classroom, enrollment: unknown = null) {
  const classrooms = query(row)
  const enrollments = query(enrollment)
  const client = { from: vi.fn((table) => table === 'classrooms' ? classrooms : enrollments) }
  vi.mocked(getServiceRoleClient).mockReturnValue(client as unknown as ReturnType<typeof getServiceRoleClient>)
  return { client, classrooms, enrollments }
}
const authorize = (permission: 'owner' | 'member' | 'read' = 'owner', id = classroomId) =>
  authorizeClassroomCoreRequest(id, { legacyRole: 'teacher', permission })

describe('classroom core access pilot (server identity + exact pair + relationship)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_PAIRS', JSON.stringify([{ userId: ownerId, classroomId }]))
    vi.mocked(requireAuth).mockResolvedValue(user())
    vi.mocked(requireRole).mockResolvedValue(user(ownerId, 'teacher'))
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it.each(['false', '', 'TRUE', '1'])('uses exactly the legacy guard with flag %j and no new queries', async (flag) => {
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_ENABLED', flag)
    expect(await authorize('owner', 'legacy-id')).toEqual({ mode: 'legacy', user: user(ownerId, 'teacher') })
    expect(requireRole).toHaveBeenCalledWith('teacher')
    expect(requireAuth).not.toHaveBeenCalled()
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it.each(['', 'no-json', '{}', '[{"userId":"*","classroomId":"*"}]',
    JSON.stringify([{ userId: ownerId, classroomId, extra: true }]),
    JSON.stringify(Array(101).fill({ userId: ownerId, classroomId })), ' '.repeat(20_001),
  ])('rejects invalid enabled configuration without falling back to legacy authority', async (pairs) => {
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_PAIRS', pairs)
    await expect(authorize()).rejects.toMatchObject({ statusCode: 503 })
    expect(requireRole).not.toHaveBeenCalled()
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it('never cross-products separately allowed users and classrooms', async () => {
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_PAIRS', JSON.stringify([
      { userId: ownerId, classroomId }, { userId: memberId, classroomId: otherClassroomId },
    ]))
    await expect(authorize('owner', otherClassroomId)).rejects.toMatchObject({ name: 'AuthorizationError' })
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it('preserves ordinary authentication for legacy shared-read routes', async () => {
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_ENABLED', 'false')
    expect(await authorizeClassroomCoreRequest(classroomId, { permission: 'read' }))
      .toEqual({ mode: 'legacy', user: user() })
    expect(requireRole).not.toHaveBeenCalled()
  })

  it('preserves legacy mode for an authenticated noncohort user with the expected role', async () => {
    vi.mocked(requireAuth).mockResolvedValue(user(memberId, 'teacher'))
    expect((await authorize()).mode).toBe('legacy')
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it('cannot admit an unauthenticated request through pilot configuration', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new Error('no session'))
    await expect(authorize()).rejects.toThrow('no session')
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it('rejects invalid server identities and unknown requested permissions', async () => {
    vi.mocked(requireAuth).mockResolvedValue(user('invalid'))
    await expect(authorize()).rejects.toMatchObject({ statusCode: 503 })
    vi.mocked(requireAuth).mockResolvedValue(user())
    database()
    await expect(authorize('unknown' as 'owner')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('lets a student-valued owner read their classroom without mutating global role or reading enrollment', async () => {
    const { client } = database()
    const result = await authorize()
    expect(result).toMatchObject({ mode: 'contextual', user: { role: 'student' }, context: { relationship: 'owner' }, classroom })
    expect(client.from.mock.calls).toEqual([['classrooms']])
    expect(requireRole).not.toHaveBeenCalled()
  })

  it.each(['read', 'member'] as const)('lets a teacher-valued member use %s authority only in their enrolled class', async (permission) => {
    vi.mocked(requireAuth).mockResolvedValue(user(memberId, 'teacher'))
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_PAIRS', JSON.stringify([{ userId: memberId, classroomId }]))
    const { classrooms, enrollments } = database(classroom, { classroom_id: classroomId, student_id: memberId })
    expect(await authorize(permission)).toMatchObject({ mode: 'contextual', context: { relationship: 'member' } })
    expect(classrooms.eq.mock.calls).toEqual([['id', classroomId]])
    expect(enrollments.eq.mock.calls).toEqual([['classroom_id', classroomId], ['student_id', memberId]])
    await expect(authorize('owner')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('denies an unrelated user and rejects owner self-participation', async () => {
    database({ ...classroom, teacher_id: memberId })
    await expect(authorize('read')).rejects.toMatchObject({ statusCode: 403 })
    database()
    await expect(authorize('member')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('preserves archived owner read for explicit lifecycle handling but denies archived members', async () => {
    const archived = { ...classroom, archived_at: '2026-09-01T00:00:00Z' }
    database(archived)
    expect(await authorize()).toMatchObject({ mode: 'contextual', context: { archived: true } })
    database({ ...archived, teacher_id: memberId }, { classroom_id: classroomId, student_id: ownerId })
    await expect(authorize('read')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('distinguishes genuine absence from database failure', async () => {
    const { classrooms } = database(null)
    await expect(authorize()).rejects.toMatchObject({ statusCode: 404 })
    classrooms.maybeSingle.mockResolvedValue({ data: null, error: { code: '08006' } })
    await expect(authorize()).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([{}, { ...classroom, id: otherClassroomId }, { ...classroom, archived_at: undefined }])(
    'does not authorize malformed or substituted classroom evidence', async (row) => {
      database(row)
      await expect(authorize()).rejects.toMatchObject({ statusCode: 503 })
    },
  )

  it('treats an intentionally empty cohort as legacy, not an invalid configuration', async () => {
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_PAIRS', '[]')
    vi.mocked(requireAuth).mockResolvedValue(user(ownerId, 'teacher'))
    expect((await authorize()).mode).toBe('legacy')
  })

  it('matches UUID pairs canonically so casing cannot bypass contextual denials', async () => {
    database()
    expect((await authorize('owner', classroomId.toUpperCase())).mode).toBe('contextual')
    await expect(authorize('member', classroomId.toUpperCase())).rejects.toMatchObject({ statusCode: 403 })
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_PAIRS', JSON.stringify([{ userId: ownerId, classroomId: classroomId.toUpperCase() }]))
    expect((await authorize()).mode).toBe('contextual')
  })

  it('does not use a legacy fallback on enrollment source failure or malformed membership', async () => {
    const { enrollments } = database({ ...classroom, teacher_id: memberId })
    enrollments.maybeSingle.mockResolvedValue({ data: null, error: { code: '08006' } })
    await expect(authorize('read')).rejects.toMatchObject({ statusCode: 503 })
    enrollments.maybeSingle.mockResolvedValue({ data: { classroom_id: otherClassroomId, student_id: ownerId }, error: null })
    await expect(authorize('read')).rejects.toMatchObject({ statusCode: 503 })
    expect(requireRole).not.toHaveBeenCalled()
  })
})
