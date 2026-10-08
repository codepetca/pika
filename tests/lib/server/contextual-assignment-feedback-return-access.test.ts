import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { requireAuth, requireRole } from '@/lib/auth'
import { authorizeContextualAssignmentFeedbackReturnRequest } from '@/lib/server/contextual-assignment-feedback-return-access'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}))

const actorId = '11111111-1111-4111-8111-111111111111'
const assignmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherAssignmentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const teacher = { id: actorId, role: 'teacher', email: 'owner@example.com' }
const student = { ...teacher, role: 'student' }

describe('contextual assignment feedback-return access', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_FEEDBACK_RETURN_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_FEEDBACK_RETURN_ACCESS_PAIRS', JSON.stringify([{ userId: actorId, assignmentId }]))
    vi.mocked(requireAuth).mockResolvedValue(teacher as any)
    vi.mocked(requireRole).mockResolvedValue(teacher as any)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('preserves teacher auth before params when disabled', async () => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_FEEDBACK_RETURN_ACCESS_ENABLED', 'false')
    const resolveId = vi.fn(async () => assignmentId)
    await expect(authorizeContextualAssignmentFeedbackReturnRequest(resolveId)).resolves.toMatchObject({ mode: 'legacy' })
    expect(requireRole.mock.invocationCallOrder[0]).toBeLessThan(resolveId.mock.invocationCallOrder[0])
    expect(requireAuth).not.toHaveBeenCalled()
  })

  it.each([teacher, student])('admits an exact pair for a $role-valued owner', async (user) => {
    vi.mocked(requireAuth).mockResolvedValue(user as any)
    await expect(authorizeContextualAssignmentFeedbackReturnRequest(assignmentId.toUpperCase()))
      .resolves.toEqual({ mode: 'contextual', user, assignmentId })
  })

  it('keeps an unmatched teacher legacy and denies an unmatched student', async () => {
    await expect(authorizeContextualAssignmentFeedbackReturnRequest(otherAssignmentId))
      .resolves.toMatchObject({ mode: 'legacy', assignmentId: otherAssignmentId })
    vi.mocked(requireAuth).mockResolvedValue(student as any)
    await expect(authorizeContextualAssignmentFeedbackReturnRequest(otherAssignmentId))
      .rejects.toMatchObject({ name: 'AuthorizationError' })
  })

  it.each(['', 'not-json', '{}', '[{"userId":"*","assignmentId":"*"}]', ' '.repeat(20_001)])(
    'fails closed for invalid enabled configuration',
    async (pairs) => {
      vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_FEEDBACK_RETURN_ACCESS_PAIRS', pairs)
      await expect(authorizeContextualAssignmentFeedbackReturnRequest(assignmentId))
        .rejects.toMatchObject({ statusCode: 503 })
    },
  )
})
