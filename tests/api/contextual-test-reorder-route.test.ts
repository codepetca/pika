import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/tests/reorder/atomic/route'
import { requireAuth, requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { reorderContextualTests } from '@/lib/server/contextual-test-reorder'
import { ApiError } from '@/lib/api-error'
import { contextualTestReorderRequestSchema } from '@/lib/validations/contextual-test-reorder'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/contextual-test-reorder', () => ({ reorderContextualTests: vi.fn() }))
const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = '22222222-2222-4222-8222-222222222222'
const testId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'
const body = { classroom_id: classroomId, test_ids: [testId.toLowerCase()] }
const request = (value: unknown = body) => new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify(value) })
const invoke = (req = request()) => POST(req, { params: Promise.resolve({}) })
const admitted = () => vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))

describe('dormant atomic Test-list reorder route', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.unstubAllEnvs(); delete process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION
    vi.useFakeTimers(); vi.setSystemTime('2026-10-07T12:00:00Z')
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'student', email: 'owner@example.test' })
    vi.mocked(reorderContextualTests).mockResolvedValue({ success: true })
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [] })])('returns404 before body/client for disabled or unmatched admission %#', async config => {
    if (config !== undefined) vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    const req = request(); const reader = vi.spyOn(req.body!, 'getReader')
    const response = await invoke(req)
    expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: 'Test reorder unavailable' })
    expect(reader).not.toHaveBeenCalled(); expect(getServiceRoleClient).not.toHaveBeenCalled(); expect(reorderContextualTests).not.toHaveBeenCalled()
    expect(requireRole).not.toHaveBeenCalled(); expect(requireAuth).toHaveBeenCalledTimes(config === undefined ? 0 : 1)
  })
  it.each(['teacher', 'student'] as const)('passes admitted %s identity to SQL ownership authorization', async role => {
    admitted(); vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role, email: 'owner@example.test' })
    const req = request({ ...body, test_ids: [testId] }); const response = await invoke(req)
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ success: true })
    expect(reorderContextualTests).toHaveBeenCalledWith({ supabase: undefined, actorId, input: body,
      deadline: Date.now() + 20000, bodyBytes: Buffer.byteLength(JSON.stringify({ ...body, test_ids: [testId] })), signal: req.signal })
    expect(requireRole).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
  it('authenticates before body/client', async () => {
    admitted(); vi.mocked(requireAuth).mockRejectedValue(Object.assign(new Error('Authentication required'), { name: 'AuthenticationError' }))
    const req = request(); const reader = vi.spyOn(req.body!, 'getReader')
    expect((await invoke(req)).status).toBe(401); expect(reader).not.toHaveBeenCalled(); expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
  it('rejects malformed admission before body/client', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{}'); const req = request(); const reader = vi.spyOn(req.body!, 'getReader')
    expect((await invoke(req)).status).toBe(503); expect(reader).not.toHaveBeenCalled(); expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
  it.each(['actor_id', 'positions', 'count', 'changed_count', 'deadline', 'version'])('rejects forged %s before client/helper', async key => {
    admitted(); expect((await invoke(request({ ...body, [key]: 1 }))).status).toBe(400)
    expect(getServiceRoleClient).not.toHaveBeenCalled(); expect(reorderContextualTests).not.toHaveBeenCalled()
  })
  it.each([{}, { ...body, classroom_id: 'bad' }, { ...body, test_ids: [testId, testId.toLowerCase()] }, { ...body, test_ids: null }])('rejects malformed request %#', async value => {
    admitted(); expect((await invoke(request(value))).status).toBe(400); expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
  it('rejects escaped duplicate keys before helper', async () => {
    admitted(); const req = new NextRequest('http://localhost', { method: 'POST', body: `{"classroom_id":"${classroomId}","test_ids":[],"test_\\u0069ds":[]}` })
    expect((await invoke(req)).status).toBe(400); expect(reorderContextualTests).not.toHaveBeenCalled()
  })
  it('carries original deadline across delayed body material', async () => {
    admitted(); const payload = new TextEncoder().encode(JSON.stringify(body))
    const req = new NextRequest('http://localhost', { method: 'POST', body: new ReadableStream<Uint8Array>({ start(c) { setTimeout(() => { c.enqueue(payload); c.close() }, 1000) } }), duplex: 'half' })
    const pending = invoke(req); await vi.advanceTimersByTimeAsync(1000)
    expect((await pending).status).toBe(200); expect(vi.mocked(reorderContextualTests).mock.calls[0][0].deadline).toBe(Date.parse('2026-10-07T12:00:20Z'))
  })
  it('fails closed if the body budget expires during schema validation, before constructing a client', async () => {
    admitted(); const parse = contextualTestReorderRequestSchema.parse.bind(contextualTestReorderRequestSchema)
    const spy = vi.spyOn(contextualTestReorderRequestSchema, 'parse').mockImplementation(value => {
      const result = parse(value); vi.setSystemTime('2026-10-07T12:00:20Z'); return result
    })
    try {
      expect((await invoke()).status).toBe(503)
      expect(getServiceRoleClient).not.toHaveBeenCalled(); expect(reorderContextualTests).not.toHaveBeenCalled()
    } finally { spy.mockRestore() }
  })
  it('bounds stalled body without constructing a database client', async () => {
    admitted(); const cancel = vi.fn(() => new Promise<void>(() => {}))
    const req = new NextRequest('http://localhost', { method: 'POST', body: new ReadableStream<Uint8Array>({ cancel }), duplex: 'half' })
    const pending = invoke(req); await vi.advanceTimersByTimeAsync(20000)
    expect((await pending).status).toBe(503); expect(getServiceRoleClient).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
  })
  it('honors caller abort while reading without constructing a client', async () => {
    admitted(); const controller = new AbortController(); const cancel = vi.fn()
    const req = new NextRequest('http://localhost', { method: 'POST', body: new ReadableStream<Uint8Array>({ cancel }), duplex: 'half', signal: controller.signal })
    const pending = invoke(req); await vi.advanceTimersByTimeAsync(0); controller.abort()
    expect((await pending).status).toBe(503); expect(getServiceRoleClient).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects a previously consumed request before constructing a client', async () => {
    admitted(); const req = request(); await req.text()
    expect((await invoke(req)).status).toBe(400); expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
  it('discloses only legacy success even if helper mock returns a wider acknowledgement', async () => {
    admitted(); const result = { success: true as const, actor_id: actorId, test_ids: body.test_ids }
    vi.mocked(reorderContextualTests).mockResolvedValue(result)
    expect(await (await invoke()).json()).toEqual({ success: true })
  })
  it.each([400, 403, 404, 409, 503])('preserves mapped helper error %i', async status => {
    admitted(); vi.mocked(reorderContextualTests).mockRejectedValue(new ApiError(status, 'Fixed failure'))
    const response = await invoke(); expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: 'Fixed failure' })
  })
  it('returns503 for unexpected helper/client failure without leaking detail', async () => {
    admitted(); vi.mocked(reorderContextualTests).mockRejectedValue(new Error('private transport failure'))
    const response = await invoke(); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'Unable to verify test reorder' })
  })
})
