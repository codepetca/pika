/** Inert finite learner verification source. No SQL/Storage/platform operations.
 * Native execution requires the coordinator's separately sealed source/approval. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { normalizeTestResponses } from '../src/lib/test-attempts'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { testLearnerWitnessSchema, testLearnerResultSchemas, TEST_LEARNER_COLLECTION_LIMIT,
  type TestLearnerOperation } from '../src/lib/validations/contextual-test-learner-workflow'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
const scenario = (label: string, operation: TestLearnerOperation, expected: 'success'|'conflict'|'denial' = 'success', actor = 1, subject = actor) =>
  ({ label, operation, expected, actor, subject })
export const TEST_LEARNER_PROOF_CASES = freeze([
  ...(['inspect','detail','start','save','submit','recover','session','history','focus','results','document','history-plan','history-write'] as const)
    .map(operation => scenario(`${operation}-member-teacher`, operation)),
  ...(['detail','start','save','submit','recover','session','history','focus','results','document'] as const)
    .map(operation => scenario(`${operation}-member-student`, operation, 'success', 2)),
  scenario('stale-save-current', 'save', 'conflict'), scenario('stale-submit-current', 'submit', 'conflict'),
  scenario('start-first-member-teacher','start'),scenario('start-first-member-student','start','success',2),
  scenario('history-plan-member-student','history-plan','success',2),scenario('history-write-member-student','history-write','success',2),
  scenario('stale-save-revoked', 'save', 'denial'), scenario('stale-submit-hidden', 'submit', 'denial'),
  scenario('stale-save-archived', 'save', 'denial'), scenario('stale-submit-owner-takeover', 'submit', 'denial'),
  scenario('owner-self-enrolled', 'start', 'denial', 0), scenario('outsider', 'detail', 'denial', 3),
  scenario('wrong-parent', 'recover', 'denial'), scenario('wrong-attempt', 'history-plan', 'denial'),
  scenario('wrong-revision', 'history-write', 'denial'), scenario('member-subject-override', 'history', 'denial', 1, 2),
  scenario('owner-current-subject-history', 'history', 'success', 0, 1),
  ...['meaningful-response','submitted','returned','teacher-closed','removed','archived','hidden','selected-closed']
    .map(state => scenario(`focus-${state}`, 'focus', 'denial')),
  ...['reference-swapped','object-swapped','path-swapped','detached','mime-swapped','revoked-after-storage']
    .map(state => scenario(`document-${state}`, 'document', 'denial')),
  scenario('history-write-revoked', 'history-write', 'denial'), scenario('results-before-return', 'results', 'denial'),
  scenario('results-return-revoked', 'results', 'denial'), scenario('closed-saved-draft-recovery', 'recover'),
])
export function newTestLearnerWorkflowFixture(parent: AssignmentListProofFixture) {
  assert.match(parent.manifest.syntheticTag, /^assignmentlist_[a-f0-9]{12}$/)
  const tag = `testlearner_${parent.manifest.syntheticTag.slice(-12)}`
  const id = (label: string) => { const hex = digest(`${tag}:${label}`); return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}` }
  const actors = (['student','teacher','student','teacher'] as const).map((role, index) =>
    ({ id: id(`actor:${index}`), role, email: `${tag}_${index}@example.invalid` }))
  const classroomId = id('classroom'), wrongClassroomId = id('wrong-classroom'), testId = id('test'), attemptId = id('attempt')
  const enrollments = [0,1,2].map(index => ({ id: id(`enrollment:${index}`), classroomId, actorId: actors[index].id }))
  const questions = [0,1].map(index => ({ id: id(`question:${index}`), testId, index }))
  const materials = [
    { id: id('pdf-document'), objectId: id('pdf-object'), source: 'upload' as const, contentType: 'application/pdf',
      bytes: [...Buffer.from('%PDF-1.4\nSynthetic learner fixture\n%%EOF\n')], signedSeconds: 60, csp: null },
    { id: id('html-document'), objectId: id('html-object'), source: 'link' as const, contentType: 'text/html',
      bytes: [...Buffer.from('<html><body>Synthetic learner snapshot</body></html>')], signedSeconds: 60, csp: "script-src 'none'" },
  ].map(row => ({ ...row, path: `classrooms/${classroomId}/tests/${testId}/documents/${row.id}/${row.objectId}` }))
  const allocatedIds = [...actors.map(a => a.id), classroomId, wrongClassroomId, testId, attemptId,
    ...enrollments.map(e => e.id), ...questions.map(q => q.id), ...materials.flatMap(m => [m.id,m.objectId])]
  assert.equal(new Set(allocatedIds).size, allocatedIds.length)
  assert(allocatedIds.every(value => !parent.allocatedIds.includes(value)))
  return freeze({ version: 1 as const, tag, now: parent.manifest.now, actors, classroomId, wrongClassroomId,
    testId, attemptId, enrollments, questions, materials, allocatedIds, nativeVerified: false as const })
}
export type TestLearnerWorkflowFixture = ReturnType<typeof newTestLearnerWorkflowFixture>
export type TestLearnerObservedAttempt = Readonly<{ actorId: string; attemptId: string; revision: number }>
export function testLearnerWorkflowCase(label: string) {
  const value = TEST_LEARNER_PROOF_CASES.find(row => row.label === label); assert(value); return value
}
/** These requests are fixture-specific. History fixtures use a baseline write;
 * the real route independently constructs collapse/patch history from its plan. */
export function testLearnerWorkflowRequest(f: TestLearnerWorkflowFixture, label: string, deadline: string,
  observed: readonly TestLearnerObservedAttempt[] = []) {
  assert(Number.isFinite(Date.parse(deadline)) && new Date(deadline).toISOString() === deadline)
  const c = testLearnerWorkflowCase(label)
  const current = observed.find(row => row.actorId === f.actors[c.subject].id)
  const revision = current?.revision ?? 1
  let payload: Record<string, unknown> = {}
  if (c.actor !== c.subject) payload.requested_student_id = f.actors[c.subject].id
  const responses = { [f.questions[0].id]: { question_type: 'open_response', response_text: 'Synthetic saved response' } }
  if (c.operation === 'save' || c.operation === 'submit') payload = { ...payload, responses,
    expected_revision: c.label.startsWith('stale-') ? Math.max(1,revision-1) : revision,
    ...(c.operation === 'save' ? { trigger: 'autosave', paste_word_count: 0, keystroke_count: 1 } : {}) }
  if (c.operation === 'focus') payload = { ...payload, session_id: 'synthetic-session', event_type: 'away_start', metadata: null }
  if (c.operation === 'document') payload = { ...payload, document_id: f.materials[0].id, source: 'upload' }
  if (c.operation === 'history-plan' || c.operation === 'history-write') payload = { ...payload,
    attempt_id: c.label === 'wrong-attempt' ? f.actors[3].id : current?.attemptId ?? f.attemptId,
    draft_revision: c.label === 'wrong-revision' ? revision+1 : revision }
  if (c.operation === 'history-write') payload = { ...payload, expected_last: null, collapse: false, patch: null,
    snapshot: responses, trigger: 'baseline', word_count: 3, char_count: JSON.stringify(normalizeTestResponses(responses)).length,
    paste_word_count: 0, keystroke_count: 1 }
  return freeze({ p_actor_id: f.actors[c.actor].id, p_test_id: f.testId,
    p_classroom_id: c.operation === 'inspect' ? null : c.label === 'wrong-parent' ? f.wrongClassroomId : f.classroomId,
    p_operation: c.operation, p_payload: payload, p_deadline: deadline })
}
export function validateTestLearnerWorkflowWitness(f: TestLearnerWorkflowFixture, label: string, raw: unknown,
  observed: readonly TestLearnerObservedAttempt[] = []) {
  const c = testLearnerWorkflowCase(label), w = testLearnerWitnessSchema.parse(raw)
  assert.equal(w.actor_id, f.actors[c.actor].id); assert.equal(w.subject_id, f.actors[c.subject].id)
  assert.equal(w.classroom_id, f.classroomId); assert.equal(w.test_id, f.testId); assert.equal(w.operation, c.operation)
  const result = testLearnerResultSchemas[c.operation].parse(w.result)
  const current = observed.find(row => row.actorId === f.actors[c.subject].id)
  const attemptId = current?.attemptId ?? f.attemptId
  if (c.operation !== 'results') {
    const secrets = new Set(['score','feedback','correct_option','answer_key','sample_solution','reference_answer','ai_grading_model','peer_responses'])
    const narrow = (value: unknown) => {
      if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { assert(!secrets.has(key)); narrow(child) }
    }
    narrow(result)
  }
  if ('attempt' in result && result.attempt) {
    if (c.label.startsWith('start-first-')) { assert(!current); assert(!f.allocatedIds.includes(result.attempt.id)); assert(!observed.some(row => row.attemptId === result.attempt!.id)) }
    else assert.equal(result.attempt.id,attemptId)
    assert.equal(result.attempt.test_id, f.testId)
    assert.equal(result.attempt.student_id, f.actors[c.subject].id)
    if (c.operation === 'history-plan' && current) assert.equal(result.attempt.draft_revision,current.revision)
    assert(Object.keys(result.attempt.responses).every(id => f.questions.some(question => question.id === id)))
  }
  if ('state' in result) { assert.equal(result.state.test.id, f.testId); assert.equal(result.state.test.classroom_id, f.classroomId) }
  if ('questions' in result) { assert.equal(new Set(result.questions.map(q => q.id)).size, result.questions.length); assert(result.questions.every(q => q.test_id === f.testId)) }
  if ('history' in result) { assert.equal(result.attemptId,attemptId); assert(result.history.every(h => h.test_attempt_id === attemptId)) }
  if ('last_history' in result && result.last_history) assert.equal(result.last_history.test_attempt_id,attemptId)
  if ('historyEntry' in result && result.historyEntry) assert.equal(result.historyEntry.test_attempt_id,attemptId)
  if ('attempt_id' in result) assert.equal(result.attempt_id,attemptId)
  if ('document' in result) {
    const material = f.materials[0], document = result.document
    assert(document && typeof document === 'object' && !Array.isArray(document))
    assert.equal(document.id,material.id); assert.equal(document.source,material.source); assert.equal(document.storage_path,material.path)
    assert(result.content_type === null || result.content_type === material.contentType)
    if (result.object !== null) {
      const object = result.object; assert(typeof object === 'object' && !Array.isArray(object))
      assert.deepEqual(object,{ id: material.objectId,classroom_id: f.classroomId,storage_path: material.path,
        status: 'ready',purpose: 'teacher_test_material',content_type: result.content_type })
    }
  }
  assert.equal('conflict' in result && result.conflict === true, c.expected === 'conflict')
  assert(c.expected !== 'denial')
  return freeze({ ...w, result })
}
export function testLearnerCollectionQuestions(f: TestLearnerWorkflowFixture, count: number) {
  assert(Number.isSafeInteger(count) && count >= 0 && count <= TEST_LEARNER_COLLECTION_LIMIT)
  return freeze(Array.from({ length: count }, (_, position) => {
    const hex = digest(`${f.tag}:collection:${position}`)
    return { id: `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`,
      test_id: f.testId, question_type: 'open_response' as const, question_text: `Synthetic question ${position}`,
      options: [], points: 1, response_max_chars: 5000, response_monospace: false, position, created_at: f.now, updated_at: f.now }
  }))
}
