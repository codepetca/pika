import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { reorderContextualTests } from '@/lib/server/contextual-test-reorder'
import { contextualTestReorderResultSchema } from '@/lib/validations/contextual-test-reorder'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = '22222222-2222-4222-8222-222222222222'
const firstId = '33333333-3333-4333-8333-333333333333'
const secondId = '44444444-4444-4444-8444-444444444444'
const otherId = '55555555-5555-4555-8555-555555555555'
const body = { classroom_id: classroomId, test_ids: [firstId, secondId] }
const witness = () => ({ version: 1, actor_id: actorId, classroom_id: classroomId, test_ids: body.test_ids, positions: [1, 0], count: 2, changed_count: 2 })
let result: unknown; let status: number; let network: ReturnType<typeof vi.fn<typeof fetch>>
const client = () => createClient<Database>('https://example.test', 'offline-service-key', { global: { fetch: network }, auth: { persistSession: false, autoRefreshToken: false } })
const invoke = (options: Partial<Parameters<typeof reorderContextualTests>[0]> = {}) => {
  const supabase = client(); const from = vi.spyOn(supabase, 'from'); const storage = vi.spyOn(supabase.storage, 'from')
  const rpc = vi.spyOn(supabase, 'rpc')
  return { result: reorderContextualTests({ supabase, actorId, input: body, ...options }), from, storage, rpc }
}

describe('single owner Test reorder RPC boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime('2026-10-07T12:00:00Z'); result = witness(); status = 200
    network = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(result), { status, headers: { 'Content-Type': 'application/json' } }))
  })
  afterEach(() => vi.useRealTimers())
  it('uses one installed-SDK RPC with exact identity/request/deadline and exposes only success', async () => {
    const call = invoke(); expect(await call.result).toEqual({ success: true })
    expect(call.rpc).toHaveBeenCalledOnce(); expect(network).toHaveBeenCalledOnce()
    expect(String(network.mock.calls[0][0])).toBe('https://example.test/rest/v1/rpc/reorder_tests_for_owner_v1')
    const init = network.mock.calls[0][1]
    expect(JSON.parse(String(init?.body))).toEqual({ p_actor_id: actorId, p_classroom_id: classroomId, p_test_ids: body.test_ids, p_deadline: '2026-10-07T12:00:20.000Z' })
    expect(init?.method).toBe('POST'); expect(new Headers(init?.headers).get('apikey')).toBe('offline-service-key')
    expect(init?.signal?.aborted).toBe(true); expect(call.from).not.toHaveBeenCalled(); expect(call.storage).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
  it.each([0, 1, 999, 1000])('accepts acknowledgement of complete membership size %i', async length => {
    const test_ids = Array.from({ length }, (_, i) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`)
    result = { ...witness(), test_ids, positions: test_ids.map((_, i) => length - i - 1), count: length, changed_count: length }
    expect(await invoke({ input: { classroom_id: classroomId, test_ids } }).result).toEqual({ success: true })
  })
  it('accepts a no-op acknowledgement', async () => {
    result = { ...witness(), changed_count: 0 }; expect(await invoke().result).toEqual({ success: true })
  })
  it('rejects a forged 1001-row acknowledgement with exactly one RPC and no retry', async () => {
    const test_ids = Array.from({ length: 1001 }, (_, i) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`)
    result = { ...witness(), test_ids, positions: test_ids.map((_, i) => 1000 - i), count: 1001, changed_count: 1001 }
    await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
    expect(network).toHaveBeenCalledOnce()
  })
  it.each([
    ['version', 2], ['actor_id', otherId], ['classroom_id', otherId], ['test_ids', [secondId, firstId]],
    ['test_ids', [firstId, firstId]], ['positions', [0, 1]], ['positions', [1]], ['positions', [1, -1]],
    ['count', 1], ['count', '2'], ['changed_count', 3], ['changed_count', -1], ['changed_count', 0.5],
    ['private', 'hidden'], ['actor_id', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'],
  ])('rejects malformed/misbound witness %s %# without another write', async (key, value) => {
    result = { ...witness(), [key]: value }; await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 }); expect(network).toHaveBeenCalledOnce()
  })
  it.each(Object.keys(witness()))('requires acknowledgement field %s', async key => {
    const raw: Record<string, unknown> = witness(); delete raw[key]; result = raw
    await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 }); expect(network).toHaveBeenCalledOnce()
  })
  it.each([null, [], true, 'success', { success: true }])('rejects missing/noncontract acknowledgement %#', async value => {
    result = value; await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 }); expect(network).toHaveBeenCalledOnce()
  })
  it.each([['PT400', 400], ['PT403', 403], ['PT404', 404], ['PT409', 409], ['55P03', 409], ['40P01', 409], ['40001', 409],
    ['PT503', 503], ['42501', 503], ['55000', 503], ['PGRST202', 503], ['23505', 503], ['XX000', 503]])('maps %s without diagnostics/retry', async (code, statusCode) => {
    status = 403; result = { code, message: 'private SQL state', details: 'private', hint: 'private' }
    await expect(invoke().result).rejects.toMatchObject({ statusCode, message: expect.not.stringContaining('private') }); expect(network).toHaveBeenCalledOnce()
  })
  it('rejects oversized witness before its schema clones it', async () => {
    result = { ...witness(), private: 'é'.repeat(256 * 1024) }; const parse = vi.spyOn(contextualTestReorderResultSchema, 'safeParse')
    try { await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 }); expect(parse).not.toHaveBeenCalled() } finally { parse.mockRestore() }
  })
  it('bounds envelope bytes before decoding its schema', async () => {
    status = 503; result = { code: 'PT403', message: 'é'.repeat(512 * 1024) }
    await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
  })
  it('returns503 after a lost commit response and never retries', async () => {
    network.mockRejectedValueOnce(new Error('commit ACK lost'))
    await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 }); expect(network).toHaveBeenCalledOnce()
  })
  it.each(['not JSON', '<html>private upstream error</html>', '{"version":'])('rejects malformed transport JSON %# without retry', async text => {
    network.mockResolvedValueOnce(new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await expect(invoke().result).rejects.toMatchObject({ statusCode: 503, message: 'Unable to verify test reorder' }); expect(network).toHaveBeenCalledOnce()
  })
  it('bounds an uncooperative stalled transport', async () => {
    network.mockImplementation(() => new Promise(() => {}))
    const call = invoke(); const check = expect(call.result).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(20000); await check
    expect(network).toHaveBeenCalledOnce(); expect(network.mock.calls[0][1]?.signal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0)
  })
  it('honors caller cancellation without retries and removes listener', async () => {
    network.mockImplementation(() => new Promise(() => {})); const controller = new AbortController(); const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const call = invoke({ signal: controller.signal }); const check = expect(call.result).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(0); controller.abort(); await check
    expect(network).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledWith('abort', expect.any(Function)); expect(vi.getTimerCount()).toBe(0)
  })
  it('uses remaining body-plus-RPC budget without renewing it', async () => {
    const deadline = Date.now() + 750; expect(await invoke({ deadline }).result).toEqual({ success: true })
    expect(JSON.parse(String(network.mock.calls[0][1]?.body)).p_deadline).toBe(new Date(deadline).toISOString())
  })
  it('caps a longer caller deadline at twenty seconds', async () => {
    expect(await invoke({ deadline: Date.now() + 60000 }).result).toEqual({ success: true })
    expect(JSON.parse(String(network.mock.calls[0][1]?.body)).p_deadline).toBe('2026-10-07T12:00:20.000Z')
  })
  it('exhausts the remaining body-plus-RPC budget while waiting for acknowledgement', async () => {
    network.mockImplementation(() => new Promise(() => {}))
    const check = expect(invoke({ deadline: Date.now() + 750 }).result).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(750); await check
    expect(network).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects a transport result after the absolute deadline before accepting its witness', async () => {
    network.mockImplementation(async () => {
      vi.setSystemTime('2026-10-07T12:00:21Z')
      return new Response(JSON.stringify(witness()), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 }); expect(network).toHaveBeenCalledOnce()
  })
  it('rejects an already-aborted caller before RPC', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(invoke({ signal: controller.signal }).result).rejects.toMatchObject({ statusCode: 503 }); expect(network).not.toHaveBeenCalled()
  })
  it('rejects invalid actor identity before RPC', async () => {
    await expect(invoke({ actorId: 'invalid' }).result).rejects.toMatchObject({ statusCode: 400 }); expect(network).not.toHaveBeenCalled()
  })
  it('maps a synchronous SDK construction failure to503 without leaking details or retrying', async () => {
    const supabase = client()
    const rpc = vi.spyOn(supabase, 'rpc').mockImplementation(() => { throw Error('private SDK failure') })
    await expect(reorderContextualTests({ supabase, actorId, input: body })).rejects.toMatchObject({ statusCode: 503, message: 'Unable to verify test reorder' })
    expect(rpc).toHaveBeenCalledOnce(); expect(network).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
  it.each([0, NaN, Infinity, -Infinity])('rejects expired/nonfinite deadline %s before RPC', async deadline => {
    await expect(invoke({ deadline }).result).rejects.toMatchObject({ statusCode: 503 }); expect(network).not.toHaveBeenCalled()
  })
  it.each([-1, 512 * 1024 + 1, 1.5, NaN, Infinity])('rejects invalid actual body-byte receipt %s before RPC', async bodyBytes => {
    await expect(invoke({ bodyBytes }).result).rejects.toMatchObject({ statusCode: 503 }); expect(network).not.toHaveBeenCalled()
  })
})
