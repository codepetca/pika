import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { discardContextualPristineTestDraft } from '@/lib/server/contextual-test-pristine-discard'
import { contextualTestPristineDiscardRequestSchema, readContextualTestPristineDiscardBody, TEST_PRISTINE_DISCARD_BODY_BYTES } from '@/lib/validations/contextual-test-pristine-discard'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = '22222222-2222-4222-8222-222222222222'
const testId = '33333333-3333-4333-8333-333333333333'
const draftId = '44444444-4444-4444-8444-444444444444'
const artifactId = '55555555-5555-4555-8555-555555555555'
const otherId = '66666666-6666-4666-8666-666666666666'
const stamp = '2026-10-06T03:25:00.123456Z'
const body = () => ({ expected_draft_version: 7, expected_test_updated_at: stamp })
const test = () => ({ id: testId, classroom_id: classroomId, title: 'Untitled 2026-10-05 23:25:00', status: 'draft', show_results: false, position: -1,
  points_possible: 100, include_in_final: true, created_by: otherId, created_at: stamp, updated_at: stamp, documents: [], artifact_id: artifactId,
  source_artifact_id: null, blueprint_archived_at: null, source_blueprint_version_id: null, questions_locked_at: null,
  gradebook_category_id: null, gradebook_weight: 10, gradebook_maximum_override: null, gradebook_score_scale: 1 })
const draft = () => ({ id: draftId, assessment_type: 'test', assessment_id: testId, classroom_id: classroomId,
  content: { title: 'Untitled 2026-10-05 23:25:00', show_results: false, question_identity_version: 1, questions: [], source_format: 'markdown' }, version: 7,
  created_by: otherId, updated_by: otherId, created_at: stamp, updated_at: stamp })
const witness = () => ({ version: 1, actor_id: actorId, test_id: testId, classroom: { id: classroomId, teacher_id: actorId, archived_at: null }, test: test(), draft: draft(), discarded: true })
let data: unknown; let httpStatus: number; let network: ReturnType<typeof vi.fn<typeof fetch>>
const client = () => createClient<Database>('https://example.test', 'offline-key', { global: { fetch: network }, auth: { persistSession: false, autoRefreshToken: false } })
const invoke = (overrides: Partial<Parameters<typeof discardContextualPristineTestDraft>[0]> = {}) => {
  const supabase = client(); const from = vi.spyOn(supabase, 'from'); const storage = vi.spyOn(supabase.storage, 'from')
  return { result: discardContextualPristineTestDraft({ supabase, actorId, testId, input: body(), ...overrides }), from, storage }
}

describe('contextual pristine Test discard witness', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime('2026-10-06T03:26:00Z'); data = witness(); httpStatus = 200
    network = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(data), { status: httpStatus, headers: { 'Content-Type': 'application/json' } }))
  })
  afterEach(() => vi.useRealTimers())
  it('uses exactly one installed-SDK RPC and releases only the legacy public true shape', async () => {
    const call = invoke(); expect(await call.result).toEqual({ discarded: true })
    expect(network).toHaveBeenCalledTimes(1); expect(String(network.mock.calls[0][0])).toBe('https://example.test/rest/v1/rpc/discard_pristine_test_draft_for_owner_v1')
    const init = network.mock.calls[0][1]!
    expect(JSON.parse(String(init.body))).toEqual({ p_actor_id: actorId, p_test_id: testId, p_expected_draft_version: 7, p_expected_test_updated_at: stamp, p_deadline: '2026-10-06T03:26:20.000Z' })
    expect(init.signal).toBeInstanceOf(AbortSignal); expect(init.signal?.aborted).toBe(true)
    expect(call.from).not.toHaveBeenCalled(); expect(call.storage).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
  it('canonicalizes input UUIDs, without requiring actor to be historical creator', async () => {
    expect(await invoke({ actorId: actorId.toUpperCase(), testId: testId.toUpperCase() }).result).toEqual({ discarded: true })
  })
  it.each([null, { ...draft(), version: 9 }])('returns only full current Test on draft-changed/no-draft %#', async row => {
    const current = { ...test(), title: 'Changed', status: 'closed', documents: [{ arbitrary_legacy: 'raw' }], updated_at: '2026-10-06T03:25:30Z' }
    data = { ...witness(), discarded: false, reason: 'draft_changed', test: current, draft: row }
    expect(await invoke().result).toEqual({ discarded: false, test: current })
  })
  it('accepts the same CAS timestamp instant in a different UTC offset', async () => {
    expect(await invoke({ input: { ...body(), expected_test_updated_at: '2026-10-05T23:25:00.123456-04:00' } }).result).toEqual({ discarded: true })
  })
  it('does not confuse different PostgreSQL microseconds in one JavaScript millisecond', async () => {
    data = { ...witness(), test: { ...test(), updated_at: '2026-10-06T03:25:00.123457Z' } }
    await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
  })
  it('accepts trailing-zero fractional normalization', async () => {
    data = { ...witness(), test: { ...test(), updated_at: '2026-10-06T03:25:00.1234560Z' } }
    expect(await invoke().result).toEqual({ discarded: true })
  })
  it.each(Object.keys(test()))('requires full Test field %s', async key => {
    const row: Record<string, unknown> = test(); delete row[key]; data = { ...witness(), test: row }
    await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each(Object.keys(draft()))('requires full draft field %s', async key => {
    const row: Record<string, unknown> = draft(); delete row[key]; data = { ...witness(), draft: row }
    await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([
    ['id', 'bad'], ['classroom_id', 'bad'], ['title', false], ['status', 'published'], ['show_results', 'false'], ['position', 0.1],
    ['points_possible', '100'], ['include_in_final', 'true'], ['created_by', 'bad'], ['created_at', 'bad'], ['updated_at', 'bad'],
    ['artifact_id', 'bad'], ['source_artifact_id', 'bad'], ['source_blueprint_version_id', 'bad'], ['blueprint_archived_at', 'bad'],
    ['questions_locked_at', 'bad'], ['gradebook_category_id', 'bad'], ['gradebook_weight', '10'], ['gradebook_maximum_override', '1'], ['gradebook_score_scale', '1'],
  ])('rejects invalid full Test field %s', async (key, value) => {
    data = { ...witness(), test: { ...test(), [String(key)]: value } }; await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([
    ['id', 'bad'], ['assessment_type', 'assignment'], ['assessment_id', 'bad'], ['classroom_id', 'bad'], ['version', 0],
    ['created_by', 'bad'], ['updated_by', 'bad'], ['created_at', 'bad'], ['updated_at', 'bad'],
  ])('rejects invalid full draft field %s', async (key, value) => {
    data = { ...witness(), draft: { ...draft(), [String(key)]: value } }; await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each(['version', 'actor_id', 'test_id', 'classroom', 'test', 'draft', 'discarded'])('requires top-level witness %s', async key => {
    const value: Record<string, unknown> = witness(); delete value[key]; data = value; await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([
    { ...witness(), version: 2 }, { ...witness(), actor_id: otherId }, { ...witness(), test_id: otherId }, { ...witness(), hidden: 'private' },
    { ...witness(), classroom: { ...witness().classroom, id: otherId } }, { ...witness(), classroom: { ...witness().classroom, teacher_id: otherId } },
    { ...witness(), classroom: { ...witness().classroom, archived_at: stamp } }, { ...witness(), classroom: { ...witness().classroom, hidden: true } },
    { ...witness(), test: { ...test(), id: otherId } }, { ...witness(), test: { ...test(), classroom_id: otherId } },
    { ...witness(), test: { ...test(), blueprint_archived_at: stamp } }, { ...witness(), test: { ...test(), status: 'unexpected' } },
    { ...witness(), test: { ...test(), points_possible: '100' } }, { ...witness(), test: { ...test(), include_in_final: 1 } },
    { ...witness(), test: { ...test(), artifact_id: 'bad' } }, { ...witness(), test: { ...test(), updated_at: 'bad' } },
    { ...witness(), test: { ...test(), hidden: true } }, { ...witness(), draft: { ...draft(), hidden: true } },
    { ...witness(), draft: { ...draft(), assessment_id: otherId } }, { ...witness(), draft: { ...draft(), classroom_id: otherId } },
    { ...witness(), draft: { ...draft(), assessment_type: 'assignment' } }, { ...witness(), draft: { ...draft(), version: 8 } },
    { ...witness(), draft: null }, { ...witness(), reason: 'draft_changed' }, { ...witness(), discarded: false },
    { ...witness(), discarded: false, reason: 'unexpected' }, { ...witness(), discarded: 'true' },
  ])('rejects unbound, malformed or surplus witness %#', async value => { data = value; await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 }) })
  it.each([['PT400', 400], ['PT403', 403], ['PT404', 404], ['PT409', 409], ['55P03', 409], ['40P01', 409], ['40001', 409],
    ['42501', 503], ['55000', 503], ['PGRST202', 503], ['42883', 503], ['P0002', 503], ['22023', 503], ['XX000', 503]])('maps only closed %s safely to %s', async (code, statusCode) => {
    httpStatus = 400; data = { code, message: 'private SQL identity', details: 'secret', hint: 'secret' }
    const call = invoke(); await expect(call.result).rejects.toMatchObject({ statusCode, message: expect.not.stringContaining('private') })
    expect(network).toHaveBeenCalledTimes(1); expect(call.from).not.toHaveBeenCalled(); expect(call.storage).not.toHaveBeenCalled()
  })
  it('bounds individual raw Test material before any normalization', async () => {
    data = { ...witness(), discarded: false, reason: 'draft_changed', test: { ...test(), title: 'é'.repeat(1024 * 1024) } }
    await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
  })
  it('bounds draft JSON content independently', async () => {
    data = { ...witness(), draft: { ...draft(), content: { raw: 'é'.repeat(1024 * 1024) } } }
    await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([null, [], 'raw', { unexpected: true }])('rejects malformed RPC data %#', async value => { data = value; await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 }) })
  it('does not retry acknowledgement loss or issue compensating deletion', async () => {
    network.mockRejectedValue(new Error('lost acknowledgement after commit'))
    const call = invoke(); await expect(call.result).rejects.toMatchObject({ statusCode: 503 }); expect(network).toHaveBeenCalledTimes(1)
    expect(call.from).not.toHaveBeenCalled(); expect(call.storage).not.toHaveBeenCalled()
  })
  it('fails safe on invalid RPC JSON', async () => {
    network.mockResolvedValue(new Response('{', { status: 200 })); await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
  })
  it('fails safe on a raw privilege HTTP403 with no closed error classification', async () => {
    httpStatus = 403; data = { code: '42501', message: 'private grant' }; await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
  })
  it('bounds the entire RPC envelope before nested decoding', async () => {
    data = { ...witness(), surplus: 'é'.repeat(2 * 1024 * 1024) }; await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
  })
  it('physically aborts stalled installed-SDK fetch at the absolute deadline', async () => {
    let aborted = false; network.mockImplementation((_, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) }, { once: true })))
    const call = invoke({ deadline: Date.now() + 500 }); const checked = expect(call.result).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(500); await checked; expect(aborted).toBe(true); expect(vi.getTimerCount()).toBe(0)
    expect(JSON.parse(String(network.mock.calls[0][1]?.body)).p_deadline).toBe('2026-10-06T03:26:00.500Z')
  })
  it('settles even if aborted fetch never acknowledges cancellation', async () => {
    network.mockImplementation(() => new Promise(() => {})); const call = invoke(); const checked = expect(call.result).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(20000); await checked; expect(network).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
  })
  it('aborts caller-canceled fetch and removes request listeners', async () => {
    const controller = new AbortController(); const remove = vi.spyOn(controller.signal, 'removeEventListener')
    network.mockImplementation(() => new Promise(() => {})); const call = invoke({ signal: controller.signal }); const checked = expect(call.result).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(0); controller.abort(); await checked
    expect(network.mock.calls[0][1]?.signal?.aborted).toBe(true); expect(remove).toHaveBeenCalledWith('abort', expect.any(Function)); expect(vi.getTimerCount()).toBe(0)
  })
  it('removes caller listeners after success and uses no residual timer', async () => {
    const controller = new AbortController(); const remove = vi.spyOn(controller.signal, 'removeEventListener'); expect(await invoke({ signal: controller.signal }).result).toEqual({ discarded: true })
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function)); expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects an already canceled caller without network access', async () => {
    const controller = new AbortController(); controller.abort(); await expect(invoke({ signal: controller.signal }).result).rejects.toMatchObject({ statusCode: 503 }); expect(network).not.toHaveBeenCalled()
  })
  it.each([{ deadline: 0 }, { deadline: NaN }, { bodyBytes: -1 }, { bodyBytes: 16385 }, { actorId: 'bad' }, { testId: 'bad' }])('rejects invalid identity/budget before RPC %#', async overrides => {
    await expect(invoke(overrides).result).rejects.toMatchObject({ statusCode: expect.any(Number) }); expect(network).not.toHaveBeenCalled()
  })
})

describe('strict pristine discard HTTP material', () => {
  afterEach(() => vi.useRealTimers())
  it.each([null, [], {}, { ...body(), expected_draft_version: 0 }, { ...body(), expected_draft_version: 1.1 },
    { ...body(), expected_draft_version: 2147483648 }, { ...body(), expected_draft_version: '7' }, { ...body(), expected_test_updated_at: 'bad' },
    { ...body(), expected_test_updated_at: '2026-10-06T03:25:00' }, { ...body(), actor_id: actorId }, { ...body(), deadline: 7 }, { ...body(), discarded: true }])('rejects invalid/forged body %#', value => {
    expect(contextualTestPristineDiscardRequestSchema.safeParse(value).success).toBe(false)
  })
  it('accepts the positive PostgreSQL int maximum and an offset timestamp', () => {
    expect(contextualTestPristineDiscardRequestSchema.safeParse({ expected_draft_version: 2147483647, expected_test_updated_at: '2026-10-05T23:25:00.123456-04:00' }).success).toBe(true)
  })
  it('returns actual UTF8 byte count with the unknown JSON value', async () => {
    const payload = JSON.stringify(body()); expect(await readContextualTestPristineDiscardBody(new Request('http://localhost', { method: 'POST', body: payload }))).toEqual({ body: body(), bytes: Buffer.byteLength(payload) })
  })
  it.each(['{', '', '\0'])('returns400 for malformed raw JSON %#', async payload => {
    await expect(readContextualTestPristineDiscardBody(new Request('http://localhost', { method: 'POST', body: payload }))).rejects.toMatchObject({ statusCode: 400 })
  })
  it('rejects invalid UTF8', async () => {
    await expect(readContextualTestPristineDiscardBody(new Request('http://localhost', { method: 'POST', body: new Uint8Array([255]) }))).rejects.toMatchObject({ statusCode: 400 })
  })
  it.each(['16385', 'bad', '-1'])('rejects and cancels oversized/invalid content-length %s', async length => {
    const cancel = vi.fn(); const init = { method: 'POST', body: new ReadableStream<Uint8Array>({ cancel }), duplex: 'half', headers: { 'content-length': length } }
    await expect(readContextualTestPristineDiscardBody(new Request('http://localhost', init))).rejects.toMatchObject({ statusCode: 400 }); expect(cancel).toHaveBeenCalledTimes(1)
  })
  it('bounds real stream bytes despite forged content-length', async () => {
    await expect(readContextualTestPristineDiscardBody(new Request('http://localhost', { method: 'POST', headers: { 'content-length': '1' }, body: 'é'.repeat(TEST_PRISTINE_DISCARD_BODY_BYTES / 2 + 1) }))).rejects.toMatchObject({ statusCode: 400 })
  })
  it('accepts exactly16KiB of valid raw JSON material, including whitespace', async () => {
    const payload = JSON.stringify(body()); const padded = payload.padEnd(TEST_PRISTINE_DISCARD_BODY_BYTES, ' ')
    expect(await readContextualTestPristineDiscardBody(new Request('http://localhost', { method: 'POST', body: padded }))).toEqual({ body: body(), bytes: TEST_PRISTINE_DISCARD_BODY_BYTES })
  })
  it('cancels a stalled stream and releases reader even when cancellation never settles', async () => {
    vi.useFakeTimers(); const cancel = vi.fn(() => new Promise<void>(() => {})); const stream = new ReadableStream<Uint8Array>({ cancel })
    const init = { method: 'POST', body: stream, duplex: 'half' }; const request = new Request('http://localhost', init)
    const checked = expect(readContextualTestPristineDiscardBody(request, Date.now() + 500)).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(500); await checked
    expect(cancel).toHaveBeenCalledTimes(1); expect(request.body?.locked).toBe(false); expect(vi.getTimerCount()).toBe(0)
  })
  it('cancels on caller abort and removes the listener', async () => {
    vi.useFakeTimers(); const controller = new AbortController(); const cancel = vi.fn(); const init = { method: 'POST', body: new ReadableStream<Uint8Array>({ cancel }), duplex: 'half', signal: controller.signal }
    const request = new Request('http://localhost', init); const remove = vi.spyOn(request.signal, 'removeEventListener')
    const checked = expect(readContextualTestPristineDiscardBody(request)).rejects.toMatchObject({ statusCode: 503 }); controller.abort(); await checked
    expect(cancel).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledWith('abort', expect.any(Function)); expect(request.body?.locked).toBe(false); expect(vi.getTimerCount()).toBe(0)
  })
})
