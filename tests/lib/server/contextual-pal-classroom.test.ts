import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), abortSignal: vi.fn(), mint: vi.fn(), invalidate: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ rpc: (...args: unknown[]) => {
  const response = mocks.rpc(...args)
  return { then: response.then.bind(response), abortSignal: (signal: AbortSignal) => { mocks.abortSignal(signal); return response } }
} }) }))
vi.mock('@/lib/server/pal-read-token', () => ({ getPalReadTokenForMembership: mocks.mint, invalidatePalReadTokenForMembership: mocks.invalidate }))
import { getContextualPalReadToken, recordContextualPalClassroomVisit, resolveContextualPalClassroomContext } from '@/lib/server/contextual-pal-classroom'

const studentId = 'c1690000-0000-4000-8000-000000000002'
const classroomId = 'c1690000-0000-4000-8000-000000000010'
const active = { status: 'active', generation_id: 'c1690000-0000-4000-8000-000000000020',
  learner_id: `pika-membership-v1-${'a'.repeat(32)}`, scope_key: `pika-classroom-v1-${'a'.repeat(64)}` }
const envelope = (data: unknown) => ({ data, error: null, status: 200, statusText: 'OK', count: null })

describe('contextual Pal member adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PAL_CLASSROOM_ENABLED', 'true')
    vi.stubEnv('PAL_MEMBERSHIP_IDENTITY_ENABLED', 'true')
    mocks.rpc.mockReset().mockResolvedValue(envelope(active))
    mocks.mint.mockReset().mockResolvedValue({ token: 'synthetic', expires_at: '2026-10-19T20:00:00Z' })
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it('uses only the contextual exact-pair RPC and returns the unchanged context', async () => {
    expect(await resolveContextualPalClassroomContext({ studentId, classroomId })).toEqual(active)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('resolve_pal_classroom_context_for_member_v1', { p_actor_id: studentId, p_classroom_id: classroomId })
    expect(mocks.mint).not.toHaveBeenCalled()
  })

  it.each(['PAL_CLASSROOM_ENABLED', 'PAL_MEMBERSHIP_IDENTITY_ENABLED'])('does not access the database without %s', async flag => {
    vi.stubEnv(flag, 'false')
    await expect(resolveContextualPalClassroomContext({ studentId, classroomId })).rejects.toMatchObject({ statusCode: 503 })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each([null, { ...active, owner_id: studentId }, { status: 'active' }, { status: 'disabled' }])('fails closed on malformed, widened or disabled context: %j', async data => {
    mocks.rpc.mockResolvedValue(envelope(data))
    await expect(resolveContextualPalClassroomContext({ studentId, classroomId })).rejects.toMatchObject({ statusCode: 503, message: 'Classroom achievements are unavailable' })
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })

  it.each(['PGRST202', 'XX000', 'PT409'])('sanitizes errors and never falls back or retries: %s', async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: 'private detail', details: null, hint: null }, status: code === 'PT409' ? 409 : 500, statusText: 'Failure', count: null })
    await expect(resolveContextualPalClassroomContext({ studentId, classroomId })).rejects.toMatchObject({ statusCode: code === 'PT409' ? 409 : 503 })
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })

  it('contains thrown transport failures', async () => {
    mocks.rpc.mockRejectedValue(new Error('private detail'))
    await expect(recordContextualPalClassroomVisit({ studentId, classroomId })).rejects.toMatchObject({ statusCode: 503, message: 'Classroom achievements are unavailable' })
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })

  it('denies an owner before mint and invalidates a late mint when ownership changes', async () => {
    mocks.rpc.mockResolvedValue(envelope({ status: 'forbidden' }))
    await expect(getContextualPalReadToken({ studentId, classroomId, scopeKey: active.scope_key })).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.mint).not.toHaveBeenCalled()
    mocks.rpc.mockResolvedValueOnce(envelope(active)).mockResolvedValueOnce(envelope({ status: 'forbidden' }))
    await expect(getContextualPalReadToken({ studentId, classroomId, scopeKey: active.scope_key })).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.mint).toHaveBeenCalledOnce()
    expect(mocks.invalidate).toHaveBeenCalledWith(active.learner_id)
  })

  it('reauthorizes both sides of a cached membership mint', async () => {
    const input = { studentId, classroomId, scopeKey: active.scope_key }
    await expect(getContextualPalReadToken(input)).resolves.toMatchObject({ scope_key: active.scope_key })
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.rpc.mock.calls.every(([name]) => name === 'resolve_pal_classroom_context_for_member_v1')).toBe(true)
  })

  it('uses atomic contextual capture without legacy visit fallback', async () => {
    mocks.rpc.mockResolvedValue(envelope({ status: 'recorded' }))
    await expect(recordContextualPalClassroomVisit({ studentId, classroomId })).resolves.toBeUndefined()
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('record_pal_classroom_visit_for_member_v1', { p_actor_id: studentId, p_classroom_id: classroomId })
    mocks.rpc.mockResolvedValue(envelope({ status: 'forbidden' }))
    await expect(recordContextualPalClassroomVisit({ studentId, classroomId })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects stale generations and scope before returning a token', async () => {
    await expect(getContextualPalReadToken({ studentId, classroomId, scopeKey: `pika-classroom-v1-${'b'.repeat(64)}` })).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.mint).not.toHaveBeenCalled()
    mocks.rpc.mockResolvedValueOnce(envelope(active)).mockResolvedValueOnce(envelope({ ...active, generation_id: classroomId }))
    await expect(getContextualPalReadToken({ studentId, classroomId, scopeKey: active.scope_key })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('does no database work for invalid internal identifiers', async () => {
    await expect(resolveContextualPalClassroomContext({ studentId: 'not-an-id', classroomId })).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each([
    { ...envelope(active), status: 302 }, { ...envelope(active), status: 503 },
    { ...envelope(active), status: '200' }, { ...envelope(active), count: '1' },
    { ...envelope(active), count: 2 }, { ...envelope(active), count: 0 },
    { ...envelope(active), count: -1 }, { ...envelope(active), extraEvidence: true },
    { ...envelope(active), error: { code: 'PT409', message: 'private', details: null, hint: null }, status: 409 },
    { data: active }, { error: null, status: 200 },
    Object.assign(Object.create({ data: active, error: null }), { status: 200 }),
  ])('rejects ambiguous, widened or failed SDK envelopes: %j', async raw => {
    mocks.rpc.mockResolvedValue(raw)
    await expect(resolveContextualPalClassroomContext({ studentId, classroomId })).rejects.toMatchObject({ statusCode: 503 })
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })

  it('accepts exact one-row count and attaches a bounded abort signal without retry', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    mocks.rpc.mockResolvedValue({ ...envelope(active), count: 1 })
    await expect(resolveContextualPalClassroomContext({ studentId, classroomId })).resolves.toEqual(active)
    expect(mocks.abortSignal).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal))
    expect(timeout).toHaveBeenCalledExactlyOnceWith(10_000)
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })

  it('contains an aborted uncertain visit without a second attempt', async () => {
    mocks.rpc.mockRejectedValue(new DOMException('request aborted', 'AbortError'))
    await expect(recordContextualPalClassroomVisit({ studentId, classroomId })).rejects.toMatchObject({ statusCode: 503 })
    expect(mocks.rpc).toHaveBeenCalledOnce()
    expect(mocks.abortSignal).toHaveBeenCalledOnce()
  })
})
