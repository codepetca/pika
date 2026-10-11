import { describe, expect, it } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestLearnerWorkflowFixture, testLearnerWorkflowRequest, validateTestLearnerWorkflowWitness,
  testLearnerCollectionQuestions, TEST_LEARNER_PROOF_CASES } from '../../scripts/contextual-test-learner-proof-fixture'

const parent = newAssignmentListProofFixture(new Date('2026-10-10T12:00:00Z'))
const f = newTestLearnerWorkflowFixture(parent)
const deadline = '2026-10-10T12:00:30.000Z'
const attempt = () => ({ id: f.attemptId, test_id: f.testId, student_id: f.actors[1].id, responses: {},
  is_submitted: false, submitted_at: null, created_at: f.now, updated_at: f.now, draft_revision: 1 })
const witness = () => ({ version: 1, actor_id: f.actors[1].id, classroom_id: f.classroomId,
  test_id: f.testId, subject_id: f.actors[1].id, operation: 'recover', result: { attempt: attempt() } })

describe('inert learner workflow verification fixture', () => {
  it('allocates deterministic frozen, disjoint identities and mixed global roles', () => {
    expect(newTestLearnerWorkflowFixture(parent)).toEqual(f)
    expect(Object.isFrozen(f.actors[1])).toBe(true)
    expect(f.actors.map(a => a.role)).toEqual(['student', 'teacher', 'student', 'teacher'])
    expect(new Set(f.allocatedIds).size).toBe(f.allocatedIds.length)
    expect(f.allocatedIds.some(id => parent.allocatedIds.includes(id))).toBe(false)
    expect(f.enrollments.some(e => e.actorId === f.actors[0].id)).toBe(true)
  })
  it('names all thirteen operations and meaningful authority/lifecycle/material denials', () => {
    expect(new Set(TEST_LEARNER_PROOF_CASES.map(c => c.operation)).size).toBe(13)
    for (const label of ['stale-save-revoked', 'stale-submit-hidden', 'owner-self-enrolled', 'wrong-parent',
      'focus-meaningful-response', 'focus-submitted', 'focus-returned', 'focus-teacher-closed',
      'document-reference-swapped', 'document-revoked-after-storage', 'history-write-revoked']) {
      expect(TEST_LEARNER_PROOF_CASES.find(c => c.label === label)?.expected).not.toBe('success')
    }
  })
  it('builds exact actor/Test/Class/subject/op payloads with no fallback RPC or URL', () => {
    const request = testLearnerWorkflowRequest(f, 'recover-member-teacher', deadline)
    expect(Object.keys(request).sort()).toEqual(['p_actor_id','p_classroom_id','p_deadline','p_operation','p_payload','p_test_id'].sort())
    expect(request).toMatchObject({ p_actor_id: f.actors[1].id, p_test_id: f.testId, p_classroom_id: f.classroomId,
      p_operation: 'recover', p_payload: {}, p_deadline: deadline })
    expect(() => testLearnerWorkflowRequest(f, 'unknown', deadline)).toThrow()
    expect(() => testLearnerWorkflowRequest(f, 'recover-member-teacher', 'tomorrow')).toThrow()
  })
  it.each(['actor_id','classroom_id','test_id','subject_id','operation'])('rejects wrong %s witness', field => {
    expect(() => validateTestLearnerWorkflowWitness(f, 'recover-member-teacher', { ...witness(), [field]: f.actors[3].id })).toThrow()
  })
  it('binds nested attempt identity and refuses pre-return secret/peer widening', () => {
    expect(validateTestLearnerWorkflowWitness(f, 'recover-member-teacher', witness())).toEqual(witness())
    for (const field of ['student_id','test_id','id']) {
      const value = witness(); value.result.attempt = { ...attempt(), [field]: f.actors[3].id }
      expect(() => validateTestLearnerWorkflowWitness(f, 'recover-member-teacher', value)).toThrow()
    }
    for (const field of ['score','answer_key','ai_grading_model','peer_responses']) {
      const value = witness(); Object.assign(value.result.attempt, { [field]: 'private' })
      expect(() => validateTestLearnerWorkflowWitness(f, 'recover-member-teacher', value)).toThrow()
    }
  })
  it('retains more than1000 rows and explicitly refuses the finite collection bound', () => {
    const rows = testLearnerCollectionQuestions(f, 1001)
    expect(rows).toHaveLength(1001)
    expect(new Set(rows.map(row => row.id)).size).toBe(1001)
    expect(rows.at(-1)?.position).toBe(1000)
    expect(() => testLearnerCollectionQuestions(f, 10001)).toThrow()
  })
  it('refuses hidden nested grading fields and foreign question responses', () => {
    const leak = witness(); leak.result.attempt.responses = { [f.questions[0].id]: { response_text: 'answer', score: 9 } }
    expect(() => validateTestLearnerWorkflowWitness(f, 'recover-member-teacher', leak)).toThrow()
    const foreign = witness(); foreign.result.attempt.responses = { [f.actors[3].id]: { response_text: 'answer' } }
    expect(() => validateTestLearnerWorkflowWitness(f, 'recover-member-teacher', foreign)).toThrow()
  })
  it('retains real PDF/HTML bytes and expected private MIME/CSP/TTL contracts', () => {
    expect(Buffer.from(f.materials[0].bytes).toString()).toContain('%PDF-1.4')
    expect(f.materials[0]).toMatchObject({ contentType: 'application/pdf', signedSeconds: 60 })
    expect(Buffer.from(f.materials[1].bytes).toString()).toContain('<html>')
    expect(f.materials[1]).toMatchObject({ contentType: 'text/html', csp: "script-src 'none'" })
    expect(f.nativeVerified).toBe(false)
  })
  it('observes a first Start allocation while retaining distinct preseed/resume identity', () => {
    const generated = '99887766-5544-4321-8765-112233445566'
    const value = { ...witness(),operation: 'start',result: { questions: [],attempt: { ...attempt(),id: generated } } }
    expect(validateTestLearnerWorkflowWitness(f,'start-first-member-teacher',value)).toEqual(value)
    expect(() => validateTestLearnerWorkflowWitness(f,'start-member-teacher',value)).toThrow()
    expect(() => validateTestLearnerWorkflowWitness(f,'start-first-member-teacher',{
      ...value,result: { ...value.result,attempt: { ...value.result.attempt,id: f.actors[3].id } } })).toThrow()
  })
  it('binds the exact document/object/path/Class/MIME source tuple', () => {
    const material = f.materials[0]
    const result = { document: { id: material.id,source: material.source,storage_path: material.path },content_type: material.contentType,
      object: { id: material.objectId,classroom_id: f.classroomId,storage_path: material.path,status: 'ready',purpose: 'teacher_test_material',content_type: material.contentType } }
    const value = { ...witness(),operation: 'document',result }
    expect(validateTestLearnerWorkflowWitness(f,'document-member-teacher',value)).toEqual(value)
    expect(() => validateTestLearnerWorkflowWitness(f,'document-member-teacher',{ ...value,result: { ...result,document: { ...result.document,id: f.actors[3].id } } })).toThrow()
    for (const [field,bad] of [['id',f.actors[3].id],['classroom_id',f.wrongClassroomId],['storage_path','foreign/path'],['content_type','application/javascript']]) {
      expect(() => validateTestLearnerWorkflowWitness(f,'document-member-teacher',{ ...value,result: { ...result,object: { ...result.object,[field]: bad } } })).toThrow()
    }
  })
})
