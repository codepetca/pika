import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createContextualTestLearnerWorkflow } from '@/lib/server/contextual-test-learner-workflow'
import { testLearnerQuestionSchema, parseTestLearnerPayload, testLearnerResultSchemas, testLearnerPayloadSchemas } from '@/lib/validations/contextual-test-learner-workflow'

const actor = '11111111-1111-4111-8111-111111111111', classroom = '22222222-2222-4222-8222-222222222222'
const testId = '33333333-3333-4333-8333-333333333333', attemptId = '44444444-4444-4444-8444-444444444444'
const stamp = '2026-10-10T12:00:00Z'
const attempt = { id: attemptId, test_id: testId, student_id: actor, responses: {}, is_submitted: false, submitted_at: null,
  created_at: stamp, updated_at: stamp, draft_revision: 11 }
const rpc = vi.fn()
let reply: unknown
const witness = (operation = 'inspect', result: unknown = { access_mode: 'member' }) => ({ version: 1, actor_id: actor,
  classroom_id: classroom, test_id: testId, subject_id: actor, operation, result })
const flow = () => createContextualTestLearnerWorkflow({ actorId: actor, testId, supabase: { rpc } })
describe('contextual learner Test narrow transport', () => {
  beforeEach(() => { vi.clearAllMocks(); reply = witness(); rpc.mockImplementation(() => ({ abortSignal: () => Promise.resolve({ data: reply, error: null }) })) })
  afterEach(() => vi.useRealTimers())
  it('captures fixed parent once and sends the authoritative actor and expected revision', async () => {
    const f = flow(); await f.inspect(); reply = witness('save', { conflict: true, attempt })
    expect(await f.run('save', { expected_revision: 10, responses: {} })).toEqual({ conflict: true, attempt })
    expect(rpc).toHaveBeenLastCalledWith('test_learner_workflow_v1', expect.objectContaining({ p_actor_id: actor, p_test_id: testId,
      p_classroom_id: classroom, p_operation: 'save', p_payload: { expected_revision: 10, responses: {} } }))
  })
  it.each(['actor_id','classroom_id','test_id','subject_id','operation','version'])('rejects a forged %s acknowledgement', async key => {
    const f = flow(); await f.inspect(); reply = { ...witness('recover', { attempt }), [key]: key === 'version' ? 2 : attemptId }
    await expect(f.run('recover')).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each(['test_id','student_id'])('rejects forged nested attempt %s', async key => {
    const f = flow(); await f.inspect(); reply = witness('recover', { attempt: { ...attempt, [key]: attemptId } })
    await expect(f.run('recover')).rejects.toMatchObject({ statusCode: 503 })
  })
  it('does not disclose unexpected returned/AI fields in a conflict or recovery row', () => {
    expect(testLearnerResultSchemas.recover.safeParse({ attempt: { ...attempt, ai_reference_answers: 'private' } }).success).toBe(false)
    expect(testLearnerResultSchemas.save.safeParse({ conflict: true, attempt: { ...attempt, score: 10 } }).success).toBe(false)
  })
  it('requires discovery before mutations and never retries ambiguous replies', async () => {
    const f = flow(); await expect(f.run('save', {})).rejects.toMatchObject({ statusCode: 503 }); expect(rpc).not.toHaveBeenCalled()
    reply = null; await expect(f.inspect()).rejects.toMatchObject({ statusCode: 503 }); expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('maps only approved errors without returning private details', async () => {
    rpc.mockImplementation(() => ({ abortSignal: () => Promise.resolve({ data: null, error: { code: 'PT403', message: 'private' } }) }))
    await expect(flow().inspect()).rejects.toMatchObject({ statusCode: 403, message: 'Forbidden' })
    rpc.mockImplementation(() => ({ abortSignal: () => Promise.resolve({ data: null, error: { code: '42501', message: 'private' } }) }))
    await expect(flow().inspect()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('bounds a hung transport and clears timers', async () => {
    vi.useFakeTimers(); rpc.mockImplementation(() => ({ abortSignal: () => new Promise(() => {}) }))
    const pending = expect(flow().inspect()).rejects.toMatchObject({ statusCode: 503 }); await vi.advanceTimersByTimeAsync(30000); await pending
    expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects answer keys in pre-return questions and enforces finite request metrics', () => {
    expect(testLearnerQuestionSchema.safeParse({ id: actor, test_id: testId, question_type: 'multiple_choice', question_text: 'Q',
      options: ['a','b'], points: 1, response_max_chars: 5000, response_monospace: false, position: 0, created_at: stamp, updated_at: stamp,
      correct_option: 0 }).success).toBe(false)
    expect(() => parseTestLearnerPayload('save', { responses: {}, expected_revision: 1, paste_word_count: Infinity })).toThrow()
  })
  it('rejects a grades/results acknowledgement without current returned disclosure authority', async () => {
    const f = flow(); await f.inspect(); reply = witness('results', { state: { test: { id: testId, classroom_id: classroom, title: 'T', status: 'active',
      show_results: true, documents: [], position: 0, created_at: stamp, updated_at: stamp }, attempt: { id: attemptId, is_submitted: true,
      returned_at: null, closed_for_grading_at: null, draft_revision: 11 }, access_state: 'closed', has_submitted: true },
    results: [], my_responses: {}, question_results: [], summary: { earned_points: 5, possible_points: 5, percent: 100 } })
    await expect(f.run('results')).rejects.toMatchObject({ statusCode: 503 })
  })
  it('explicitly fails an over-budget reply instead of materializing or truncating it', async () => {
    const f = flow(); await f.inspect(); reply = witness('recover', { attempt: { ...attempt, responses: { oversized: 'x'.repeat(8*1024*1024) } } })
    await expect(f.run('recover')).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects unknown operation arguments before protected transport', async () => {
    const f = flow(); await f.inspect(); await expect(f.run('document', { document_id: actor, source: 'upload', storage_path: 'not-authorized' })).rejects.toMatchObject({ statusCode: 503 })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('fails10001-item responses explicitly and rejects over-budget focus metadata at request parsing', () => {
    expect(testLearnerPayloadSchemas.save.safeParse({ expected_revision: 1, responses: Object.fromEntries(Array.from({ length: 10001 },(_,index) => [String(index),1])) }).success).toBe(false)
    expect(() => parseTestLearnerPayload('focus', { session_id: 's', event_type: 'away_start', metadata: { note: 'x'.repeat(32768) } })).toThrow()
  })
})
