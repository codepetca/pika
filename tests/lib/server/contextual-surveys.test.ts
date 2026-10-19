import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authorizeSharedSurveyActor, readContextualSurveyDetail, readContextualSurveyList,
  readContextualSurveyResults, readContextualSurveyOwnerForMutation, respondToContextualSurvey,
  createContextualSurveyQuestion, patchContextualSurvey, patchContextualSurveyQuestion, createContextualSurveyRetryBudget,
} from '@/lib/server/contextual-surveys'
import { validateSurveyResponses } from '@/lib/surveys'
import type { SurveyQuestion } from '@/types'

const auth = vi.hoisted(() => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/auth', () => auth)
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const classroomId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const surveyId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const questionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const memberId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const time = '2026-01-01T00:00:00.000Z'
const survey = { id: surveyId, classroom_id: classroomId, title: 'Feedback', status: 'active', opens_at: null,
  show_results: true, dynamic_responses: true, position: 0, created_by: actorId, created_at: time, updated_at: time }
const question = { id: questionId, survey_id: surveyId, question_type: 'short_text', question_text: 'Thoughts?',
  options: [], response_max_chars: 500, position: 0, created_at: time, updated_at: time }
const context = { supabase: { rpc: vi.fn() }, actorId, surveyId, permission: 'member' as const }

beforeEach(() => { vi.clearAllMocks(); context.supabase.rpc.mockReset(); vi.unstubAllEnvs(); auth.requireAuth.mockResolvedValue({ id: actorId, role: 'teacher' }) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

const busy = { data: null, error: { code: 'PT409', message: 'survey_operation_busy' } }
const memberDetail = { data: { survey, classroom: { id: classroomId, teacher_id: memberId, archived_at: null }, questions: [question], responses: [] }, error: null }

describe('bounded positive Survey contention retry', () => {
  it('replays the complete original read once after a positive busy abort', async () => {
    vi.useFakeTimers()
    context.supabase.rpc.mockResolvedValueOnce(busy).mockResolvedValueOnce(memberDetail)
    const pending = readContextualSurveyDetail(context)
    await vi.advanceTimersByTimeAsync(19)
    expect(context.supabase.rpc).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toMatchObject({ questions: [question] })
    expect(context.supabase.rpc).toHaveBeenCalledTimes(2)
    expect(context.supabase.rpc.mock.calls[1]).toEqual(context.supabase.rpc.mock.calls[0])
  })

  it('stops at two calls on repeated busy', async () => {
    vi.useFakeTimers()
    context.supabase.rpc.mockResolvedValue(busy)
    const assertion = expect(readContextualSurveyDetail(context)).rejects.toMatchObject({ statusCode: 409, message: 'Survey changed; please retry' })
    await vi.runAllTimersAsync()
    await assertion
    expect(context.supabase.rpc).toHaveBeenCalledTimes(2)
  })

  it('does not admit a retry when the backoff would reach the monotonic deadline', async () => {
    vi.useFakeTimers()
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const retryBudget = createContextualSurveyRetryBudget()
    context.supabase.rpc.mockImplementationOnce(async () => { now = 80; return busy })
    await expect(readContextualSurveyDetail({ ...context, retryBudget })).rejects.toMatchObject({ statusCode: 409 })
    expect(context.supabase.rpc).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rechecks admission after an overscheduled backoff without dispatching a writer', async () => {
    vi.useFakeTimers()
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    context.supabase.rpc.mockResolvedValue(busy)
    const assertion = expect(respondToContextualSurvey({ ...context, detail: { survey, questions: [question] }, responses: { [questionId]: 'Fine' } })).rejects.toMatchObject({ statusCode: 409 })
    await vi.advanceTimersByTimeAsync(0)
    now = 100
    await vi.advanceTimersByTimeAsync(20)
    await assertion
    expect(context.supabase.rpc).toHaveBeenCalledOnce()
  })

  it.each(['network', 'AbortError', 'TimeoutError'])('never retries a thrown %s failure after busy', async name => {
    vi.useFakeTimers()
    context.supabase.rpc.mockResolvedValueOnce(busy).mockRejectedValueOnce(Object.assign(new Error('private transport text'), { name }))
    const assertion = expect(readContextualSurveyDetail(context)).rejects.toMatchObject({ statusCode: 503, message: 'Survey operation unavailable' })
    await vi.runAllTimersAsync()
    await assertion
    expect(context.supabase.rpc).toHaveBeenCalledTimes(2)
  })

  it.each(['AbortError', 'TimeoutError'])('never retries an initial thrown %s even with a busy-shaped code', async name => {
    context.supabase.rpc.mockRejectedValueOnce(Object.assign(new Error('survey_operation_busy'), { name, code: 'PT409' }))
    await expect(readContextualSurveyDetail(context)).rejects.toMatchObject({ statusCode: 503 })
    expect(context.supabase.rpc).toHaveBeenCalledOnce()
  })

  it('awaits an admitted writer to settle beyond the retry deadline without detaching or replaying it', async () => {
    vi.useFakeTimers()
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    let finish!: (result: { data: { success: true; updated: boolean }; error: null }) => void
    context.supabase.rpc.mockResolvedValueOnce(busy).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = respondToContextualSurvey({ ...context, detail: { survey, questions: [question] }, responses: { [questionId]: 'Fine' } })
    const settled = vi.fn()
    void pending.then(settled)
    await vi.advanceTimersByTimeAsync(20)
    now = 200
    await vi.advanceTimersByTimeAsync(200)
    expect(settled).not.toHaveBeenCalled()
    expect(context.supabase.rpc).toHaveBeenCalledTimes(2)
    finish({ data: { success: true, updated: false }, error: null })
    expect(await pending).toEqual({ success: true, updated: false })
    expect(context.supabase.rpc).toHaveBeenCalledTimes(2)
  })

  it.each([
    { code: 'PT409' }, { code: 'PT409', message: '' },
    { code: 'PT409', message: ' survey_operation_busy' }, { code: 'PT409', message: 'survey_operation_busy ' },
    { code: 'PT409', message: 'prefixsurvey_operation_busysuffix' },
    ...['40001', '40P01', '55P03', '55000'].map(code => ({ code, message: 'survey_operation_busy' })),
    ...['survey_questions_changed', 'survey_parent_changed', 'survey_response_changed', 'survey_subject_fenced', 'survey_classroom_fenced'].map(message => ({ code: 'PT409', message })),
    ...['classroom_purge_active', 'attendance_decommission_active'].map(message => ({ code: '55000', message })),
    ...['course_blueprint_purge_waiting_for_classroom_purge', 'unknown_conflict', 'classroom_operation_busy', 'student_operation_busy'].map(message => ({ code: '40001', message })),
    { code: 'PT403', message: 'survey_operation_busy' }, { code: 'PT404', message: 'survey_operation_busy' },
    { code: 'PT400', message: 'survey_operation_busy' }, { code: 'PGRST202', message: 'survey_operation_busy' },
  ])('never retries a noneligible returned error %j', async error => {
    context.supabase.rpc.mockResolvedValue({ data: null, error })
    await expect(readContextualSurveyDetail(context)).rejects.toMatchObject({ statusCode: error.code === 'PT403' ? 403 : error.code === 'PT404' ? 404 : error.code === 'PT400' ? 400 : error.code === 'PGRST202' ? 503 : 409 })
    expect(context.supabase.rpc).toHaveBeenCalledOnce()
  })

  it('never replays a malformed success, including after busy', async () => {
    vi.useFakeTimers()
    context.supabase.rpc.mockResolvedValueOnce(busy).mockResolvedValueOnce({ data: { success: true }, error: null })
    const assertion = expect(readContextualSurveyDetail(context)).rejects.toMatchObject({ statusCode: 503 })
    await vi.runAllTimersAsync()
    await assertion
    expect(context.supabase.rpc).toHaveBeenCalledTimes(2)
    context.supabase.rpc.mockClear().mockResolvedValue({ data: {}, error: null })
    await expect(readContextualSurveyDetail(context)).rejects.toMatchObject({ statusCode: 503 })
    expect(context.supabase.rpc).toHaveBeenCalledOnce()
  })

  it('shares a single retry token between preflight and writer', async () => {
    vi.useFakeTimers()
    const retryBudget = createContextualSurveyRetryBudget()
    context.supabase.rpc.mockResolvedValueOnce(busy).mockResolvedValueOnce(memberDetail).mockResolvedValueOnce(busy)
    const pending = readContextualSurveyDetail({ ...context, retryBudget })
    await vi.runAllTimersAsync()
    const detail = await pending
    await expect(respondToContextualSurvey({ ...context, retryBudget, detail: { survey: detail.survey, questions: detail.questions as SurveyQuestion[] }, responses: { [questionId]: 'Fine' } })).rejects.toMatchObject({ statusCode: 409 })
    expect(context.supabase.rpc.mock.calls.map(call => call[0])).toEqual(['get_survey_for_member_v1', 'get_survey_for_member_v1', 'respond_to_survey_for_member_v1'])
  })

  it('preserves exact question values and the same normalized answer objects on writer retry', async () => {
    vi.useFakeTimers()
    const questions = [
      { ...question, created_at: '2026-10-12T01:02:03.123456-04:00', updated_at: '2026-10-12T05:02:03.654321+00:00', artifact_id: null, source_artifact_id: null, source_blueprint_version_id: null, blueprint_archived_at: null, provenance: { version: 7, nested: ['raw', null] } },
      { ...question, id: memberId, question_type: 'link', created_at: '2026-10-12T01:02:03.000001-04:00', position: 0 },
      { ...question, id: classroomId, question_type: 'multiple_choice', options: ['One', 'Two'], position: 1 },
    ]
    context.supabase.rpc.mockResolvedValueOnce({ ...memberDetail, data: { ...memberDetail.data, questions } })
      .mockResolvedValueOnce(busy).mockResolvedValueOnce({ data: { success: true, updated: false }, error: null })
    const retryBudget = createContextualSurveyRetryBudget()
    const detail = await readContextualSurveyDetail({ ...context, retryBudget })
    const pending = respondToContextualSurvey({ ...context, retryBudget, detail: { survey: detail.survey, questions: detail.questions as SurveyQuestion[] }, responses: { [questionId]: ' Fine ', [memberId]: ' https://example.com/é ', [classroomId]: 1 } })
    await vi.runAllTimersAsync()
    expect(await pending).toEqual({ success: true, updated: false })
    const first = context.supabase.rpc.mock.calls[1][1]
    const retry = context.supabase.rpc.mock.calls[2][1]
    expect(retry).toBe(first)
    expect(retry.p_expected_questions).toBe(first.p_expected_questions)
    expect(retry.p_responses).toBe(first.p_responses)
    expect(JSON.stringify(retry)).toBe(JSON.stringify(first))
    expect(first.p_expected_questions).toEqual(questions)
    expect(first.p_responses).toEqual({ [questionId]: { question_type: 'short_text', response_text: 'Fine' }, [memberId]: { question_type: 'link', response_text: 'https://example.com/%C3%A9', raw_utf16_length: 'https://example.com/é'.length }, [classroomId]: { question_type: 'multiple_choice', selected_option: 1 } })
  })
})

describe('shared Survey admission', () => {
  it('leaves an absent admission installation on its existing role guards', async () => {
    expect(await authorizeSharedSurveyActor()).toEqual({ mode: 'existing' })
    expect(auth.requireAuth).not.toHaveBeenCalled()
  })
  it('admits either historical role and grants no relationship', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    expect(await authorizeSharedSurveyActor()).toMatchObject({ mode: 'shared', user: { id: actorId } })
  })
  it('rejects malformed admission after authentication', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{}')
    await expect(authorizeSharedSurveyActor()).rejects.toMatchObject({ statusCode: 503 })
    expect(auth.requireAuth).toHaveBeenCalledOnce()
  })
  it('retains the existing path for a nonadmitted actor', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [memberId] }))
    expect(await authorizeSharedSurveyActor()).toEqual({ mode: 'existing' })
  })
})

describe('atomic Survey payload decoding', () => {
  it('canonicalizes validated actor IDs without bypassing owner precedence', async () => {
    const uppercase = { ...context, actorId: actorId.toUpperCase(), surveyId: surveyId.toUpperCase() }
    context.supabase.rpc.mockResolvedValue({ data: { survey, classroom: { id: classroomId, teacher_id: actorId, archived_at: null }, questions: [question], responses: [] }, error: null })
    expect(await readContextualSurveyDetail({ ...uppercase, permission: 'owner' })).toMatchObject({ survey: { id: surveyId } })
    await expect(readContextualSurveyDetail(uppercase)).rejects.toMatchObject({ statusCode: 503 })
    expect(context.supabase.rpc).toHaveBeenLastCalledWith('get_survey_for_member_v1', { p_actor_id: actorId, p_survey_id: surveyId })
  })
  it('compares uppercase member identifiers with canonical own-response evidence', async () => {
    context.supabase.rpc.mockResolvedValue({ data: { survey, classroom: { id: classroomId, teacher_id: memberId, archived_at: null }, questions: [question], responses: [{ id: memberId, survey_id: surveyId, question_id: questionId, student_id: actorId, selected_option: null, response_text: 'Fine', submitted_at: time, updated_at: time }] }, error: null })
    expect(await readContextualSurveyDetail({ ...context, actorId: actorId.toUpperCase(), surveyId: surveyId.toUpperCase() })).toMatchObject({ has_submitted: true })
  })
  it('canonicalizes direct mutation-helper bindings before checking committed output', async () => {
    const uppercase = { ...context, actorId: actorId.toUpperCase(), surveyId: surveyId.toUpperCase() }
    context.supabase.rpc.mockResolvedValue({ data: { survey }, error: null })
    expect(await patchContextualSurvey({ ...uppercase, patch: { title: survey.title } })).toEqual({ survey })
    context.supabase.rpc.mockResolvedValue({ data: { question }, error: null })
    expect(await createContextualSurveyQuestion({ ...uppercase, question: { question_type: 'short_text', question_text: 'Thoughts?' } })).toEqual({ question })
    expect(await patchContextualSurveyQuestion({ ...uppercase, questionId: questionId.toUpperCase(), existing: question as SurveyQuestion, question: { position: 1 } })).toEqual({ question })
    expect(context.supabase.rpc).toHaveBeenLastCalledWith('update_survey_question_for_owner_v1', expect.objectContaining({ p_actor_id: actorId, p_survey_id: surveyId, p_question_id: questionId, p_expected_question: question }))
    context.supabase.rpc.mockClear()
    await expect(patchContextualSurveyQuestion({ ...uppercase, questionId: memberId.toUpperCase(), existing: question as SurveyQuestion, question: { position: 1 } })).rejects.toMatchObject({ statusCode: 404 })
    expect(context.supabase.rpc).not.toHaveBeenCalled()
  })
  it('still rejects malformed and genuinely different identifiers', async () => {
    await expect(readContextualSurveyDetail({ ...context, surveyId: 'not-a-uuid' })).rejects.toMatchObject({ statusCode: 400 })
    expect(context.supabase.rpc).not.toHaveBeenCalled()
    context.supabase.rpc.mockResolvedValue({ data: { survey, classroom: { id: classroomId, teacher_id: memberId, archived_at: null }, questions: [question], responses: [] }, error: null })
    await expect(readContextualSurveyDetail({ ...context, surveyId: memberId.toUpperCase() })).rejects.toMatchObject({ statusCode: 503 })
  })
  it('retains owner mutation preflight with the fixed owner RPC and parent', async () => {
    const classroom = { id: classroomId, teacher_id: actorId, archived_at: null }
    context.supabase.rpc.mockResolvedValue({ data: { survey, classroom, questions: [question], responses: [] }, error: null })
    expect(await readContextualSurveyOwnerForMutation(context)).toMatchObject({ classroom, survey: { id: surveyId } })
    expect(context.supabase.rpc).toHaveBeenCalledExactlyOnceWith('get_survey_for_owner_v1', { p_actor_id: actorId, p_survey_id: surveyId })
  })
  it('denies an archived owner mutation before any write', async () => {
    context.supabase.rpc.mockResolvedValue({ data: { survey, classroom: { id: classroomId, teacher_id: actorId, archived_at: time }, questions: [question], responses: [] }, error: null })
    await expect(readContextualSurveyOwnerForMutation(context)).rejects.toMatchObject({ statusCode: 403, message: 'Classroom is archived' })
    expect(context.supabase.rpc).toHaveBeenCalledOnce()
  })
  it.each([undefined, null])('fails closed on missing owner classroom evidence (%s)', async classroom => {
    context.supabase.rpc.mockResolvedValue({ data: { survey, classroom, questions: [question], responses: [] }, error: null })
    await expect(readContextualSurveyOwnerForMutation(context)).rejects.toMatchObject({ statusCode: 503, message: 'Survey operation unavailable' })
    expect(context.supabase.rpc).toHaveBeenCalledOnce()
  })
  it('rejects foreign parent evidence before disclosing questions', async () => {
    context.supabase.rpc.mockResolvedValue({ data: { survey, classroom: { id: memberId, teacher_id: memberId, archived_at: null }, questions: [question], responses: [] }, error: null })
    await expect(readContextualSurveyDetail(context)).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects owner self enrollment on the member transport', async () => {
    context.supabase.rpc.mockResolvedValue({ data: { survey, classroom: { id: classroomId, teacher_id: actorId, archived_at: null }, questions: [question], responses: [] }, error: null })
    await expect(readContextualSurveyDetail(context)).rejects.toMatchObject({ statusCode: 503 })
  })
  it('maps unavailable functions to fail-closed, without a legacy fallback', async () => {
    context.supabase.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'private data' } })
    await expect(readContextualSurveyDetail(context)).rejects.toMatchObject({ statusCode: 503, message: 'Survey operation unavailable' })
  })
  it('rejects a substituted child question', async () => {
    context.supabase.rpc.mockResolvedValue({ data: { survey, classroom: { id: classroomId, teacher_id: memberId, archived_at: null }, questions: [{ ...question, survey_id: memberId }], responses: [] }, error: null })
    await expect(readContextualSurveyDetail(context)).rejects.toMatchObject({ statusCode: 503 })
  })
  it('retains the member detail URL payload and own response map', async () => {
    context.supabase.rpc.mockResolvedValue({ data: { survey, classroom: { id: classroomId, teacher_id: memberId, archived_at: null }, questions: [question], responses: [{ id: memberId, survey_id: surveyId, question_id: questionId, student_id: actorId, selected_option: null, response_text: 'Fine', submitted_at: time, updated_at: time }] }, error: null })
    const result = await readContextualSurveyDetail(context)
    expect(result).toMatchObject({ survey: { id: surveyId }, questions: [question], has_submitted: true,
      student_responses: { [questionId]: { question_type: 'short_text', response_text: 'Fine' } } })
    expect(context.supabase.rpc).toHaveBeenCalledWith('get_survey_for_member_v1', { p_actor_id: actorId, p_survey_id: surveyId })
  })
  it('preserves owner stats and rejects negative counts', async () => {
    context.supabase.rpc.mockResolvedValue({ data: { classroom: { id: classroomId, teacher_id: actorId, archived_at: null }, surveys: [{ ...survey, stats: { total_students: 2, responded: 1, questions_count: 1 } }] }, error: null })
    expect(await readContextualSurveyList({ ...context, classroomId, permission: 'owner' })).toMatchObject({ surveys: [{ stats: { responded: 1 } }] })
    context.supabase.rpc.mockResolvedValue({ data: { classroom: { id: classroomId, teacher_id: actorId, archived_at: null }, surveys: [{ ...survey, stats: { total_students: 2, responded: -1, questions_count: 1 } }] }, error: null })
    await expect(readContextualSurveyList({ ...context, classroomId, permission: 'owner' })).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects classmate identity in member result responses', async () => {
    const payload = { classroom: { id: classroomId, teacher_id: memberId, archived_at: null }, survey: { id: surveyId, title: 'Feedback', status: 'active', show_results: true, dynamic_responses: true }, results: [{ question_id: questionId, question_type: 'short_text', question_text: 'Thoughts?', options: [], counts: [], total_responses: 1, responses: [{ response_id: memberId, response_text: 'Fine', submitted_at: time, updated_at: time }] }] }
    context.supabase.rpc.mockResolvedValue({ data: payload, error: null })
    expect(await readContextualSurveyResults(context)).toMatchObject({ results: payload.results })
    context.supabase.rpc.mockResolvedValue({ data: { ...payload, results: [{ ...payload.results[0], responses: [{ ...payload.results[0].responses[0], student_id: memberId }] }] }, error: null })
    await expect(readContextualSurveyResults(context)).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([
    ['https://a.co', 'https://a.co/'],
    ['https://example.com/é', 'https://example.com/%C3%A9'],
  ])('preserves canonical raw link cap for %s in the contextual adapter', async (raw, serialized) => {
    const link: SurveyQuestion = { ...question, question_type: 'link', response_max_chars: raw.length }
    const canonical = validateSurveyResponses([link], { [questionId]: raw })
    expect(canonical).toEqual({ valid: true, responses: { [questionId]: { question_type: 'link', response_text: serialized } } })
    context.supabase.rpc.mockResolvedValue({ data: { success: true, updated: false }, error: null })
    for (const value of [raw, { question_type: 'link', response_text: ` ${raw} `, raw_utf16_length: 1 }]) {
      expect(await respondToContextualSurvey({ ...context, detail: { survey, questions: [link] }, responses: { [questionId]: value } })).toEqual({ success: true, updated: false })
      expect(context.supabase.rpc).toHaveBeenLastCalledWith('respond_to_survey_for_member_v1', expect.objectContaining({
        p_expected_questions: [link], p_responses: { [questionId]: { question_type: 'link', response_text: serialized, raw_utf16_length: raw.length } },
      }))
    }
    context.supabase.rpc.mockClear()
    const tooLong = { [questionId]: `${raw}a` }
    expect(validateSurveyResponses([link], tooLong).valid).toBe(false)
    await expect(respondToContextualSurvey({ ...context, detail: { survey, questions: [link] }, responses: tooLong })).rejects.toMatchObject({ statusCode: 400 })
    expect(context.supabase.rpc).not.toHaveBeenCalled()
  })
  it('preserves short-text UTF16 overflow rejection before contextual persistence', async () => {
    const short: SurveyQuestion = { ...question, question_type: 'short_text', response_max_chars: 3 }
    const responses = { [questionId]: '😀😀' }
    expect(validateSurveyResponses([short], responses).valid).toBe(false)
    await expect(respondToContextualSurvey({ ...context, detail: { survey, questions: [short] }, responses })).rejects.toMatchObject({ statusCode: 400 })
    expect(context.supabase.rpc).not.toHaveBeenCalled()
  })
  it('validates answers against the atomic detail and binds its expected questions', async () => {
    const detail = { survey, questions: [question], has_submitted: false, student_responses: {}, student_status: 'can_view_results' as const }
    context.supabase.rpc.mockResolvedValue({ data: { success: true, updated: false }, error: null })
    expect(await respondToContextualSurvey({ ...context, detail, responses: { [questionId]: ' Fine ' } })).toEqual({ success: true, updated: false })
    expect(context.supabase.rpc).toHaveBeenCalledWith('respond_to_survey_for_member_v1', expect.objectContaining({ p_actor_id: actorId, p_survey_id: surveyId,
      p_expected_questions: [question], p_responses: { [questionId]: { question_type: 'short_text', response_text: 'Fine' } } }))
  })
  it('does not send foreign or incomplete answers to persistence', async () => {
    await expect(respondToContextualSurvey({ ...context, detail: { survey, questions: [question] } as never, responses: {} })).rejects.toMatchObject({ statusCode: 400 })
    expect(context.supabase.rpc).not.toHaveBeenCalled()
  })
})
