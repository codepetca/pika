import { describe,expect,it } from 'vitest'
import { createContextualTestPlan,bootstrapContextualTestFixtureSql } from '../../e2e/helpers/contextual-test-rehearsal'
import { lifecycleScope,lifecycleActors,lifecycleScreens,lifecycleStages,lifecycleFailureStage,lifecycleExchangeLabels,assertLifecycleRecovery,assertLifecycleClearedDisclosure } from '../../e2e/helpers/contextual-test-lifecycle-contract'
import { validateContextualTestLifecycleReceipt,assertContextualTestLifecycleDatabase,contextualTestLifecycleWitnessSql,validateLifecycleResult } from '../../scripts/contextual-test-lifecycle-proof'
import { ContextualTestGatewayPolicy } from '../../scripts/contextual-test-rehearsal-gateway'
import type { ContextualTestRunBinding } from '../../scripts/contextual-test-rehearsal-binding'
import { contextualTestLifecycleFixture } from '../helpers/contextual-test-lifecycle-fixture'
import { reorderLifecycleTests } from '../../e2e/helpers/contextual-test-lifecycle-workflow'
import { verticalScreenshotOptions } from '../../e2e/helpers/contextual-test-vertical-runtime'
const plan=createContextualTestPlan('pika_assignment_list_123456abcdef',lifecycleScope)
const binding={proofScope:lifecycleScope,projectId:plan.projectId,nonce:'0'.repeat(20)+'123456abcdef',sourceSha:plan.sourceSha,sourceTree:plan.sourceTree,
  migrationChainSha256:plan.migrationChainSha256,appOverlaySha256:plan.appOverlaySha256,startedAt:1000,deadline:10000} as ContextualTestRunBinding
function policy() { return new ContextualTestGatewayPolicy(plan,10000,()=>1000,lifecycleScope) }
function created(p:ContextualTestGatewayPolicy) {
  const f=contextualTestLifecycleFixture(binding)
  for(const id of f.result.testIds) {
    p.admit('app','/api/teacher/tests','localhost:3117','POST',{classroom_id:plan.classrooms.classA.id})
    p.observeAppResponse('app','/api/teacher/tests','POST',201,{test:{id,classroom_id:plan.classrooms.classA.id}})
  }
  return f
}
describe('remaining lifecycle scope CPU contracts; no execution or full Tests exit',()=>{
  it('binds only lifecycle to the accepted268 foundation while preserving the267 and262 profiles',()=>{
    expect(plan).toMatchObject({proofScope:lifecycleScope,sourceSha:'4e9c809d1c905a0482fb67880e056e5b8bc5f786',
      sourceTree:'4d225a92b8d9dcfb8cc7118e989c63a46a3c5fbb',migrationChainSha256:'16dfffc916b245a55e7f6750ff26ae274b5f76b696404c6c9995401b38a1c2e0'})
    const prior=createContextualTestPlan(plan.projectId,'vertical-grade-return-v1')
    expect(prior).toMatchObject({sourceSha:'eb4fa32b237d45f500ea4a67ade9a9e5290ea1c0',sourceTree:'ffec2cc82fd88e9819c147b2ab6246f95c28798e',
      migrationChainSha256:'9f08b2db28b413c6f00b3021597d5cd0271600b0d8039abf46f84b50c318b4bd'})
    for(const scope of [undefined,'vertical-v1']as const)expect(createContextualTestPlan(plan.projectId,scope)).toMatchObject({
      sourceSha:'050699bb0f889a533a349b6af415b821ac56d0e3',sourceTree:'f44d726966f322e4e3eb0ef637c6f2c711544d77',
      migrationChainSha256:'ecd31cace5f9dbc892570ebcdb79617b5b7a5bf8a02b98e7283d769a9da840ac'})
    expect(prior).not.toHaveProperty('proofScope');expect(prior).not.toHaveProperty('lifecycleRoster')
  })
  it('accepts migration 265 grade clearing with explicit Return preserved',()=>{
    const f=contextualTestLifecycleFixture(binding)
    expect(()=>validateLifecycleResult(f.result,binding)).not.toThrow()
    expect(()=>assertLifecycleClearedDisclosure(f.result.disclosure.returned,f.result.disclosure.cleared,f.result.testIds[0],f.result.questionIds)).not.toThrow()
  })
  it.each(['reset-return','different-return','stale-score','stale-feedback','stale-grade-time','changed-mc-score','changed-mc-key','changed-mc-selection',
    'changed-mc-metadata','wrong-test','wrong-question','changed-original-response','stale-summary','changed-access','extra-field'])(
    'rejects altered cleared disclosure: %s',defect=>{
      const f=contextualTestLifecycleFixture(binding),cleared=f.result.disclosure.cleared as {
        test:Record<string,unknown>;summary:unknown;question_results:Record<string,unknown>[]}
      if(defect==='reset-return')cleared.test.returned_at=null
      if(defect==='different-return')cleared.test.returned_at=new Date(binding.startedAt+600).toISOString()
      if(defect==='stale-score')cleared.question_results[1].score=4
      if(defect==='stale-feedback')cleared.question_results[1].feedback='Lifecycle manual feedback'
      if(defect==='stale-grade-time')cleared.question_results[1].graded_at=new Date(binding.startedAt+400).toISOString()
      if(defect==='changed-mc-score')cleared.question_results[0].score=null
      if(defect==='changed-mc-key')cleared.question_results[0].correct_option=0
      if(defect==='changed-mc-selection')cleared.question_results[0].selected_option=0
      if(defect==='changed-mc-metadata')cleared.question_results[0].response_monospace=true
      if(defect==='wrong-test')cleared.test.id=f.result.testIds[1]
      if(defect==='wrong-question')cleared.question_results[1].question_id=f.result.testIds[1]
      if(defect==='changed-original-response')cleared.question_results[1].response_text='Changed response'
      if(defect==='stale-summary')cleared.summary={earned_points:9,possible_points:10}
      if(defect==='changed-access')cleared.test.effective_access='open'
      if(defect==='extra-field')cleared.question_results[1].stale_feedback='Lifecycle manual feedback'
      expect(()=>assertLifecycleClearedDisclosure(f.result.disclosure.returned,cleared,f.result.testIds[0],f.result.questionIds)).toThrow()
      expect(()=>validateContextualTestLifecycleReceipt(f.receipt,binding)).toThrow('Lifecycle Test receipt rejected')
    })
  it('does not execute caller getters or Proxy traps while validating disclosure',()=>{
    const f=contextualTestLifecycleFixture(binding);let calls=0
    const getter={get test(){calls++;throw Error('must never execute')}}
    const proxy=new Proxy({}, {ownKeys(){calls++;throw Error('must never execute')}})
    for(const malformed of [getter,proxy])expect(()=>assertLifecycleClearedDisclosure(f.result.disclosure.returned,malformed,f.result.testIds[0],f.result.questionIds)).toThrow()
    expect(calls).toBe(0)
  })
  it.each(['student-status','student-return-time','student-return-owner','teacher-return','old-disclosure-key','before-run-return','after-end-return'])(
    'rejects forged retained Return evidence: %s',defect=>{
      const f=contextualTestLifecycleFixture(binding),rows=f.result.retained.results.students,student=rows.find(s=>s.student_id===plan.actors.memberStudent.id)!
      if(defect==='student-status')student.status='submitted'
      if(defect==='student-return-time')student.returned_at=null
      if(defect==='student-return-owner')student.returned_by=plan.actors.memberTeacher.id
      if(defect==='teacher-return')Object.assign(rows.find(s=>s.student_id===plan.actors.memberTeacher.id)!,{status:'returned',returned_at:student.returned_at,returned_by:student.returned_by})
      if(defect==='old-disclosure-key')f.result.disclosure={returned:f.result.disclosure.returned,retracted:f.result.disclosure.cleared} as never
      if(defect==='before-run-return'||defect==='after-end-return') {
        const timestamp=new Date(defect==='before-run-return'?binding.startedAt-1:f.receipt.endedAt+1).toISOString()
        student.returned_at=timestamp
        for(const disclosure of [f.result.disclosure.returned,f.result.disclosure.cleared]) (disclosure as {test:{returned_at:string}}).test.returned_at=timestamp
      }
      expect(()=>validateContextualTestLifecycleReceipt(f.receipt,binding)).toThrow('Lifecycle Test receipt rejected')
    })
  it.each(['full-return-time','full-return-owner','canonical-return-time','canonical-return-missing','teacher-native-return'])(
    'rejects forged native Return evidence: %s',defect=>{
      const f=contextualTestLifecycleFixture(binding)
      if(defect==='full-return-time')f.after.lifecycle.attempts[0].returned_at=null
      if(defect==='full-return-owner')f.after.lifecycle.attempts[0].returned_by=plan.actors.memberTeacher.id
      if(defect==='canonical-return-time')f.after.attempts[0].returned_at=new Date(binding.startedAt+600).toISOString()
      if(defect==='canonical-return-missing')delete (f.after.attempts[0] as {returned_at?:string|null}).returned_at
      if(defect==='teacher-native-return')f.after.lifecycle.attempts[1].returned_at=f.after.lifecycle.attempts[0].returned_at
      expect(()=>assertContextualTestLifecycleDatabase(f.before,f.after,f.result,binding)).toThrow('Lifecycle Test database proof rejected')
    })
  it('retains the cleared label in its original eight-slot actor/viewport/theme matrix',()=>{
    expect(lifecycleScreens).toHaveLength(8)
    expect(lifecycleScreens[5]).toEqual({label:'lifecycle-learner-cleared',actor:'memberStudent',viewport:'desktop',theme:'dark'})
  })
  it('finishes lifecycle capture transitions without changing timeout, viewport or other scopes',()=>{
    expect(verticalScreenshotOptions(true,1234)).toEqual({fullPage:false,timeout:1234,animations:'disabled'})
    expect(verticalScreenshotOptions(false,1234)).toEqual({fullPage:false,timeout:1234})
  })
  it('moves the second visible Test up using the frozen descending-position order',async()=>{
    const rows=[{title:'Retired fixture A',position:0},{title:'Contextual lifecycle Test',position:1},{title:'Contextual lifecycle scratch',position:2}]
      .sort((a,b)=>b.position-a.position)
    let index=-1,initial=-1,dragging=false,commits=0
    const stages:string[]=[]
    const page={getByRole(role:string,options:{name:string;exact:boolean}){
      expect(role).toBe('button');expect(options.exact).toBe(true)
      index=rows.findIndex(row=>options.name===`Drag to reorder ${row.title}`);expect(index).toBeGreaterThanOrEqual(0)
      return {async focus(){},async press(key:string){
        if(key==='Space'&&!dragging){dragging=true;initial=index}
        else if(key==='ArrowUp'&&dragging){index=Math.max(0,index-1)}
        else if(key==='Space'&&dragging){if(initial!==index){const [row]=rows.splice(initial,1);rows.splice(index,0,row);commits++}dragging=false}
        else throw Error('Unexpected keyboard gesture')
      }}
    }}
    await reorderLifecycleTests(page as never,stage=>{stages.push(stage)})
    expect(stages).toEqual(['reorder-focus','reorder-pickup','reorder-move','reorder-drop'])
    expect(commits).toBe(1)
    expect(rows.map(row=>row.title)).toEqual(['Contextual lifecycle Test','Contextual lifecycle scratch','Retired fixture A'])
  })
  it.each(['graded_at','graded_by','submitted_at','ai_grading_basis','ai_grading_provenance','ai_grading_review','ai_model','ai_reference_answers','ai_suggested_feedback','ai_suggested_score'])(
    'rejects changed saved response metadata: %s',key=>{
      const f=contextualTestLifecycleFixture(binding)
      f.after.lifecycle.responses[1][key]=key==='graded_by'?plan.actors.nonmember.id:key==='ai_suggested_score'?3:'2000-01-01T00:00:00.000Z'
      expect(()=>assertContextualTestLifecycleDatabase(f.before,f.after,f.result,binding)).toThrow('Lifecycle Test database proof rejected')
    })
  it('binds API grading timestamps to the final submission or cleared state',()=>{
    for(const index of [0,1]) {
      const f=contextualTestLifecycleFixture(binding)
      f.result.retained.results.students[0].answers[f.result.questionIds[index]].graded_at='2000-01-01T00:00:00.000Z'
      expect(()=>validateLifecycleResult(f.result,binding)).toThrow()
    }
  })
  it('admits the actual descending-position reorder and rejects the reversed permutation',()=>{
    const p=policy(),f=created(p),[main,scratch]=f.result.testIds
    p.admit('app','/api/teacher/tests/reorder/atomic','localhost:3117','POST',
      {classroom_id:plan.classrooms.classA.id,test_ids:[main,scratch,plan.retiredTestIds[0]]})
    const wrong=policy();created(wrong)
    expect(()=>wrong.admit('app','/api/teacher/tests/reorder/atomic','localhost:3117','POST',
      {classroom_id:plan.classrooms.classA.id,test_ids:[plan.retiredTestIds[0],scratch,main]})).toThrow()
  })
  it('accepts concrete typed receipt and retained-work/tombstone witness',()=>{
    const f=contextualTestLifecycleFixture(binding)
    validateLifecycleResult(f.result,binding)
    expect(validateContextualTestLifecycleReceipt(f.receipt,binding).result).toEqual(f.result)
    expect(()=>assertContextualTestLifecycleDatabase(f.before,f.after,f.result,binding)).not.toThrow()
    expect(lifecycleActors).toHaveLength(7)
  })
  it('has all four real viewport/theme combinations for each complementary actor',()=>{
    for(const actor of ['ownerTeacher','memberStudent'])expect(lifecycleScreens.filter(s=>s.actor===actor).map(s=>`${s.viewport}-${s.theme}`).sort())
      .toEqual(['desktop-dark','desktop-light','mobile-dark','mobile-light'])
  })
  it('projects only fixed lifecycle diagnostics without invoking caller code',()=>{
    for(const stage of lifecycleStages)expect(lifecycleFailureStage(new Error(`Contextual Test lifecycle failed: ${stage}`))).toBe(stage)
    expect(lifecycleFailureStage(new Error('private detail'))).toBeNull()
    const getter={get message(){throw Error('must never execute')}}
    const proxy=new Proxy({}, {getOwnPropertyDescriptor(){throw Error('must never execute')}})
    expect(lifecycleFailureStage(getter)).toBeNull();expect(lifecycleFailureStage(proxy)).toBeNull()
  })
  it('uses fixed read-only native projection and scope-only roster seed',()=>{
    const sql=contextualTestLifecycleWitnessSql(plan)
    expect(sql).toContain('REPEATABLE READ READ ONLY');expect(sql).toContain("'roster'");expect(sql).toContain("'history'")
    expect(sql).not.toMatch(/\b(?:insert|update|delete|alter|create)\b/i)
    const hash='$2b$10$'+'a'.repeat(53)
    expect(bootstrapContextualTestFixtureSql(plan,hash)).toContain('INSERT INTO public.classroom_roster(')
    for(const scope of ['vertical-v1','vertical-grade-return-v1'] as const)expect(bootstrapContextualTestFixtureSql(createContextualTestPlan(plan.projectId,scope),hash)).not.toContain('INSERT INTO public.classroom_roster(')
  })
  it('lets the real roster trigger create its binding and asserts the exact derived identity',()=>{
    const sql=bootstrapContextualTestFixtureSql(plan,'$2b$10$'+'a'.repeat(53))
    expect(sql).not.toMatch(/INSERT INTO public\.classroom_roster_student_bindings/i)
    expect(sql).toContain(`WHERE roster_id='${plan.lifecycleRoster!.id}' AND classroom_id='${plan.classrooms.classA.id}' AND student_id='${plan.actors.memberStudent.id}'`)
    expect(sql).toContain("RAISE EXCEPTION 'fixture_roster_binding_missing'")
    expect(sql).not.toMatch(/ON CONFLICT|DISABLE TRIGGER|ALTER TABLE/i)
  })
  it.each(['missing-event','false-matrix','empty-result','oldscope','unclosed','duplicate-actor','wrong-parent','cas-extra-retry','primitive-response','getter'])('rejects incomplete/forged receipt: %s',defect=>{
    const f=contextualTestLifecycleFixture(binding),r=f.receipt
    if(defect==='missing-event')r.result.exchanges.pop()
    if(defect==='false-matrix')r.artifacts[0].theme='dark' as never
    if(defect==='empty-result')r.result.retained.attempts=[]
    if(defect==='oldscope')r.proofScope='vertical-grade-return-v1'
    if(defect==='unclosed')r.contextsClosed=false
    if(defect==='duplicate-actor')r.actors[1]='ownerTeacher'
    if(defect==='wrong-parent')r.result.exchanges.find(e=>e.label==='return')!.path='/api/teacher/tests/'+r.result.testIds[1]+'/return'
    if(defect==='cas-extra-retry')r.result.exchanges.push(structuredClone(r.result.exchanges.find(e=>e.label==='grade-retry')!))
    if(defect==='primitive-response')r.result.recovery.before.responses[r.result.questionIds[0]]=1 as never
    if(defect==='getter')Object.defineProperty(r.result.recovery,'before',{get(){throw Error('must never execute')}})
    expect(()=>validateContextualTestLifecycleReceipt(r,binding)).toThrow('Lifecycle Test receipt rejected')
  })
  it.each(['lost-work','response-revision','changed-score','changed-membership','tombstone-missing','generation-active','archived','foreign-class','retired-content','unexpected-attempt','history-parent'])('rejects false final witness: %s',defect=>{
    const f=contextualTestLifecycleFixture(binding),a=f.after
    if(defect==='lost-work')a.lifecycle.responses.pop()
    if(defect==='response-revision')a.lifecycle.responses[0].revision=999
    if(defect==='changed-score')a.lifecycle.responses[0].score=0
    if(defect==='changed-membership')a.memberships.pop()
    if(defect==='tombstone-missing')a.lifecycle.roster=[]
    if(defect==='generation-active')a.generations=f.before.generations
    if(defect==='archived')a.classes[0].archived_at='2000-01-01T00:00:00.000Z'
    if(defect==='foreign-class')a.classes[1].updated_at=a.classes[0].updated_at
    if(defect==='retired-content')a.lifecycle.protected_graph_sha256='d'.repeat(64)
    if(defect==='unexpected-attempt')a.attempts.push({...a.attempts[0]})
    if(defect==='history-parent')a.lifecycle.history[0].test_attempt_id=f.result.testIds[1]
    expect(()=>assertContextualTestLifecycleDatabase(f.before,a,f.result,binding)).toThrow('Lifecycle Test database proof rejected')
  })
  it.each(lifecycleExchangeLabels)('binds exact actor/method/endpoint/body for %s',label=>{
    for(const field of ['actor','method','path','request'] as const) {
      const f=contextualTestLifecycleFixture(binding),event=f.result.exchanges.find(e=>e.label===label)!
      if(field==='actor')event.actor=event.actor==='nonmember'?'ownerTeacher':'nonmember'
      if(field==='method')event.method='HEAD'
      if(field==='path')event.path='/api/auth/me'
      if(field==='request')event.request=event.request&&typeof event.request==='object'?{...event.request,unexpected:true}:{}
      expect(()=>validateContextualTestLifecycleReceipt(f.receipt,binding)).toThrow()
    }
  })
  it('preserves950app/4000API independent hard request caps',()=>{
    const p=policy();for(let i=0;i<950;i++)p.admit('app','/api/auth/me','localhost:3117','GET')
    expect(()=>p.admit('app','/api/auth/me','localhost:3117','GET')).toThrow()
    const q=policy();for(let i=0;i<4000;i++)q.admit('api','/rest/v1/users','127.0.0.1:54340','GET')
    expect(()=>q.admit('api','/rest/v1/users','127.0.0.1:54340','GET')).toThrow()
  })
  it('allows standalone preview only for acknowledged parents in the scoped class',()=>{
    const p=policy(),f=created(p)
    p.admit('app',`/classrooms/${plan.classrooms.classA.id}/tests/${f.result.testIds[0]}/preview`,'localhost:3117','GET')
    const foreign=policy();created(foreign)
    expect(()=>foreign.admit('app',`/classrooms/${plan.classrooms.classB.id}/tests/${f.result.testIds[0]}/preview`,'localhost:3117','GET')).toThrow()
    const unseen=policy();created(unseen)
    expect(()=>unseen.admit('app',`/classrooms/${plan.classrooms.classA.id}/tests/${plan.retiredTestIds[0]}/preview`,'localhost:3117','GET')).toThrow()
  })
  it('rejects stale recovery/revisions or altered typed values',()=>{
    const f=contextualTestLifecycleFixture(binding),{before,after}=f.result.recovery
    expect(()=>assertLifecycleRecovery(before,{...after,draft_revision:before.draft_revision-1})).toThrow()
    after.responses[f.result.questionIds[1]]={question_type:'open_response',response_text:'Changed'}
    expect(()=>validateLifecycleResult(f.result,binding)).toThrow()
  })
  it('admits only the exact scope-specific permission fixture paths/bodies once',()=>{
    const p=policy();created(p)
    p.admit('app',`/api/teacher/classrooms/${plan.classrooms.classA.id}/roster/remove`,'localhost:3117','POST',{roster_ids:[plan.lifecycleRoster!.id]})
    p.admit('app','/api/student/classrooms/join','localhost:3117','POST',{classCode:plan.classrooms.classA.classCode,firstName:'Synthetic',lastName:'Learner'})
    p.admit('app',`/api/teacher/classrooms/${plan.classrooms.classA.id}`,'localhost:3117','PATCH',{archived:true})
    p.admit('app',`/api/teacher/classrooms/${plan.classrooms.classA.id}`,'localhost:3117','PATCH',{archived:false})
    expect(p.receipt().firstFailure).toBeNull()
    expect(()=>p.admit('app',`/api/teacher/classrooms/${plan.classrooms.classA.id}/roster/remove`,'localhost:3117','POST',{roster_ids:[plan.lifecycleRoster!.id]})).toThrow()
  })
  it.each(['foreign-class','foreign-roster','extra-field','restore-first','third-create','unseen-parent','provider','legacy-delete'])('rejects broadened gateway capability: %s',defect=>{
    const p=policy(),f=created(p),c=plan.classrooms.classA.id
    const attempt=()=>{
      if(defect==='foreign-class')p.admit('app',`/api/teacher/classrooms/${plan.classrooms.classB.id}`,'localhost:3117','PATCH',{archived:true})
      if(defect==='foreign-roster')p.admit('app',`/api/teacher/classrooms/${c}/roster/remove`,'localhost:3117','POST',{roster_ids:[f.result.testIds[0]]})
      if(defect==='extra-field')p.admit('app',`/api/teacher/classrooms/${c}`,'localhost:3117','PATCH',{archived:true,title:'surprise'})
      if(defect==='restore-first')p.admit('app',`/api/teacher/classrooms/${c}`,'localhost:3117','PATCH',{archived:false})
      if(defect==='third-create')p.admit('app','/api/teacher/tests','localhost:3117','POST',{classroom_id:c})
      if(defect==='unseen-parent')p.admit('app',`/api/teacher/tests/${plan.retiredTestIds[0]}/return`,'localhost:3117','POST',{student_ids:[plan.actors.memberStudent.id]})
      if(defect==='provider')p.admit('app',`/api/teacher/tests/${f.result.testIds[0]}/auto-grade`,'localhost:3117','POST',{})
      if(defect==='legacy-delete')p.admit('app',`/api/teacher/classrooms/${c}/roster/${plan.lifecycleRoster!.id}`,'localhost:3117','DELETE')
    }
    expect(attempt).toThrow();expect(p.receipt().firstFailure).not.toBeNull()
  })
  it('caps genuine CAS sequence at perturbation,409,oneUIretry,clear',()=>{
    const p=policy(),f=created(p)
    for(const label of ['grade-perturbation','grade-conflict','grade-retry','clear-grade']) {
      const e=f.result.exchanges.find(e=>e.label===label)!;p.admit('app',e.path,'localhost:3117',e.method,e.request)
    }
    const e=f.result.exchanges.find(e=>e.label==='grade-retry')!
    expect(()=>p.admit('app',e.path,'localhost:3117',e.method,e.request)).toThrow()
  })
})
