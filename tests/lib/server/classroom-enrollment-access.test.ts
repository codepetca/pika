import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAuth, requireRole } from '@/lib/auth'
import {
  authenticateClassroomEnrollmentRequest,
  selectAuthenticatedClassroomEnrollmentMode,
} from '@/lib/server/classroom-enrollment-access'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(), requireAuth: vi.fn(), requireRole: vi.fn(),
}))

const userId = '11111111-1111-4111-8111-111111111111'
const otherUserId = '22222222-2222-4222-8222-222222222222'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherClassroomId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const user = (id = userId, role = 'teacher') => ({ id, role, email: 'private@example.com' } as AuthenticatedUser)

describe('dormant contextual enrollment access', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_ENROLLMENT_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ENROLLMENT_ACCESS_PAIRS', JSON.stringify([{ userId, classroomId }]))
    vi.mocked(requireAuth).mockResolvedValue(user())
    vi.mocked(requireRole).mockResolvedValue(user(userId, 'student'))
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it.each(['false', '', 'TRUE', '1'])('preserves the exact student guard while disabled with %j', async (flag) => {
    vi.stubEnv('PIKA_CLASSROOM_ENROLLMENT_ACCESS_ENABLED', flag)
    expect(await authenticateClassroomEnrollmentRequest()).toEqual({ mode: 'legacy', user: user(userId, 'student') })
    expect(requireRole).toHaveBeenCalledWith('student')
    expect(requireAuth).not.toHaveBeenCalled()
  })

  it.each([
    '', 'not-json', '{}', '[{"userId":"*","classroomId":"*"}]',
    JSON.stringify([{ userId, classroomId, extra: true }]),
    JSON.stringify(Array(101).fill({ userId, classroomId })),
    ' '.repeat(20_001),
  ])('fails closed before returning authority for invalid enabled configuration', async (pairs) => {
    vi.stubEnv('PIKA_CLASSROOM_ENROLLMENT_ACCESS_PAIRS', pairs)
    await expect(authenticateClassroomEnrollmentRequest()).rejects.toMatchObject({ statusCode: 503 })
    expect(requireRole).not.toHaveBeenCalled()
  })

  it('admits an exact teacher-valued pair without mutating the global role', async () => {
    const authenticated = await authenticateClassroomEnrollmentRequest()
    expect(authenticated).toMatchObject({ mode: 'contextual_lookup', allowedClassroomIds: [classroomId] })
    expect(selectAuthenticatedClassroomEnrollmentMode(authenticated, classroomId))
      .toEqual({ mode: 'contextual_candidate', user: user() })
  })

  it('keeps an expected-role noncohort request on the legacy path', async () => {
    vi.mocked(requireAuth).mockResolvedValue(user(otherUserId, 'student'))
    const authenticated = await authenticateClassroomEnrollmentRequest()
    expect(selectAuthenticatedClassroomEnrollmentMode(authenticated, classroomId).mode).toBe('legacy')
  })

  it('keeps a paired student on the legacy path for every classroom', async () => {
    vi.mocked(requireAuth).mockResolvedValue(user(userId, 'student'))
    const authenticated = await authenticateClassroomEnrollmentRequest()
    expect(authenticated).toMatchObject({ mode: 'legacy' })
    expect(selectAuthenticatedClassroomEnrollmentMode(authenticated, otherClassroomId).mode).toBe('legacy')
  })

  it('denies a wrong-role noncohort user before classroom resolution', async () => {
    vi.mocked(requireAuth).mockResolvedValue(user(otherUserId))
    await expect(authenticateClassroomEnrollmentRequest())
      .rejects.toThrow(expect.objectContaining({ name: 'AuthorizationError' }))
  })

  it('never cross-products pair entries or admits a mismatched resolved classroom', async () => {
    vi.stubEnv('PIKA_CLASSROOM_ENROLLMENT_ACCESS_PAIRS', JSON.stringify([
      { userId, classroomId }, { userId: otherUserId, classroomId: otherClassroomId },
    ]))
    const authenticated = await authenticateClassroomEnrollmentRequest()
    expect(authenticated).toMatchObject({ mode: 'contextual_lookup', allowedClassroomIds: [classroomId] })
    expect(() => selectAuthenticatedClassroomEnrollmentMode(authenticated, otherClassroomId))
      .toThrow(expect.objectContaining({ name: 'AuthorizationError' }))
  })

  it('rejects structurally fabricated authentication evidence', () => {
    expect(() => selectAuthenticatedClassroomEnrollmentMode({
      mode: 'contextual_lookup',
      user: user(otherUserId),
      allowedClassroomIds: [classroomId],
    } as never, classroomId)).toThrow(expect.objectContaining({ statusCode: 503 }))
  })

  it('freezes authentic contextual evidence so its lookup scope cannot be widened', async () => {
    const authenticated = await authenticateClassroomEnrollmentRequest()
    expect(authenticated.mode).toBe('contextual_lookup')
    if (authenticated.mode !== 'contextual_lookup') throw new Error('Expected contextual lookup evidence')

    expect(Object.isFrozen(authenticated)).toBe(true)
    expect(Object.isFrozen(authenticated.allowedClassroomIds)).toBe(true)
    expect(() => (authenticated.allowedClassroomIds as string[]).push(otherClassroomId)).toThrow()
    expect(() => selectAuthenticatedClassroomEnrollmentMode(authenticated, otherClassroomId))
      .toThrow(expect.objectContaining({ name: 'AuthorizationError' }))
  })

  it('matches canonical UUID casing and rejects invalid target IDs without fallback', async () => {
    const authenticated = await authenticateClassroomEnrollmentRequest()
    expect(selectAuthenticatedClassroomEnrollmentMode(authenticated, classroomId.toUpperCase()).mode).toBe('contextual_candidate')
    expect(() => selectAuthenticatedClassroomEnrollmentMode(authenticated, 'invalid'))
      .toThrow(expect.objectContaining({ statusCode: 400 }))
  })

  it('requires authentication and a canonical server identity before pair selection', async () => {
    vi.mocked(requireAuth).mockRejectedValueOnce(new Error('no session'))
    await expect(authenticateClassroomEnrollmentRequest()).rejects.toThrow('no session')
    vi.mocked(requireAuth).mockResolvedValueOnce(user('invalid'))
    await expect(authenticateClassroomEnrollmentRequest()).rejects.toMatchObject({ statusCode: 503 })
  })

  it('treats an intentionally empty cohort as legacy for expected-role users', async () => {
    vi.stubEnv('PIKA_CLASSROOM_ENROLLMENT_ACCESS_PAIRS', '[]')
    vi.mocked(requireAuth).mockResolvedValue(user(userId, 'student'))
    const authenticated = await authenticateClassroomEnrollmentRequest()
    expect(selectAuthenticatedClassroomEnrollmentMode(authenticated, classroomId).mode).toBe('legacy')
  })
})
