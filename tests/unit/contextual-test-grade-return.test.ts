import { describe, expect, it, vi } from 'vitest'
import { createContextualTestPlan } from '../../e2e/helpers/contextual-test-rehearsal'
import { assertVerticalGradeSave, assertVerticalGradeReadback, assertVerticalLearnerDisclosure, openVerticalOwnerWorkspace } from '../../e2e/helpers/contextual-test-grade-return-workflow'
import { ContextualTestGatewayPolicy } from '../../scripts/contextual-test-rehearsal-gateway'
import { validateContextualTestGradeReturnReceipt, assertContextualTestGradeReturnDatabase, contextualTestGradeReturnWitnessSql, type GradeReturnWitness } from '../../scripts/contextual-test-grade-return-proof'
import { validateContextualTestVerticalReceipt } from '../../scripts/contextual-test-vertical-proof'
import { validateContextualTestPlaywrightReceipt } from '../../scripts/contextual-test-rehearsal-controller'
import { contextualTestSql } from '../../scripts/contextual-test-rehearsal-binding'
import type { ContextualTestRunBinding } from '../../scripts/contextual-test-rehearsal-binding'

const scope = 'vertical-grade-return-v1' as const
const id = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const plan = createContextualTestPlan('pika_assignment_list_123456abcdef', scope)
const original = () => ({ response_id: id(4), response_revision: 1, score: null, feedback: null })
const saved = () => ({ saved_count: 1, responses: [{ id: id(4), revision: 2, score: 4, feedback: 'Reviewed manually' }] })
const graph = () => ({ test: { id: id(1) }, questions: [{ id: id(2) }, { id: id(3) }], students: [{ student_id: plan.actors.memberTeacher.id,
  status: 'returned', returned_at: new Date(1500).toISOString(), returned_by: plan.actors.ownerStudent.id, effective_access: 'closed',
  answers: { [id(2)]: { response_id: id(5), response_revision: 1, selected_option: 1, response_text: null, score: 5, feedback: null, is_draft: false },
    [id(3)]: { response_id: id(4), response_revision: 2, selected_option: null, response_text: 'Synthetic reasoning: Beta is the second option.', score: 4, feedback: 'Reviewed manually', is_draft: false } } }] })
function proofFixture() {
  const binding = { proofScope: scope, projectId: plan.projectId, nonce: '0'.repeat(20) + '123456abcdef', sourceSha: plan.sourceSha,
    sourceTree: plan.sourceTree, appOverlaySha256: plan.appOverlaySha256, migrationChainSha256: plan.migrationChainSha256,
    startedAt: 1000, deadline: 2000 } as ContextualTestRunBinding
  const result = { testId: id(1), questionIds: [id(2),id(3)] as readonly [string,string], ownerId: plan.actors.ownerStudent.id,
    memberId: plan.actors.memberTeacher.id, classroomId: plan.classrooms.classB.id, submitted: true as const, ownerSawResponse: true as const,
    denials: { ownerLearner: 403 as const, memberTeacher: 403 as const, nonmemberRead: 403 as const }, gradeReturn: {
      testId: id(1), ownerId: plan.actors.ownerStudent.id, memberId: plan.actors.memberTeacher.id, questionIds: [id(2),id(3)] as readonly [string,string],
      mcResponseId: id(5), mcRevision: 1, responseId: id(4), revision: 2, initialRevision: 1, score: 4 as const, feedback: 'Reviewed manually',
      returnedAt: new Date(1500).toISOString(), hiddenBeforeReturn: true as const, memberSawReturned: true as const } }
  const raw = { version: 1, proofScope: scope, projectId: binding.projectId, nonce: binding.nonce, sourceSha: binding.sourceSha,
    sourceTree: binding.sourceTree, appOverlaySha256: binding.appOverlaySha256, deadline: binding.deadline, endedAt: 1600,
    outcome: 'passed', contextsClosed: true, pageErrors: 0, actors: ['ownerStudent','memberTeacher','nonmember','ownerStudent','ownerStudent','memberTeacher','ownerStudent','memberTeacher'],
    result, failureStage: null, artifacts: ['vertical-owner-author','vertical-member-submitted','vertical-owner-results','vertical-owner-graded','vertical-owner-returned','vertical-member-returned']
      .map(label => ({ label, kind: 'png', bytes: 10, sha256: 'a'.repeat(64) })) }
  const before: GradeReturnWitness = { version: 1, work_graph_sha256: 'a'.repeat(64), tests: plan.retiredTestIds.map((testId, i) => ({ id: testId,
    classroom_id: i ? plan.classrooms.classB.id : plan.classrooms.classA.id, status: 'draft', position: 0, retired: true })),
    attempts: [], question_counts: [], memberships: [], generations: [], response_count: 0, history_count: 0, objects: [],
    classes: Object.values(plan.classrooms).map(c => ({ id: c.id, archived_at: null, updated_at: new Date(1000).toISOString() })),
    grade_return: { protected_graph_sha256: 'a'.repeat(64), responses: [], attempt_actors: [], access: [] } }
  const after: GradeReturnWitness = { ...structuredClone(before), tests: [...structuredClone(before.tests), { id: id(1), classroom_id: result.classroomId, status: 'closed', position: 1, retired: false }],
    attempts: [{ id: id(6), test_id: id(1), student_id: result.memberId, draft_revision: 3, is_submitted: true, returned_at: result.gradeReturn.returnedAt }],
    question_counts: [{ test_id: id(1), count: 2 }], response_count: 2, history_count: 2, grade_return: { protected_graph_sha256: 'a'.repeat(64),
      responses: [0,1].map(index => ({ id: index ? id(4) : id(5), test_id: id(1), question_id: index ? id(3) : id(2), student_id: result.memberId,
        revision: index ? 2 : 1, score: index ? 4 : 5, feedback: index ? 'Reviewed manually' : null, selected_option: index ? null : 1,
        response_text: index ? 'Synthetic reasoning: Beta is the second option.' : null, graded_at: new Date(1400).toISOString(), graded_by: index ? result.ownerId : null })),
      attempt_actors: [{ id: id(6), returned_by: result.ownerId }], access: [{ test_id: id(1), student_id: result.memberId, state: 'closed' }] } }
  after.classes[1].updated_at = new Date(1500).toISOString()
  return { binding, raw, result, before, after }
}

describe('grade/return successor regression contracts (CPU only)', () => {
  it.each([false, true])('opens the inspector only for response grading, not Return: %s', async inspect => {
    const events: string[] = []
    const select = vi.fn(async () => { events.push('inspect') })
    const nth = vi.fn((index: number) => { expect(index).toBe(1); return { click: select } })
    const member = { getByRole: vi.fn((role: string) => { expect(role).toBe('cell'); return { nth } }) }
    const page = {
      getByRole: vi.fn((role, options) => {
        expect([role, options]).toEqual(['button', { name: 'Contextual vertical Test', exact: true }])
        return { click: async () => { events.push('open') } }
      }),
      getByTestId: vi.fn((testId: string) => { expect(testId).toBe(`test-grading-student-row-${plan.actors.memberTeacher.id}`); return member }),
    }
    const r = { check: vi.fn(() => { events.push('check') }), navigate: vi.fn(async () => { events.push('navigate') }) }
    expect(await openVerticalOwnerWorkspace(r as never, page as never, `${plan.appOrigin}/classrooms/${plan.classrooms.classB.id}?tab=tests`,
      plan.actors.memberTeacher.id, inspect)).toBe(member)
    expect(events).toEqual(inspect ? ['check', 'navigate', 'open', 'inspect'] : ['check', 'navigate', 'open'])
    expect(select).toHaveBeenCalledTimes(inspect ? 1 : 0)
  })
  it('binds current main without changing the historical scope', () => {
    expect(plan).toMatchObject({ sourceSha: 'eb4fa32b237d45f500ea4a67ade9a9e5290ea1c0', sourceTree: 'ffec2cc82fd88e9819c147b2ab6246f95c28798e', migrationChainSha256: '9f08b2db28b413c6f00b3021597d5cd0271600b0d8039abf46f84b50c318b4bd' })
    expect(createContextualTestPlan(plan.projectId).sourceSha).toBe('050699bb0f889a533a349b6af415b821ac56d0e3')
    expect(() => createContextualTestPlan(plan.projectId, 'other' as never)).toThrow()
  })
  it.each(['revision', 'response', 'score', 'feedback', 'extra'])('rejects incorrect grade acknowledgement: %s', defect => {
    const ack = saved()
    if (defect === 'revision') ack.responses[0].revision = 1
    if (defect === 'response') ack.responses[0].id = id(9)
    if (defect === 'score') ack.responses[0].score = 3
    if (defect === 'feedback') ack.responses[0].feedback = 'Other'
    if (defect === 'extra') ack.responses.push({ ...ack.responses[0] })
    expect(() => assertVerticalGradeSave(ack, original())).toThrow()
  })
  it('accepts the exact revision-fenced grade', () => expect(() => assertVerticalGradeSave(saved(), original())).not.toThrow())
  it('accepts exact owner readback and bounded learner disclosure', () => {
    const identity = { testId: id(1), memberId: plan.actors.memberTeacher.id, ownerId: plan.actors.ownerStudent.id,
      questionIds: [id(2),id(3)] as readonly [string,string], mcResponseId: id(5), mcRevision: 1, responseId: id(4), revision: 2 }
    expect(() => assertVerticalGradeReadback(graph(), identity, true)).not.toThrow()
    expect(() => assertVerticalLearnerDisclosure({ test: { id: id(1), returned_at: null }, questions: [{ id: id(2) }] }, false, id(1))).not.toThrow()
    expect(() => assertVerticalLearnerDisclosure({ test: { id: id(1), returned_at: new Date(1500).toISOString(), effective_access: 'closed' },
      question_results: [{ question_id: id(2), score: 5, selected_option: 1, correct_option: 1, feedback: null },
        { question_id: id(3), score: 4, feedback: 'Reviewed manually', response_text: 'Synthetic reasoning: Beta is the second option.' }],
      summary: { earned_points: 9, possible_points: 10 } }, true, id(1), identity.questionIds)).not.toThrow()
  })
  it.each(['missing-return', 'wrong-parent', 'wrong-member', 'wrong-question', 'revision', 'score', 'comment', 'other-response', 'open-access'])('rejects invalid returned graph: %s', defect => {
    const g = graph(), row = g.students[0]
    if (defect === 'missing-return') row.returned_at = ''
    if (defect === 'wrong-parent') g.test.id = id(9)
    if (defect === 'wrong-member') row.student_id = plan.actors.memberStudent.id
    if (defect === 'wrong-question') g.questions[1].id = id(9)
    if (defect === 'revision') row.answers[id(3)].response_revision++
    if (defect === 'score') row.answers[id(3)].score = 1
    if (defect === 'comment') row.answers[id(3)].feedback = 'Other'
    if (defect === 'other-response') row.answers[id(2)].score = 1
    if (defect === 'open-access') row.effective_access = 'open'
    expect(() => assertVerticalGradeReadback(g, { testId: id(1), memberId: plan.actors.memberTeacher.id, ownerId: plan.actors.ownerStudent.id,
      questionIds: [id(2), id(3)], mcResponseId: id(5), mcRevision: 1, responseId: id(4), revision: 2 }, true)).toThrow()
  })
  it.each(['score', 'feedback', 'correct_option', 'answer_key', 'sample_solution'])('rejects premature learner %s disclosure at any depth', key => {
    expect(() => assertVerticalLearnerDisclosure({ test: { id: id(1), returned_at: null }, questions: [{ id: id(2), nested: { [key]: key === 'score' ? 0 : 'private' } }] }, false, id(1))).toThrow()
  })
  it.each([undefined, 'vertical-v1', scope] as const)('permits new writes only in successor scope: %s', proofScope => {
    for (const [method, path] of [['PATCH', `/api/teacher/tests/${id(1)}/students/${plan.actors.memberTeacher.id}/grades`], ['POST', `/api/teacher/tests/${id(1)}/return`]]) {
      const policy = new ContextualTestGatewayPolicy(plan, 2000, () => 1000, proofScope)
      if (proofScope === scope) {
        policy.observeAppResponse('app', '/api/teacher/tests', 'POST', 201, { test: { id: id(1), classroom_id: plan.classrooms.classB.id } })
        if (method === 'POST') policy.admit('app', `/api/teacher/tests/${id(1)}/students/${plan.actors.memberTeacher.id}/grades`, 'localhost:3117', 'PATCH',
          { grades: [{ question_id: id(3), response_id: id(4), expected_response_revision: 1, score: 4, feedback: 'Reviewed manually' }] })
      }
      const admit = () => policy.admit('app', path, 'localhost:3117', method,
        method === 'POST' ? { student_ids: [plan.actors.memberTeacher.id] } : { grades: [{ question_id: id(3), response_id: id(4), expected_response_revision: 1, score: 4, feedback: 'Reviewed manually' }] })
      if (proofScope === scope) expect(admit).not.toThrow()
      else expect(admit).toThrow()
    }
  })
  it('accepts exact successor receipt and database proof independently of old/full acceptance', () => {
    const f = proofFixture(), receipt = validateContextualTestGradeReturnReceipt(f.raw, f.binding)
    expect(receipt).toEqual(f.raw); expect(Object.isFrozen(receipt.result.gradeReturn)).toBe(true)
    expect(() => assertContextualTestGradeReturnDatabase(f.before, f.after, f.result, f.binding)).not.toThrow()
    expect(() => validateContextualTestVerticalReceipt(f.raw, f.binding)).toThrow()
    expect(() => validateContextualTestPlaywrightReceipt(f.raw, f.binding)).toThrow()
  })
  it.each(['scope','binding-scope','old-source','old-chain','sql-control','no-return','revision','parent','member','hidden','unseen','actor-order','shot-order','missing-shot','extra-shot','late','accessor','extra-key'])('rejects successor receipt %s', defect => {
    const f = proofFixture(), raw = f.raw as any, grade = raw.result.gradeReturn
    if (defect === 'scope') raw.proofScope = 'vertical-v1'
    if (defect === 'binding-scope') (f.binding as any).proofScope = 'vertical-v1'
    if (defect === 'old-source') { (f.binding as any).sourceSha = createContextualTestPlan(plan.projectId).sourceSha; raw.sourceSha = f.binding.sourceSha }
    if (defect === 'old-chain') (f.binding as any).migrationChainSha256 = createContextualTestPlan(plan.projectId).migrationChainSha256
    if (defect === 'sql-control') (f.binding as any).sqlControl = undefined
    if (defect === 'no-return') grade.returnedAt = null
    if (defect === 'revision') grade.revision++
    if (defect === 'parent') grade.testId = id(99)
    if (defect === 'member') grade.memberId = plan.actors.memberStudent.id
    if (defect === 'hidden') grade.hiddenBeforeReturn = false
    if (defect === 'unseen') grade.memberSawReturned = false
    if (defect === 'actor-order') raw.actors.reverse()
    if (defect === 'shot-order') raw.artifacts.reverse()
    if (defect === 'missing-shot') raw.artifacts.pop()
    if (defect === 'extra-shot') raw.artifacts.push(raw.artifacts[0])
    if (defect === 'late') raw.endedAt = raw.deadline
    if (defect === 'accessor') Object.defineProperty(grade, 'revision', { get() { throw Error('private') } })
    if (defect === 'extra-key') grade.privateText = 'private'
    expect(() => validateContextualTestGradeReturnReceipt(raw, f.binding)).toThrow('Grade/return Test receipt rejected')
  })
  it.each(['missing-return','wrong-returner','wrong-response-parent','wrong-question','wrong-member','revision','score','comment','extra-response','other-graph','open-access','extra-attempt','member-drift','class-drift','old-scope'])('rejects database %s', defect => {
    const f = proofFixture(), { after } = f, rows = after.grade_return.responses
    if (defect === 'missing-return') after.attempts[0].returned_at = null
    if (defect === 'wrong-returner') after.grade_return.attempt_actors[0].returned_by = plan.actors.ownerTeacher.id
    if (defect === 'wrong-response-parent') rows[1].test_id = id(99)
    if (defect === 'wrong-question') rows[1].question_id = id(2)
    if (defect === 'wrong-member') rows[1].student_id = plan.actors.memberStudent.id
    if (defect === 'revision') rows[1].revision++
    if (defect === 'score') rows[1].score = 3
    if (defect === 'comment') rows[1].feedback = 'Other'
    if (defect === 'extra-response') rows.push({ ...rows[0], id: id(99) })
    if (defect === 'other-graph') after.grade_return.protected_graph_sha256 = 'b'.repeat(64)
    if (defect === 'open-access') after.grade_return.access[0].state = 'open'
    if (defect === 'extra-attempt') after.attempts.push({ ...after.attempts[0], id: id(99) })
    if (defect === 'member-drift') after.memberships.push({} as never)
    if (defect === 'class-drift') after.classes[0].updated_at = new Date(1500).toISOString()
    if (defect === 'old-scope') (f.binding as any).proofScope = 'vertical-v1'
    expect(() => assertContextualTestGradeReturnDatabase(f.before, after, f.result, f.binding)).toThrow('Grade/return Test database proof rejected')
  })
  it('uses a fixed read-only successor projection and rejects historical SQL/recovery scope', () => {
    const f = proofFixture(), sql = contextualTestGradeReturnWitnessSql(plan)
    expect(sql).toContain('REPEATABLE READ READ ONLY'); expect(sql).toContain("'graded_by',r.graded_by")
    expect(sql).toContain("'attempt_actors'"); expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER)\b/)
    expect(contextualTestSql(f.binding, 'gradeReturnWitness')).toBe(sql)
    expect(() => contextualTestSql({ ...f.binding, proofScope: 'vertical-v1' }, 'gradeReturnWitness')).toThrow()
    expect(() => contextualTestSql(f.binding, 'archiveA')).toThrow()
    expect(() => contextualTestGradeReturnWitnessSql(createContextualTestPlan(plan.projectId))).toThrow()
  })
  it.each(['uncreated','wrong-parent','wrong-member','extra-field','wrong-score','retry','return-before-grade'])('rejects gateway capability expansion: %s', defect => {
    const policy = new ContextualTestGatewayPolicy(plan, 2000, () => 1000, scope)
    if (defect !== 'uncreated') policy.observeAppResponse('app','/api/teacher/tests','POST',201,{ test: { id: id(1), classroom_id: plan.classrooms.classB.id } })
    const body = { grades: [{ question_id: id(3), response_id: id(4), expected_response_revision: 1, score: 4, feedback: 'Reviewed manually' }] }
    const path = `/api/teacher/tests/${defect === 'wrong-parent' ? id(99) : id(1)}/students/${defect === 'wrong-member' ? plan.actors.memberStudent.id : plan.actors.memberTeacher.id}/grades`
    if (defect === 'extra-field') (body.grades[0] as any).clear_grade = true
    if (defect === 'wrong-score') body.grades[0].score = 3
    if (defect === 'retry') policy.admit('app', path, 'localhost:3117', 'PATCH', body)
    expect(() => defect === 'return-before-grade'
      ? policy.admit('app', `/api/teacher/tests/${id(1)}/return`, 'localhost:3117', 'POST', { student_ids: [plan.actors.memberTeacher.id] })
      : policy.admit('app', path, 'localhost:3117', 'PATCH', body)).toThrow()
  })
})
