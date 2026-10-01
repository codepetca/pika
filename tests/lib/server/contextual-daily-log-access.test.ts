import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { requireAuth, requireRole } from '@/lib/auth'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import { authorizeContextualDailyLogRequest } from '@/lib/server/contextual-daily-log-access'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}))
vi.mock('@/lib/server/classroom-access', () => ({ resolveClassroomAccess: vi.fn() }))

const actorId = '11111111-1111-4111-8111-111111111111'
const ownerId = '22222222-2222-4222-8222-222222222222'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const student = { id: actorId, role: 'student' as const, email: 'student@example.com' }
const teacher = { id: actorId, role: 'teacher' as const, email: 'teacher@example.com' }

describe('contextual daily-log save access', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(requireAuth).mockResolvedValue(student)
    vi.mocked(requireRole).mockResolvedValue(student)
  })

  afterEach(() => vi.unstubAllEnvs())

  it('uses the exact legacy student guard while admission is absent', async () => {
    await expect(authorizeContextualDailyLogRequest(classroomId)).resolves.toEqual({
      mode: 'legacy', user: student, classroomId,
    })
    expect(requireRole).toHaveBeenCalledWith('student')
    expect(requireAuth).not.toHaveBeenCalled()
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
  })

  it('does not parse a body callback before the legacy authentication guard', async () => {
    vi.mocked(requireRole).mockRejectedValue({ name: 'AuthenticationError' })
    const resolveId = vi.fn()

    await expect(authorizeContextualDailyLogRequest(resolveId)).rejects.toMatchObject({ name: 'AuthenticationError' })
    expect(resolveId).not.toHaveBeenCalled()
  })

  it('authenticates before resolving malformed shared-admission configuration', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', 'not-json')
    const resolveId = vi.fn().mockResolvedValue(classroomId)

    await expect(authorizeContextualDailyLogRequest(resolveId)).rejects.toMatchObject({ statusCode: 503 })
    expect(requireAuth).toHaveBeenCalledOnce()
    expect(resolveId).not.toHaveBeenCalled()
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
  })

  it('does not parse a body callback before configured legacy wrong-role rejection', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
    vi.mocked(requireAuth).mockResolvedValue(teacher)
    const resolveId = vi.fn()

    await expect(authorizeContextualDailyLogRequest(resolveId)).rejects.toMatchObject({ name: 'AuthorizationError' })
    expect(resolveId).not.toHaveBeenCalled()
  })

  it('keeps a configured but non-admitted actor on the legacy student role behavior', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
    await expect(authorizeContextualDailyLogRequest(classroomId)).resolves.toEqual({
      mode: 'legacy', user: student, classroomId,
    })
    expect(requireAuth).toHaveBeenCalledOnce()
    expect(resolveClassroomAccess).not.toHaveBeenCalled()

    vi.mocked(requireAuth).mockResolvedValue(teacher)
    await expect(authorizeContextualDailyLogRequest(classroomId)).rejects.toMatchObject({ name: 'AuthorizationError' })
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
  })

  it('admits an enrolled global teacher through membership rather than the legacy role', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.mocked(requireAuth).mockResolvedValue(teacher)
    vi.mocked(resolveClassroomAccess).mockResolvedValue({
      userId: actorId, classroomId, ownerId, relationship: 'member', archived: false,
    })

    await expect(authorizeContextualDailyLogRequest(classroomId)).resolves.toMatchObject({
      mode: 'contextual', user: teacher, classroomId,
    })
  })

  it.each([
    { relationship: 'owner' as const, archived: false },
    { relationship: 'member' as const, archived: true },
    { relationship: 'none' as const, archived: false },
  ])('rejects admitted non-participants %#', async (access) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.mocked(resolveClassroomAccess).mockResolvedValue({
      userId: actorId,
      classroomId,
      ownerId: access.relationship === 'owner' ? actorId : ownerId,
      relationship: access.relationship,
      archived: access.archived,
    })

    await expect(authorizeContextualDailyLogRequest(classroomId)).rejects.toMatchObject({ statusCode: 403 })
  })
})
