/** Source-only sealed SDK transport. No CLI/lifecycle/native execution here.
 * Root supplies the actual complete resource guard and sealed IO snapshots. */
import assert from 'node:assert/strict'
import { z } from 'zod'
import { getFallbackAssessmentTitle } from '../src/lib/assessment-titles'
import { boundedAssignmentListJson } from '../src/lib/validations/contextual-assignment-list-read'
import { contextualTestCreateResultSchema } from '../src/lib/validations/contextual-test-create'
import { validateAssignmentListProofTarget } from './check-contextual-assignment-list-reads'
import { TEST_OWNER_CREATE_CAPS, registerTestOwnerCreateWitness, verifyTestOwnerCreateEffects,
  type TestOwnerCreateFixture, type TestOwnerCreateWitness } from './contextual-test-owner-create-proof-fixture'

const API = 'http://127.0.0.1:54331'
const PATH = '/rest/v1/rpc/create_test_for_owner_v1'
const keys = Object.freeze(['p_actor_id', 'p_classroom_id', 'p_title', 'p_deadline'])
const failure = () => new Error('Test owner create proof transport rejected; private details withheld')
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
export function testOwnerCreateRequestManifest(f: TestOwnerCreateFixture) {
  return freeze({version:1 as const,fixtureTag:f.tag,origin:API,path:PATH,method:'POST',sdk:'supabase-js-node/2.93.3',keys,
    caps:TEST_OWNER_CREATE_CAPS,cases:f.cases,privilegeProbe:f.privilegeProbe,nativeVerified:false as const})
}
/** JSON.parse alone silently accepts duplicate object keys. This bounded
 * lexical pass runs only after grammar validation; it is not a second parser. */
function json(text: string): unknown {
  const value: unknown = JSON.parse(text); const stack: Array<Set<string> | null> = []
  for (let i=0;i<text.length;i++) {
    const char=text[i]
    if(char==='{' || char==='[') stack.push(char==='{'?new Set():null)
    else if(char==='}' || char===']') stack.pop()
    else if(char==='"') {
      const start=i++;for(;i<text.length;i++){if(text[i]==='\\')i++;else if(text[i]==='"')break}
      let next=i+1;while(/\s/.test(text[next]??'') && next<text.length)next++
      if(text[next]===':') { const key:string=JSON.parse(text.slice(start,i+1)); const object=stack.at(-1);assert(object && !object.has(key));object.add(key) }
    }
  }
  return value
}
const requestSchema=z.object({p_actor_id:z.string().uuid(),p_classroom_id:z.string().uuid(),p_title:z.string().min(1).max(500),
  p_deadline:z.string().datetime({offset:true}).refine(s=>Number.isFinite(Date.parse(s)))}).strict()
const codes=['PT400','PT403','PT404','PT409','PT503','42501','55000','55P03','40P01','40001','PGRST202','42883','23502','23503','23505','23514','XX000','57014'] as const
const errorSchema=z.object({code:z.enum(codes),message:z.string().max(16384),details:z.string().max(16384).nullable().optional(),hint:z.string().max(16384).nullable().optional()}).strict()
type Scenario=TestOwnerCreateFixture['cases'][number] | TestOwnerCreateFixture['privilegeProbe']
type Pending=Readonly<{caseLabel:string;title:string;ledger:TestOwnerCreateWitness[]}>
/** There is no ledger/state setter. verifyEffects is the only acceptance sink;
 * it calls the existing full-row verifier before retaining its returned ledger. */
export function createTestOwnerCreateProofTransport(f:TestOwnerCreateFixture,rawTarget:unknown,projectId:string,originalFetch:typeof fetch,guard:()=>Promise<void>) {
  let target:ReturnType<typeof validateAssignmentListProofTarget>
  try {
    assert.equal(projectId,`pika_assignment_list_${f.tag.slice(-12)}`);assert(/^testownercreate_[a-f0-9]{12}$/.test(f.tag))
    assert(typeof guard==='function' && typeof originalFetch==='function' && Object.isFrozen(f))
    target=freeze(validateAssignmentListProofTarget(rawTarget,projectId));assert.equal(target.API_URL,API)
  } catch {throw failure()}
  const manifest=testOwnerCreateRequestManifest(f)
  const observed={network:0,rpc:0,storage:0,exchangeBytes:0};let rawPrivilegeFailures=0
  let accepted:TestOwnerCreateWitness[]=freeze([]);let pending:Pending|undefined;let exposed=false
  let context:Scenario|undefined;let start=0;let deadline=0;let dispatched=false;let verified=true;let inFlight=false;let failed=false
  let phase:'idle'|'context'|'validate'|'guard'|'dispatch'|'decode'|'complete'|'effects'|'failed'='idle'
  const seen=new Set<string>()
  function reject():never {failed=true;pending=undefined;phase='failed';throw failure()}
  function readContext(caseLabel:string,startTime=Date.now()) {
    try {
      assert(!failed && !inFlight && verified && !pending && !seen.has(caseLabel))
      const found=[...manifest.cases,manifest.privilegeProbe].find(c=>c.label===caseLabel);assert(found)
      assert(Number.isSafeInteger(startTime) && startTime<=Date.now() && Date.now()<startTime+TEST_OWNER_CREATE_CAPS.requestMs)
      context=found;start=startTime;deadline=startTime+TEST_OWNER_CREATE_CAPS.requestMs;dispatched=false;verified=false;exposed=false;phase='context';seen.add(caseLabel)
    } catch {reject()}
  }
  const safeFetch:typeof fetch=async(resource,init)=>{
    let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;let timer:ReturnType<typeof setTimeout>|undefined
    let reply:Response|undefined
    let caller:AbortSignal|undefined;let listener:(()=>void)|undefined;let abortListener:(()=>void)|undefined
    const controller=new AbortController();let rpcDeadline=0;let operationBytes=0
    const check=()=>assert(!failed && !controller.signal.aborted && !caller?.aborted && Date.now()<rpcDeadline)
    try {
      phase='validate';assert(!failed && context && !dispatched && !inFlight)
      assert(!(resource instanceof Request));assert(typeof resource==='string' || resource instanceof URL)
      const url=new URL(String(resource));assert.equal(url.href,API+PATH);assert.equal(String(resource),API+PATH)
      assert(!url.search && !url.hash && !url.username && !url.password)
      assert(init && init.method==='POST' && typeof init.body==='string')
      assert(Object.keys(init).every(k=>['method','headers','body','signal','redirect'].includes(k)))
      assert(init.redirect===undefined || init.redirect==='error');assert(!init.signal || init.signal instanceof AbortSignal)
      caller=init.signal??undefined;assert(!caller?.aborted)
      const headers=new Headers(init.headers)
      const allowed:Record<string,readonly string[]>={authorization:[`Bearer ${target.SERVICE_ROLE_KEY}`],apikey:[target.SERVICE_ROLE_KEY],
        'x-client-info':[manifest.sdk],accept:['application/json'],'accept-profile':['public'],'content-profile':['public'],'content-type':['application/json']}
      for(const [name,value] of headers)assert(allowed[name]?.includes(value))
      for(const name of ['authorization','apikey','x-client-info','content-type'])assert.equal(headers.get(name),allowed[name][0])
      const rawBody=init.body // Retain checked primitives/cloned headers across both guards.
      const requestBytes=Buffer.byteLength(rawBody,'utf8');assert(requestBytes<=TEST_OWNER_CREATE_CAPS.requestBytes)
      const body=requestSchema.parse(json(rawBody));assert.deepEqual(Object.keys(body).sort(),[...keys].sort())
      assert.equal(body.p_actor_id,context.actorId);assert.equal(body.p_classroom_id,context.classroomId)
      rpcDeadline=Date.parse(body.p_deadline);assert(rpcDeadline<=deadline && rpcDeadline>Date.now());assert.equal(new Date(rpcDeadline).toISOString(),body.p_deadline)
      assert.equal(body.p_title,body.p_title.trim())
      if(context.input.title?.trim())assert.equal(body.p_title,context.input.title.trim())
      else {
        const first=Math.floor(start/1000);const last=Math.floor(Date.now()/1000);assert(last>=first && last-first<=20)
        const titles=Array.from({length:last-first+1},(_,i)=>getFallbackAssessmentTitle(new Date((first+i)*1000)))
        assert(titles.includes(body.p_title))
      }
      operationBytes=requestBytes;dispatched=true;inFlight=true
      listener=()=>controller.abort();caller?.addEventListener('abort',listener,{once:true})
      timer=setTimeout(()=>controller.abort(),Math.max(0,rpcDeadline-Date.now()))
      let abortReject:(reason:Error)=>void=()=>{}
      const aborted=new Promise<never>((_,rejectAbort)=>{abortReject=rejectAbort})
      abortListener=()=>abortReject(failure());controller.signal.addEventListener('abort',abortListener,{once:true})
      const bounded=async<T>(work:()=>Promise<T>)=>{check();const result=await Promise.race([Promise.resolve().then(()=>{check();return work()}),aborted]);check();return result}
      phase='guard';await bounded(guard)
      check();assert(observed.network<TEST_OWNER_CREATE_CAPS.networkRequests && observed.rpc<TEST_OWNER_CREATE_CAPS.rpcRequests)
      observed.network++;observed.rpc++;observed.exchangeBytes+=requestBytes
      phase='dispatch'
      const response=await bounded(()=>Promise.resolve(originalFetch(API+PATH,{method:'POST',headers,body:rawBody,redirect:'error',signal:controller.signal})).then(r=>{
        if(controller.signal.aborted || failed)void r.body?.cancel().catch(()=>{})
        return r
      }))
      reply=response
      assert(response instanceof Response && response.status>=200 && response.status<=599 && !(response.status>=300 && response.status<400))
      assert(!response.redirected && !response.headers.has('location'));assert(!response.url || response.url===API+PATH)
      const length=response.headers.get('content-length');assert(length===null || /^\d+$/.test(length) && Number(length)<=TEST_OWNER_CREATE_CAPS.resultBytes)
      phase='decode';assert(response.body);reader=response.body.getReader()
      const decoder=new TextDecoder('utf-8',{fatal:true});let text='';let responseBytes=0
      let reads=0
      for(;;) {
        assert(++reads<=TEST_OWNER_CREATE_CAPS.resultBytes+1) // Finite even for zero-byte chunks.
        const part=await bounded(()=>reader!.read());if(part.done)break
        responseBytes+=part.value.byteLength;operationBytes+=part.value.byteLength;observed.exchangeBytes+=part.value.byteLength
        assert(responseBytes<=TEST_OWNER_CREATE_CAPS.resultBytes && operationBytes<=TEST_OWNER_CREATE_CAPS.operationBytes)
        text+=decoder.decode(part.value,{stream:true});check()
      }
      text+=decoder.decode();check();const value=json(text);assert(boundedAssignmentListJson(value,TEST_OWNER_CREATE_CAPS.resultBytes))
      // Complete resource guard reattests after ALL response reading. Neither
      // a slow guard nor a stalled read can renew the rooted operation budget.
      phase='guard';await bounded(guard);check()
      if(response.ok) {
        const e=contextualTestCreateResultSchema.parse(value);assert(Date.parse(e.test.created_at)<=Date.now() && Date.parse(e.test.created_at)<=rpcDeadline)
        const ledger=registerTestOwnerCreateWitness(f,accepted,context.label,e,body.p_title)
        pending=freeze({caseLabel:context.label,title:body.p_title,ledger})
      } else {
        const error=errorSchema.parse(value)
        if(error.code==='42501')rawPrivilegeFailures++
        // A different failure is not proof of the named denial. Unknown/busy
        // outcomes end this finite run; they never authorize a retry or ledger.
        assert(context.expectedHTTP!==201)
        assert.equal(error.code,context.label===f.privilegeProbe.label?'42501':context.expectedHTTP===404?'PT404':'PT403')
      }
      check();phase='complete'
      return new Response(text,{status:response.status,headers:{'content-type':'application/json'}})
    } catch {reject()} finally {
      clearTimeout(timer);if(listener)caller?.removeEventListener('abort',listener)
      if(abortListener)controller.signal.removeEventListener('abort',abortListener);controller.abort();inFlight=false
      // Do not await an untrusted cancel callback. releaseLock rejects any
      // still-pending read; Promise.race has already installed rejection handlers.
      if(reader){void reader.cancel().catch(()=>{});reader.releaseLock()}
      else void reply?.body?.cancel().catch(()=>{})
    }
  }
  function verifyEffects(before:unknown,after:unknown,publicResult?:unknown) {
    try {
      assert(!failed && context && dispatched && !inFlight && !verified && phase==='complete')
      phase='effects';accepted=verifyTestOwnerCreateEffects(f,before,after,context.label,pending?.ledger??accepted,publicResult)
      pending=undefined;verified=true;phase='complete'
      return accepted
    } catch {reject()}
  }
  const counts=Object.freeze({get network(){return observed.network},get rpc(){return observed.rpc},get storage(){return observed.storage},get exchangeBytes(){return observed.exchangeBytes}})
  const evidence=Object.freeze({get rawPrivilegeFailures(){return rawPrivilegeFailures}})
  return Object.freeze({target,fetch:safeFetch,counts,evidence,readContext,verifyEffects,
    getPendingWitness(){if(failed || exposed || !pending)return undefined;exposed=true;return pending},
    getVerifiedLedger(){return accepted},
    diagnostic:()=>`DIAG test-owner-create transport phase=${phase} requests=${observed.network} rpc=${observed.rpc} storage=${observed.storage} raw-privilege=${rawPrivilegeFailures}.\n`})
}
