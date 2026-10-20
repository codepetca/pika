import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { teacherAttendancePolicyUpdateSchema } from '@/lib/validations/teacher-attendance-policy'
import { saveContextualAttendancePolicy } from '@/lib/server/contextual-attendance-policy-write'

const { integration, canary } = vi.hoisted(() => ({ integration: vi.fn(), canary: vi.fn() }))
vi.mock('@/lib/server/bara-attendance-client', () => ({ getBaraAttendanceIntegrationState: integration }))
vi.mock('@/lib/server/bara-attendance-canary', () => ({ getBaraAttendanceCanaryScope: canary }))
const actorId = '10000000-0000-4000-8000-000000000001', classroomId = '20000000-0000-4000-8000-000000000001'
const otherId = '30000000-0000-4000-8000-000000000001'
const policy = teacherAttendancePolicyUpdateSchema.parse({ classroom_id: classroomId, session_starts_local: '08:45', session_ends_local: '10:15',
  session_end_day_offset: 0, entry_opens_minutes_before: 10, present_grace_minutes: 5, entry_closes_minutes_before_end: 10,
  absent_minutes_before_end: 0, enabled: true, expected_revision: 1 })
const { expected_revision: _expected, ...values } = policy
const saved = { ...values, timezone: 'America/Toronto', revision: 2, updated_at: '2026-10-19T12:00:00Z' }
const result = () => ({ actor_id: actorId, classroom_id: classroomId, scope_mode: 'exact_canary', policy: saved })
const envelope = (data: unknown) => ({ data, error: null, status: 200, statusText: 'OK', count: null })
const rpc = vi.fn(), abortSignal = vi.fn()
const run = (value = policy) => saveContextualAttendancePolicy({ supabase: { rpc } as never, actorId, policy: value })

describe('contextual attendance owner policy write adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv('PIKA_BARA_ATTENDANCE_SCOPE_MODE', '')
    integration.mockReturnValue('ready'); canary.mockReturnValue({ state: 'ready', teacherId: actorId, classroomId })
    rpc.mockReturnValue({ abortSignal }); abortSignal.mockResolvedValue(envelope(result()))
  })
  afterEach(() => vi.unstubAllEnvs())
  it('uses one bounded typed RPC with server-owned actor/scope and the legacy saved DTO', async () => {
    expect(await run()).toEqual({ classroomId, timezone: 'America/Toronto', sessionStartsLocal: '08:45', sessionEndsLocal: '10:15',
      sessionEndDayOffset: 0, entryOpensMinutesBefore: 10, presentGraceMinutes: 5, entryClosesMinutesBeforeEnd: 10,
      absentMinutesBeforeEnd: 0, enabled: true, revision: 2, updatedAt: saved.updated_at })
    const { classroom_id: _id, ...payload } = policy
    expect(rpc).toHaveBeenCalledExactlyOnceWith('save_attendance_policy_for_owner_v1', { p_actor_id: actorId, p_classroom_id: classroomId,
      p_scope_mode: 'exact_canary', p_policy: payload, p_canary_actor_id: actorId, p_canary_classroom_id: classroomId })
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal))
  })
  it('preserves nullable expected revision for creation', async () => {
    abortSignal.mockResolvedValue(envelope({ ...result(), policy: { ...saved, revision: 1 } }))
    expect((await run({ ...policy, expected_revision: null })).revision).toBe(1)
  })
  it('uses entitlement mode without consulting a canary configuration', async () => {
    vi.stubEnv('PIKA_BARA_ATTENDANCE_SCOPE_MODE', 'teacher_entitlements')
    abortSignal.mockResolvedValue(envelope({ ...result(), scope_mode: 'teacher_entitlements' }))
    await run(); expect(canary).not.toHaveBeenCalled()
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_scope_mode: 'teacher_entitlements', p_canary_actor_id: null, p_canary_classroom_id: null })
  })
  it.each([['PT400',400],['PT403',403],['PT404',404],['PT409',409],['PT503',503]])('maps authoritative%s privately without retry', async (code, statusCode) => {
    abortSignal.mockResolvedValue({ data: null, error: { code, message: 'private-sql', details: 'private-row', hint: null }, status: statusCode, statusText: '', count: null })
    await expect(run()).rejects.toMatchObject({ statusCode })
    try { await run() } catch (error) { expect(String(error)).not.toContain('private') }
    expect(rpc).toHaveBeenCalledTimes(2)
  })
  it.each(['disabled','not_configured'])('refuses%s transport before dispatch', async state => {
    integration.mockReturnValue(state)
    await expect(run()).rejects.toMatchObject({ statusCode: state === 'disabled' ? 404 : 503 }); expect(rpc).not.toHaveBeenCalled()
  })
  it('refuses a misconfigured canary before dispatch', async () => {
    canary.mockReturnValue({ state: 'not_configured' })
    await expect(run()).rejects.toMatchObject({ statusCode: 503 }); expect(rpc).not.toHaveBeenCalled()
  })
  it.each([null, {}, { ...result(), actor_id: otherId }, { ...result(), classroom_id: otherId },
    { ...result(), scope_mode: 'teacher_entitlements' }, { ...result(), extra: true },
    { ...result(), policy: { ...saved, revision: 1 } }, { ...result(), policy: { ...saved, classroom_id: otherId } },
    { ...result(), policy: { ...saved, present_grace_minutes: 6 } }, { ...result(), policy: { ...saved, provider_ref: 'private' } },
    { ...result(), policy: null }])('rejects substituted/widened/unbound write result%#', async data => {
    abortSignal.mockResolvedValue(envelope(data)); await expect(run()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([{}, { ...envelope(result()), status: 503 }, { ...envelope(result()), count: 2 },
    { ...envelope(result()), extra: true }, { data: null, error: { code: 'XX000', message: 'private' }, status: 503 },
  ])('rejects an uncertain SDK envelope%#', async data => {
    abortSignal.mockResolvedValue(data); await expect(run()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each(['42501','55000','40001','22023'])('keeps unknown PostgreSQL%s faults unavailable and private', async code => {
    abortSignal.mockResolvedValue({ data: null, error: { code, message: 'private unknown fault', details: null, hint: null }, status: 403, statusText: '', count: null })
    await expect(run()).rejects.toMatchObject({ statusCode: 503, message: 'Attendance settings are temporarily unavailable' })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('rejects contradictory error code and HTTP status rather than classifying uncertain authorization', async () => {
    abortSignal.mockResolvedValue({ data: null, error: { code: 'PT403', message: 'private', details: null, hint: null }, status: 503, statusText: '', count: null })
    await expect(run()).rejects.toMatchObject({ statusCode: 503 }); expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('rejects claimed success outside the configured canary and does not retry aborted writes', async () => {
    canary.mockReturnValue({ state: 'ready', teacherId: otherId, classroomId })
    await expect(run()).rejects.toMatchObject({ statusCode: 503 })
    abortSignal.mockRejectedValue(new DOMException('aborted','AbortError'))
    await expect(run()).rejects.toMatchObject({ statusCode: 503 }); expect(rpc).toHaveBeenCalledTimes(2)
  })
})
