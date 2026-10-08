import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  authorizeContextualAssignmentDocHistoryRequest,
  authorizeContextualAssignmentDocRestoreRequest,
} from '@/lib/server/contextual-assignment-doc-access'
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

describe('contextual assignment document history access', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_HISTORY_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_HISTORY_ACCESS_PAIRS', JSON.stringify([{
      userId: actorId,
      assignmentId,
    }]))
    vi.mocked(requireAuth).mockResolvedValue(teacher as any)
    vi.mocked(requireRole).mockResolvedValue(student as any)
  })

  afterEach(() => vi.unstubAllEnvs())

  it('preserves legacy history authentication before resolving params when disabled', async () => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_HISTORY_ACCESS_ENABLED', 'false')
    const resolveId = vi.fn(async () => assignmentId)

    await expect(authorizeContextualAssignmentDocHistoryRequest(resolveId)).resolves.toEqual({
      mode: 'legacy', user: teacher, assignmentId,
    })
    expect(requireAuth).toHaveBeenCalledOnce()
    expect(requireRole).not.toHaveBeenCalled()
    expect(requireAuth.mock.invocationCallOrder[0]).toBeLessThan(resolveId.mock.invocationCallOrder[0])
  })

  it('preserves legacy student-only restore authorization when disabled', async () => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_HISTORY_ACCESS_ENABLED', 'false')
    const resolveId = vi.fn(async () => assignmentId)

    await expect(authorizeContextualAssignmentDocRestoreRequest(resolveId)).resolves.toEqual({
      mode: 'legacy', user: student, assignmentId,
    })
    expect(requireRole).toHaveBeenCalledWith('student')
    expect(requireAuth).not.toHaveBeenCalled()
    expect(requireRole.mock.invocationCallOrder[0]).toBeLessThan(resolveId.mock.invocationCallOrder[0])
  })

  it('admits one exact teacher-valued pair without cross-producting the cohort', async () => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_HISTORY_ACCESS_PAIRS', JSON.stringify([
      { userId: actorId, assignmentId },
      { userId: otherActorId, assignmentId: otherAssignmentId },
    ]))

    await expect(authorizeContextualAssignmentDocHistoryRequest(assignmentId.toUpperCase()))
      .resolves.toEqual({ mode: 'contextual', user: teacher, assignmentId })
    await expect(authorizeContextualAssignmentDocRestoreRequest(assignmentId))
      .resolves.toEqual({ mode: 'contextual', user: teacher, assignmentId })
    await expect(authorizeContextualAssignmentDocRestoreRequest(otherAssignmentId))
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
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_HISTORY_ACCESS_PAIRS', pairs)
    await expect(authorizeContextualAssignmentDocHistoryRequest(assignmentId))
      .rejects.toMatchObject({ statusCode: 503 })
  })

  it('keeps unmatched history requests on the authenticated legacy path', async () => {
    await expect(authorizeContextualAssignmentDocHistoryRequest(otherAssignmentId)).resolves.toEqual({
      mode: 'legacy', user: teacher, assignmentId: otherAssignmentId,
    })
  })

  it('keeps an unmatched student restore on the legacy path', async () => {
    vi.mocked(requireAuth).mockResolvedValue(student as any)
    await expect(authorizeContextualAssignmentDocRestoreRequest(otherAssignmentId)).resolves.toEqual({
      mode: 'legacy', user: student, assignmentId: otherAssignmentId,
    })
  })
})
