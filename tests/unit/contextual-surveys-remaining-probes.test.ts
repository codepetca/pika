/** Executes the actual lexical probe function extracted from its source AST.
 * Only native carriers/HTTP/clock are offline; no SQL/network operation runs. */
import {afterEach,describe,expect,it,vi} from 'vitest'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {surveyCancellationProofDescriptor,inspectSurveyCancellationPendingShape} from '../../scripts/contextual-surveys-cancellation-proof'
import {surveyWireProofDescriptor,inspectSurveyWireReceipt} from '../../scripts/contextual-surveys-wire-proof'
import {newSurveyNativeFixture} from '../../scripts/contextual-surveys-native-contracts'
import {newAssignmentListProofFixture} from '../../scripts/contextual-assignment-list-proof-fixture'
import {Survey263UnjoinedChildError} from '../../scripts/contextual-assignment-list-proof-platform'

const f=newSurveyNativeFixture(newAssignmentListProofFixture(new Date('2026-10-12T12:00:00Z')))
const remaining={cancellation:surveyCancellationProofDescriptor(f),wire:surveyWireProofDescriptor(f)}
const source=readFileSync('scripts/contextual-test-draft-save-native-contracts.ts','utf8'),ast=ts.createSourceFile('engine.ts',source,ts.ScriptTarget.Latest,true)
let extracted=''
function visit(n:ts.Node){if(ts.isFunctionDeclaration(n)&&n.name?.text==='runSurveyRemainingProbes')extracted=n.getText(ast);ts.forEachChild(n,visit)}visit(ast)
assert(extracted)
const javascript=ts.transpileModule(extracted,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
class Deadline extends Error{}
async function flush(){for(let n=0;n<3000;n++)await Promise.resolve()}
function harness(mode:'normal'|'observer-fail'|'early-http'|'never-http'|'guard-expired'|'wire-cancel-reject'|'late-headers'|'late-chunk'|'prepare-unjoined'|'observer-unjoined'|'observer-unjoined-never-http'|'prepare-predispatch'|'http-reset-restore-fail'|'cancel-restore-fail'|'cancel-receipt-bad'|'cancel-receipt-absent'|'wire-restore-fail'|'wire-receipt-bad'='normal'){
  const events:string[]=[],startedAt=Date.now(),cleanupDeadline=startedAt+900000
  let requests=0,bytes=0,wireStartBytes=0,respond:((r:Response)=>void)|undefined,reset:(()=>void)|undefined,wireCancelClose:(()=>void)|undefined
  const cancel=vi.fn(()=>new Promise<void>((resolve,reject)=>{wireCancelClose=()=>mode==='wire-cancel-reject'?reject(new Error('private cancel')):resolve()}))
  const pending=()=>({stage:'pending',descriptorSha256:remaining.cancellation.descriptorSha256,nativeVerified:false,backend:{pid:321,started:new Date(startedAt-100).toISOString(),database:'postgres',sessionUser:'authenticator',name:remaining.cancellation.binding.marker,state:'active',waitType:'Timeout',waitEvent:'PgSleep',transactionStartedAt:new Date(startedAt).toISOString(),queryStartedAt:new Date(startedAt).toISOString(),observedAt:new Date(Date.now()).toISOString(),poll:1}})
  const holder={surveyExecute(_side:string,kind:string,_sql:string){events.push(kind)
    if(kind==='cancel-prepare'&&(mode==='prepare-unjoined'||mode==='prepare-predispatch'))return{dispatchedAt:mode==='prepare-unjoined'?Date.now():undefined,completedAt:undefined,completion:Promise.reject(new Error('private native frame failure'))}
    if(kind==='cancel-observer'&&(mode==='observer-unjoined'||mode==='observer-unjoined-never-http'))return{dispatchedAt:Date.now(),completedAt:undefined,completion:Promise.reject(new Error('private native frame failure'))}
    if(kind==='cancel-observer'&&mode==='observer-fail')return{completion:Promise.reject(new Error('private observer failure'))}
    const r=kind==='cancel-prepare'?{stage:'prepared',descriptorSha256:remaining.cancellation.descriptorSha256,nativeVerified:false}:
      kind==='cancel-observer'?pending():{stage:'wire-prepared',descriptorSha256:remaining.wire.descriptorSha256,innerBytes:8388608,minimumWireBytes:8388609,sqlWireBytes:8388700,nativeVerified:false}
    return{dispatchedAt:Date.now(),completedAt:Date.now(),completion:Promise.resolve(),result:r}
  }}
  const fetch=vi.fn(async(url:string)=>{events.push(url.endsWith('respond_to_survey_for_member_v1')?'http-cancel':'http-wire')
    if(url.endsWith('respond_to_survey_for_member_v1')){
      if(mode==='early-http')return new Response('{}',{status:500,headers:{'content-type':'application/json'}})
      return new Promise<Response>((resolve,reject)=>{respond=resolve;reset=()=>reject(new TypeError('private connection reset'))})
    }
    let chunks=0;wireStartBytes=bytes
    if(mode==='late-headers')queueMicrotask(()=>vi.setSystemTime(startedAt+60000))
    return new Response(new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array(chunks++<128?65536:1));if(mode==='late-chunk'&&chunks>1)vi.setSystemTime(startedAt+60000)},cancel}),{status:200,headers:{'content-type':'application/json','content-length':'9999999'}})
  })
  const restorationControl=async(sql:string)=>{events.push(sql===remaining.wire.frames.restore?'wire-restore':sql===remaining.cancellation.frames.restoreAfterDispatch?'cancel-restore-after':'cancel-restore-before')
    if(sql===remaining.wire.frames.restore&&mode==='wire-restore-fail'||sql===remaining.cancellation.frames.restoreAfterDispatch&&(mode==='cancel-restore-fail'||mode==='http-reset-restore-fail'))throw new Error('private backend not settled')
    return[{result:sql===remaining.wire.frames.restore?{stage:'wire-restored',descriptorSha256:remaining.wire.descriptorSha256,archiveRevisionDelta:mode==='wire-receipt-bad'?0:4,blueprintRevisionDelta:2,stateSha256:'a'.repeat(64),nativeVerified:false}:{stage:mode==='cancel-receipt-absent'?'absent-unverified':'restored',descriptorSha256:remaining.cancellation.descriptorSha256,stateSha256:mode==='cancel-receipt-bad'?'invalid':'a'.repeat(64),nativeVerified:false}}]
  }
  const instantiate=new Function('assert','remaining','profile','component','surveyPair','assertSurvey269RemainingExchange','chargeSurvey269RemainingRequest','chargeComponent','guard','check','surveyResult','restorationControl','fetch','inspectSurveyCancellationPendingShape','inspectSurveyWireReceipt','Survey263UnjoinedChildError','SurveySdkDeadlineError',`
    let surveySdkWorkStartedAt,surveySdkWorkDeadline,remainingProbeOwned=false,remainingHttpPending=false,remainingProbeStage='none',remainingCancellationDone=false,remainingWireDone=false,surveyUnjoined=false;
    function checkJoined(){if(surveyUnjoined)throw new Survey263UnjoinedChildError()}
    function checkSettlement(){checkJoined();assert(Date.now()<profile.survey263Budget.cleanupDeadline)}
    function checkSurveySdkAdmission(){if(surveySdkWorkDeadline!==undefined&&Date.now()>=surveySdkWorkDeadline)throw new SurveySdkDeadlineError()}
    let firstFault;function record(kind,role,state,checkpoint){firstFault??={kind,role,state,checkpoint}}
    ${javascript}
    return {run:runSurveyRemainingProbes,state:()=>({surveySdkWorkStartedAt,surveySdkWorkDeadline,remainingProbeOwned,remainingHttpPending,remainingProbeStage,remainingCancellationDone,remainingWireDone,surveyUnjoined,firstFault})}`)
  const engine=instantiate(assert,remaining,{surveySdk:{status:{SERVICE_ROLE_KEY:'offline'}},survey263Budget:{workDeadline:startedAt+720000,cleanupDeadline},survey269Exchange:{}},true,{},()=>{},()=>{requests++;assert(requests<=16)},(n:number)=>{bytes+=n;assert(bytes<=67108864)},async()=>{events.push('guard');if(mode==='guard-expired')vi.setSystemTime(startedAt+60000)},()=>{},(c:{result:unknown})=>c.result,restorationControl,fetch,inspectSurveyCancellationPendingShape,inspectSurveyWireReceipt,Survey263UnjoinedChildError,Deadline) as{run:(h:typeof holder)=>Promise<void>;state:()=>Record<string,unknown>}
  return{events,engine,holder,fetch,cancel,startedAt,cleanupDeadline,requests:()=>requests,bytes:()=>bytes,wireBytes:()=>bytes-wireStartBytes,
    reply(){vi.setSystemTime(startedAt+8000);respond?.(new Response(JSON.stringify({code:'57014',message:'cancelled',details:null,hint:null}),{status:500,headers:{'content-type':'application/json'}}))},reset(){reset?.()},closeCancel(){wireCancelClose?.()}}
}
afterEach(()=>vi.useRealTimers())
describe('actual remaining engine probe ownership (offline)',()=>{
  it.each(['cancel-restore-fail','cancel-receipt-bad','cancel-receipt-absent','http-reset-restore-fail'] as const)('poisons unconfirmed cancellation restoration and never continues (%s)',async mode=>{
    vi.useFakeTimers();const h=harness(mode),p=h.engine.run(h.holder).catch(e=>e);await flush()
    if(mode==='http-reset-restore-fail')h.reset();else h.reply()
    expect(await p).toBeInstanceOf(Survey263UnjoinedChildError)
    expect(h.events.filter(e=>e==='cancel-restore-after')).toHaveLength(1)
    expect(h.events).not.toContain('wire-prepare');expect(h.engine.state().surveyUnjoined).toBe(true)
    if(mode==='http-reset-restore-fail')expect(h.engine.state().firstFault).toMatchObject({checkpoint:'probe-http'})
  })
  it.each(['wire-restore-fail','wire-receipt-bad'] as const)('poisons unconfirmed wire restoration/evidence (%s)',async mode=>{
    vi.useFakeTimers();const h=harness(mode),p=h.engine.run(h.holder).catch(e=>e);await flush();h.reply();await flush();h.closeCancel()
    expect(await p).toBeInstanceOf(Survey263UnjoinedChildError);expect(h.events.filter(e=>e==='wire-restore')).toHaveLength(1);expect(h.engine.state().surveyUnjoined).toBe(true)
  })
  it('poisons a dispatched prepare frame with no completion before any restoration or HTTP',async()=>{
    vi.useFakeTimers();const h=harness('prepare-unjoined'),p=h.engine.run(h.holder).catch(e=>e);await flush()
    expect(await p).toBeInstanceOf(Survey263UnjoinedChildError);expect(h.fetch).not.toHaveBeenCalled();expect(h.events.filter(e=>e.includes('restore'))).toEqual([])
  })
  it('permits only exact before-dispatch restoration for a native frame denied before dispatch',async()=>{
    vi.useFakeTimers();const h=harness('prepare-predispatch'),p=h.engine.run(h.holder).catch(e=>e);await flush()
    expect(await p).not.toBeInstanceOf(Survey263UnjoinedChildError);expect(h.fetch).not.toHaveBeenCalled();expect(h.events.filter(e=>e.includes('restore'))).toEqual(['cancel-restore-before']);expect(h.engine.state().surveyUnjoined).toBe(false)
  })
  it.each([false,true])('a poisoned native observer still passively joins owned HTTP before returning (neverHTTP=%s)',async never=>{
    vi.useFakeTimers();const h=harness(never?'observer-unjoined-never-http':'observer-unjoined');let settled=false
    const p=h.engine.run(h.holder).catch(e=>e).finally(()=>{settled=true});await flush()
    expect(h.engine.state().surveyUnjoined).toBe(true);expect(settled).toBe(false);expect(h.events.filter(e=>e.includes('restore'))).toEqual([])
    if(never)await vi.advanceTimersByTimeAsync(900000);else h.reply()
    expect(await p).toBeInstanceOf(Survey263UnjoinedChildError);expect(h.events.filter(e=>e.includes('restore'))).toEqual([])
  })
  it('joins original cancellation, observes pending then streams actual crossing bytes and waits for positive cancel before SQL restore',async()=>{
    vi.useFakeTimers();const h=harness();let settled=false;const p=h.engine.run(h.holder).finally(()=>{settled=true})
    await flush();expect(h.events).toContain('cancel-observer');expect(h.events).not.toContain('cancel-restore-after')
    h.reply();await flush();expect(h.cancel).toHaveBeenCalledTimes(1);expect(h.events).not.toContain('wire-restore');expect(settled).toBe(false)
    h.closeCancel();await p
    expect(h.events.filter(e=>e.includes('restore'))).toEqual(['cancel-restore-after','wire-restore'])
    expect(h.requests()).toBe(2);expect(h.bytes()).toBeGreaterThan(8388608)
    expect(h.engine.state()).toMatchObject({remainingCancellationDone:true,remainingWireDone:true,remainingProbeOwned:false,remainingProbeStage:'complete',surveySdkWorkDeadline:h.startedAt+60000})
  })
  it('joins a failed observer original HTTP, then emits sticky ownership poison without restore or wire dispatch',async()=>{
    vi.useFakeTimers();const h=harness('observer-fail');let settled=false;const p=h.engine.run(h.holder).catch(e=>e).finally(()=>{settled=true})
    await flush();expect(settled).toBe(false);expect(h.events.filter(e=>e.includes('restore'))).toEqual([])
    h.reply();expect(await p).toBeInstanceOf(Survey263UnjoinedChildError)
    expect(h.engine.state().surveyUnjoined).toBe(true);expect(h.requests()).toBe(1);expect(h.events).not.toContain('wire-prepare')
  })
  it('does not accept an HTTP that already settled before the pending observer',async()=>{
    vi.useFakeTimers();const h=harness('early-http');const p=h.engine.run(h.holder).catch(e=>e);await flush()
    expect(await p).toBeInstanceOf(Survey263UnjoinedChildError);expect(h.events.filter(e=>e.includes('restore'))).toEqual([])
  })
  it('holds until the original cleanup clock on never-settled HTTP, then poison blocks restoration',async()=>{
    vi.useFakeTimers();const h=harness('never-http');let settled=false;const p=h.engine.run(h.holder).catch(e=>e).finally(()=>{settled=true})
    await flush();await vi.advanceTimersByTimeAsync(60000);expect(settled).toBe(false);expect(h.events.filter(e=>e.includes('restore'))).toEqual([])
    await vi.advanceTimersByTimeAsync(840000);expect(await p).toBeInstanceOf(Survey263UnjoinedChildError)
    expect(h.events).not.toContain('wire-prepare');expect(h.engine.state().surveyUnjoined).toBe(true)
  })
  it('pre-dispatch expiry admits only exact before-dispatch restoration, never ordinary HTTP',async()=>{
    vi.useFakeTimers();const h=harness('guard-expired');const p=h.engine.run(h.holder).catch(e=>e);await flush()
    expect(await p).toBeInstanceOf(Deadline);expect(h.fetch).not.toHaveBeenCalled();expect(h.requests()).toBe(0)
    expect(h.events.filter(e=>e.includes('restore'))).toEqual(['cancel-restore-before'])
  })
  it('a rejected body cancel remains typed poison and cannot restore or continue',async()=>{
    vi.useFakeTimers();const h=harness('wire-cancel-reject');const p=h.engine.run(h.holder).catch(e=>e);await flush();h.reply();await flush();h.closeCancel();await flush()
    expect(await p).toBeInstanceOf(Survey263UnjoinedChildError);expect(h.events).not.toContain('wire-restore');expect(h.engine.state().surveyUnjoined).toBe(true)
  })
  it.each(['late-headers','late-chunk'] as const)('owns %s before post-await expiry, counts delivered bytes and joins body cancellation before restore',async mode=>{
    vi.useFakeTimers();const h=harness(mode);let settled=false;const p=h.engine.run(h.holder).catch(e=>e).finally(()=>{settled=true})
    await flush();h.reply();await flush();expect(h.cancel).toHaveBeenCalledTimes(1);expect(settled).toBe(false)
    expect(h.events).not.toContain('wire-restore')
    if(mode==='late-chunk')expect(h.wireBytes()).toBeGreaterThanOrEqual(65536)
    h.closeCancel();expect(await p).toBeInstanceOf(Deadline);expect(h.events).toContain('wire-restore');expect(h.engine.state().remainingWireDone).toBe(false)
  })
})
