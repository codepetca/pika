import { createClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleContextualTestOwnerUnpublicationRequest } from '@/lib/server/contextual-test-owner-unpublication'
import type { Database } from '@/types/database'
const actor = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222', classroom = '33333333-3333-4333-8333-333333333333'
const stamp = '2026-10-09T12:00:00Z'
const test = { id, classroom_id: classroom, title: 'Test', status: 'closed', show_results: false, documents: [], position: 0, points_possible: 100, include_in_final: true, created_by: actor, created_at: stamp, updated_at: stamp, artifact_id: actor, source_artifact_id: null, source_blueprint_version_id: null, blueprint_archived_at: null, gradebook_category_id: null, gradebook_maximum_override: null, gradebook_score_scale: 1, gradebook_weight: 10, questions_locked_at: null }
const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))
let network: ReturnType<typeof vi.fn<typeof fetch>>, final: unknown
const witness = (operation: string, row = test, result: unknown = null) => ({ version: 1, actor_id: actor, test_id: id, classroom_id: classroom, operation, test: row, result })
const invoke = (req = new Request('https://example.test', { method: 'POST', body: '{}' }), params: Promise<unknown> = Promise.resolve({ id })) => handleContextualTestOwnerUnpublicationRequest(req, params)
describe('installed SDK contextual unpublish boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(stamp); vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actor] })); mocks.auth.mockResolvedValue({ id: actor, role: 'student' });
    final = witness('unpublish', { ...test, status: 'draft' }, { draft_version: 8 })
    network = vi.fn<typeof fetch>(async (_url, init) => new Response(JSON.stringify(JSON.parse(String(init?.body)).p_operation === 'inspect' ? witness('inspect') : final), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    mocks.client.mockReturnValue(createClient<Database>('https://example.test', 'offline-key', { global: { fetch: network }, auth: { persistSession: false, autoRefreshToken: false } }))
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
  it('uses exactly inspect and one mutation with the original full source, parent and same deadline', async () => {
    expect((await invoke())?.status).toBe(200); expect(network).toHaveBeenCalledTimes(2)
    const calls = network.mock.calls.map(call => JSON.parse(String(call[1]?.body)))
    expect(calls.map(call => call.p_operation)).toEqual(['inspect', 'unpublish'])
    expect(calls[1]).toMatchObject({ p_actor_id: actor, p_test_id: id, p_classroom_id: classroom, p_expected_test: test, p_payload: {} })
    expect(calls[0].p_deadline).toBe(calls[1].p_deadline)
  })
  it('retains the legacy document normalization without changing SQL source documents', async () => {
    const documents = [{ id: ' notes ', title: ' Instructions ', source: 'text', content: 'Read this.', private: 'discarded' }, null]
    const source = { ...test, documents }
    network.mockResolvedValueOnce(new Response(JSON.stringify(witness('inspect', source)), { headers: { 'Content-Type': 'application/json' } }))
    final = witness('unpublish', { ...source, status: 'draft' }, { draft_version: 8 })
    const response = await invoke(); const result = await response!.json()
    expect(result.test.documents).toEqual([{ id: 'notes', title: 'Instructions', source: 'text', content: 'Read this.' }])
    expect(JSON.parse(String(network.mock.calls[1][1]?.body)).p_expected_test.documents).toEqual(documents)
  })
  it.each(['actor_id','test_id','classroom_id','operation','version','unknown'])('rejects forged outer %s without retries', async field => {
    final = { ...(final as object), [field]: field === 'version' ? 2 : field === 'actor_id' ? classroom : actor }
    await expect(invoke()).rejects.toMatchObject({ statusCode: 503 }); expect(network).toHaveBeenCalledTimes(2)
  })
  it.each([{ draft_version: 0 }, { draft_version: 2147483648 }, { draft_version: 1.5 }, { draft_version: 8, test }, { draft_version: 8, extra: true }])('rejects a malformed minimal inner result', async result => {
    final = witness('unpublish', { ...test, status: 'draft' }, result)
    await expect(invoke()).rejects.toMatchObject({ statusCode: 503 }); expect(network).toHaveBeenCalledTimes(2)
  })
  it.each([{ title: 'mutated' }, { classroom_id: actor }, { id: classroom }, { questions_locked_at: stamp }, { status: 'closed' }])('rejects an incoherent Test postcondition', async changes => {
    final = witness('unpublish', { ...test, status: 'draft', ...changes }, { draft_version: 8 })
    await expect(invoke()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('allows the draft INT_MAX no-op with exact Test equality', async () => {
    network.mockResolvedValueOnce(new Response(JSON.stringify(witness('inspect', { ...test, status: 'draft' })), { headers: { 'Content-Type': 'application/json' } }))
    final = witness('unpublish', { ...test, status: 'draft' }, { draft_version: 2147483647 })
    expect((await invoke())?.status).toBe(200)
  })
  it('rejects even a timestamp change on a draft no-op', async () => {
    network.mockResolvedValueOnce(new Response(JSON.stringify(witness('inspect', { ...test, status: 'draft' })), { headers: { 'Content-Type': 'application/json' } }))
    final = witness('unpublish', { ...test, status: 'draft', updated_at: '2026-10-09T12:01:00Z' }, { draft_version: 8 })
    await expect(invoke()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([['PT400', 400, 'Invalid Test return request'], ['PT403', 403, 'Forbidden'], ['PT404', 404, 'Test not found'], ['PT409', 409, 'Test cannot return to draft']] as const)('maps final %s to the legacy public error string', async (code, statusCode, message) => {
    network.mockResolvedValueOnce(new Response(JSON.stringify(witness('inspect')), { headers: { 'Content-Type': 'application/json' } })).mockResolvedValueOnce(new Response(JSON.stringify({ code, message: 'private SQL' }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
    await expect(invoke()).rejects.toMatchObject({ statusCode, message }); expect(network).toHaveBeenCalledTimes(2)
  })
  it('rejects a response over the shared response budget', async () => {
    final = witness('unpublish', { ...test, status: 'draft' }, { draft_version: 8, padding: 'x'.repeat(4 * 1024 * 1024) })
    await expect(invoke()).rejects.toMatchObject({ statusCode: 503 }); expect(network).toHaveBeenCalledTimes(2)
  })
  it('rejects null or malformed final acknowledgements without retry', async () => {
    for (const malformed of [null, {}, { ...witness('unpublish'), result: null }]) {
      network.mockClear(); final = malformed
      await expect(invoke()).rejects.toMatchObject({ statusCode: 503 }); expect(network).toHaveBeenCalledTimes(2)
    }
  })
  it('uses the remaining deadline for final mutation and rejects its late acknowledgement', async () => {
    let release: (() => void) | undefined
    network.mockImplementation(async (_url, init) => {
      if (JSON.parse(String(init?.body)).p_operation === 'inspect') {
        vi.setSystemTime(Date.now() + 20000)
        return new Response(JSON.stringify(witness('inspect')), { headers: { 'Content-Type': 'application/json' } })
      }
      await new Promise<void>(resolve => { release = resolve })
      return new Response(JSON.stringify(final), { headers: { 'Content-Type': 'application/json' } })
    })
    const pending = expect(invoke()).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(10000); await pending; release?.()
    expect(network).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects body byte limits and malformed JSON before the first RPC', async () => {
    for (const text of ['{', ' '.repeat(2097153)]) await expect(invoke(new Request('https://example.test', { method: 'POST', body: text }))).rejects.toMatchObject({ statusCode: 400 })
    const request = new Request('https://example.test', { method: 'POST', body: '{}' }); request.headers.set('content-length', '2097153')
    await expect(invoke(request)).rejects.toMatchObject({ statusCode: 400 }); expect(network).not.toHaveBeenCalled()
  })
  it('expires a never-finishing body under the same request deadline before RPC discovery', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{')) } })
    const request = new Request('https://example.test', { method: 'POST', body, duplex: 'half' } as RequestInit)
    const pending = expect(invoke(request)).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(30000); await pending; expect(network).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['42501','PGRST202','PT503'])('treats %s as unavailable without private detail', async code => {
    network.mockResolvedValue(new Response(JSON.stringify({ code, message: 'private SQL' }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
    await expect(invoke()).rejects.toMatchObject({ statusCode: 503, message: 'Unable to verify Test return to draft' }); expect(network).toHaveBeenCalledOnce()
  })
  it('aborts a hung acknowledgement at the shared absolute deadline with no compensation', async () => {
    network.mockImplementation(() => new Promise(() => {})); const pending = expect(invoke()).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(30000); await pending; expect(network).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
  })
  it('bounds unresolved params and rejects an already aborted request before service access', async () => {
    const pending = expect(invoke(undefined, new Promise(() => {}))).rejects.toMatchObject({ statusCode: 503 }); await vi.advanceTimersByTimeAsync(30000); await pending
    const abort = new AbortController(); abort.abort(); await expect(invoke(new Request('https://example.test', { method: 'POST', body: '{}', signal: abort.signal }))).rejects.toMatchObject({ statusCode: 503 }); expect(network).not.toHaveBeenCalled()
  })
})
