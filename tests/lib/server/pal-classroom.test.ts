import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))
import { createMembershipPalReadTokenCoordinator, resolvePalClassroomContext } from '@/lib/server/pal-classroom'

const studentId = 'c1690000-0000-4000-8000-000000000001'
const classroomId = 'c1690000-0000-4000-8000-000000000010'
const active = {
  status: 'active' as const,
  generation_id: 'c1690000-0000-4000-8000-000000000020',
  learner_id: `pika-membership-v1-${'a'.repeat(32)}`,
  scope_key: `pika-classroom-v1-${'a'.repeat(64)}`,
}
const token = { token: 'test-token', expires_at: '2026-09-12T19:05:00Z' }

describe('classroom Pal context and token coordinator', () => {
  beforeEach(() => {
    vi.stubEnv('PAL_CLASSROOM_ENABLED', 'true')
    vi.stubEnv('PAL_MEMBERSHIP_IDENTITY_ENABLED', 'true')
    mocks.client.mockReset().mockReturnValue({ rpc: mocks.rpc })
    mocks.rpc.mockReset().mockResolvedValue({ data: active, error: null })
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each(['', 'false', 'TRUE', '1'])('does no database work when the classroom gate is %j', async flag => {
    vi.stubEnv('PAL_CLASSROOM_ENABLED', flag)
    await expect(resolvePalClassroomContext({ studentId, classroomId })).rejects.toMatchObject({ statusCode: 503 })
    expect(mocks.client).not.toHaveBeenCalled()
  })

  it('requires both application gates and validates the complete narrow database response', async () => {
    expect(await resolvePalClassroomContext({ studentId, classroomId })).toEqual(active)
    expect(mocks.rpc).toHaveBeenCalledWith('resolve_pal_classroom_context', {
      p_student_id: studentId, p_classroom_id: classroomId,
    })
    vi.stubEnv('PAL_MEMBERSHIP_IDENTITY_ENABLED', 'false')
    await expect(resolvePalClassroomContext({ studentId, classroomId })).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([null, { ...active, student_id: studentId }, { ...active, learner_id: studentId }])(
    'rejects malformed/widened results without leaking them', async data => {
      mocks.rpc.mockResolvedValue({ data, error: null })
      await expect(resolvePalClassroomContext({ studentId, classroomId })).rejects.toMatchObject({
        statusCode: 503, message: 'Classroom achievements are unavailable',
      })
    },
  )

  it('does not mask membership denial as a usable profile', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'forbidden' }, error: null })
    await expect(resolvePalClassroomContext({ studentId, classroomId })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('contains database transport errors', async () => {
    mocks.rpc.mockRejectedValue(new Error(`private binding ${studentId}`))
    await expect(resolvePalClassroomContext({ studentId, classroomId })).rejects.toMatchObject({
      message: 'Classroom achievements are unavailable',
    })
  })

  it('rechecks the membership around minting and returns only the token and widget scope', async () => {
    const resolve = vi.fn().mockResolvedValue(active)
    const mint = vi.fn().mockResolvedValue(token)
    const getToken = createMembershipPalReadTokenCoordinator({ resolve, mint })
    expect(await getToken({ studentId, classroomId, scopeKey: active.scope_key })).toEqual({ ...token, scope_key: active.scope_key })
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(mint).toHaveBeenCalledWith({ learnerReference: active.learner_id })
  })

  it('rejects a previous generation before any mint, without a legacy fallback', async () => {
    const mint = vi.fn()
    const getToken = createMembershipPalReadTokenCoordinator({ resolve: vi.fn().mockResolvedValue(active), mint })
    await expect(getToken({ studentId, classroomId, scopeKey: 'old-scope' })).rejects.toMatchObject({ statusCode: 403 })
    expect(mint).not.toHaveBeenCalled()
  })

  it('discards a mint result if removal or re-add changes the generation during the network call', async () => {
    const resolve = vi.fn().mockResolvedValueOnce(active).mockResolvedValueOnce({ ...active, generation_id: classroomId })
    const getToken = createMembershipPalReadTokenCoordinator({ resolve, mint: vi.fn().mockResolvedValue(token) })
    await expect(getToken({ studentId, classroomId, scopeKey: active.scope_key })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('reauthorizes every request even if the broker returns a cached token', async () => {
    const resolve = vi.fn().mockResolvedValueOnce(active).mockResolvedValueOnce(active)
      .mockRejectedValueOnce(Object.assign(new Error('denied'), { statusCode: 403 }))
    const mint = vi.fn().mockResolvedValue(token)
    const getToken = createMembershipPalReadTokenCoordinator({ resolve, mint })
    await getToken({ studentId, classroomId, scopeKey: active.scope_key })
    await expect(getToken({ studentId, classroomId, scopeKey: active.scope_key })).rejects.toMatchObject({ statusCode: 403 })
    expect(mint).toHaveBeenCalledTimes(1)
  })
})
