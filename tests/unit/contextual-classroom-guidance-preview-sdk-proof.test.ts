/** Injected CPU transports only; never native evidence or global credentials. */
import {describe,expect,it,vi} from 'vitest'
import {createClassroomGuidancePreviewSdkProof,assertClassroomGuidancePreviewProofReceipt} from '../../scripts/contextual-classroom-guidance-preview-sdk-proof'
import {newClassroomGuidancePreviewFixture,classroomGuidancePreviewSdkInventory,classroomGuidancePreviewExpectedWire} from '../../scripts/contextual-classroom-guidance-preview-native-fixture'
describe('dual-owner preview actual adapter/installed SDK leaf (CPU only)',()=>{
  const f=newClassroomGuidancePreviewFixture('assignmentlist_012345abcdef'),calls=classroomGuidancePreviewSdkInventory(f),target={origin:'http://127.0.0.1:54331',serviceRoleKey:'synthetic-service-role-key'}
  function harness(alter?:(wire:ReturnType<typeof classroomGuidancePreviewExpectedWire>,n:number)=>unknown,response?:()=>Response){
    let index=0,active=0;const events:string[]=[]
    const original:typeof fetch=vi.fn(async(url,init)=>{const n=index++,call=calls[n];expect(url).toBe(`${target.origin}/rest/v1/rpc/preview_classroom_authoring_guidance_for_owner_v1`);expect(init?.redirect).toBe('error');expect(JSON.parse(String(init?.body))).toEqual(call.args);events.push(`http:${call.label}`)
      const data=classroomGuidancePreviewExpectedWire(f,call);return response?.()??new Response(JSON.stringify(alter?alter(data,n):data),{status:call.status,headers:{'content-type':'application/json'}})})
    const controls={deadline:Date.now()+30000,cleanupDeadline:Date.now()+50000,guard:async()=>{events.push('guard')},account:vi.fn(),httpSession:(value:boolean)=>{active+=value?1:-1},
      sql:async(frame:{name:string}):Promise<Record<string,unknown>>=>{events.push(`sql:${frame.name}`);return frame.name==='witness'?{studentDualOwner:true,membershipGenerationRows:3,archivedGenerationRetained:true,versions:4,honestVersionHashes:true,blueprintRevisions:[5,4],nativeVerified:false}:
        frame.name==='preservation'?{sourcePreserved:true,originalsPreserved:true,nativeVerified:false}:frame.name.startsWith('observe-')?{case:calls[Number(frame.name.slice(8))].label,preserved:true,nativeVerified:false}:{stage:frame.name,nativeVerified:false}}}
    return{original,controls,events,active:()=>active,proof:createClassroomGuidancePreviewSdkProof(f,target,original,controls)}
  }
  it('constructs inertly; makes12 actual captured-adapter calls with3 complete DTO hashes',async()=>{
    const h=harness(),savedFetch=globalThis.fetch;expect(h.events).toEqual([]);expect(h.original).not.toHaveBeenCalled()
    const receipt=await h.proof.sdk();await h.proof.settle();expect(globalThis.fetch).toBe(savedFetch)
    expect(receipt).toMatchObject({complete:true,requests:12,adapterRequests:12,rpcRequests:0,descriptorCalls:18,guardCalls:60,sessions:0,unsettled:0,maximumSessions:1,restoreState:'restored',failed:false,poisoned:false,nativeVerified:false})
    expect(receipt.physical.map(p=>p.status)).toEqual(calls.map(c=>c.status));expect(receipt.physical.filter(p=>p.dtoSha256)).toHaveLength(3);expect(h.active()).toBe(0)
    expect(receipt.physical[0].bytes).toBeLessThanOrEqual(65536)
    for(let n=0;n<h.events.length;n++)if(h.events[n].startsWith('http:')||h.events[n].startsWith('sql:')){expect(h.events[n-1]).toBe('guard');expect(h.events[n+1]).toBe('guard')}
    for(const patch of[{requests:13},{physical:receipt.physical.slice(1)},{guardCalls:59},{controls:0},{controls:2049},{bytes:receipt.bytes+1},{bytes:1048577},{maximumSessions:2},{nativeVerified:true},{physical:receipt.physical.map(p=>({...p,dtoSha256:null}))},{physical:receipt.physical.map(p=>({...p,status:200}))},{unknown:true}])expect(()=>assertClassroomGuidancePreviewProofReceipt({...receipt,...patch})).toThrow()
    await expect(h.proof.sdk()).rejects.toThrow();expect(h.original).toHaveBeenCalledTimes(12)
  })
  it.each(['actor','classroom-owner','archived','blueprint-owner','content-parent','guidance-parent','content-version','guidance-version','draft-revision','guidance-number','current-malformed','live-malformed','unknown'] as const)('rejects substituted/private %s after one call and restores only after positive closure',async mode=>{
    const h=harness(data=>{
      if(!('blueprint'in data)||!data.blueprint||!data.versions)return data
      return mode==='actor'?{...data,actor_id:f.actors[4].id}:mode==='classroom-owner'?{...data,classroom:{...data.classroom,teacher_id:f.actors[4].id}}:mode==='archived'?{...data,classroom:{...data.classroom,archived_at:'2026-10-20T00:00:00Z'}}:
        mode==='blueprint-owner'?{...data,blueprint:{...data.blueprint,teacher_id:f.actors[4].id}}:mode==='content-parent'?{...data,versions:{...data.versions,content:{...data.versions.content,course_blueprint_id:f.blueprints[1].id}}}:
        mode==='guidance-parent'?{...data,versions:{...data.versions,guidance:{...data.versions.guidance,course_blueprint_id:f.blueprints[1].id}}}:mode==='content-version'?{...data,versions:{...data.versions,content:{...data.versions.content,id:f.versions[2].id}}}:
        mode==='guidance-version'?{...data,versions:{...data.versions,guidance:{...data.versions.guidance,id:f.versions[2].id}}}:mode==='draft-revision'?{...data,blueprint:{...data.blueprint,content_revision:6}}:
        mode==='guidance-number'?{...data,versions:{...data.versions,guidance:{...data.versions.guidance,version_number:3}}}:mode==='current-malformed'?{...data,current_guidance:{invalid:true}}:mode==='live-malformed'?{...data,guidance:{invalid:true}}:{...data,private:f.forbiddenSentinels[0]}
    });await expect(h.proof.sdk()).rejects.toThrow(/^classroom_guidance_preview_proof_refused$/);await h.proof.settle();expect(h.original).toHaveBeenCalledTimes(1);expect(h.active()).toBe(0)
  })
  it('rejects disclosure on denied, unlinked and malformed cells rather than accepting private state',async()=>{
    for(const n of[2,6,7,9,10]){const h=harness((data,index)=>index===n?{...data,private_guidance:classroomGuidancePreviewExpectedWire(f,calls[0])}:data)
      await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.original).toHaveBeenCalledTimes(n+1)}
  })
  it.each(['invalid-json','invalid-utf8','oversize','wrong-http','redirect','not-json'] as const)('rejects physical%s with one dispatch and positive body closure',async mode=>{
    const response=()=>mode==='invalid-json'?new Response('{',{headers:{'content-type':'application/json'}}):mode==='invalid-utf8'?new Response(new Uint8Array([255]),{headers:{'content-type':'application/json'}}):
      mode==='oversize'?new Response('x'.repeat(65537),{headers:{'content-type':'application/json'}}):new Response('{}',{status:mode==='wrong-http'?403:mode==='redirect'?302:200,headers:{'content-type':mode==='not-json'?'text/plain':'application/json'}})
    const h=harness(undefined,response);await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.original).toHaveBeenCalledTimes(1);expect(h.active()).toBe(0)
  })
  it('requires fresh whole-graph SQL and preservation after HTTP; uncertainty poisons without retries',async()=>{
    for(const name of['observe-0','preservation']){const h=harness(),sql=h.controls.sql;h.controls.sql=async frame=>{const value=await sql(frame);return frame.name===name?{...value,...(name==='preservation'?{sourcePreserved:false}:{preserved:false})}:value}
      const proof=createClassroomGuidancePreviewSdkProof(f,target,h.original,h.controls);await expect(proof.sdk()).rejects.toThrow();await proof.settle();expect(proof.receipt().complete).toBe(false)}
    const h=harness();h.controls.sql=async()=>{throw Error('CPU SQL rejected')};const proof=createClassroomGuidancePreviewSdkProof(f,target,h.original,h.controls)
    await expect(proof.sdk()).rejects.toThrow();await expect(proof.settle()).rejects.toThrow();expect(proof.receipt().poisoned).toBe(true);expect(h.original).not.toHaveBeenCalled()
  })
  it('does not restore while physical fetch is unclosed, retaining original cleanup deadline',async()=>{
    const h=harness(),now=Date.now(),original:typeof fetch=vi.fn(()=>new Promise<Response>(()=>{})),proof=createClassroomGuidancePreviewSdkProof(f,target,original,{...h.controls,deadline:now+80,cleanupDeadline:now+160})
    await expect(proof.sdk()).rejects.toThrow();expect(proof.receipt()).toMatchObject({failed:true,poisoned:true,complete:false,sessions:1,restoreState:'prepared'});expect(h.events).not.toContain('sql:restore-baseline');expect(original).toHaveBeenCalledTimes(1)
  })
})
