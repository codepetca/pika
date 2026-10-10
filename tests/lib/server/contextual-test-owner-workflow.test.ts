import { createClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/types/database'
import { createContextualTestOwnerWorkflow } from '@/lib/server/contextual-test-owner-workflow'
import { contextualTestOwnerMetadataSchema, contextualTestOwnerStudentAccessSchema } from '@/lib/validations/contextual-test-owner-workflow'

const actor = '11111111-1111-4111-8111-111111111111'
const classroom = '22222222-2222-4222-8222-222222222222'
const testId = '33333333-3333-4333-8333-333333333333'
const learner = '44444444-4444-4444-8444-444444444444'
const stamp = '2026-10-09T12:00:00Z'
const test = { id: testId, classroom_id: classroom, title: 'Test', status: 'closed', show_results: false, documents: [],
  position: 0, points_possible: 100, include_in_final: true, created_by: learner, created_at: stamp, updated_at: stamp,
  artifact_id: learner, source_artifact_id: null, source_blueprint_version_id: null, blueprint_archived_at: null,
  gradebook_category_id: null, gradebook_maximum_override: null, gradebook_score_scale: 1, gradebook_weight: 10, questions_locked_at: null }
let reply: unknown
let error: { code: string; message: string } | null
let network: ReturnType<typeof vi.fn<typeof fetch>>

function workflow() {
  return createContextualTestOwnerWorkflow({ actorId: actor, testId,
    supabase: createClient<Database>('https://example.test', 'offline-key', { global: { fetch: network }, auth: { persistSession: false, autoRefreshToken: false } }) })
}
const witness = (operation = 'inspect', result: unknown = null) => ({ version: 1, actor_id: actor, classroom_id: classroom, test_id: testId, operation, test, result })

describe('contextual owner Test workflow transaction boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(stamp); error = null; reply = witness()
    network = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(error ?? reply), { status: error ? 400 : 200, headers: { 'Content-Type': 'application/json' } }))
  })
  afterEach(() => vi.useRealTimers())
  it('binds the admitted actor and discovered Class to every subsequent transaction', async () => {
    const flow = workflow(); expect(await flow.inspect()).toEqual(test)
    reply = witness('update', null); await flow.run('update', { title: 'Renamed' })
    expect(network).toHaveBeenCalledTimes(2)
    const args = JSON.parse(String(network.mock.calls[1][1]?.body))
    expect(args).toMatchObject({ p_actor_id: actor, p_test_id: testId, p_classroom_id: classroom, p_operation: 'update', p_payload: { title: 'Renamed' }, p_expected_test: test })
    expect(String(network.mock.calls[1][0])).toContain('/rpc/test_owner_workflow_v1')
  })
  it('keeps the first discovered Test as the CAS source across snapshot phases', async () => {
    const flow = workflow(); await flow.inspect()
    reply = { ...witness('reserve'), test: { ...test, title: 'Concurrent edit' } }
    await flow.run('reserve', {})
    reply = witness('sync'); await flow.run('sync', {})
    expect(JSON.parse(String(network.mock.calls[2][1]?.body)).p_expected_test).toEqual(test)
  })
  it.each(['actor_id', 'classroom_id', 'test_id', 'operation', 'version'] as const)('rejects forged %s acknowledgements', async key => {
    reply = { ...witness(), [key]: key === 'version' ? 2 : learner }
    await expect(workflow().inspect()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects a reparented nested Test and unknown returned fields', async () => {
    reply = { ...witness(), test: { ...test, classroom_id: learner } }
    await expect(workflow().inspect()).rejects.toMatchObject({ statusCode: 503 })
    reply = { ...witness(), secret: 'unexpected' }
    await expect(workflow().inspect()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([['PT400', 400], ['PT403', 403], ['PT404', 404], ['PT409', 409], ['42501', 503], ['40001', 503], ['PGRST202', 503]])('maps %s without private database details', async (code, status) => {
    error = { code: String(code), message: 'private diagnostic' }
    await expect(workflow().inspect()).rejects.toMatchObject({ statusCode: status })
    await expect(workflow().inspect()).rejects.not.toThrow('private diagnostic')
  })
  it('does not retry an ambiguous or failed acknowledgement', async () => {
    reply = null; await expect(workflow().inspect()).rejects.toMatchObject({ statusCode: 503 }); expect(network).toHaveBeenCalledTimes(1)
  })
  it('uses one deadline and aborts a hung installed-SDK request', async () => {
    network.mockImplementation(() => new Promise(() => {}))
    const pending = expect(workflow().inspect()).rejects.toMatchObject({ statusCode: 503 }); await vi.advanceTimersByTimeAsync(30000)
    await pending; expect(vi.getTimerCount()).toBe(0)
  })
  it('does not mutate before authoritative discovery', async () => {
    await expect(workflow().run('update', { title: 'Renamed' })).rejects.toMatchObject({ statusCode: 503 })
    expect(network).not.toHaveBeenCalled()
  })
  it('keeps draft publication and question authoring outside metadata transport', () => {
    expect(contextualTestOwnerMetadataSchema.safeParse({ status: 'closed', draft_version: 1 }).success).toBe(false)
    expect(contextualTestOwnerMetadataSchema.safeParse({ questions: [] }).success).toBe(false)
    expect(contextualTestOwnerMetadataSchema.safeParse({}).success).toBe(false)
    expect(contextualTestOwnerMetadataSchema.parse({ title: '  Renamed  ', show_results: false })).toEqual({ title: 'Renamed', show_results: false })
  })
  it('preserves max100 selection and deduplicates only after bounding input', () => {
    expect(contextualTestOwnerStudentAccessSchema.parse({ state: 'open', student_ids: [learner, learner] })).toEqual({ state: 'open', student_ids: [learner] })
    expect(contextualTestOwnerStudentAccessSchema.safeParse({ state: 'open', student_ids: Array(101).fill(learner) }).success).toBe(false)
  })
})
