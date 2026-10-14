import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DELETE } from '@/app/api/teacher/tests/[id]/route'
import { ApiError } from '@/lib/api-error'
const actor = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222', classroom = '33333333-3333-4333-8333-333333333333'
const stamp = '2026-10-09T12:00:00Z'
const test = { id, classroom_id: classroom, title: 'Test', status: 'active', show_results: false, documents: [], position: 0, points_possible: 100, include_in_final: true, created_by: classroom, created_at: stamp, updated_at: stamp, artifact_id: actor, source_artifact_id: null, source_blueprint_version_id: null, blueprint_archived_at: null, gradebook_category_id: null, gradebook_maximum_override: null, test_date: null, gradebook_score_scale: 1, gradebook_weight: 10, questions_locked_at: stamp }
const mocks = vi.hoisted(() => ({ auth: vi.fn(), role: vi.fn(), inspect: vi.fn(), run: vi.fn(), client: vi.fn(), access: vi.fn(), legacy: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth, requireRole: mocks.role }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))
vi.mock('@/lib/server/tests', () => ({ assertTeacherOwnsTest: mocks.access }))
vi.mock('@/lib/server/test-deletion', () => ({ deleteTeacherTestAtomic: mocks.legacy }))
vi.mock('@/lib/server/contextual-test-owner-workflow', () => ({ createContextualTestOwnerWorkflow: () => ({ inspect: mocks.inspect, run: mocks.run }) }))
const request = () => new Request('https://example.test', { method: 'DELETE', body: '{invalid' })
describe('whole-Test DELETE admission dispatch', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actor] })); mocks.auth.mockResolvedValue({ id: actor, role: 'student' }); mocks.inspect.mockResolvedValue(test); mocks.run.mockResolvedValue({ operation: 'delete', test, test_absent: true, result: { deleted: true, responses_count: 7 } }); mocks.role.mockResolvedValue({ id: actor, role: 'teacher' }); mocks.access.mockResolvedValue({ ok: true, test }); mocks.legacy.mockResolvedValue({ deleted: true, responsesCount: 3 }) })
  afterEach(() => vi.unstubAllEnvs())
  it.each(['student', 'teacher'])('accepts SQL owner acknowledgement with global %s role and foreign creator', async role => {
    mocks.auth.mockResolvedValue({ id: actor, role }); const req = request()
    const response = await DELETE(req, { params: Promise.resolve({ id }) }); expect(await response.json()).toEqual({ success: true, responses_count: 7 })
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith('delete', {}); expect(mocks.role).not.toHaveBeenCalled(); expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled(); expect(req.bodyUsed).toBe(false)
  })
  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [classroom] })])('preserves the literal unmatched legacy branch', async config => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config); const req = request(); const response = await DELETE(req, { params: Promise.resolve({ id }) })
    expect(await response.json()).toEqual({ success: true, responses_count: 3 }); expect(mocks.role).toHaveBeenCalledWith('teacher'); expect(mocks.access).toHaveBeenCalledWith(actor, id, { checkArchived: true }); expect(mocks.legacy).toHaveBeenCalledExactlyOnceWith({ testId: id, teacherId: actor }); expect(mocks.inspect).not.toHaveBeenCalled(); expect(req.bodyUsed).toBe(false)
  })
  it.each(['member', 'former-owner', 'foreign-creator', 'archived', 'retired-blueprint', 'purge', 'provider-bound'])('does not bypass SQL denial for %s or fall back', async _boundary => {
    mocks.inspect.mockRejectedValue(new ApiError(403, 'private')); const response = await DELETE(request(), { params: Promise.resolve({ id }) }); expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: 'Forbidden' }); expect(mocks.inspect).toHaveBeenCalledOnce(); expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled(); expect(mocks.role).not.toHaveBeenCalled()
  })
  it.each([400, 403, 404, 409, 503])('never retries or falls back on admitted final %s', async status => {
    mocks.run.mockRejectedValue(new ApiError(status, 'private')); const response = await DELETE(request(), { params: Promise.resolve({ id }) }); expect(response.status).toBe(status); expect(mocks.run).toHaveBeenCalledOnce(); expect(mocks.legacy).not.toHaveBeenCalled(); expect(mocks.role).not.toHaveBeenCalled(); expect(JSON.stringify(await response.json())).not.toContain('private')
  })
  it('authenticates before params and masks malformed admission without service access', async () => {
    mocks.auth.mockRejectedValue(Object.assign(new Error('Unauthorized'), { name: 'AuthenticationError' })); expect((await DELETE(request(), { params: new Promise(() => {}) })).status).toBe(401); expect(mocks.client).not.toHaveBeenCalled()
    mocks.auth.mockResolvedValue({ id: actor, role: 'student' }); vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{bad'); expect((await DELETE(request(), { params: new Promise(() => {}) })).status).toBe(503); expect(mocks.role).not.toHaveBeenCalled()
  })
  it.each([{ id: 'bad' }, { id, extra: true }])('rejects strict invalid params before discovery', async params => {
    const req = request(); expect((await DELETE(req, { params: Promise.resolve(params) })).status).toBe(400); expect(mocks.inspect).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled(); expect(req.bodyUsed).toBe(false)
  })
  it('masks unexpected service-client faults and never falls back', async () => {
    mocks.client.mockImplementation(() => { throw new Error('private configuration') })
    const response = await DELETE(request(), { params: Promise.resolve({ id }) }); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'Unable to verify Test deletion' }); expect(mocks.inspect).not.toHaveBeenCalled(); expect(mocks.role).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled()
  })
})
