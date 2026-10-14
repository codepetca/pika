import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as results } from '@/app/api/teacher/tests/[id]/results/route'
import { PATCH as responseSave } from '@/app/api/teacher/tests/[id]/responses/[responseId]/route'
import { PATCH as studentSave } from '@/app/api/teacher/tests/[id]/students/[studentId]/grades/route'
import { POST as clear } from '@/app/api/teacher/tests/[id]/clear-open-grades/route'
import { POST as returnWork } from '@/app/api/teacher/tests/[id]/return/route'
import { ApiError } from '@/lib/api-error'

const actor = '11111111-1111-4111-8111-111111111111'
const testId = '22222222-2222-4222-8222-222222222222'
const student = '33333333-3333-4333-8333-333333333333'
const responseId = '44444444-4444-4444-8444-444444444444'
const questionId = '55555555-5555-4555-8555-555555555555'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), role: vi.fn(), inspect: vi.fn(), run: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth, requireRole: mocks.role }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))
vi.mock('@/lib/server/contextual-test-owner-workflow', () => ({ createContextualTestOwnerWorkflow: () => ({ inspect: mocks.inspect, run: mocks.run }) }))
vi.mock('@/lib/server/test-ai-grading-runs', () => ({ getActiveTestAiGradingRunSummary: vi.fn() }))
const grade = { response_id: responseId, question_id: questionId, expected_response_revision: 1, score: 1, feedback: 'Good' }
const saved = { saved_count: 1, cleared_count: 0, clear_context: [], responses: [{ id: responseId, revision: 2, score: 1, feedback: 'Good' }] }
const routes = [
  { name: 'results', route: results, body: undefined, operation: 'results', result: { questions: [], student_ids: [], responses: [], attempts: [], users: [], profiles: [], focus_events: [], availability: [], active_ai_grading_run: null } },
  { name: 'response', route: responseSave, body: grade, operation: 'manual-save', result: { ...saved, student_id: null } },
  { name: 'student', route: studentSave, body: { grades: [grade] }, operation: 'manual-save', result: { ...saved, student_id: student } },
  { name: 'clear', route: clear, body: { student_ids: [student], responses: [] }, operation: 'clear-open-grades', result: { student_ids: [student], cleared_students: 0, skipped_students: 1, cleared_responses: 0 } },
  { name: 'return', route: returnWork, body: { student_ids: [student] }, operation: 'return', result: { student_ids: [student], returned_count: 1, already_returned_count: 0, skipped_count: 0, test_closed: false } },
]
function request(body: unknown) { return new Request('https://example.test/api', body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) }
const params = { id: testId, studentId: student, responseId }
describe('five contextual owner grading route admission branches', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actor] }))
    mocks.auth.mockResolvedValue({ id: actor, role: 'student' }); mocks.inspect.mockResolvedValue({ id: testId })
    mocks.role.mockImplementation(() => { throw new ApiError(403, 'legacy role guard') })
  })
  afterEach(() => vi.unstubAllEnvs())
  it.each(['single', 'batch'])('preserves public %s MC-clear output and excludes internal normalization context', async kind => {
    const response = { id: responseId, revision: 2, score: 0, feedback: null }
    mocks.run.mockResolvedValue({ result: { student_id: kind === 'single' ? null : student, saved_count: 1, cleared_count: 1,
      clear_context: [{ response_id: responseId, question_id: questionId, question_type: 'multiple_choice', selected_option: 0 }], responses: [response] } })
    const input = { response_id: responseId, question_id: questionId, expected_response_revision: 1, clear_grade: true }
    const route = kind === 'single' ? responseSave : studentSave
    const result = await route(request(kind === 'single' ? input : { grades: [input] }), { params: Promise.resolve(params) })
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual(kind === 'single' ? { response } : { saved_count: 1, responses: [response] })
    expect(mocks.role).not.toHaveBeenCalled(); expect(mocks.run).toHaveBeenCalledOnce()
  })
  it('fails closed without retry when a clear acknowledgement claims zero for an open response', async () => {
    mocks.run.mockResolvedValue({ result: { student_id: null, saved_count: 1, cleared_count: 1,
      clear_context: [{ response_id: responseId, question_id: questionId, question_type: 'open_response', selected_option: null }],
      responses: [{ id: responseId, revision: 2, score: 0, feedback: null }] } })
    const result = await responseSave(request({ expected_response_revision: 1, clear_grade: true }), { params: Promise.resolve(params) })
    expect(result.status).toBe(503); expect(mocks.role).not.toHaveBeenCalled(); expect(mocks.run).toHaveBeenCalledOnce()
  })
  for (const row of routes) {
    it.each(['student', 'teacher'])(`${row.name} admits current owner independent of historical %s role`, async role => {
      mocks.auth.mockResolvedValue({ id: actor, role }); mocks.run.mockResolvedValue({ test: { id: testId, title: 'Test', status: 'active', show_results: false }, result: row.result })
      const result = await row.route(request(row.body), { params: Promise.resolve(params) })
      expect(result.status).toBe(200); expect(mocks.role).not.toHaveBeenCalled(); expect(mocks.run).toHaveBeenCalledOnce()
      expect(mocks.run.mock.calls[0][0]).toBe(row.operation)
    })
    it(`${row.name} rejects malformed admission before params, body, or DB`, async () => {
      vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{bad')
      const result = await row.route(request(row.body), { params: new Promise(() => {}) })
      expect(result.status).toBe(503); expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.inspect).not.toHaveBeenCalled(); expect(mocks.role).not.toHaveBeenCalled()
    })
    it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [student] })])(`${row.name} retains legacy guards for absent/unmatched admission`, async config => {
      vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
      const result = await row.route(request(row.body), { params: Promise.resolve(params) })
      expect(result.status).toBe(403); expect(mocks.role).toHaveBeenCalledWith('teacher'); expect(mocks.inspect).not.toHaveBeenCalled()
    })
    it.each([403, 404, 409, 503])(`${row.name} never falls back or retries after admitted %s`, async status => {
      mocks.inspect.mockRejectedValue(new ApiError(status, 'Unable to verify test operation'))
      const result = await row.route(request(row.body), { params: Promise.resolve(params) })
      expect(result.status).toBe(status); expect(mocks.role).not.toHaveBeenCalled(); expect(mocks.inspect).toHaveBeenCalledOnce(); expect(mocks.run).not.toHaveBeenCalled()
    })
  }
})
