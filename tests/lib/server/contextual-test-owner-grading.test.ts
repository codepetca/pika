import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleContextualTestOwnerGradingRequest, projectOwnerTestResults, validateOwnerGradeSaveResult } from '@/lib/server/contextual-test-owner-grading'
import { ApiError } from '@/lib/api-error'

const actor = '11111111-1111-4111-8111-111111111111'
const testId = '22222222-2222-4222-8222-222222222222'
const student = '33333333-3333-4333-8333-333333333333'
const responseId = '44444444-4444-4444-8444-444444444444'
const mocks = vi.hoisted(() => ({ configured: vi.fn(), admission: vi.fn(), auth: vi.fn(), inspect: vi.fn(), run: vi.fn(), client: vi.fn(), provenance: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }))
vi.mock('@/lib/server/classroom-experience-admission', () => ({ isClassroomExperienceAdmissionConfigured: mocks.configured, resolveClassroomExperienceAdmission: mocks.admission }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))
vi.mock('@/lib/server/contextual-test-owner-workflow', () => ({ createContextualTestOwnerWorkflow: () => ({ inspect: mocks.inspect, run: mocks.run }) }))
vi.mock('@/lib/server/test-ai-provenance', () => ({ verifyManualTestAiProvenanceToken: mocks.provenance }))

function request(body?: unknown) { return new Request('https://example.test/api', body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) }
const grade = { response_id: responseId, question_id: null, expected_response_revision: 3, clear_grade: false, score: 4.25, feedback: 'Good' }
const saved = { student_id: student, saved_count: 1, cleared_count: 0, responses: [{ id: responseId, revision: 4, score: 4.25, feedback: 'Good' }] }
const stamp = '2026-10-10T12:00:00Z'
const questionId = '55555555-5555-4555-8555-555555555555'
const test = { id: testId, classroom_id: '66666666-6666-4666-8666-666666666666', title: 'Test', status: 'active' as const, show_results: false, documents: [],
  position: 0, points_possible: 10, include_in_final: true, created_by: actor, created_at: stamp, updated_at: stamp,
  artifact_id: testId, source_artifact_id: null, source_blueprint_version_id: null, blueprint_archived_at: null,
  gradebook_category_id: null, gradebook_maximum_override: null, gradebook_score_scale: 1, gradebook_weight: 10, questions_locked_at: null }
function source() { return { student_ids: [student], questions: [{ id: questionId, test_id: testId, question_type: 'open_response', question_text: 'Explain', options: [], correct_option: null,
  points: 10, response_max_chars: 10000, response_monospace: false, position: 0, created_at: stamp, updated_at: stamp }],
  users: [{ id: student, email: 'member@example.test' }], profiles: [{ user_id: student, first_name: ' Member ', last_name: ' Student ' }],
  responses: [{ id: responseId, revision: 3, test_id: testId, question_id: questionId, student_id: student, selected_option: null, response_text: 'Final answer', score: 0, feedback: 'Feedback', graded_at: stamp, graded_by: actor, submitted_at: stamp }],
  attempts: [{ student_id: student, is_submitted: true, submitted_at: stamp, returned_at: null, returned_by: null, closed_for_grading_at: null, closed_for_grading_by: null, updated_at: stamp, responses: {} }],
  availability: [{ student_id: student, state: 'closed' }], focus_events: [], active_ai_grading_run: null } }

describe('contextual Test owner grading', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.configured.mockReturnValue(true); mocks.admission.mockReturnValue({ status: 'admitted' }); mocks.auth.mockResolvedValue({ id: actor, role: 'student' }); mocks.inspect.mockResolvedValue({ id: testId }); mocks.run.mockResolvedValue({ result: { student_ids: [student], returned_count: 1, already_returned_count: 0, skipped_count: 0, test_closed: false } }) })
  it('keeps absent and unmatched admission on the legacy branch', async () => {
    mocks.configured.mockReturnValue(false)
    expect(await handleContextualTestOwnerGradingRequest('return', request(), Promise.resolve({}))).toBeNull()
    expect(mocks.auth).not.toHaveBeenCalled()
    mocks.configured.mockReturnValue(true); mocks.admission.mockReturnValue({ status: 'legacy' })
    expect(await handleContextualTestOwnerGradingRequest('return', request(), Promise.resolve({}))).toBeNull()
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it('admits an owner with historical student role and preserves the return envelope', async () => {
    const result = await handleContextualTestOwnerGradingRequest('return', request({ student_ids: [student, student] }), Promise.resolve({ id: testId }))
    expect(await result!.json()).toEqual({ returned_count: 1, already_returned_count: 0, skipped_count: 0, test_closed: false })
    expect(mocks.run).toHaveBeenCalledWith('return', { student_ids: [student] })
  })
  it('never retries admitted denials', async () => {
    mocks.inspect.mockRejectedValue(new Error('denied'))
    await expect(handleContextualTestOwnerGradingRequest('return', request({ student_ids: [student] }), Promise.resolve({ id: testId }))).rejects.toThrow()
    expect(mocks.inspect).toHaveBeenCalledTimes(1); expect(mocks.run).not.toHaveBeenCalled()
  })
  it('resolves malformed admission before params, body, or database work', async () => {
    mocks.admission.mockImplementation(() => { throw new ApiError(503, 'Admission unavailable') })
    const body = request({ student_ids: [student] }); const read = vi.spyOn(body, 'json')
    await expect(handleContextualTestOwnerGradingRequest('return', body, new Promise(() => {}))).rejects.toMatchObject({ statusCode: 503 })
    expect(read).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled()
  })
  it('rejects invalid target UUIDs and unbounded selections before discovery', async () => {
    await expect(handleContextualTestOwnerGradingRequest('student-save', request({ grades: [{ ...grade, question_id: 'bad' }] }), Promise.resolve({ id: testId, studentId: student }))).rejects.toThrow()
    await expect(handleContextualTestOwnerGradingRequest('return', request({ student_ids: Array(101).fill(student) }), Promise.resolve({ id: testId }))).rejects.toThrow()
    expect(mocks.inspect).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled()
  })
  it('saves a student batch using the exact bound target and canonical identities', async () => {
    mocks.run.mockResolvedValue({ result: saved })
    const result = await handleContextualTestOwnerGradingRequest('student-save', request({ grades: [{ ...grade, question_id: questionId }] }), Promise.resolve({ id: testId, studentId: student }))
    expect(await result!.json()).toEqual({ saved_count: 1, responses: saved.responses })
    expect(mocks.run).toHaveBeenCalledWith('manual-save', { student_id: student, grades: [{ ...grade, question_id: questionId }] })
  })
  it('retains explicit empty expected clear sets and rejects impossible clear acknowledgements', async () => {
    mocks.run.mockResolvedValue({ result: { student_ids: [student], cleared_students: 0, skipped_students: 1, cleared_responses: 0 } })
    const input = { student_ids: [student], responses: [] }
    const result = await handleContextualTestOwnerGradingRequest('clear-open-grades', request(input), Promise.resolve({ id: testId }))
    expect(await result!.json()).toEqual({ cleared_students: 0, skipped_students: 1, cleared_responses: 0 })
    expect(mocks.run).toHaveBeenCalledWith('clear-open-grades', input)
    mocks.run.mockResolvedValue({ result: { student_ids: [student], cleared_students: 1, skipped_students: 0, cleared_responses: 1 } })
    await expect(handleContextualTestOwnerGradingRequest('clear-open-grades', request(input), Promise.resolve({ id: testId }))).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([
    { student_ids: [actor], returned_count: 1, already_returned_count: 0, skipped_count: 0, test_closed: false },
    { student_ids: [student], returned_count: 0, already_returned_count: 0, skipped_count: 0, test_closed: false },
    { student_ids: [student], returned_count: 1, already_returned_count: 0, skipped_count: 0, test_closed: true },
  ])('rejects forged return targets and counts', async result => {
    mocks.run.mockResolvedValue({ result })
    await expect(handleContextualTestOwnerGradingRequest('return', request({ student_ids: [student] }), Promise.resolve({ id: testId }))).rejects.toMatchObject({ statusCode: 503 })
    expect(mocks.run).toHaveBeenCalledTimes(1)
  })
  it('keeps canonical rounding and omitted AI metadata on single-response saves', async () => {
    mocks.run.mockResolvedValue({ result: { ...saved, student_id: null } })
    const result = await handleContextualTestOwnerGradingRequest('response-save', request({ expected_response_revision: 3, score: 4.251, feedback: ' Good ' }), Promise.resolve({ id: testId, responseId }))
    expect(await result!.json()).toEqual({ response: saved.responses[0] })
    expect(mocks.run).toHaveBeenCalledWith('manual-save', { student_id: null, grades: [grade] })
    expect(mocks.provenance).not.toHaveBeenCalled()
  })
  it('verifies the signed suggestion with actor, Test, response, revision and full suggestion before any transaction', async () => {
    const snapshot = { test_title: 'Test', question_text: 'Explain', points: 10, response_monospace: false, answer_key: 'Key', sample_solution: null }
    const input = { expected_response_revision: 3, score: 4.25, feedback: 'Good', ai_grading_basis: 'teacher_key', ai_model: 'model',
      ai_provenance_token: 'signed-token', question_grading_snapshot: snapshot, ai_suggested_score: 5, ai_suggested_feedback: 'Suggestion' }
    mocks.provenance.mockReturnValue(false)
    await expect(handleContextualTestOwnerGradingRequest('response-save', request(input), Promise.resolve({ id: testId, responseId }))).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.inspect).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.provenance).toHaveBeenCalledWith({ token: 'signed-token', expected: { teacherId: actor, testId, responseId, responseRevision: 3,
      gradingBasis: 'teacher_key', referenceAnswers: null, model: 'model', suggestedScore: 5, suggestedFeedback: 'Suggestion', questionGradingSnapshot: snapshot, gradingProvenance: null } })
    mocks.provenance.mockReturnValue(true); mocks.run.mockResolvedValue({ result: { ...saved, student_id: null } })
    await handleContextualTestOwnerGradingRequest('response-save', request(input), Promise.resolve({ id: testId, responseId }))
    const payload = mocks.run.mock.calls[0][1]
    expect(payload.grades[0]).toMatchObject({ ai_grading_basis: 'teacher_key', ai_model: 'model', ai_suggested_score: 5, question_grading_snapshot: snapshot })
    expect(payload.grades[0]).not.toHaveProperty('ai_provenance_token')
  })
  it('transports explicit grade clearing and verifies the null outcome', async () => {
    mocks.run.mockResolvedValue({ result: { student_id: null, saved_count: 1, cleared_count: 1, responses: [{ id: responseId, revision: 4, score: null, feedback: null }] } })
    const result = await handleContextualTestOwnerGradingRequest('response-save', request({ expected_response_revision: 3, clear_grade: true }), Promise.resolve({ id: testId, responseId }))
    expect(await result!.json()).toEqual({ response: { id: responseId, revision: 4, score: null, feedback: null } })
    expect(mocks.run.mock.calls[0][1].grades[0]).toMatchObject({ clear_grade: true, score: null, feedback: null, ai_grading_basis: null, ai_grading_provenance: null })
  })
  it('validates the full grade acknowledgement against the requested outcome', () => {
    expect(validateOwnerGradeSaveResult(saved, student, [grade])).toEqual(saved)
    for (const result of [ { ...saved, student_id: actor }, { ...saved, saved_count: 0 }, { ...saved, cleared_count: 1 },
      { ...saved, responses: [...saved.responses, ...saved.responses] },
      ...[{ id: actor }, { revision: 2 }, { revision: 5 }, { score: 4 }, { feedback: 'forged' }].map(change => ({ ...saved, responses: [{ ...saved.responses[0], ...change }] })) ]) {
      expect(() => validateOwnerGradeSaveResult(result, student, [grade])).toThrowError('Unable to verify test operation')
    }
  })
  it('projects current member grades, deliberate zero, sorted identity and the exact public envelope', () => {
    const result = projectOwnerTestResults(test, source(), actor)
    expect(Object.keys(result).sort()).toEqual(['active_ai_grading_run','questions','responders','results','stats','students','test'])
    expect(result.students[0]).toMatchObject({ student_id: student, name: 'Member Student', status: 'submitted', points_earned: 0, percent: 0,
      graded_open_responses: 1, answers: { [questionId]: { response_id: responseId, response_revision: 3, score: 0, feedback: 'Feedback', is_draft: false } } })
    expect(result.stats).toEqual({ total_students: 1, responded: 1, open_questions_count: 1, graded_open_responses: 1, ungraded_open_responses: 0, returned_count: 0 })
    expect(result.questions[0]).not.toHaveProperty('answer_key')
  })
  it('preserves draft monitoring without response IDs, revisions, scores or feedback', () => {
    const raw = source(); raw.attempts[0].is_submitted = false
    raw.attempts[0].responses = { [questionId]: { question_type: 'open_response', response_text: 'Draft answer' } }
    const result = projectOwnerTestResults(test, raw, actor)
    expect(result.students[0].status).toBe('in_progress')
    expect(result.students[0].answers[questionId]).toEqual({ response_id: null, response_revision: null, question_type: 'open_response', selected_option: null,
      response_text: 'Draft answer', score: null, feedback: null, graded_at: null, is_draft: true })
    expect(result.responders).toEqual([])
  })
  it('keeps returned-before-submitted status precedence and empty-roster completeness', () => {
    const raw = source(); const returned = { ...raw, attempts: [{ ...raw.attempts[0], returned_at: stamp, returned_by: actor }] }
    const result = projectOwnerTestResults(test, returned, actor)
    expect(result.students[0].status).toBe('returned'); expect(result.responders).toEqual([]); expect(result.stats.returned_count).toBe(1)
    const empty = projectOwnerTestResults(test, { ...raw, student_ids: [], responses: [], attempts: [], users: [], profiles: [], availability: [] }, actor)
    expect(empty.students).toEqual([]); expect(empty.stats.total_students).toBe(0)
  })
  it('rejects owner, departed, duplicate and cross-Test source rows rather than partially projecting them', () => {
    const raw = source()
    const invalid = [ { ...raw, student_ids: [actor] }, { ...raw, student_ids: [] }, { ...raw, student_ids: [student, student] },
      { ...raw, responses: [{ ...raw.responses[0], test_id: actor }] }, { ...raw, responses: [{ ...raw.responses[0], student_id: actor }] },
      { ...raw, responses: [{ ...raw.responses[0], question_id: actor }] }, { ...raw, questions: [{ ...raw.questions[0], answer_key: 'private' }] },
      { ...raw, responses: [...raw.responses, ...raw.responses] }, { ...raw, users: [] }, { ...raw, profiles: [{ ...raw.profiles[0], user_id: actor }] },
      { ...raw, attempts: [{ ...raw.attempts[0], student_id: actor }] }, { ...raw, availability: [{ student_id: actor, state: 'open' }] } ]
    for (const bad of invalid) expect(() => projectOwnerTestResults(test, bad, actor)).toThrowError('Unable to verify test operation')
  })
  it('bounds and binds the active run summary without accepting private provider payloads or departed identities', () => {
    const run = { id: responseId, test_id: testId, status: 'running', model: 'model', prompt_guideline_override: null, requested_count: 1,
      eligible_student_count: 1, queued_response_count: 1, processed_count: 0, completed_count: 0, failed_count: 0, skipped_unanswered_count: 0,
      skipped_already_graded_count: 0, pending_count: 1, next_retry_at: '2026-10-10T13:00:00+00:00', error_samples: [], started_at: stamp, completed_at: null, created_at: stamp }
    expect(projectOwnerTestResults(test, { ...source(), active_ai_grading_run: run }, actor).active_ai_grading_run?.next_retry_at).toBe('2026-10-10T13:00:00.000Z')
    for (const change of [{ test_id: actor }, { requested_count: 2 }, { processed_count: 2 }, { pending_count: 0 }, { raw_provider_response: 'private' },
      { error_samples: [{ student_id: actor, code: null, message: 'Failure' }] }]) {
      expect(() => projectOwnerTestResults(test, { ...source(), active_ai_grading_run: { ...run, ...change } }, actor)).toThrowError('Unable to verify test operation')
    }
  })
})
