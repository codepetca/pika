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
  const baseSql = testOwnerPublicationSetupSql(f.publicationBase, projectId).replaceAll("'draft'", "'closed'")
  assert(baseSql.endsWith('commit;'))
  return `${baseSql.slice(0,-'commit;'.length)}
insert into public.classroom_enrollments(id,classroom_id,student_id) values(${q(f.selfEnrollmentId)},${q(f.classes[1].id)},${q(f.actors[1].id)});commit;`
}
export function testOwnerUnpublicationSnapshotSql(f: TestOwnerUnpublicationFixture) { return testOwnerPublicationSnapshotSql(f.publicationBase) }
