import { describe,expect,it } from 'vitest'
import { createContextualTestPlan,bootstrapContextualTestFixtureSql } from '../../e2e/helpers/contextual-test-rehearsal'
import { lifecycleScope,lifecycleActors,lifecycleScreens,lifecycleStages,lifecycleFailureStage,lifecycleExchangeLabels,assertLifecycleRecovery } from '../../e2e/helpers/contextual-test-lifecycle-contract'
import { validateContextualTestLifecycleReceipt,assertContextualTestLifecycleDatabase,contextualTestLifecycleWitnessSql,validateLifecycleResult } from '../../scripts/contextual-test-lifecycle-proof'
import { ContextualTestGatewayPolicy } from '../../scripts/contextual-test-rehearsal-gateway'
import type { ContextualTestRunBinding } from '../../scripts/contextual-test-rehearsal-binding'
import { contextualTestLifecycleFixture } from '../helpers/contextual-test-lifecycle-fixture'
import { reorderLifecycleTests } from '../../e2e/helpers/contextual-test-lifecycle-workflow'
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
  it('moves the second visible Test up using the frozen descending-position order',async()=>{
    const rows=[{title:'Retired fixture A',position:0},{title:'Contextual lifecycle Test',position:1},{title:'Contextual lifecycle scratch',position:2}]
      .sort((a,b)=>b.position-a.position)
    let index=-1,initial=-1,dragging=false,commits=0
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
    await reorderLifecycleTests(page as never)
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
