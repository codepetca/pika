import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAuth, requireRole } from '@/lib/auth'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import {
  assertContextualMaterialRows,
  assertContextualPublishedMaterialRows,
  authorizeClassroomMaterialRequest,
} from '@/lib/server/classroom-material-access'
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
const materialId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
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

describe('classroom material exact-pair access', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_MATERIALS_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_MATERIALS_ACCESS_PAIRS', JSON.stringify([{
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
    vi.stubEnv('PIKA_CLASSROOM_MATERIALS_ACCESS_ENABLED', flag)
    expect(await authorizeClassroomMaterialRequest('legacy-id', {
      legacyRole: 'teacher',
      permission: 'owner',
    })).toEqual({ mode: 'legacy', user: user('teacher') })
    expect(requireRole).toHaveBeenCalledWith('teacher')
    expect(requireAuth).not.toHaveBeenCalled()
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
  })

  it('lets a shared-cohort admitted actor bypass the old exact-pair configuration', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({
      version: 1,
      admittedUserIds: [actorId],
    }))
    vi.stubEnv('PIKA_CLASSROOM_MATERIALS_ACCESS_ENABLED', 'false')
    vi.stubEnv('PIKA_CLASSROOM_MATERIALS_ACCESS_PAIRS', 'not-json')
    vi.mocked(resolveClassroomAccess).mockResolvedValue(context('owner'))

    expect(await authorizeClassroomMaterialRequest(classroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).toMatchObject({ mode: 'contextual', context: { relationship: 'owner' } })
  })

  it('retains the old disabled-pilot role guard for shared-cohort nonmembers', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({
      version: 1,
      admittedUserIds: [],
    }))
    vi.stubEnv('PIKA_CLASSROOM_MATERIALS_ACCESS_ENABLED', 'false')
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    const resolveClassroomId = vi.fn().mockResolvedValue(classroomId)

    await expect(authorizeClassroomMaterialRequest(resolveClassroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).rejects.toMatchObject({ name: 'AuthorizationError' })
    expect(resolveClassroomId).not.toHaveBeenCalled()
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
  })

  it('uses the exact old pair pilot for shared-cohort nonmembers', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({
      version: 1,
      admittedUserIds: [],
    }))
    vi.stubEnv('PIKA_CLASSROOM_MATERIALS_ACCESS_ENABLED', 'true')
    vi.mocked(requireAuth).mockResolvedValue(user('teacher'))
    vi.mocked(resolveClassroomAccess).mockResolvedValue(context('owner'))

    expect(await authorizeClassroomMaterialRequest(classroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).toMatchObject({ mode: 'contextual', context: { relationship: 'owner' } })
  })

  it('does not cross-product a shared admitted actor with unrelated actors', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({
      version: 1,
      admittedUserIds: [ownerId],
    }))
    vi.stubEnv('PIKA_CLASSROOM_MATERIALS_ACCESS_ENABLED', 'false')
    vi.mocked(requireAuth).mockResolvedValue(user('student'))

    await expect(authorizeClassroomMaterialRequest(classroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).rejects.toMatchObject({ name: 'AuthorizationError' })
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
  })

  it('makes an invalid shared cohort terminal after authentication', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', 'not-json')
    vi.stubEnv('PIKA_CLASSROOM_MATERIALS_ACCESS_ENABLED', 'true')
    const resolveClassroomId = vi.fn().mockResolvedValue(classroomId)

    await expect(authorizeClassroomMaterialRequest(resolveClassroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).rejects.toMatchObject({ statusCode: 503 })
    expect(resolveClassroomId).not.toHaveBeenCalled()
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
    vi.stubEnv('PIKA_CLASSROOM_MATERIALS_ACCESS_PAIRS', pairs)
    await expect(authorizeClassroomMaterialRequest(classroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).rejects.toMatchObject({ statusCode: 503 })
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
  })

  it('authenticates before resolving route parameters', async () => {
    const resolveClassroomId = vi.fn().mockResolvedValue(classroomId)
    vi.mocked(requireAuth).mockRejectedValue(new Error('no session'))
    await expect(authorizeClassroomMaterialRequest(resolveClassroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).rejects.toThrow('no session')
    expect(resolveClassroomId).not.toHaveBeenCalled()
  })

  it('rejects invalid identities and preserves wrong-role handling for malformed identifiers', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...user(), id: 'invalid' })
    await expect(authorizeClassroomMaterialRequest(classroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).rejects.toMatchObject({ statusCode: 503 })

    vi.mocked(requireAuth).mockResolvedValue(user())
    await expect(authorizeClassroomMaterialRequest('invalid', {
      legacyRole: 'teacher',
      permission: 'owner',
    })).rejects.toMatchObject({ name: 'AuthorizationError' })

    vi.mocked(requireAuth).mockResolvedValue(user('teacher'))
    await expect(authorizeClassroomMaterialRequest('invalid', {
      legacyRole: 'teacher',
      permission: 'owner',
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('never cross-products separately admitted users and classrooms', async () => {
    vi.stubEnv('PIKA_CLASSROOM_MATERIALS_ACCESS_PAIRS', JSON.stringify([
      { userId: actorId, classroomId },
      { userId: ownerId, classroomId: otherClassroomId },
    ]))
    await expect(authorizeClassroomMaterialRequest(otherClassroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).rejects.toMatchObject({ name: 'AuthorizationError' })
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
  })

  it('keeps expected-role noncohort users on the legacy route', async () => {
    vi.mocked(requireAuth).mockResolvedValue(user('teacher'))
    vi.stubEnv('PIKA_CLASSROOM_MATERIALS_ACCESS_PAIRS', '[]')
    expect(await authorizeClassroomMaterialRequest(classroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).toEqual({ mode: 'legacy', user: user('teacher') })
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
  })

  it('admits a student-valued owner only for owner reads', async () => {
    vi.mocked(resolveClassroomAccess).mockResolvedValue(context('owner'))
    expect(await authorizeClassroomMaterialRequest(classroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).toMatchObject({ mode: 'contextual', context: { relationship: 'owner' } })
    await expect(authorizeClassroomMaterialRequest(classroomId, {
      legacyRole: 'student',
      permission: 'member',
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('admits a teacher-valued active member only for member reads', async () => {
    vi.mocked(requireAuth).mockResolvedValue(user('teacher'))
    vi.mocked(resolveClassroomAccess).mockResolvedValue(context('member'))
    expect(await authorizeClassroomMaterialRequest(classroomId, {
      legacyRole: 'student',
      permission: 'member',
    })).toMatchObject({ mode: 'contextual', context: { relationship: 'member' } })
    await expect(authorizeClassroomMaterialRequest(classroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it.each([
    { role: 'teacher' as const, relationship: 'owner' as const, legacyRole: 'teacher' as const, permission: 'owner' as const },
    { role: 'student' as const, relationship: 'owner' as const, legacyRole: 'teacher' as const, permission: 'owner' as const },
    { role: 'teacher' as const, relationship: 'member' as const, legacyRole: 'student' as const, permission: 'member' as const },
    { role: 'student' as const, relationship: 'member' as const, legacyRole: 'student' as const, permission: 'member' as const },
  ])('uses the classroom relationship, not the global $role role, for a shared admitted $relationship', async ({
    role, relationship, legacyRole, permission,
  }) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({
      version: 1,
      admittedUserIds: [actorId],
    }))
    vi.stubEnv('PIKA_CLASSROOM_MATERIALS_ACCESS_ENABLED', 'false')
    vi.mocked(requireAuth).mockResolvedValue(user(role))
    vi.mocked(resolveClassroomAccess).mockResolvedValue(context(relationship))

    expect(await authorizeClassroomMaterialRequest(classroomId, { legacyRole, permission }))
      .toMatchObject({ mode: 'contextual', context: { relationship } })
  })

  it('denies an admitted outsider after the trusted resolver proves removed membership', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({
      version: 1,
      admittedUserIds: [actorId],
    }))
    vi.stubEnv('PIKA_CLASSROOM_MATERIALS_ACCESS_ENABLED', 'false')
    vi.mocked(resolveClassroomAccess).mockResolvedValue(context('none'))

    await expect(authorizeClassroomMaterialRequest(classroomId, {
      legacyRole: 'student',
      permission: 'member',
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('keeps a shared admitted relationship denial terminal instead of falling back to a global role', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({
      version: 1,
      admittedUserIds: [actorId],
    }))
    vi.stubEnv('PIKA_CLASSROOM_MATERIALS_ACCESS_ENABLED', 'false')
    vi.mocked(requireAuth).mockResolvedValue(user('teacher'))
    vi.mocked(resolveClassroomAccess).mockResolvedValue(context('member'))

    await expect(authorizeClassroomMaterialRequest(classroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).rejects.toMatchObject({ statusCode: 403 })
    expect(requireRole).not.toHaveBeenCalled()
  })

  it('preserves archived owner reads and denies archived member participation', async () => {
    vi.mocked(resolveClassroomAccess).mockResolvedValue(context('owner', true))
    expect((await authorizeClassroomMaterialRequest(classroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).mode).toBe('contextual')
    vi.mocked(resolveClassroomAccess).mockResolvedValue(context('member', true))
    await expect(authorizeClassroomMaterialRequest(classroomId, {
      legacyRole: 'student',
      permission: 'member',
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('distinguishes absence from resolver failure and never falls back', async () => {
    vi.mocked(resolveClassroomAccess).mockResolvedValue(null)
    await expect(authorizeClassroomMaterialRequest(classroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).rejects.toMatchObject({ statusCode: 404 })
    vi.mocked(resolveClassroomAccess).mockRejectedValue(new Error('database unavailable'))
    await expect(authorizeClassroomMaterialRequest(classroomId, {
      legacyRole: 'teacher',
      permission: 'owner',
    })).rejects.toThrow('database unavailable')
  })

  it('matches canonical UUID pairs and rejects PostgreSQL aliases', async () => {
    vi.mocked(resolveClassroomAccess).mockResolvedValue(context('owner'))
    expect((await authorizeClassroomMaterialRequest(classroomId.toUpperCase(), {
      legacyRole: 'teacher',
      permission: 'owner',
    })).mode).toBe('contextual')
    expect(resolveClassroomAccess).toHaveBeenCalledWith(actorId, classroomId)
    vi.mocked(requireAuth).mockResolvedValue(user('teacher'))
    await expect(authorizeClassroomMaterialRequest(classroomId.replaceAll('-', ''), {
      legacyRole: 'teacher',
      permission: 'owner',
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('validates contextual material rows and exact classroom binding', () => {
    expect(() => assertContextualMaterialRows(classroomId, [{
      id: materialId,
      classroom_id: classroomId,
      title: 'Reference',
    }])).not.toThrow()

    for (const rows of [
      null,
      {},
      [{ id: 'invalid', classroom_id: classroomId }],
      [{ id: materialId, classroom_id: otherClassroomId }],
    ]) {
      expect(() => assertContextualMaterialRows(classroomId, rows))
        .toThrowError(expect.objectContaining({ statusCode: 503 }))
    }
  })

  it('requires contextual member material rows to prove published visibility', () => {
    expect(() => assertContextualPublishedMaterialRows(classroomId, [{
      id: materialId,
      classroom_id: classroomId,
      is_draft: false,
    }])).not.toThrow()

    for (const rows of [
      [{ id: materialId, classroom_id: classroomId, is_draft: true }],
      [{ id: materialId, classroom_id: classroomId }],
      [{ id: materialId, classroom_id: otherClassroomId, is_draft: false }],
    ]) {
      expect(() => assertContextualPublishedMaterialRows(classroomId, rows))
        .toThrowError(expect.objectContaining({ statusCode: 503 }))
    }

    expect(() => assertContextualMaterialRows(classroomId, [{
      id: materialId,
      classroom_id: classroomId,
      is_draft: true,
    }])).not.toThrow()
  })
})
