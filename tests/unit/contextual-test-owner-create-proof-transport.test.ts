import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createContextualTest } from '@/lib/server/contextual-test-create'
import { getFallbackAssessmentTitle } from '@/lib/assessment-titles'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerCreateFixture, TEST_OWNER_CREATE_SNAPSHOT_TABLES } from '../../scripts/contextual-test-owner-create-proof-fixture'
import { createTestOwnerCreateProofTransport, testOwnerCreateRequestManifest } from '../../scripts/contextual-test-owner-create-proof-transport'

const f = newTestOwnerCreateFixture(newAssignmentListProofFixture(new Date('2026-10-06T03:00:00Z')))
const project = `pika_assignment_list_${f.tag.slice(-12)}`
const key = `e30.${Buffer.from(JSON.stringify({iss:'supabase-demo',role:'service_role'})).toString('base64url')}.synthetic`
const target = {API_URL:'http://127.0.0.1:54331',DB_URL:'postgresql://postgres:synthetic@127.0.0.1:54332/postgres',SERVICE_ROLE_KEY:key}
const url = target.API_URL + '/rest/v1/rpc/create_test_for_owner_v1'
const headers = () => ({authorization:`Bearer ${key}`,apikey:key,'content-type':'application/json','x-client-info':'supabase-js-node/2.93.3','content-profile':'public'})
const c = f.cases[0]
function envelope(args: {p_actor_id:string;p_classroom_id:string;p_title:string}) {
  const stamp = new Date().toISOString()
  const test = {id:'11111111-1111-4111-8111-111111111111',artifact_id:'22222222-2222-4222-8222-222222222222',classroom_id:args.p_classroom_id,created_by:args.p_actor_id,
    title:args.p_title,status:'draft',show_results:false,documents:[],position:0,points_possible:100,include_in_final:true,created_at:stamp,updated_at:stamp,
    source_artifact_id:null,source_blueprint_version_id:null,blueprint_archived_at:null,questions_locked_at:null,gradebook_category_id:null as string|null,gradebook_weight:10,
    gradebook_maximum_override:null,gradebook_score_scale:1}
  return {version:1,actor_id:args.p_actor_id,classroom_id:args.p_classroom_id,test_id:test.id,test,
    draft:{id:'33333333-3333-4333-8333-333333333333',assessment_type:'test',assessment_id:test.id,classroom_id:args.p_classroom_id,version:1,
      content:{title:args.p_title,show_results:false,question_identity_version:1,questions:[],source_format:'markdown'},created_by:args.p_actor_id,updated_by:args.p_actor_id,created_at:stamp,updated_at:stamp}}
}
function args(label = c.label) { const scenario = [...f.cases,f.privilegeProbe].find(c=>c.label===label)!; return {
  p_actor_id:scenario.actorId,p_classroom_id:scenario.classroomId,p_title:scenario.input.title?.trim() || getFallbackAssessmentTitle(),p_deadline:new Date(Date.now()+20000).toISOString()}}
function harness(fetcher = vi.fn<typeof fetch>(async (_url,init) => new Response(JSON.stringify(envelope(JSON.parse(String(init?.body)))),{headers:{'content-type':'application/json'}}))) {
  const guard = vi.fn(async()=>{})
  const transport = createTestOwnerCreateProofTransport(f,target,project,fetcher,guard)
  const client = createClient<Database>(target.API_URL,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:transport.fetch}})
  return {fetcher,guard,transport,client,invoke(label=c.label,signal?:AbortSignal) {
    const scenario = [...f.cases,f.privilegeProbe].find(c=>c.label===label)!; const start = Date.now()
    transport.readContext(label,start)
    return createContextualTest({supabase:client,actorId:scenario.actorId,input:scenario.input,deadline:start+20000,signal})
  }}
}
type Row=Record<string,unknown>
function baseline() {
  const rows:Record<string,Row[]>=Object.fromEntries(TEST_OWNER_CREATE_SNAPSHOT_TABLES.map(t=>[t,[]]))
  rows['public.users']=f.actors.map(a=>({...a}))
  rows['public.classroom_enrollments']=f.enrollments.map(e=>({...e}))
  rows['public.classrooms']=f.classes.map(cl=>({id:cl.id,title:cl.title,teacher_id:cl.owner,archived_at:cl.archived?f.now:null,blueprint_source_revision:9,updated_at:f.now}))
  rows['public.classroom_archive_revisions']=f.classes.map(cl=>({classroom_id:cl.id,revision:15,updated_at:f.now}))
  rows['public.tests']=f.tests.map(t=>({...envelope(args()).test,...t,created_at:f.now,updated_at:f.now}))
  rows['public.gradebook_categories']=f.classes.flatMap((cl,ci)=>[0,1,2].map(i=>({id:`99999999-9999-4999-8999-${String(ci*3+i).padStart(12,'0')}`,
    classroom_id:cl.id,is_default:i===0,position:i,default_assessment_weight:10})))
  rows.__nontarget_fingerprints=[...TEST_OWNER_CREATE_SNAPSHOT_TABLES,'storage.objects','storage.buckets'].map(table=>({table,fingerprint:'unchanged'}))
  return rows
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime('2026-10-06T03:59:59.900Z')})
afterEach(()=>vi.useRealTimers())

describe('sealed ordinary CREATE request source',()=>{
  it('has fixed local origin/path/SDK/keys, fourteen cases and separate privilege probe',()=>{
    const m = testOwnerCreateRequestManifest(f)
    expect(m.origin).toBe(target.API_URL);expect(m.path).toBe('/rest/v1/rpc/create_test_for_owner_v1');expect(m.sdk).toBe('supabase-js-node/2.93.3')
    expect(m.keys).toEqual(['p_actor_id','p_classroom_id','p_title','p_deadline']);expect(m.cases).toHaveLength(14);expect(m.privilegeProbe.label).toBe('raw-privilege-probe')
    expect(Object.isFrozen(m.cases[0].input)).toBe(true)
  })
  it('rejects wrong project/target/credentials and missing guard without dispatch',()=>{
    const fetcher=vi.fn<typeof fetch>()
    for(const bad of [{...target,API_URL:'http://127.0.0.1:54321'},{...target,DB_URL:'postgresql://postgres:x@localhost:54332/postgres'},{...target,SERVICE_ROLE_KEY:'wrong'}])
      expect(()=>createTestOwnerCreateProofTransport(f,bad,project,fetcher,async()=>{})).toThrow('private details withheld')
    expect(()=>createTestOwnerCreateProofTransport(f,target,'pika',fetcher,async()=>{})).toThrow()
    expect(()=>createTestOwnerCreateProofTransport(f,target,project,fetcher,undefined!)).toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(f.cases.map(c=>[c.label,c]))('installed SDK/helper offline case %s',async(_label,scenario)=>{
    const h=harness(vi.fn<typeof fetch>(async(_url,init)=> scenario.expectedHTTP===201
      ? new Response(JSON.stringify(envelope(JSON.parse(String(init?.body)))),{headers:{'content-type':'application/json'}})
      : new Response(JSON.stringify({code:scenario.expectedHTTP===404?'PT404':'PT403',message:'PRIVATE SQL diagnostics',details:null,hint:null}),{status:scenario.expectedHTTP===404?404:403})))
    if(scenario.expectedHTTP===201) {
      expect(await h.invoke(scenario.label)).toHaveProperty('test.assessment_type','test')
      const pending=h.transport.getPendingWitness()!
      expect(pending.caseLabel).toBe(scenario.label);expect(pending.ledger.at(-1)?.state).toBe('provisional')
      expect(h.transport.getPendingWitness()).toBeUndefined()
      expect(h.transport).not.toHaveProperty('installVerifiedLedger')
      expect(()=>h.transport.readContext('teacher-owner-custom')).toThrow()
    } else {await expect(h.invoke(scenario.label)).rejects.toMatchObject({statusCode:scenario.expectedHTTP});expect(h.transport.getPendingWitness()).toBeUndefined()}
    expect(h.fetcher).toHaveBeenCalledOnce();expect(h.guard).toHaveBeenCalledTimes(2)
    expect(h.transport.counts).toMatchObject({network:1,rpc:1,storage:0});expect(vi.getTimerCount()).toBe(0)
  })
})
describe('closed request dispatch',()=>{
  it.each(['https://example.invalid/rest/v1/rpc/create_test_for_owner_v1',target.API_URL+'/rest/v1/tests',target.API_URL+'/storage/v1/object/x',url+'?x=1',url+'#x',url.replace('127.0.0.1','user@127.0.0.1'),url+'/../create_test_for_owner_v1'])('rejects hostile path %s',async resource=>{
    const h=harness();h.transport.readContext(c.label)
    await expect(h.transport.fetch(resource,{method:'POST',headers:headers(),body:JSON.stringify(args())})).rejects.toThrow('private details withheld')
    expect(h.fetcher).not.toHaveBeenCalled()
  })
  it.each(['GET','PATCH','DELETE'])('rejects method %s',async method=>{
    const h=harness();h.transport.readContext(c.label)
    await expect(h.transport.fetch(url,{method,headers:headers(),body:JSON.stringify(args())})).rejects.toThrow();expect(h.fetcher).not.toHaveBeenCalled()
  })
  it.each(['cookie','x-forwarded-host','prefer','range','x-arbitrary'])('rejects unexpected header %s',async header=>{
    const h=harness();h.transport.readContext(c.label)
    await expect(h.transport.fetch(url,{method:'POST',headers:{...headers(),[header]:'PRIVATE'},body:JSON.stringify(args())})).rejects.toThrow();expect(h.fetcher).not.toHaveBeenCalled()
  })
  it.each(['authorization','apikey','x-client-info','content-profile','content-type'])('rejects header drift %s',async header=>{
    const h=harness();h.transport.readContext(c.label)
    await expect(h.transport.fetch(url,{method:'POST',headers:{...headers(),[header]:'PRIVATE'},body:JSON.stringify(args())})).rejects.toThrow();expect(h.fetcher).not.toHaveBeenCalled()
  })
  it.each(['p_actor_id','p_classroom_id','p_title','p_deadline'])('rejects arbitrary binding %s',async field=>{
    const h=harness();h.transport.readContext(c.label)
    await expect(h.transport.fetch(url,{method:'POST',headers:headers(),body:JSON.stringify({...args(),[field]:'PRIVATE'})})).rejects.toThrow();expect(h.fetcher).not.toHaveBeenCalled()
  })
  it('rejects unknown body fields, duplicate JSONkeys, Request objects and redirect policy',async()=>{
    for(const mode of ['extra','duplicate','request','redirect']) {
      const h=harness();h.transport.readContext(c.label);let body=JSON.stringify(args())
      if(mode==='extra')body=JSON.stringify({...args(),actor_id:c.actorId})
      if(mode==='duplicate')body=body.replace('{','{"p_actor_id":"forged",')
      await expect(h.transport.fetch(mode==='request'?new Request(url):url,{method:'POST',headers:headers(),body,redirect:mode==='redirect'?'follow':'error'})).rejects.toThrow()
      expect(h.fetcher).not.toHaveBeenCalled()
    }
  })
  it('requires explicit known context and one RPC only; guard failure is closed and terminal',async()=>{
    const h=harness();expect(()=>h.transport.readContext('PRIVATE')).toThrow()
    await expect(h.transport.fetch(url,{method:'POST',headers:headers(),body:JSON.stringify(args())})).rejects.toThrow();expect(h.fetcher).not.toHaveBeenCalled()
    const good=harness();await good.invoke();await expect(good.transport.fetch(url,{method:'POST',headers:headers(),body:JSON.stringify(args())})).rejects.toThrow();expect(good.fetcher).toHaveBeenCalledOnce()
    const blocked=harness();blocked.guard.mockRejectedValue(Error('PRIVATE target'));await expect(blocked.invoke()).rejects.toMatchObject({statusCode:503});expect(blocked.fetcher).not.toHaveBeenCalled()
    expect(blocked.transport.diagnostic()).not.toContain('PRIVATE')
  })
  it('does not dispatch mutable URL/init/header drift across an awaited guard',async()=>{
    const h=harness();h.transport.readContext(c.label);const resource=new URL(url)
    const rawBody=JSON.stringify(args());const mutableHeaders=new Headers(headers())
    const init:RequestInit={method:'POST',headers:mutableHeaders,body:rawBody}
    h.guard.mockImplementationOnce(async()=>{resource.href='https://PRIVATE.example/provider';init.method='DELETE';init.body=JSON.stringify({...args(),p_actor_id:f.actors[2].id});mutableHeaders.set('cookie','PRIVATE')})
    await h.transport.fetch(resource,init)
    expect(String(h.fetcher.mock.calls[0][0])).toBe(url);expect(h.fetcher.mock.calls[0][1]?.method).toBe('POST')
    expect(h.fetcher.mock.calls[0][1]?.body).toBe(rawBody);expect(new Headers(h.fetcher.mock.calls[0][1]?.headers).has('cookie')).toBe(false)
  })
})
describe('absolute budget and physical bounded response handling',()=>{
  it('does not renew context budget after a delayed helper call',async()=>{
    const h=harness();const start=Date.now();h.transport.readContext(c.label,start);vi.setSystemTime(start+5000)
    await expect(createContextualTest({supabase:h.client,actorId:c.actorId,input:c.input})).rejects.toMatchObject({statusCode:503})
    expect(h.fetcher).not.toHaveBeenCalled()
  })
  it('allows exact rooted deadline after delay and fallback seconds across Toronto midnight',async()=>{
    const h=harness();const start=Date.now();h.transport.readContext('omitted-title',start);vi.setSystemTime(start+200)
    const scenario=f.cases.find(c=>c.label==='omitted-title')!
    expect(await createContextualTest({supabase:h.client,actorId:scenario.actorId,input:scenario.input,deadline:start+20000})).toHaveProperty('test.title','Untitled 2026-10-06 00:00:00')
    expect(h.transport.getPendingWitness()?.title).toBe('Untitled 2026-10-06 00:00:00')
  })
  it('rejects arbitrary fallback or future context',async()=>{
    const h=harness();h.transport.readContext('omitted-title')
    await expect(h.transport.fetch(url,{method:'POST',headers:headers(),body:JSON.stringify({...args('omitted-title'),p_title:'Untitled 2026-10-05 00:00:00'})})).rejects.toThrow()
    expect(()=>h.transport.readContext(c.label,Date.now()+1)).toThrow();expect(h.fetcher).not.toHaveBeenCalled()
  })
  it('physically aborts stalled fetch at RPC deadline and removes caller listeners/timers',async()=>{
    const original=vi.fn<typeof fetch>((_url,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(Error('PRIVATE aborted')),{once:true})))
    const h=harness(original);const controller=new AbortController();const remove=vi.spyOn(controller.signal,'removeEventListener')
    const checked=expect(h.invoke(c.label,controller.signal)).rejects.toMatchObject({statusCode:503})
    await vi.advanceTimersByTimeAsync(20000);await checked
    expect(original.mock.calls[0][1]?.signal?.aborted).toBe(true);expect(remove).toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0)
    expect(h.transport.diagnostic()).not.toMatch(/PRIVATE|Bearer|synthetic|p_actor/)
  })
  it('cancels stalled response stream and does not wait for hostile cancel callback',async()=>{
    const cancel=vi.fn(()=>new Promise<void>(()=>{}));const stream=new ReadableStream<Uint8Array>({start(ctrl){ctrl.enqueue(new TextEncoder().encode('{'))},cancel})
    const h=harness(vi.fn<typeof fetch>(async()=>new Response(stream)))
    const checked=expect(h.invoke()).rejects.toMatchObject({statusCode:503});await vi.advanceTimersByTimeAsync(20000);await checked
    expect(cancel).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);expect(h.transport.getPendingWitness()).toBeUndefined()
  })
  it('caller abort during guard cannot later dispatch an orphan RPC',async()=>{
    let release:()=>void=()=>{};const h=harness();h.guard.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve}))
    const controller=new AbortController();const checked=expect(h.invoke(c.label,controller.signal)).rejects.toMatchObject({statusCode:503})
    await vi.advanceTimersByTimeAsync(0);controller.abort();await checked;release();await vi.advanceTimersByTimeAsync(0)
    expect(h.fetcher).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0)
  })
  it('cancels unread response body when a header rejects before reader acquisition',async()=>{
    const cancel=vi.fn();const h=harness(vi.fn<typeof fetch>(async()=>new Response(new ReadableStream<Uint8Array>({cancel}),{headers:{'content-length':'16385'}})))
    await expect(h.invoke()).rejects.toMatchObject({statusCode:503});expect(cancel).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0)
  })
  it('a late acknowledgment after timeout is canceled and cannot register a pair',async()=>{
    let release:(response:Response)=>void=()=>{};const h=harness(vi.fn<typeof fetch>(()=>new Promise<Response>(resolve=>{release=resolve})))
    const checked=expect(h.invoke()).rejects.toMatchObject({statusCode:503});await vi.advanceTimersByTimeAsync(20000);await checked
    const cancel=vi.fn();release(new Response(new ReadableStream<Uint8Array>({cancel})));await vi.advanceTimersByTimeAsync(0)
    expect(cancel).toHaveBeenCalledOnce();expect(h.transport.getPendingWitness()).toBeUndefined();expect(h.transport.getVerifiedLedger()).toHaveLength(0)
    expect(h.transport.counts.rpc).toBe(1);expect(vi.getTimerCount()).toBe(0)
  })
  it('response-bound guard expiry fails closed without a pending witness',async()=>{
    const h=harness();h.guard.mockImplementationOnce(async()=>{}).mockImplementationOnce(()=>new Promise<void>(()=>{}))
    const checked=expect(h.invoke()).rejects.toMatchObject({statusCode:503});await vi.advanceTimersByTimeAsync(20000);await checked
    expect(h.fetcher).toHaveBeenCalledOnce();expect(h.transport.getPendingWitness()).toBeUndefined();expect(vi.getTimerCount()).toBe(0)
  })
  it('caller abort cancels an active response reader and cleans listener/timer',async()=>{
    const cancel=vi.fn();const h=harness(vi.fn<typeof fetch>(async()=>new Response(new ReadableStream<Uint8Array>({cancel}))))
    const controller=new AbortController();const remove=vi.spyOn(controller.signal,'removeEventListener')
    const checked=expect(h.invoke(c.label,controller.signal)).rejects.toMatchObject({statusCode:503})
    await vi.advanceTimersByTimeAsync(0);controller.abort();await checked
    expect(cancel).toHaveBeenCalledOnce();expect(remove).toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0)
  })
  it('a finite read-count cap rejects an endless zero-byte stream without relying on timers',async()=>{
    let reads=0;const cancel=vi.fn();const h=harness(vi.fn<typeof fetch>(async()=>new Response(new ReadableStream<Uint8Array>({pull(controller){reads++;controller.enqueue(new Uint8Array())},cancel}))))
    await expect(h.invoke()).rejects.toMatchObject({statusCode:503});expect(reads).toBeLessThanOrEqual(16387)
    expect(cancel).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['request','oversize','utf8','json','redirect','location','duplicate'])('rejects bounded hostile response/request %s',async mode=>{
    const h=harness(vi.fn<typeof fetch>(async(_url,init)=>{
      if(mode==='oversize')return new Response('é'.repeat(8193))
      if(mode==='utf8')return new Response(new Uint8Array([0xff]))
      if(mode==='json')return new Response('{')
      if(mode==='redirect')return new Response('',{status:302})
      if(mode==='location')return new Response(JSON.stringify(envelope(JSON.parse(String(init?.body)))),{headers:{location:'http://PRIVATE'}})
      const json=JSON.stringify(envelope(JSON.parse(String(init?.body))))
      return new Response(mode==='duplicate'?json.replace('{','{"version":1,'):json)
    }))
    if(mode==='request'){h.transport.readContext(c.label);await expect(h.transport.fetch(url,{method:'POST',headers:headers(),body:'x'.repeat(16385)})).rejects.toThrow();expect(h.fetcher).not.toHaveBeenCalled()}
    else await expect(h.invoke()).rejects.toMatchObject({statusCode:503})
    expect(h.transport.getPendingWitness()).toBeUndefined();expect(h.transport.counts.storage).toBe(0)
  })
})
describe('raw private result observation without acceptance',()=>{
  it('internally verifies all eight successful pairs before accepting the next case, with no ledger setter',async()=>{
    let before=baseline();let stored:ReturnType<typeof envelope>|undefined
    const h=harness(vi.fn<typeof fetch>(async(_url,init)=>{
      const body=JSON.parse(String(init?.body));const row=envelope(body);const n=h.transport.counts.rpc
      const id=(i:number)=>`abcdefab-cdef-4abc-8def-${String(n*3+i).padStart(12,'0')}`
      row.test.id=row.test_id=id(0);row.test.artifact_id=id(1);row.draft.id=id(2);row.draft.assessment_id=row.test.id
      row.test.gradebook_category_id=before['public.gradebook_categories'].find(r=>r.classroom_id===body.p_classroom_id&&r.is_default)?.id as string
      const prior=before['public.tests'].filter(r=>r.classroom_id===body.p_classroom_id)
      row.test.position=prior.length?Math.max(...prior.map(r=>Number(r.position)))+1:0;stored=row
      return new Response(JSON.stringify(row))
    }))
    for(const scenario of f.cases.filter(c=>c.expectedHTTP===201)) {
      const result=await h.invoke(scenario.label);const pending=h.transport.getPendingWitness()!
      expect(pending.ledger.at(-1)?.state).toBe('provisional');expect(h.transport.getVerifiedLedger()).toHaveLength(h.transport.counts.rpc-1)
      const after=structuredClone(before);after['public.tests'].push(stored!.test);after['public.assessment_drafts'].push(stored!.draft)
      const cl=after['public.classrooms'].find(r=>r.id===scenario.classroomId)!
      cl.blueprint_source_revision=Number(cl.blueprint_source_revision)+2;cl.updated_at=stored!.test.created_at
      const archive=after['public.classroom_archive_revisions'].find(r=>r.classroom_id===scenario.classroomId)!
      archive.revision=Number(archive.revision)+4;archive.updated_at=stored!.test.created_at
      h.transport.verifyEffects(before,after,result)
      expect(h.transport.getVerifiedLedger().at(-1)?.state).toBe('verified');before=after
    }
    expect(h.transport.getVerifiedLedger().flatMap(w=>w.ids)).toHaveLength(24);expect(h.transport.counts.rpc).toBe(8)
    expect(h.transport).not.toHaveProperty('installVerifiedLedger');expect(h.transport.counts.storage).toBe(0)
  })
  it('invalid root snapshots/public result never promote a pending pair and fail the whole run',async()=>{
    const h=harness();const result=await h.invoke();const pending=h.transport.getPendingWitness()!
    expect(()=>h.transport.verifyEffects(baseline(),baseline(),result)).toThrow('private details withheld')
    expect(pending.ledger.at(-1)?.state).toBe('provisional');expect(h.transport.getVerifiedLedger()).toHaveLength(0)
    expect(()=>h.transport.readContext('teacher-owner-custom')).toThrow();expect(h.transport.getPendingWitness()).toBeUndefined()
    expect(h.fetcher).toHaveBeenCalledOnce()
  })
  it('a duplicate raw pair across named contexts fails without changing verified history',async()=>{
    const before=baseline();let row:ReturnType<typeof envelope>|undefined
    const h=harness(vi.fn<typeof fetch>(async(_url,init)=>{
      row=envelope(JSON.parse(String(init?.body)));row.test.gradebook_category_id=before['public.gradebook_categories'].find(r=>r.classroom_id===row!.classroom_id&&r.is_default)?.id as string
      return new Response(JSON.stringify(row))
    }))
    const result=await h.invoke();const after=structuredClone(before)
    after['public.tests'].push(row!.test);after['public.assessment_drafts'].push(row!.draft)
    after['public.classrooms'][0].blueprint_source_revision=11;after['public.classrooms'][0].updated_at=row!.test.created_at
    after['public.classroom_archive_revisions'][0].revision=19;after['public.classroom_archive_revisions'][0].updated_at=row!.test.created_at
    h.transport.verifyEffects(before,after,result)
    await expect(h.invoke('teacher-owner-custom')).rejects.toMatchObject({statusCode:503})
    expect(h.transport.getVerifiedLedger()).toHaveLength(1);expect(h.transport.getPendingWitness()).toBeUndefined();expect(h.transport.counts.rpc).toBe(2)
  })
  it('denial/probe effects use internal accepted ledger and require full snapshot equality',async()=>{
    for(const label of ['student-member-denied','raw-privilege-probe']) {
      const code=label==='raw-privilege-probe'?'42501':'PT403';const h=harness(vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({code,message:'PRIVATE'}),{status:403})))
      await expect(h.invoke(label)).rejects.toMatchObject({statusCode:label==='raw-privilege-probe'?503:403})
      const before=baseline();expect(()=>h.transport.verifyEffects(before,structuredClone(before))).not.toThrow()
      expect(h.transport.getVerifiedLedger()).toHaveLength(0)
      expect(()=>h.transport.readContext('teacher-owner-custom')).not.toThrow()
    }
  })
  it('wrong error outcome cannot count as a verified denial or privilege probe',async()=>{
    for(const [label,code] of [['student-member-denied','PT404'],['raw-privilege-probe','PT503']]) {
      const h=harness(vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({code,message:'PRIVATE wrong outcome'}),{status:500})))
      await expect(h.invoke(label)).rejects.toMatchObject({statusCode:503})
      expect(()=>h.transport.verifyEffects(baseline(),baseline())).toThrow()
      expect(h.transport.getVerifiedLedger()).toHaveLength(0);expect(h.transport.evidence.rawPrivilegeFailures).toBe(0)
    }
  })
  it.each(['actor_id','classroom_id','test_id'])('rejects witness crossbinding %s',async field=>{
    const h=harness(vi.fn<typeof fetch>(async(_url,init)=>new Response(JSON.stringify({...envelope(JSON.parse(String(init?.body))),[field]:f.actors[2].id}))))
    await expect(h.invoke()).rejects.toMatchObject({statusCode:503});expect(h.transport.getPendingWitness()).toBeUndefined()
  })
  it('counts only bounded valid allowlisted raw42501, not substring/private text',async()=>{
    for(const value of [{code:'42501',message:'PRIVATE grant',details:null,hint:null},{code:'PRIVATE42501',message:'42501'}, {code:'42501',message:7}, {code:'42501',message:'x',unknown:true}]){
      const h=harness(vi.fn<typeof fetch>(async()=>new Response(JSON.stringify(value),{status:403})))
      await expect(h.invoke('raw-privilege-probe')).rejects.toMatchObject({statusCode:503})
      expect(h.transport.evidence.rawPrivilegeFailures).toBe(typeof value.message==='string' && value.code==='42501' && !('unknown'in value)?1:0)
      expect(h.transport.getPendingWitness()).toBeUndefined();expect(h.transport.diagnostic()).not.toContain('PRIVATE')
    }
  })
  it('never returns mutable credentials/counters or exposes raw rows in diagnostics',async()=>{
    const h=harness();await h.invoke();expect(Object.isFrozen(h.transport.counts)).toBe(true)
    const pending=h.transport.getPendingWitness()!;expect(Object.isFrozen(pending.ledger[0].envelope.test)).toBe(true)
    expect(h.transport.diagnostic()).not.toContain(key);expect(h.transport.diagnostic()).not.toContain(c.actorId)
  })
})
