import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readContextualTestSession, presentContextualTestSession } from '@/lib/server/contextual-test-session-read'
import { TEST_SESSION_READ_BYTES } from '@/lib/validations/contextual-test-session-read'

const actor = '11111111-1111-4111-8111-111111111111'
const testId = '22222222-2222-4222-8222-222222222222'
const classroom = '33333333-3333-4333-8333-333333333333'
const stamp = '2026-11-28T12:00:00Z'
const projection = { test_status: 'active', is_submitted: false, returned_at: null,
  closed_for_grading_at: null, access_state: null, has_submitted: false }
const witness = () => ({ version: 1, actor_id: actor, test_id: testId, classroom_id: classroom,
  outcome: 'ok', projection: { ...projection } })
const rpc = vi.fn()
let reply: unknown
const read = (extra = {}) => readContextualTestSession({ actorId: actor, testId, supabase: { rpc }, deadline: Date.now() + 30000, ...extra })
describe('contextual Test session snapshot transport', () => {
  beforeEach(() => { vi.clearAllMocks(); reply = { data: witness(), error: null }; rpc.mockImplementation(() => ({ abortSignal: async () => reply })) })
  afterEach(() => vi.useRealTimers())
  it('uses one abortable narrow RPC with no parent discovery or answer projection', async () => {
    expect(await read()).toEqual({ testId, ...projection })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('read_test_session_for_member_v1', { p_actor_id: actor, p_test_id: testId, p_deadline: expect.any(String) })
  })
  it.each(['actor_id', 'test_id', 'version'])('refuses forged %s', async key => {
    reply = { data: { ...witness(), [key]: key === 'version' ? 2 : classroom }, error: null }
    await expect(read()).rejects.toMatchObject({ statusCode: 503 }); expect(rpc).toHaveBeenCalledOnce()
  })
  it.each([
    { ...witness(), projection: { ...projection, response_text: 'private' } },
    { ...witness(), peer: actor }, { ...witness(), classroom_id: null },
    { ...witness(), outcome: 'forbidden' }, { ...witness(), projection: null },
    { ...witness(), projection: { ...projection, returned_at: 'not a date' } },
    { ...witness(), projection: { ...projection, is_submitted: true } },
  ])('rejects malformed or widened reply %#', async data => {
    reply = { data, error: null }; await expect(read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([['forbidden', 403, 'Forbidden'], ['not_found', 404, 'Test not found'], ['unavailable', 503, 'Unable to verify test operation']])(
    'maps strict %s decision to safe error', async (outcome, statusCode, message) => {
      reply = { data: { ...witness(), outcome, projection: null }, error: null }
      await expect(read()).rejects.toMatchObject({ statusCode, message })
    })
  it('allows compatibility only for a definitively missing exact new function', async () => {
    reply = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.read_test_session_for_member_v1(p_actor_id, p_test_id, p_deadline) in the schema cache' }, status: 404 }
    expect(await read()).toBeNull(); expect(rpc).toHaveBeenCalledOnce()
  })
  it.each([
    { data: null, error: { code: '42501', message: 'private' } },
    { data: null, error: { code: 'PT403', message: 'private' } },
    { data: null, error: { code: 'PGRST202', message: 'public.read_test_session_for_member_v1_other missing' } },
    { data: {}, error: { code: 'PGRST202', message: 'public.read_test_session_for_member_v1 missing' } },
    { data: null, error: { code: 'PGRST202', message: 'public.read_test_session_for_member_v1 missing' }, status: 503 },
    { data: witness(), error: null, status: 500 },
  ])('fails closed without retry or fallback on ambiguous error %#', async envelope => {
    reply = envelope; await expect(read()).rejects.toMatchObject({ statusCode: 503 }); expect(rpc).toHaveBeenCalledOnce()
  })
  it('bounds replies and transport rejection without retry', async () => {
    reply = { data: 'x'.repeat(TEST_SESSION_READ_BYTES), error: null }
    await expect(read()).rejects.toMatchObject({ statusCode: 503 })
    rpc.mockImplementation(() => ({ abortSignal: async () => { throw new Error('network') } }))
    await expect(read()).rejects.toMatchObject({ statusCode: 503 }); expect(rpc).toHaveBeenCalledTimes(2)
  })
  it('refuses expired or aborted work before dispatch', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(read({ signal: controller.signal })).rejects.toMatchObject({ statusCode: 503 })
    await expect(read({ deadline: Date.now() })).rejects.toMatchObject({ statusCode: 503 })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('cancels a hung read under the request deadline and clears timers', async () => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined
    rpc.mockImplementation(() => ({ abortSignal: (value: AbortSignal) => { signal = value; return new Promise(() => {}) } }))
    const pending = expect(read()).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(30000); await pending
    expect(signal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0)
  })
  it('preserves grading-lock and selected-student status precedence', () => {
    expect(presentContextualTestSession({ testId, ...projection, test_status: 'active', access_state: 'closed' }).message).toContain('saved draft is preserved')
    expect(presentContextualTestSession({ testId, ...projection, test_status: 'closed', closed_for_grading_at: stamp,
      returned_at: stamp }).student_status).toBe('can_view_results')
    expect(presentContextualTestSession({ testId, ...projection, test_status: 'active', has_submitted: true,
      returned_at: stamp }).student_status).toBe('responded')
  })
})
