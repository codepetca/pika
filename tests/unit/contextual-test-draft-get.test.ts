import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getContextualTestDraft } from '@/lib/server/contextual-test-draft-get'
import type { getServiceRoleClient } from '@/lib/supabase'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = '22222222-2222-4222-8222-222222222222'
const testId = '33333333-3333-4333-8333-333333333333'
const draftId = '44444444-4444-4444-8444-444444444444'
const rowId = '55555555-5555-4555-8555-555555555555'
const portableId = '66666666-6666-4666-8666-666666666666'
const otherId = '77777777-7777-4777-8777-777777777777'
const timestamp = '2026-10-04T00:00:00Z'
const content = () => ({ title: ' Draft ', show_results: false, questions: [], source_format: 'markdown', source_markdown: '# Source' })
const question = () => ({ id: rowId, test_id: testId, artifact_id: portableId, source_artifact_id: null,
  question_type: 'open_response', question_text: 'Question?', options: [], correct_option: null,
  answer_key: 'Answer', sample_solution: null, points: 1, response_max_chars: 5000, response_monospace: false, position: 0 })
const draft = () => ({ id: draftId, assessment_type: 'test', assessment_id: testId, classroom_id: classroomId,
  content: content(), version: 7, created_by: otherId, updated_by: otherId, created_at: timestamp, updated_at: timestamp })
const snapshot = () => ({ version: 1, actor_id: actorId,
  classroom: { id: classroomId, teacher_id: actorId, archived_at: null },
  test: { id: testId, classroom_id: classroomId, title: 'Persisted', show_results: true, status: 'draft',
    blueprint_archived_at: null, questions_locked_at: null },
  draft: draft(), question_count: 0, questions: [], source_sha256: 'a'.repeat(64) })
type Source = ReturnType<typeof snapshot>
type Args = { p_operation: string; p_content: unknown }
let source: Source
let finalMutate: (value: Record<string, unknown>) => unknown
let failure: { code: string; message: string } | null
let rpc: ReturnType<typeof vi.fn>
let signals: AbortSignal[]
const invoke = () => getContextualTestDraft({ supabase: { rpc } as unknown as ReturnType<typeof getServiceRoleClient>, actorId, testId })
const status = async (code: number) => expect(invoke()).rejects.toMatchObject({ statusCode: code })

describe('contextual owner Test draft GET', () => {
  beforeEach(() => {
    source = snapshot(); finalMutate = value => value; failure = null; signals = []
    rpc = vi.fn((name: string, args: Args) => {
      const pending = Promise.resolve().then(() => {
        if (failure) return { data: null, error: failure }
        if (name === 'snapshot_test_draft_for_owner_v1') return { data: source, error: null }
        const stored = source.draft
        const result = { version: 1, actor_id: actorId, classroom_id: classroomId, test_id: testId, operation: args.p_operation,
          draft: { ...(stored ?? { ...draft(), version: 1, created_by: actorId, updated_by: actorId }),
            ...(args.p_operation === 'repair' ? { version: stored!.version + 1, updated_by: actorId, updated_at: '2026-10-04T00:00:01Z' } : {}), content: args.p_content },
          editingPolicy: { structureLocked: source.test.questions_locked_at !== null } }
        return { data: finalMutate(result), error: null }
      })
      return { abortSignal: (signal: AbortSignal) => { signals.push(signal); return pending } }
    })
  })
  afterEach(() => vi.useRealTimers())

  it('normalizes valid content without mutating row stamps and exposes only the public DTO', async () => {
    const result = await invoke()
    expect(result).toEqual({ draft: { ...source.draft, content: { ...content(), title: 'Draft', question_identity_version: 1 } }, editingPolicy: { structureLocked: false } })
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_operation: 'inspect', p_expected_source_sha256: 'a'.repeat(64), p_actor_id: actorId, p_test_id: testId, p_classroom_id: classroomId })
    expect(signals[0]).toBe(signals[1]); expect(signals[0]).toBeInstanceOf(AbortSignal)
  })
  it.each(['draft', 'active', 'closed'])('creates a missing %s draft with version one and actor stamps', async mode => {
    Object.assign(source, { draft: null }); source.test.status = mode
    const result = await invoke()
    expect(result.draft).toMatchObject({ version: 1, created_by: actorId, updated_by: actorId, content: { title: 'Persisted', show_results: true, questions: [] } })
    expect(rpc.mock.calls[1][1].p_operation).toBe('create')
  })
  it('repairs invalid draft content once, preserving creation metadata', async () => {
    Object.assign(source.draft.content, { title: '' })
    const result = await invoke()
    expect(result.draft).toMatchObject({ id: draftId, version: 8, created_by: otherId, created_at: timestamp, updated_by: actorId })
    expect(rpc.mock.calls[1][1].p_operation).toBe('repair')
  })
  it.each(['active', 'closed'])('rebuilds existing %s content without repair even when invalid and retired', async mode => {
    source.test.status = mode; Object.assign(source.test, { blueprint_archived_at: timestamp, questions_locked_at: timestamp })
    Object.assign(source.draft, { content: null })
    const result = await invoke()
    expect(result.draft).toMatchObject({ version: 7, updated_by: otherId, updated_at: timestamp, content: { title: 'Persisted' } })
    expect(result.editingPolicy.structureLocked).toBe(true); expect(rpc.mock.calls[1][1].p_operation).toBe('inspect')
  })
  it('permits retired valid-draft inspection', async () => {
    Object.assign(source.test, { blueprint_archived_at: timestamp })
    expect((await invoke()).draft.version).toBe(7)
  })
  it.each(['create', 'repair'])('denies retired %s before final RPC', async operation => {
    Object.assign(source.test, { blueprint_archived_at: timestamp })
    if (operation === 'create') Object.assign(source, { draft: null })
    else Object.assign(source.draft, { content: null })
    await status(403); expect(rpc).toHaveBeenCalledTimes(1)
  })
  it.each(['owner', 'archive'])('denies current %s loss before final RPC', async reason => {
    Object.assign(source.classroom, reason === 'owner' ? { teacher_id: otherId } : { archived_at: timestamp })
    await status(403); expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('projects legacy row IDs to portable source IDs without persistence', async () => {
    Object.assign(source, { question_count: 1, questions: [{ ...question(), source_artifact_id: otherId }] })
    Object.assign(source.draft.content, { questions: [{ ...question(), id: rowId }] })
    expect((await invoke()).draft.content.questions[0].id).toBe(otherId)
    expect(rpc.mock.calls[1][1].p_operation).toBe('inspect')
  })
  it('retains marked draft-only identity rather than resolving an internal row collision', async () => {
    Object.assign(source, { question_count: 1, questions: [question()] })
    Object.assign(source.draft.content, { questions: [{ ...question(), id: rowId }], question_identity_version: 1 })
    expect((await invoke()).draft.content.questions[0].id).toBe(rowId)
  })
  it.each(['inspect', 'create'])('rejects duplicate portable identities for %s', async operation => {
    Object.assign(source, { question_count: 2, questions: [question(), { ...question(), id: otherId, position: 1 }] })
    if (operation === 'create') Object.assign(source, { draft: null })
    else Object.assign(source.draft.content, { questions: [{ ...question(), id: portableId }], question_identity_version: 1 })
    await status(409); expect(rpc).toHaveBeenCalledTimes(1)
  })
  it.each([
    (s: Source) => Object.assign(s.draft, { classroom_id: otherId }),
    (s: Source) => Object.assign(s.test, { classroom_id: otherId }),
    (s: Source) => Object.assign(s, { actor_id: otherId }),
    (s: Source) => Object.assign(s, { source_sha256: 'bad' }),
    (s: Source) => Object.assign(s, { question_count: 1 }),
    (s: Source) => Object.assign(s, { extra: true }),
    (s: Source) => Object.assign(s, { question_count: 1, questions: [{ ...question(), test_id: otherId }] }),
    (s: Source) => Object.assign(s, { question_count: 2, questions: [{ ...question(), position: 2 }, { ...question(), id: otherId, position: 1 }] }),
  ])('rejects source substitutions and incomplete evidence %#', async mutate => {
    mutate(source); await status(503); expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('rejects invalid rebuilt baseline before create', async () => {
    Object.assign(source, { draft: null, question_count: 1, questions: [{ ...question(), points: -1 }] })
    await status(503); expect(rpc).toHaveBeenCalledTimes(1)
  })
  it.each([
    (value: Record<string, unknown>) => ({ ...value, actor_id: otherId }),
    (value: Record<string, unknown>) => ({ ...value, operation: 'repair' }),
    (value: Record<string, unknown>) => ({ ...value, editingPolicy: { structureLocked: true } }),
    (value: Record<string, unknown>) => ({ ...value, draft: { ...source.draft, version: 8 } }),
    (value: Record<string, unknown>) => ({ ...value, draft: { ...source.draft, content: {} } }),
    (value: Record<string, unknown>) => ({ ...value, draft: { ...source.draft, updated_by: actorId } }),
  ])('rejects final substitutions, stamp/version drift and policy drift %#', async mutate => {
    finalMutate = mutate; await status(503); expect(rpc).toHaveBeenCalledTimes(2)
  })
  it.each([['42501', 403], ['PT403', 403], ['PT404', 404], ['PT409', 409], ['23505', 409], ['55P03', 409], ['40P01', 409], ['40001', 409], ['PT503', 503], ['PGRST202', 503], ['42883', 503], ['XX000', 503]])('maps %s without leaking private messages', async (code, expected) => {
    failure = { code, message: 'private source row' }
    await expect(invoke()).rejects.toMatchObject({ statusCode: expected, message: expect.not.stringContaining('private') })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('rejects oversized raw draft before normalization can remove extra data', async () => {
    Object.assign(source.draft.content, { extra: 'é'.repeat(1024 * 1024) })
    await status(503); expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('rejects candidate overflow before final dispatch', async () => {
    Object.assign(source, { draft: null, question_count: 1, questions: [{ ...question(), question_text: 'é'.repeat(1024 * 1024) }] })
    await status(503); expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('bounds recursive source decoding before canonical validation', async () => {
    let nested: unknown = null
    for (let i = 0; i < 102; i++) nested = { nested }
    Object.assign(source.draft.content, { extra: nested })
    await status(503); expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('aborts an unresolved first RPC at 20 seconds and never dispatches a late final', async () => {
    vi.useFakeTimers()
    rpc.mockImplementation(() => ({ abortSignal: (signal: AbortSignal) => { signals.push(signal); return new Promise(() => {}) } }))
    const result = invoke(); const check = expect(result).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(20000); await check
    expect(signals[0].aborted).toBe(true); expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('checks elapsed time after snapshot before CPU or final dispatch', async () => {
    vi.useFakeTimers(); const original = rpc.getMockImplementation()!
    rpc.mockImplementation((name, args) => { const value = original(name, args); vi.setSystemTime(Date.now() + 20000); return value })
    await status(503); expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('uses the same absolute deadline in both RPCs', async () => {
    await invoke()
    expect(rpc.mock.calls[1][1].p_deadline).toBe(rpc.mock.calls[0][1].p_deadline)
  })
  it('rejects an oversized final envelope before decoding or exposing it', async () => {
    finalMutate = value => ({ ...value, extra: 'é'.repeat(4 * 1024 * 1024) })
    await status(503); expect(rpc).toHaveBeenCalledTimes(2)
  })
  it('rejects a circular RPC result without entering recursive schema decoding', async () => {
    Object.assign(source, { extra: source })
    await status(503); expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('rejects more than 10000 raw draft questions rather than repairing truncation', async () => {
    Object.assign(source.draft.content, { questions: Array.from({ length: 10001 }, () => null) })
    await status(503); expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('accepts a complete ordered 10000-question source when the retained draft fits the content bound', async () => {
    const rows = Array.from({ length: 10000 }, (_, position) => {
      const prefix = (position + 1).toString(16).padStart(8, '0')
      return { ...question(), id: `${prefix}-1111-4111-8111-111111111111`, artifact_id: `${prefix}-2222-4222-8222-222222222222`,
        position, question_text: '', answer_key: null }
    })
    Object.assign(source, { question_count: rows.length, questions: rows })
    const result = await invoke()
    expect(result.draft.content.questions).toHaveLength(0)
    expect(rpc.mock.calls[1][1].p_operation).toBe('inspect')
    expect(rpc).toHaveBeenCalledTimes(2)
  })
  it('maps final disappearance to conflict with no extra discovery', async () => {
    const original = rpc.getMockImplementation()!
    rpc.mockImplementation((name, args) => {
      if (name === 'finish_test_draft_get_for_owner_v1') failure = { code: 'PT404', message: 'private removed Test' }
      return original(name, args)
    })
    await status(409); expect(rpc).toHaveBeenCalledTimes(2)
  })
  it('does not retry or fall back on final current-owner denial', async () => {
    const original = rpc.getMockImplementation()!
    rpc.mockImplementation((name, args) => {
      if (name === 'finish_test_draft_get_for_owner_v1') failure = { code: 'PT403', message: 'private owner' }
      return original(name, args)
    })
    await status(403); expect(rpc).toHaveBeenCalledTimes(2)
  })
  it.each(['version', 'created_by', 'updated_by', 'created_at'])('rejects a substituted create %s', async field => {
    Object.assign(source, { draft: null })
    finalMutate = value => ({ ...value, draft: { ...(value.draft as Record<string, unknown>),
      [field]: field === 'version' ? 2 : field === 'created_at' ? '2026-10-04T00:00:01Z' : otherId } })
    await status(503); expect(rpc).toHaveBeenCalledTimes(2)
  })
  it.each(['version', 'created_by', 'created_at', 'updated_by'])('rejects a substituted repair %s', async field => {
    Object.assign(source.draft, { content: null })
    finalMutate = value => ({ ...value, draft: { ...(value.draft as Record<string, unknown>),
      [field]: field === 'version' ? 9 : field === 'created_at' ? '2026-10-04T00:00:01Z' : field === 'updated_by' ? otherId : actorId } })
    await status(503); expect(rpc).toHaveBeenCalledTimes(2)
  })
  it('rejects a safe-integer overflow repair before final dispatch', async () => {
    Object.assign(source.draft, { content: null, version: Number.MAX_SAFE_INTEGER })
    await status(503); expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('rejects invalid identity before discovery', async () => {
    await expect(getContextualTestDraft({ supabase: { rpc } as unknown as ReturnType<typeof getServiceRoleClient>, actorId: 'invalid', testId }))
      .rejects.toMatchObject({ statusCode: 400 })
    expect(rpc).not.toHaveBeenCalled()
  })
})
