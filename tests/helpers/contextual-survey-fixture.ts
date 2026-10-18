/** Synthetic CPU-only positive evidence. Never usable as a native receipt. */
import { createContextualTestPlan } from '../../e2e/helpers/contextual-test-rehearsal'
import { surveyActors, surveyExchangeLabels, surveyPrompt, surveyScreens, surveyScope, surveyText, surveyTitles,
  type SurveyExchange, type SurveyIdentity, type SurveyResults, type SurveyWorkflowResult } from '../../e2e/helpers/contextual-survey-contract'
import type { ContextualTestRunBinding } from '../../scripts/contextual-test-rehearsal-binding'
import type { SurveyWitness } from '../../scripts/contextual-survey-workflow-proof'

const id = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export function contextualSurveyFixture(binding: ContextualTestRunBinding) {
  const p = createContextualTestPlan(binding.projectId, surveyScope)
  const oldTime = new Date(binding.startedAt - 100).toISOString(), initialTime = new Date(binding.startedAt + 100).toISOString(), updatedTime = new Date(binding.startedAt + 200).toISOString()
  const main = [0, 1].map(i => ({ surveyId: id(61 + i), classroomId: i === 0 ? p.classrooms.classA.id : p.classrooms.classB.id,
    ownerId: i === 0 ? p.actors.ownerTeacher.id : p.actors.ownerStudent.id, title: surveyTitles[i], questionIds: [id(71 + i * 2), id(72 + i * 2)] })) as [SurveyIdentity, SurveyIdentity]
  const scraps = [0, 1].map(i => ({ surveyId: id(63 + i), classroomId: main[i].classroomId, questionIds: [id(75 + i * 2), id(76 + i * 2)] as [string, string] }))
  const actors = ['memberStudent', 'ownerStudent', 'memberTeacher', 'ownerTeacher'] as const
  const submissions = actors.map((actor, i) => {
    const initial = { response_id: id(81 + i), response_text: surveyText(actor), submitted_at: initialTime, updated_at: initialTime }
    return { surveyId: main[i < 2 ? 0 : 1].surveyId, actor, studentId: p.actors[actor].id, initial,
      final: i === 0 ? { ...initial, response_text: surveyText(actor, true), updated_at: updatedTime } : { ...initial } }
  })
  const results = (i: number, updated = false): SurveyResults => ({
    survey: { id: main[i].surveyId, title: main[i].title, status: 'active', show_results: true, dynamic_responses: updated },
    questions: main[i].questionIds.map((qid, qi) => ({ id: qid, question_type: qi === 0 ? 'multiple_choice' : 'short_text', question_text: qi === 0 ? surveyPrompt.mc : surveyPrompt.text,
      options: qi === 0 ? ['Alpha', 'Beta'] : [], response_max_chars: 500, position: qi })),
    results: main[i].questionIds.map((qid, qi) => ({ question_id: qid, question_type: qi === 0 ? 'multiple_choice' : 'short_text', question_text: qi === 0 ? surveyPrompt.mc : surveyPrompt.text,
      options: qi === 0 ? ['Alpha', 'Beta'] : [], counts: qi === 0 ? [0, 2] : [], total_responses: 2,
      responses: qi === 0 ? [] : submissions.filter(s => s.surveyId === main[i].surveyId).map(s => ({ ...(updated ? s.final : s.initial), student_id: s.studentId, name: null, email: p.actors[s.actor].email })) })),
    responders: submissions.filter(s => s.surveyId === main[i].surveyId).map(s => ({ student_id: s.studentId, name: null, email: p.actors[s.actor].email })), stats: { total_students: 3, responded: 2 },
  })
  const events = new Map<string, SurveyExchange>()
  const event = (label: string, actor: SurveyExchange['actor'], via: SurveyExchange['via'], method: SurveyExchange['method'], path: string, status: number, request: unknown, response: unknown = status >= 400 ? { error: 'Synthetic refusal' } : { success: true }) =>
    events.set(label, { label, actor, via, method, path, status, request, response })
  for (const [i, letter] of ['A', 'B'].entries()) {
    const actor = i === 0 ? 'ownerTeacher' : 'ownerStudent'
    for (const [prefix, identity] of [['', main[i]], ['scratch-', scraps[i]]] as const) {
      const survey = { id: identity.surveyId, classroom_id: identity.classroomId, created_by: main[i].ownerId, status: 'draft', title: prefix ? `Scratch Survey ${letter}` : main[i].title }
      event(`create-${prefix}${letter}`, actor, 'screen', 'POST', '/api/teacher/surveys', 201,
        { classroom_id: identity.classroomId, title: 'New Survey', show_results: true, dynamic_responses: false }, { survey })
      event(`publish-${prefix}${letter}`, actor, 'screen', 'PATCH', `/api/teacher/surveys/${identity.surveyId}`, 200, { status: 'active' }, { survey: { ...survey, status: 'active' } })
    }
    event(`delete-question-${letter}`, actor, 'screen', 'DELETE', `/api/teacher/surveys/${scraps[i].surveyId}/questions/${scraps[i].questionIds[0]}`, 200, null)
    event(`delete-scratch-${letter}`, actor, 'screen', 'DELETE', `/api/teacher/surveys/${scraps[i].surveyId}`, 200, null)
    const member = i === 0 ? 'ownerStudent' : 'ownerTeacher'
    event(`scratch-submit-${letter}`, member, 'screen', 'POST', `/api/student/surveys/${scraps[i].surveyId}/respond`, 201, { responses: {
      [scraps[i].questionIds[0]]: { question_type: 'link', response_text: 'https://example.invalid/learning' },
      [scraps[i].questionIds[1]]: { question_type: 'short_text', response_text: surveyText(member) },
    } }, { success: true, updated: false })
  }
  const [a, b] = main, owner = '/api/teacher/surveys/', member = '/api/student/surveys/'
  const answer = (identity: SurveyIdentity, actor: typeof actors[number], updated = false) => ({ responses: {
    [identity.questionIds[0]]: { question_type: 'multiple_choice', selected_option: 1 },
    [identity.questionIds[1]]: { question_type: 'short_text', response_text: surveyText(actor, updated) },
  } })
  for (const [label, actor, identity, updated] of [['cross-ownerTeacher', 'ownerTeacher', b, false], ['cross-ownerStudent', 'ownerStudent', a, false],
    ['submit-memberStudent', 'memberStudent', a, false], ['submit-memberTeacher', 'memberTeacher', b, false], ['dynamic-update', 'memberStudent', a, true]] as const) {
    event(label, actor, 'screen', 'POST', member + identity.surveyId + '/respond', updated ? 200 : 201, answer(identity, actor, updated), { success: true, updated })
  }
  event('static-duplicate', 'memberStudent', 'denied-probe', 'POST', member + a.surveyId + '/respond', 400, answer(a, 'memberStudent'))
  event('self-owner', 'ownerTeacher', 'denied-probe', 'GET', member + a.surveyId, 403, null)
  event('foreign-owner', 'ownerTeacher', 'denied-probe', 'PATCH', owner + b.surveyId, 403, { title: 'Forbidden foreign edit' })
  event('foreign-question', 'ownerTeacher', 'denied-probe', 'PATCH', owner + a.surveyId + '/questions/' + b.questionIds[0], 404, { question_text: 'Forbidden foreign question' })
  event('foreign-class', 'ownerTeacher', 'denied-probe', 'GET', '/api/teacher/surveys?classroom_id=' + b.classroomId, 403, null)
  event('member-owner', 'memberTeacher', 'denied-probe', 'GET', owner + b.surveyId + '/results', 403, null)
  event('nonmember-detail', 'nonmember', 'denied-probe', 'GET', member + a.surveyId, 403, null)
  event('nonmember-results', 'nonmember', 'denied-probe', 'GET', member + a.surveyId + '/results', 403, null)
  for (const [label, patch] of [['dynamic-enabled', { dynamic_responses: true }], ['hide-results', { show_results: false }], ['show-results', { show_results: true }], ['close', { status: 'closed' }], ['reopen', { status: 'active' }]] as const) {
    event(label, 'ownerTeacher', 'screen', 'PATCH', owner + a.surveyId, 200, patch, { survey: { id: a.surveyId, classroom_id: a.classroomId, created_by: a.ownerId, ...patch } })
  }
  event('hidden-results', 'memberStudent', 'denied-probe', 'GET', member + a.surveyId + '/results', 403, null)
  event('future-opening', 'ownerTeacher', 'permission-fixture', 'PATCH', owner + a.surveyId, 200, { opens_at: '2099-01-01T00:00:00.000Z' })
  event('restore-opening', 'ownerTeacher', 'permission-fixture', 'PATCH', owner + a.surveyId, 200, { opens_at: null })
  for (const label of ['future-response', 'closed-response']) event(label, 'memberStudent', 'denied-probe', 'POST', member + a.surveyId + '/respond', 400, answer(a, 'memberStudent', true))
  for (const [label, archived] of [['archive', true], ['unarchive', false]] as const) event(label, 'ownerStudent', 'permission-fixture', 'PATCH', '/api/teacher/classrooms/' + b.classroomId, 200, { archived }, { classroom: { id: b.classroomId, archived_at: archived ? updatedTime : null } })
  event('archived-owner-read', 'ownerStudent', 'permission-fixture', 'GET', owner + b.surveyId, 200, null, { survey: { id: b.surveyId, created_by: b.ownerId } })
  event('archived-owner-write', 'ownerStudent', 'denied-probe', 'PATCH', owner + b.surveyId, 403, { title: 'Forbidden archive edit' })
  for (const [prefix, identity, actor] of [['archived', b, 'memberTeacher'], ['revoked', a, 'memberStudent']] as const) {
    for (const flavor of ['cached', 'fresh']) {
      event(`${prefix}-${flavor}-detail`, actor, 'denied-probe', 'GET', member + identity.surveyId, 403, null)
      event(`${prefix}-${flavor}-response`, actor, 'denied-probe', 'POST', member + identity.surveyId + '/respond', 403, answer(identity, actor, prefix === 'revoked'))
    }
    event(`${prefix}-cached-results`, actor, 'denied-probe', 'GET', member + identity.surveyId + '/results', 403, null)
  }
  event('remove-member', 'ownerTeacher', 'permission-fixture', 'POST', `/api/teacher/classrooms/${a.classroomId}/roster/remove`, 200, { roster_ids: [p.lifecycleRoster!.id] }, { success: true, requested_count: 1, removed_count: 1 })
  const result: SurveyWorkflowResult = { surveys: main, deleted: scraps, submissions, archive: { before: results(1), after: results(1) },
    denials: { before: [results(0), results(1)], after: [results(0), results(1)] }, exchanges: surveyExchangeLabels.map(label => events.get(label)!) }
  const memberships = Object.values(p.classrooms).flatMap((c, ci) => ['ownerTeacher', 'ownerStudent', 'memberStudent', 'memberTeacher'].map((actor, ai) => ({ classroom_id: c.id,
    student_id: p.actors[actor as typeof actors[number]].id, generation_id: id(110 + ci * 4 + ai), ledger_state: 'active' })))
  const enrollments = memberships.map(row => ({ id: row.generation_id, classroom_id: row.classroom_id, student_id: row.student_id, created_at: oldTime, manual_attendance_marks: [] }))
  const removed = memberships.find(row => row.classroom_id === a.classroomId && row.student_id === p.actors.memberStudent.id)!
  const roster = { id: p.lifecycleRoster!.id, classroom_id: a.classroomId, email: p.actors.memberStudent.email, first_name: 'Synthetic', last_name: 'Learner', updated_at: oldTime,
    removed_at: null as string | null, removed_student_id: null as string | null, removed_enrollment_id: null as string | null, removed_enrolled_at: null as string | null,
    retained_manual_attendance_marks: null as unknown, retained_attendance_participant_active: null as unknown }
  const before: SurveyWitness = { version: 1, work_graph_sha256: 'a'.repeat(64), tests: p.retiredTestIds.map((tid, i) => ({ id: tid, classroom_id: main[i].classroomId, status: 'draft', position: 0, retired: true })),
    attempts: [], memberships, generations: memberships.map(row => ({ generation_id: row.generation_id, state: 'active' })), question_counts: [],
    classes: main.map(m => ({ id: m.classroomId, archived_at: null, updated_at: oldTime })), response_count: 0, history_count: 0, objects: [],
    survey: { surveys: [], questions: [], responses: [], revisions: main.map(m => ({ classroom_id: m.classroomId, revision: 1, updated_at: oldTime })), roster: [roster],
      bindings: [{ roster_id: roster.id, classroom_id: a.classroomId, student_id: p.actors.memberStudent.id }], enrollments } }
  const after = structuredClone(before)
  after.memberships = after.memberships.filter(row => row.generation_id !== removed.generation_id)
  after.generations = after.generations.map(row => row.generation_id === removed.generation_id ? { ...row, state: 'removed' } : row)
  after.survey.enrollments = after.survey.enrollments.filter(row => row.id !== removed.generation_id)
  after.survey.roster[0] = { ...roster, removed_at: updatedTime, removed_student_id: p.actors.memberStudent.id, removed_enrollment_id: removed.generation_id,
    removed_enrolled_at: oldTime, retained_manual_attendance_marks: [], retained_attendance_participant_active: false, updated_at: updatedTime }
  after.classes[1].updated_at = updatedTime
  after.survey.revisions = main.map(m => ({ classroom_id: m.classroomId, revision: 30, updated_at: updatedTime }))
  after.survey.surveys = main.map((m, i) => ({ artifact_id: id(201 + i), blueprint_archived_at: null, classroom_id: m.classroomId, created_at: initialTime, created_by: m.ownerId,
    dynamic_responses: i === 0, id: m.surveyId, opens_at: initialTime, position: 0, show_results: true, source_artifact_id: null, source_blueprint_version_id: null,
    status: 'active', title: m.title, updated_at: updatedTime }))
  after.survey.questions = main.flatMap(m => m.questionIds.map((qid, qi) => ({ artifact_id: id(220 + Number(qid.slice(-2))), created_at: initialTime, id: qid, options: qi === 0 ? ['Alpha', 'Beta'] : [], position: qi,
    question_text: qi === 0 ? surveyPrompt.mc : surveyPrompt.text, question_type: qi === 0 ? 'multiple_choice' : 'short_text', response_max_chars: 500,
    source_artifact_id: null, source_blueprint_version_id: null, survey_id: m.surveyId, updated_at: initialTime })))
  after.survey.responses = submissions.flatMap((s, si) => main[si < 2 ? 0 : 1].questionIds.map((qid, qi) => ({ id: qi === 0 ? id(310 + si) : s.final.response_id, question_id: qid,
    response_text: qi === 0 ? null : s.final.response_text, selected_option: qi === 0 ? 1 : null, student_id: s.studentId, submitted_at: s.final.submitted_at,
    survey_id: s.surveyId, updated_at: s.final.updated_at })))
  const receipt = { version: 1, proofScope: surveyScope, projectId: p.projectId, nonce: binding.nonce, sourceSha: p.sourceSha, sourceTree: p.sourceTree, appOverlaySha256: p.appOverlaySha256,
    deadline: binding.deadline, endedAt: binding.startedAt + 300, outcome: 'passed', contextsClosed: true, pageErrors: 0, actors: [...surveyActors], result,
    failureStage: null, artifacts: surveyScreens.map((scene, i) => ({ ...scene, kind: 'png', bytes: 100 + i, sha256: String(i).padStart(64, '0') })) }
  return { before, after, receipt, result }
}
