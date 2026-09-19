import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAuth, requireRole } from '@/lib/auth'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import {
  assertContextualAnnouncementRows,
  authorizeClassroomAnnouncementRequest,
} from '@/lib/server/classroom-announcement-access'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}))
vi.mock('@/lib/server/classroom-access', () => ({ resolveClassroomAccess: vi.fn() }))

const actorId = '11111111-1111-4111-8111-111111111111'
const ownerId = '22222222-2222-4222-8222-222222222222'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherClassroomId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const announcementId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const user = (role: 'student' | 'teacher' = 'student') => ({
  id: actorId,
  role,
  email: 'private@example.com',
} as AuthenticatedUser)
const context = (relationship: 'owner' | 'member' | 'none', archived = false) => ({
  userId: actorId,
  classroomId,
  ownerId: relationship === 'owner' ? actorId : ownerId,
  relationship,
  archived,
})

describe('classroom announcement exact-pair access', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_ANNOUNCEMENTS_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ANNOUNCEMENTS_ACCESS_PAIRS', JSON.stringify([{
      userId: actorId,
      classroomId,
    }]))
    vi.mocked(requireAuth).mockResolvedValue(user())
    vi.mocked(requireRole).mockResolvedValue(user('teacher'))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each(['false', '', 'TRUE', '1'])('preserves the exact legacy role guard with flag %j', async (flag) => {
    vi.stubEnv('PIKA_CLASSROOM_ANNOUNCEMENTS_ACCESS_ENABLED', flag)
    expect(await authorizeClassroomAnnouncementRequest('legacy-id', {
      legacyRole: 'teacher',
      permission: 'owner',
    })).toEqual({ mode: 'legacy', user: user('teacher') })
    expect(requireRole).toHaveBeenCalledWith('teacher')
    expect(requireAuth).not.toHaveBeenCalled()
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
  })

  it.each([
    '',
    'not-json',
    '{}',
    '[{"userId":"*","classroomId":"*"}]',
    JSON.stringify([{ userId: actorId, classroomId, extra: true }]),
    JSON.stringify(Array(101).fill({ userId: actorId, classroomId })),
    ' '.repeat(20_001),
  ])('fails closed for invalid enabled configuration', async (pairs) => {
    vi.stubEnv('PIKA_CLASSROOM_ANNOUNCEMENTS_ACCESS_PAIRS', pairs)
    await expect(authorizeClassroomAnnouncementRequest(classroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).rejects.toMatchObject({ statusCode: 503 })
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
  })

  it('authenticates before evaluating configured pairs', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new Error('no session'))
    await expect(authorizeClassroomAnnouncementRequest(classroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).rejects.toThrow('no session')
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
  })

  it('rejects invalid identities and requested identifiers without a legacy escape', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...user(), id: 'invalid' })
    await expect(authorizeClassroomAnnouncementRequest(classroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).rejects.toMatchObject({ statusCode: 503 })
    vi.mocked(requireAuth).mockResolvedValue(user())
    await expect(authorizeClassroomAnnouncementRequest('invalid', {
      legacyRole: 'teacher',
      permission: 'owner',
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('never cross-products separately admitted users and classrooms', async () => {
    vi.stubEnv('PIKA_CLASSROOM_ANNOUNCEMENTS_ACCESS_PAIRS', JSON.stringify([
      { userId: actorId, classroomId },
      { userId: ownerId, classroomId: otherClassroomId },
    ]))
    await expect(authorizeClassroomAnnouncementRequest(otherClassroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).rejects.toMatchObject({ name: 'AuthorizationError' })
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
  })

  it('keeps expected-role noncohort users on the legacy route without relationship reads', async () => {
    vi.mocked(requireAuth).mockResolvedValue(user('teacher'))
    vi.stubEnv('PIKA_CLASSROOM_ANNOUNCEMENTS_ACCESS_PAIRS', '[]')
    expect(await authorizeClassroomAnnouncementRequest(classroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).toEqual({ mode: 'legacy', user: user('teacher') })
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
  })

  it('admits a student-valued owner for owner announcement reads without rewriting role', async () => {
    vi.mocked(resolveClassroomAccess).mockResolvedValue(context('owner'))
    expect(await authorizeClassroomAnnouncementRequest(classroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).toMatchObject({
      mode: 'contextual',
      user: { role: 'student' },
      context: { relationship: 'owner' },
    })
    expect(requireRole).not.toHaveBeenCalled()
  })

  it('admits a teacher-valued active member only for member announcement operations', async () => {
    vi.mocked(requireAuth).mockResolvedValue(user('teacher'))
    vi.mocked(resolveClassroomAccess).mockResolvedValue(context('member'))
    expect(await authorizeClassroomAnnouncementRequest(classroomId, {
      legacyRole: 'student',
      permission: 'member',
    })).toMatchObject({ mode: 'contextual', context: { relationship: 'member' } })
    await expect(authorizeClassroomAnnouncementRequest(classroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('preserves archived owner reads and denies archived member participation', async () => {
    vi.mocked(resolveClassroomAccess).mockResolvedValue(context('owner', true))
    expect((await authorizeClassroomAnnouncementRequest(classroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).mode).toBe('contextual')
    vi.mocked(resolveClassroomAccess).mockResolvedValue(context('member', true))
    await expect(authorizeClassroomAnnouncementRequest(classroomId, {
      legacyRole: 'student',
      permission: 'member',
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('distinguishes absence from a resolver failure and never falls back', async () => {
    vi.mocked(resolveClassroomAccess).mockResolvedValue(null)
    await expect(authorizeClassroomAnnouncementRequest(classroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).rejects.toMatchObject({ statusCode: 404 })
    vi.mocked(resolveClassroomAccess).mockRejectedValue(new Error('database unavailable'))
    await expect(authorizeClassroomAnnouncementRequest(classroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).rejects.toThrow('database unavailable')
  })

  it('matches exact pairs canonically and rejects PostgreSQL UUID aliases', async () => {
    vi.mocked(resolveClassroomAccess).mockResolvedValue(context('owner'))
    expect((await authorizeClassroomAnnouncementRequest(classroomId.toUpperCase(), {
      legacyRole: 'teacher',
      permission: 'owner',
    })).mode).toBe('contextual')
    expect(resolveClassroomAccess).toHaveBeenCalledWith(actorId, classroomId)
    await expect(authorizeClassroomAnnouncementRequest(classroomId.replaceAll('-', ''), {
      legacyRole: 'teacher',
      permission: 'owner',
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('validates contextual announcement identity and classroom binding', () => {
    expect(() => assertContextualAnnouncementRows(classroomId, [{
      id: announcementId,
      classroom_id: classroomId,
      content: 'Visible',
    }])).not.toThrow()
    for (const rows of [
      null,
      {},
      [{ id: 'invalid', classroom_id: classroomId }],
      [{ id: announcementId, classroom_id: otherClassroomId }],
    ]) {
      expect(() => assertContextualAnnouncementRows(classroomId, rows))
        .toThrowError(expect.objectContaining({ statusCode: 503 }))
    }
  })
})
