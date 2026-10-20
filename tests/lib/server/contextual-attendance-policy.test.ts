import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadContextualAttendancePolicy } from '@/lib/server/contextual-attendance-policy'

const actorId = '10000000-0000-4000-8000-000000000001'
const classroomId = '20000000-0000-4000-8000-000000000001'
const otherId = '30000000-0000-4000-8000-000000000001'
const { integration, canary } = vi.hoisted(() => ({ integration: vi.fn(), canary: vi.fn() }))
vi.mock('@/lib/server/bara-attendance-client', () => ({ getBaraAttendanceIntegrationState: integration }))
vi.mock('@/lib/server/bara-attendance-canary', () => ({ getBaraAttendanceCanaryScope: canary }))

const row = { classroom_id: classroomId, timezone: 'America/Toronto', opens_local: '08:45:00',
  closes_local: '10:15:00', close_day_offset: 0, entry_opens_minutes_before: 10, present_grace_minutes: 5,
  entry_closes_minutes_before_end: 10, absent_minutes_before_end: 0, enabled: true, policy_revision: 1,
  updated_at: '2026-10-19T12:00:00Z' }
const snapshot = () => ({ actor_id: actorId, classroom_id: classroomId, scope_mode: 'exact_canary', status: 'ready', policy: row })
const envelope = (data: unknown) => ({ data, error: null, status: 200, statusText: 'OK', count: null })
const rpc = vi.fn()
const abortSignal = vi.fn()
// The production client remains fully typed; this isolated SDK fixture exposes only the exercised method.
const run = () => loadContextualAttendancePolicy({ supabase: { rpc } as never, actorId, classroomId })

describe('contextual attendance owner policy boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_BARA_ATTENDANCE_SCOPE_MODE', '')
    integration.mockReturnValue('ready')
    canary.mockReturnValue({ state: 'ready', teacherId: actorId, classroomId })
    rpc.mockReturnValue({ abortSignal })
    abortSignal.mockResolvedValue(envelope(snapshot()))
  })
  afterEach(() => vi.unstubAllEnvs())

  it('binds the exact current actor/class/server scope and reuses the legacy DTO conversion', async () => {
    expect(await run()).toMatchObject({ classroomId, sessionStartsLocal: '08:45', sessionEndsLocal: '10:15', revision: 1 })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('read_attendance_policy_for_owner_v1', {
      p_actor_id: actorId, p_classroom_id: classroomId, p_scope_mode: 'exact_canary',
      p_canary_actor_id: actorId, p_canary_classroom_id: classroomId,
    })
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal))
  })
  it('preserves a nullable policy', async () => {
    abortSignal.mockResolvedValue(envelope({ ...snapshot(), policy: null }))
    expect(await run()).toBeNull()
  })
  it('uses teacher entitlements without requiring a canary configuration', async () => {
    vi.stubEnv('PIKA_BARA_ATTENDANCE_SCOPE_MODE', 'teacher_entitlements')
    abortSignal.mockResolvedValue(envelope({ ...snapshot(), scope_mode: 'teacher_entitlements' }))
    await run()
    expect(canary).not.toHaveBeenCalled()
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_scope_mode: 'teacher_entitlements', p_canary_actor_id: null, p_canary_classroom_id: null })
  })
  it.each(['forbidden', 'archived', 'blocked', 'disabled'])('rejects authoritative %s with no policy leakage', async status => {
    abortSignal.mockResolvedValue(envelope({ ...snapshot(), status, policy: null }))
    await expect(run()).rejects.toMatchObject({ statusCode: status === 'blocked' ? 503 : status === 'disabled' ? 404 : 403 })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it.each(['disabled', 'not_configured'])('preserves transport %s without querying', async state => {
    integration.mockReturnValue(state)
    await expect(run()).rejects.toMatchObject({ statusCode: state === 'disabled' ? 404 : 503 })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('preserves a misconfigured exact canary', async () => {
    canary.mockReturnValue({ state: 'not_configured', teacherId: null, classroomId: null })
    await expect(run()).rejects.toMatchObject({ statusCode: 503 })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('rejects a claimed ready snapshot outside the configured exact canary', async () => {
    canary.mockReturnValue({ state: 'ready', teacherId: otherId, classroomId })
    await expect(run()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('preserves an authoritative nonmatching canary denial', async () => {
    canary.mockReturnValue({ state: 'ready', teacherId: otherId, classroomId })
    abortSignal.mockResolvedValue(envelope({ ...snapshot(), status: 'disabled', policy: null }))
    await expect(run()).rejects.toMatchObject({ statusCode: 404 })
  })
  it.each([
    null, {}, { ...snapshot(), actor_id: otherId }, { ...snapshot(), classroom_id: otherId },
    { ...snapshot(), scope_mode: 'teacher_entitlements' }, { ...snapshot(), extra: true },
    { ...snapshot(), policy: { ...row, classroom_id: otherId } }, { ...snapshot(), policy: { ...row, provider_id: 'private' } },
    { ...snapshot(), policy: { ...row, policy_revision: 0 } }, { ...snapshot(), status: 'unknown' },
    { ...snapshot(), status: 'disabled' },
  ])('fails closed for malformed/widened/substituted snapshot %#', async data => {
    abortSignal.mockResolvedValue(envelope(data))
    await expect(run()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([
    {}, { data: snapshot(), error: null }, { ...envelope(snapshot()), status: 503 },
    { ...envelope(snapshot()), count: 2 }, { ...envelope(snapshot()), extra: true },
    { ...envelope(snapshot()), error: { code: 'PGRST202', message: 'missing', details: null, hint: null } },
  ])('rejects uncertain SDK envelope %#', async response => {
    abortSignal.mockResolvedValue(response)
    await expect(run()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('does not retry transport or abort failures', async () => {
    abortSignal.mockRejectedValue(new DOMException('aborted', 'AbortError'))
    await expect(run()).rejects.toMatchObject({ statusCode: 503 })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
