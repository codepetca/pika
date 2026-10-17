/** CPU-only synthetic proof data; never a native acceptance receipt. */
import { createContextualTestPlan } from '../../e2e/helpers/contextual-test-rehearsal'
import { lifecycleActors,lifecycleScreens,lifecycleExchangeLabels,lifecycleText,lifecycleReference,type LifecycleResult,type LifecycleExchange } from '../../e2e/helpers/contextual-test-lifecycle-contract'
import type { ContextualTestRunBinding } from '../../scripts/contextual-test-rehearsal-binding'
import type { LifecycleWitness } from '../../scripts/contextual-test-lifecycle-proof'
export function contextualTestLifecycleFixture(binding: Pick<ContextualTestRunBinding,'projectId'|'startedAt'|'deadline'> & Partial<ContextualTestRunBinding>) {
  const p=createContextualTestPlan(binding.projectId,'lifecycle-permissions-v1'),uid=(n:number)=>`60000000-0000-4000-8000-${String(n).padStart(12,'0')}`
  const [main,scratch,mc,open]=[1,2,3,4].map(uid),student=p.actors.memberStudent.id,teacher=p.actors.memberTeacher.id,c=p.classrooms.classA.id
  const returnedAt=new Date(binding.startedAt+500).toISOString()
  const attempts=[student,teacher].map((student_id,i)=>({id:uid(10+i),test_id:main,student_id,draft_revision:3,is_submitted:true,
    submitted_at:new Date(binding.startedAt+100).toISOString(),created_at:new Date(binding.startedAt).toISOString(),updated_at:new Date(binding.startedAt+100).toISOString(),
    responses:{[mc]:{question_type:'multiple_choice',selected_option:1},[open]:{question_type:'open_response',response_text:lifecycleText(i===0?'memberStudent':'memberTeacher')}}}))
  const results={test:{id:main},questions:[{id:mc,question_type:'multiple_choice'},{id:open,question_type:'open_response'}],students:[student,teacher].map((student_id,i)=>({student_id,status:i===0?'returned':'submitted',returned_at:i===0?returnedAt:null,returned_by:i===0?p.actors.ownerTeacher.id:null,answers:{
    [mc]:{response_id:uid(20+i*2),response_revision:1,score:5,feedback:null,selected_option:1,response_text:null,graded_at:attempts[i].submitted_at,is_draft:false},
    [open]:{response_id:uid(21+i*2),response_revision:i===0?4:1,score:null,feedback:null,selected_option:null,response_text:lifecycleText(i===0?'memberStudent':'memberTeacher'),graded_at:null,is_draft:false}}}))}
  results.students.push({student_id:p.actors.ownerStudent.id,status:'not_started',returned_at:null,returned_by:null,answers:{}})
  const exchanges:LifecycleExchange[]=lifecycleExchangeLabels.map(label=>({label,actor:'ownerTeacher',via:'screen',method:'POST',path:`/api/teacher/tests/${main}/publish`,status:200,request:{},response:{}}))
  const e=(label:string)=>exchanges.find(e=>e.label===label)!
  for(const [label,id,tail] of [['publish-main',main,'publish'],['publish-scratch',scratch,'publish'],['republish-scratch',scratch,'publish'],['return',main,'return'],['unsubmit',scratch,'unsubmit'],['reset-one',scratch,'students/attempts/bulk-delete'],['reset-many',scratch,'students/attempts/bulk-delete'],['unpublish-refused',main,'unpublish'],['unpublish-scratch',scratch,'unpublish']] as const)e(label).path=`/api/teacher/tests/${id}/${tail}`
  for(const label of ['return','unsubmit','reset-one'])e(label).request={student_ids:[student]}
  e('reset-many').request={student_ids:[student,teacher]};e('reset-one').response={deleted_attempts:1};e('reset-many').response={deleted_attempts:2};e('unsubmit').response={unsubmitted_count:1}
  Object.assign(e('delete-scratch'),{path:`/api/teacher/tests/${scratch}`,method:'DELETE'})
  for(const [i,label] of ['grade-perturbation','grade-conflict','grade-retry','clear-grade'].entries())Object.assign(e(label),{
    via:i===0?'conflict-perturbation':'screen',method:'PATCH',path:`/api/teacher/tests/${main}/students/${student}/grades`,
    request:{grades:[{question_id:open,response_id:uid(21),expected_response_revision:[1,1,2,3][i],...(i===3?{clear_grade:true}:{score:i===0?2:4,feedback:i===0?'Concurrent owner session':'Lifecycle manual feedback'})}]}})
  Object.assign(e('remove-member'),{via:'permission-fixture',path:`/api/teacher/classrooms/${c}/roster/remove`,request:{roster_ids:[p.lifecycleRoster!.id]},response:{success:true,requested_count:1,removed_count:1}})
  Object.assign(e('rejoin-refused'),{via:'permission-fixture',path:'/api/student/classrooms/join',response:{error:'Failed to join classroom'}})
  for(const [label,archived] of [['archive',true],['unarchive',false]] as const)Object.assign(e(label),{via:'permission-fixture',method:'PATCH',path:`/api/teacher/classrooms/${c}`,request:{archived}})
  for(const x of exchanges)x.status=x.label==='grade-conflict'||x.label==='unpublish-refused'||x.label==='foreign-reorder'?409:x.label==='rejoin-refused'?500
    :x.label.startsWith('submit-')||x.label.startsWith('scratch-')&&x.label.includes('submit')?201
    :['self-owner','foreign-parent','member-owner','nonmember-read','nonmember-start'].includes(x.label)||x.label.startsWith('revoked-')||x.label.startsWith('archived-')?403:200
  for(const x of exchanges)if(x.status>=400)x.response={error:x.label==='rejoin-refused'?'Failed to join classroom':'Forbidden'}
  for(const label of ['publish-main','publish-scratch','republish-scratch']) {
    const id=label==='publish-main'?main:scratch;e(label).request={status:'closed',draft_version:2};e(label).response={test:{id,classroom_id:c,status:'closed'}}
  }
  e('unpublish-scratch').response={test:{id:scratch,classroom_id:c,status:'draft'},draft_version:3}
  e('delete-scratch').request=null;e('delete-scratch').response={success:true,responses_count:0}
  e('return').response={returned_count:1,already_returned_count:0,skipped_count:0}
  e('unsubmit').response={unsubmitted_count:1,skipped_count:0,skipped_enrollment_count:0}
  for(const [label,count]of [['reset-one',1],['reset-many',2]]as const)e(label).response={success:true,requested_count:count,deleted_student_count:count,deleted_attempts:count,deleted_responses:label==='reset-one'?0:4}
  for(const [i,label]of ['grade-perturbation','grade-conflict','grade-retry','clear-grade'].entries()) {
    e(label).actor=i===1||i===2?'ownerTeacherPeer':'ownerTeacher'
    if(i!==1)e(label).response={saved_count:1,responses:[{id:uid(21),revision:i===0?2:i===2?3:4}]}
  }
  for(const [label,id,actor]of [['submit-memberStudent',main,'memberStudent'],['submit-memberTeacher',main,'memberTeacher'],['scratch-single-submit',scratch,'memberStudent'],['scratch-submit-memberStudent',scratch,'memberStudent'],['scratch-submit-memberTeacher',scratch,'memberTeacher']]as const)Object.assign(e(label),{
    actor,method:'POST',path:`/api/student/tests/${id}/respond`,request:{expected_revision:2,responses:attempts[actor==='memberStudent'?0:1].responses},response:{success:true,draft_revision:3}})
  Object.assign(e('reorder'),{path:'/api/teacher/tests/reorder/atomic',request:{classroom_id:c,test_ids:[main,scratch,p.retiredTestIds[0]]},response:{success:true}})
  const deny=(label:string,actor:LifecycleExchange['actor'],method:string,path:string,request:unknown)=>Object.assign(e(label),{actor,via:'denied-probe',method,path,request})
  deny('unpublish-refused','ownerTeacher','POST',`/api/teacher/tests/${main}/unpublish`,{})
  deny('self-owner','ownerTeacher','POST',`/api/student/tests/${main}/start`,{})
  deny('foreign-parent','ownerTeacher','PATCH',`/api/teacher/tests/${p.retiredTestIds[1]}`,{title:'Forbidden'})
  deny('foreign-reorder','ownerTeacher','POST','/api/teacher/tests/reorder/atomic',{classroom_id:c,test_ids:[main,p.retiredTestIds[1]]})
  deny('member-owner','memberTeacher','GET',`/api/teacher/tests/${main}/results`,null)
  deny('nonmember-read','nonmember','GET',`/api/student/tests/${main}`,null);deny('nonmember-start','nonmember','POST',`/api/student/tests/${main}/start`,{})
  const forbidden={expected_revision:attempts[0].draft_revision,responses:attempts[0].responses},teacherDraft={expected_revision:attempts[1].draft_revision,responses:attempts[1].responses}
  deny('revoked-cached-read','memberStudent','GET',`/api/student/tests/${main}/attempt`,null)
  deny('revoked-cached-save','memberStudent','PATCH',`/api/student/tests/${main}/attempt`,forbidden);deny('revoked-cached-submit','memberStudent','POST',`/api/student/tests/${main}/respond`,forbidden)
  deny('revoked-fresh-read','memberStudent','GET',`/api/student/tests/${main}`,null);deny('revoked-fresh-start','memberStudent','POST',`/api/student/tests/${main}/start`,{})
  e('rejoin-refused').actor='memberStudent';e('rejoin-refused').request={classCode:p.classrooms.classA.classCode,firstName:'Synthetic',lastName:'Learner'}
  deny('archived-cached-read','memberTeacher','GET',`/api/student/tests/${main}`,null);deny('archived-cached-save','memberTeacher','PATCH',`/api/student/tests/${main}/attempt`,teacherDraft)
  deny('archived-owner-save','ownerTeacher','PATCH',`/api/teacher/tests/${main}`,{title:'Forbidden archive edit'})
  deny('archived-fresh-read','memberTeacher','GET',`/api/student/tests/${main}`,null);deny('archived-fresh-start','memberTeacher','POST',`/api/student/tests/${main}/start`,{})
  e('archive').response={classroom:{id:c,archived_at:new Date(binding.startedAt+1000).toISOString()}};e('unarchive').response={classroom:{id:c,archived_at:null}}
  const history=attempts.map((a,i)=>({attemptId:a.id,history:[{id:uid(300+i),test_attempt_id:a.id}]}))
  const beforeRecovery={...structuredClone(attempts[0]),is_submitted:false,submitted_at:null,draft_revision:2}
  const returnedDisclosure={test:{id:main,status:'closed',effective_access:'closed',returned_at:returnedAt},summary:{earned_points:9,possible_points:10},question_results:[
    {question_id:mc,question_type:'multiple_choice',question_text:'Choose the second option.',points:5,options:['Alpha','Beta'],response_max_chars:5000,response_monospace:false,sample_solution:null,correct_option:1,selected_option:1,response_text:null,score:5,feedback:null,graded_at:attempts[0].submitted_at,is_correct:true},
    {question_id:open,question_type:'open_response',question_text:'Explain your reasoning.',points:5,options:[],response_max_chars:5000,response_monospace:false,sample_solution:null,correct_option:null,selected_option:null,response_text:lifecycleText('memberStudent'),score:4,feedback:'Lifecycle manual feedback',graded_at:new Date(binding.startedAt+400).toISOString(),is_correct:null}]}
  const clearedDisclosure={...structuredClone(returnedDisclosure),summary:null,question_results:returnedDisclosure.question_results.map(q=>q.question_id===open?{...q,score:null,feedback:null,graded_at:null}:structuredClone(q))}
  const result:LifecycleResult={classroomId:c,ownerId:p.actors.ownerTeacher.id,testIds:[main,scratch],questionIds:[mc,open],recovery:{before:beforeRecovery,after:structuredClone(beforeRecovery)},
    retained:{attempts,results,history},archive:{before:{...structuredClone(results),students:structuredClone(results.students.filter(s=>s.student_id!==student))},after:{...structuredClone(results),students:structuredClone(results.students.filter(s=>s.student_id!==student))}},
    disclosure:{returned:returnedDisclosure,cleared:clearedDisclosure},exchanges}
  const memberships=Object.values(p.classrooms).flatMap(cl=>['ownerTeacher','ownerStudent','memberTeacher','memberStudent'].map((actor,i)=>({classroom_id:cl.id,student_id:p.actors[actor as keyof typeof p.actors].id,generation_id:uid(100+(cl.id===c?0:10)+i),ledger_state:'active'})))
  const oldTime=new Date(binding.startedAt-1000).toISOString(),newTime=new Date(binding.startedAt+1000).toISOString()
  const roster={id:p.lifecycleRoster!.id,classroom_id:c,email:p.actors.memberStudent.email,removed_at:null,removed_student_id:null}
  const before:LifecycleWitness={version:1,work_graph_sha256:'a'.repeat(64),tests:p.retiredTestIds.map((id,i)=>({id,classroom_id:i===0?c:p.classrooms.classB.id,status:'draft',position:0,retired:true})),attempts:[],memberships,generations:memberships.map(m=>({generation_id:m.generation_id,state:'active'})),question_counts:[],classes:Object.values(p.classrooms).map(cl=>({id:cl.id,archived_at:null,updated_at:oldTime})),response_count:0,history_count:0,objects:[],lifecycle:{protected_graph_sha256:'b'.repeat(64),roster:[roster],bindings:[{roster_id:roster.id,classroom_id:c,student_id:student}],attempts:[],responses:[],history:[],tests:[],questions:[],availability:[],enrollments:memberships.map(m=>({id:m.generation_id,classroom_id:m.classroom_id,student_id:m.student_id,created_at:oldTime,manual_attendance_marks:{}}))}}
  before.lifecycle.tests=structuredClone(before.tests)
  const after:LifecycleWitness=structuredClone(before),removedMembership=memberships.find(m=>m.student_id===student&&m.classroom_id===c)!
  after.tests.push({id:main,classroom_id:c,status:'closed',position:2,retired:false});after.question_counts=[{test_id:main,count:2}];after.response_count=4
  after.attempts=attempts.map(a=>({id:a.id,test_id:a.test_id,student_id:a.student_id,draft_revision:a.draft_revision,is_submitted:a.is_submitted,returned_at:results.students.find(s=>s.student_id===a.student_id)!.returned_at}))
  after.lifecycle.attempts=attempts.map(a=>({...structuredClone(a),returned_at:results.students.find(s=>s.student_id===a.student_id)!.returned_at,returned_by:results.students.find(s=>s.student_id===a.student_id)!.returned_by}))
  after.lifecycle.responses=results.students.flatMap(s=>Object.entries(s.answers).map(([question_id,a])=>({id:a.response_id,test_id:main,student_id:s.student_id,question_id,revision:a.response_revision,score:a.score,feedback:a.feedback,selected_option:a.selected_option,response_text:a.response_text,
    graded_at:a.graded_at,graded_by:null,submitted_at:attempts.find(v=>v.student_id===s.student_id)!.submitted_at,
    ai_grading_basis:null,ai_grading_provenance:null,ai_grading_review:null,ai_model:null,ai_reference_answers:null,ai_suggested_feedback:null,ai_suggested_score:null})))
  after.lifecycle.history=attempts.map((a,i)=>({id:uid(300+i),test_attempt_id:a.id}));after.history_count=2
  after.lifecycle.roster=[{...roster,removed_at:newTime,removed_student_id:student,removed_enrollment_id:removedMembership.generation_id,removed_enrolled_at:oldTime,retained_manual_attendance_marks:{}}]
  after.lifecycle.tests=[...structuredClone(before.tests),{id:main,classroom_id:c,title:'Contextual lifecycle Test',status:'closed',documents:[{id:uid(99),source:'text',title:'Synthetic reference',content:lifecycleReference}]}]
  after.lifecycle.questions=[{id:mc,test_id:main,question_type:'multiple_choice',points:5},{id:open,test_id:main,question_type:'open_response',points:5}]
  after.lifecycle.availability=[student,teacher].map(student_id=>({test_id:main,student_id,state:'closed'}))
  after.lifecycle.enrollments=after.lifecycle.enrollments.filter(e=>e.id!==removedMembership.generation_id)
  after.memberships=after.memberships.filter(m=>m.generation_id!==removedMembership.generation_id)
  after.generations=after.generations.map(g=>g.generation_id===removedMembership.generation_id?{...g,state:'removed'}:g)
  after.classes.find(cl=>cl.id===c)!.updated_at=newTime
  const receipt={version:1,proofScope:'lifecycle-permissions-v1',projectId:p.projectId,nonce:binding.nonce,sourceSha:p.sourceSha,sourceTree:p.sourceTree,appOverlaySha256:p.appOverlaySha256,
    deadline:binding.deadline,endedAt:binding.startedAt+2000,outcome:'passed',contextsClosed:true,pageErrors:0,actors:[...lifecycleActors],result,failureStage:null,
    artifacts:lifecycleScreens.map(scene=>({...scene,kind:'png',bytes:10,sha256:'c'.repeat(64)}))}
  return {plan:p,result,receipt,before,after}
}
