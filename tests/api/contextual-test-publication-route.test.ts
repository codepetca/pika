import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { POST } from '@/app/api/teacher/tests/[id]/publish/route'
import { requireAuth, requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { publishContextualTest } from '@/lib/server/contextual-test-publication'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/contextual-test-publication', () => ({ publishContextualTest: vi.fn() }))
const actorId = '11111111-1111-4111-8111-111111111111'
const testId = '33333333-3333-4333-8333-333333333333'
const body = { status: 'closed', draft_version: 7 }
const request = (value: unknown = body) => new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify(value) })
const invoke = (req = request(), id = testId) => POST(req, { params: Promise.resolve({ id }) })
const admitted = () => vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))

describe('prepared owner publication route', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.unstubAllEnvs(); delete process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION
    vi.useFakeTimers(); vi.setSystemTime('2026-10-06T12:05:00Z')
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'student', email: 'owner@example.test' })
    vi.mocked(publishContextualTest).mockResolvedValue({ test: { status: 'closed' } } as Awaited<ReturnType<typeof publishContextualTest>>)
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [] })])('returns404 without body/params/database on disabled or unmatched admission %#', async config => {
    if (config !== undefined) vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    const req = request(); const reader = vi.spyOn(req.body!, 'getReader'); const params = vi.fn(() => Promise.resolve({ id: testId }))
    const response = await POST(req, { get params() { return params() } })
    expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: 'Test publication unavailable' })
    expect(params).not.toHaveBeenCalled(); expect(reader).not.toHaveBeenCalled(); expect(getServiceRoleClient).not.toHaveBeenCalled()
    expect(publishContextualTest).not.toHaveBeenCalled(); expect(requireRole).not.toHaveBeenCalled()
    expect(requireAuth).toHaveBeenCalledTimes(config === undefined ? 0 : 1)
  })
  it.each(['student', 'teacher'] as const)('allows admitted %s actor only into the owner RPC helper', async role => {
    admitted(); vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role, email: 'owner@example.test' })
    const req = request(); const response = await invoke(req)
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ test: { status: 'closed' } })
    expect(publishContextualTest).toHaveBeenCalledWith({ supabase: undefined, actorId, testId, input: body, deadline: Date.now() + 20000,
      bodyBytes: Buffer.byteLength(JSON.stringify(body)), signal: req.signal })
    expect(requireRole).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
  it('authenticates before reading params/body', async () => {
    admitted(); vi.mocked(requireAuth).mockRejectedValue(Object.assign(new Error('Authentication required'), { name: 'AuthenticationError' }))
    const req = request(); const reader = vi.spyOn(req.body!, 'getReader'); const params = vi.fn(() => Promise.resolve({ id: testId }))
    expect((await POST(req, { get params() { return params() } })).status).toBe(401)
    expect(params).not.toHaveBeenCalled(); expect(reader).not.toHaveBeenCalled(); expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
  it('rejects malformed admission before body or client', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{}'); const req = request(); const reader = vi.spyOn(req.body!, 'getReader')
    expect((await invoke(req)).status).toBe(503); expect(reader).not.toHaveBeenCalled(); expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
  it.each(['title', 'documents', 'show_results', 'actor_id', 'classroom_id', 'source_sha256', 'deadline'])('rejects unknown %s without helper/client', async key => {
    admitted(); expect((await invoke(request({ ...body, [key]: 'forged' }))).status).toBe(400)
    expect(publishContextualTest).not.toHaveBeenCalled(); expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
  it.each([{}, { status: 'active', draft_version: 7 }, { ...body, draft_version: '7' }, { ...body, draft_version: 2147483648 }])('rejects invalid request %#', async value => {
    admitted(); expect((await invoke(request(value))).status).toBe(400); expect(publishContextualTest).not.toHaveBeenCalled()
  })
  it('rejects escaped duplicate keys without helper', async () => {
    admitted(); const req = new NextRequest('http://localhost', { method: 'POST', body: '{"status":"closed","draft_version":7,"st\\u0061tus":"active"}' })
    expect((await invoke(req)).status).toBe(400); expect(publishContextualTest).not.toHaveBeenCalled()
  })
  it('validates path before body', async () => {
    admitted(); const req = request(); const reader = vi.spyOn(req.body!, 'getReader')
    expect((await invoke(req, 'bad')).status).toBe(400); expect(reader).not.toHaveBeenCalled(); expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
  it('bounds unresolved params under the one deadline with no body/database', async () => {
    admitted(); const req = request(); const reader = vi.spyOn(req.body!, 'getReader')
    const pending = POST(req, { params: new Promise(() => {}) }); await vi.advanceTimersByTimeAsync(20000)
    expect((await pending).status).toBe(503); expect(reader).not.toHaveBeenCalled(); expect(getServiceRoleClient).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
  it('cancels pending params on caller abort without database', async () => {
    admitted(); const controller = new AbortController(); const req = new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify(body), signal: controller.signal })
    const pending = POST(req, { params: new Promise(() => {}) }); await vi.advanceTimersByTimeAsync(0); controller.abort()
    expect((await pending).status).toBe(503); expect(getServiceRoleClient).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
  it('fails closed on rejected params without body/database or diagnostic detail', async () => {
    admitted(); const req = request(); const reader = vi.spyOn(req.body!, 'getReader')
    const response = await POST(req, { params: Promise.reject(new Error('synthetic parameter failure')) })
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'Unable to verify test publication' })
    expect(reader).not.toHaveBeenCalled(); expect(getServiceRoleClient).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
  it('carries original deadline across delayed params and body', async () => {
    admitted(); const payload = new TextEncoder().encode(JSON.stringify(body))
    const req = new NextRequest('http://localhost', { method: 'POST', body: new ReadableStream<Uint8Array>({ start(c) { setTimeout(() => { c.enqueue(payload); c.close() }, 1000) } }), duplex: 'half' })
    const pending = POST(req, { params: new Promise(resolve => setTimeout(() => resolve({ id: testId }), 750)) })
    await vi.advanceTimersByTimeAsync(1000); expect((await pending).status).toBe(200)
    expect(vi.mocked(publishContextualTest).mock.calls[0][0].deadline).toBe(Date.parse('2026-10-06T12:05:20Z'))
  })
  it.each([
    ['src/app/api/teacher/tests/[id]/route.ts', 'd9947ed07251b95be672c0947f21d0b625cca695798a151ae3155940f761700e'],
    ['src/app/classrooms/[classroomId]/TeacherTestsTab.tsx', '559bff94dfbf89566ebeea061e779c46e661b7e4d50d7f1ea802da1e0587dc61'],
  ])('retains reviewed legacy source bytes: %s', (path, hash) => {
    // PATCH remains the attested parent865d source. PR1540 reviewed the
    // grading-only delta at ae458ec36. PR1552 independently reviewed the
    // list edit-mode/keyboard delta at c063f9c20; its hash supersedes 1d334a7a.
    // Publication requests, draft persistence and student-access paths remain
    // unchanged. Keep the exact full-file byte guard; this never executes Git.
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(hash)
  })
})
