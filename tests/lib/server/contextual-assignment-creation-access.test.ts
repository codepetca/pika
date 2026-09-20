import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authorizeContextualAssignmentCreationRequest } from '@/lib/server/contextual-assignment-creation-access'
import { requireAuth, requireRole } from '@/lib/auth'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}))

const actorId = '11111111-1111-4111-8111-111111111111'
const otherActorId = '22222222-2222-4222-8222-222222222222'
const classroomId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const otherClassroomId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const teacher = { id: actorId, role: 'teacher', email: 'owner@example.com' }
const student = { id: actorId, role: 'student', email: 'owner@example.com' }

describe('contextual assignment creation access', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_CREATION_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_CREATION_ACCESS_PAIRS', JSON.stringify([{
      userId: actorId,
      classroomId,
    }]))
    vi.mocked(requireAuth).mockResolvedValue(teacher as any)
    vi.mocked(requireRole).mockResolvedValue(teacher as any)
  })

  afterEach(() => vi.unstubAllEnvs())

  it('preserves legacy teacher auth before body resolution when disabled', async () => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_CREATION_ACCESS_ENABLED', 'false')
    const resolveId = vi.fn(async () => classroomId)

    await expect(authorizeContextualAssignmentCreationRequest(resolveId)).resolves.toEqual({
      mode: 'legacy',
      user: teacher,
      classroomId,
    })
    expect(requireRole).toHaveBeenCalledWith('teacher')
    expect(requireAuth).not.toHaveBeenCalled()
    expect(requireRole.mock.invocationCallOrder[0]).toBeLessThan(resolveId.mock.invocationCallOrder[0])
  })

  it.each([teacher, student])('admits an exact pair for a $role-valued owner', async (user) => {
    vi.mocked(requireAuth).mockResolvedValue(user as any)
    await expect(authorizeContextualAssignmentCreationRequest(classroomId.toUpperCase()))
      .resolves.toEqual({ mode: 'contextual', user, classroomId })
  })

  it('does not cross-product independently configured users and Classrooms', async () => {
    vi.mocked(requireAuth).mockResolvedValue(student as any)
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_CREATION_ACCESS_PAIRS', JSON.stringify([
      { userId: actorId, classroomId },
      { userId: otherActorId, classroomId: otherClassroomId },
    ]))
    await expect(authorizeContextualAssignmentCreationRequest(otherClassroomId))
      .rejects.toMatchObject({ name: 'AuthorizationError' })
  })

  it('keeps an unmatched teacher on the legacy path', async () => {
    await expect(authorizeContextualAssignmentCreationRequest(otherClassroomId)).resolves.toEqual({
      mode: 'legacy',
      user: teacher,
      classroomId: otherClassroomId,
    })
  })

  it('denies an unmatched student as the legacy teacher boundary would', async () => {
    vi.mocked(requireAuth).mockResolvedValue(student as any)
    await expect(authorizeContextualAssignmentCreationRequest(otherClassroomId))
      .rejects.toMatchObject({ name: 'AuthorizationError' })
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
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_CREATION_ACCESS_PAIRS', pairs)
    await expect(authorizeContextualAssignmentCreationRequest(classroomId))
      .rejects.toMatchObject({ statusCode: 503 })
  })
})
