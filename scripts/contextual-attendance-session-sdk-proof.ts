/** Inert owner day-view SDK leaf. The root supplies counted native fetch and SQL. */
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '../src/types/database'
import { ApiError } from '../src/lib/api-error'
import { loadContextualAttendanceSession } from '../src/lib/server/contextual-attendance-session'
import { teacherAttendanceSnapshotRowsSchema } from '../src/lib/server/bara-attendance-view'
import { ATTENDANCE_SESSION_CAPS as caps,assertAttendanceSessionFixture,assertAttendanceSessionSqlDescriptor,attendanceSessionFreeze as freeze,
  attendanceSessionHash as hash,attendanceSessionSdkInventory,attendanceSessionSqlDescriptors,attendanceSessionExpectedSnapshot,
  attendanceSessionExpectedView,newAttendanceSessionFixture,type AttendanceSessionFixture,type AttendanceSessionSdkCall,type AttendanceSessionSqlDescriptor } from './contextual-attendance-session-native-fixture'
export type AttendanceSessionProofControls=Readonly<{deadline:number;cleanupDeadline:number;guard:(profile:'baseline-off')=>Promise<void>;
  account:(kind:'request'|'control'|'bytes',count:number)=>void;httpSession:(active:boolean)=>void;sql:(frame:AttendanceSessionSqlDescriptor)=>Promise<unknown>}>
const inventory=attendanceSessionSdkInventory(newAttendanceSessionFixture('assignmentlist_000000000000')),labels=inventory.map(c=>c.label)
const snapshotSchema=z.object({actor_id:z.string().uuid(),classroom_id:z.string().uuid(),class_date:z.string().date(),runtime_integration:z.literal('ready'),
  scope_mode:z.enum(['teacher_entitlements','exact_canary']),installation_ref:z.string(),observed_at:z.string().datetime({offset:true}),status:z.enum(['ok','forbidden','blocked']),
  integration:z.enum(['disabled','not_configured','ready']),students:z.array(z.object({id:z.string().uuid(),email:z.string(),first_name:z.string(),last_name:z.string()}).strict()),rows:teacherAttendanceSnapshotRowsSchema}).strict()
const sha=z.string().regex(/^[a-f0-9]{64}$/),refused=()=>new Error('attendance_session_proof_refused')
const receiptSchema=z.object({version:z.literal(1),scope:z.literal('attendance-session-read-v1'),requests:z.number().int().min(0).max(16),httpDispatches:z.number().int().min(0).max(16),
  adapterRequests:z.number().int().min(0).max(13),rpcRequests:z.number().int().min(0).max(3),controls:z.number().int().min(0).max(caps.controls),guardCalls:z.number().int().min(0).max(caps.controls),
  descriptorCalls:z.number().int().min(0).max(caps.sqlFrames),bytes:z.number().int().min(0).max(caps.bytes),maximumSessions:z.number().int().min(0).max(1),sessions:z.number().int().min(0).max(1),
  unsettled:z.number().int().min(0).max(caps.controls),failed:z.boolean(),poisoned:z.boolean(),complete:z.boolean(),restoreState:z.enum(['not-prepared','prepared','restored']),
  physical:z.array(z.object({label:z.enum(labels as[string,...string[]]),method:z.literal('POST'),status:z.literal(200),bytes:z.number().int().min(0).max(caps.responseBytes),sha256:sha,dtoSha256:sha.nullable()}).strict()).max(16),nativeVerified:z.literal(false),
}).strict().refine(r=>r.requests===r.httpDispatches&&r.requests===r.adapterRequests+r.rpcRequests&&r.physical.length<=r.requests
  &&r.physical.every((p,n)=>p.label===labels[n])&&new Set(r.physical.map(p=>p.label)).size===r.physical.length
  &&(!r.complete||r.requests===16&&r.adapterRequests===13&&r.rpcRequests===3&&r.physical.length===16&&r.descriptorCalls===26&&r.guardCalls===84
    &&r.physical.every((p,n)=>Boolean(p.dtoSha256)===(inventory[n].adapter&&inventory[n].view!=='none'))
    &&r.maximumSessions===1&&r.sessions===0&&r.unsettled===0&&!r.failed&&!r.poisoned&&r.restoreState==='restored'))
export function assertAttendanceSessionProofReceipt(input:unknown){return receiptSchema.parse(input)}
/** PostgreSQL/PostgREST and JS may spell the same instant with different offsets. */
export function normalizeAttendanceSessionInstants(value:unknown):unknown{
  if(typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(value)){const date=Date.parse(value);assert(Number.isFinite(date));return new Date(date).toISOString()}
  if(Array.isArray(value))return value.map(normalizeAttendanceSessionInstants)
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normalizeAttendanceSessionInstants(v)]))
  return value
}
const actualAdapter=Object.freeze(loadContextualAttendanceSession)
export function createAttendanceSessionSdkProof(f:AttendanceSessionFixture,target:Readonly<{origin:string;serviceRoleKey:string}>,original:typeof fetch,controls:AttendanceSessionProofControls){
  assertAttendanceSessionFixture(f);assert.equal(target.origin,'http://127.0.0.1:54331');assert(typeof original==='function'&&target.serviceRoleKey.length>0)
  assert(controls.deadline>Date.now()&&controls.deadline-Date.now()<=caps.workMs);assert(controls.cleanupDeadline>controls.deadline&&controls.cleanupDeadline-controls.deadline<=caps.cleanupMs)
  const calls=attendanceSessionSdkInventory(f),frames=attendanceSessionSqlDescriptors(f),used=new Set<string>(),pending=new Set<Promise<unknown>>()
  const physical:z.infer<typeof receiptSchema>['physical']=[]
  let requests=0,httpDispatches=0,adapterRequests=0,rpcRequests=0,controlCount=0,guardCalls=0,descriptorCalls=0,bytes=0,sessions=0,maximumSessions=0
  let failed=false,poisoned=false,complete=false,running=false,cell=-1,restoreState:'not-prepared'|'prepared'|'restored'='not-prepared'
  const account=(kind:'request'|'control'|'bytes',n:number)=>{assert(Number.isSafeInteger(n)&&n>=0)
    if(kind==='request'){httpDispatches+=n;assert(httpDispatches<=caps.sdkRequests)}if(kind==='control'){controlCount+=n;assert(controlCount<=caps.controls)}
    if(kind==='bytes'){bytes+=n;assert(bytes<=caps.bytes)}controls.account(kind,n)}
  const own=<T>(p:Promise<T>):Promise<T>=>{pending.add(p);void p.then(()=>pending.delete(p),()=>{pending.delete(p);poisoned=true});return p}
  const bounded=async<T>(p:Promise<T>,deadline:number)=>{let timer:ReturnType<typeof setTimeout>|undefined
    try{return await Promise.race([own(p),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(refused()),Math.max(0,deadline-Date.now()))})])}finally{if(timer)clearTimeout(timer)}}
  const check=()=>assert(!failed&&!poisoned&&Date.now()<controls.deadline)
  const guard=async(cleanup=false)=>{if(cleanup)assert(Date.now()<controls.cleanupDeadline&&!pending.size&&!sessions&&!poisoned);else check()
    assert(++guardCalls<=caps.controls);account('control',1);await bounded(controls.guard('baseline-off'),cleanup?controls.cleanupDeadline:controls.deadline)
    if(cleanup)assert(Date.now()<controls.cleanupDeadline&&!pending.size&&!sessions&&!poisoned);else check()}
  const sql=async(name:AttendanceSessionSqlDescriptor['name'],cleanup=false)=>{assert(!used.has(name));used.add(name);assert(++descriptorCalls<=caps.sqlFrames)
    const frame=frames.find(r=>r.name===name)!;assertAttendanceSessionSqlDescriptor(f,frame);await guard(cleanup);account('control',1)
    if(name==='prepare')restoreState='prepared'
    const result=await bounded(controls.sql(frame),cleanup?controls.cleanupDeadline:controls.deadline);assert(Buffer.byteLength(JSON.stringify(result))<=4096)
    if(name==='witness')assert.deepEqual(result,{studentOwner:true,membershipGenerationRows:3,facts:2,outbox:4,nativeVerified:false})
    else if(name==='preservation')assert.deepEqual(result,{sourcePreserved:true,originalsPreserved:true,nativeVerified:false})
    else if(name.startsWith('observe-'))assert.deepEqual(result,{case:calls[Number(name.slice(8))].label,preserved:true,nativeVerified:false})
    else assert.deepEqual(result,{stage:name,nativeVerified:false})
    await guard(cleanup);if(name==='restore-baseline')restoreState='restored'}
  const validate=(raw:unknown,call:AttendanceSessionSdkCall)=>{const data=snapshotSchema.parse(raw)
    assert.deepEqual(normalizeAttendanceSessionInstants(data),normalizeAttendanceSessionInstants(attendanceSessionExpectedSnapshot(f,call,data.observed_at)));return data}
  const countedFetch:typeof fetch=async(resource,init={})=>{
    let response:Response|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined,acquired=false,bodySettled=false,actualSettled=false,abandoned=false
    const aborter=new AbortController(),caller=init.signal,abort=()=>aborter.abort(),timer=setTimeout(abort,Math.max(1,Math.min(caps.requestMs,controls.deadline-Date.now())))
    const aborted=new Promise<never>((_,reject)=>aborter.signal.addEventListener('abort',()=>reject(refused()),{once:true}));void aborted.catch(()=>{})
    const race=<T>(p:Promise<T>)=>Promise.race([own(p),aborted]),release=()=>{if(acquired&&actualSettled&&bodySettled){acquired=false;sessions--;controls.httpSession(false)}}
    try{check();assert(running&&cell>=0&&cell<calls.length&&!caller?.aborted&&!sessions);caller?.addEventListener('abort',abort,{once:true})
      const call=calls[cell];assert(!used.has(`http:${cell}`));used.add(`http:${cell}`);assert(typeof resource==='string'||resource instanceof URL);const url=new URL(String(resource))
      assert.equal(url.href,`${target.origin}/rest/v1/rpc/read_attendance_session_for_owner_v1`);assert(init.method==='POST'&&init.body===JSON.stringify(call.args))
      assert(Object.keys(init).every(key=>['method','headers','body','signal','redirect'].includes(key)));assert(init.redirect===undefined||init.redirect==='error')
      const headers=new Headers(init.headers);assert.equal(headers.get('authorization'),`Bearer ${target.serviceRoleKey}`);assert.equal(headers.get('apikey'),target.serviceRoleKey)
      for(const[name]of headers)assert(['authorization','apikey','x-client-info','content-type','accept-profile','content-profile','accept'].includes(name))
      const requestBytes=Buffer.byteLength(init.body as string);assert(requestBytes<=caps.requestBytes);await guard();assert(!caller?.aborted&&!aborter.signal.aborted)
      account('request',1);account('bytes',requestBytes);requests++;if(call.adapter)adapterRequests++;else rpcRequests++
      assert(++sessions<=caps.sessions);maximumSessions=Math.max(maximumSessions,sessions);acquired=true;controls.httpSession(true)
      const operation=(async()=>{try{const received=await original(url.href,{...init,redirect:'error',signal:aborter.signal});response=received
        if(abandoned||aborter.signal.aborted){await own(Promise.resolve(received.body?.cancel()));bodySettled=true;throw refused()}return received
      }catch(error){if(!response)bodySettled=true;throw error}finally{actualSettled=true;release()}})()
      response=await race(operation);assert(response instanceof Response&&response.status===200&&!response.redirected&&!response.headers.has('location'))
      assert(!response.url||response.url===url.href);assert(response.headers.get('content-type')?.startsWith('application/json'));assert(response.body)
      const length=response.headers.get('content-length');assert(length===null||/^\d+$/.test(length)&&Number(length)<=caps.responseBytes)
      reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0
      for(;;){account('control',1);const part=await race(reader.read());if(part.done)break;size+=part.value.byteLength;account('bytes',part.value.byteLength);assert(size<=caps.responseBytes);chunks.push(part.value)}
      bodySettled=true;release();const data=Buffer.concat(chunks);validate(JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(data)),call)
      physical.push({label:call.label,method:'POST',status:200,bytes:size,sha256:hash(data),dtoSha256:null});await guard();return new Response(data,{status:200,headers:response.headers})
    }catch{abandoned=true;failed=true;aborter.abort();throw refused()}
    finally{clearTimeout(timer);caller?.removeEventListener('abort',abort)
      if(!bodySettled&&response?.body){try{account('control',1);await bounded(reader?Promise.all([reader.cancel(),reader.closed]).then(()=>{}):response.body.cancel(),controls.cleanupDeadline);bodySettled=true}catch{poisoned=true}}
      reader?.releaseLock();release()}}
  const client=createClient<Database>(target.origin,target.serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:countedFetch}})
  const settle=async()=>{let timer:ReturnType<typeof setTimeout>|undefined
    try{await Promise.race([(async()=>{while(pending.size)await Promise.allSettled([...pending])})(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(refused()),Math.max(0,controls.cleanupDeadline-Date.now()))})]);assert(!pending.size&&sessions===0&&!poisoned)}
    catch{poisoned=true;throw refused()}finally{if(timer)clearTimeout(timer)}}
  const receipt=()=>freeze(assertAttendanceSessionProofReceipt({version:1,scope:'attendance-session-read-v1',requests,httpDispatches,adapterRequests,rpcRequests,
    controls:controlCount,guardCalls,descriptorCalls,bytes,maximumSessions,sessions,unsettled:pending.size,failed,poisoned,complete,restoreState,physical:[...physical],nativeVerified:false}))
  return Object.freeze({settle,receipt,async sdk(){try{check();assert(!running&&cell===-1);running=true;await sql('prepare');await sql('setup');await sql('witness')
    for(cell=0;cell<calls.length;cell++){const call=calls[cell];if(call.transition){if(call.transition==='restore-baseline')await settle();await sql(call.transition,call.transition==='restore-baseline')}
      if(call.adapter){let result:Awaited<ReturnType<typeof actualAdapter>>|undefined,denied:unknown
        try{result=await actualAdapter({supabase:client,actorId:call.args.p_actor_id,classroomId:call.args.p_classroom_id,classDate:call.args.p_class_date})}catch(error){denied=error}check()
        if(call.status==='ok'){assert.equal(denied,undefined);assert.deepEqual(normalizeAttendanceSessionInstants(result),normalizeAttendanceSessionInstants(attendanceSessionExpectedView(f,call)))
          physical[cell].dtoSha256=hash(JSON.stringify(normalizeAttendanceSessionInstants(result)))}else{assert(denied instanceof ApiError);assert.equal(denied.statusCode,call.status==='forbidden'?403:503)}
      }else{const result=await client.rpc('read_attendance_session_for_owner_v1',call.args).abortSignal(AbortSignal.timeout(caps.requestMs));check();assert.equal(result.status,200);assert.equal(result.error,null);validate(result.data,call)}
      assert.equal(requests,cell+1);await sql(`observe-${cell}`)}
    await settle();await sql('preservation',true);await settle();complete=true;return receipt()
  }catch{failed=true;complete=false;throw refused()}finally{running=false
    if(restoreState!=='not-prepared'){try{await settle();if(!used.has('restore-baseline'))await sql('restore-baseline',true);if(!used.has('preservation'))await sql('preservation',true)}catch{poisoned=true}}}}})
}
