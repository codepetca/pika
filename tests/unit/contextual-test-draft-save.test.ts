import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { getServiceRoleClient } from '@/lib/supabase'
import { saveContextualTestDraft } from '@/lib/server/contextual-test-draft-save'
import { TEST_CORRECTIONS_MESSAGE } from '@/lib/test-editing-policy'
import { contextualTestDraftSaveRequestSchema, readContextualTestDraftSaveBody, TEST_DRAFT_SAVE_BODY_BYTES } from '@/lib/validations/contextual-test-draft-save'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = '22222222-2222-4222-8222-222222222222'
const testId = '33333333-3333-4333-8333-333333333333'
const draftId = '44444444-4444-4444-8444-444444444444'
const rowId = '55555555-5555-4555-8555-555555555555'
const portableId = '66666666-6666-4666-8666-666666666666'
const otherId = '77777777-7777-4777-8777-777777777777'
const stamp = '2026-10-04T00:00:00Z'
const content = () => ({ title: 'Draft', show_results: false, question_identity_version: 1 as const, questions: [] })
const question = () => ({ id: rowId, test_id: testId, artifact_id: portableId, source_artifact_id: null, question_type: 'open_response', question_text: 'Question?', options: [], correct_option: null, answer_key: 'Answer', sample_solution: null, points: 1, response_max_chars: 5000, response_monospace: false, position: 0 })
const snapshot = () => ({ version: 1, actor_id: actorId, classroom: { id: classroomId, teacher_id: actorId, archived_at: null }, test: { id: testId, classroom_id: classroomId, title: 'Persisted', show_results: true, status: 'draft', blueprint_archived_at: null, questions_locked_at: null, documents: [], updated_at: stamp }, draft: { id: draftId, assessment_type: 'test', assessment_id: testId, classroom_id: classroomId, content: content(), version: 7, created_by: otherId, updated_by: otherId, created_at: stamp, updated_at: stamp }, question_count: 0, questions: [], source_sha256: 'a'.repeat(64) })
type Source = ReturnType<typeof snapshot>
type Args = { p_operation: string; p_content: ReturnType<typeof content> | null; p_documents: unknown; p_update_documents: boolean }
let source: Source
let rpc: ReturnType<typeof vi.fn>
let signals: AbortSignal[]
let mutateFinal: (value: Record<string, unknown>) => unknown
const invoke = (value: unknown = { version: 7, content: content() }) => saveContextualTestDraft({ supabase: { rpc } as unknown as ReturnType<typeof getServiceRoleClient>, actorId, testId, input: contextualTestDraftSaveRequestSchema.parse(value) })

describe('contextual owner Test draft save', () => {
  beforeEach(() => {
    source = snapshot(); signals = []; mutateFinal = value => value
    rpc = vi.fn((name: string, args: Args) => ({ abortSignal: (signal: AbortSignal) => {
      signals.push(signal)
      if (name === 'snapshot_test_draft_save_for_owner_v1') return Promise.resolve({ data: source, error: null })
      const saved = args.p_operation === 'save'
      const data = { version: 1, actor_id: actorId, classroom_id: classroomId, test_id: testId, operation: args.p_operation,
        draft: source.draft && args.p_content ? { ...source.draft, content: args.p_content, ...(saved ? { version: source.draft.version + 1, updated_by: actorId, updated_at: '2026-10-04T00:00:01Z' } : {}) } : null,
        test: { ...source.test, ...(saved ? { title: args.p_content!.title, show_results: args.p_content!.show_results, updated_at: '2026-10-04T00:00:01Z', ...(args.p_update_documents ? { documents: args.p_documents } : {}) } : {}) }, editingPolicy: { structureLocked: source.test.questions_locked_at !== null } }
      return Promise.resolve({ data: mutateFinal(data), error: null })
    } }))
  })
  afterEach(() => vi.useRealTimers())

  it('saves using two RPCs, fixed identities, opaque source CAS and one signal/deadline', async () => {
    const result = await invoke()
    expect(result.status).toBe(200); expect(Object.keys(result.body).sort()).toEqual(['draft', 'editingPolicy', 'test'])
    expect(result.body).toMatchObject({ draft: { version: 8, created_by: otherId, updated_by: actorId }, test: { title: 'Draft' } })
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_operation: 'save', p_expected_version: 7, p_expected_source_sha256: 'a'.repeat(64), p_actor_id: actorId, p_test_id: testId, p_classroom_id: classroomId, p_update_documents: false, p_documents: null })
    expect(signals[0]).toBe(signals[1]); expect(rpc.mock.calls[0][1].p_deadline).toBe(rpc.mock.calls[1][1].p_deadline)
  })
  it('retains patch precedence over full content', async () => {
    const result = await invoke({ version: 7, content: { ...content(), title: 'Ignored' }, patch: [{ op: 'replace', path: '/title', value: 'Patched' }] })
    expect(result.body).toMatchObject({ draft: { content: { title: 'Patched' } } })
  })
  it('accepts the active editor question wire shape without trusting its parent, ordinal or stamps', async () => {
    const canonical = { id: portableId, question_type: 'open_response', question_text: 'Question?', options: [], correct_option: null,
      answer_key: 'Answer', sample_solution: null, points: 1, response_max_chars: 5000, response_monospace: false }
    const editorQuestion = { ...canonical, test_id: otherId, position: 99, created_at: stamp, updated_at: stamp }
    const result = await invoke({ version: 7, content: { ...content(), questions: [editorQuestion] } })
    expect(result.status).toBe(200); expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[1][1].p_content.questions).toEqual([canonical])
  })
  it.each([
    { test_id: 'not-a-uuid' }, { position: -1 }, { position: 10000 }, { position: 1.5 },
    { created_at: 'x'.repeat(257) }, { updated_at: false }, { unknown_editor_field: true },
  ])('rejects malformed or unknown editor transport fields before any RPC %#', async metadata => {
    const editorQuestion = { id: portableId, question_type: 'open_response', question_text: 'Question?', options: [], correct_option: null,
      answer_key: 'Answer', sample_solution: null, points: 1, response_max_chars: 5000, response_monospace: false, ...metadata }
    await expect(Promise.resolve().then(() => invoke({ version: 7, content: { ...content(), questions: [editorQuestion] } }))).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each(['absent', 'invalid', 'unmarked'])('inspects %s baseline for reload without any save', async state => {
    if (state === 'absent') Object.assign(source, { draft: null })
    else if (state === 'unmarked') Object.assign(source.draft, { content: { title: 'Draft', show_results: false, questions: [] } })
    else Object.assign(source.draft, { content: null })
    const result = await invoke()
    expect(result).toEqual({ status: 409, body: { error: 'Reload test draft before saving' } })
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_operation: 'inspect', p_content: null, p_expected_version: state === 'absent' ? null : 7 })
  })
  it('uses verified inspect for optimistic version conflicts', async () => {
    const result = await invoke({ version: 6, content: content() })
    expect(result.status).toBe(409); expect(result.body).toMatchObject({ draft: { version: 7 }, editingPolicy: { structureLocked: false } })
    expect(rpc.mock.calls[1][1].p_operation).toBe('inspect')
  })
  it.each(['active', 'closed'])('rebuilds %s baseline from portable persisted rows at raw version', async mode => {
    source.test.status = mode; Object.assign(source.draft, { content: null }); Object.assign(source, { question_count: 1, questions: [question()] })
    const result = await invoke({ version: 6, patch: [] })
    expect(result.body).toMatchObject({ draft: { version: 7, content: { title: 'Persisted', questions: [{ id: portableId }] } } })
  })
  it('verifies started-Test policy conflicts before returning the baseline', async () => {
    Object.assign(source.test, { questions_locked_at: stamp })
    const q = question(); Object.assign(source, { question_count: 1, questions: [q] }); Object.assign(source.draft.content, { questions: [{ ...structuredClone(q), id: portableId }] })
    const result = await invoke()
    expect(result.status).toBe(409); expect(result.body).toMatchObject({ editingPolicy: { structureLocked: true } })
    expect(rpc.mock.calls[1][1].p_operation).toBe('inspect')
  })
  it('strips forged snapshots and preserves only matching bound link identity', async () => {
    const current = { id: 'link', title: 'Current', source: 'link', url: 'https://example.test/a', snapshot_path: 'bound/path', synced_at: stamp }
    Object.assign(source.test, { documents: [current] })
    const docs = [{ ...current, title: 'Renamed', snapshot_path: 'forged/path' }, { ...current, id: 'new', url: 'https://example.test/b', snapshot_path: 'forged/path' }]
    await invoke({ version: 7, content: content(), documents: docs })
    expect(rpc.mock.calls[1][1].p_documents).toEqual([{ ...current, title: 'Renamed' }, { id: 'new', title: 'Current', source: 'link', url: 'https://example.test/b' }])
  })
  it('retains validated PDF upload MIME when stripping client snapshot metadata', async () => {
    const upload = { id: 'pdf', title: 'PDF', source: 'upload', storage_bucket: 'test-documents', storage_path: 'classrooms/test/pdf', managed_object_id: otherId, upload_content_type: 'application/pdf', snapshot_path: 'forged/path' }
    await invoke({ version: 7, content: content(), documents: [upload] })
    expect(rpc.mock.calls[1][1].p_documents).toEqual([{ id: 'pdf', title: 'PDF', source: 'upload', storage_bucket: 'test-documents', storage_path: 'classrooms/test/pdf', managed_object_id: otherId, upload_content_type: 'application/pdf' }])
  })
  it('retains bounded raw legacy URL-only uploads and unknown source fields on no-doc saves', async () => {
    const legacy = { id: 'upload', title: 'Upload', source: 'upload', url: 'https://example.supabase.co/storage/v1/object/public/test-documents/legacy/file.pdf', historical_metadata: { unknown: true } }
    Object.assign(source.test, { documents: [legacy] })
    const result = await invoke()
    expect(result.status).toBe(200); expect(result.body).toMatchObject({ test: { documents: [legacy] } })
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_update_documents: false, p_documents: null })
  })
  it('ignores unknown bounded source link fields when preserving snapshots', async () => {
    const link = { id: 'link', title: 'Link', source: 'link', url: 'https://example.test', snapshot_path: 'bound/path', unknown: true }
    Object.assign(source.test, { documents: [link] })
    await invoke({ version: 7, content: content(), documents: [{ id: 'link', title: 'Changed', source: 'link', url: 'https://example.test' }] })
    expect(rpc.mock.calls[1][1].p_documents).toEqual([{ id: 'link', title: 'Changed', source: 'link', url: 'https://example.test', snapshot_path: 'bound/path' }])
  })
  it('uses exact raw source identity and preserves exact bound snapshot metadata', async () => {
    const link = { id: 'link', title: 'Link', source: 'link', url: 'https://example.test', snapshot_path: 'bound/path', snapshot_content_type: 'Text/HTML', synced_at: stamp }
    Object.assign(source.test, { documents: [link] })
    await invoke({ version: 7, content: content(), documents: [{ id: 'link', title: 'Changed', source: 'link', url: 'https://example.test' }] })
    expect(rpc.mock.calls[1][1].p_documents).toEqual([{ ...link, title: 'Changed' }])
    rpc.mockClear(); Object.assign(source.test, { documents: [{ ...link, url: ' https://example.test ' }] })
    await invoke({ version: 7, content: content(), documents: [{ id: 'link', title: 'Changed', source: 'link', url: 'https://example.test' }] })
    expect(rpc.mock.calls[1][1].p_documents).toEqual([{ id: 'link', title: 'Changed', source: 'link', url: 'https://example.test' }])
  })
  it.each([
    [{ id: 'a', title: 'A', source: 'text', content: 'x', unknown: 'é'.repeat(1024 * 1024) }],
    [{ id: 'a', title: 'A', source: 'text', content: 'x' }, { id: ' a ', title: 'B', source: 'text', content: 'y' }],
    [{ id: 'a', title: 'A', source: 'text', content: 'x' }, { id: 'b', title: 'B', source: 'link' }],
  ])('does not hide raw source document overflow, duplicate IDs or item dropping %#', async documents => {
    Object.assign(source.test, { documents })
    await expect(invoke()).rejects.toMatchObject({ statusCode: 503 }); expect(rpc).toHaveBeenCalledTimes(1)
  })
  it.each(['owner', 'archive', 'retired'])('denies %s changes without save', async cause => {
    if (cause === 'owner') source.classroom.teacher_id = otherId
    else if (cause === 'archive') Object.assign(source.classroom, { archived_at: stamp })
    else Object.assign(source.test, { blueprint_archived_at: stamp })
    await expect(invoke()).rejects.toMatchObject({ statusCode: 403 }); expect(rpc).toHaveBeenCalledTimes(1)
  })
  it.each([
    (s: Source) => Object.assign(s, { actor_id: otherId }),
    (s: Source) => Object.assign(s.test, { classroom_id: otherId }),
    (s: Source) => Object.assign(s.draft, { assessment_id: otherId }),
    (s: Source) => Object.assign(s, { question_count: 1 }),
    (s: Source) => Object.assign(s.test, { secret: 'private' }),
    (s: Source) => Object.assign(s, { question_count: 2, questions: [question(), { ...question(), id: otherId, position: -1 }] }),
    (s: Source) => Object.assign(s.draft.content, { extra: 'é'.repeat(1024 * 1024) }),
    (s: Source) => Object.assign(s.draft, { version: 2147483648 }),
  ])('fails closed on source substitution or bounds %#', async mutate => {
    mutate(source); await expect(invoke()).rejects.toMatchObject({ statusCode: 503 }); expect(rpc).toHaveBeenCalledTimes(1)
  })
  it.each([
    (r: Record<string, unknown>) => ({ ...r, actor_id: otherId }),
    (r: Record<string, unknown>) => ({ ...r, test: { ...source.test, classroom_id: otherId } }),
    (r: Record<string, unknown>) => ({ ...r, draft: { ...source.draft, version: 9 } }),
    (r: Record<string, unknown>) => ({ ...r, draft: null }),
    (r: Record<string, unknown>) => ({ ...r, editingPolicy: { structureLocked: true } }),
    (r: Record<string, unknown>) => ({ ...r, test: { ...source.test, private: true } }),
  ])('fails closed on final substitutions %#', async mutate => {
    mutateFinal = mutate; await expect(invoke()).rejects.toMatchObject({ statusCode: 503 }); expect(rpc).toHaveBeenCalledTimes(2)
  })
  it.each(['id', 'assessment_id', 'classroom_id', 'created_by', 'updated_by'])('rejects final draft %s identity/stamp substitution', async field => {
    mutateFinal = result => ({ ...result, draft: { ...(result.draft as object), [field]: rowId } })
    await expect(invoke()).rejects.toMatchObject({ statusCode: 503 }); expect(rpc).toHaveBeenCalledTimes(2)
  })
  it.each(['created_at', 'updated_at'])('rejects final draft %s time drift', async field => {
    mutateFinal = result => ({ ...result, draft: { ...(result.draft as object), [field]: '2099-01-01T00:00:00Z' } })
    await expect(invoke()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each(['title', 'show_results', 'documents', 'status'])('rejects final Test %s drift', async field => {
    const changed = { title: 'Substitution', show_results: true, documents: [{ id: 'unknown', source: 'text', title: 'Unknown', content: 'unknown' }], status: 'closed' }
    mutateFinal = result => ({ ...result, test: { ...(result.test as object), [field]: changed[field as keyof typeof changed] } })
    await expect(invoke()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([['42501', 503], ['55000', 503], ['PGRST202', 503], ['PT400', 400], ['PT403', 403], ['PT404', 404], ['PT409', 409], ['55P03', 409], ['40P01', 409], ['40001', 409]])('maps snapshot %s safely', async (code, statusCode) => {
    rpc.mockImplementation(() => ({ abortSignal: () => Promise.resolve({ data: null, error: { code, message: 'private row' } }) }))
    await expect(invoke()).rejects.toMatchObject({ statusCode, message: expect.not.stringContaining('private') })
  })
  it('returns a bare final CAS conflict without any latest-draft query', async () => {
    const original = rpc.getMockImplementation()!
    rpc.mockImplementation((name, args) => name.startsWith('finish_') ? { abortSignal: () => Promise.resolve({ data: null, error: { code: 'PT409', message: 'private' } }) } : original(name, args))
    await expect(invoke()).rejects.toMatchObject({ statusCode: 409 }); expect(rpc).toHaveBeenCalledTimes(2)
  })
  it('keeps the canonical correction message only for the exact locked-policy final domain error', async () => {
    const original = rpc.getMockImplementation()!
    rpc.mockImplementation((name, args) => name.startsWith('finish_')
      ? { abortSignal: () => Promise.resolve({ data: null, error: { code: 'PT409', message: 'test_questions_locked: Only question wording and existing choice text can change after a student starts' } }) }
      : original(name, args))
    await expect(invoke()).rejects.toMatchObject({ statusCode: 409, message: TEST_CORRECTIONS_MESSAGE })
    expect(rpc).toHaveBeenCalledTimes(2)
  })
  it.each([['PT400', 400], ['PT403', 403], ['PT404', 409], ['PT409', 409], ['42501', 503], ['55000', 503], ['PGRST202', 503], ['42883', 503], ['XX000', 503]])('maps final %s without retry or unsafe latest reads', async (code, statusCode) => {
    const original = rpc.getMockImplementation()!
    rpc.mockImplementation((name, args) => name.startsWith('finish_') ? { abortSignal: () => Promise.resolve({ data: null, error: { code, message: 'private final row' } }) } : original(name, args))
    await expect(invoke()).rejects.toMatchObject({ statusCode, message: expect.not.stringContaining('private') })
    expect(rpc).toHaveBeenCalledTimes(2)
  })
  it.each(['snapshot', 'final'])('rejects contradictory %s success/error envelopes', async phase => {
    const original = rpc.getMockImplementation()!
    rpc.mockImplementation((name, args) => (phase === 'snapshot') === name.startsWith('snapshot_')
      ? { abortSignal: () => Promise.resolve({ data: { private: 'source' }, error: { code: 'PT403', message: 'private' } }) } : original(name, args))
    await expect(invoke()).rejects.toMatchObject({ statusCode: 503 }); expect(rpc).toHaveBeenCalledTimes(phase === 'snapshot' ? 1 : 2)
  })
  it.each(['snapshot', 'final'])('rejects non-success HTTP status with %s success data', async phase => {
    const original = rpc.getMockImplementation()!
    rpc.mockImplementation((name, args) => {
      const query = original(name, args)
      return (phase === 'snapshot') === name.startsWith('snapshot_')
        ? { abortSignal: (signal: AbortSignal) => query.abortSignal(signal).then((value: object) => ({ ...value, status: 403 })) } : query
    })
    await expect(invoke()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each(['snapshot', 'final'])('rejects raw %s privilege failure even with HTTP403', async phase => {
    const original = rpc.getMockImplementation()!
    rpc.mockImplementation((name, args) => (phase === 'snapshot') === name.startsWith('snapshot_')
      ? { abortSignal: () => Promise.resolve({ data: null, error: { code: '42501', message: 'private grant', details: 'private table', hint: 'private role' }, status: 403, statusText: 'Forbidden' }) } : original(name, args))
    await expect(invoke()).rejects.toMatchObject({ statusCode: 503, message: 'Unable to verify test draft save' })
  })
  it.each(['draft', 'test'])('rejects future %s save stamps before DML', async target => {
    vi.useFakeTimers(); vi.setSystemTime('2026-10-05T00:00:00Z')
    Object.assign(target === 'draft' ? source.draft : source.test, { updated_at: '2026-10-06T00:00:00Z' })
    await expect(invoke()).rejects.toMatchObject({ statusCode: 503 }); expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('rejects version overflow before save while permitting exact max-version inspection', async () => {
    source.draft.version = 2147483647
    expect((await invoke()).status).toBe(409); expect(rpc.mock.calls[1][1].p_operation).toBe('inspect')
    rpc.mockClear()
    await expect(invoke({ version: 2147483647, content: content() })).rejects.toMatchObject({ statusCode: 503 })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('rejects unknown candidate fields instead of silently discarding them', async () => {
    await expect(invoke({ version: 7, patch: [{ op: 'add', path: '/ignored', value: 'hidden' }] })).rejects.toMatchObject({ statusCode: 400 })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('rejects a forged invalid baseline in a reload final response', async () => {
    Object.assign(source.draft, { content: null }); mutateFinal = result => ({ ...result, draft: source.draft })
    await expect(invoke()).rejects.toMatchObject({ statusCode: 503 }); expect(rpc).toHaveBeenCalledTimes(2)
  })
  it('aborts a hung RPC at the shared deadline', async () => {
    vi.useFakeTimers(); rpc.mockImplementation(() => ({ abortSignal: (signal: AbortSignal) => { signals.push(signal); return new Promise(() => {}) } }))
    const checked = expect(invoke()).rejects.toMatchObject({ statusCode: 503 }); await vi.advanceTimersByTimeAsync(20000); await checked
    expect(signals[0].aborted).toBe(true); expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('does not renew a supplied deadline after body decoding', async () => {
    vi.useFakeTimers(); const deadline = Date.now() + 500
    rpc.mockImplementation(() => ({ abortSignal: (signal: AbortSignal) => { signals.push(signal); return new Promise(() => {}) } }))
    const checked = expect(saveContextualTestDraft({ supabase: { rpc } as unknown as ReturnType<typeof getServiceRoleClient>, actorId, testId, input: contextualTestDraftSaveRequestSchema.parse({ version: 7, content: content() }), deadline })).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(500); await checked
    expect(signals[0].aborted).toBe(true); expect(rpc.mock.calls[0][1].p_deadline).toBe(new Date(deadline).toISOString())
  })
  it('bounds copy expansion before canonical normalization', async () => {
    Object.assign(source.draft.content, { source_markdown: 'é'.repeat(700000) })
    await expect(invoke({ version: 7, patch: [{ op: 'copy', from: '/source_markdown', path: '/title' }] })).rejects.toMatchObject({ statusCode: 400 })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})

describe('strict contextual Test save transport', () => {
  afterEach(() => vi.useRealTimers())
  it.each([0, -1, 1.5, '1', 2147483648, Infinity, NaN])('rejects invalid version %s', version => {
    expect(contextualTestDraftSaveRequestSchema.safeParse({ version, content: content() }).success).toBe(false)
  })
  it.each([
    { op: 'unknown', path: '/title' }, { op: 'remove', path: '/title', value: 'extra' }, { op: 'replace', path: '/title' },
    { op: 'copy', path: '/title' }, { op: 'replace', path: 'title', value: 'x' }, { op: 'replace', path: '/bad~2', value: 'x' },
    { op: 'add', path: '/__proto__/x', value: 'x' }, { op: 'move', path: '/title', from: '/constructor/x' },
  ])('rejects malformed RFC6902 operations %#', operation => {
    expect(contextualTestDraftSaveRequestSchema.safeParse({ version: 1, patch: [operation] }).success).toBe(false)
  })
  it.each(['add', 'replace', 'test', 'remove', 'move', 'copy'])('decodes supported %s operations', op => {
    const operation = op === 'remove' ? { op, path: '/title' } : ['move', 'copy'].includes(op) ? { op, path: '/title', from: '/source_markdown' } : { op, path: '/title', value: 'x' }
    expect(contextualTestDraftSaveRequestSchema.safeParse({ version: 1, patch: [operation] }).success).toBe(true)
  })
  it.each([
    [{ id: 'a', title: 'A', source: 'text', content: 'x'.repeat(20001) }],
    [{ id: 'a', title: 'A'.repeat(121), source: 'text', content: 'x' }],
    [{ id: 'a', title: 'A', source: 'text', content: 'x' }, { id: 'a', title: 'B', source: 'link', url: 'https://example.test' }],
    [{ id: 'a', title: 'A', source: 'upload', storage_path: '../escape' }],
  ])('rejects documents before normalizing/truncating %#', documents => {
    expect(contextualTestDraftSaveRequestSchema.safeParse({ version: 1, content: content(), documents }).success).toBe(false)
  })
  it('rejects oversized raw content and excessive operation count', () => {
    expect(contextualTestDraftSaveRequestSchema.safeParse({ version: 1, content: { ...content(), source_markdown: 'é'.repeat(1024 * 1024) } }).success).toBe(false)
    expect(contextualTestDraftSaveRequestSchema.safeParse({ version: 1, patch: Array.from({ length: 10001 }, () => ({ op: 'remove', path: '/title' })) }).success).toBe(false)
  })
  it('rejects actual UTF8 bytes before JSON decoding even with forged content-length', async () => {
    const request = new Request('http://localhost', { method: 'PATCH', headers: { 'content-length': '1' }, body: 'é'.repeat(TEST_DRAFT_SAVE_BODY_BYTES / 2 + 1) })
    await expect(readContextualTestDraftSaveBody(request)).rejects.toMatchObject({ statusCode: 400 })
  })
  it('rejects invalid UTF8 and malformed JSON safely', async () => {
    await expect(readContextualTestDraftSaveBody(new Request('http://localhost', { method: 'PATCH', body: new Uint8Array([0xff]) }))).rejects.toMatchObject({ statusCode: 400 })
    await expect(readContextualTestDraftSaveBody(new Request('http://localhost', { method: 'PATCH', body: '{' }))).rejects.toMatchObject({ statusCode: 400 })
  })
  it('cancels an orphaned slow body stream at the deadline', async () => {
    vi.useFakeTimers(); const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{')) }, cancel })
    const body = new Request('http://localhost', { method: 'PATCH', body: stream, duplex: 'half' } as RequestInit)
    const checked = expect(readContextualTestDraftSaveBody(body, Date.now() + 500)).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(500); await checked
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
