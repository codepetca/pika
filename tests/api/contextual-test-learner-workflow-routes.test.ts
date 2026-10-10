import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAuth, requireRole } from '@/lib/auth'
import { GET as detail } from '@/app/api/student/tests/[id]/route'
import { POST as start } from '@/app/api/student/tests/[id]/start/route'
import { GET as recover, PATCH as save } from '@/app/api/student/tests/[id]/attempt/route'
import { POST as submit } from '@/app/api/student/tests/[id]/respond/route'
import { GET as session } from '@/app/api/student/tests/[id]/session-status/route'
import { GET as history } from '@/app/api/student/tests/[id]/history/route'
import { POST as focus } from '@/app/api/student/tests/[id]/focus-events/route'
import { GET as results } from '@/app/api/student/tests/[id]/results/route'
import { GET as file } from '@/app/api/student/tests/[id]/documents/[docId]/file/route'
import { GET as snapshot } from '@/app/api/student/tests/[id]/documents/[docId]/snapshot/route'

const actor = '11111111-1111-4111-8111-111111111111'
const testId = '33333333-3333-4333-8333-333333333333'
const classroomId = '22222222-2222-4222-8222-222222222222'
const documentId = '44444444-4444-4444-8444-444444444444'
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }))
const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => ({ rpc })) }))
const req = (method: string, body?: unknown) => new NextRequest('http://localhost/api/student/tests', { method,
  ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
const ctx = { params: Promise.resolve({ id: testId, docId: documentId }) }
const cases = [
  ['detail', detail, 'GET', undefined], ['start', start, 'POST', undefined],
  ['recovery', recover, 'GET', undefined], ['save', save, 'PATCH', { responses: {}, expected_revision: 1 }],
  ['submit', submit, 'POST', { responses: {}, expected_revision: 1 }], ['session', session, 'GET', undefined],
  ['history', history, 'GET', undefined], ['focus', focus, 'POST', { session_id: 's1', event_type: 'away_start' }],
  ['results', results, 'GET', undefined], ['file', file, 'GET', undefined], ['snapshot', snapshot, 'GET', undefined],
] as const
describe('contextual learner Test route group', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); delete process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION
    vi.mocked(requireAuth).mockResolvedValue({ id: actor, role: 'teacher', email: 'member@example.test' })
    vi.mocked(requireRole).mockRejectedValue(new Error('Legacy role guard reached'))
    rpc.mockImplementation(() => ({ abortSignal: () => Promise.resolve({ data: null, error: { code: 'PT403', message: 'private' } }) }))
  })
  afterEach(() => vi.unstubAllEnvs())
  it.each(cases)('uses contextual relationship authority for %s for either global role', async (_name, handler, method, body) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actor] }))
    for (const role of ['teacher', 'student'] as const) {
      vi.mocked(requireAuth).mockResolvedValue({ id: actor, role, email: 'member@example.test' })
      const response = await handler(req(method, body), ctx)
      expect(response.status).toBe(403)
      expect(await response.json()).not.toMatchObject({ error: 'private' })
    }
    expect(requireRole).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('test_learner_workflow_v1', expect.objectContaining({ p_actor_id: actor, p_test_id: testId }))
  })
  it.each(cases)('rejects malformed admission before pending params/data for %s', async (_name, handler, method, body) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{}')
    const response = await handler(req(method, body), { params: new Promise(() => {}) })
    expect(response.status).toBe(503); expect(rpc).not.toHaveBeenCalled(); expect(requireRole).not.toHaveBeenCalled()
  })
  it.each(cases)('retains absent and unmatched legacy dispatch for %s', async (_name, handler, method, body) => {
    for (const config of [undefined, JSON.stringify({ version: 1, admittedUserIds: [] })]) {
      if (config) vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
      await handler(req(method, body), ctx)
    }
    // History's historical guard is requireAuth; the other methods requireRole.
    if (_name !== 'history') expect(requireRole).toHaveBeenCalledTimes(2)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('does not accept a member subject substitution before the protected transaction', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actor] }))
    const response = await history(new NextRequest(`http://localhost/api/student/tests/${testId}/history?student_id=${documentId}`), ctx)
    expect(response.status).toBe(403)
    expect(rpc).toHaveBeenCalledWith('test_learner_workflow_v1', expect.objectContaining({ p_payload: { requested_student_id: documentId } }))
  })
  it('bounds parameter resolution under the request deadline', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actor] }))
    vi.useFakeTimers()
    try { const pending = detail(req('GET'), { params: new Promise(() => {}) }); await vi.advanceTimersByTimeAsync(30000)
      expect((await pending).status).toBe(503); expect(rpc).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
})
