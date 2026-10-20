/** Inert atomic guidance adoption SDK leaf. The root owns native fetch, SQL and clocks. */
import assert from 'node:assert/strict'
import {createClient} from '@supabase/supabase-js'
import {z} from 'zod'
import type {Database} from '../src/types/database'
import {ApiError} from '../src/lib/api-error'
import {adoptContextualClassroomGuidance} from '../src/lib/server/contextual-classroom-guidance-adoption'
import {CLASSROOM_GUIDANCE_ADOPTION_CAPS as caps,assertClassroomGuidanceAdoptionFixture,assertClassroomGuidanceAdoptionSqlDescriptor,classroomGuidanceAdoptionFreeze as freeze,classroomGuidanceAdoptionHash as hash,classroomGuidanceAdoptionFlows,classroomGuidanceAdoptionSqlDescriptors,classroomGuidanceAdoptionSource,classroomGuidanceAdoptionCanonical,classroomGuidanceAdoptionSnapshotHash,newClassroomGuidanceAdoptionFixture,type ClassroomGuidanceAdoptionFixture,type ClassroomGuidanceAdoptionSqlDescriptor} from './contextual-classroom-guidance-adoption-native-fixture'
export type ClassroomGuidanceAdoptionProofControls=Readonly<{deadline:number;cleanupDeadline:number;guard:(profile:'baseline-off')=>Promise<void>;
  account:(kind:'request'|'control'|'bytes',count:number)=>void;httpSession:(active:boolean)=>void;sql:(frame:ClassroomGuidanceAdoptionSqlDescriptor)=>Promise<unknown>}>
const labels=classroomGuidanceAdoptionFlows(newClassroomGuidanceAdoptionFixture('assignmentlist_000000000000')).map(c=>c.label)
const sha=z.string().regex(/^[a-f0-9]{64}$/),refused=()=>new Error('classroom_guidance_adoption_proof_refused')
const receiptSchema=z.object({version:z.literal(1),scope:z.literal('classroom-guidance-adoption-v1'),requests:z.number().int().min(0).max(12),httpDispatches:z.number().int().min(0).max(12),sourceRequests:z.number().int().min(0).max(6),writerRequests:z.number().int().min(0).max(6),adapterCalls:z.number().int().min(0).max(6),rpcRequests:z.literal(0),controls:z.number().int().min(0).max(caps.controls),guardCalls:z.number().int().min(0).max(caps.controls),descriptorCalls:z.number().int().min(0).max(17),bytes:z.number().int().min(0).max(caps.bytes),maximumSessions:z.number().int().min(0).max(1),sessions:z.number().int().min(0).max(1),unsettled:z.number().int().min(0).max(caps.controls),failed:z.boolean(),poisoned:z.boolean(),complete:z.boolean(),restoreState:z.enum(['not-prepared','prepared','restored']),physical:z.array(z.object({label:z.enum(labels as[string,...string[]]),phase:z.enum(['source','write']),method:z.literal('POST'),status:z.union([z.literal(200),z.literal(403),z.literal(409)]),bytes:z.number().int().min(0).max(caps.responseBytes),sha256:sha,dtoSha256:sha.nullable()}).strict()).max(12),bindings:z.array(z.object({label:z.enum(labels as[string,...string[]]),versionIdSha256:sha,snapshotSha256:sha,versionNumber:z.literal(2),sqlBound:z.literal(true)}).strict()).max(3),nativeVerified:z.literal(false)}).strict().refine(r=>r.requests===r.httpDispatches&&r.requests===r.sourceRequests+r.writerRequests&&r.writerRequests<=r.sourceRequests&&r.sourceRequests<=r.adapterCalls&&r.physical.length<=r.requests&&r.physical.every((p,n)=>p.label===labels[Math.floor(n/2)]&&p.phase===(n%2?'write':'source')&&p.status===(n%2&&n>=6?n===7?409:403:200))&&r.bytes>=r.physical.reduce((n,p)=>n+p.bytes,0)&&r.bindings.every((b,n)=>b.label===labels[n])&&new Set(r.bindings.map(b=>b.versionIdSha256)).size===r.bindings.length&&(!r.complete||r.requests===12&&r.sourceRequests===6&&r.writerRequests===6&&r.adapterCalls===6&&r.physical.length===12&&r.bindings.length===3&&r.descriptorCalls===17&&r.guardCalls===58&&r.controls>=r.guardCalls+r.descriptorCalls+2*r.physical.length&&r.physical.every((p,n)=>Boolean(p.dtoSha256)===(n%2===1&&n<6))&&r.maximumSessions===1&&r.sessions===0&&r.unsettled===0&&!r.failed&&!r.poisoned&&r.restoreState==='restored'))
export function assertClassroomGuidanceAdoptionProofReceipt(input:unknown){return receiptSchema.parse(input)}
const actualAdapter=Object.freeze(adoptContextualClassroomGuidance)
export function createClassroomGuidanceAdoptionSdkProof(f:ClassroomGuidanceAdoptionFixture,target:Readonly<{origin:string;serviceRoleKey:string}>,original:typeof fetch,controls:ClassroomGuidanceAdoptionProofControls){
  assertClassroomGuidanceAdoptionFixture(f);assert.equal(target.origin,'http://127.0.0.1:54331');assert(typeof original==='function'&&target.serviceRoleKey.length>0)
  assert(controls.deadline>Date.now()&&controls.deadline-Date.now()<=caps.workMs);assert(controls.cleanupDeadline>controls.deadline&&controls.cleanupDeadline-controls.deadline<=caps.cleanupMs)
  const calls=classroomGuidanceAdoptionFlows(f),frames=classroomGuidanceAdoptionSqlDescriptors(f),used=new Set<string>(),pending=new Set<Promise<unknown>>(),physical:z.infer<typeof receiptSchema>['physical']=[],bindings:z.infer<typeof receiptSchema>['bindings']=[],captures:{sourceSha?:string;savedId?:string}[]=calls.map(()=>({}))
  let requests=0,httpDispatches=0,sourceRequests=0,writerRequests=0,adapterCalls=0,controlCount=0,guardCalls=0,descriptorCalls=0,bytes=0,sessions=0,maximumSessions=0
  let failed=false,poisoned=false,complete=false,running=false,cell=-1,restoreState:'not-prepared'|'prepared'|'restored'='not-prepared'
  const account=(kind:'request'|'control'|'bytes',n:number)=>{assert(Number.isSafeInteger(n)&&n>=0);if(kind==='request'){httpDispatches+=n;assert(httpDispatches<=caps.requests)}
    if(kind==='control'){controlCount+=n;assert(controlCount<=caps.controls)}if(kind==='bytes'){bytes+=n;assert(bytes<=caps.bytes)}controls.account(kind,n)}
  const own=<T>(p:Promise<T>):Promise<T>=>{pending.add(p);void p.then(()=>pending.delete(p),()=>{pending.delete(p);poisoned=true});return p}
  const bounded=async<T>(p:Promise<T>,deadline:number)=>{let timer:ReturnType<typeof setTimeout>|undefined
    try{return await Promise.race([own(p),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(refused()),Math.max(0,deadline-Date.now()))})])}finally{if(timer)clearTimeout(timer)}}
  const check=()=>assert(!failed&&!poisoned&&Date.now()<controls.deadline)
  const guard=async(cleanup=false)=>{if(cleanup)assert(Date.now()<controls.cleanupDeadline&&!pending.size&&!sessions&&!poisoned);else check()
    assert(++guardCalls<=caps.controls);account('control',1);await bounded(controls.guard('baseline-off'),cleanup?controls.cleanupDeadline:controls.deadline)
    if(cleanup)assert(Date.now()<controls.cleanupDeadline&&!pending.size&&!sessions&&!poisoned);else check()}
  const sql=async(name:ClassroomGuidanceAdoptionSqlDescriptor['name'],cleanup=false)=>{assert(!used.has(name));used.add(name);assert(++descriptorCalls<=caps.sqlFrames)
    const frame=frames.find(r=>r.name===name)!;assertClassroomGuidanceAdoptionSqlDescriptor(f,frame);await guard(cleanup);account('control',1);if(name==='prepare')restoreState='prepared'
    const result=await bounded(controls.sql(frame),cleanup?controls.cleanupDeadline:controls.deadline);assert(Buffer.byteLength(JSON.stringify(result))<=4096)
    if(name==='witness')assert.deepEqual(result,{blueprintRevisions:[6,5006,6],counts:[5,5005,5],previousVersions:4,membershipGenerationRows:0,nativeVerified:false})
    else if(name==='preservation')assert.deepEqual(result,{sourcePreserved:true,originalsPreserved:true,previousVersionsPreserved:true,versionCount:4+bindings.filter(b=>b.label!==labels[2]).length,nativeVerified:false})
    else if(name.startsWith('source-')){const n=Number(name.slice(7));assert.deepEqual(result,{case:calls[n].label,sourceSha256:captures[n].sourceSha,intervened:n>=3,nativeVerified:false})}
    else if(name.startsWith('observe-')){const n=Number(name.slice(8));assert.deepEqual(result,{case:calls[n].label,savedVersionId:n<3?captures[n].savedId:null,snapshotSha256:n<3?classroomGuidanceAdoptionSnapshotHash(f,calls[n].blueprintIndex):null,versionNumber:n<3?2:null,preserved:true,restored:n>=3,nativeVerified:false})}
    else assert.deepEqual(result,{stage:name,nativeVerified:false});await guard(cleanup);if(name==='restore-temporary')restoreState='restored'}
  const countedFetch:typeof fetch=async(resource,init={})=>{
    let response:Response|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined,acquired=false,bodySettled=false,actualSettled=false,abandoned=false
    const aborter=new AbortController(),caller=init.signal,abort=()=>aborter.abort(),timer=setTimeout(abort,Math.max(1,Math.min(caps.requestMs,controls.deadline-Date.now())))
    const aborted=new Promise<never>((_,reject)=>aborter.signal.addEventListener('abort',()=>reject(refused()),{once:true}));void aborted.catch(()=>{})
    const race=<T>(p:Promise<T>)=>Promise.race([own(p),aborted]),release=()=>{if(acquired&&actualSettled&&bodySettled){acquired=false;sessions--;controls.httpSession(false)}}
    try{check();assert(running&&cell>=0&&cell<calls.length&&!caller?.aborted&&!sessions);caller?.addEventListener('abort',abort,{once:true})
      const call=calls[cell],phase=requests%2?'write':'source',physicalIndex=2*cell+(phase==='write'?1:0);assert.equal(requests,physicalIndex);assert(!used.has(`http:${physicalIndex}`));used.add(`http:${physicalIndex}`);const args={p_actor_id:call.actorId,p_classroom_id:call.classroomId,p_blueprint_id:call.input.blueprint_id,p_expected_content_version_id:call.input.expected_content_version_id,p_expected_guidance_version_id:call.input.expected_guidance_version_id,p_expected_draft_revision:call.input.expected_draft_revision};const expectedArgs=phase==='source'?args:{...args,p_source_sha256:captures[cell].sourceSha,p_snapshot_canonical:classroomGuidanceAdoptionCanonical(f,call.blueprintIndex),p_snapshot_sha256:classroomGuidanceAdoptionSnapshotHash(f,call.blueprintIndex)};assert(typeof resource==='string'||resource instanceof URL);const url=new URL(String(resource))
      assert.equal(url.href,`${target.origin}/rest/v1/rpc/${phase==='source'?'read_classroom_guidance_adoption_source_v1':'save_and_adopt_classroom_guidance_for_owner_v1'}`);assert(init.method==='POST'&&init.body===JSON.stringify(expectedArgs))
      assert(Object.keys(init).every(key=>['method','headers','body','signal','redirect'].includes(key)));assert(init.redirect===undefined||init.redirect==='error')
      const headers=new Headers(init.headers);assert.equal(headers.get('authorization'),`Bearer ${target.serviceRoleKey}`);assert.equal(headers.get('apikey'),target.serviceRoleKey)
      for(const[name]of headers)assert(['authorization','apikey','x-client-info','content-type','accept-profile','content-profile','accept'].includes(name))
      const requestBytes=Buffer.byteLength(init.body as string);assert(requestBytes<=caps.requestBytes);if(phase==='write')await sql(`source-${cell}`);await guard();assert(!caller?.aborted&&!aborter.signal.aborted)
      account('request',1);account('bytes',requestBytes);requests++;if(phase==='source')sourceRequests++;else writerRequests++;assert(++sessions<=caps.sessions);maximumSessions=Math.max(maximumSessions,sessions);acquired=true;controls.httpSession(true)
      const operation=(async()=>{try{const received=await original(url.href,{...init,redirect:'error',signal:aborter.signal});response=received
        if(abandoned||aborter.signal.aborted){await own(Promise.resolve(received.body?.cancel()));bodySettled=true;throw refused()}return received
      }catch(error){if(!response)bodySettled=true;throw error}finally{actualSettled=true;release()}})()
      response=await race(operation);assert(response instanceof Response&&response.status===(phase==='source'?200:call.status)&&!response.redirected&&!response.headers.has('location'))
      assert(!response.url||response.url===url.href);assert(response.headers.get('content-type')?.startsWith('application/json'));assert(response.body)
      const length=response.headers.get('content-length');assert(length===null||/^\d+$/.test(length)&&Number(length)<=caps.responseBytes)
      reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0
      for(;;){account('control',1);const part=await race(reader.read());if(part.done)break;size+=part.value.byteLength;account('bytes',part.value.byteLength);assert(size<=caps.responseBytes);chunks.push(part.value)}
      bodySettled=true;release();const data=Buffer.concat(chunks),raw:unknown=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(data))
      if(phase==='source'){const source=z.object({source_sha256:sha}).passthrough().parse(raw);assert.deepEqual(raw,classroomGuidanceAdoptionSource(f,cell,source.source_sha256));captures[cell].sourceSha=source.source_sha256}
      else if(cell<3){const saved=z.object({guidance_version:z.object({id:z.string().uuid()}).passthrough()}).passthrough().parse(raw),id=saved.guidance_version.id;assert(cell===2?id===f.dedupVersionId:!f.allocatedIds.includes(id));assert.deepEqual(raw,{actor_id:call.actorId,classroom_id:call.classroomId,blueprint_id:call.input.blueprint_id,content_version_id:call.input.expected_content_version_id,previous_guidance_version_id:call.input.expected_guidance_version_id,source_sha256:captures[cell].sourceSha,guidance_version:{id,course_blueprint_id:call.input.blueprint_id,version_number:2,source_draft_revision:call.input.expected_draft_revision,snapshot_sha256:classroomGuidanceAdoptionSnapshotHash(f,call.blueprintIndex)}});captures[cell].savedId=id}
      else assert.deepEqual(raw,{code:cell===3?'PT409':'PT403',message:cell===3?'class_guidance_adoption_changed':'class_guidance_adoption_forbidden',details:null,hint:null})
      physical.push({label:call.label,phase,method:'POST',status:phase==='source'?200:call.status,bytes:size,sha256:hash(data),dtoSha256:null});await guard();return new Response(data,{status:response.status,headers:response.headers})
    }catch{abandoned=true;failed=true;aborter.abort();throw refused()}
    finally{clearTimeout(timer);caller?.removeEventListener('abort',abort)
      if(!bodySettled&&response?.body){try{account('control',1);await bounded(reader?Promise.all([reader.cancel(),reader.closed]).then(()=>{}):response.body.cancel(),controls.cleanupDeadline);bodySettled=true}catch{poisoned=true}}
      reader?.releaseLock();release()}}
  const client=createClient<Database>(target.origin,target.serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:countedFetch}})
  const settle=async()=>{let timer:ReturnType<typeof setTimeout>|undefined
    try{await Promise.race([(async()=>{while(pending.size)await Promise.allSettled([...pending])})(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(refused()),Math.max(0,controls.cleanupDeadline-Date.now()))})]);assert(!pending.size&&sessions===0&&!poisoned)}
    catch{poisoned=true;throw refused()}finally{if(timer)clearTimeout(timer)}}
  const receipt=()=>freeze(assertClassroomGuidanceAdoptionProofReceipt({version:1,scope:'classroom-guidance-adoption-v1',requests,httpDispatches,sourceRequests,writerRequests,adapterCalls,rpcRequests:0,
    controls:controlCount,guardCalls,descriptorCalls,bytes,maximumSessions,sessions,unsettled:pending.size,failed,poisoned,complete,restoreState,physical:[...physical],bindings:[...bindings],nativeVerified:false}))
  return Object.freeze({settle,receipt,async sdk(){try{check();assert(!running&&cell===-1);running=true;await sql('prepare');await sql('setup');await sql('witness')
    for(cell=0;cell<calls.length;cell++){const call=calls[cell];adapterCalls++
      let result:Awaited<ReturnType<typeof actualAdapter>>|undefined,denied:unknown
      try{result=await actualAdapter({supabase:client,actorId:call.actorId,classroomId:call.classroomId,input:call.input})}catch(error){denied=error}check()
      if(call.status===200){assert.equal(denied,undefined);assert.deepEqual(result,{version:2});physical[2*cell+1].dtoSha256=hash(JSON.stringify(result))}
      else{assert(denied instanceof ApiError);assert.equal(denied.statusCode,call.status)}
      assert.equal(requests,2*(cell+1));await sql(`observe-${cell}`);if(cell<3){assert(captures[cell].savedId);bindings.push({label:call.label,versionIdSha256:hash(captures[cell].savedId!),snapshotSha256:classroomGuidanceAdoptionSnapshotHash(f,call.blueprintIndex),versionNumber:2,sqlBound:true})}}
    await settle();await sql('restore-temporary',true);
    await settle();await sql('preservation',true);await settle();complete=true;return receipt()
  }catch{failed=true;complete=false;throw refused()}finally{running=false
    if(restoreState!=='not-prepared'){try{await settle();if(!used.has('restore-temporary'))await sql('restore-temporary',true);if(!used.has('preservation'))await sql('preservation',true)}catch{poisoned=true}}}}})
}
