import { describe,it,expect,vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createContextualTestLearnerWorkflow,type TestLearnerRpcClient } from '../../src/lib/server/contextual-test-learner-workflow'
import assert from 'node:assert/strict'
import { ApiError } from '../../src/lib/api-error'
import { AssignmentListLifecycleError } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newClassroomHotLifecycleFixture,hotLifecycleDigest,hotGraphFunctions,assertHotLifecycleGraphChange,parseHotLifecycleGraph,type HotGraph } from '../../scripts/contextual-classroom-hot-lifecycle-proof-fixture'
import { classroomHotLifecycleNativePlan,validateClassroomHotLifecycleNativeSql,runClassroomHotLifecycleNativeContracts,
  runClassroomHotLifecycleNativeRaces,validateHotLifecycleGeneratedTypes } from '../../scripts/contextual-classroom-hot-lifecycle-native-contracts'
import { buildClassroomHotLifecycleNativeContractsManifest } from '../../scripts/contextual-test-draft-save-native-contracts'
import type { DraftSaveDriver,DraftSaveTarget } from '../../scripts/check-contextual-test-draft-save-db-contracts'
import { createHotLifecycleProofTransport,hotLifecycleFailureShape,parseClassroomHotLifecycleArgs } from '../../scripts/check-contextual-classroom-hot-lifecycle'
const original=newAssignmentListProofFixture(),head='a'.repeat(40)
const plan=()=>classroomHotLifecycleNativePlan(original,head,process.cwd())
function target(m:ReturnType<typeof plan>,phase:'contracts'|'committed'):DraftSaveTarget {return Object.freeze({projectId:m.projectId,containerProjectLabel:m.projectId,
  disposable:true,apiUrl:'http://127.0.0.1:54331',databaseHost:'127.0.0.1',databasePort:54332,containerId:'b'.repeat(64),reviewedHead:head,
  migrationManifestSha256:m.migrationManifestSha256,reviewedSourceSha256:m.sourceSha256,acceptedManifestSha256:hotLifecycleDigest(JSON.stringify(m[phase]))})}
describe('closed268 hot lifecycle proof; CPU evidence is not native acceptance',()=>{
  it('qualifies catalog aggregate columns independently of PL/pgSQL variables',()=>{
    expect(hotGraphFunctions).toContain("string_agg(x.definition,'' order by x.definition)")
    expect(hotGraphFunctions).not.toContain("string_agg(v,'' order by v)")
    expect(hotGraphFunctions).not.toContain('#variable_conflict')
    expect(hotGraphFunctions).toContain('declare relation_row record;')
    expect(hotGraphFunctions).toContain('pg_get_triggerdef(trigger_row.oid)')
    expect(hotGraphFunctions).not.toMatch(/\bt\./)
  })
  it('retains only closed error labels across outer cleanup wrapping',()=>{
    const command=Object.assign(new Error('secret query'),{stderr:'ERROR:  42702: private field\nDETAIL: secret value'})
    expect(hotLifecycleFailureShape(new AssignmentListLifecycleError({stage:'case',error:command},[]))).toEqual({kind:'command',status:0,sqlstate:'42702'})
    expect(hotLifecycleFailureShape(Object.assign(new Error('private'),{stderr:'ERROR:  SECRET: private'}))).toEqual({kind:'command',status:0,sqlstate:'unknown'})
    expect(hotLifecycleFailureShape(new ApiError(403,'private'))).toEqual({kind:'api',status:403,sqlstate:'unknown'})
    expect(hotLifecycleFailureShape(new SyntaxError('private'))).toEqual({kind:'syntax',status:0,sqlstate:'unknown'})
    expect(hotLifecycleFailureShape(new assert.AssertionError({message:'private',actual:'secret',expected:'hidden',operator:'strictEqual'}))).toEqual({kind:'assertion',status:0,sqlstate:'unknown'})
    expect(hotLifecycleFailureShape(Object.assign(new Error('private'),{stderr:'ERROR:  42703: private column'}))).toEqual({kind:'command',status:0,sqlstate:'42703'})
    for(const code of ['ENOBUFS','ERR_CHILD_PROCESS_STDIO_MAXBUFFER'])expect(hotLifecycleFailureShape(Object.assign(new Error('private'),{code}))).toEqual({kind:'output-limit',status:0,sqlstate:'unknown'})
    expect(hotLifecycleFailureShape(Object.assign(new Error('private'),{code:'ETIMEDOUT'}))).toEqual({kind:'timeout',status:0,sqlstate:'unknown'})
  })
  it('compacts every non-target table without dropping row or column coverage',()=>{
    expect(hotGraphFunctions).toContain("n.nspname in ('public','private','storage')")
    expect(hotGraphFunctions).toContain('jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)')
    expect(hotGraphFunctions).toContain("relation_row.relname in ('classrooms','classroom_archive_revisions')")
    expect(hotGraphFunctions).toContain("jsonb_array_length(v),'sha256',encode(sha256(convert_to(v::text,'UTF8')),'hex')")
    const m=plan(),before=initialGraph(m),after=change(before,m.fixture.classes[0].id,true)
    expect(()=>assertHotLifecycleGraphChange(before,after,m.fixture.classes[0].id,true)).not.toThrow()
    for(const key of ['public.announcements','private.synthetic_witness','storage.objects']) {
      const baseline={...before,[key]:{count:1,sha256:'a'.repeat(64)}},valid={...after,[key]:{count:1,sha256:'a'.repeat(64)}}
      for(const bad of [{count:2,sha256:'a'.repeat(64)},{count:1,sha256:'b'.repeat(64)}])
        expect(()=>assertHotLifecycleGraphChange(baseline,{...valid,[key]:bad},m.fixture.classes[0].id,true)).toThrow()
      const missing={...valid};delete missing[key]
      expect(()=>assertHotLifecycleGraphChange(baseline,missing,m.fixture.classes[0].id,true)).toThrow()
      expect(()=>assertHotLifecycleGraphChange(before,{...after,[key+'extra']:{count:0,sha256:'c'.repeat(64)}},m.fixture.classes[0].id,true)).toThrow()
    }
  })
  it.each([null,[],{count:-1,sha256:'a'.repeat(64)},{count:1.5,sha256:'a'.repeat(64)},
    {count:0,sha256:'bad'},{count:0,sha256:'a'.repeat(64),extra:true}])('rejects malformed compact witnesses %j',witness=>{
    const graph={...initialGraph(plan()),'public.announcements':witness}
    expect(()=>parseHotLifecycleGraph(graph)).toThrow()
  })
  it('runs learner inspect through the installed SDK and real application decoder offline',async()=>{
    const f=newClassroomHotLifecycleFixture(original),key='header.'+Buffer.from(JSON.stringify({iss:'supabase-demo',role:'service_role'})).toString('base64url')+'.signature'
    const target={API_URL:'http://127.0.0.1:54331',DB_URL:'postgresql://postgres:synthetic@127.0.0.1:54332/postgres',SERVICE_ROLE_KEY:key}
    const raw=vi.fn(async()=>new Response(JSON.stringify({version:1,actor_id:f.actors[2].id,classroom_id:f.classes[0].id,
      test_id:f.testId,subject_id:f.actors[2].id,operation:'inspect',result:{access_mode:'member'}}),{headers:{'content-type':'application/json'}}))
    const guard=vi.fn(async()=>{}),transport=createHotLifecycleProofTransport(f,target,raw,guard)
    transport.plan('/rest/v1/rpc/test_learner_workflow_v1',{p_actor_id:f.actors[2].id,p_test_id:f.testId,p_classroom_id:null,p_operation:'inspect',p_payload:{}})
    const client=createClient(target.API_URL,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:transport.fetch}})
    const flow=createContextualTestLearnerWorkflow({supabase:client as unknown as TestLearnerRpcClient,actorId:f.actors[2].id,testId:f.testId,deadline:Date.now()+25000})
    await expect(flow.inspect()).resolves.toEqual({access_mode:'member'});expect(flow.classroomId).toBe(f.classes[0].id)
    transport.done();expect(raw).toHaveBeenCalledOnce();expect(guard).toHaveBeenCalledOnce();expect(transport.counts.rpc).toBe(1)
    expect(transport.diagnostic()).toMatchObject({phase:'complete',failure:'none',rpc:1})
  })
  it('retains the failing guard phase when the SDK masks its private error',async()=>{
    const f=newClassroomHotLifecycleFixture(original),key='header.'+Buffer.from(JSON.stringify({iss:'supabase-demo',role:'service_role'})).toString('base64url')+'.signature'
    const target={API_URL:'http://127.0.0.1:54331',DB_URL:'postgresql://postgres:synthetic@127.0.0.1:54332/postgres',SERVICE_ROLE_KEY:key},raw=vi.fn<typeof fetch>()
    const transport=createHotLifecycleProofTransport(f,target,raw,async()=>{throw new Error('secret guard details')})
    transport.plan('/rest/v1/rpc/test_learner_workflow_v1',{p_actor_id:f.actors[2].id,p_test_id:f.testId,p_classroom_id:null,p_operation:'inspect',p_payload:{}})
    const client=createClient(target.API_URL,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:transport.fetch}})
    const flow=createContextualTestLearnerWorkflow({supabase:client as unknown as TestLearnerRpcClient,actorId:f.actors[2].id,testId:f.testId})
    await expect(flow.inspect()).rejects.toMatchObject({statusCode:503});expect(raw).not.toHaveBeenCalled()
    expect(transport.diagnostic()).toEqual({phase:'guard',failure:'guard',rpc:1,bytes:0})
  })
  it('has deterministic disjoint finite identities and no managed objects',()=>{
    const f=newClassroomHotLifecycleFixture(original)
    expect(f).toEqual(newClassroomHotLifecycleFixture(original));expect(Object.isFrozen(f)).toBe(true)
    expect(f.actors.map(a=>a.role)).toEqual(['teacher','student','student','teacher'])
    expect(f.classes).toHaveLength(6);expect(f.allocatedIds.every(id=>!(original.allocatedIds as readonly string[]).includes(id))).toBe(true)
  })
  it('binds exact001–268 and exposes only finite source SQL',()=>{
    const m=plan();expect(m.migrations).toHaveLength(268);expect(m.nativeVerified).toBe(false)
    expect(validateClassroomHotLifecycleNativeSql(m,m.setup)).toBe(true)
    expect(validateClassroomHotLifecycleNativeSql(m,'select 1;')).toBe(false)
    expect(validateClassroomHotLifecycleNativeSql(structuredClone(m),m.setup)).toBe(false)
    expect(m.committed.schedules.map(s=>s.label)).toEqual(['two-restores-one-slot','restore-before-create','transfer-before-old-owner-archive','archive-before-restore'])
    expect(m.committed.schedules.every(s=>s.observeSql.includes('pg_blocking_pids'))).toBe(true)
    const engine=buildClassroomHotLifecycleNativeContractsManifest(original,head,process.cwd())
    expect(engine.capabilities.sessions).toBe(2);expect(engine.capabilities.totalMs).toBe(900000)
    expect(engine.privilege.catalog).toContain('set_classroom_hot_archive_for_owner_v1')
  })
  it('closes the rollback session on malformed completion',async()=>{
    const m=plan(),t=target(m,'contracts'),close=vi.fn(async()=>{})
    const d:DraftSaveDriver={verifyTarget:async()=>t,openSession:async name=>({name,execute:async()=>[{result:{}}],rollbackAndClose:close})}
    await expect(runClassroomHotLifecycleNativeContracts(m,t,d)).rejects.toThrow();expect(close).toHaveBeenCalledOnce()
  })
  it('never releases an unobserved blocking contender and settles both sessions',async()=>{
    const m=plan(),t=target(m,'committed'),commits=vi.fn();let reject:(e:Error)=>void=()=>{}
    const close=vi.fn(async()=>{reject(new Error('Owned session closed'))}),before=initialGraph(m),held=change(before,m.committed.schedules[0].classroomId,false)
    const d:DraftSaveDriver={verifyTarget:async()=>t,openSession:async name=>({name,rollbackAndClose:close,execute:async sql=>{
      const schedule=m.committed.schedules[0]
      if(sql===m.committed.snapshot)return[{result:before}]
      if(sql===schedule.holderSql)return[{result:{label:schedule.label,pid:11,state:held}}]
      if(sql===schedule.contenderSql)return new Promise((_,no)=>{reject=no})
      if(sql===schedule.observeSql)return[{result:{blocked:false}}]
      commits();return[{result:{}}]
    }})}
    await expect(runClassroomHotLifecycleNativeRaces(m,t,d)).rejects.toThrow()
    expect(commits).not.toHaveBeenCalled();expect(close).toHaveBeenCalledTimes(2)
  })
  it('accepts all four observed source-owned schedules and rejects forged graph changes',async()=>{
    const m=plan(),t=target(m,'committed');let state=initialGraph(m),index=0,resolve:(v:readonly {result?:unknown}[])=>void=()=>{}
    const close=vi.fn(async()=>{})
    const d:DraftSaveDriver={verifyTarget:async()=>t,openSession:async name=>({name,rollbackAndClose:close,execute:async sql=>{
      const s=m.committed.schedules[index]
      if(sql===m.committed.snapshot)return[{result:structuredClone(state)}]
      if(sql===s.holderSql){state=change(state,s.classroomId,s.archived,s.label==='transfer-before-old-owner-archive'?m.fixture.actors[3].id:undefined);return[{result:{label:s.label,pid:11,state:structuredClone(state)}}]}
      if(sql===s.contenderSql)return new Promise(yes=>{resolve=yes})
      if(sql===s.observeSql)return[{result:{blocked:true,holder_pid:11,contender_pid:12}}]
      expect(sql).toBe(s.commitSql);if(s.code==='00000')state=change(state,s.classroomId,false)
      resolve([{result:{label:s.label,code:s.code,message:s.message,state:structuredClone(state)}}]);index++
      return[{result:{committed:true}}]
    }})}
    const receipt=await runClassroomHotLifecycleNativeRaces(m,t,d);expect(receipt.schedules).toHaveLength(4);expect(close).toHaveBeenCalledTimes(8)
    const before=initialGraph(m),after=change(before,m.fixture.classes[0].id,true);after.__catalog='tampered'
    expect(()=>assertHotLifecycleGraphChange(before,after,m.fixture.classes[0].id,true)).toThrow()
  })
  it('requires genuine exact268 RPC metadata rather than an old generated artifact',()=>{
    expect(()=>validateHotLifecycleGeneratedTypes('export type Database = {}')).toThrow()
    expect(()=>validateHotLifecycleGeneratedTypes('set_classroom_hot_archive_for_owner_v1: { Args: { p_actor_id: string; p_archived: boolean; p_classroom_id: string }; Returns: Json }')).not.toThrow()
    expect(()=>validateHotLifecycleGeneratedTypes('set_classroom_hot_archive_for_owner_v1: { Args: { p_actor_id: string; p_archived: string; p_classroom_id: string }; Returns: Json }')).toThrow()
    expect(()=>validateHotLifecycleGeneratedTypes('set_classroom_hot_archive_for_owner_v1: { Args: { p_actor_id: string; p_archived?: boolean; p_classroom_id: string }; Returns: Json }')).toThrow()
  })
  it('admits only the exact fresh isolated API and closed actor/parent/body set',async()=>{
    const f=newClassroomHotLifecycleFixture(original),key='header.'+Buffer.from(JSON.stringify({iss:'supabase-demo',role:'service_role'})).toString('base64url')+'.signature'
    const target={API_URL:'http://127.0.0.1:54331',DB_URL:'postgresql://postgres:private@127.0.0.1:54332/postgres',SERVICE_ROLE_KEY:key}
    const raw=vi.fn(async()=>new Response('{}',{status:200})),guard=vi.fn(async()=>{}),transport=createHotLifecycleProofTransport(f,target,raw,guard)
    const body={p_actor_id:f.actors[0].id,p_classroom_id:f.classes[0].id,p_archived:true},path='/rest/v1/rpc/set_classroom_hot_archive_for_owner_v1'
    expect(()=>transport.plan(path,{...body,p_actor_id:original.people[0].id})).toThrow()
    expect(()=>transport.plan(path,{...body,p_classroom_id:f.classes[1].id})).toThrow()
    expect(()=>transport.plan(path,{...body,extra:true})).toThrow()
    transport.plan(path,body)
    await expect(transport.fetch('http://127.0.0.1:54321'+path,{method:'POST',body:JSON.stringify(body)})).rejects.toThrow()
    expect(raw).not.toHaveBeenCalled();expect(guard).not.toHaveBeenCalled()
    const headers={apikey:key,authorization:`Bearer ${key}`}
    const response=await transport.fetch(target.API_URL+path,{method:'POST',headers,body:JSON.stringify(body)})
    expect(response.status).toBe(200);transport.done();expect(raw).toHaveBeenCalledOnce();expect(guard).toHaveBeenCalledOnce()
    expect(()=>createHotLifecycleProofTransport(f,{...target,API_URL:'http://127.0.0.1:54321'},raw,guard)).toThrow()
  })
  it('rejects redirects, forged learner operations and oversized complete responses',async()=>{
    const f=newClassroomHotLifecycleFixture(original),key='header.'+Buffer.from(JSON.stringify({iss:'supabase-demo',role:'service_role'})).toString('base64url')+'.signature',target={API_URL:'http://127.0.0.1:54331',DB_URL:'postgresql://postgres:private@127.0.0.1:54332/postgres',SERVICE_ROLE_KEY:key}
    const headers={apikey:key,authorization:`Bearer ${key}`},path='/rest/v1/rpc/set_classroom_hot_archive_for_owner_v1',body={p_actor_id:f.actors[0].id,p_classroom_id:f.classes[0].id,p_archived:true}
    const redirected=createHotLifecycleProofTransport(f,target,async()=>new Response('{}',{status:302,headers:{location:'/foreign'}}),async()=>{})
    expect(()=>redirected.plan('/rest/v1/rpc/test_learner_workflow_v1',{p_actor_id:f.actors[2].id,p_test_id:f.testId,p_classroom_id:null,p_operation:'save',p_payload:{}})).toThrow()
    redirected.plan(path,body);await expect(redirected.fetch(target.API_URL+path,{method:'POST',headers,body:JSON.stringify(body)})).rejects.toThrow()
    const oversized=createHotLifecycleProofTransport(f,target,async()=>new Response('x'.repeat(8388609)),async()=>{})
    oversized.plan(path,body);await expect(oversized.fetch(target.API_URL+path,{method:'POST',headers,body:JSON.stringify(body)})).rejects.toThrow()
  })
  it('keeps forced cleanup modes and type generation arguments explicit',()=>{
    expect(parseClassroomHotLifecycleArgs(['--reviewed-head',head,'--mode','normal','--generate-types']).generateTypes).toBe(true)
    expect(()=>parseClassroomHotLifecycleArgs(['--reviewed-head',head,'--mode','after-fixture','--generate-types'])).toThrow()
    expect(()=>parseClassroomHotLifecycleArgs(['--reviewed-head',head,'--mode','browser'])).toThrow()
  })
})
function initialGraph(m:ReturnType<typeof plan>):HotGraph {
  return {'public.classrooms':m.fixture.classes.map(c=>({id:c.id,teacher_id:c.owner,archived_at:c.archived?m.fixture.now:null,updated_at:m.fixture.now,position:c.position,title:c.title,blueprint_source_revision:1})),
    'public.classroom_archive_revisions':m.fixture.classes.map(c=>({classroom_id:c.id,revision:1,updated_at:m.fixture.now})),__catalog:'a'.repeat(32),'public.announcements':{count:1,sha256:'b'.repeat(64)}}
}
function change(before:HotGraph,id:string,archived:boolean,owner?:string):HotGraph {
  const after=structuredClone(before),rows=after['public.classrooms'] as Record<string,unknown>[],row=rows.find(r=>r.id===id)!,stamp=new Date(Date.parse(String(row.updated_at))+1000).toISOString()
  if(owner)row.teacher_id=owner
  else {row.archived_at=archived?stamp:null;if(!archived){const peers=(before['public.classrooms'] as Record<string,unknown>[]).filter(r=>r.teacher_id===row.teacher_id&&r.archived_at===null);row.position=peers.length?Math.min(...peers.map(r=>Number(r.position)))-1:0}}
  row.updated_at=stamp;const revision=(after['public.classroom_archive_revisions'] as Record<string,unknown>[]).find(r=>r.classroom_id===id)!;revision.revision=Number(revision.revision)+1;revision.updated_at=stamp
  return after
}
