import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authorizeSharedSurveyActor, readContextualSurveyDetail, readContextualSurveyList,
  readContextualSurveyResults, respondToContextualSurvey,
} from '@/lib/server/contextual-surveys'

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
    context.supabase.rpc.mockResolvedValue({ data: { survey: { id: surveyId, title: 'Feedback', status: 'active', show_results: true, dynamic_responses: true }, results: [{ question_id: questionId, question_type: 'short_text', question_text: 'Thoughts?', options: [], counts: [], total_responses: 1, responses: [{ response_id: memberId, response_text: 'Fine', submitted_at: time, updated_at: time, student_id: memberId }] }] }, error: null })
    await expect(readContextualSurveyResults(context)).rejects.toMatchObject({ statusCode: 503 })
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
