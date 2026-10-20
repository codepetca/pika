/** CPU transports only; the installed SDK and captured real adapter are used. */
import {describe,expect,it,vi} from 'vitest'
import {createClassroomGuidanceAdoptionSdkProof,assertClassroomGuidanceAdoptionProofReceipt} from '../../scripts/contextual-classroom-guidance-adoption-sdk-proof'
import {newClassroomGuidanceAdoptionFixture,classroomGuidanceAdoptionFlows,classroomGuidanceAdoptionSource,classroomGuidanceAdoptionCanonical,classroomGuidanceAdoptionSnapshotHash,classroomGuidanceAdoptionHash as hash} from '../../scripts/contextual-classroom-guidance-adoption-native-fixture'
describe('atomic guidance adoption actual adapter / SDK proof (CPU only)',()=>{
  const f=newClassroomGuidanceAdoptionFixture('assignmentlist_012345abcdef'),flows=classroomGuidanceAdoptionFlows(f),target={origin:'http://127.0.0.1:54331',serviceRoleKey:'synthetic-service-role-key'},savedIds=['f1000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000002',f.dedupVersionId]
  const rawHash=(n:number)=>hash(`raw-pg-source:${flows[n].blueprintIndex}`)
  function harness(alter?:(raw:unknown,n:number,write:boolean)=>unknown,response?:(n:number,write:boolean)=>Response){
    let dispatches=0,active=0,versionCount=4;const events:string[]=[],bodies:string[]=[]
    const original:typeof fetch=vi.fn(async(url,init)=>{const p=dispatches++,n=Math.floor(p/2),write=p%2===1,flow=flows[n];events.push(`http:${n}:${write?'write':'source'}`);bodies.push(String(init?.body))
      expect(url).toBe(`${target.origin}/rest/v1/rpc/${write?'save_and_adopt_classroom_guidance_for_owner_v1':'read_classroom_guidance_adoption_source_v1'}`);expect(init?.redirect).toBe('error')
      const args=JSON.parse(String(init?.body));expect(args.p_actor_id).toBe(flow.actorId);expect(args.p_expected_guidance_version_id).toBe(flow.input.expected_guidance_version_id)
      if(write){expect(args.p_snapshot_canonical).toBe(classroomGuidanceAdoptionCanonical(f,flow.blueprintIndex));expect(args.p_snapshot_sha256).toBe(classroomGuidanceAdoptionSnapshotHash(f,flow.blueprintIndex));expect(args.p_source_sha256).toBe(rawHash(n))}
      const raw=!write?classroomGuidanceAdoptionSource(f,n,rawHash(n)):n<3?{actor_id:flow.actorId,classroom_id:flow.classroomId,blueprint_id:flow.input.blueprint_id,content_version_id:flow.input.expected_content_version_id,previous_guidance_version_id:flow.input.expected_guidance_version_id,source_sha256:rawHash(n),guidance_version:{id:savedIds[n],course_blueprint_id:flow.input.blueprint_id,version_number:2,source_draft_revision:flow.input.expected_draft_revision,snapshot_sha256:classroomGuidanceAdoptionSnapshotHash(f,flow.blueprintIndex)}}:{code:n===3?'PT409':'PT403',message:n===3?'class_guidance_adoption_changed':'class_guidance_adoption_forbidden',details:null,hint:null}
      return response?.(n,write)??new Response(JSON.stringify(alter?alter(raw,n,write):raw),{status:write?flow.status:200,headers:{'content-type':'application/json'}})})
    const controls={deadline:Date.now()+60000,cleanupDeadline:Date.now()+90000,guard:async()=>{expect(active).toBe(0);events.push('guard')},account:vi.fn(),httpSession:(on:boolean)=>{active+=on?1:-1},sql:async(frame:{name:string}):Promise<Record<string,unknown>>=>{
      expect(active).toBe(0);events.push(`sql:${frame.name}`)
      if(frame.name==='witness')return{blueprintRevisions:[6,5006,6],counts:[5,5005,5],previousVersions:4,membershipGenerationRows:0,nativeVerified:false}
      if(frame.name==='preservation')return{sourcePreserved:true,originalsPreserved:true,previousVersionsPreserved:true,versionCount,nativeVerified:false}
      if(frame.name.startsWith('source-')){const n=Number(frame.name.slice(7));expect(dispatches).toBe(2*n+1);return{case:flows[n].label,sourceSha256:rawHash(n),intervened:n>=3,nativeVerified:false}}
      if(frame.name.startsWith('observe-')){const n=Number(frame.name.slice(8));if(n<2)versionCount++;return{case:flows[n].label,savedVersionId:n<3?savedIds[n]:null,snapshotSha256:n<3?classroomGuidanceAdoptionSnapshotHash(f,flows[n].blueprintIndex):null,versionNumber:n<3?2:null,preserved:true,restored:n>=3,nativeVerified:false}}
      return{stage:frame.name,nativeVerified:false}}}
    return{original,controls,events,bodies,active:()=>active,proof:createClassroomGuidanceAdoptionSdkProof(f,target,original,controls)}
  }
  it('is inert and completes6 actual adapter calls/12 HTTP/17 SQL/58 guards with private-ID SQL binding',async()=>{
    const h=harness(),globalFetch=globalThis.fetch;expect(h.events).toEqual([]);expect(h.original).not.toHaveBeenCalled()
    const receipt=await h.proof.sdk();await h.proof.settle();expect(globalThis.fetch).toBe(globalFetch)
    expect(receipt).toMatchObject({complete:true,requests:12,httpDispatches:12,sourceRequests:6,writerRequests:6,adapterCalls:6,rpcRequests:0,guardCalls:58,descriptorCalls:17,maximumSessions:1,sessions:0,unsettled:0,restoreState:'restored',failed:false,poisoned:false,nativeVerified:false})
    expect(receipt.physical.map(p=>p.status)).toEqual([200,200,200,200,200,200,200,409,200,403,200,403]);expect(receipt.physical.filter(p=>p.dtoSha256)).toHaveLength(3);expect(receipt.bindings.map(b=>b.versionIdSha256)).toEqual(savedIds.map(hash));expect(JSON.stringify(receipt)).not.toContain(savedIds[0]);expect(h.active()).toBe(0)
    expect(Buffer.byteLength(h.bodies[3])).toBeGreaterThan(1048576);expect(Buffer.byteLength(h.bodies[3])).toBeLessThanOrEqual(8388608)
    for(let n=0;n<h.events.length;n++)if(h.events[n].startsWith('http:')||h.events[n].startsWith('sql:')){expect(h.events[n-1]).toBe('guard');expect(h.events[n+1]).toBe('guard')}
    for(const patch of[{requests:13},{adapterCalls:7},{sourceRequests:5},{guardCalls:57},{controls:0},{maximumSessions:2},{bytes:0},{bytes:33554433},{nativeVerified:true},{unknown:true},{bindings:receipt.bindings.slice(1)},{bindings:receipt.bindings.map(b=>({...b,versionIdSha256:receipt.bindings[0].versionIdSha256}))},{physical:receipt.physical.slice(1)},{physical:receipt.physical.map(p=>({...p,dtoSha256:null}))}])expect(()=>assertClassroomGuidanceAdoptionProofReceipt({...receipt,...patch})).toThrow()
    await expect(h.proof.sdk()).rejects.toThrow();expect(h.original).toHaveBeenCalledTimes(12)
  })
  async function timingHarness(delay:number){
    vi.useFakeTimers()
    // Model the unchanged actual adapter's per-RPC 10s caller signal on the CPU clock.
    vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const controller=new AbortController();setTimeout(()=>controller.abort(),ms);return controller.signal})
    const h=harness(),sql=h.controls.sql;let entered!:()=>void
    const ready=new Promise<void>(resolve=>{entered=resolve})
    h.controls.sql=async frame=>{if(frame.name==='source-0'){entered();await new Promise(resolve=>setTimeout(resolve,delay))}return sql(frame)}
    const proof=createClassroomGuidanceAdoptionSdkProof(f,target,h.original,h.controls)
    const result=proof.sdk().then(receipt=>({receipt,error:null}),error=>({receipt:null,error}))
    await ready;await vi.advanceTimersByTimeAsync(delay)
    return{h,proof,...await result}
  }
  it('excludes 8.1s source bookkeeping from the leaf network window while preserving the live 10s caller',async()=>{
    try{const result=await timingHarness(8100);expect(result.error).toBeNull();expect(result.receipt).toMatchObject({complete:true,requests:12,descriptorCalls:17,guardCalls:58});expect(result.h.original).toHaveBeenCalledTimes(12)}
    finally{vi.restoreAllMocks();vi.useRealTimers()}
  })
  it('refuses a 10.1s source prefix before writer dispatch when the unchanged caller expires',async()=>{
    try{const result=await timingHarness(10100);expect(result.error?.message).toBe('classroom_guidance_adoption_proof_refused');expect(result.error?.verificationFailure).toEqual({phase:'write',stage:'preflight',abort:'caller'});expect(result.h.original).toHaveBeenCalledTimes(1);expect(result.proof.receipt()).toMatchObject({requests:1,writerRequests:0,descriptorCalls:6,guardCalls:15,restoreState:'restored',poisoned:false})}
    finally{vi.restoreAllMocks();vi.useRealTimers()}
  })
  it.each(['transport','body']as const)('still enforces the 8s actual %s window and exposes only a frozen finite failure',async stage=>{
    vi.useFakeTimers()
    vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const controller=new AbortController();setTimeout(()=>controller.abort(),ms);return controller.signal})
    try{const h=harness();let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve})
      const original:typeof fetch=vi.fn(async(_url,init)=>{entered();if(stage==='transport')return new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(Error('CPU private transport detail')),{once:true}));return new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('{'))}}),{headers:{'content-type':'application/json'}})})
      const proof=createClassroomGuidanceAdoptionSdkProof(f,target,original,h.controls),result=proof.sdk().then(()=>null,error=>error)
      await ready;await vi.advanceTimersByTimeAsync(8000);const error=await result
      expect(error.message).toBe('classroom_guidance_adoption_proof_refused');expect(error.verificationFailure).toEqual({phase:'source',stage,abort:'leaf-request'});expect(Object.isFrozen(error.verificationFailure)).toBe(true);expect(Object.getOwnPropertyDescriptor(error,'verificationFailure')).toMatchObject({writable:false,configurable:false});expect(JSON.stringify(error)).not.toContain('CPU private');expect(original).toHaveBeenCalledTimes(1);expect(proof.receipt()).toMatchObject({complete:false,requests:1,writerRequests:0})
    }finally{vi.restoreAllMocks();vi.useRealTimers()}
  })
  it('keeps the first counted failure immutable and leaves the public receipt schema unchanged',async()=>{
    const h=harness(undefined,()=>new Response('{',{headers:{'content-type':'application/json'}}));let error:unknown
    try{await h.proof.sdk()}catch(caught){error=caught}
    expect(error).toMatchObject({message:'classroom_guidance_adoption_proof_refused',verificationFailure:{phase:'source',stage:'body',abort:'none'}})
    expect(h.proof.receipt()).not.toHaveProperty('verificationFailure');await expect(h.proof.sdk()).rejects.toMatchObject({verificationFailure:{phase:'source',stage:'body',abort:'none'}})
  })
  it.each(['actor','parent','count','truncated','unknown','raw-sha']as const)('rejects source %s before writer dispatch, without fetch/environment shadowing',async mode=>{
    const h=harness((raw,n,write)=>{if(n||write)return raw;const source=classroomGuidanceAdoptionSource(f,0,rawHash(0));return mode==='actor'?{...source,actor_id:f.actors[2].id}:mode==='parent'?{...source,versions:{...source.versions,content:{...source.versions.content,course_blueprint_id:f.blueprints[1].id}}}:mode==='count'?{...source,counts:{...source.counts,materials:2}}:mode==='truncated'?{...source,source:{...source.source,materials:[]}}:mode==='unknown'?{...source,private:'unknown'}:{...source,source_sha256:'bad'}})
    await expect(h.proof.sdk()).rejects.toThrow(/^classroom_guidance_adoption_proof_refused$/);await h.proof.settle();expect(h.original).toHaveBeenCalledTimes(1);expect(h.events).not.toContain('sql:source-0');expect(h.proof.receipt().complete).toBe(false)
  })
  it.each(['private-id','parent','snapshot','source','draft','unknown']as const)('treats invalid committed writer %s as uncertain, never retries or deletes Versions',async mode=>{
    const h=harness((raw,n,write)=>{if(n||!write)return raw;const data=JSON.parse(JSON.stringify(raw));if(mode==='private-id')data.guidance_version.id=f.blueprints[0].structuralVersionId;else if(mode==='parent')data.guidance_version.course_blueprint_id=f.blueprints[1].id;else if(mode==='snapshot')data.guidance_version.snapshot_sha256='b'.repeat(64);else if(mode==='source')data.source_sha256='b'.repeat(64);else if(mode==='draft')data.guidance_version.source_draft_revision=7;else data.extra=true;return data})
    const sql=h.controls.sql;h.controls.sql=async frame=>{if(frame.name==='restore-temporary')throw Error('CPU unconfirmed committed writer differs from checkpoint');return sql(frame)}
    const proof=createClassroomGuidanceAdoptionSdkProof(f,target,h.original,h.controls);await expect(proof.sdk()).rejects.toThrow();await expect(proof.settle()).rejects.toThrow();expect(proof.receipt()).toMatchObject({complete:false,failed:true,poisoned:true,requests:2});expect(h.original).toHaveBeenCalledTimes(2);expect(h.events).not.toContain('sql:observe-0')
  })
  it('binds fresh source SQL digest and private writer ID before accepting a checkpoint',async()=>{
    for(const name of['source-0','observe-0']){const h=harness(),sql=h.controls.sql;h.controls.sql=async frame=>{const data=await sql(frame);return frame.name===name?{...data,...(name==='source-0'?{sourceSha256:'b'.repeat(64)}:{savedVersionId:f.dedupVersionId})}:data};const proof=createClassroomGuidanceAdoptionSdkProof(f,target,h.original,h.controls)
      await expect(proof.sdk()).rejects.toThrow();expect(h.original).toHaveBeenCalledTimes(name==='source-0'?1:2);expect(proof.receipt().complete).toBe(false)}
  })
  it('poisons on uncertain SQL closure before writer dispatch without retry or cleanup',async()=>{
    const h=harness(),sql=h.controls.sql;h.controls.sql=async frame=>{if(frame.name==='source-0')throw Error('CPU uncertain SQL operation');return sql(frame)};const proof=createClassroomGuidanceAdoptionSdkProof(f,target,h.original,h.controls)
    await expect(proof.sdk()).rejects.toThrow();await expect(proof.settle()).rejects.toThrow();expect(h.original).toHaveBeenCalledTimes(1);expect(proof.receipt()).toMatchObject({failed:true,poisoned:true,complete:false});expect(h.events).not.toContain('sql:restore-temporary')
  })
  it.each(['invalid-json','invalid-utf8','redirect','wrong-http','oversize-header']as const)('rejects physical %s and positively closes its body',async mode=>{
    const h=harness(undefined,()=>new Response(mode==='invalid-json'?'{':mode==='invalid-utf8'?new Uint8Array([255]):'{}',{status:mode==='redirect'?302:mode==='wrong-http'?403:200,headers:{'content-type':'application/json',...(mode==='oversize-header'?{'content-length':'8388609'}:{})}}))
    await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.original).toHaveBeenCalledTimes(1);expect(h.active()).toBe(0)
  })
  it('retains uncertain original fetch reservations and refuses cleanup under the original deadline',async()=>{
    const h=harness(),now=Date.now(),original:typeof fetch=vi.fn(()=>new Promise<Response>(()=>{})),proof=createClassroomGuidanceAdoptionSdkProof(f,target,original,{...h.controls,deadline:now+3000,cleanupDeadline:now+3300})
    await expect(proof.sdk()).rejects.toThrow();expect(proof.receipt()).toMatchObject({complete:false,failed:true,poisoned:true,sessions:1,restoreState:'prepared'});expect(h.events).not.toContain('sql:restore-temporary');expect(original).toHaveBeenCalledTimes(1)
  })
})
