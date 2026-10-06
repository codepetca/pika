import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createContextualTest } from '@/lib/server/contextual-test-create'
import { contextualTestCreateRequestSchema, readContextualTestCreateBody, TEST_CREATE_BODY_BYTES } from '@/lib/validations/contextual-test-create'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = '22222222-2222-4222-8222-222222222222'
const testId = '33333333-3333-4333-8333-333333333333'
const draftId = '44444444-4444-4444-8444-444444444444'
const artifactId = '55555555-5555-4555-8555-555555555555'
const otherId = '66666666-6666-4666-8666-666666666666'
const stamp = '2026-10-06T03:25:00+00:00'
const content = () => ({ title: 'Custom', show_results: false, question_identity_version: 1, questions: [], source_format: 'markdown' })
const test = () => ({ id: testId, classroom_id: classroomId, title: 'Custom', status: 'draft', show_results: false, position: 7,
  points_possible: 100, include_in_final: true, created_by: actorId, created_at: stamp, updated_at: stamp, documents: [], artifact_id: artifactId,
  source_artifact_id: null, blueprint_archived_at: null, source_blueprint_version_id: null, questions_locked_at: null,
  gradebook_category_id: null, gradebook_weight: 10, gradebook_maximum_override: null, gradebook_score_scale: 1 })
const draft = () => ({ id: draftId, assessment_type: 'test', assessment_id: testId, classroom_id: classroomId, content: content(), version: 1,
  created_by: actorId, updated_by: actorId, created_at: stamp, updated_at: stamp })
const witness = () => ({ version: 1, actor_id: actorId, classroom_id: classroomId, test_id: testId, test: test(), draft: draft() })
let data: unknown
let httpStatus: number
let network: ReturnType<typeof vi.fn<typeof fetch>>
const client = () => createClient<Database>('https://example.test', 'offline-service-key', { global: { fetch: network }, auth: { persistSession: false, autoRefreshToken: false } })
const invoke = (body: unknown = { classroom_id: classroomId, title: 'Custom' }, deadline?: number) => {
  const supabase = client(); const from = vi.spyOn(supabase, 'from'); const storage = vi.spyOn(supabase.storage, 'from')
  return { result: createContextualTest({ supabase, actorId, input: contextualTestCreateRequestSchema.parse(body), ...(deadline === undefined ? {} : { deadline }) }), from, storage }
}
function titleWitness(title: string) { const row = witness(); row.test.title = title; row.draft.content.title = title; data = row }

describe('contextual empty Test creation', () => {
  beforeEach(() => {
    data = witness(); httpStatus = 200
    network = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(data), { status: httpStatus, headers: { 'Content-Type': 'application/json' } }))
    vi.useFakeTimers(); vi.setSystemTime('2026-10-06T03:25:00Z')
  })
  afterEach(() => vi.useRealTimers())
  it('uses one installed-SDK RPC and returns only the existing full Test DTO', async () => {
    const call = invoke(); expect(await call.result).toEqual({ test: { ...test(), assessment_type: 'test' } })
    expect(network).toHaveBeenCalledTimes(1); expect(String(network.mock.calls[0][0])).toBe('https://example.test/rest/v1/rpc/create_test_for_owner_v1')
    const init = network.mock.calls[0][1]!
    expect(JSON.parse(String(init.body))).toEqual({ p_actor_id: actorId, p_classroom_id: classroomId, p_title: 'Custom', p_deadline: '2026-10-06T03:25:20.000Z' })
    expect(init.signal).toBeInstanceOf(AbortSignal); expect(init.signal?.aborted).toBe(true)
    expect(call.from).not.toHaveBeenCalled(); expect(call.storage).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
  it.each([{}, { title: null }, { title: '' }, { title: ' \t\n\u00a0\u202f\ufeff ' }])('retains Toronto fallback for omitted/null/blank title %#', async fields => {
    titleWitness('Untitled 2026-10-05 23:25:00')
    expect(await invoke({ classroom_id: classroomId, ...fields }).result).toMatchObject({ test: { title: 'Untitled 2026-10-05 23:25:00' } })
    expect(JSON.parse(String(network.mock.calls[0][1]!.body)).p_title).toBe('Untitled 2026-10-05 23:25:00')
  })
  it('uses ECMAScript trim for a custom title and canonicalizes the Classroom UUID', async () => {
    expect(await invoke({ classroom_id: classroomId.toUpperCase(), title: '\u00a0\u202fCustom\ufeff' }).result).toMatchObject({ test: { title: 'Custom' } })
  })
  it.each([0, 3, 999])('accepts the selected category default weight %i without assuming ten', async weight => {
    data = { ...witness(), test: { ...test(), gradebook_category_id: otherId, gradebook_weight: weight } }
    expect(await invoke().result).toMatchObject({ test: { gradebook_category_id: otherId, gradebook_weight: weight } })
  })
  it.each([-2147483648, -3, 0, 2147483647])('retains PostgreSQL integer position %i', async position => {
    data = { ...witness(), test: { ...test(), position } }; expect(await invoke().result).toMatchObject({ test: { position } })
  })
  const badTest: Record<string, unknown> = {
    id: otherId, classroom_id: otherId, title: 'Forged', status: 'active', show_results: true, position: 2147483648,
    points_possible: 0, include_in_final: false, created_by: otherId, created_at: 'invalid', updated_at: '2026-10-06T03:25:01Z',
    documents: [{ id: 'forged' }], artifact_id: testId, source_artifact_id: otherId, blueprint_archived_at: stamp,
    source_blueprint_version_id: otherId, questions_locked_at: stamp, gradebook_category_id: 'bad', gradebook_weight: -1,
    gradebook_maximum_override: 100, gradebook_score_scale: 2,
  }
  it.each(Object.keys(badTest))('rejects mismatched full Test field %s', async key => {
    data = { ...witness(), test: { ...test(), [key]: badTest[key] } }
    await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 }); expect(network).toHaveBeenCalledTimes(1)
  })
  it.each(Object.keys(test()))('requires full Test field %s', async key => {
    const value: Record<string, unknown> = { ...test() }; delete value[key]
    data = { ...witness(), test: value }; await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
  })
  const badDraft: Record<string, unknown> = { id: testId, assessment_type: 'quiz', assessment_id: otherId, classroom_id: otherId,
    content: { ...content(), questions: [{ id: 'forged' }] }, version: 2, created_by: otherId, updated_by: otherId, created_at: 'invalid', updated_at: '2026-10-06T03:25:01Z' }
  it.each(Object.keys(badDraft))('rejects mismatched draft witness field %s', async key => {
    data = { ...witness(), draft: { ...draft(), [key]: badDraft[key] } }
    await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each(Object.keys(draft()))('requires draft witness field %s', async key => {
    const value: Record<string, unknown> = { ...draft() }; delete value[key]
    data = { ...witness(), draft: value }; await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each(['title', 'show_results', 'question_identity_version', 'questions', 'source_format'])('requires canonical initial content field %s', async key => {
    const value: Record<string, unknown> = { ...content() }; delete value[key]
    data = { ...witness(), draft: { ...draft(), content: value } }; await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([
    { ...witness(), version: 2 }, { ...witness(), actor_id: otherId }, { ...witness(), classroom_id: otherId }, { ...witness(), test_id: otherId },
    { ...witness(), private: 'hidden' }, { ...witness(), test: { ...test(), unknown: 'hidden' } },
    { ...witness(), draft: { ...draft(), unknown: 'hidden' } },
    { ...witness(), draft: { ...draft(), content: { ...content(), source_markdown: '' } } },
    { ...witness(), test: { ...test(), gradebook_category_id: null, gradebook_weight: 3 } },
    { ...witness(), test: { ...test(), artifact_id: draftId } },
    { ...witness(), test: { ...test(), gradebook_weight: 1000 } },
    { ...witness(), test: { ...test(), gradebook_weight: 1.5 } },
  ])('rejects private envelope/identity/default drift %#', async value => {
    data = value; await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects a uniformly future-stamped pair', async () => {
    const future = '2099-01-01T00:00:00Z'; data = { ...witness(), test: { ...test(), created_at: future, updated_at: future }, draft: { ...draft(), created_at: future, updated_at: future } }
    await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([['PT400', 400], ['PT403', 403], ['PT404', 404], ['PT409', 409], ['55P03', 409], ['40P01', 409], ['40001', 409],
    ['42501', 503], ['55000', 503], ['PGRST202', 503], ['42883', 503], ['23505', 503], ['XX000', 503], ['PT503', 503]])('maps %s safely without fallback/retry', async (code, statusCode) => {
    httpStatus = 400; data = { code, message: 'private SQL row', details: 'private ownership', hint: 'private grant' }
    const call = invoke(); await expect(call.result).rejects.toMatchObject({ statusCode, message: expect.not.stringContaining('private') })
    expect(network).toHaveBeenCalledTimes(1); expect(call.from).not.toHaveBeenCalled(); expect(call.storage).not.toHaveBeenCalled()
  })
  it('does not map raw privilege status403 to caller authorization', async () => {
    httpStatus = 403; data = { code: '42501', message: 'private grant' }
    await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
  })
  it('bounds raw RPC result before decoding', async () => {
    data = { ...witness(), unknown: 'é'.repeat(8192) }; await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects unresolved RPC at20s and physically aborts the SDK fetch', async () => {
    let aborted = false
    network.mockImplementation((_, init) => new Promise((_, reject) => { init?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) }, { once: true }) }))
    const call = invoke(); const checked = expect(call.result).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(20000); await checked
    expect(aborted).toBe(true); expect(network).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
  })
  it('does not renew an absolute deadline supplied after body parsing', async () => {
    network.mockImplementation(() => new Promise(() => {})); const call = invoke(undefined, Date.now() + 500)
    const checked = expect(call.result).rejects.toMatchObject({ statusCode: 503 }); await vi.advanceTimersByTimeAsync(500); await checked
    expect(JSON.parse(String(network.mock.calls[0][1]!.body)).p_deadline).toBe('2026-10-06T03:25:00.500Z')
  })
  it('rejects an elapsed budget before any RPC', async () => {
    await expect(invoke(undefined, Date.now()).result).rejects.toMatchObject({ statusCode: 503 }); expect(network).not.toHaveBeenCalled()
  })
  it('aborts caller-canceled RPC fetch and removes operation listeners', async () => {
    const controller = new AbortController(); const remove = vi.spyOn(controller.signal, 'removeEventListener')
    network.mockImplementation((_, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })))
    const checked = expect(createContextualTest({ supabase: client(), actorId, input: contextualTestCreateRequestSchema.parse({ classroom_id: classroomId, title: 'Custom' }), signal: controller.signal })).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(0); controller.abort(); await checked
    expect(network).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledWith('abort', expect.any(Function)); expect(vi.getTimerCount()).toBe(0)
  })
  it('removes caller listener after successful acknowledgment', async () => {
    const controller = new AbortController(); const remove = vi.spyOn(controller.signal, 'removeEventListener')
    await createContextualTest({ supabase: client(), actorId, input: contextualTestCreateRequestSchema.parse({ classroom_id: classroomId, title: 'Custom' }), signal: controller.signal })
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function)); expect(vi.getTimerCount()).toBe(0)
  })
})

describe('strict empty Test creation body', () => {
  afterEach(() => vi.useRealTimers())
  it.each([null, [], {}, { classroom_id: 'bad' }, { classroom_id: classroomId, title: 7 }, { classroom_id: classroomId, title: false }])('rejects malformed input %#', value => {
    expect(contextualTestCreateRequestSchema.safeParse(value).success).toBe(false)
  })
  it.each(['actor_id', 'plan', 'id', 'artifact_id', 'questions', 'documents', 'status', 'gradebook_weight', 'version'])('rejects forged %s before persistence', field => {
    expect(contextualTestCreateRequestSchema.safeParse({ classroom_id: classroomId, [field]: 'forged' }).success).toBe(false)
  })
  it('bounds raw UTF16 title units before trimming', () => {
    expect(contextualTestCreateRequestSchema.safeParse({ classroom_id: classroomId, title: 'x'.repeat(500) }).success).toBe(true)
    expect(contextualTestCreateRequestSchema.safeParse({ classroom_id: classroomId, title: ' '.repeat(501) }).success).toBe(false)
    expect(contextualTestCreateRequestSchema.safeParse({ classroom_id: classroomId, title: '😀'.repeat(251) }).success).toBe(false)
  })
  it.each(['nul\0title', '\ud800', '\udc00'])('rejects PostgreSQL-unrepresentable title text %#', title => {
    expect(contextualTestCreateRequestSchema.safeParse({ classroom_id: classroomId, title }).success).toBe(false)
  })
  it('returns actual UTF8 bytes and the unknown decoded JSON body', async () => {
    const payload = JSON.stringify({ classroom_id: classroomId, title: 'é' })
    expect(await readContextualTestCreateBody(new Request('http://localhost', { method: 'POST', body: payload }))).toEqual({ body: { classroom_id: classroomId, title: 'é' }, bytes: Buffer.byteLength(payload, 'utf8') })
  })
  it('bounds actual stream bytes regardless of forged content-length', async () => {
    await expect(readContextualTestCreateBody(new Request('http://localhost', { method: 'POST', headers: { 'content-length': '1' }, body: 'é'.repeat(TEST_CREATE_BODY_BYTES / 2 + 1) }))).rejects.toMatchObject({ statusCode: 400 })
  })
  it.each(['{', '\u0000', ''])('returns400 for malformed JSON %#', async body => {
    await expect(readContextualTestCreateBody(new Request('http://localhost', { method: 'POST', body }))).rejects.toMatchObject({ statusCode: 400 })
  })
  it('rejects invalid UTF8', async () => {
    await expect(readContextualTestCreateBody(new Request('http://localhost', { method: 'POST', body: new Uint8Array([0xff]) }))).rejects.toMatchObject({ statusCode: 400 })
  })
  it('physically cancels slow body reading at shared deadline', async () => {
    vi.useFakeTimers(); const cancel = vi.fn(); const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{')) }, cancel })
    const init = { method: 'POST', body: stream, duplex: 'half' }; const body = new Request('http://localhost', init)
    const checked = expect(readContextualTestCreateBody(body, Date.now() + 500)).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(500); await checked; expect(cancel).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
  })
  it('cancels body and clears listener when caller aborts', async () => {
    vi.useFakeTimers(); const controller = new AbortController(); const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ start(reader) { reader.enqueue(new TextEncoder().encode('{')) }, cancel })
    const init = { method: 'POST', body: stream, duplex: 'half', signal: controller.signal }; const body = new Request('http://localhost', init)
    const removeRequest = vi.spyOn(body.signal, 'removeEventListener'); const checked = expect(readContextualTestCreateBody(body)).rejects.toMatchObject({ statusCode: 503 })
    controller.abort(); await checked; expect(cancel).toHaveBeenCalledTimes(1); expect(removeRequest).toHaveBeenCalledWith('abort', expect.any(Function)); expect(vi.getTimerCount()).toBe(0)
  })
  it('cancels unread body when oversized content-length rejects before reading', async () => {
    const cancel = vi.fn(); const stream = new ReadableStream<Uint8Array>({ cancel }); const init = { method: 'POST', body: stream, duplex: 'half', headers: { 'content-length': '16385' } }
    await expect(readContextualTestCreateBody(new Request('http://localhost', init))).rejects.toMatchObject({ statusCode: 400 }); expect(cancel).toHaveBeenCalledTimes(1)
  })
})
