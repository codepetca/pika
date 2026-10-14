import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleContextualTestOwnerRecoveryRequest } from '@/lib/server/contextual-test-owner-recovery'
import { ApiError } from '@/lib/api-error'
const actor = '11111111-1111-4111-8111-111111111111'
const id = '22222222-2222-4222-8222-222222222222'
const student = '33333333-3333-4333-8333-333333333333'
const attempt = '44444444-4444-4444-8444-444444444444'
const mocks = vi.hoisted(() => ({ configured: vi.fn(), admission: vi.fn(), auth: vi.fn(), inspect: vi.fn(), run: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }))
vi.mock('@/lib/server/classroom-experience-admission', () => ({ isClassroomExperienceAdmissionConfigured: mocks.configured, resolveClassroomExperienceAdmission: mocks.admission }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))
vi.mock('@/lib/server/contextual-test-owner-workflow', () => ({ createContextualTestOwnerWorkflow: () => ({ inspect: mocks.inspect, run: mocks.run }) }))
const deleted = { deleted_attempts: 0, deleted_responses: 0, deleted_focus_events: 0, deleted_ai_grading_items: 0 }
const plan = { student_ids: [student], eligible_student_ids: [student], attempts: [{ id: attempt, student_id: student, draft_revision: 4, responses: { q: 'Saved answer' } }] }
function request(body: unknown = { student_ids: [student] }) { return new Request('https://example.test/api', { method: 'POST', body: JSON.stringify(body) }) }
describe('bounded contextual owner recovery', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.configured.mockReturnValue(true); mocks.admission.mockReturnValue({ status: 'admitted' }); mocks.auth.mockResolvedValue({ id: actor, role: 'student' }); mocks.inspect.mockResolvedValue({ id }); mocks.run.mockResolvedValue({ result: { student_ids: [student], ...deleted } }) })
  it('leaves OFF and unadmitted bodies and legacy authorization untouched', async () => {
    mocks.configured.mockReturnValue(false)
    expect(await handleContextualTestOwnerRecoveryRequest('delete-single', request(), Promise.resolve({}))).toBeNull()
    expect(mocks.auth).not.toHaveBeenCalled()
    mocks.configured.mockReturnValue(true); mocks.admission.mockReturnValue({ status: 'legacy' })
    expect(await handleContextualTestOwnerRecoveryRequest('unsubmit', request(), Promise.resolve({}))).toBeNull()
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it('returns exact single zero-work counts for an owner with student account role', async () => {
    const result = await handleContextualTestOwnerRecoveryRequest('delete-single', new Request('https://example.test'), Promise.resolve({ id, studentId: student }))
    expect(await result!.json()).toEqual(deleted); expect(mocks.run).toHaveBeenCalledWith('delete-single', { student_ids: [student] })
  })
  it('validates and deduplicates a bounded bulk selection', async () => {
    mocks.run.mockResolvedValue({ result: { student_ids: [student], requested_count: 1, deleted_student_count: 0, ...deleted } })
    const result = await handleContextualTestOwnerRecoveryRequest('delete-bulk', request({ student_ids: [student, student] }), Promise.resolve({ id }))
    expect(await result!.json()).toEqual({ success: true, requested_count: 1, deleted_student_count: 0, ...deleted })
  })
  it.each([{ student_ids: [] }, { student_ids: ['bad'] }, { student_ids: Array(101).fill(student) }, { student_ids: [student], forged: true }])('rejects malformed and over-limit input before discovery', async body => {
    await expect(handleContextualTestOwnerRecoveryRequest('unsubmit', request(body), Promise.resolve({ id }))).rejects.toThrow()
    expect(mocks.inspect).not.toHaveBeenCalled()
  })
  it('bounds streamed body and content length before discovery', async () => {
    const body = request(); body.headers.set('content-length', '2097153')
    await expect(handleContextualTestOwnerRecoveryRequest('unsubmit', body, Promise.resolve({ id }))).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.inspect).not.toHaveBeenCalled()
  })
  it('fails malformed admission before params, body or discovery', async () => {
    mocks.admission.mockImplementation(() => { throw new ApiError(503, 'bad admission') })
    await expect(handleContextualTestOwnerRecoveryRequest('unsubmit', request(), new Promise(() => {}))).rejects.toMatchObject({ statusCode: 503 })
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it.each([403, 404, 409, 503])('does not retry an admitted %s failure', async status => {
    mocks.inspect.mockRejectedValue(new ApiError(status, 'denied'))
    await expect(handleContextualTestOwnerRecoveryRequest('unsubmit', request(), Promise.resolve({ id }))).rejects.toMatchObject({ statusCode: status })
    expect(mocks.inspect).toHaveBeenCalledOnce(); expect(mocks.run).not.toHaveBeenCalled()
  })
  it('binds normalized baseline history to the exact planned draft and preserves public skip counts despite history failure', async () => {
    mocks.run.mockResolvedValueOnce({ result: plan }).mockResolvedValueOnce({ result: { student_ids: [student], unsubmitted_count: 1, skipped_count: 0, skipped_enrollment_count: 0, history_written_count: 0 } })
    const result = await handleContextualTestOwnerRecoveryRequest('unsubmit', request(), Promise.resolve({ id }))
    expect(await result!.json()).toEqual({ unsubmitted_count: 1, skipped_count: 0, skipped_enrollment_count: 0 })
    expect(mocks.run.mock.calls[1]).toEqual(['unsubmit', { student_ids: [student], eligible_student_ids: [student], attempts: [{ ...plan.attempts[0], snapshot: { q: { question_type: 'open_response', response_text: 'Saved answer' } }, word_count: 2, char_count: 70, paste_word_count: 0, keystroke_count: 0 }] }])
  })
  it('preserves mixed selection enrollment skips and existing-attempt counts', async () => {
    mocks.run.mockResolvedValueOnce({ result: { ...plan, student_ids: [student, actor] } }).mockResolvedValueOnce({ result: {
      student_ids: [student, actor], unsubmitted_count: 1, skipped_count: 1, skipped_enrollment_count: 1, history_written_count: 1,
    } })
    const result = await handleContextualTestOwnerRecoveryRequest('unsubmit', request({ student_ids: [student, actor] }), Promise.resolve({ id }))
    expect(await result!.json()).toEqual({ unsubmitted_count: 1, skipped_count: 1, skipped_enrollment_count: 1 })
  })
  it.each([
    { unsubmitted_count: 0 }, { skipped_count: 1 }, { skipped_enrollment_count: 1 }, { history_written_count: 2 }, { student_ids: [actor] }, { private: true },
  ])('fails an incoherent final unsubmit acknowledgement without retry', async change => {
    mocks.run.mockResolvedValueOnce({ result: plan }).mockResolvedValueOnce({ result: {
      student_ids: [student], unsubmitted_count: 1, skipped_count: 0, skipped_enrollment_count: 0, history_written_count: 1, ...change,
    } })
    await expect(handleContextualTestOwnerRecoveryRequest('unsubmit', request(), Promise.resolve({ id }))).rejects.toMatchObject({ statusCode: 503 })
    expect(mocks.run).toHaveBeenCalledTimes(2)
  })
  it('carries final source CAS failures out without a retry or success projection', async () => {
    mocks.run.mockResolvedValueOnce({ result: plan }).mockRejectedValueOnce(new ApiError(409, 'changed'))
    await expect(handleContextualTestOwnerRecoveryRequest('unsubmit', request(), Promise.resolve({ id }))).rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.run).toHaveBeenCalledTimes(2)
  })
  it('rejects over-limit streamed body bytes and already-aborted requests', async () => {
    await expect(handleContextualTestOwnerRecoveryRequest('unsubmit', new Request('https://example.test', { method: 'POST', body: ' '.repeat(2097153) }), Promise.resolve({ id }))).rejects.toMatchObject({ statusCode: 400 })
    const abort = new AbortController(); abort.abort()
    await expect(handleContextualTestOwnerRecoveryRequest('unsubmit', new Request('https://example.test', { method: 'POST', body: '{}', signal: abort.signal }), Promise.resolve({ id }))).rejects.toMatchObject({ statusCode: 503 })
    expect(mocks.inspect).not.toHaveBeenCalled()
  })
  it.each([
    { ...plan, student_ids: [actor] }, { ...plan, eligible_student_ids: [actor] }, { ...plan, attempts: [...plan.attempts, ...plan.attempts] },
    { ...plan, attempts: [{ ...plan.attempts[0], student_id: actor }] }, { ...plan, attempts: [{ ...plan.attempts[0], draft_revision: 0 }] },
  ])('rejects forged plans before mutation', async result => {
    mocks.run.mockResolvedValue({ result })
    await expect(handleContextualTestOwnerRecoveryRequest('unsubmit', request(), Promise.resolve({ id }))).rejects.toMatchObject({ statusCode: 503 })
    expect(mocks.run).toHaveBeenCalledOnce()
  })
  it.each([
    { student_ids: [actor], ...deleted }, { student_ids: [student], ...deleted, deleted_attempts: 2 },
    { student_ids: [student], ...deleted, deleted_responses: -1 }, { student_ids: [student], ...deleted, extra: true },
  ])('rejects forged single delete acknowledgements', async result => {
    mocks.run.mockResolvedValue({ result })
    await expect(handleContextualTestOwnerRecoveryRequest('delete-single', new Request('https://example.test'), Promise.resolve({ id, studentId: student }))).rejects.toMatchObject({ statusCode: 503 })
  })
})
