/** Fixed no-work fixture reuses publication/pristine rows, never learner Start. */
import assert from 'node:assert/strict'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { newTestOwnerPublicationFixture, testOwnerPublicationSetupSql, testOwnerPublicationSnapshotSql } from './contextual-test-publication-proof-fixture'
import { freezeOwnerGrading as freeze, ownerGradingDigest as hash } from './contextual-test-owner-grading-proof-fixture'

export const TEST_OWNER_UNPUBLICATION_PROOF_CAPS = freeze({ sqlBytes: 524288, responseBytes: 8 * 1024 * 1024,
  requestMs: 12000, closeMs: 12000, totalMs: 180000, dispatches: 40, rows: 10000 })
export const TEST_OWNER_UNPUBLICATION_PROOF_CHECKS = freeze(['service-only-empty-search-path', 'private-core-service-denial',
  'legacy-contextual-complete-parity', 'mixed-role-current-owner', 'current-member-former-owner-foreign-creator-denial',
  'whole-graph-preservation', 'work-history-state-version-content-fences', 'canonical-published-source',
  'portable-question-identities', 'idempotent-draft-full-equality', 'late-fault-atomic-rollback'] as const)
export function newTestOwnerUnpublicationFixture(original: AssignmentListProofFixture) {
  const base = newTestOwnerPublicationFixture(original)
  const id = (label: string) => { const h = hash(`${base.tag}:unpublication:${label}`); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}` }
  const tests = base.tests.map(t => ({ ...t, status: 'closed' as const }))
  const rollbackIds = Object.fromEntries([1,2,3,10,20,11,21,31,12,101,102,111,112,122,201,211,301,302,311,312,401,402].map(n => [String(n), id(`rollback:${n}`)]))
  const selfEnrollmentId = id('owner-self-enrollment'), allocatedIds = [...base.allocatedIds, ...Object.values(rollbackIds), selfEnrollmentId]
  assert.equal(new Set(allocatedIds).size, allocatedIds.length)
  return freeze({ ...base, tests, publicationBase: base, selfEnrollmentId, rollbackIds, allocatedIds, forbiddenWitnessIds:[...original.allocatedIds,...allocatedIds],
    testId: tests[0].id, classroomId: tests[0].classroom_id, wrongClassroomId: base.classes[2].id,
    nativeVerified: false as const })
}
export type TestOwnerUnpublicationFixture = ReturnType<typeof newTestOwnerUnpublicationFixture>
export function testOwnerUnpublicationSetupSql(f: TestOwnerUnpublicationFixture, projectId: string) {
  const q = (v: string) => `'${v.replaceAll("'", "''")}'`
  const source = f.publicationBase, bulkCase = source.cases[2]
  assert.equal(bulkCase.label, 'bulk-1001')
  assert.deepEqual(f.questions, source.questions)
  const bulk = source.questions.filter(row => row.test_id === bulkCase.testId)
  const drafts = source.drafts.filter(row => row.assessment_id === bulkCase.testId)
  assert.equal(bulk.length, 1001);assert.equal(drafts.length, 1)
  const draft = drafts[0], first = bulk[0]
  // The inherited fixed bulk INSERT derives these fields from its first row.
  // Refuse drift rather than compacting a fixture it cannot materialize exactly.
  bulk.forEach((row, position) => assert.deepEqual(row, { ...first, id: row.id, artifact_id: row.artifact_id,
    position, question_text: `Synthetic question ${position}` }))
  assert.equal(first.points, 1)
  const content = { title: draft.content.title, show_results: draft.content.show_results, question_identity_version: 1,
    questions: bulk.map(row => ({ id: row.source_artifact_id ?? row.artifact_id ?? row.id,
      question_type: row.question_type, question_text: row.question_text, options: [...row.options],
      correct_option: row.correct_option, answer_key: row.answer_key, sample_solution: row.sample_solution,
      points: row.points, response_max_chars: row.response_max_chars, response_monospace: row.response_monospace })) }
  assert.deepEqual(draft.content, content)
  const literal = `${q(JSON.stringify(draft.content))}::jsonb`
  const inherited = testOwnerPublicationSetupSql(source, projectId).replaceAll("'draft'", "'closed'")
  assert.equal(inherited.split(literal).length, 2, 'Expected exactly one fixed bulk Draft content literal')
  assert(inherited.indexOf('with ordinality as b(row_id,artifact_id,ordinal)') < inherited.indexOf(literal))
  // Only the already inserted fixed1001-question content is derived. Integer
  // points preserve the original JSON number1 instead of numeric(6,2)1.00.
  const expression = `/* unpublication-bulk-draft */(select jsonb_build_object('title',${q(content.title)},'show_results',${content.show_results},'question_identity_version',1,
'questions',coalesce(jsonb_agg(jsonb_build_object('id',coalesce(question.source_artifact_id,question.artifact_id,question.id),
'question_type',question.question_type,'question_text',question.question_text,'options',question.options,'correct_option',question.correct_option,
'answer_key',question.answer_key,'sample_solution',question.sample_solution,'points',question.points::integer,
'response_max_chars',question.response_max_chars,'response_monospace',question.response_monospace) order by question.position,question.id),'[]'::jsonb))
from public.test_questions question where question.test_id=${q(bulkCase.testId)}::uuid)/* end-unpublication-bulk-draft */`
  const baseSql = inherited.replace(literal, expression)
  assert(baseSql.endsWith('commit;'))
  const sql = `${baseSql.slice(0,-'commit;'.length)}
insert into public.classroom_enrollments(id,classroom_id,student_id) values(${q(f.selfEnrollmentId)},${q(f.classes[1].id)},${q(f.actors[1].id)});commit;`
  assert(Buffer.byteLength(sql) <= 256 * 1024, 'Fixed unpublication preparation exceeds native input cap')
  return sql
}
export function testOwnerUnpublicationSnapshotSql(f: TestOwnerUnpublicationFixture) { return testOwnerPublicationSnapshotSql(f.publicationBase) }
