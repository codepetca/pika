import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authorizeContextualAssignmentGradingRequest } from '@/lib/server/contextual-assignment-grading-access'
import { requireAuth, requireRole } from '@/lib/auth'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}))

const actorId = '11111111-1111-4111-8111-111111111111'
const otherActorId = '22222222-2222-4222-8222-222222222222'
const assignmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherAssignmentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const teacher = { id: actorId, role: 'teacher', email: 'owner@example.com' }
const student = { id: actorId, role: 'student', email: 'owner@example.com' }

describe('contextual assignment grading access', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_GRADING_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_GRADING_ACCESS_PAIRS', JSON.stringify([{
      userId: actorId,
      assignmentId,
    }]))
    vi.mocked(requireAuth).mockResolvedValue(teacher as any)
    vi.mocked(requireRole).mockResolvedValue(teacher as any)
  })

  afterEach(() => vi.unstubAllEnvs())

  it('preserves legacy teacher auth before params when disabled', async () => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_GRADING_ACCESS_ENABLED', 'false')
    const resolveId = vi.fn(async () => assignmentId)

    await expect(authorizeContextualAssignmentGradingRequest(resolveId)).resolves.toEqual({
      mode: 'legacy',
      user: teacher,
      assignmentId,
    })
    expect(requireRole).toHaveBeenCalledWith('teacher')
    expect(requireAuth).not.toHaveBeenCalled()
    expect(requireRole.mock.invocationCallOrder[0]).toBeLessThan(resolveId.mock.invocationCallOrder[0])
  })

  it.each([teacher, student])('admits an exact pair for a $role-valued owner', async (user) => {
    vi.mocked(requireAuth).mockResolvedValue(user as any)
    await expect(authorizeContextualAssignmentGradingRequest(assignmentId.toUpperCase()))
      .resolves.toEqual({ mode: 'contextual', user, assignmentId })
  })

  it('does not cross-product independently configured users and assignments', async () => {
    vi.mocked(requireAuth).mockResolvedValue(student as any)
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_GRADING_ACCESS_PAIRS', JSON.stringify([
      { userId: actorId, assignmentId },
      { userId: otherActorId, assignmentId: otherAssignmentId },
    ]))
    await expect(authorizeContextualAssignmentGradingRequest(otherAssignmentId))
      .rejects.toMatchObject({ name: 'AuthorizationError' })
  })

  it('keeps an unmatched teacher on the legacy path', async () => {
    await expect(authorizeContextualAssignmentGradingRequest(otherAssignmentId)).resolves.toEqual({
      mode: 'legacy',
      user: teacher,
      assignmentId: otherAssignmentId,
    })
  })

  it('denies an unmatched student as the legacy teacher boundary would', async () => {
    vi.mocked(requireAuth).mockResolvedValue(student as any)
    await expect(authorizeContextualAssignmentGradingRequest(otherAssignmentId))
      .rejects.toMatchObject({ name: 'AuthorizationError' })
  })

  it.each([
    '',
    'not-json',
    '{}',
    '[{"userId":"*","assignmentId":"*"}]',
    JSON.stringify([{ userId: actorId, assignmentId, extra: true }]),
    JSON.stringify(Array(101).fill({ userId: actorId, assignmentId })),
    ' '.repeat(20_001),
  ])('fails closed for invalid enabled configuration', async (pairs) => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_GRADING_ACCESS_PAIRS', pairs)
    await expect(authorizeContextualAssignmentGradingRequest(assignmentId))
      .rejects.toMatchObject({ statusCode: 503 })
  })
})
