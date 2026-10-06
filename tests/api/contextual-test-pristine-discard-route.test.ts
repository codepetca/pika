import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import type { Database } from '@/types/database'
import { POST } from '@/app/api/teacher/tests/[id]/discard-pristine/route'
import { requireAuth, requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { discardPristineTestDraftAtomic } from '@/lib/server/pristine-draft-discard'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = '22222222-2222-4222-8222-222222222222'
const testId = '33333333-3333-4333-8333-333333333333'
const stamp = '2026-10-06T03:25:00Z'
const test = { id: testId, classroom_id: classroomId, title: 'Untitled 2026-10-05 23:25:00', status: 'draft', show_results: false, position: 0, points_possible: 100, include_in_final: true,
  created_by: actorId, created_at: stamp, updated_at: stamp, documents: [], artifact_id: '55555555-5555-4555-8555-555555555555', source_artifact_id: null,
  source_blueprint_version_id: null, blueprint_archived_at: null, questions_locked_at: null, gradebook_category_id: null, gradebook_weight: 10, gradebook_maximum_override: null, gradebook_score_scale: 1 }
const draft = { id: '44444444-4444-4444-8444-444444444444', assessment_type: 'test', assessment_id: testId, classroom_id: classroomId,
  content: { title: test.title, show_results: false, question_identity_version: 1, questions: [], source_format: 'markdown' }, version: 7, created_by: actorId, updated_by: actorId, created_at: stamp, updated_at: stamp }
const witness = () => ({ version: 1, actor_id: actorId, test_id: testId, classroom: { id: classroomId, teacher_id: actorId, archived_at: null }, test, draft, discarded: true })
const body = () => ({ expected_draft_version: 7, expected_test_updated_at: stamp })
let result: unknown; let httpStatus: number; let network: ReturnType<typeof vi.fn<typeof fetch>>
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/pristine-draft-discard', () => ({ discardPristineTestDraftAtomic: vi.fn() }))
const admitted = () => vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
const request = (value: unknown = body()) => new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify(value) })
const invoke = (req = request(), id = testId) => POST(req, { params: Promise.resolve({ id }) })

describe('admitted pristine Test discard dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.unstubAllEnvs(); delete process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION
    vi.useFakeTimers(); vi.setSystemTime('2026-10-06T03:26:00Z'); result = witness(); httpStatus = 200
    network = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(result), { status: httpStatus, headers: { 'Content-Type': 'application/json' } }))
    vi.mocked(getServiceRoleClient).mockReturnValue(createClient<Database>('https://example.test', 'offline-key', { global: { fetch: network }, auth: { persistSession: false, autoRefreshToken: false } }))
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'student', email: 'owner@example.test' })
    vi.mocked(requireRole).mockResolvedValue({ id: actorId, role: 'teacher', email: 'owner@example.test' })
    vi.mocked(discardPristineTestDraftAtomic).mockResolvedValue({ discarded: true })
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [] })])('keeps legacy branch for unconfigured/unmatched admission %#', async config => {
    if (config !== undefined) vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    expect((await invoke()).status).toBe(200); expect(discardPristineTestDraftAtomic).toHaveBeenCalledWith({ testId, teacherId: actorId, expectedDraftVersion: 7, expectedTestUpdatedAt: stamp })
    expect(requireRole).toHaveBeenCalledWith('teacher'); expect(network).not.toHaveBeenCalled(); expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
  it('retains unmatched student legacy role denial', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
    vi.mocked(requireRole).mockRejectedValue(Object.assign(new Error('Forbidden'), { name: 'AuthorizationError' }))
    expect((await invoke()).status).toBe(403); expect(discardPristineTestDraftAtomic).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled()
  })
  it('retains the legacy false row response without adding metadata', async () => {
    vi.mocked(discardPristineTestDraftAtomic).mockResolvedValue({ discarded: false, test: { ...test, status: 'closed' } })
    const response = await invoke(); expect(await response.json()).toEqual({ discarded: false, test: { ...test, status: 'closed' } }); expect(network).not.toHaveBeenCalled()
  })
  it.each(['teacher', 'student'] as const)('admits historical %s role without treating it as owner authority', async role => {
    admitted(); vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role, email: 'owner@example.test' })
    const response = await invoke(); expect(response.status).toBe(200); expect(await response.json()).toEqual({ discarded: true })
    expect(requireRole).not.toHaveBeenCalled(); expect(discardPristineTestDraftAtomic).not.toHaveBeenCalled(); expect(network).toHaveBeenCalledTimes(1)
  })
  it('rejects malformed config before params/body and privileged client access', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{}'); const req = request(); const reader = vi.spyOn(req.body!, 'getReader'); const params = vi.fn(() => Promise.resolve({ id: testId }))
    expect((await POST(req, { get params() { return params() } })).status).toBe(503)
    expect(requireAuth).toHaveBeenCalledTimes(1); expect(params).not.toHaveBeenCalled(); expect(reader).not.toHaveBeenCalled(); expect(getServiceRoleClient).not.toHaveBeenCalled(); expect(requireRole).not.toHaveBeenCalled()
  })
  it('authenticates before body access, including auth failure', async () => {
    admitted(); vi.mocked(requireAuth).mockRejectedValue(Object.assign(new Error('Authentication required'), { name: 'AuthenticationError' }))
    const req = request(); const reader = vi.spyOn(req.body!, 'getReader'); expect((await invoke(req)).status).toBe(401); expect(reader).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled()
  })
  it.each(['actor_id', 'test_id', 'deadline', 'plan', 'discarded', 'draft', 'classroom_id'])('rejects forged field %s without RPC', async key => {
    admitted(); expect((await invoke(request({ ...body(), [key]: 'forged' }))).status).toBe(400); expect(network).not.toHaveBeenCalled(); expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
  it.each([{}, { ...body(), expected_draft_version: 2147483648 }, { ...body(), expected_draft_version: '7' }, { ...body(), expected_test_updated_at: 'bad' }])('rejects malformed body %#', async value => {
    admitted(); expect((await invoke(request(value))).status).toBe(400); expect(network).not.toHaveBeenCalled()
  })
  it('rejects malformed JSON after authentication', async () => {
    admitted(); expect((await invoke(new NextRequest('http://localhost', { method: 'POST', body: '{' }))).status).toBe(400); expect(requireAuth).toHaveBeenCalledTimes(1); expect(network).not.toHaveBeenCalled()
  })
  it('rejects malformed path before body reading', async () => {
    admitted(); const req = request(); const reader = vi.spyOn(req.body!, 'getReader'); expect((await invoke(req, 'bad')).status).toBe(400); expect(reader).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled()
  })
  it('rejects overlarge raw body before persistence even when JSON would parse', async () => {
    admitted(); const raw = JSON.stringify(body()).padEnd(16385, ' '); const response = await invoke(new NextRequest('http://localhost', { method: 'POST', body: raw }))
    expect(response.status).toBe(400); expect(network).not.toHaveBeenCalled(); expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
  it('rejects invalid UTF8 after authentication without persistence', async () => {
    admitted(); expect((await invoke(new NextRequest('http://localhost', { method: 'POST', body: new Uint8Array([255]) }))).status).toBe(400); expect(network).not.toHaveBeenCalled()
  })
  it('returns existing full Test only on a changed/missing draft', async () => {
    admitted(); result = { ...witness(), discarded: false, reason: 'draft_changed', draft: null }
    const response = await invoke(); expect(await response.json()).toEqual({ discarded: false, test })
  })
  it.each(['member', 'former owner', 'archived', 'unrelated owner'])('honors closed SQL denial for %s without role fallback', async () => {
    admitted(); httpStatus = 403; result = { code: 'PT403', message: 'private SQL state' }
    const response = await invoke(); expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: 'Forbidden' }); expect(network).toHaveBeenCalledTimes(1); expect(requireRole).not.toHaveBeenCalled()
  })
  it.each(['42501', '55000', 'PGRST202'])('returns safe503 for unclassified %s, never falls back', async code => {
    admitted(); httpStatus = 403; result = { code, message: 'private SQL state' }
    const response = await invoke(); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'Unable to verify pristine test discard' }); expect(network).toHaveBeenCalledTimes(1); expect(discardPristineTestDraftAtomic).not.toHaveBeenCalled()
  })
  it('carries a single deadline through delayed body decoding', async () => {
    admitted(); const payload = new TextEncoder().encode(JSON.stringify(body())); const stream = new ReadableStream<Uint8Array>({ start(controller) { setTimeout(() => { controller.enqueue(payload); controller.close() }, 750) } })
    const init = { method: 'POST', body: stream, duplex: 'half' }; const pending = invoke(new NextRequest('http://localhost', init))
    await vi.advanceTimersByTimeAsync(750); expect((await pending).status).toBe(200)
    expect(JSON.parse(String(network.mock.calls[0][1]?.body)).p_deadline).toBe('2026-10-06T03:26:20.000Z'); expect(vi.getTimerCount()).toBe(0)
  })
  it('does not renew the budget when delayed body is followed by stalled RPC', async () => {
    admitted(); network.mockImplementation(() => new Promise(() => {})); const payload = new TextEncoder().encode(JSON.stringify(body()))
    const stream = new ReadableStream<Uint8Array>({ start(controller) { setTimeout(() => { controller.enqueue(payload); controller.close() }, 19900) } })
    const init = { method: 'POST', body: stream, duplex: 'half' }; const pending = invoke(new NextRequest('http://localhost', init))
    await vi.advanceTimersByTimeAsync(19900); expect(network).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100); expect((await pending).status).toBe(503); expect(network.mock.calls[0][1]?.signal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0)
  })
  it('physically cancels stalled HTTP body at20s before any client/RPC', async () => {
    admitted(); const cancel = vi.fn(); const init = { method: 'POST', body: new ReadableStream<Uint8Array>({ cancel }), duplex: 'half' }
    const req = new NextRequest('http://localhost', init); const pending = invoke(req)
    await vi.advanceTimersByTimeAsync(20000); expect((await pending).status).toBe(503); expect(cancel).toHaveBeenCalledTimes(1)
    expect(req.body?.locked).toBe(false); expect(network).not.toHaveBeenCalled(); expect(getServiceRoleClient).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
})
