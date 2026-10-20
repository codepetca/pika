import {describe,expect,it,vi} from 'vitest'
import {createClassroomListReorderSdkProof,assertClassroomListReorderProofReceipt} from '../../scripts/contextual-classroom-list-reorder-sdk-proof'
import {newClassroomListReorderFixture,classroomListReorderSdkInventory,classroomListReorderHash as hash} from '../../scripts/contextual-classroom-list-reorder-native-fixture'
describe('captured classroom-list reorder adapter proof (CPU only)',()=>{
  const f=newClassroomListReorderFixture('assignmentlist_012345abcdef'),calls=classroomListReorderSdkInventory(f),target={origin:'http://127.0.0.1:54331',serviceRoleKey:'synthetic-service-role-key'}
  function harness(alter?:(data:unknown,n:number)=>unknown,response?:()=>Response){
    let index=0,active=0;const events:string[]=[]
    const original:typeof fetch=vi.fn(async(_url,init)=>{const n=index++,call=calls[n];expect(JSON.parse(String(init?.body))).toEqual(call.args);events.push(`http:${call.label}`)
      const data=call.status===200?{actor_id:call.args.p_actor_id,classroom_ids:call.args.p_classroom_ids,reordered:true}:
        {code:`PT${call.status}`,message:call.status===400?'classroom_list_reorder_invalid_set':'classroom_list_reorder_fenced',details:null,hint:null}
      return response?.()??new Response(JSON.stringify(alter?alter(data,n):data),{status:call.status,headers:{'content-type':'application/json'}})})
    const controls={deadline:Date.now()+30000,cleanupDeadline:Date.now()+50000,guard:async()=>{events.push('guard')},account:vi.fn(),httpSession:(value:boolean)=>{active+=value?1:-1},
      sql:async(frame:{name:string}):Promise<Record<string,unknown>>=>{events.push(`sql:${frame.name}`);return frame.name==='witness'?{studentOwner:true,membershipGenerationRows:3,creationGrantDisabled:true,nativeVerified:false}:
        frame.name==='preservation'?{sourcePreserved:true,originalsPreserved:true,nativeVerified:false}:frame.name.startsWith('observe-')?{case:calls[Number(frame.name.slice(8))].label,preserved:true,
          orderSha256:calls[Number(frame.name.slice(8))].status===200?hash(calls[Number(frame.name.slice(8))].args.p_classroom_ids.join(',')):null,nativeVerified:false}:{stage:frame.name,nativeVerified:false}}}
    return{original,controls,events,active:()=>active,proof:createClassroomListReorderSdkProof(f,target,original,controls)}
  }
  it('imports inertly, runs12 actual adapters, bindsvoid results to fresh order hashes and keeps expected400/503 nonpoisoning',async()=>{
    const h=harness();expect(h.events).toEqual([]);const originalFetch=globalThis.fetch
    const receipt=await h.proof.sdk();await h.proof.settle();expect(globalThis.fetch).toBe(originalFetch)
    expect(receipt).toMatchObject({complete:true,requests:12,adapterRequests:12,rpcRequests:0,descriptorCalls:18,guardCalls:60,restoreState:'restored',failed:false,poisoned:false,sessions:0,unsettled:0,nativeVerified:false})
    expect(receipt.physical.map(p=>p.status)).toEqual(calls.map(c=>c.status));expect(h.active()).toBe(0)
    for(let n=0;n<h.events.length;n++)if(h.events[n].startsWith('http:')||h.events[n].startsWith('sql:')){expect(h.events[n-1]).toBe('guard');expect(h.events[n+1]).toBe('guard')}
    expect(()=>assertClassroomListReorderProofReceipt({...receipt,nativeVerified:true})).toThrow()
    for(const patch of [{requests:13},{physical:receipt.physical.slice(1)},{guardCalls:59},{physical:receipt.physical.map((p,n)=>n? p:{...p,status:400})},{unknown:true}])expect(()=>assertClassroomListReorderProofReceipt({...receipt,...patch})).toThrow()
    await expect(h.proof.sdk()).rejects.toThrow();expect(h.original).toHaveBeenCalledTimes(12)
  })
  it.each(['actor','order','extra','false'] as const)('rejects substituted success%s after one physical dispatch',async mode=>{
    const h=harness(data=>({...data as object,...(mode==='actor'?{actor_id:f.actors[1].id}:mode==='order'?{classroom_ids:[...calls[0].args.p_classroom_ids].reverse()}:mode==='extra'?{private:true}:{reordered:false})}))
    await expect(h.proof.sdk()).rejects.toThrow(/^classroom_list_reorder_proof_refused$/);await h.proof.settle();expect(h.original).toHaveBeenCalledTimes(1);expect(h.active()).toBe(0)
  })
  it('rejects malformed negative envelopes instead of treating any error response as expected denial',async()=>{
    const h=harness((data,n)=>n===4?{...data as object,code:'PT403'}:data)
    await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.original).toHaveBeenCalledTimes(5)
  })
  it.each(['invalid-json','oversize','invalid-utf8','wrong-http','redirect'] as const)('rejects physical%s without another request and positively closes response bodies',async mode=>{
    const response=()=>mode==='invalid-json'?new Response('{',{headers:{'content-type':'application/json'}}):mode==='oversize'?new Response('x'.repeat(16385),{headers:{'content-type':'application/json'}}):
      mode==='invalid-utf8'?new Response(new Uint8Array([255]),{headers:{'content-type':'application/json'}}):new Response('{}',{status:mode==='redirect'?302:403,headers:{'content-type':'application/json'}})
    const h=harness(undefined,response);await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.original).toHaveBeenCalledTimes(1);expect(h.active()).toBe(0)
  })
  it('requires the independent fresh SQL order binding, not only a success envelope',async()=>{
    const h=harness(),sql=h.controls.sql;h.controls.sql=async frame=>{const value=await sql(frame);return frame.name==='observe-0'?{...value,orderSha256:'0'.repeat(64)}:value}
    const proof=createClassroomListReorderSdkProof(f,target,h.original,h.controls)
    await expect(proof.sdk()).rejects.toThrow();await proof.settle();expect(proof.receipt()).toMatchObject({failed:true,complete:false,restoreState:'restored'});expect(h.original).toHaveBeenCalledTimes(1)
  })
  it('refuses a failed preservation verdict despite successful writes and semantic restoration',async()=>{
    const h=harness(),sql=h.controls.sql;h.controls.sql=async frame=>{const value=await sql(frame);return frame.name==='preservation'?{...value,sourcePreserved:false}:value}
    const proof=createClassroomListReorderSdkProof(f,target,h.original,h.controls)
    await expect(proof.sdk()).rejects.toThrow();await proof.settle();expect(proof.receipt().complete).toBe(false);expect(h.original).toHaveBeenCalledTimes(12)
  })
  it('fails closed on a positively rejected SQL observation without retry or fake restoration',async()=>{
    const h=harness(),sql=h.controls.sql;h.controls.sql=async frame=>{if(frame.name==='observe-0')throw Error('CPU SQL rejection');return sql(frame)}
    const proof=createClassroomListReorderSdkProof(f,target,h.original,h.controls)
    await expect(proof.sdk()).rejects.toThrow();await expect(proof.settle()).rejects.toThrow();expect(h.original).toHaveBeenCalledTimes(1)
    expect(proof.receipt()).toMatchObject({poisoned:true,complete:false,restoreState:'prepared',sessions:0});expect(h.events).not.toContain('sql:restore-baseline')
  })
  it('retains unclosed physical fetch and original cleanup deadline without SQL restoration',async()=>{
    const h=harness(),now=Date.now(),original:typeof fetch=vi.fn(()=>new Promise<Response>(()=>{}))
    const proof=createClassroomListReorderSdkProof(f,target,original,{...h.controls,deadline:now+80,cleanupDeadline:now+160})
    await expect(proof.sdk()).rejects.toThrow();expect(proof.receipt()).toMatchObject({poisoned:true,complete:false,sessions:1,restoreState:'prepared'})
    expect(h.events).not.toContain('sql:restore-baseline');expect(original).toHaveBeenCalledTimes(1)
  })
})
