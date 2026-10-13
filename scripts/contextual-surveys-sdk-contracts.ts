/** Inert source-only native acceptance companion. Root supplies its existing
 * disposable-target guard and real installed Supabase SDK client after freeze. */
import assert from 'node:assert/strict'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'
import { contextualSurveyDetailSchema, contextualSurveyListSchema, contextualSurveyMemberResultsSchema, contextualSurveyMutationSchema, contextualSurveyOwnerResultsSchema, contextualSurveyQuestionMutationSchema, contextualSurveyRespondSchema } from '../src/lib/validations/contextual-surveys'

export type SurveySdkFixture = Readonly<{ ownerId: string; memberId: string; outsiderId: string; classroomId: string; surveyId: string }>

/** Requires an active synthetic Survey with exactly one short-text question.
 * Source does not create fixtures, read credentials, select targets or run on import. */
export async function runContextualSurveysSdkContracts(client: SupabaseClient<Database>, fixture: SurveySdkFixture, guard: () => Promise<void>) {
  const { ownerId, memberId, outsiderId, classroomId, surveyId } = fixture
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  let requests = 0
  async function before() { assert(++requests <= 16, 'Survey SDK request limit'); assert(!controller.signal.aborted); await guard(); assert(!controller.signal.aborted) }
  try {
    await before()
    const owner = await client.rpc('get_survey_for_owner_v1', { p_actor_id: ownerId, p_survey_id: surveyId }).abortSignal(controller.signal)
    assert.equal(owner.error, null, 'Survey owner SDK read failed')
    const detail = contextualSurveyDetailSchema.parse(owner.data)
    assert.equal(detail.classroom.teacher_id, ownerId)
    assert.equal(detail.survey.classroom_id, classroomId)
    assert.equal(detail.questions.length, 1)
    assert.equal(detail.questions[0].question_type, 'short_text')

    await before()
    const ownerList = await client.rpc('get_surveys_for_owner_v1', { p_actor_id: ownerId, p_classroom_id: classroomId }).abortSignal(controller.signal)
    assert.equal(ownerList.error, null, 'Survey owner list SDK failed')
    assert(contextualSurveyListSchema.parse(ownerList.data).surveys.some(s => s.id === surveyId))
    await before()
    const denied = await client.rpc('get_survey_for_member_v1', { p_actor_id: ownerId, p_survey_id: surveyId }).abortSignal(controller.signal)
    assert.equal(denied.error?.code, 'PT403', 'Survey owner precedence SDK failed')
    await before()
    const outsider = await client.rpc('get_survey_for_member_v1', { p_actor_id: outsiderId, p_survey_id: surveyId }).abortSignal(controller.signal)
    assert.equal(outsider.error?.code, 'PT403', 'Survey outsider SDK denial failed')

    await before()
    const member = await client.rpc('get_survey_for_member_v1', { p_actor_id: memberId, p_survey_id: surveyId }).abortSignal(controller.signal)
    assert.equal(member.error, null, 'Survey member SDK read failed')
    const memberDetail = contextualSurveyDetailSchema.parse(member.data)
    assert.equal(memberDetail.responses.length, 0)
    await before()
    const memberList = await client.rpc('get_surveys_for_member_v1', { p_actor_id: memberId, p_classroom_id: classroomId }).abortSignal(controller.signal)
    assert.equal(memberList.error, null, 'Survey member list SDK failed')
    assert(contextualSurveyListSchema.parse(memberList.data).surveys.some(s => s.id === surveyId))

    await before()
    const respond = await client.rpc('respond_to_survey_for_member_v1', { p_actor_id: memberId, p_survey_id: surveyId, p_classroom_id: classroomId,
      p_expected_questions: z.json().parse(memberDetail.questions), p_responses: { [detail.questions[0].id]: { question_type: 'short_text', response_text: 'SDK response' } } }).abortSignal(controller.signal)
    assert.equal(respond.error, null, 'Survey response SDK failed')
    assert.deepEqual(contextualSurveyRespondSchema.parse(respond.data), { success: true, updated: false })
    await before()
    const results = await client.rpc('get_survey_results_for_member_v1', { p_actor_id: memberId, p_survey_id: surveyId }).abortSignal(controller.signal)
    assert.equal(results.error, null, 'Survey results SDK failed')
    const decoded = contextualSurveyMemberResultsSchema.parse(results.data)
    assert.equal(decoded.results[0].responses[0].response_text, 'SDK response')
    assert(!('student_id' in decoded.results[0].responses[0]))
    await before()
    const ownerResults = await client.rpc('get_survey_results_for_owner_v1', { p_actor_id: ownerId, p_survey_id: surveyId }).abortSignal(controller.signal)
    assert.equal(ownerResults.error, null, 'Survey owner results SDK failed')
    assert.equal(contextualSurveyOwnerResultsSchema.parse(ownerResults.data).stats.responded, 1)

    await before()
    const updated = await client.rpc('update_survey_for_owner_v1', { p_actor_id: ownerId, p_survey_id: surveyId, p_patch: { title: 'SDK renamed' } }).abortSignal(controller.signal)
    assert.equal(updated.error, null, 'Survey owner metadata SDK failed')
    assert.equal(contextualSurveyMutationSchema.parse(updated.data).survey.title, 'SDK renamed')
    await before()
    const created = await client.rpc('create_survey_question_for_owner_v1', { p_actor_id: ownerId, p_survey_id: surveyId,
      p_question: { question_type: 'short_text', question_text: 'Added?', options: [], response_max_chars: 500 } }).abortSignal(controller.signal)
    assert.equal(created.error, null, 'Survey question create SDK failed')
    const newQuestion = contextualSurveyQuestionMutationSchema.parse(created.data).question
    await before()
    const patched = await client.rpc('update_survey_question_for_owner_v1', { p_actor_id: ownerId, p_survey_id: surveyId,
      p_question_id: newQuestion.id, p_expected_question: z.json().parse(newQuestion),
      p_question: { question_type: 'link', question_text: 'URL?', options: [], response_max_chars: 2048, position: newQuestion.position } }).abortSignal(controller.signal)
    assert.equal(patched.error, null, 'Survey question update SDK failed')
    assert.equal(contextualSurveyQuestionMutationSchema.parse(patched.data).question.question_type, 'link')
    await before()
    const deleted = await client.rpc('delete_survey_question_for_owner_v1', { p_actor_id: ownerId, p_survey_id: surveyId, p_question_id: newQuestion.id }).abortSignal(controller.signal)
    assert.equal(deleted.error, null, 'Survey question delete SDK failed')
    await before()
    const surveyDeleted = await client.rpc('delete_survey_for_owner_v1', { p_actor_id: ownerId, p_survey_id: surveyId }).abortSignal(controller.signal)
    assert.equal(surveyDeleted.error, null, 'Survey cascade delete SDK failed')
    return Object.freeze({ requests, cases: 14, nativeVerified: true as const })
  } finally { clearTimeout(timeout) }
}
