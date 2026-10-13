import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/teacher/tests/[id]/unpublish/route'
import { ApiError } from '@/lib/api-error'
const actor = '11111111-1111-4111-8111-111111111111'
const id = '22222222-2222-4222-8222-222222222222'
const classroom = '33333333-3333-4333-8333-333333333333'
const stamp = '2026-10-09T12:00:00Z'
const test = { id, classroom_id: classroom, title: 'Test', status: 'closed', show_results: false, documents: [], position: 0, points_possible: 100, include_in_final: true, created_by: actor, created_at: stamp, updated_at: stamp, artifact_id: actor, source_artifact_id: null, source_blueprint_version_id: null, blueprint_archived_at: null, gradebook_category_id: null, gradebook_maximum_override: null, test_date: null, gradebook_score_scale: 1, gradebook_weight: 10, questions_locked_at: null }
const mocks = vi.hoisted(() => ({ auth: vi.fn(), role: vi.fn(), inspect: vi.fn(), run: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth, requireRole: mocks.role }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))
vi.mock('@/lib/server/contextual-test-owner-workflow', () => ({ createContextualTestOwnerWorkflow: () => ({ inspect: mocks.inspect, run: mocks.run }) }))
const request = (body: unknown = {}) => new Request('https://example.test', { method: 'POST', body: JSON.stringify(body) })
describe('contextual owner unpublish route admission', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actor] })); mocks.auth.mockResolvedValue({ id: actor, role: 'student' }); mocks.inspect.mockResolvedValue(test); mocks.run.mockResolvedValue({ test: { ...test, status: 'draft' }, result: { draft_version: 8 } }); mocks.role.mockRejectedValue(new ApiError(403, 'legacy role guard')) })
  afterEach(() => vi.unstubAllEnvs())
  it.each(['student', 'teacher'])('admits an owner independent of global %s role and preserves public envelope', async role => {
    mocks.auth.mockResolvedValue({ id: actor, role })
    const response = await POST(request(), { params: Promise.resolve({ id }) })
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ test: { ...test, status: 'draft', assessment_type: 'test' }, draft_version: 8 })
    expect(mocks.inspect).toHaveBeenCalledOnce(); expect(mocks.run).toHaveBeenCalledExactlyOnceWith('unpublish', {}); expect(mocks.role).not.toHaveBeenCalled()
  })
  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [classroom] })])('preserves absent or unmatched literal legacy dispatch', async config => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config); const req = request()
    expect((await POST(req, { params: Promise.resolve({ id }) })).status).toBe(403)
    expect(mocks.role).toHaveBeenCalledWith('teacher'); expect(mocks.client).not.toHaveBeenCalled(); expect(req.bodyUsed).toBe(false)
  })
  it('authenticates before unresolved params or body', async () => {
    mocks.auth.mockRejectedValue(Object.assign(new Error('Unauthorized'), { name: 'AuthenticationError' }))
    const req = request(); expect((await POST(req, { params: new Promise(() => {}) })).status).toBe(401)
    expect(req.bodyUsed).toBe(false); expect(mocks.client).not.toHaveBeenCalled()
  })
  it('fails malformed admission closed before input or service client', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{bad'); const req = request()
    expect((await POST(req, { params: new Promise(() => {}) })).status).toBe(503)
    expect(req.bodyUsed).toBe(false); expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.role).not.toHaveBeenCalled()
  })
  it.each([null, [], { forged: true }])('rejects strict nonempty or invalid bodies before discovery', async body => {
    expect((await POST(request(body), { params: Promise.resolve({ id }) })).status).toBe(400); expect(mocks.inspect).not.toHaveBeenCalled()
  })
  it('rejects malformed/unknown params before body consumption', async () => {
    for (const params of [{ id: 'bad' }, { id, forged: true }]) { const req = request(); expect((await POST(req, { params: Promise.resolve(params) })).status).toBe(400); expect(req.bodyUsed).toBe(false) }
  })
  it.each([400, 403, 404, 409, 503])('never falls back or retries admitted %s', async status => {
    mocks.inspect.mockRejectedValue(new ApiError(status, 'private detail'))
    const response = await POST(request(), { params: Promise.resolve({ id }) })
    expect(response.status).toBe(status); expect(mocks.inspect).toHaveBeenCalledOnce(); expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.role).not.toHaveBeenCalled()
    expect(await response.json()).toEqual({ error: ({ 400: 'Invalid Test return request', 403: 'Forbidden', 404: 'Test not found', 409: 'Test cannot return to draft', 503: 'Unable to verify Test return to draft' } as Record<number, string>)[status] })
  })
  it('contains unknown service-client failures as unavailable', async () => {
    mocks.client.mockImplementation(() => { throw new Error('private configuration detail') })
    const response = await POST(request(), { params: Promise.resolve({ id }) })
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'Unable to verify Test return to draft' })
    expect(mocks.role).not.toHaveBeenCalled(); expect(mocks.inspect).not.toHaveBeenCalled()
  })
})
