/** Fixed Survey app evidence checks. No native access or execution at import. */
import assert from 'node:assert/strict'
import { types } from 'node:util'
import { createContextualTestPlan, contextualTestWitnessSql, type RehearsalPlan, type RehearsalWitness } from '../e2e/helpers/contextual-test-rehearsal'
import { assertSurveyResults, assertSurveySubmissionPreserved, surveyActors, surveyExchangeLabels, surveyPrompt, surveyScreens,
  surveyScope, surveyText, surveyTitles, type SurveyWorkflowResult, type SurveyExchange } from '../e2e/helpers/contextual-survey-contract'
import { data, denseArray } from './contextual-test-vertical-proof'
import type { ContextualTestRunBinding } from './contextual-test-rehearsal-binding'
export type { SurveyWorkflowResult } from '../e2e/helpers/contextual-survey-contract'
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/, hex = /^[a-f0-9]{64}$/
function plain(value: unknown, depth = 0, budget = { nodes: 0 }): unknown {
  assert(depth < 32 && ++budget.nodes <= 30000)
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') { assert(Number.isFinite(value)); return value }
  if (typeof value === 'string') { assert(value.length <= 16384); return value }
  assert(value && typeof value === 'object' && !types.isProxy(value))
  if (Array.isArray(value)) {
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value
    assert(Number.isSafeInteger(length) && length <= 1000)
    return denseArray(value, length).map(item => plain(item, depth + 1, budget))
  }
  return Object.fromEntries(Object.entries(data(value)).map(([key, child]) => [key, plain(child, depth + 1, budget)]))
}
function timestamp(value: unknown, startedAt?: number, deadline?: number): number {
  assert(typeof value === 'string' && Number.isFinite(Date.parse(value)))
  const time = Date.parse(value)
  if (startedAt !== undefined) assert(time >= startedAt)
  if (deadline !== undefined) assert(time < deadline)
  return time
}
type Binding = Pick<ContextualTestRunBinding, 'projectId' | 'startedAt' | 'deadline' | 'proofScope'>
export function validateSurveyResult(raw: unknown, binding: Pick<Binding, 'projectId'>): SurveyWorkflowResult {
  const value = plain(raw) as SurveyWorkflowResult
  data(value, ['surveys', 'deleted', 'submissions', 'archive', 'denials', 'exchanges'])
  const p = createContextualTestPlan(binding.projectId, surveyScope)
  const mains = denseArray(value.surveys, 2) as SurveyWorkflowResult['surveys'], scraps = denseArray(value.deleted, 2) as SurveyWorkflowResult['deleted']
  const allIds: string[] = [], questionIds: string[] = []
  for (const [i, survey] of mains.entries()) {
    data(survey, ['surveyId', 'classroomId', 'ownerId', 'title', 'questionIds'])
    assert.equal(survey.classroomId, i === 0 ? p.classrooms.classA.id : p.classrooms.classB.id)
    assert.equal(survey.ownerId, i === 0 ? p.actors.ownerTeacher.id : p.actors.ownerStudent.id)
    assert.equal(survey.title, surveyTitles[i]); allIds.push(survey.surveyId)
    questionIds.push(...denseArray(survey.questionIds, 2) as string[])
  }
  for (const [i, scratch] of scraps.entries()) {
    data(scratch, ['surveyId', 'classroomId', 'questionIds']); allIds.push(scratch.surveyId)
    assert.equal(scratch.classroomId, mains[i].classroomId); questionIds.push(...denseArray(scratch.questionIds, 2) as string[])
  }
  assert(allIds.every(id => uuid.test(id)) && new Set(allIds).size === 4 && !allIds.some(id => p.retiredTestIds.includes(id)))
  assert(questionIds.every(id => uuid.test(id)) && new Set(questionIds).size === 8 && !questionIds.some(id => allIds.includes(id)))
  const actors = ['memberStudent', 'ownerStudent', 'memberTeacher', 'ownerTeacher'] as const
  const submissions = denseArray(value.submissions, 4) as SurveyWorkflowResult['submissions']
  for (const [i, submission] of submissions.entries()) {
    data(submission, ['surveyId', 'actor', 'studentId', 'initial', 'final'])
    assert(submission.actor === actors[i] && submission.studentId === p.actors[actors[i]].id && submission.surveyId === mains[i < 2 ? 0 : 1].surveyId)
    for (const row of [submission.initial, submission.final]) {
      data(row, ['response_id', 'response_text', 'submitted_at', 'updated_at']); assert(uuid.test(row.response_id))
      timestamp(row.submitted_at); timestamp(row.updated_at)
    }
    assertSurveySubmissionPreserved(submission.initial, submission.final, submission.actor, i === 0)
  }
  assert.equal(new Set(submissions.map(row => row.final.response_id)).size, 4)
  data(value.denials, ['before', 'after'])
  for (const snapshots of [value.denials.before, value.denials.after]) {
    denseArray(snapshots, 2)
    snapshots.forEach((snapshot, i) => { assertSurveyResults(snapshot, mains[i]); assert.equal(snapshot.stats!.responded, 2) })
  }
  assert.deepEqual(value.denials.after, value.denials.before)
  data(value.archive, ['before', 'after']); assert.deepEqual(value.archive.after, value.archive.before)
  assertSurveyResults(value.archive.before, mains[1]); assert.equal(value.archive.before.stats!.responded, 2)
  const exchanges = denseArray(value.exchanges, surveyExchangeLabels.length) as SurveyExchange[]
  const byLabel = new Map<string, SurveyExchange>()
  for (const [i, event] of exchanges.entries()) {
    data(event, ['label', 'actor', 'via', 'method', 'path', 'status', 'request', 'response'])
    assert.equal(event.label, surveyExchangeLabels[i]); assert(['screen', 'permission-fixture', 'denied-probe'].includes(event.via))
    assert(['GET', 'POST', 'PATCH', 'DELETE'].includes(event.method)); assert(event.path.startsWith('/api/'))
    assert(Object.hasOwn(p.actors, event.actor)); assert(Number.isSafeInteger(event.status))
    byLabel.set(event.label, event)
  }
  const at = (label: string, actor: string, via: SurveyExchange['via'], method: SurveyExchange['method'], path: string, status: number, request: unknown) => {
    const event = byLabel.get(label)!; assert(event)
    assert(event.actor === actor && event.via === via && event.method === method && event.path === path && event.status === status)
    if (request !== undefined) assert.deepEqual(event.request, request)
    const response = data(event.response)
    if (status >= 400) { data(event.response, ['error']); assert(typeof response.error === 'string' && response.error.length > 0) }
    return response
  }
  const a = mains[0], b = mains[1], owner = '/api/teacher/surveys/', member = '/api/student/surveys/'
  for (const [i, letter] of ['A', 'B'].entries()) {
    const actor = i === 0 ? 'ownerTeacher' : 'ownerStudent', main = mains[i], scratch = scraps[i]
    for (const [prefix, identity] of [['', main], ['scratch-', scratch]] as const) {
      const created = at(`create-${prefix}${letter}`, actor, 'screen', 'POST', '/api/teacher/surveys', 201, undefined)
      const request = data(byLabel.get(`create-${prefix}${letter}`)!.request, ['classroom_id', 'title', 'show_results', 'dynamic_responses'])
      assert(request.classroom_id === main.classroomId && typeof request.title === 'string' && request.title.trim().length > 0 && request.show_results === true && request.dynamic_responses === false)
      const row = data(created.survey)
      assert(row.id === identity.surveyId && row.classroom_id === main.classroomId && row.created_by === main.ownerId && row.status === 'draft')
      const publication = at(`publish-${prefix}${letter}`, actor, 'screen', 'PATCH', owner + identity.surveyId, 200, { status: 'active' })
      const published = data(publication.survey)
      assert(published.id === identity.surveyId && published.classroom_id === main.classroomId && published.created_by === main.ownerId && published.status === 'active')
    }
    assert.equal(at(`delete-question-${letter}`, actor, 'screen', 'DELETE', `${owner}${scratch.surveyId}/questions/${scratch.questionIds[0]}`, 200, null).success, true)
    assert.equal(at(`delete-scratch-${letter}`, actor, 'screen', 'DELETE', owner + scratch.surveyId, 200, null).success, true)
  }
  const answer = (identity: typeof a, actor: typeof actors[number], updated = false) => ({ responses: {
    [identity.questionIds[0]]: { question_type: 'multiple_choice', selected_option: 1 },
    [identity.questionIds[1]]: { question_type: 'short_text', response_text: surveyText(actor, updated) },
  } })
  for (const [label, actor, identity, updated] of [['cross-ownerTeacher', 'ownerTeacher', b, false], ['cross-ownerStudent', 'ownerStudent', a, false],
    ['submit-memberStudent', 'memberStudent', a, false], ['submit-memberTeacher', 'memberTeacher', b, false], ['dynamic-update', 'memberStudent', a, true]] as const) {
    const response = at(label, actor, 'screen', 'POST', `${member}${identity.surveyId}/respond`, updated ? 200 : 201, answer(identity, actor, updated))
    assert(response.success === true && response.updated === updated)
  }
  for (const [i, letter] of ['A', 'B'].entries()) {
    const scratch = scraps[i], actor = i === 0 ? 'ownerStudent' : 'ownerTeacher'
    const response = at(`scratch-submit-${letter}`, actor, 'screen', 'POST', `${member}${scratch.surveyId}/respond`, 201, { responses: {
      [scratch.questionIds[0]]: { question_type: 'link', response_text: 'https://example.invalid/learning' },
      [scratch.questionIds[1]]: { question_type: 'short_text', response_text: surveyText(actor) },
    } }); assert(response.success === true && response.updated === false)
  }
  at('static-duplicate', 'memberStudent', 'denied-probe', 'POST', `${member}${a.surveyId}/respond`, 400, answer(a, 'memberStudent'))
  at('self-owner', 'ownerTeacher', 'denied-probe', 'GET', member + a.surveyId, 403, null)
  at('foreign-owner', 'ownerTeacher', 'denied-probe', 'PATCH', owner + b.surveyId, 403, { title: 'Forbidden foreign edit' })
  at('foreign-question', 'ownerTeacher', 'denied-probe', 'PATCH', `${owner}${a.surveyId}/questions/${b.questionIds[0]}`, 404, { question_text: 'Forbidden foreign question' })
  at('foreign-class', 'ownerTeacher', 'denied-probe', 'GET', `/api/teacher/surveys?classroom_id=${b.classroomId}`, 403, null)
  at('member-owner', 'memberTeacher', 'denied-probe', 'GET', `${owner}${b.surveyId}/results`, 403, null)
  for (const [label, suffix] of [['nonmember-detail', ''], ['nonmember-results', '/results']] as const) at(label, 'nonmember', 'denied-probe', 'GET', member + a.surveyId + suffix, 403, null)
  for (const [label, patch] of [['dynamic-enabled', { dynamic_responses: true }], ['hide-results', { show_results: false }], ['show-results', { show_results: true }], ['close', { status: 'closed' }], ['reopen', { status: 'active' }]] as const) {
    const response = at(label, 'ownerTeacher', 'screen', 'PATCH', owner + a.surveyId, 200, patch), row = data(response.survey)
    assert(row.id === a.surveyId && row.classroom_id === a.classroomId && row.created_by === a.ownerId)
    for (const [key, val] of Object.entries(patch)) assert.deepEqual(row[key], val)
  }
  at('hidden-results', 'memberStudent', 'denied-probe', 'GET', `${member}${a.surveyId}/results`, 403, null)
  at('future-opening', 'ownerTeacher', 'permission-fixture', 'PATCH', owner + a.surveyId, 200, { opens_at: '2099-01-01T00:00:00.000Z' })
  at('restore-opening', 'ownerTeacher', 'permission-fixture', 'PATCH', owner + a.surveyId, 200, { opens_at: null })
  for (const label of ['future-response', 'closed-response']) at(label, 'memberStudent', 'denied-probe', 'POST', `${member}${a.surveyId}/respond`, 400, answer(a, 'memberStudent', true))
  for (const [label, archived] of [['archive', true], ['unarchive', false]] as const) {
    const response = at(label, 'ownerStudent', 'permission-fixture', 'PATCH', `/api/teacher/classrooms/${b.classroomId}`, 200, { archived }), row = data(response.classroom)
    assert(row.id === b.classroomId); if (archived) timestamp(row.archived_at); else assert.equal(row.archived_at, null)
  }
  const inspected = at('archived-owner-read', 'ownerStudent', 'permission-fixture', 'GET', owner + b.surveyId, 200, null)
  assert(data(inspected.survey).id === b.surveyId && data(inspected.survey).created_by === b.ownerId)
  at('archived-owner-write', 'ownerStudent', 'denied-probe', 'PATCH', owner + b.surveyId, 403, { title: 'Forbidden archive edit' })
  for (const [prefix, identity, actor] of [['archived', b, 'memberTeacher'], ['revoked', a, 'memberStudent']] as const) {
    for (const flavor of ['cached', 'fresh']) {
      at(`${prefix}-${flavor}-detail`, actor, 'denied-probe', 'GET', member + identity.surveyId, 403, null)
      at(`${prefix}-${flavor}-response`, actor, 'denied-probe', 'POST', `${member}${identity.surveyId}/respond`, 403, answer(identity, actor, prefix === 'revoked'))
    }
    at(`${prefix}-cached-results`, actor, 'denied-probe', 'GET', `${member}${identity.surveyId}/results`, 403, null)
  }
  assert(p.lifecycleRoster)
  const removed = at('remove-member', 'ownerTeacher', 'permission-fixture', 'POST', `/api/teacher/classrooms/${a.classroomId}/roster/remove`, 200, { roster_ids: [p.lifecycleRoster.id] })
  assert(removed.success === true && removed.requested_count === 1 && removed.removed_count === 1)
  return value
}

export function validateContextualSurveyReceipt(raw: unknown, binding: ContextualTestRunBinding) {
  try {
    const bound = data(binding); assert(bound.proofScope === surveyScope && !Object.hasOwn(bound, 'sqlControl'))
    const p = createContextualTestPlan(binding.projectId, surveyScope)
    for (const key of ['sourceSha', 'sourceTree', 'migrationChainSha256', 'appOverlaySha256'] as const) assert.equal(binding[key], p[key])
    const receipt = data(raw, ['version', 'proofScope', 'projectId', 'nonce', 'sourceSha', 'sourceTree', 'appOverlaySha256', 'deadline', 'endedAt', 'outcome', 'contextsClosed', 'pageErrors', 'actors', 'result', 'failureStage', 'artifacts'])
    for (const key of ['projectId', 'nonce', 'sourceSha', 'sourceTree', 'appOverlaySha256', 'deadline'] as const) assert.equal(receipt[key], binding[key])
    assert(receipt.version === 1 && receipt.proofScope === surveyScope && receipt.outcome === 'passed' && receipt.contextsClosed === true && receipt.pageErrors === 0 && receipt.failureStage === null)
    assert(typeof binding.nonce === 'string' && /^[a-f0-9]{32}$/.test(binding.nonce) && binding.nonce.endsWith(p.projectId.slice(-12)))
    assert(Number.isSafeInteger(binding.startedAt) && Number.isSafeInteger(binding.deadline) && Number.isSafeInteger(receipt.endedAt)
      && binding.startedAt <= Number(receipt.endedAt) && Number(receipt.endedAt) < binding.deadline)
    assert.deepEqual(denseArray(receipt.actors, surveyActors.length), [...surveyActors])
    const result = validateSurveyResult(receipt.result, binding)
    for (const submission of result.submissions) for (const row of [submission.initial, submission.final]) {
      timestamp(row.submitted_at, binding.startedAt, Number(receipt.endedAt) + 1); timestamp(row.updated_at, binding.startedAt, Number(receipt.endedAt) + 1)
    }
    const artifacts = denseArray(receipt.artifacts, 16).map((value, i) => {
      const artifact = data(value, ['label', 'kind', 'bytes', 'sha256', 'actor', 'viewport', 'theme']), scene = surveyScreens[i]
      for (const key of ['label', 'actor', 'viewport', 'theme'] as const) assert.equal(artifact[key], scene[key])
      assert(artifact.kind === 'png' && Number.isSafeInteger(artifact.bytes) && Number(artifact.bytes) > 0 && Number(artifact.bytes) <= 4194304 && typeof artifact.sha256 === 'string' && hex.test(artifact.sha256))
      return { ...artifact }
    })
    return { ...receipt, result, artifacts }
  } catch { throw Error('Survey receipt rejected') }
}

type FullRows = Record<string, unknown>[]
export type SurveyWitness = RehearsalWitness & { survey: { surveys: FullRows; questions: FullRows; responses: FullRows;
  revisions: FullRows; roster: FullRows; bindings: FullRows; enrollments: FullRows } }
export function contextualSurveyWitnessSql(plan: RehearsalPlan): string {
  assert.deepEqual(plan, createContextualTestPlan(plan.projectId, surveyScope)); assert(plan.lifecycleRoster)
  const ids = Object.values(plan.classrooms).map(classroom => { assert(uuid.test(classroom.id)); return `'${classroom.id}'` }).join(',')
  const aggregate = (table: string, condition: string, order = 'id') => `coalesce((select jsonb_agg(to_jsonb(row) order by ${order}) from public.${table} row where ${condition}),'[]'::jsonb)`
  // This function is admitted only on the owned empty disposable schema. Read
  // the complete Survey family so orphan/foreign-parent/deleted-scratch residue
  // cannot disappear merely because its parent no longer appears in the list.
  const projection = `'survey',jsonb_build_object(
'surveys',${aggregate('surveys', 'true')},
'questions',${aggregate('survey_questions', 'true')},
'responses',${aggregate('survey_responses', 'true')},
'revisions',${aggregate('classroom_archive_revisions', `classroom_id in (${ids})`, 'classroom_id')},
'roster',${aggregate('classroom_roster', `classroom_id in (${ids})`)},
'bindings',${aggregate('classroom_roster_student_bindings', `classroom_id in (${ids})`, 'roster_id')},
'enrollments',${aggregate('classroom_enrollments', `classroom_id in (${ids})`)}),`
  const base = contextualTestWitnessSql(plan), marker = "'version',1,'work_graph_sha256'"
  assert.equal(base.split(marker).length, 2)
  return base.replace(marker, `'version',1,${projection}'work_graph_sha256'`)
}
export function assertContextualSurveyDatabase(beforeRaw: SurveyWitness, afterRaw: SurveyWitness, rawResult: SurveyWorkflowResult, binding: Binding): void {
  try {
    assert.equal(binding.proofScope, surveyScope)
    assert(Number.isSafeInteger(binding.startedAt) && Number.isSafeInteger(binding.deadline) && binding.startedAt < binding.deadline)
    const result = validateSurveyResult(rawResult, binding), p = createContextualTestPlan(binding.projectId, surveyScope)
    const before = plain(beforeRaw) as SurveyWitness, after = plain(afterRaw) as SurveyWitness
    const keys = ['version', 'work_graph_sha256', 'tests', 'attempts', 'memberships', 'generations', 'question_counts', 'classes', 'response_count', 'history_count', 'objects', 'survey']
    data(before, keys); data(after, keys)
    assert(before.version === 1 && after.version === 1 && hex.test(before.work_graph_sha256) && before.work_graph_sha256 === after.work_graph_sha256)
    for (const key of ['tests', 'attempts', 'question_counts', 'response_count', 'history_count', 'objects'] as const) assert.deepEqual(after[key], before[key])
    assert.deepEqual(before.tests.map(row => row.id).sort(), [...p.retiredTestIds].sort())
    assert(before.attempts.length === 0 && before.question_counts.length === 0 && before.response_count === 0 && before.history_count === 0 && before.objects.length === 0)
    for (const graph of [before.survey, after.survey]) data(graph, ['surveys', 'questions', 'responses', 'revisions', 'roster', 'bindings', 'enrollments'])
    assert(before.survey.surveys.length === 0 && before.survey.questions.length === 0 && before.survey.responses.length === 0)
    assert(after.survey.surveys.length === 2 && after.survey.questions.length === 4 && after.survey.responses.length === 8)
    assert.equal(new Set(after.survey.responses.map(row => row.id)).size, 8)
    assert.equal(new Set(after.survey.responses.map(row => `${row.question_id}/${row.student_id}`)).size, 8)
    for (const [i, identity] of result.surveys.entries()) {
      const rows = after.survey.surveys.filter(row => row.id === identity.surveyId); assert.equal(rows.length, 1)
      const survey = rows[0]
      data(survey, ['artifact_id', 'blueprint_archived_at', 'classroom_id', 'created_at', 'created_by', 'dynamic_responses', 'id', 'opens_at', 'position', 'show_results', 'source_artifact_id', 'source_blueprint_version_id', 'status', 'title', 'updated_at'])
      assert(survey.classroom_id === identity.classroomId && survey.created_by === identity.ownerId && survey.title === identity.title && survey.status === 'active'
        && survey.show_results === true && survey.dynamic_responses === (i === 0) && uuid.test(String(survey.artifact_id)) && survey.blueprint_archived_at === null
        && survey.source_artifact_id === null && survey.source_blueprint_version_id === null && Number.isSafeInteger(survey.position) && Number(survey.position) >= 0)
      timestamp(survey.opens_at, binding.startedAt, binding.deadline)
      timestamp(survey.created_at, binding.startedAt, binding.deadline); timestamp(survey.updated_at, binding.startedAt, binding.deadline)
      const qs = after.survey.questions.filter(q => q.survey_id === identity.surveyId).sort((a, b) => Number(a.position) - Number(b.position))
      assert.deepEqual(qs.map(q => q.id), identity.questionIds)
      for (const [qi, question] of qs.entries()) {
        data(question, ['artifact_id', 'created_at', 'id', 'options', 'position', 'question_text', 'question_type', 'response_max_chars', 'source_artifact_id', 'source_blueprint_version_id', 'survey_id', 'updated_at'])
        assert(question.question_type === (qi === 0 ? 'multiple_choice' : 'short_text') && question.question_text === (qi === 0 ? surveyPrompt.mc : surveyPrompt.text)
          && question.position === qi && question.response_max_chars === 500 && uuid.test(String(question.artifact_id)) && question.source_artifact_id === null && question.source_blueprint_version_id === null)
        assert.deepEqual(question.options, qi === 0 ? ['Alpha', 'Beta'] : [])
        timestamp(question.created_at, binding.startedAt, binding.deadline); timestamp(question.updated_at, binding.startedAt, binding.deadline)
      }
      const members = result.submissions.filter(row => row.surveyId === identity.surveyId)
      assert.equal(members.length, 2)
      const responses = after.survey.responses.filter(row => row.survey_id === identity.surveyId); assert.equal(responses.length, 4)
      for (const submission of members) for (const [qi, qid] of identity.questionIds.entries()) {
        const rs = responses.filter(row => row.student_id === submission.studentId && row.question_id === qid); assert.equal(rs.length, 1)
        const row = rs[0]
        data(row, ['id', 'question_id', 'response_text', 'selected_option', 'student_id', 'submitted_at', 'survey_id', 'updated_at'])
        assert(uuid.test(String(row.id)) && row.selected_option === (qi === 0 ? 1 : null) && row.response_text === (qi === 0 ? null : submission.final.response_text))
        assert.equal(row.submitted_at, submission.final.submitted_at); assert.equal(row.updated_at, submission.final.updated_at)
        if (qi === 1) assert.equal(row.id, submission.final.response_id)
        timestamp(row.submitted_at, binding.startedAt, binding.deadline); timestamp(row.updated_at, binding.startedAt, binding.deadline)
      }
    }
    const expectedPairs = [p.classrooms.classA.id, p.classrooms.classB.id].flatMap(classroomId =>
      ['ownerTeacher', 'ownerStudent', 'memberStudent', 'memberTeacher'].map(actor => `${classroomId}/${p.actors[actor as keyof typeof p.actors].id}`)).sort()
    assert.deepEqual(before.memberships.map(row => `${row.classroom_id}/${row.student_id}`).sort(), expectedPairs)
    assert.equal(new Set(before.memberships.map(row => row.generation_id)).size, 8)
    assert(before.memberships.every(row => uuid.test(row.generation_id) && row.ledger_state === 'active'))
    assert.deepEqual(before.generations.map(row => row.generation_id).sort(), before.memberships.map(row => row.generation_id).sort())
    assert(before.generations.every(row => row.state === 'active'))
    const removed = before.memberships.filter(row => row.classroom_id === p.classrooms.classA.id && row.student_id === p.actors.memberStudent.id)
    assert.equal(removed.length, 1); const membership = removed[0]
    assert.deepEqual(after.memberships, before.memberships.filter(row => row !== membership))
    assert.deepEqual(after.generations, before.generations.map(row => row.generation_id === membership.generation_id ? { ...row, state: 'removed' } : row))
    const enrollment = before.survey.enrollments.filter(row => row.id === membership.generation_id); assert.equal(enrollment.length, 1)
    assert.deepEqual(after.survey.enrollments, before.survey.enrollments.filter(row => row.id !== membership.generation_id))
    assert.deepEqual(after.survey.bindings, before.survey.bindings)
    assert.equal(before.survey.roster.length, 1); assert.equal(after.survey.roster.length, 1)
    const oldRoster = before.survey.roster[0], roster = after.survey.roster[0]
    assert(roster.id === p.lifecycleRoster!.id && roster.classroom_id === p.classrooms.classA.id && roster.removed_student_id === p.actors.memberStudent.id
      && roster.removed_enrollment_id === membership.generation_id && roster.removed_enrolled_at === enrollment[0].created_at)
    timestamp(roster.removed_at, binding.startedAt, binding.deadline)
    const changed = new Set(['removed_at', 'removed_student_id', 'removed_enrollment_id', 'removed_enrolled_at', 'retained_manual_attendance_marks', 'retained_attendance_participant_active', 'updated_at'])
    assert.deepEqual(Object.keys(roster).sort(), Object.keys(oldRoster).sort())
    for (const [key, value] of Object.entries(oldRoster)) if (!changed.has(key)) assert.deepEqual(roster[key], value)
    assert.deepEqual(roster.retained_manual_attendance_marks, enrollment[0].manual_attendance_marks)
    assert.equal(before.survey.revisions.length, 2); assert.equal(after.survey.revisions.length, 2)
    assert.equal(before.classes.length, 2); assert.equal(after.classes.length, 2)
    const classIds = [p.classrooms.classA.id, p.classrooms.classB.id].sort()
    for (const graph of [before, after]) {
      assert.deepEqual(graph.classes.map(row => row.id).sort(), classIds)
      assert.deepEqual(graph.survey.revisions.map(row => row.classroom_id).sort(), classIds)
    }
    for (const old of before.survey.revisions) {
      const fresh = after.survey.revisions.filter(row => row.classroom_id === old.classroom_id); assert.equal(fresh.length, 1)
      data(old, ['classroom_id', 'revision', 'updated_at']); data(fresh[0], ['classroom_id', 'revision', 'updated_at'])
      assert(Number.isSafeInteger(old.revision) && Number(old.revision) > 0 && Number.isSafeInteger(fresh[0].revision) && Number(fresh[0].revision) > Number(old.revision))
      timestamp(fresh[0].updated_at, binding.startedAt, binding.deadline)
    }
    for (const classroom of after.classes) {
      assert(classroom.archived_at === null && [p.classrooms.classA.id, p.classrooms.classB.id].includes(classroom.id))
      const old = before.classes.find(row => row.id === classroom.id); assert(old && old.archived_at === null)
      assert(timestamp(classroom.updated_at) >= timestamp(old.updated_at))
      if (classroom.id === p.classrooms.classB.id) timestamp(classroom.updated_at, binding.startedAt, binding.deadline)
    }
  } catch { throw Error('Survey database proof rejected') }
}
