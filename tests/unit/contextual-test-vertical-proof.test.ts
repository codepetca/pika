import { describe, expect, it, vi } from 'vitest'
import { createContextualTestPlan, type RehearsalWitness } from '../../e2e/helpers/contextual-test-rehearsal'
import { validateContextualTestVerticalReceipt, assertContextualTestVerticalDatabase } from '../../scripts/contextual-test-vertical-proof'
import type { ContextualTestRunBinding } from '../../scripts/contextual-test-rehearsal-binding'

const plan = createContextualTestPlan('pika_assignment_list_123456abcdef')
const id = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`
function fixture() {
  const binding = { proofScope: 'vertical-v1', projectId: plan.projectId, nonce: '0'.repeat(20) + '123456abcdef',
    sourceSha: plan.sourceSha, sourceTree: plan.sourceTree, appOverlaySha256: plan.appOverlaySha256, startedAt: 1000, deadline: 2000 } as ContextualTestRunBinding
  const result = { testId: id(1), questionIds: [id(2), id(3)] as readonly [string, string], ownerId: plan.actors.ownerStudent.id,
    memberId: plan.actors.memberTeacher.id, classroomId: plan.classrooms.classB.id, submitted: true as const, ownerSawResponse: true as const,
    denials: { ownerLearner: 403 as const, memberTeacher: 403 as const, nonmemberRead: 403 as const } }
  const raw = { version: 1, proofScope: 'vertical-v1', projectId: binding.projectId, nonce: binding.nonce,
    sourceSha: binding.sourceSha, sourceTree: binding.sourceTree, appOverlaySha256: binding.appOverlaySha256, deadline: binding.deadline,
    endedAt: 1500, outcome: 'passed', contextsClosed: true, pageErrors: 0,
    actors: ['ownerStudent','memberTeacher','nonmember','ownerStudent'], result, failureStage: null,
    artifacts: ['vertical-owner-author','vertical-member-submitted','vertical-owner-results'].map(label => ({ label, kind: 'png', bytes: 1, sha256: 'a'.repeat(64) })) }
  const before: RehearsalWitness = { version: 1, work_graph_sha256: 'a'.repeat(64), tests: plan.retiredTestIds.map((testId, i) => ({ id: testId,
    classroom_id: i ? plan.classrooms.classB.id : plan.classrooms.classA.id, status: 'draft', position: 0, retired: true })),
    attempts: [], memberships: [], generations: [], question_counts: [],
    classes: [plan.classrooms.classA, plan.classrooms.classB].map(c => ({ id: c.id, archived_at: null, updated_at: new Date(1100).toISOString() })),
    response_count: 0, history_count: 0, objects: [] }
  const after: RehearsalWitness = { ...structuredClone(before), work_graph_sha256: 'b'.repeat(64), tests: [...structuredClone(before.tests),
    { id: result.testId, classroom_id: result.classroomId, status: 'closed', position: 1, retired: false }],
    attempts: [{ id: id(4), test_id: result.testId, student_id: result.memberId, draft_revision: 3, is_submitted: true, returned_at: null }],
    question_counts: [{ test_id: result.testId, count: 2 }], response_count: 2, history_count: 2 }
  after.classes[1].updated_at = new Date(1400).toISOString()
  return { binding, raw, result, before, after }
}

describe('vertical receipt proof (CPU only)', () => {
  it('accepts the exact bounded success receipt and returns detached immutable data', () => {
    const f = fixture(), validated = validateContextualTestVerticalReceipt(f.raw, f.binding)
    expect(validated).toEqual(f.raw)
    expect(Object.isFrozen(validated)).toBe(true)
    expect(Object.isFrozen(validated.result.questionIds)).toBe(true)
    f.raw.artifacts[0].bytes = 200
    expect(validated.artifacts[0].bytes).toBe(1)
  })
  it.each(['scope','sql-control','nonce','source','tree','overlay','deadline','late','fractional-time','failed','open-context','page-error','failure-stage',
    'actor-order','extra-key','missing-key','extra-shot','duplicate-shot','wrong-kind','empty-shot','oversize-shot','bad-hash'])('rejects %s', defect => {
    const f = fixture(), raw = f.raw as unknown as Record<string, any>
    if (defect === 'scope') (f.binding as any).proofScope = undefined
    if (defect === 'sql-control') (f.binding as any).sqlControl = undefined
    if (defect === 'nonce') raw.nonce = 'f'.repeat(32)
    if (defect === 'source') raw.sourceSha = 'f'.repeat(40)
    if (defect === 'tree') raw.sourceTree = 'f'.repeat(40)
    if (defect === 'overlay') raw.appOverlaySha256 = 'f'.repeat(64)
    if (defect === 'deadline') raw.deadline++
    if (defect === 'late') raw.endedAt = raw.deadline
    if (defect === 'fractional-time') raw.endedAt = 1000.5
    if (defect === 'failed') raw.outcome = 'failed'
    if (defect === 'open-context') raw.contextsClosed = false
    if (defect === 'page-error') raw.pageErrors = 1
    if (defect === 'failure-stage') raw.failureStage = 'owner-create'
    if (defect === 'actor-order') raw.actors.reverse()
    if (defect === 'extra-key') raw.witnesses = []
    if (defect === 'missing-key') delete raw.result
    if (defect === 'extra-shot') raw.artifacts.push(raw.artifacts[0])
    if (defect === 'duplicate-shot') raw.artifacts[1].label = raw.artifacts[0].label
    if (defect === 'wrong-kind') raw.artifacts[0].kind = 'jpeg'
    if (defect === 'empty-shot') raw.artifacts[0].bytes = 0
    if (defect === 'oversize-shot') raw.artifacts[0].bytes = 4194305
    if (defect === 'bad-hash') raw.artifacts[0].sha256 = 'private'
    expect(() => validateContextualTestVerticalReceipt(f.raw, f.binding)).toThrow('Vertical Test receipt rejected')
  })
  it.each(['wrong-owner','wrong-member','wrong-class','retired-test','duplicate-question','third-question','unsubmitted','unseen','denial','extra-result-key'])('rejects result %s', defect => {
    const f = fixture(), result = f.raw.result as unknown as Record<string, any>
    if (defect === 'wrong-owner') result.ownerId = plan.actors.ownerTeacher.id
    if (defect === 'wrong-member') result.memberId = plan.actors.memberStudent.id
    if (defect === 'wrong-class') result.classroomId = plan.classrooms.classA.id
    if (defect === 'retired-test') result.testId = plan.retiredTestIds[0]
    if (defect === 'duplicate-question') result.questionIds[1] = result.questionIds[0]
    if (defect === 'third-question') result.questionIds.push(id(7))
    if (defect === 'unsubmitted') result.submitted = false
    if (defect === 'unseen') result.ownerSawResponse = false
    if (defect === 'denial') result.denials.nonmemberRead = 404
    if (defect === 'extra-result-key') result.responseText = 'private'
    expect(() => validateContextualTestVerticalReceipt(f.raw, f.binding)).toThrow()
  })
  it('rejects accessors and proxies without invoking them', () => {
    const f = fixture(), trap = vi.fn(() => { throw Error('private') })
    Object.defineProperty(f.raw.result, 'ownerId', { get: trap })
    expect(() => validateContextualTestVerticalReceipt(f.raw, f.binding)).toThrow()
    expect(() => validateContextualTestVerticalReceipt(new Proxy({}, { ownKeys: trap, get: trap, getPrototypeOf: trap }), f.binding)).toThrow()
    expect(trap).not.toHaveBeenCalled()
  })
})

describe('vertical database logical readback proof (CPU only)', () => {
  it('accepts exactly one submitted member attempt and preserves the baseline graph', () => {
    const f = fixture()
    expect(() => assertContextualTestVerticalDatabase(f.before, f.after, f.result, f.binding)).not.toThrow()
  })
  it.each(['missing','duplicate','foreign','archive-owner','archive-other','other-time','unchanged-owner-time','backward','invalid','before-run','after-run'])('rejects classroom drift: %s', defect => {
    const f = fixture(), rows = f.after.classes
    if (defect === 'missing') rows.pop()
    if (defect === 'duplicate') rows[0] = { ...rows[1] }
    if (defect === 'foreign') rows[0].id = id(99)
    if (defect === 'archive-owner') rows[1].archived_at = new Date(1400).toISOString()
    if (defect === 'archive-other') rows[0].archived_at = new Date(1400).toISOString()
    if (defect === 'other-time') rows[0].updated_at = new Date(1400).toISOString()
    if (defect === 'unchanged-owner-time') rows[1].updated_at = f.before.classes[1].updated_at
    if (defect === 'backward') rows[1].updated_at = new Date(1050).toISOString()
    if (defect === 'invalid') rows[1].updated_at = 'invalid'
    if (defect === 'before-run') { f.before.classes[1].updated_at = new Date(0).toISOString(); rows[1].updated_at = new Date(500).toISOString() }
    if (defect === 'after-run') rows[1].updated_at = new Date(f.binding.deadline).toISOString()
    expect(() => assertContextualTestVerticalDatabase(f.before, f.after, f.result, f.binding)).toThrow()
  })
  it.each(['baseline-attempt','baseline-question','baseline-response','baseline-history','baseline-object','baseline-live-test','extra-test','baseline-changed',
    'draft-test','retired-new-test','wrong-class','second-attempt','wrong-member','unsubmitted','returned','zero-revision','wrong-question-count','wrong-question-test',
    'extra-question-count','responses','history','upload','memberships','generations','classes'])('rejects %s', defect => {
    const f = fixture(), { before, after } = f
    if (defect === 'baseline-attempt') before.attempts = structuredClone(after.attempts)
    if (defect === 'baseline-question') before.question_counts = structuredClone(after.question_counts)
    if (defect === 'baseline-response') before.response_count = 1
    if (defect === 'baseline-history') before.history_count = 1
    if (defect === 'baseline-object') before.objects = [{} as never]
    if (defect === 'baseline-live-test') before.tests[0].retired = false
    if (defect === 'extra-test') after.tests.push({ ...after.tests[2], id: id(9) })
    if (defect === 'baseline-changed') after.tests[0].position++
    if (defect === 'draft-test') after.tests[2].status = 'draft'
    if (defect === 'retired-new-test') after.tests[2].retired = true
    if (defect === 'wrong-class') after.tests[2].classroom_id = plan.classrooms.classA.id
    if (defect === 'second-attempt') after.attempts.push({ ...after.attempts[0], id: id(8) })
    if (defect === 'wrong-member') after.attempts[0].student_id = plan.actors.memberStudent.id
    if (defect === 'unsubmitted') after.attempts[0].is_submitted = false
    if (defect === 'returned') after.attempts[0].returned_at = '2026-10-17T12:00:00Z'
    if (defect === 'zero-revision') after.attempts[0].draft_revision = 0
    if (defect === 'wrong-question-count') after.question_counts[0].count = 3
    if (defect === 'wrong-question-test') after.question_counts[0].test_id = before.tests[0].id
    if (defect === 'extra-question-count') after.question_counts.push({ test_id: id(9), count: 1 })
    if (defect === 'responses') after.response_count = 3
    if (defect === 'history') after.history_count = 0
    if (defect === 'upload') after.objects = [{} as never]
    if (defect === 'memberships') after.memberships = [{} as never]
    if (defect === 'generations') after.generations = [{} as never]
    if (defect === 'classes') after.classes = [{} as never]
    expect(() => assertContextualTestVerticalDatabase(before, after, f.result, f.binding)).toThrow('Vertical Test database proof rejected')
  })
})
