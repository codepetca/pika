/** Inert dual-owner guidance preview SDK leaf. The root owns native fetch, SQL and clocks. */
import assert from 'node:assert/strict'
import {createClient} from '@supabase/supabase-js'
import {z} from 'zod'
import type {Database} from '../src/types/database'
import {ApiError} from '../src/lib/api-error'
import {readContextualClassroomGuidancePreview} from '../src/lib/server/contextual-classroom-guidance-preview'
import {CLASSROOM_GUIDANCE_PREVIEW_CAPS as caps,assertClassroomGuidancePreviewFixture,assertClassroomGuidancePreviewSqlDescriptor,classroomGuidancePreviewFreeze as freeze,classroomGuidancePreviewHash as hash,
  classroomGuidancePreviewSdkInventory,classroomGuidancePreviewSqlDescriptors,classroomGuidancePreviewExpectedWire,classroomGuidancePreviewExpectedView,newClassroomGuidancePreviewFixture,
  type ClassroomGuidancePreviewFixture,type ClassroomGuidancePreviewSdkCall,type ClassroomGuidancePreviewSqlDescriptor} from './contextual-classroom-guidance-preview-native-fixture'
export type ClassroomGuidancePreviewProofControls=Readonly<{deadline:number;cleanupDeadline:number;guard:(profile:'baseline-off')=>Promise<void>;
  account:(kind:'request'|'control'|'bytes',count:number)=>void;httpSession:(active:boolean)=>void;sql:(frame:ClassroomGuidancePreviewSqlDescriptor)=>Promise<unknown>}>
const inventory=classroomGuidancePreviewSdkInventory(newClassroomGuidancePreviewFixture('assignmentlist_000000000000')),labels=inventory.map(c=>c.label)
const sha=z.string().regex(/^[a-f0-9]{64}$/),refused=()=>new Error('classroom_guidance_preview_proof_refused')
const receiptSchema=z.object({version:z.literal(1),scope:z.literal('classroom-guidance-preview-v1'),requests:z.number().int().min(0).max(12),httpDispatches:z.number().int().min(0).max(12),
  adapterRequests:z.number().int().min(0).max(12),rpcRequests:z.literal(0),controls:z.number().int().min(0).max(caps.controls),guardCalls:z.number().int().min(0).max(caps.controls),
  descriptorCalls:z.number().int().min(0).max(caps.sqlFrames),bytes:z.number().int().min(0).max(caps.bytes),maximumSessions:z.number().int().min(0).max(1),sessions:z.number().int().min(0).max(1),
  unsettled:z.number().int().min(0).max(caps.controls),failed:z.boolean(),poisoned:z.boolean(),complete:z.boolean(),restoreState:z.enum(['not-prepared','prepared','restored']),
  physical:z.array(z.object({label:z.enum(labels as[string,...string[]]),method:z.literal('POST'),status:z.union([z.literal(200),z.literal(403),z.literal(404),z.literal(409),z.literal(503)]),bytes:z.number().int().min(0).max(caps.responseBytes),sha256:sha,dtoSha256:sha.nullable()}).strict()).max(12),nativeVerified:z.literal(false),
}).strict().refine(r=>r.requests===r.httpDispatches&&r.requests===r.adapterRequests&&r.physical.length<=r.requests&&r.physical.every((p,n)=>p.label===labels[n]&&p.status===inventory[n].status)
  &&new Set(r.physical.map(p=>p.label)).size===r.physical.length&&(!r.complete||r.requests===12&&r.physical.length===12&&r.descriptorCalls===18&&r.guardCalls===60
    &&r.physical.every((p,n)=>Boolean(p.dtoSha256)===(inventory[n].status===200))&&r.controls>=r.guardCalls+r.descriptorCalls+2*r.physical.length
    &&r.bytes===r.physical.reduce((n,p)=>n+p.bytes,0)+inventory.reduce((n,c)=>n+Buffer.byteLength(JSON.stringify(c.args)),0)
    &&r.maximumSessions===1&&r.sessions===0&&r.unsettled===0&&!r.failed&&!r.poisoned&&r.restoreState==='restored'))
export function assertClassroomGuidancePreviewProofReceipt(input:unknown){return receiptSchema.parse(input)}
const actualAdapter=Object.freeze(readContextualClassroomGuidancePreview)
export function createClassroomGuidancePreviewSdkProof(f:ClassroomGuidancePreviewFixture,target:Readonly<{origin:string;serviceRoleKey:string}>,original:typeof fetch,controls:ClassroomGuidancePreviewProofControls){
  assertClassroomGuidancePreviewFixture(f);assert.equal(target.origin,'http://127.0.0.1:54331');assert(typeof original==='function'&&target.serviceRoleKey.length>0)
  assert(controls.deadline>Date.now()&&controls.deadline-Date.now()<=caps.workMs);assert(controls.cleanupDeadline>controls.deadline&&controls.cleanupDeadline-controls.deadline<=caps.cleanupMs)
  const calls=classroomGuidancePreviewSdkInventory(f),frames=classroomGuidancePreviewSqlDescriptors(f),used=new Set<string>(),pending=new Set<Promise<unknown>>(),physical:z.infer<typeof receiptSchema>['physical']=[]
  let requests=0,httpDispatches=0,adapterRequests=0,controlCount=0,guardCalls=0,descriptorCalls=0,bytes=0,sessions=0,maximumSessions=0
  let failed=false,poisoned=false,complete=false,running=false,cell=-1,restoreState:'not-prepared'|'prepared'|'restored'='not-prepared'
  const account=(kind:'request'|'control'|'bytes',n:number)=>{assert(Number.isSafeInteger(n)&&n>=0);if(kind==='request'){httpDispatches+=n;assert(httpDispatches<=caps.sdkRequests)}
    if(kind==='control'){controlCount+=n;assert(controlCount<=caps.controls)}if(kind==='bytes'){bytes+=n;assert(bytes<=caps.bytes)}controls.account(kind,n)}
  const own=<T>(p:Promise<T>):Promise<T>=>{pending.add(p);void p.then(()=>pending.delete(p),()=>{pending.delete(p);poisoned=true});return p}
  const bounded=async<T>(p:Promise<T>,deadline:number)=>{let timer:ReturnType<typeof setTimeout>|undefined
    try{return await Promise.race([own(p),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(refused()),Math.max(0,deadline-Date.now()))})])}finally{if(timer)clearTimeout(timer)}}
  const check=()=>assert(!failed&&!poisoned&&Date.now()<controls.deadline)
  const guard=async(cleanup=false)=>{if(cleanup)assert(Date.now()<controls.cleanupDeadline&&!pending.size&&!sessions&&!poisoned);else check()
    assert(++guardCalls<=caps.controls);account('control',1);await bounded(controls.guard('baseline-off'),cleanup?controls.cleanupDeadline:controls.deadline)
    if(cleanup)assert(Date.now()<controls.cleanupDeadline&&!pending.size&&!sessions&&!poisoned);else check()}
  const sql=async(name:ClassroomGuidancePreviewSqlDescriptor['name'],cleanup=false)=>{assert(!used.has(name));used.add(name);assert(++descriptorCalls<=caps.sqlFrames)
    const frame=frames.find(r=>r.name===name)!;assertClassroomGuidancePreviewSqlDescriptor(f,frame);await guard(cleanup);account('control',1);if(name==='prepare')restoreState='prepared'
    const result=await bounded(controls.sql(frame),cleanup?controls.cleanupDeadline:controls.deadline);assert(Buffer.byteLength(JSON.stringify(result))<=4096)
    if(name==='witness')assert.deepEqual(result,{studentDualOwner:true,membershipGenerationRows:3,archivedGenerationRetained:true,versions:4,honestVersionHashes:true,blueprintRevisions:[5,4],nativeVerified:false})
    else if(name==='preservation')assert.deepEqual(result,{sourcePreserved:true,originalsPreserved:true,nativeVerified:false})
    else if(name.startsWith('observe-'))assert.deepEqual(result,{case:calls[Number(name.slice(8))].label,preserved:true,nativeVerified:false})
    else assert.deepEqual(result,{stage:name,nativeVerified:false});await guard(cleanup);if(name==='restore-baseline')restoreState='restored'}
  const validate=(raw:unknown,call:ClassroomGuidancePreviewSdkCall)=>{assert.deepEqual(raw,classroomGuidancePreviewExpectedWire(f,call));return raw}
  const countedFetch:typeof fetch=async(resource,init={})=>{
    let response:Response|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined,acquired=false,bodySettled=false,actualSettled=false,abandoned=false
    const aborter=new AbortController(),caller=init.signal,abort=()=>aborter.abort(),timer=setTimeout(abort,Math.max(1,Math.min(caps.requestMs,controls.deadline-Date.now())))
    const aborted=new Promise<never>((_,reject)=>aborter.signal.addEventListener('abort',()=>reject(refused()),{once:true}));void aborted.catch(()=>{})
    const race=<T>(p:Promise<T>)=>Promise.race([own(p),aborted]),release=()=>{if(acquired&&actualSettled&&bodySettled){acquired=false;sessions--;controls.httpSession(false)}}
    try{check();assert(running&&cell>=0&&cell<calls.length&&!caller?.aborted&&!sessions);caller?.addEventListener('abort',abort,{once:true})
      const call=calls[cell];assert(!used.has(`http:${cell}`));used.add(`http:${cell}`);assert(typeof resource==='string'||resource instanceof URL);const url=new URL(String(resource))
      assert.equal(url.href,`${target.origin}/rest/v1/rpc/preview_classroom_authoring_guidance_for_owner_v1`);assert(init.method==='POST'&&init.body===JSON.stringify(call.args))
      assert(Object.keys(init).every(key=>['method','headers','body','signal','redirect'].includes(key)));assert(init.redirect===undefined||init.redirect==='error')
      const headers=new Headers(init.headers);assert.equal(headers.get('authorization'),`Bearer ${target.serviceRoleKey}`);assert.equal(headers.get('apikey'),target.serviceRoleKey)
      for(const[name]of headers)assert(['authorization','apikey','x-client-info','content-type','accept-profile','content-profile','accept'].includes(name))
      const requestBytes=Buffer.byteLength(init.body as string);assert(requestBytes<=caps.requestBytes);await guard();assert(!caller?.aborted&&!aborter.signal.aborted)
      account('request',1);account('bytes',requestBytes);requests++;adapterRequests++;assert(++sessions<=caps.sessions);maximumSessions=Math.max(maximumSessions,sessions);acquired=true;controls.httpSession(true)
      const operation=(async()=>{try{const received=await original(url.href,{...init,redirect:'error',signal:aborter.signal});response=received
        if(abandoned||aborter.signal.aborted){await own(Promise.resolve(received.body?.cancel()));bodySettled=true;throw refused()}return received
      }catch(error){if(!response)bodySettled=true;throw error}finally{actualSettled=true;release()}})()
      response=await race(operation);assert(response instanceof Response&&response.status===call.status&&!response.redirected&&!response.headers.has('location'))
      assert(!response.url||response.url===url.href);assert(response.headers.get('content-type')?.startsWith('application/json'));assert(response.body)
      const length=response.headers.get('content-length');assert(length===null||/^\d+$/.test(length)&&Number(length)<=caps.responseBytes)
      reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0
      for(;;){account('control',1);const part=await race(reader.read());if(part.done)break;size+=part.value.byteLength;account('bytes',part.value.byteLength);assert(size<=caps.responseBytes);chunks.push(part.value)}
      bodySettled=true;release();const data=Buffer.concat(chunks);validate(JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(data)),call)
      physical.push({label:call.label,method:'POST',status:call.status,bytes:size,sha256:hash(data),dtoSha256:null});await guard();return new Response(data,{status:response.status,headers:response.headers})
    }catch{abandoned=true;failed=true;aborter.abort();throw refused()}
    finally{clearTimeout(timer);caller?.removeEventListener('abort',abort)
      if(!bodySettled&&response?.body){try{account('control',1);await bounded(reader?Promise.all([reader.cancel(),reader.closed]).then(()=>{}):response.body.cancel(),controls.cleanupDeadline);bodySettled=true}catch{poisoned=true}}
      reader?.releaseLock();release()}}
  const client=createClient<Database>(target.origin,target.serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:countedFetch}})
  const settle=async()=>{let timer:ReturnType<typeof setTimeout>|undefined
    try{await Promise.race([(async()=>{while(pending.size)await Promise.allSettled([...pending])})(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(refused()),Math.max(0,controls.cleanupDeadline-Date.now()))})]);assert(!pending.size&&sessions===0&&!poisoned)}
    catch{poisoned=true;throw refused()}finally{if(timer)clearTimeout(timer)}}
  const receipt=()=>freeze(assertClassroomGuidancePreviewProofReceipt({version:1,scope:'classroom-guidance-preview-v1',requests,httpDispatches,adapterRequests,rpcRequests:0,
    controls:controlCount,guardCalls,descriptorCalls,bytes,maximumSessions,sessions,unsettled:pending.size,failed,poisoned,complete,restoreState,physical:[...physical],nativeVerified:false}))
  return Object.freeze({settle,receipt,async sdk(){try{check();assert(!running&&cell===-1);running=true;await sql('prepare');await sql('setup');await sql('witness')
    for(cell=0;cell<calls.length;cell++){const call=calls[cell];if(call.transition){if(call.transition==='restore-baseline')await settle();await sql(call.transition,call.transition==='restore-baseline')}
      let result:Awaited<ReturnType<typeof actualAdapter>>|undefined,denied:unknown
      try{result=await actualAdapter({supabase:client,actorId:call.args.p_actor_id,classroomId:call.args.p_classroom_id})}catch(error){denied=error}check()
      if(call.status===200){assert.equal(denied,undefined);assert.deepEqual(result,classroomGuidancePreviewExpectedView(f,call));assert(f.forbiddenSentinels.every(sentinel=>!JSON.stringify(result).includes(sentinel)))
        physical[cell].dtoSha256=hash(JSON.stringify(result))}else{assert(denied instanceof ApiError);assert.equal(denied.statusCode,call.status)}
      assert.equal(requests,cell+1);await sql(`observe-${cell}`)}
    await settle();await sql('preservation',true);await settle();complete=true;return receipt()
  }catch{failed=true;complete=false;throw refused()}finally{running=false
    if(restoreState!=='not-prepared'){try{await settle();if(!used.has('restore-baseline'))await sql('restore-baseline',true);if(!used.has('preservation'))await sql('preservation',true)}catch{poisoned=true}}}}})
}
