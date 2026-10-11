/** Inert finite owner grading extension. Importing it opens no process, network,
 * SQL or Storage resource. Synthetic/mock receipts are never native evidence. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { newTestLearnerWorkflowFixture } from './contextual-test-learner-proof-fixture'

export const TEST_OWNER_GRADING_PROOF_CAPS = Object.freeze({ sqlBytes:256*1024,responseBytes:4*1024*1024,
  requestMs:12000,closeMs:12000,totalMs:180000,dispatches:40,rows:5000 })
export function freezeOwnerGrading<T>(value:T):T {
  if(value&&typeof value==='object'){Object.values(value).forEach(freezeOwnerGrading);Object.freeze(value)}return value
}
export const ownerGradingDigest=(value:string)=>createHash('sha256').update(value).digest('hex')
export function newTestOwnerGradingFixture(original:AssignmentListProofFixture) {
  const base=newTestLearnerWorkflowFixture(original),tag=`testownergrade_${base.tag.slice(-12)}`
  const id=(label:string)=>{const h=ownerGradingDigest(`${tag}:${label}`);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`}
  const responses=[1,2].flatMap(actor=>[0,1].map(question=>({id:id(`response:${actor}:${question}`),
    testId:base.testId,studentId:base.actors[actor].id,questionId:base.questions[question].id,question,revision:1})))
  // These synthetic IDs are only inserted inside the rollback no-question
  // contract. They never replace the two product-observed Start identities.
  const emptyTestId=id('empty-test'),emptyAttemptIds=[id('empty-attempt:1'),id('empty-attempt:2')]
  const runId=id('ai-run'),runItemId=id('ai-run-item'),allocatedIds=[...base.allocatedIds,...responses.map(r=>r.id),runId,runItemId,emptyTestId,...emptyAttemptIds]
  assert.equal(new Set(allocatedIds).size,allocatedIds.length)
  return freezeOwnerGrading({...base,tag,responses,runId,runItemId,emptyTestId,emptyAttemptIds,allocatedIds,nativeVerified:false as const})
}
export type TestOwnerGradingFixture=ReturnType<typeof newTestOwnerGradingFixture>
export type TestOwnerGradingOperation='results'|'manual-save'|'clear-open-grades'|'return'
export function testOwnerGradingRequest(f:TestOwnerGradingFixture,operation:TestOwnerGradingOperation,
  expectedTest:Readonly<Record<string,unknown>>,deadline:string) {
  assert(Number.isFinite(Date.parse(deadline))&&new Date(deadline).toISOString()===deadline)
  assert.equal(expectedTest.id,f.testId);assert.equal(expectedTest.classroom_id,f.classroomId)
  const studentIds=f.actors.slice(1,3).map(a=>a.id)
  const payload=operation==='results'?{}:operation==='manual-save'?{student_id:studentIds[0],grades:[{
    response_id:f.responses[0].id,question_id:f.questions[0].id,expected_response_revision:1,
    clear_grade:false,score:0,feedback:'Synthetic manual feedback',
  }]}:operation==='clear-open-grades'?{student_ids:studentIds,responses:f.responses.filter(r=>r.question===0)
    .map(r=>({response_id:r.id,expected_response_revision:r.revision}))}:{student_ids:studentIds}
  return freezeOwnerGrading({p_actor_id:f.actors[0].id,p_test_id:f.testId,p_classroom_id:f.classroomId,
    p_operation:operation,p_payload:payload,p_expected_test:expectedTest,p_deadline:deadline})
}
export type TestOwnerGradingRequest=ReturnType<typeof testOwnerGradingRequest>
function record(value:unknown):Record<string,unknown>{assert(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>}
function count(value:unknown):number{assert(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0);return value}
function rows(value:unknown):Record<string,unknown>[] {assert(Array.isArray(value)&&value.length<=TEST_OWNER_GRADING_PROOF_CAPS.rows);return value.map(record)}
/** Validates the fixed fixture's internal witness. HTTP public projection has a
 * separate product adapter contract; this does not certify that projection. */
export function validateTestOwnerGradingWitness(f:TestOwnerGradingFixture,request:TestOwnerGradingRequest,raw:unknown) {
  assert(Buffer.byteLength(JSON.stringify(raw))<=TEST_OWNER_GRADING_PROOF_CAPS.responseBytes)
  const w=record(raw);assert.deepEqual(Object.keys(w).sort(),['actor_id','classroom_id','operation','result','test','test_id','version'])
  assert.equal(w.version,1);assert.equal(w.actor_id,request.p_actor_id);assert.equal(w.classroom_id,request.p_classroom_id)
  assert.equal(w.test_id,request.p_test_id);assert.equal(w.operation,request.p_operation)
  const test=record(w.test);assert.equal(test.id,f.testId);assert.equal(test.classroom_id,f.classroomId)
  const r=record(w.result),payload=record(request.p_payload)
  if(request.p_operation==='results') {
    assert.deepEqual(Object.keys(r).sort(),['active_ai_grading_run','attempts','availability','focus_events','profiles','questions','responses','student_ids','users'])
    const selected=f.actors.slice(1,3).map(a=>a.id);assert(Array.isArray(r.student_ids));assert.deepEqual([...r.student_ids].sort(),selected.sort())
    const roster=new Set(r.student_ids)
    for(const key of ['responses','attempts','focus_events','availability']) for(const row of rows(r[key])) assert(roster.has(row.student_id))
    const users=rows(r.users);assert.deepEqual(users.map(row=>row.id).sort(),[...roster].sort())
    for(const row of users) assert.equal(row.email,f.actors.find(actor=>actor.id===row.id)?.email)
    for(const row of rows(r.profiles)) assert(roster.has(row.user_id))
    const questions=rows(r.questions);assert.deepEqual(questions.map(row=>row.id).sort(),f.questions.map(row=>row.id).sort())
    for(const row of questions) {assert.equal(row.test_id,f.testId);assert(!('answer_key'in row)&&!('sample_solution'in row))}
    const responses=rows(r.responses);assert.equal(new Set(responses.map(row=>row.id)).size,responses.length)
    for(const row of responses) {
      const expected=f.responses.find(expected=>expected.id===row.id);assert(expected)
      assert.equal(row.test_id,f.testId);assert.equal(row.question_id,expected.questionId);assert.equal(row.student_id,expected.studentId)
      assert(!('ai_grading_provenance'in row)&&!('ai_grading_review'in row)&&!('ai_provenance_token'in row))
    }
    if(r.active_ai_grading_run!==null) {
      const run=record(r.active_ai_grading_run);assert.equal(run.test_id,f.testId)
      assert(run.status==='queued'||run.status==='running')
      // Current-roster proof is enforced in SQL; a raw private item record cannot
      // substitute for the existing narrow public run summary.
      assert(!('items'in run)&&!('provider_payload'in run)&&!('lease_token'in run))
      for(const error of rows(run.error_samples)) {
        assert(roster.has(error.student_id));assert.equal(error.code,null)
        assert.equal(error.message,'AI grading failed for this response')
      }
    }
  } else if(request.p_operation==='manual-save') {
    assert.deepEqual(Object.keys(r).sort(),['clear_context','cleared_count','responses','saved_count','student_id'])
    assert.equal(r.student_id,payload.student_id);const grades=rows(payload.grades),saved=rows(r.responses)
    assert.equal(saved.length,grades.length);assert.equal(new Set(saved.map(row=>row.id)).size,saved.length)
    assert.equal(count(r.saved_count),grades.length);assert.equal(count(r.cleared_count),grades.filter(grade=>grade.clear_grade===true).length)
    const context=rows(r.clear_context),clears=grades.filter(grade=>grade.clear_grade===true)
    assert.equal(context.length,clears.length);assert.equal(new Set(context.map(row=>row.response_id)).size,context.length)
    for(const row of context) {
      assert.deepEqual(Object.keys(row).sort(),['question_id','question_type','response_id','selected_option'])
      const grade=clears.find(grade=>grade.response_id===row.response_id),response=f.responses.find(response=>response.id===row.response_id)
      assert(grade&&response);assert.equal(row.question_id,response.questionId)
      if(grade.question_id!==undefined&&grade.question_id!==null)assert.equal(row.question_id,grade.question_id)
      assert.equal(row.question_type,response.question===0?'open_response':'multiple_choice')
      if(response.question===0)assert.equal(row.selected_option,null)
      else assert(Number.isSafeInteger(row.selected_option)&&Number(row.selected_option)>=0&&Number(row.selected_option)<2)
    }
    for(const grade of grades) {
      const row=saved.find(row=>row.id===grade.response_id);assert(row)
      const revision=count(row.revision),expected=count(grade.expected_response_revision)
      assert(revision>=expected&&revision<=expected+1)
      const cleared=context.find(row=>row.response_id===grade.response_id)
      assert.equal(row.score,grade.clear_grade?(cleared?.question_type==='multiple_choice'?0:null):grade.score)
      assert.equal(row.feedback,grade.clear_grade?null:grade.feedback)
    }
  } else {
    assert(Array.isArray(payload.student_ids)&&Array.isArray(r.student_ids));assert.deepEqual([...r.student_ids].sort(),[...payload.student_ids].sort())
    const selected=payload.student_ids.length
    if(request.p_operation==='return') {
      assert.deepEqual(Object.keys(r).sort(),['already_returned_count','returned_count','skipped_count','student_ids','test_closed'])
      assert.equal(r.test_closed,false);assert.equal(count(r.returned_count)+count(r.already_returned_count)+count(r.skipped_count),selected)
    } else {
      assert.deepEqual(Object.keys(r).sort(),['cleared_responses','cleared_students','skipped_students','student_ids'])
      assert.equal(count(r.cleared_students)+count(r.skipped_students),selected)
      assert(count(r.cleared_responses)<=rows(payload.responses).length)
    }
  }
  return freezeOwnerGrading({...w,result:r})
}
