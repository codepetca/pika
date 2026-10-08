import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { requireAuth, requireRole } from '@/lib/auth'
import { authorizeContextualClassworkReorderRequest } from '@/lib/server/contextual-classwork-reorder-access'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}))

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const otherClassroomId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const teacher = { id: actorId, role: 'teacher', email: 'owner@example.com' }
const student = { ...teacher, role: 'student' }

describe('contextual classwork reorder access', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_CLASSWORK_REORDER_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_CLASSWORK_REORDER_ACCESS_PAIRS', JSON.stringify([{ userId: actorId, classroomId }]))
    vi.mocked(requireAuth).mockResolvedValue(teacher as any)
    vi.mocked(requireRole).mockResolvedValue(teacher as any)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('preserves teacher auth before resolving the Classroom when disabled', async () => {
    vi.stubEnv('PIKA_CLASSROOM_CLASSWORK_REORDER_ACCESS_ENABLED', 'false')
    const resolveId = vi.fn(async () => classroomId)
    await expect(authorizeContextualClassworkReorderRequest(resolveId))
      .resolves.toMatchObject({ mode: 'legacy' })
    expect(requireRole.mock.invocationCallOrder[0]).toBeLessThan(resolveId.mock.invocationCallOrder[0])
    expect(requireAuth).not.toHaveBeenCalled()
  })

  it.each([teacher, student])('admits an exact pair for a $role-valued owner', async (user) => {
    vi.mocked(requireAuth).mockResolvedValue(user as any)
    await expect(authorizeContextualClassworkReorderRequest(classroomId.toUpperCase()))
      .resolves.toEqual({ mode: 'contextual', user, classroomId })
  })

  it('keeps an unmatched teacher legacy and denies an unmatched student', async () => {
    await expect(authorizeContextualClassworkReorderRequest(otherClassroomId))
      .resolves.toMatchObject({ mode: 'legacy', classroomId: otherClassroomId })
    vi.mocked(requireAuth).mockResolvedValue(student as any)
    await expect(authorizeContextualClassworkReorderRequest(otherClassroomId))
      .rejects.toMatchObject({ name: 'AuthorizationError' })
  })

  it.each(['', 'not-json', '{}', '[{"userId":"*","classroomId":"*"}]', ' '.repeat(20_001)])(
    'fails closed for invalid enabled configuration',
    async (pairs) => {
      vi.stubEnv('PIKA_CLASSROOM_CLASSWORK_REORDER_ACCESS_PAIRS', pairs)
      await expect(authorizeContextualClassworkReorderRequest(classroomId))
        .rejects.toMatchObject({ statusCode: 503 })
    },
  )
})
