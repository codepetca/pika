import { createClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleContextualTestOwnerDeletionRequest } from '@/lib/server/contextual-test-owner-deletion'
import { createContextualTestOwnerWorkflow } from '@/lib/server/contextual-test-owner-workflow'
import type { Database } from '@/types/database'
const actor = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222', classroom = '33333333-3333-4333-8333-333333333333'
const stamp = '2026-10-09T12:00:00Z'
const test = { id, classroom_id: classroom, title: 'Test', status: 'active', show_results: false, documents: [], position: 0, points_possible: 100, include_in_final: true, created_by: classroom, created_at: stamp, updated_at: stamp, artifact_id: actor, source_artifact_id: null, source_blueprint_version_id: null, blueprint_archived_at: null, gradebook_category_id: null, gradebook_maximum_override: null, gradebook_score_scale: 1, gradebook_weight: 10, questions_locked_at: stamp }
const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))
let network: ReturnType<typeof vi.fn<typeof fetch>>, final: unknown
const witness = (operation: string, row = test, result: unknown = null) => ({ version: 1, actor_id: actor, test_id: id, classroom_id: classroom, operation, test: row, result, ...(operation === 'delete' ? { test_absent: true } : {}) })
const invoke = (req = new Request('https://example.test', { method: 'DELETE' }), params: Promise<unknown> = Promise.resolve({ id })) => handleContextualTestOwnerDeletionRequest(req, params)
describe('installed SDK contextual whole-Test deletion', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(stamp); vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actor] })); mocks.auth.mockResolvedValue({ id: actor, role: 'student' })
    final = witness('delete', test, { deleted: true, responses_count: 7 })
    network = vi.fn<typeof fetch>(async (_url, init) => new Response(JSON.stringify(JSON.parse(String(init?.body)).p_operation === 'inspect' ? witness('inspect') : final), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    mocks.client.mockReturnValue(createClient<Database>('https://example.test', 'offline-key', { global: { fetch: network }, auth: { persistSession: false, autoRefreshToken: false } }))
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
  it('uses inspect then one delete, the original source, empty payload and one deadline; ignores any body', async () => {
    const req = new Request('https://example.test', { method: 'DELETE', body: '{invalid' })
    expect(await (await invoke(req))!.json()).toEqual({ success: true, responses_count: 7 }); expect(req.bodyUsed).toBe(false)
    const calls = network.mock.calls.map(call => JSON.parse(String(call[1]?.body)))
    expect(calls.map(call => call.p_operation)).toEqual(['inspect', 'delete'])
    expect(calls[1]).toEqual({ p_actor_id: actor, p_test_id: id, p_classroom_id: classroom, p_operation: 'delete', p_payload: {}, p_expected_test: test, p_deadline: calls[0].p_deadline })
    expect(calls[0].p_deadline).toBe('2026-10-09T12:00:30.000Z')
  })
  it.each(['actor_id', 'test_id', 'classroom_id', 'operation', 'version', 'unknown', 'test_absent'])('rejects forged %s without retry', async field => {
    final = { ...(final as object), [field]: field === 'version' ? 2 : field === 'test_absent' ? false : field === 'classroom_id' ? actor : classroom }
    await expect(invoke()).rejects.toMatchObject({ statusCode: 503 }); expect(network).toHaveBeenCalledTimes(2)
  })
  it.each([{ deleted: false, responses_count: 7 }, { deleted: true, responses_count: -1 }, { deleted: true, responses_count: 1.5 }, { deleted: true, responses_count: '7' }, { deleted: true }, { deleted: true, responses_count: 7, extra: true }, null])('requires the strict legacy result', async result => {
    final = witness('delete', test, result); await expect(invoke()).rejects.toMatchObject({ statusCode: 503 }); expect(network).toHaveBeenCalledTimes(2)
  })
  it.each([{ title: 'Refreshed' }, { classroom_id: actor }, { id: classroom }, { updated_at: '2026-10-09T12:01:00Z' }])('rejects a changed captured source even on an absence acknowledgement', async change => {
    final = witness('delete', { ...test, ...change }, { deleted: true, responses_count: 7 }); await expect(invoke()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('requires explicit absence and cannot silently refresh the original transport CAS', async () => {
    const flow = createContextualTestOwnerWorkflow({ supabase: mocks.client(), actorId: actor, testId: id })
    await flow.inspect(); final = witness('delete', { ...test, title: 'Refreshed' }, { deleted: true, responses_count: 7 })
    await expect(flow.run('delete')).rejects.toMatchObject({ statusCode: 503 })
    final = { ...witness('delete', test, { deleted: true, responses_count: 7 }), test_absent: undefined }
    await expect(flow.run('delete')).rejects.toMatchObject({ statusCode: 503 })
    expect(JSON.parse(String(network.mock.calls[2][1]?.body)).p_expected_test).toEqual(test)
  })
  it('preserves zero responses and source documents without normalization', async () => {
    const source = { ...test, status: 'draft', questions_locked_at: null, documents: [{ id: ' legacy ', custom: true }] }
    network.mockResolvedValueOnce(new Response(JSON.stringify(witness('inspect', source)), { headers: { 'Content-Type': 'application/json' } }))
    final = witness('delete', source, { deleted: true, responses_count: 0 })
    expect(await (await invoke())!.json()).toEqual({ success: true, responses_count: 0 })
    expect(JSON.parse(String(network.mock.calls[1][1]?.body)).p_expected_test).toEqual(source)
  })
  it.each([null, {}, { ...witness('delete'), result: null }])('rejects malformed final acknowledgements without retry', async malformed => {
    final = malformed; await expect(invoke()).rejects.toMatchObject({ statusCode: 503 }); expect(network).toHaveBeenCalledTimes(2)
  })
  it('rejects an oversized acknowledgement under the existing shared response budget', async () => {
    final = witness('delete', test, { deleted: true, responses_count: 7, padding: 'x'.repeat(4 * 1024 * 1024) })
    await expect(invoke()).rejects.toMatchObject({ statusCode: 503 }); expect(network).toHaveBeenCalledTimes(2)
  })
  it.each([['PT403', 403, 'Forbidden'], ['PT404', 404, 'Test not found'], ['PT409', 409, 'Test changed; reload and retry'], ['42501', 503, 'Unable to verify Test deletion'], ['PGRST202', 503, 'Unable to verify Test deletion']] as const)('masks %s and never retries', async (code, statusCode, message) => {
    network.mockResolvedValue(new Response(JSON.stringify({ code, message: 'private detail' }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
    await expect(invoke()).rejects.toMatchObject({ statusCode, message }); expect(network).toHaveBeenCalledOnce()
  })
  it('rejects invalid params and already aborted requests before RPC', async () => {
    await expect(invoke(undefined, Promise.resolve({ id: 'bad' }))).rejects.toMatchObject({ name: 'ZodError' })
    const abort = new AbortController(); abort.abort(); await expect(invoke(new Request('https://example.test', { method: 'DELETE', signal: abort.signal }))).rejects.toMatchObject({ statusCode: 503 }); expect(network).not.toHaveBeenCalled()
  })
  it('bounds unresolved params under the same deadline', async () => {
    const pending = expect(invoke(undefined, new Promise(() => {}))).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(30000); await pending; expect(network).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
  it('aborts a hung delete using only the remaining deadline and rejects late acknowledgement', async () => {
    let release: (() => void) | undefined
    network.mockImplementation(async (_url, init) => {
      if (JSON.parse(String(init?.body)).p_operation === 'inspect') { vi.setSystemTime(Date.now() + 20000); return new Response(JSON.stringify(witness('inspect')), { headers: { 'Content-Type': 'application/json' } }) }
      await new Promise<void>(resolve => { release = resolve }); return new Response(JSON.stringify(final), { headers: { 'Content-Type': 'application/json' } })
    })
    const pending = expect(invoke()).rejects.toMatchObject({ statusCode: 503 }); await vi.advanceTimersByTimeAsync(10000); await pending; release?.()
    expect(network).toHaveBeenCalledTimes(2); expect(network.mock.calls[1][1]?.signal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0)
  })
  it('propagates caller cancellation during delete without compensation', async () => {
    const abort = new AbortController()
    network.mockImplementation(async (_url, init) => {
      if (JSON.parse(String(init?.body)).p_operation === 'inspect') return new Response(JSON.stringify(witness('inspect')), { headers: { 'Content-Type': 'application/json' } })
      abort.abort(); return new Promise(() => {})
    })
    await expect(invoke(new Request('https://example.test', { method: 'DELETE', signal: abort.signal }))).rejects.toMatchObject({ statusCode: 503 }); expect(network).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0)
  })
})
