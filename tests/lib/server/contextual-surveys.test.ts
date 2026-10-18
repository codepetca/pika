import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authorizeSharedSurveyActor, readContextualSurveyDetail, readContextualSurveyList,
  readContextualSurveyResults, readContextualSurveyOwnerForMutation, respondToContextualSurvey,
  createContextualSurveyQuestion, patchContextualSurvey, patchContextualSurveyQuestion,
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

beforeEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); auth.requireAuth.mockResolvedValue({ id: actorId, role: 'teacher' }) })

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
