import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { publishContextualTest } from '@/lib/server/contextual-test-publication'
import { contextualTestPublicationResultSchema } from '@/lib/validations/contextual-test-publication'
import { contextualTestDraftGetSnapshotSchema } from '@/lib/validations/contextual-test-draft-get'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = '22222222-2222-4222-8222-222222222222'
const testId = '33333333-3333-4333-8333-333333333333'
const draftId = '44444444-4444-4444-8444-444444444444'
const artifactId = '55555555-5555-4555-8555-555555555555'
const questionId = '66666666-6666-4666-8666-666666666666'
const otherId = '77777777-7777-4777-8777-777777777777'
const stamp = '2026-10-06T12:05:00Z'
const sha = 'a'.repeat(64)
const content = () => ({ title: 'Ready Test', show_results: true, question_identity_version: 1, source_format: 'markdown', questions: [{
  id: questionId, question_type: 'open_response', question_text: 'Explain.', options: [], correct_option: null,
  answer_key: 'Reasoning', sample_solution: null, points: 5, response_max_chars: 2000, response_monospace: false,
}] })
const test = () => ({ id: testId, classroom_id: classroomId, title: 'Ready Test', status: 'closed', show_results: true, position: 7,
  points_possible: 100, include_in_final: false, created_by: otherId, created_at: stamp, updated_at: stamp, documents: [], artifact_id: artifactId,
  source_artifact_id: otherId, blueprint_archived_at: null, source_blueprint_version_id: otherId, questions_locked_at: null,
  gradebook_category_id: otherId, gradebook_weight: 37, gradebook_maximum_override: 80, gradebook_score_scale: 2 })
const snapshot = () => ({ version: 1, actor_id: actorId, classroom: { id: classroomId, teacher_id: actorId, archived_at: null },
  test: { id: testId, classroom_id: classroomId, title: 'Old', show_results: false, status: 'draft', blueprint_archived_at: null, questions_locked_at: null },
  draft: { id: draftId, assessment_type: 'test', assessment_id: testId, classroom_id: classroomId, content: content(), version: 7,
    created_by: otherId, updated_by: otherId, created_at: stamp, updated_at: stamp }, question_count: 0, questions: [], source_sha256: sha })
const witness = () => ({ version: 1, actor_id: actorId, classroom_id: classroomId, test_id: testId, source_sha256: sha, draft_version: 7, test: test() })
const persistedQuestion = () => ({ ...content().questions[0], id: otherId, test_id: testId, artifact_id: questionId, source_artifact_id: null, position: 0 })
let source: unknown; let result: unknown; let status: number; let network: ReturnType<typeof vi.fn<typeof fetch>>
const client = () => createClient<Database>('https://example.test', 'offline-service-key', { global: { fetch: network }, auth: { persistSession: false, autoRefreshToken: false } })
const invoke = (options: Partial<Parameters<typeof publishContextualTest>[0]> = {}) => {
  const supabase = client(); const from = vi.spyOn(supabase, 'from'); const storage = vi.spyOn(supabase.storage, 'from')
  return { result: publishContextualTest({ supabase, actorId, testId, input: { status: 'closed', draft_version: 7 }, ...options }), from, storage }
}

describe('bounded owner Test publication', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(stamp); source = snapshot(); result = witness(); status = 200
    network = vi.fn<typeof fetch>(async url => new Response(JSON.stringify(String(url).endsWith('/snapshot_test_draft_for_owner_v1') ? source : result), {
      status, headers: { 'Content-Type': 'application/json' },
    }))
  })
  afterEach(() => vi.useRealTimers())
  it('uses exactly two installed-SDK RPCs with one deadline and returns only legacy Test', async () => {
    const call = invoke(); expect(await call.result).toEqual({ test: { ...test(), assessment_type: 'test' } })
    expect(network).toHaveBeenCalledTimes(2)
    expect(network.mock.calls.map(([url]) => String(url))).toEqual([
      'https://example.test/rest/v1/rpc/snapshot_test_draft_for_owner_v1', 'https://example.test/rest/v1/rpc/publish_test_from_draft_for_owner_v1',
    ])
    expect(JSON.parse(String(network.mock.calls[0][1]?.body))).toEqual({ p_actor_id: actorId, p_test_id: testId, p_deadline: '2026-10-06T12:05:20.000Z' })
    expect(JSON.parse(String(network.mock.calls[1][1]?.body))).toEqual({ p_actor_id: actorId, p_test_id: testId, p_classroom_id: classroomId,
      p_expected_authoring_sha256: sha, p_expected_draft_version: 7, p_validated_content: content(), p_deadline: '2026-10-06T12:05:20.000Z' })
    expect(call.from).not.toHaveBeenCalled(); expect(call.storage).not.toHaveBeenCalled()
    for (const [, init] of network.mock.calls) {
      expect(init?.method).toBe('POST'); expect(new Headers(init?.headers).get('apikey')).toBe('offline-service-key')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer offline-service-key')
    }
    expect(network.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true); expect(vi.getTimerCount()).toBe(0)
  })
  it('accepts canonical JSON objects in a different key order', async () => {
    const raw = content(); source = { ...snapshot(), draft: { ...snapshot().draft, content: { questions: raw.questions, source_format: raw.source_format,
      show_results: raw.show_results, title: raw.title, question_identity_version: raw.question_identity_version } } }
    expect(await invoke().result).toMatchObject({ test: { status: 'closed', created_by: otherId, gradebook_weight: 37 } })
  })
  it.each([1, 2147483647])('uses observed current draft version %i without version1/default assumptions', async version => {
    source = { ...snapshot(), draft: { ...snapshot().draft, version } }; result = { ...witness(), draft_version: version }
    expect(await invoke({ input: { status: 'closed', draft_version: version } }).result).toMatchObject({ test: { status: 'closed', gradebook_weight: 37, created_by: otherId } })
    expect(JSON.parse(String(network.mock.calls[1][1]?.body)).p_expected_draft_version).toBe(version)
  })
  it('resolves existing portable question identity without rewriting a draft', async () => {
    source = { ...snapshot(), questions: [persistedQuestion()], question_count: 1 }
    expect(await invoke().result).toMatchObject({ test: { status: 'closed' } })
    expect(JSON.parse(String(network.mock.calls[1][1]?.body)).p_validated_content).toEqual(content())
  })
  it.each([
    ['question parent', [{ ...persistedQuestion(), test_id: actorId }]],
    ['duplicate row identity', [persistedQuestion(), persistedQuestion()]],
    ['duplicate portable identity', [persistedQuestion(), { ...persistedQuestion(), id: actorId, position: 1 }]],
    ['unsorted question position', [{ ...persistedQuestion(), position: 1 }, { ...persistedQuestion(), id: actorId, artifact_id: artifactId, position: 0 }]],
    ['unknown question column', [{ ...persistedQuestion(), private: 'hidden' }]],
  ])('rejects %s before publication', async (_, questions) => {
    source = { ...snapshot(), questions, question_count: questions.length }
    await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 }); expect(network).toHaveBeenCalledTimes(1)
  })
  it('rejects over-cap draft questions before canonical validation', async () => {
    source = { ...snapshot(), draft: { ...snapshot().draft, content: { ...content(), questions: Array.from({ length: 10001 }, () => ({ id: questionId })) } } }
    await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 }); expect(network).toHaveBeenCalledTimes(1)
  })
  it('normalizes existing documents while retaining full Test metadata', async () => {
    result = { ...witness(), test: { ...test(), documents: [{ id: ' doc ', title: ' Existing ', source: 'text', content: 'Notes', ignored: 'legacy' }] } }
    expect(await invoke().result).toEqual({ test: { ...test(), assessment_type: 'test', documents: [{ id: 'doc', title: 'Existing', source: 'text', content: 'Notes' }] } })
  })
  it.each([
    ['actor binding', { ...snapshot(), actor_id: otherId }, 503],
    ['owner', { ...snapshot(), classroom: { ...snapshot().classroom, teacher_id: otherId } }, 403],
    ['archive', { ...snapshot(), classroom: { ...snapshot().classroom, archived_at: stamp } }, 403],
    ['Test binding', { ...snapshot(), test: { ...snapshot().test, id: otherId } }, 503],
    ['retired Test', { ...snapshot(), test: { ...snapshot().test, blueprint_archived_at: stamp } }, 403],
    ['missing draft', { ...snapshot(), draft: null }, 404],
    ['stale version', { ...snapshot(), draft: { ...snapshot().draft, version: 8 } }, 409],
    ['draft binding', { ...snapshot(), draft: { ...snapshot().draft, classroom_id: otherId } }, 503],
    ['count', { ...snapshot(), question_count: 1 }, 503],
    ['digest', { ...snapshot(), source_sha256: 'bad' }, 503],
    ['noncanonical raw', { ...snapshot(), draft: { ...snapshot().draft, content: { ...content(), title: ' Ready Test ' } } }, 400],
    ['empty questions', { ...snapshot(), draft: { ...snapshot().draft, content: { ...content(), questions: [] } } }, 400],
    ['unknown raw content', { ...snapshot(), draft: { ...snapshot().draft, content: { ...content(), ignored: 'hidden' } } }, 400],
  ])('rejects %s nondestructively', async (_, value, statusCode) => {
    source = value; await expect(invoke().result).rejects.toMatchObject({ statusCode }); expect(network).toHaveBeenCalledTimes(1)
  })
  it.each(['version', 'actor_id', 'classroom_id', 'test_id', 'source_sha256', 'draft_version'])('rejects altered final %s', async field => {
    result = { ...witness(), [field]: field === 'version' || field === 'draft_version' ? 2 : otherId }
    await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 }); expect(network).toHaveBeenCalledTimes(2)
  })
  it.each([['id', otherId], ['classroom_id', otherId], ['status', 'active'], ['title', 'Forged'], ['show_results', false],
    ['blueprint_archived_at', stamp], ['questions_locked_at', stamp]])('rejects ineligible final Test %s', async (field, value) => {
    result = { ...witness(), test: { ...test(), [field]: value } }; await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each(Object.keys(test()))('requires complete final Test field %s', async field => {
    const row: Record<string, unknown> = test(); delete row[field]; result = { ...witness(), test: row }
    await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([['PT400', 400], ['PT403', 403], ['PT404', 404], ['PT409', 409], ['55P03', 409], ['40P01', 409], ['40001', 409],
    ['42501', 503], ['55000', 503], ['PGRST202', 503], ['23505', 503], ['XX000', 503]])('maps fixed %s without diagnostics or retries', async (code, statusCode) => {
    status = 403; source = { code, message: 'private SQL state', details: 'private', hint: 'private' }
    const call = invoke(); await expect(call.result).rejects.toMatchObject({ statusCode, message: expect.not.stringContaining('private') })
    expect(network).toHaveBeenCalledTimes(1); expect(call.from).not.toHaveBeenCalled(); expect(call.storage).not.toHaveBeenCalled()
  })
  it('does not retry an unknown publication acknowledgement', async () => {
    network.mockImplementation(async url => {
      if (String(url).endsWith('/snapshot_test_draft_for_owner_v1')) return new Response(JSON.stringify(source))
      throw new Error('acknowledgement lost')
    })
    await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 }); expect(network).toHaveBeenCalledTimes(2)
  })
  it.each([['PT400', 400], ['PT403', 403], ['PT404', 404], ['PT409', 409], ['42501', 503], ['55000', 503], ['23505', 503]])('maps final %s without any fallback', async (code, statusCode) => {
    network.mockImplementation(async url => String(url).endsWith('/snapshot_test_draft_for_owner_v1') ? new Response(JSON.stringify(source))
      : new Response(JSON.stringify({ code, message: 'private final state', details: null, hint: null }), { status: 400 }))
    const call = invoke(); await expect(call.result).rejects.toMatchObject({ statusCode, message: expect.not.stringContaining('private') })
    expect(network).toHaveBeenCalledTimes(2); expect(call.from).not.toHaveBeenCalled(); expect(call.storage).not.toHaveBeenCalled()
  })
  it('rejects unknown final witness fields rather than exposing them', async () => {
    result = { ...witness(), draft: snapshot().draft }; await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 })
  })
  it('removes the operation abort listener even if phase1 never acknowledges', async () => {
    let remove: ReturnType<typeof vi.spyOn> | undefined
    network.mockImplementation((_, init) => { remove = vi.spyOn(init!.signal!, 'removeEventListener'); return new Promise(() => {}) })
    const call = invoke(); const checked = expect(call.result).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(20000); await checked
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function)); expect(vi.getTimerCount()).toBe(0)
  })
  it('physically aborts stalled phase2 under the original shortened budget', async () => {
    network.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/snapshot_test_draft_for_owner_v1')) return new Response(JSON.stringify(source))
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    })
    const call = invoke({ deadline: Date.now() + 500 }); const checked = expect(call.result).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(500); await checked
    expect(network).toHaveBeenCalledTimes(2); expect(network.mock.calls[1][1]?.signal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0)
  })
  it('cancels a never-settling phase1 without phase2', async () => {
    const controller = new AbortController(); network.mockImplementation(() => new Promise(() => {}))
    const call = invoke({ signal: controller.signal }); const checked = expect(call.result).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(0); controller.abort(); await checked
    expect(network).toHaveBeenCalledTimes(1); expect(network.mock.calls[0][1]?.signal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects elapsed budget without network', async () => {
    await expect(invoke({ deadline: Date.now() }).result).rejects.toMatchObject({ statusCode: 503 }); expect(network).not.toHaveBeenCalled()
  })
  it.each([Infinity, -Infinity, NaN])('rejects explicit nonfinite deadline %s without renewal', async deadline => {
    await expect(invoke({ deadline }).result).rejects.toMatchObject({ statusCode: 503 }); expect(network).not.toHaveBeenCalled()
  })
  it('bounds the raw final Test before the private schema clones it', async () => {
    result = { ...witness(), test: { ...test(), title: 'é'.repeat(1100000) } }
    const parse = vi.spyOn(contextualTestPublicationResultSchema, 'safeParse')
    try { await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 }); expect(parse).not.toHaveBeenCalled() }
    finally { parse.mockRestore() }
  })
  it('bounds the raw full Draft before snapshot schema cloning', async () => {
    source = { ...snapshot(), draft: { ...snapshot().draft, content: { ...content(), title: 'é'.repeat(1100000) } } }
    const parse = vi.spyOn(contextualTestDraftGetSnapshotSchema, 'safeParse')
    try { await expect(invoke().result).rejects.toMatchObject({ statusCode: 503 }); expect(parse).not.toHaveBeenCalled() }
    finally { parse.mockRestore() }
  })
})
