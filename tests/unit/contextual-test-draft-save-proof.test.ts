import { describe,expect,it,vi } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerDraftSaveFixture,testOwnerDraftSaveSetupSql,testOwnerDraftSaveSnapshotSql,TEST_OWNER_DRAFT_SAVE_CAPS } from '../../scripts/contextual-test-owner-draft-save-proof-fixture'
import { testOwnerDraftSaveCaseInput,testOwnerDraftSaveRequestManifest,testOwnerDraftSaveForcedReceipt,verifyTestOwnerDraftSavePrivilegeRestoration } from '../../scripts/check-contextual-test-owner-draft-save-lifecycle'
import { buildDraftSaveNativeContractsManifest,validateDraftSaveNativeSql,draftSaveNativeTerminationSql } from '../../scripts/contextual-test-draft-save-native-contracts'
import { AssignmentListLifecycleError } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { createTestOwnerDraftSaveProofTransport } from '../../scripts/check-contextual-test-owner-draft-save-lifecycle'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'
import { saveContextualTestDraft } from '../../src/lib/server/contextual-test-draft-save'
import assert from 'node:assert/strict'
import { testOwnerDraftSaveSetupDiagnostic } from '../../scripts/check-contextual-test-owner-draft-save-lifecycle'

describe('additive finite PATCH proof source',()=>{
 const original=newAssignmentListProofFixture(new Date('2026-10-05T00:00:00Z')),f=newTestOwnerDraftSaveFixture(original)
 const project=`pika_assignment_list_${f.tag.slice(-12)}`
 const rows={'public.tests':f.tests.map(t=>({...t,updated_at:f.now})),'public.test_questions':structuredClone(f.questions),'public.assessment_drafts':f.drafts.map(d=>({...d,created_at:f.now,updated_at:f.now}))}
 it('seals distinct namespace/counts and starts with initialized PATCH drafts only',()=>{
  expect(f.cases).toHaveLength(24);expect(f.questions).toHaveLength(1008);expect(f.drafts).toHaveLength(8);expect(f.managedObjects).toHaveLength(3)
  expect(f.cases.filter(c=>c.operation==='create'||c.operation==='repair')).toHaveLength(0)
  expect(f.allocatedIds.every(id=>!original.allocatedIds.includes(id))).toBe(true);expect(new Set(f.allocatedIds).size).toBe(f.allocatedIds.length)
  expect(Object.isFrozen(f.cases[0])).toBe(true)
 })
 it.each(f.cases.map(c=>[c.label,c]))('decodes finite actual SDK input %s',(_label,c)=>{
  const input=testOwnerDraftSaveCaseInput(f,c,rows);expect(input.version).toBeGreaterThan(0);expect(input.content!==undefined||input.patch!==undefined).toBe(true)
 })
 it('includes full >1000 source and genuine MC correction/structure cases',()=>{
  const c=f.cases.find(c=>c.label==='complete-1001-source')!,input=testOwnerDraftSaveCaseInput(f,c,rows)
  expect(input.content?.questions).toHaveLength(1001)
  expect(f.questions.find(q=>q.test_id===f.tests[4].id)?.options).toEqual(['Choice A','Choice B'])
  expect(testOwnerDraftSaveCaseInput(f,f.cases.find(c=>c.kind==='choice')!,rows).patch).toEqual([{op:'replace',path:'/questions/0/options/0',value:'Corrected choice'}])
 })
 it('owns two RPC paths, finite newly reviewed proposal caps and zero Storage paths',()=>{
  const m=testOwnerDraftSaveRequestManifest(f);expect(m.paths).toEqual(['/rest/v1/rpc/snapshot_test_draft_save_for_owner_v1','/rest/v1/rpc/finish_test_draft_save_for_owner_v1'])
  expect(m.finalKeys).toContain('p_expected_version');expect(m.caps).toEqual(TEST_OWNER_DRAFT_SAVE_CAPS);expect(m.caps.storageRequests).toBe(0)
 })
 it('captures real target rows, managed queue, and whole public/private/Storage table fingerprints',()=>{
  const sql=testOwnerDraftSaveSnapshotSql(f);expect(sql).toContain("n.nspname in ('public','private','storage')");expect(sql).toContain('public.test_document_snapshot_storage_cleanup');expect(sql).not.toContain('test_document_snapshot_storage_cleanup t where test_id')
  // Nullable references must retain unrelated non-Test rows in fingerprints.
  expect(sql).toContain('or r.test_id is null');expect(testOwnerDraftSaveSetupSql(f,project)).toContain('insert into public.managed_storage_objects')
 })
 it('accepts only sealed native SQL and one lowercase digest substitution',()=>{
  const m=buildDraftSaveNativeContractsManifest(original,'a'.repeat(40),process.cwd());expect(m.concurrency.schedules).toHaveLength(16)
  expect(validateDraftSaveNativeSql(m,m.concurrency.schedules[0].finalTemplate.replace('0'.repeat(64),'b'.repeat(64)))).toBe(true)
  expect(validateDraftSaveNativeSql(m,'delete from public.users;')).toBe(false);expect(validateDraftSaveNativeSql(m,m.setup+' select 1;')).toBe(false)
  expect(m.concurrency.schedules.find(c=>c.label==='managed_identity_contention')?.holderSql).toContain(m.fixture.managedObject)
  expect(m.contracts.boundsAndDrift).toContain('Deadline trigger never reached');expect(m.contracts.contracts).toContain('Document snapshot CAS accepted')
  expect(m.contracts.boundsAndDrift).toContain('Future prior stamp never established');expect(m.contracts.boundsAndDrift).toContain('generate_series(0,10000)');expect(m.contracts.boundsAndDrift).toContain('queue_suppress')
  expect(m.concurrency.schedules.find(s=>s.label==='start_before_and_after_snapshot')?.afterSql).toContain('Actual Start marker missing before snapshot')
  expect(draftSaveNativeTerminationSql()).toContain("backend_start=:'owned_started'::timestamptz")
 })
 it('reports forced cleanup only for exact checkpoints with complete setup and clean teardown',()=>{
  const error=new AssignmentListLifecycleError({stage:'after-fixture',error:new Error('Forced isolated lifecycle failure')},[])
  expect(testOwnerDraftSaveForcedReceipt('after-fixture',error,true)?.stdout).toContain('PASS isolated test-owner-draft-save exact teardown and unchanged canonical baseline.')
  expect(testOwnerDraftSaveForcedReceipt('after-fixture',error,false)).toBeNull()
 })
 it('checks application rows even when privilege probe fails',async()=>{
  const snapshot=vi.fn(async()=>({rows:[]}));await expect(verifyTestOwnerDraftSavePrivilegeRestoration({rows:[]},snapshot,async()=>{throw Error('probe failed')})).rejects.toThrow('probe failed');expect(snapshot).toHaveBeenCalledOnce()
 })
 it('locates a native assertion without leaking its message, actual or expected rows',()=>{
  const cause=new assert.AssertionError({message:'PRIVATE diagnostic rows',actual:'PRIVATE actual',expected:'PRIVATE expected',operator:'deepStrictEqual'})
  cause.stack='AssertionError: PRIVATE diagnostic rows\n    at run (/private/example/scripts/check-contextual-test-draft-save-concurrency.ts:74:5)\n    at privateOther (/PRIVATE/secret.ts:1:1)'
  const error=new AssignmentListLifecycleError({stage:'cases',error:cause},[])
  const diagnostic=testOwnerDraftSaveSetupDiagnostic('complete',error)
  expect(diagnostic).toContain('location=check-contextual-test-draft-save-concurrency.ts:74')
  expect(diagnostic).not.toContain('PRIVATE');expect(diagnostic).not.toContain('/private/example')
 })
 it('reports only an allowlisted concurrency budget reason, not arbitrary messages or locations',()=>{
  const cause=new assert.AssertionError({message:'Finite total harness budget exhausted',actual:false,expected:true,operator:'=='})
  cause.stack='AssertionError\n    at privateOther (/PRIVATE/secret.ts:1:1)'
  const error=new AssignmentListLifecycleError({stage:'cases',error:cause},[])
  expect(testOwnerDraftSaveSetupDiagnostic('complete',error)).toContain('location=unknown budget=concurrency-total')
  cause.message='PRIVATE arbitrary error'
  expect(testOwnerDraftSaveSetupDiagnostic('complete',error)).toContain('budget=unknown')
  expect(testOwnerDraftSaveSetupDiagnostic('complete',error)).not.toContain('PRIVATE')
 })
 it.each(f.cases.map(c=>[c.label,c]))('runs installed SDK/helper through finite offline transport %s',async(_label,c)=>{
  const copy=structuredClone(rows),input=testOwnerDraftSaveCaseInput(f,c,copy),t=copy['public.tests'].find(t=>t.id===c.testId)!,cl=f.classes.find(cl=>cl.id===c.classroomId)!
  const test=Object.fromEntries(['id','classroom_id','title','show_results','status','blueprint_archived_at','questions_locked_at','documents','updated_at'].map(k=>[k,t[k as keyof typeof t]]))
  const draft=copy['public.assessment_drafts'].find(d=>d.assessment_id===c.testId)??null
  const key=`e30.${Buffer.from(JSON.stringify({iss:'supabase-demo',role:'service_role'})).toString('base64url')}.synthetic`
  const target={API_URL:'http://127.0.0.1:54331',DB_URL:'postgresql://postgres:synthetic@127.0.0.1:54332/postgres',SERVICE_ROLE_KEY:key}
  const fetcher=vi.fn<typeof fetch>(async(resource,init)=>{
   const payload=JSON.parse(String(init?.body)),url=String(resource)
   if(c.status===403)return new Response(JSON.stringify({code:'PT403',message:'Forbidden',details:null,hint:null}),{status:403})
   if(url.includes('/snapshot_'))return new Response(JSON.stringify({version:1,actor_id:c.actorId,classroom:{id:cl.id,teacher_id:cl.owner,archived_at:cl.archived?f.now:null},test,
    questions:f.questions.filter(q=>q.test_id===c.testId),question_count:f.questions.filter(q=>q.test_id===c.testId).length,draft,source_sha256:'a'.repeat(64)}))
   if(c.status===400)return new Response(JSON.stringify({code:'PT400',message:'synthetic_owner_mismatch',details:null,hint:null}),{status:400})
   const stamp=new Date().toISOString(),saved=payload.p_content===null?null:{...draft,content:payload.p_content,...(payload.p_operation==='save'?{version:input.version+1,updated_by:c.actorId,updated_at:stamp}:{})}
   const savedTest=payload.p_operation==='save'?{...test,title:payload.p_content.title,show_results:payload.p_content.show_results,documents:payload.p_update_documents?payload.p_documents:test.documents,updated_at:stamp}:test
   return new Response(JSON.stringify({version:1,actor_id:c.actorId,classroom_id:c.classroomId,test_id:c.testId,operation:payload.p_operation,draft:saved,test:savedTest,editingPolicy:{structureLocked:t.questions_locked_at!==null}}))
  })
  const transport=createTestOwnerDraftSaveProofTransport(f,target,project,fetcher,async()=>{})
  transport.readContext(c.testId,c.actorId,copy,input,c.label)
  const supabase=createClient<Database>(target.API_URL,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:transport.fetch}})
  const result=saveContextualTestDraft({supabase,actorId:c.actorId,testId:c.testId,input})
  if([400,403,503].includes(c.status))await expect(result).rejects.toMatchObject({statusCode:c.status})
  else expect((await result).status).toBe(c.status)
  expect(transport.counts.rpc).toBe(c.status===403?1:2);expect(transport.counts.storage).toBe(0)
 })
})
