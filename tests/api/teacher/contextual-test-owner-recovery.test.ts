import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as unsubmit } from '@/app/api/teacher/tests/[id]/unsubmit/route'
import { DELETE as single } from '@/app/api/teacher/tests/[id]/students/[studentId]/attempt/route'
import { POST as bulk } from '@/app/api/teacher/tests/[id]/students/attempts/bulk-delete/route'
import { ApiError } from '@/lib/api-error'
const actor = '11111111-1111-4111-8111-111111111111'
const id = '22222222-2222-4222-8222-222222222222'
const studentId = '33333333-3333-4333-8333-333333333333'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), role: vi.fn(), inspect: vi.fn(), run: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth, requireRole: mocks.role }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))
vi.mock('@/lib/server/contextual-test-owner-workflow', () => ({ createContextualTestOwnerWorkflow: () => ({ inspect: mocks.inspect, run: mocks.run }) }))
const deleted = { student_ids: [studentId], deleted_attempts: 0, deleted_responses: 0, deleted_focus_events: 0, deleted_ai_grading_items: 0 }
function request() { return new Request('https://example.test', { method: 'POST', body: JSON.stringify({ student_ids: [studentId] }) }) }
describe('three contextual owner recovery route admission branches', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actor] })); mocks.auth.mockResolvedValue({ id: actor, role: 'student' }); mocks.inspect.mockResolvedValue({ id }); mocks.role.mockImplementation(() => { throw new ApiError(403, 'legacy role guard') }) })
  afterEach(() => vi.unstubAllEnvs())
  for (const row of [{ name: 'unsubmit', route: unsubmit, result: { student_ids: [studentId], unsubmitted_count: 0, skipped_count: 1, skipped_enrollment_count: 0, history_written_count: 0 } }, { name: 'single', route: single, result: deleted }, { name: 'bulk', route: bulk, result: { ...deleted, requested_count: 1, deleted_student_count: 0 } }]) {
    it.each(['student', 'teacher'])(`${row.name} admits current owner independent of %s role`, async role => {
      mocks.auth.mockResolvedValue({ id: actor, role })
      if (row.name === 'unsubmit') mocks.run.mockResolvedValueOnce({ result: { student_ids: [studentId], eligible_student_ids: [studentId], attempts: [] } })
      mocks.run.mockResolvedValue({ result: row.result })
      const result = await row.route(request(), { params: Promise.resolve({ id, studentId }) })
      expect(result.status).toBe(200); expect(mocks.role).not.toHaveBeenCalled()
    })
    it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [studentId] })])(`${row.name} preserves absent/unmatched legacy branch`, async config => {
      vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
      const result = await row.route(request(), { params: Promise.resolve({ id, studentId }) })
      expect(result.status).toBe(403); expect(mocks.role).toHaveBeenCalledWith('teacher'); expect(mocks.inspect).not.toHaveBeenCalled()
    })
    it(`${row.name} fails malformed admission before unresolved params or any DB`, async () => {
      vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{bad')
      const result = await row.route(request(), { params: new Promise(() => {}) })
      expect(result.status).toBe(503); expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.role).not.toHaveBeenCalled()
    })
    it.each([403, 404, 409, 503])(`${row.name} never retries or falls back after admitted %s`, async status => {
      mocks.inspect.mockRejectedValue(new ApiError(status, 'denied'))
      const result = await row.route(request(), { params: Promise.resolve({ id, studentId }) })
      expect(result.status).toBe(status); expect(mocks.role).not.toHaveBeenCalled(); expect(mocks.inspect).toHaveBeenCalledOnce(); expect(mocks.run).not.toHaveBeenCalled()
    })
  }
})
