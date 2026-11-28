import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/student/tests/[id]/session-status/route'
import { requireAuth, requireRole } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }))
const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => ({ rpc })) }))
const actor = '11111111-1111-4111-8111-111111111111', testId = '22222222-2222-4222-8222-222222222222'
const classroom = '33333333-3333-4333-8333-333333333333', attempt = '44444444-4444-4444-8444-444444444444'
const stamp = '2026-11-28T12:00:00Z'
const projection = { test_status: 'active', is_submitted: false, has_submitted: false, returned_at: null,
  closed_for_grading_at: null, access_state: null }
let reply: unknown
const request = () => GET(new NextRequest(`http://localhost/api/student/tests/${testId}/session-status`), { params: Promise.resolve({ id: testId }) })
const witness = (value = projection) => ({ version: 1, actor_id: actor, test_id: testId, classroom_id: classroom, outcome: 'ok', projection: value })
describe('contextual session route narrow read and deployment compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actor] }))
    vi.mocked(requireAuth).mockResolvedValue({ id: actor, email: 'member@example.test', role: 'teacher' })
    vi.mocked(requireRole).mockRejectedValue(new Error('legacy must not be reached'))
    reply = { data: witness(), error: null }
    rpc.mockImplementation(() => ({ abortSignal: async () => reply }))
  })
  afterEach(() => vi.unstubAllEnvs())
  it('authenticates each poll and returns the normal URL/envelope in one RPC for a teacher-role member', async () => {
    const response = await request()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ test: { id: testId, status: 'active', assessment_type: 'test',
      student_status: 'not_started', returned_at: null, access_state: null, effective_access: 'open' },
    student_status: 'not_started', returned_at: null, can_continue: true, message: null })
    expect(rpc).toHaveBeenCalledOnce(); expect(requireRole).not.toHaveBeenCalled()
    vi.mocked(requireAuth).mockRejectedValueOnce(new Error('revoked'))
    await request(); expect(rpc).toHaveBeenCalledOnce(); expect(requireAuth).toHaveBeenCalledTimes(2)
  })
  it.each(['forbidden', 'not_found', 'unavailable'])('never falls through for %s', async outcome => {
    reply = { data: { ...witness(), outcome, projection: null }, error: null }
    expect((await request()).status).toBe({ forbidden: 403, not_found: 404, unavailable: 503 }[outcome])
    expect(rpc).toHaveBeenCalledOnce(); expect(requireRole).not.toHaveBeenCalled()
  })
  it('retains original contextual inspect/session only for the exact missing additive RPC', async () => {
    rpc.mockImplementation((name, args) => ({ abortSignal: async () => name === 'read_test_session_for_member_v1'
      ? { data: null, status: 404, error: { code: 'PGRST202', message: 'Could not find the function public.read_test_session_for_member_v1' } }
      : { error: null, data: { version: 1, actor_id: actor, test_id: testId, classroom_id: classroom, subject_id: actor,
        operation: args.p_operation, result: args.p_operation === 'inspect' ? { access_mode: 'member' } : {
          state: { test: { id: testId, classroom_id: classroom, test_date: null, title: 'T', status: 'active', show_results: false,
            documents: [], position: 0, created_at: stamp, updated_at: stamp }, attempt: null, access_state: null, has_submitted: false },
        } } } }))
    expect((await request()).status).toBe(200)
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['read_test_session_for_member_v1', 'test_learner_workflow_v1', 'test_learner_workflow_v1'])
    expect(rpc.mock.calls.slice(1).map(([,args]) => args.p_operation)).toEqual(['inspect', 'session'])
    expect(requireRole).not.toHaveBeenCalled()
  })
  it('matches original contextual presentation for every status/override/submission/return/grading combination', async () => {
    let narrow = true
    let current: Record<string, unknown> = {}
    rpc.mockImplementation((name, args) => ({ abortSignal: async () => {
      if (name === 'read_test_session_for_member_v1') return narrow
        ? { data: witness(current as typeof projection), error: null }
        : { data: null, error: { code: 'PGRST202', message: 'public.read_test_session_for_member_v1 missing' } }
      return { error: null, data: { version: 1, actor_id: actor, test_id: testId, classroom_id: classroom, subject_id: actor,
        operation: args.p_operation, result: args.p_operation === 'inspect' ? { access_mode: 'member' } : {
          state: { test: { id: testId, classroom_id: classroom, test_date: null, title: 'T', status: current.test_status, show_results: false,
            documents: [], position: 0, created_at: stamp, updated_at: stamp },
          attempt: { id: attempt, is_submitted: current.is_submitted, returned_at: current.returned_at,
            closed_for_grading_at: current.closed_for_grading_at, draft_revision: 1 }, access_state: current.access_state, has_submitted: current.has_submitted },
        } } }
    } }))
    let comparisons = 0
    for (const test_status of ['active', 'closed']) for (const access_state of [null, 'open', 'closed'])
    for (const submitted of [false, true]) for (const returned of [false, true]) for (const locked of [false, true]) {
      current = { test_status, access_state, is_submitted: submitted, has_submitted: submitted,
        returned_at: returned ? stamp : null, closed_for_grading_at: locked ? stamp : null }
      narrow = true; const fresh = await request()
      narrow = false; const previous = await request()
      expect(await fresh.json()).toEqual(await previous.json()); comparisons++
    }
    expect(comparisons).toBe(48)
  })
})
