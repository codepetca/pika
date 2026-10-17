/** Closed, separate lifecycle acceptance. CPU validation cannot claim a run. */
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { createContextualTestPlan, contextualTestWitnessSql, type RehearsalPlan, type RehearsalWitness } from '../e2e/helpers/contextual-test-rehearsal'
import { lifecycleScope, lifecycleActors, lifecycleLabels, lifecycleScreens, lifecycleExchangeLabels, lifecycleText,lifecycleReference,
  assertLifecycleAttempt, assertLifecycleRecovery, assertLifecycleGraphEquality, type LifecycleResult } from '../e2e/helpers/contextual-test-lifecycle-contract'
import { data, denseArray } from './contextual-test-vertical-proof'
import type { ContextualTestRunBinding } from './contextual-test-rehearsal-binding'
export type { LifecycleResult } from '../e2e/helpers/contextual-test-lifecycle-contract'
const hex = /^[a-f0-9]{64}$/, uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
/** Reject caller code before traversing the variable JSON DTOs. */
function plain(value: unknown, depth=0, budget={nodes:0}): unknown {
  assert(depth<32 && ++budget.nodes<=30000)
  if(value===null || typeof value==='boolean')return value
  if(typeof value==='string') { assert(value.length<=16384); return value }
  if(typeof value==='number') { assert(Number.isFinite(value)); return value }
  if(Array.isArray(value)) {
    const length=Object.getOwnPropertyDescriptor(value,'length')?.value
    assert(Number.isSafeInteger(length)&&length<=1000)
    return denseArray(value,length).map(v=>plain(v,depth+1,budget))
  }
  return Object.fromEntries(Object.entries(data(value)).map(([key,v])=>[key,plain(v,depth+1,budget)]))
}
export function validateLifecycleResult(raw: unknown,binding: Pick<ContextualTestRunBinding,'projectId'>): LifecycleResult {
  const value=plain(raw) as LifecycleResult
  data(value,['classroomId','ownerId','testIds','questionIds','recovery','retained','archive','disclosure','exchanges'])
  const p=createContextualTestPlan(binding.projectId,lifecycleScope), [main,scratch]=denseArray(value.testIds,2) as string[]
  assert(value.classroomId===p.classrooms.classA.id && value.ownerId===p.actors.ownerTeacher.id)
  assert(main!==scratch && [main,scratch].every(id=>uuid.test(id)&&!p.retiredTestIds.includes(id)))
  assert(denseArray(value.questionIds,2).every(id=>typeof id==='string'&&uuid.test(id)) && value.questionIds[0]!==value.questionIds[1])
  data(value.recovery,['before','after']); assertLifecycleRecovery(value.recovery.before,value.recovery.after)
  assertLifecycleAttempt(value.recovery.before,main,p.actors.memberStudent.id,value.questionIds,lifecycleText('memberStudent'),false)
  assertLifecycleAttempt(value.recovery.after,main,p.actors.memberStudent.id,value.questionIds,lifecycleText('memberStudent'),false)
  data(value.retained,['attempts','results','history']); denseArray(value.retained.attempts,2);denseArray(value.retained.history,2)
  for(const [index,actor] of ['memberStudent','memberTeacher'].entries()) {
    const id=p.actors[actor as 'memberStudent'|'memberTeacher'].id
    assertLifecycleAttempt(value.retained.attempts[index],main,id,value.questionIds,lifecycleText(actor),true)
    data(value.retained.attempts[index],['id','test_id','student_id','responses','is_submitted','submitted_at','created_at','updated_at','draft_revision'])
    const history=value.retained.history[index];data(history,['attemptId','history']);assert.equal(history.attemptId,value.retained.attempts[index].id)
    assert(Array.isArray(history.history)&&history.history.length>0&&history.history.length<=1000)
    assert(history.history.every(h=>h.test_attempt_id===history.attemptId&&uuid.test(String(h.id))))
    const rows=value.retained.results.students.filter(s=>s.student_id===id); assert.equal(rows.length,1)
    const row=rows[0]; assert(row.returned_at===null && row.returned_by===null && row.status==='submitted')
    assert.deepEqual(Object.keys(row.answers).sort(),[...value.questionIds].sort())
    for(const [qindex,qid] of value.questionIds.entries()) {
      const a=row.answers[qid]; assert(uuid.test(a.response_id) && Number.isSafeInteger(a.response_revision)&&a.response_revision>0 && a.is_draft===false)
      assert(a.score===(qindex===0?5:null) && a.feedback===null && a.selected_option===(qindex===0?1:null)
        && a.response_text===(qindex===0?null:lifecycleText(actor)))
      assert.equal(a.graded_at,qindex===0?value.retained.attempts[index].submitted_at:null)
    }
  }
  assert.equal(value.retained.results.test.id,main)
  assert.deepEqual(value.retained.results.questions.map(q=>[q.id,q.question_type]),[[value.questionIds[0],'multiple_choice'],[value.questionIds[1],'open_response']])
  assert.deepEqual(value.retained.results.students.map(s=>s.student_id).sort(),[p.actors.memberStudent.id,p.actors.memberTeacher.id,p.actors.ownerStudent.id].sort())
  assert.deepEqual(value.retained.results.students.find(s=>s.student_id===p.actors.ownerStudent.id)!.answers,{})
  data(value.archive,['before','after']); assertLifecycleGraphEquality(value.archive.before,value.archive.after)
  assert.equal(value.archive.before.test.id,main)
  assert.deepEqual(value.archive.before.students.map(s=>s.student_id).sort(),[p.actors.memberTeacher.id,p.actors.ownerStudent.id].sort())
  assert.deepEqual(value.archive.before.questions,value.retained.results.questions)
  for(const row of value.archive.before.students)assert.deepEqual(row,value.retained.results.students.find(s=>s.student_id===row.student_id))
  data(value.disclosure,['returned','retracted'])
  const returned=data(value.disclosure.returned),returnedTest=data(returned.test),summary=data(returned.summary)
  assert(returnedTest.id===main&&typeof returnedTest.returned_at==='string'&&Number.isFinite(Date.parse(returnedTest.returned_at))&&summary.earned_points===9&&summary.possible_points===10)
  const disclosed=denseArray(returned.question_results,2).map(raw=>data(raw))
  for(const [index,qid] of value.questionIds.entries()) {
    const rows=disclosed.filter(q=>q.question_id===qid);assert.equal(rows.length,1)
    assert(rows[0].score===(index===0?5:4)&&rows[0].feedback===(index===0?null:'Lifecycle manual feedback'))
    if(index===1)assert.equal(rows[0].response_text,lifecycleText('memberStudent'))
  }
  const retracted=data(value.disclosure.retracted),retractedTest=data(retracted.test);assert(retractedTest.id===main&&retractedTest.returned_at===null)
  const hidden=(v:unknown):void=>{if(v&&typeof v==='object')for(const [key,nested]of Object.entries(v)){
    assert(!['score','feedback','correct_option','answer_key','sample_solution','question_results','summary'].includes(key)||nested===null);hidden(nested)}}
  hidden(retracted)
  const exchanges=denseArray(value.exchanges,lifecycleExchangeLabels.length) as LifecycleResult['exchanges']
  const byLabel=new Map<string,LifecycleResult['exchanges'][number]>(exchanges.map((e,index)=>{
    data(e,['label','actor','via','method','path','status','request','response']); assert.equal(e.label,lifecycleExchangeLabels[index])
    assert(['screen','conflict-perturbation','permission-fixture','denied-probe'].includes(e.via))
    assert.equal(e.status,e.label==='grade-conflict'||e.label==='unpublish-refused'||e.label==='foreign-reorder'?409
      :e.label==='rejoin-refused'?500:e.label.startsWith('submit-')||e.label.startsWith('scratch-')&&e.label.includes('submit')?201
      :['self-owner','foreign-parent','member-owner','nonmember-read','nonmember-start'].includes(e.label)||e.label.startsWith('revoked-')||e.label.startsWith('archived-')?403:200)
    assert(e.path.startsWith('/api/') && !e.path.includes('?') && ['GET','POST','PATCH','DELETE'].includes(e.method))
    return [e.label,e] as const
  }))
  const at=(label:string)=>byLabel.get(label)!
  for(const [label,id,tail] of [['publish-main',main,'publish'],['publish-scratch',scratch,'publish'],['republish-scratch',scratch,'publish'],['return',main,'return'],['unsubmit',scratch,'unsubmit'],
    ['reset-one',scratch,'students/attempts/bulk-delete'],['reset-many',scratch,'students/attempts/bulk-delete'],['unpublish-scratch',scratch,'unpublish']] as const) {
    assert.equal(at(label).path,`/api/teacher/tests/${id}/${tail}`); assert.equal(at(label).via,'screen'); assert.equal(at(label).method,'POST')
  }
  const single={student_ids:[p.actors.memberStudent.id]}, multi={student_ids:[p.actors.memberStudent.id,p.actors.memberTeacher.id]}
  for(const label of ['return','unsubmit','reset-one'])assert.deepEqual(at(label).request,single)
  const selected=data(at('reset-many').request,['student_ids']);assert.deepEqual(denseArray(selected.student_ids,2).sort(),multi.student_ids.sort())
  const resetOne=at('reset-one').response as {deleted_attempts:number}, resetMany=at('reset-many').response as {deleted_attempts:number}
  assert.equal(resetOne.deleted_attempts,1); assert.equal(resetMany.deleted_attempts,2)
  assert.equal((at('unsubmit').response as {unsubmitted_count:number}).unsubmitted_count,1)
  assert.equal(at('delete-scratch').path,`/api/teacher/tests/${scratch}`); assert.equal(at('delete-scratch').method,'DELETE')
  const gradeLabels=['grade-perturbation','grade-conflict','grade-retry','clear-grade']
  const grades=gradeLabels.map(label=>{
    const e=at(label); assert.equal(e.path,`/api/teacher/tests/${main}/students/${p.actors.memberStudent.id}/grades`); assert.equal(e.method,'PATCH')
    assert.equal(e.via,label==='grade-perturbation'?'conflict-perturbation':'screen')
    const request=data(e.request,['grades']), g=data(denseArray(request.grades,1)[0],label==='clear-grade'?['question_id','response_id','expected_response_revision','clear_grade']:['question_id','response_id','expected_response_revision','score','feedback']); assert.equal(g.question_id,value.questionIds[1])
    assert(uuid.test(String(g.response_id)) && Number.isSafeInteger(g.expected_response_revision))
    return g
  })
  assert.equal(grades[0].score,2); assert.equal(grades[1].score,4); assert.equal(grades[2].score,4); assert.equal(grades[3].clear_grade,true)
  assert(grades.every(g=>g.response_id===grades[0].response_id))
  assert.equal(grades[1].expected_response_revision,grades[0].expected_response_revision)
  assert.equal(grades[2].expected_response_revision,Number(grades[0].expected_response_revision)+1)
  assert.equal(grades[3].expected_response_revision,Number(grades[0].expected_response_revision)+2)
  const retainedOpen=value.retained.results.students.find(s=>s.student_id===p.actors.memberStudent.id)!.answers[value.questionIds[1]]
  assert.equal(retainedOpen.response_id,grades[0].response_id); assert.equal(retainedOpen.response_revision,Number(grades[0].expected_response_revision)+3)
  assert.deepEqual(at('remove-member').request,{roster_ids:[p.lifecycleRoster!.id]})
  assert.equal(at('remove-member').path,`/api/teacher/classrooms/${p.classrooms.classA.id}/roster/remove`)
  assert.equal((at('remove-member').response as {removed_count:number}).removed_count,1)
  assert.equal((at('rejoin-refused').response as {error:string}).error,'Failed to join classroom')
  for(const [label,archived] of [['archive',true],['unarchive',false]] as const) {
    assert.equal(at(label).path,`/api/teacher/classrooms/${p.classrooms.classA.id}`); assert.deepEqual(at(label).request,{archived})
    assert.equal(at(label).via,'permission-fixture')
  }
  // Every permission and lifecycle event is paired to its actual authenticated
  // context and exact endpoint/body. An unrelated 403 cannot satisfy a boundary.
  const expectExchange=(label:string,actor:string,via:string,method:string,path:string,request?:unknown)=>{
    const e=at(label); assert.equal(e.actor,actor);assert.equal(e.via,via);assert.equal(e.method,method);assert.equal(e.path,path)
    if(request!==undefined)assert.deepEqual(e.request,request)
    const response=data(e.response)
    if(e.status>=400)assert(typeof response.error==='string'&&response.error.length>0)
    return response
  }
  for(const label of ['publish-main','publish-scratch','republish-scratch']) {
    const id=label==='publish-main'?main:scratch,e=at(label),body=data(e.request,['status','draft_version'])
    assert(body.status==='closed'&&Number.isSafeInteger(body.draft_version)&&Number(body.draft_version)>0)
    const response=expectExchange(label,'ownerTeacher','screen','POST',`/api/teacher/tests/${id}/publish`),test=data(response.test)
    assert(test.id===id&&test.classroom_id===p.classrooms.classA.id&&test.status==='closed')
  }
  for(const [label,id,actor] of [['submit-memberStudent',main,'memberStudent'],['submit-memberTeacher',main,'memberTeacher'],['scratch-single-submit',scratch,'memberStudent'],['scratch-submit-memberStudent',scratch,'memberStudent'],['scratch-submit-memberTeacher',scratch,'memberTeacher']] as const) {
    const response=expectExchange(label,actor,'screen','POST',`/api/student/tests/${id}/respond`),request=data(at(label).request,['expected_revision','responses'])
    assert(Number.isSafeInteger(request.expected_revision)&&Number(request.expected_revision)>0&&response.success===true&&Number.isSafeInteger(response.draft_revision)&&Number(response.draft_revision)>0)
    const values=Object.values(data(request.responses));assert.equal(values.length,2)
    assert(values.some(raw=>{const v=data(raw);return v.question_type==='multiple_choice'&&v.selected_option===1}))
    assert(values.some(raw=>{const v=data(raw);return v.question_type==='open_response'&&v.response_text===lifecycleText(actor)}))
    if(id===main)assert.deepEqual(request.responses,value.retained.attempts[actor==='memberStudent'?0:1].responses)
  }
  assert.equal(expectExchange('reorder','ownerTeacher','screen','POST','/api/teacher/tests/reorder/atomic',
    {classroom_id:p.classrooms.classA.id,test_ids:[main,scratch,p.retiredTestIds[0]]}).success,true)
  for(const label of ['return','unsubmit','reset-one','reset-many','delete-scratch','unpublish-scratch'])assert.equal(at(label).actor,'ownerTeacher')
  const returnAck=expectExchange('return','ownerTeacher','screen','POST',`/api/teacher/tests/${main}/return`,single)
  assert(returnAck.returned_count===1&&returnAck.already_returned_count===0&&returnAck.skipped_count===0)
  const unsubmitAck=data(at('unsubmit').response);assert(unsubmitAck.unsubmitted_count===1&&unsubmitAck.skipped_count===0&&unsubmitAck.skipped_enrollment_count===0)
  for(const [label,count] of [['reset-one',1],['reset-many',2]] as const) {
    const response=data(at(label).response);assert(response.success===true&&response.requested_count===count&&response.deleted_student_count===count&&response.deleted_responses===(label==='reset-one'?0:4))
  }
  const unpublish=expectExchange('unpublish-scratch','ownerTeacher','screen','POST',`/api/teacher/tests/${scratch}/unpublish`,{}),draft=data(unpublish.test)
  assert(draft.id===scratch&&draft.classroom_id===p.classrooms.classA.id&&draft.status==='draft'&&Number.isSafeInteger(unpublish.draft_version)&&Number(unpublish.draft_version)>0)
  const deleted=expectExchange('delete-scratch','ownerTeacher','screen','DELETE',`/api/teacher/tests/${scratch}`,null);assert(deleted.success===true&&deleted.responses_count===0)
  for(const label of gradeLabels) {
    const response=expectExchange(label,label==='grade-perturbation'||label==='clear-grade'?'ownerTeacher':'ownerTeacherPeer',label==='grade-perturbation'?'conflict-perturbation':'screen','PATCH',`/api/teacher/tests/${main}/students/${p.actors.memberStudent.id}/grades`)
    // Clear is performed by the primary session after returning work.
    if(label==='clear-grade')assert.equal(at(label).actor,'ownerTeacher')
    if(label!=='grade-conflict') {
      const saved=data(denseArray(response.responses,1)[0]);assert(response.saved_count===1&&saved.id===grades[0].response_id)
      assert.equal(saved.revision,Number(grades[0].expected_response_revision)+(label==='grade-perturbation'?1:label==='grade-retry'?2:3))
    }
  }
  const sid=p.actors.memberStudent.id,tid=p.actors.memberTeacher.id
  expectExchange('unpublish-refused','ownerTeacher','denied-probe','POST',`/api/teacher/tests/${main}/unpublish`,{})
  expectExchange('self-owner','ownerTeacher','denied-probe','POST',`/api/student/tests/${main}/start`,{})
  expectExchange('foreign-parent','ownerTeacher','denied-probe','PATCH',`/api/teacher/tests/${p.retiredTestIds[1]}`,{title:'Forbidden'})
  expectExchange('foreign-reorder','ownerTeacher','denied-probe','POST','/api/teacher/tests/reorder/atomic',{classroom_id:p.classrooms.classA.id,test_ids:[main,p.retiredTestIds[1]]})
  expectExchange('member-owner','memberTeacher','denied-probe','GET',`/api/teacher/tests/${main}/results`,null)
  expectExchange('nonmember-read','nonmember','denied-probe','GET',`/api/student/tests/${main}`,null)
  expectExchange('nonmember-start','nonmember','denied-probe','POST',`/api/student/tests/${main}/start`,{})
  const removal=expectExchange('remove-member','ownerTeacher','permission-fixture','POST',`/api/teacher/classrooms/${p.classrooms.classA.id}/roster/remove`,{roster_ids:[p.lifecycleRoster!.id]})
  assert(removal.success===true&&removal.requested_count===1&&removal.removed_count===1)
  const forbidden={expected_revision:value.retained.attempts[0].draft_revision,responses:value.retained.attempts[0].responses}
  expectExchange('revoked-cached-read','memberStudent','denied-probe','GET',`/api/student/tests/${main}/attempt`,null)
  expectExchange('revoked-cached-save','memberStudent','denied-probe','PATCH',`/api/student/tests/${main}/attempt`,forbidden)
  expectExchange('revoked-cached-submit','memberStudent','denied-probe','POST',`/api/student/tests/${main}/respond`,forbidden)
  expectExchange('revoked-fresh-read','memberStudent','denied-probe','GET',`/api/student/tests/${main}`,null)
  expectExchange('revoked-fresh-start','memberStudent','denied-probe','POST',`/api/student/tests/${main}/start`,{})
  expectExchange('rejoin-refused','memberStudent','permission-fixture','POST','/api/student/classrooms/join',{classCode:p.classrooms.classA.classCode,firstName:'Synthetic',lastName:'Learner'})
  const teacherDraft={expected_revision:value.retained.attempts[1].draft_revision,responses:value.retained.attempts[1].responses}
  expectExchange('archived-cached-read','memberTeacher','denied-probe','GET',`/api/student/tests/${main}`,null)
  expectExchange('archived-cached-save','memberTeacher','denied-probe','PATCH',`/api/student/tests/${main}/attempt`,teacherDraft)
  expectExchange('archived-owner-save','ownerTeacher','denied-probe','PATCH',`/api/teacher/tests/${main}`,{title:'Forbidden archive edit'})
  expectExchange('archived-fresh-read','memberTeacher','denied-probe','GET',`/api/student/tests/${main}`,null)
  expectExchange('archived-fresh-start','memberTeacher','denied-probe','POST',`/api/student/tests/${main}/start`,{})
  for(const [label,archived]of [['archive',true],['unarchive',false]]as const) {
    const response=expectExchange(label,'ownerTeacher','permission-fixture','PATCH',`/api/teacher/classrooms/${p.classrooms.classA.id}`,{archived}),classroom=data(response.classroom)
    assert(classroom.id===p.classrooms.classA.id&&(archived?typeof classroom.archived_at==='string'&&Number.isFinite(Date.parse(classroom.archived_at)):classroom.archived_at===null))
  }
  return value
}
export function validateContextualTestLifecycleReceipt(raw: unknown,binding: ContextualTestRunBinding) {
  try {
    const bound=data(binding); assert.equal(bound.proofScope,lifecycleScope); assert(!Object.hasOwn(bound,'sqlControl'))
    const p=createContextualTestPlan(binding.projectId,lifecycleScope), r=data(raw,['version','proofScope','projectId','nonce','sourceSha','sourceTree','appOverlaySha256','deadline','endedAt','outcome','contextsClosed','pageErrors','actors','result','failureStage','artifacts'])
    for(const key of ['sourceSha','sourceTree','migrationChainSha256','appOverlaySha256'] as const)assert.equal(binding[key],p[key])
    for(const key of ['projectId','nonce','sourceSha','sourceTree','appOverlaySha256','deadline'] as const)assert.equal(r[key],binding[key])
    assert(r.version===1 && r.proofScope===lifecycleScope && r.outcome==='passed' && r.contextsClosed===true && r.pageErrors===0 && r.failureStage===null)
    assert(Number.isSafeInteger(r.endedAt) && Number(r.endedAt)>=binding.startedAt && Number(r.endedAt)<binding.deadline)
    assert(/^[a-f0-9]{32}$/.test(binding.nonce)&&binding.nonce.endsWith(p.projectId.slice(-12)))
    assert.deepEqual(denseArray(r.actors,lifecycleActors.length),[...lifecycleActors])
    const result=validateLifecycleResult(r.result,binding)
    const artifacts=denseArray(r.artifacts,lifecycleLabels.length).map((raw,index)=>{
      const a=data(raw,['label','kind','bytes','sha256','actor','viewport','theme']),scene=lifecycleScreens[index]
      for(const key of ['label','actor','viewport','theme'] as const)assert.equal(a[key],scene[key])
      assert(a.kind==='png' && Number.isSafeInteger(a.bytes)&&Number(a.bytes)>0&&Number(a.bytes)<=4194304&&hex.test(String(a.sha256)))
      return {...a} as {label:string;kind:'png';bytes:number;sha256:string;actor:string;viewport:string;theme:string}
    })
    return {...r,result,artifacts}
  } catch { throw Error('Lifecycle Test receipt rejected') }
}
export type LifecycleWitness = RehearsalWitness & { lifecycle: {
  protected_graph_sha256:string; roster: Record<string,unknown>[]; bindings:Record<string,unknown>[];
  attempts: Record<string,unknown>[]; responses: Record<string,unknown>[]; history:Record<string,unknown>[];
  tests:Record<string,unknown>[];questions:Record<string,unknown>[];availability:Record<string,unknown>[];enrollments:Record<string,unknown>[];
} }
export function contextualTestLifecycleWitnessSql(plan: RehearsalPlan): string {
  const expected=createContextualTestPlan(plan.projectId,lifecycleScope)
  assert(plan.lifecycleRoster && isDeepStrictEqual(plan,expected))
  const retired=plan.retiredTestIds.map(id=>{assert(uuid.test(id));return `'${id}'`}).join(','), classes=Object.values(plan.classrooms).map(c=>`'${c.id}'`).join(',')
  const projection=`'lifecycle',jsonb_build_object(
'protected_graph_sha256',encode(extensions.digest(jsonb_build_object(
 'tests',coalesce((select jsonb_agg(to_jsonb(t)-'position'-'updated_at' order by id) from t where id in (${retired})),'[]'::jsonb),
 'questions',coalesce((select jsonb_agg(to_jsonb(q) order by id) from public.test_questions q where test_id in (${retired})),'[]'::jsonb),
 'drafts',coalesce((select jsonb_agg(to_jsonb(d) order by id) from public.assessment_drafts d where assessment_type='test' and assessment_id in (${retired})),'[]'::jsonb)
)::text,'sha256'),'hex'),
'roster',coalesce((select jsonb_agg(to_jsonb(r) order by id) from public.classroom_roster r where classroom_id in (${classes})),'[]'::jsonb),
'bindings',coalesce((select jsonb_agg(to_jsonb(b) order by roster_id) from public.classroom_roster_student_bindings b where classroom_id in (${classes})),'[]'::jsonb),
'tests',coalesce((select jsonb_agg(to_jsonb(t) order by id) from t),'[]'::jsonb),
'questions',coalesce((select jsonb_agg(to_jsonb(q) order by id) from public.test_questions q where test_id in (select id from t)),'[]'::jsonb),
'availability',coalesce((select jsonb_agg(to_jsonb(v) order by test_id,student_id) from public.test_student_availability v where test_id in (select id from t)),'[]'::jsonb),
'enrollments',coalesce((select jsonb_agg(to_jsonb(e) order by id) from public.classroom_enrollments e where classroom_id in (${classes})),'[]'::jsonb),
'attempts',coalesce((select jsonb_agg(to_jsonb(a) order by id) from a),'[]'::jsonb),
'responses',coalesce((select jsonb_agg(to_jsonb(r) order by id) from public.test_responses r where test_id in (select id from t)),'[]'::jsonb),
'history',coalesce((select jsonb_agg(to_jsonb(h) order by id) from public.test_attempt_history h where test_attempt_id in (select id from a)),'[]'::jsonb)),`
  const sql=contextualTestWitnessSql(plan),marker="'version',1,'work_graph_sha256'"
  assert.equal(sql.split(marker).length,2); return sql.replace(marker,`'version',1,${projection}'work_graph_sha256'`)
}
export function assertContextualTestLifecycleDatabase(before: LifecycleWitness,after: LifecycleWitness,rawResult: LifecycleResult,
  binding: Pick<ContextualTestRunBinding,'projectId'|'startedAt'|'deadline'|'proofScope'>) {
  try {
    assert.equal(binding.proofScope,lifecycleScope); const r=validateLifecycleResult(rawResult,binding),p=createContextualTestPlan(binding.projectId,lifecycleScope),[main,scratch]=r.testIds
    assert(before.version===1&&after.version===1&&before.tests.length===2&&after.tests.length===3)
    assert.deepEqual(before.tests.map(t=>t.id).sort(),[...p.retiredTestIds].sort())
    assert(before.tests.every(t=>t.retired&&t.status==='draft') && before.attempts.length===0 && before.response_count===0 && before.history_count===0 && before.question_counts.length===0)
    assert(!after.tests.some(t=>t.id===scratch)); assert(after.tests.some(t=>t.id===main&&t.classroom_id===r.classroomId&&!t.retired&&t.status==='closed'&&t.position===2))
    for(const old of before.tests) {
      const fresh=after.tests.find(t=>t.id===old.id); assert(fresh)
      assert.deepEqual(fresh,old)
    }
    assert(hex.test(before.lifecycle.protected_graph_sha256)&&before.lifecycle.protected_graph_sha256===after.lifecycle.protected_graph_sha256)
    assert.deepEqual(after.question_counts,[{test_id:main,count:2}]); assert.equal(after.response_count,4)
    assert.equal(after.attempts.length,2); assert.equal(after.lifecycle.attempts.length,2); assert.equal(after.lifecycle.responses.length,4)
    assert.equal(after.lifecycle.tests.length,3);assert.equal(after.lifecycle.questions.length,2)
    const mainRows=after.lifecycle.tests.filter(t=>t.id===main);assert.equal(mainRows.length,1)
    const mainRow=mainRows[0];assert(mainRow.title==='Contextual lifecycle Test'&&mainRow.classroom_id===r.classroomId&&mainRow.status==='closed')
    const docs=denseArray(mainRow.documents,1).map(raw=>data(raw));assert(docs[0].source==='text'&&docs[0].title==='Synthetic reference'&&docs[0].content===lifecycleReference)
    assert(uuid.test(String(docs[0].id))&&!Object.hasOwn(docs[0],'url')&&!Object.hasOwn(docs[0],'storage_path')&&!Object.hasOwn(docs[0],'managed_object_id'))
    for(const [index,id]of r.questionIds.entries()) {
      const rows=after.lifecycle.questions.filter(q=>q.id===id);assert.equal(rows.length,1)
      assert(rows[0].test_id===main&&rows[0].points===5&&rows[0].question_type===(index===0?'multiple_choice':'open_response'))
    }
    assert.equal(after.lifecycle.availability.length,2)
    for(const student of [p.actors.memberStudent.id,p.actors.memberTeacher.id])assert(after.lifecycle.availability.some(v=>v.test_id===main&&v.student_id===student&&v.state==='closed'))
    assert(before.objects.length===0&&after.objects.length===0&&before.lifecycle.responses.length===0&&before.lifecycle.attempts.length===0&&before.lifecycle.history.length===0)
    for(const saved of r.retained.attempts) {
      const rows=after.lifecycle.attempts.filter(a=>a.id===saved.id); assert.equal(rows.length,1); const a=rows[0]
      assert(a.test_id===main&&a.student_id===saved.student_id&&a.draft_revision===saved.draft_revision&&a.is_submitted===true&&a.returned_at===null&&a.returned_by===null)
      assert.deepEqual(a.responses,saved.responses)
      for(const [key,value]of Object.entries(saved))assert.deepEqual(a[key],value)
      const ownerRow=r.retained.results.students.find(s=>s.student_id===saved.student_id)!
      for(const questionId of r.questionIds) {
        const answer=ownerRow.answers[questionId],response=after.lifecycle.responses.filter(v=>v.id===answer.response_id);assert.equal(response.length,1)
        const d=response[0]; assert(d.test_id===main&&d.student_id===saved.student_id&&d.question_id===questionId&&d.revision===answer.response_revision)
        for(const key of ['score','feedback','selected_option','response_text','graded_at'] as const)assert.equal(d[key],answer[key])
        assert.equal(d.submitted_at,saved.submitted_at)
        // This scope only auto-scores MC answers and clears manual open-response grades.
        // No provider grading or surviving manual grader attribution is permitted.
        for(const key of ['graded_by','ai_grading_basis','ai_grading_provenance','ai_grading_review','ai_model','ai_reference_answers','ai_suggested_feedback','ai_suggested_score'])assert.equal(d[key],null)
      }
    }
    const order=(rows:Record<string,unknown>[])=>[...rows].sort((a,b)=>String(a.id).localeCompare(String(b.id)))
    assert.deepEqual(order(after.lifecycle.history),order(r.retained.history.flatMap(h=>h.history)))
    assert.equal(after.history_count,after.lifecycle.history.length); assert(after.history_count>=2)
    assert(after.lifecycle.history.every(h=>after.attempts.some(a=>h.test_attempt_id===a.id)))
    assert.equal(before.lifecycle.roster.length,1); assert.equal(after.lifecycle.roster.length,1)
    const old=before.lifecycle.roster[0],removed=after.lifecycle.roster[0],roster=p.lifecycleRoster!
    assert(old.id===roster.id&&old.classroom_id===r.classroomId&&old.removed_at===null&&old.removed_student_id===null)
    const membership=before.memberships.find(m=>m.classroom_id===r.classroomId&&m.student_id===roster.studentId)!
    const enrollment=before.lifecycle.enrollments.find(e=>e.id===membership.generation_id);assert(enrollment)
    assert.deepEqual(after.lifecycle.enrollments,before.lifecycle.enrollments.filter(e=>e.id!==enrollment.id))
    assert(removed.id===roster.id&&removed.classroom_id===r.classroomId&&removed.email===old.email&&removed.removed_student_id===roster.studentId
      &&removed.removed_enrollment_id===membership.generation_id&&typeof removed.removed_at==='string')
    const removedTime=Date.parse(removed.removed_at);assert(removedTime>=binding.startedAt&&removedTime<binding.deadline)
    assert.equal(removed.removed_enrolled_at,enrollment.created_at)
    assert.deepEqual(removed.retained_manual_attendance_marks,enrollment.manual_attendance_marks)
    const changed=new Set(['removed_at','removed_student_id','removed_enrollment_id','removed_enrolled_at','retained_manual_attendance_marks','retained_attendance_participant_active','updated_at'])
    for(const [key,value]of Object.entries(old))if(!changed.has(key))assert.deepEqual(removed[key],value)
    assert.deepEqual(after.lifecycle.bindings,before.lifecycle.bindings)
    assert.deepEqual(after.memberships,before.memberships.filter(m=>m!==membership))
    assert.deepEqual(after.generations,before.generations.map(g=>g.generation_id===membership.generation_id?{...g,state:'removed'}:g))
    for(const oldClass of before.classes) {
      const fresh=after.classes.find(c=>c.id===oldClass.id)!;assert(fresh.archived_at===null)
      if(oldClass.id===p.classrooms.classB.id)assert.deepEqual(fresh,oldClass)
      else assert(Date.parse(fresh.updated_at)>Date.parse(oldClass.updated_at)&&Date.parse(fresh.updated_at)>=binding.startedAt&&Date.parse(fresh.updated_at)<binding.deadline)
    }
  } catch { throw Error('Lifecycle Test database proof rejected') }
}
