import { describe, expect, it } from 'vitest'
import { markdownToSurvey } from '../../src/lib/survey-markdown'
import { surveyFailureStage, assertSurveySubmissionPreserved, surveyText, assertSurveyResults } from '../../e2e/helpers/contextual-survey-contract'
import { surveyMarkdown, openContextualSurveyEditor, openContextualSurveyClasswork } from '../../e2e/helpers/contextual-survey-workflow'
import { contextualSurveyWitnessSql, validateContextualSurveyReceipt, assertContextualSurveyDatabase } from '../../scripts/contextual-survey-workflow-proof'
import { createContextualTestPlan } from '../../e2e/helpers/contextual-test-rehearsal'
import { contextualSurveyFixture } from '../helpers/contextual-survey-fixture'
import type { ContextualTestRunBinding } from '../../scripts/contextual-test-rehearsal-binding'

const plan = createContextualTestPlan('pika_assignment_list_123456abcdef', 'survey-workflow-v1')
const binding = { proofScope: 'survey-workflow-v1', projectId: plan.projectId, nonce: '0'.repeat(20) + '123456abcdef',
  sourceSha: plan.sourceSha, sourceTree: plan.sourceTree, migrationChainSha256: plan.migrationChainSha256,
  appOverlaySha256: plan.appOverlaySha256, startedAt: 1_000_000, deadline: 1_010_000 } as ContextualTestRunBinding

describe('Survey successor source contracts (no browser/database execution)', () => {
  it('uses the real Survey markdown parser for main and scratch question types', () => {
    const main = markdownToSurvey(surveyMarkdown('Contextual Survey A', false))
    expect(main.errors).toEqual([])
    expect(main.content?.questions.map(q => q.question_type)).toEqual(['multiple_choice', 'short_text'])
    const scratch = markdownToSurvey(surveyMarkdown('Scratch Survey A', true))
    expect(scratch.errors).toEqual([])
    expect(scratch.content?.questions.map(q => q.question_type)).toEqual(['link', 'short_text'])
    expect(main.content?.show_results).toBe(true)
    expect(main.content?.dynamic_responses).toBe(false)
  })
  it('does not expose arbitrary error bodies or invoke error accessors', () => {
    expect(surveyFailureStage(new Error('Contextual Survey failed: archive'))).toBe('archive')
    expect(surveyFailureStage(new Error('secret original diagnostics'))).toBe(null)
    expect(surveyFailureStage(Object.defineProperty({}, 'message', { get() { throw Error('must not invoke') } }))).toBe(null)
    expect(surveyFailureStage(new Proxy({}, { getOwnPropertyDescriptor() { throw Error('must not invoke') } }))).toBe(null)
  })
  it('rejects timestamp-resetting dynamic updates and mismatched selected results', () => {
    const before = { response_id: '50000000-0000-4000-8000-000000000051', response_text: surveyText('memberStudent'), submitted_at: '2026-10-18T12:00:00Z', updated_at: '2026-10-18T12:00:00Z' }
    const after = { ...before, response_text: surveyText('memberStudent', true), updated_at: '2026-10-18T12:01:00Z' }
    expect(() => assertSurveySubmissionPreserved(before, after, 'memberStudent', true)).not.toThrow()
    expect(() => assertSurveySubmissionPreserved(before, { ...after, submitted_at: after.updated_at }, 'memberStudent', true)).toThrow()
    expect(() => assertSurveyResults({ survey: { id: 'foreign' }, results: [] } as never, { surveyId: 'expected' } as never)).toThrow()
  })
  it('uses the real selected Survey actions menu instead of a hidden editor or arbitrary button', async () => {
    const calls: string[] = []
    const chain = { click: async () => { calls.push('click') }, getByRole: (role: string, options: { name?: string }) => { calls.push(`${role}:${options.name}`); return chain } }
    const page = { getByRole: chain.getByRole, getByTestId: (id: string) => { calls.push(id); return chain } }
    await openContextualSurveyEditor(page as never)
    expect(calls).toEqual(['survey-workspace-actionbar-center', 'button:More survey actions', 'click', 'menuitem:Edit survey', 'click', 'dialog:Edit survey'])
  })
  it('reuses Classwork within a classroom but preserves required reload and cross-class entry', async () => {
    const calls: string[] = []
    const current = 'http://localhost:3117/classrooms/one?tab=assignments&surveyId=selected'
    const page = { url: () => current, getByRole: (role: string, options: { name: string }) => ({ click: async () => { calls.push(`${role}:${options.name}`) } }) }
    const runtime = { navigate: async (_page: unknown, url: string) => { calls.push(url) } }
    await openContextualSurveyClasswork(runtime as never, page as never, current)
    await openContextualSurveyClasswork(runtime as never, page as never, current, true)
    await openContextualSurveyClasswork(runtime as never, page as never, current.replace('/one?', '/two?'))
    expect(calls).toEqual(['link:Classwork', current, current.replace('/one?', '/two?')])
  })
  it('witness SQL is fixed and includes all Survey work and membership/revision evidence', () => {
    const plan = createContextualTestPlan('pika_assignment_list_123456abcdef', 'survey-workflow-v1')
    const sql = contextualSurveyWitnessSql(plan)
    expect(sql).toContain('REPEATABLE READ READ ONLY')
    for (const table of ['surveys', 'survey_questions', 'survey_responses', 'classroom_archive_revisions', 'classroom_enrollments', 'classroom_roster', 'classroom_roster_student_bindings']) expect(sql).toContain(`public.${table}`)
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/i)
    expect(() => contextualSurveyWitnessSql({ ...plan, projectId: 'foreign' })).toThrow()
  })
  it('fails closed before getters/proxies, partial receipts and missing native graphs', () => {
    const binding = { projectId: 'pika_assignment_list_123456abcdef', proofScope: 'survey-workflow-v1' }
    for (const raw of [null, {}, { outcome: 'passed' }, new Proxy({}, { ownKeys() { throw Error('private') } }), Object.defineProperty({}, 'result', { get() { throw Error('private') } })]) {
      expect(() => validateContextualSurveyReceipt(raw, binding as never)).toThrow('Survey receipt rejected')
    }
    expect(() => assertContextualSurveyDatabase({} as never, {} as never, {} as never, binding as never)).toThrow('Survey database proof rejected')
  })
  it('accepts complete synthetic CPU evidence and binds it to the actual native Survey row graph', () => {
    const fixture = contextualSurveyFixture(binding)
    expect(() => validateContextualSurveyReceipt(fixture.receipt, binding)).not.toThrow()
    expect(() => assertContextualSurveyDatabase(fixture.before, fixture.after, fixture.result, binding)).not.toThrow()
  })
  it.each(['wrong-source', 'wrong-scene-actor', 'scene-order', 'missing-scene', 'wrong-denial-parent', 'wrong-denial-actor',
    'missing-denial', 'hidden-identity', 'timestamp-reset', 'altered-archive', 'forged-update-status', 'after-end', 'extra-field'])(
    'rejects forged/partial acceptance receipt: %s', defect => {
      const f = contextualSurveyFixture(binding), r = f.receipt
      if (defect === 'wrong-source') r.sourceSha = 'f'.repeat(40)
      if (defect === 'wrong-scene-actor') r.artifacts[0].actor = 'memberStudent'
      if (defect === 'scene-order') [r.artifacts[0], r.artifacts[1]] = [r.artifacts[1], r.artifacts[0]]
      if (defect === 'missing-scene') r.artifacts.pop()
      if (defect === 'wrong-denial-parent') r.result.exchanges.find(e => e.label === 'nonmember-detail')!.path += '/results'
      if (defect === 'wrong-denial-actor') r.result.exchanges.find(e => e.label === 'nonmember-detail')!.actor = 'memberStudent'
      if (defect === 'missing-denial') r.result.exchanges.splice(20, 1)
      if (defect === 'hidden-identity') r.result.denials.before[0].responders!.push({ student_id: r.result.surveys[0].ownerId, name: null, email: 'foreign@example.invalid' })
      if (defect === 'timestamp-reset') r.result.submissions[0].final.submitted_at = r.result.submissions[0].final.updated_at
      if (defect === 'altered-archive') r.result.archive.after.results[0].counts = [1, 1]
      if (defect === 'forged-update-status') r.result.exchanges.find(e => e.label === 'dynamic-update')!.status = 201
      if (defect === 'after-end') r.endedAt = binding.deadline
      if (defect === 'extra-field') Object.assign(r.result, { nativeVerified: true })
      expect(() => validateContextualSurveyReceipt(r, binding)).toThrow('Survey receipt rejected')
    })
  it.each(['response-parent', 'response-question', 'duplicate-response', 'missing-response', 'new-response-time', 'changed-author',
    'question-type', 'question-order', 'missing-main', 'resurrect-scratch', 'revision-not-advanced', 'missing-revision',
    'protected-test', 'membership-generation', 'retained-removal', 'bindings-changed', 'unexpected-extra-row'])(
    'rejects wrong-parent or incomplete native persistence evidence: %s', defect => {
      const f = contextualSurveyFixture(binding), after = f.after
      if (defect === 'response-parent') after.survey.responses[0].survey_id = f.result.surveys[1].surveyId
      if (defect === 'response-question') after.survey.responses[0].question_id = f.result.surveys[1].questionIds[0]
      if (defect === 'duplicate-response') after.survey.responses[1] = { ...after.survey.responses[0] }
      if (defect === 'missing-response') after.survey.responses.pop()
      if (defect === 'new-response-time') after.survey.responses[0].submitted_at = new Date(binding.startedAt + 201).toISOString()
      if (defect === 'changed-author') after.survey.surveys[0].created_by = plan.actors.memberTeacher.id
      if (defect === 'question-type') after.survey.questions[0].question_type = 'link'
      if (defect === 'question-order') after.survey.questions[0].position = 9
      if (defect === 'missing-main') after.survey.surveys.pop()
      if (defect === 'resurrect-scratch') after.survey.surveys.push({ ...after.survey.surveys[0], id: f.result.deleted[0].surveyId })
      if (defect === 'revision-not-advanced') after.survey.revisions[0].revision = f.before.survey.revisions[0].revision
      if (defect === 'missing-revision') after.survey.revisions.pop()
      if (defect === 'protected-test') after.work_graph_sha256 = 'b'.repeat(64)
      if (defect === 'membership-generation') after.generations[0].state = 'removed'
      if (defect === 'retained-removal') after.survey.roster[0].removed_enrollment_id = plan.actors.nonmember.id
      if (defect === 'bindings-changed') after.survey.bindings[0].student_id = plan.actors.nonmember.id
      if (defect === 'unexpected-extra-row') after.survey.responses.push({ ...after.survey.responses[0], id: plan.actors.nonmember.id })
      expect(() => assertContextualSurveyDatabase(f.before, after, f.result, binding)).toThrow('Survey database proof rejected')
    })
})
