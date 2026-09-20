import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authorizeContextualAssignmentDocSubmissionRequest } from '@/lib/server/contextual-assignment-doc-access'
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
const teacher = { id: actorId, role: 'teacher', email: 'member@example.com' }
const student = { id: actorId, role: 'student', email: 'member@example.com' }

describe('contextual assignment document submission access', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_SUBMISSION_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_SUBMISSION_ACCESS_PAIRS', JSON.stringify([{
      userId: actorId,
      assignmentId,
    }]))
    vi.mocked(requireAuth).mockResolvedValue(teacher as any)
    vi.mocked(requireRole).mockResolvedValue(student as any)
  })

  afterEach(() => vi.unstubAllEnvs())

  it('preserves legacy auth-before-params behavior when disabled', async () => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_SUBMISSION_ACCESS_ENABLED', 'false')
    const resolveId = vi.fn(async () => assignmentId)

    await expect(authorizeContextualAssignmentDocSubmissionRequest(resolveId)).resolves.toEqual({
      mode: 'legacy',
      user: student,
      assignmentId,
    })
    expect(requireRole).toHaveBeenCalledWith('student')
    expect(requireAuth).not.toHaveBeenCalled()
    expect(requireRole.mock.invocationCallOrder[0]).toBeLessThan(resolveId.mock.invocationCallOrder[0])
  })

  it('admits one exact teacher-valued pair without cross-producting the cohort', async () => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_SUBMISSION_ACCESS_PAIRS', JSON.stringify([
      { userId: actorId, assignmentId },
      { userId: otherActorId, assignmentId: otherAssignmentId },
    ]))

    await expect(authorizeContextualAssignmentDocSubmissionRequest(assignmentId.toUpperCase()))
      .resolves.toEqual({ mode: 'contextual', user: teacher, assignmentId })
    await expect(authorizeContextualAssignmentDocSubmissionRequest(otherAssignmentId))
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
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_SUBMISSION_ACCESS_PAIRS', pairs)
    await expect(authorizeContextualAssignmentDocSubmissionRequest(assignmentId))
      .rejects.toMatchObject({ statusCode: 503 })
  })

  it('keeps an unmatched student on the exact legacy path', async () => {
    vi.mocked(requireAuth).mockResolvedValue(student as any)
    await expect(authorizeContextualAssignmentDocSubmissionRequest(otherAssignmentId))
      .resolves.toEqual({ mode: 'legacy', user: student, assignmentId: otherAssignmentId })
  })
})
