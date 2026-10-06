import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { discardContextualPristineTestDraft } from '@/lib/server/contextual-test-pristine-discard'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerPristineDiscardFixture, TEST_OWNER_PRISTINE_DISCARD_SNAPSHOT_TABLES } from '../../scripts/contextual-test-pristine-discard-proof-fixture'
import { createTestOwnerPristineDiscardProofTransport, testOwnerPristineDiscardRequestManifest } from '../../scripts/contextual-test-pristine-discard-proof-transport'
const f=newTestOwnerPristineDiscardFixture(newAssignmentListProofFixture(new Date('2026-10-06T03:00:00Z')))
const project=`pika_assignment_list_${f.tag.slice(-12)}`
const key=`e30.${Buffer.from(JSON.stringify({iss:'supabase-demo',role:'service_role'})).toString('base64url')}.synthetic`
const target={API_URL:'http://127.0.0.1:54331',DB_URL:'postgresql://postgres:synthetic@127.0.0.1:54332/postgres',SERVICE_ROLE_KEY:key}
const url=target.API_URL+'/rest/v1/rpc/discard_pristine_test_draft_for_owner_v1'
const headers=()=>({authorization:`Bearer ${key}`,apikey:key,'content-type':'application/json','x-client-info':'supabase-js-node/2.93.3','content-profile':'public'})
const scenarios=[...f.cases,...f.privilegeProbes];const first=f.cases[0]
function args(label=first.label){const c=scenarios.find(c=>c.label===label)!;return {p_actor_id:c.actorId,p_test_id:c.testId,
  p_expected_draft_version:c.input.expected_draft_version,p_expected_test_updated_at:c.input.expected_test_updated_at,p_deadline:new Date(Date.now()+20000).toISOString()}}
function envelope(label=first.label){const c=scenarios.find(c=>c.label===label)!;const test=f.tests.find(t=>t.id===c.testId)!
  return {version:1,actor_id:c.actorId,test_id:c.testId,classroom:{id:test.classroom_id,teacher_id:c.actorId,archived_at:null},test,
    draft:f.drafts.find(d=>d.assessment_id===c.testId)??null,discarded:c.expectedDiscarded,...(c.expectedDiscarded===false?{reason:'draft_changed'}:{})}}
function harness(fetcher=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify(envelope())))){
  const guard=vi.fn(async()=>{});const transport=createTestOwnerPristineDiscardProofTransport(f,target,project,fetcher,guard)
  const client=createClient<Database>(target.API_URL,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:transport.fetch}})
  return {fetcher,guard,transport,client,invoke(label=first.label,signal?:AbortSignal){const c=scenarios.find(c=>c.label===label)!;const start=Date.now();transport.readContext(label,start)
    return discardContextualPristineTestDraft({supabase:client,actorId:c.actorId,testId:c.testId,input:c.input,deadline:start+20000,signal})}}
}
type Row=Record<string,unknown>
function sourceSnapshot(){
  const s:Record<string,Row[]>=Object.fromEntries(TEST_OWNER_PRISTINE_DISCARD_SNAPSHOT_TABLES.map(t=>[t,[]]))
  s['public.users']=f.actors.map(a=>({...a,extra:'preserved'}));s['public.classroom_enrollments']=f.enrollments.map(e=>({...e,created_at:f.now}))
  s['public.classrooms']=f.classes.map(c=>({id:c.id,teacher_id:c.owner,title:c.title,class_code:c.code,archived_at:c.archived?f.now:null,blueprint_source_revision:7,updated_at:f.now,extra:'preserved'}))
  s['public.classroom_archive_revisions']=f.classes.map(c=>({classroom_id:c.id,revision:13,updated_at:f.now,extra:'preserved'}))
  s['public.gradebook_categories']=f.classes.flatMap((c,ci)=>[0,1,2].map(i=>({id:`99999999-9999-4999-8999-${String(ci*3+i).padStart(12,'0')}`,classroom_id:c.id,is_default:i===0,position:i,default_assessment_weight:10})))
  s['public.tests']=f.tests.map(t=>({...t,gradebook_category_id:s['public.gradebook_categories'].find(c=>c.classroom_id===t.classroom_id)!.id}))
  s['public.assessment_drafts']=structuredClone(f.drafts);s['public.test_student_availability']=structuredClone(f.availability);s['public.gradebook_score_overrides']=structuredClone(f.overrides)
  s.__nontarget_fingerprints=[...TEST_OWNER_PRISTINE_DISCARD_SNAPSHOT_TABLES,'storage.objects','storage.buckets'].map(table=>({table,fingerprint:'unchanged'}));return s
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime('2026-10-06T04:00:00Z')})
afterEach(()=>vi.useRealTimers())
describe('sealed installed SDK pristine discard transport',()=>{
  it('seals finite manifest fields and two different privilege contexts',()=>{
    const m=testOwnerPristineDiscardRequestManifest(f);expect(m.keys).toEqual(['p_actor_id','p_test_id','p_expected_draft_version','p_expected_test_updated_at','p_deadline'])
    expect(m.cases).toHaveLength(18);expect(m.privilegeProbes).toHaveLength(2);expect(m.caps.storageRequests).toBe(0);expect(m.caps.totalBytes).toBe(67108864)
    expect(Object.isFrozen(m.privilegeProbes[0])).toBe(true)
  })
  it.each(scenarios.map(c=>[c.label,c]))('installed SDK offline named case %s',async(_label,c)=>{
    const fetcher=vi.fn<typeof fetch>(async()=>c.expectedHTTP===200?new Response(JSON.stringify(envelope(c.label))):
      new Response(JSON.stringify({code:c.expectedHTTP===503?'42501':c.expectedHTTP===404?'PT404':'PT403',message:'PRIVATE diagnostics',details:null,hint:null}),{status:c.expectedHTTP===503?403:c.expectedHTTP}))
    const h=harness(fetcher)
    if(c.expectedHTTP===200){expect(await h.invoke(c.label)).toEqual(c.expectedDiscarded?{discarded:true}:{discarded:false,test:envelope(c.label).test})
      expect(h.transport.getPendingWitness()!.ledger.at(-1)!.state).toBe('provisional');expect(h.transport.getPendingWitness()).toBeUndefined()
    }else{await expect(h.invoke(c.label)).rejects.toMatchObject({statusCode:c.expectedHTTP});expect(h.transport.getPendingWitness()).toBeUndefined()}
    expect(fetcher).toHaveBeenCalledOnce();expect(h.guard).toHaveBeenCalledTimes(2);expect(h.transport.counts).toMatchObject({network:1,rpc:1,storage:0})
    expect(h.transport).not.toHaveProperty('installVerifiedLedger');expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['https://example.invalid/x',target.API_URL+'/rest/v1/tests',target.API_URL+'/storage/v1/object/x',url+'?x=1',url+'#x'])('rejects unsealed path %s',async path=>{
    const h=harness();h.transport.readContext(first.label);await expect(h.transport.fetch(path,{method:'POST',headers:headers(),body:JSON.stringify(args())})).rejects.toThrow();expect(h.fetcher).not.toHaveBeenCalled()
  })
  it.each(['cookie','prefer','range','x-forwarded-host','x-arbitrary'])('rejects extra header %s',async field=>{
    const h=harness();h.transport.readContext(first.label);await expect(h.transport.fetch(url,{method:'POST',headers:{...headers(),[field]:'PRIVATE'},body:JSON.stringify(args())})).rejects.toThrow();expect(h.fetcher).not.toHaveBeenCalled()
  })
  it.each(['p_actor_id','p_test_id','p_expected_draft_version','p_expected_test_updated_at','p_deadline'])('rejects binding drift %s',async field=>{
    const h=harness();h.transport.readContext(first.label);await expect(h.transport.fetch(url,{method:'POST',headers:headers(),body:JSON.stringify({...args(),[field]:'forged'})})).rejects.toThrow();expect(h.fetcher).not.toHaveBeenCalled()
  })
  it('rejects duplicate/unknown keys before dispatch and duplicate nested response keys',async()=>{
    for(const body of [JSON.stringify({...args(),extra:true}),JSON.stringify(args()).replace('{','{"p_actor_id":"forged",')]){
      const h=harness();h.transport.readContext(first.label);await expect(h.transport.fetch(url,{method:'POST',headers:headers(),body})).rejects.toThrow();expect(h.fetcher).not.toHaveBeenCalled()
    }
    const h=harness(vi.fn(async()=>new Response(JSON.stringify(envelope()).replace('"classroom":{','"classroom":{"id":"forged",'))))
    await expect(h.invoke()).rejects.toMatchObject({statusCode:503})
  })
  it('rejects different raw failures without recognizing the named privilege probe',async()=>{
    const h=harness(vi.fn(async()=>new Response(JSON.stringify({code:'55000',message:'PRIVATE'}),{status:500})))
    await expect(h.invoke(f.privilegeProbes[1].label)).rejects.toMatchObject({statusCode:503});expect(h.transport.evidence.rawPrivilegeFailures).toBe(0)
    expect(()=>h.transport.readContext(first.label)).toThrow()
  })
  it('does not dispatch guard-mutated URL/body/headers',async()=>{
    const h=harness();h.transport.readContext(first.label);const resource=new URL(url);const hs=new Headers(headers());const body=JSON.stringify(args());const init:RequestInit={method:'POST',headers:hs,body}
    h.guard.mockImplementationOnce(async()=>{resource.href='https://PRIVATE.example/x';init.body='forged';hs.set('cookie','PRIVATE')})
    await h.transport.fetch(resource,init);expect(h.fetcher.mock.calls[0][0]).toBe(url);expect(h.fetcher.mock.calls[0][1]?.body).toBe(body);expect(new Headers(h.fetcher.mock.calls[0][1]?.headers).has('cookie')).toBe(false)
  })
  it('physically aborts an ignored hung fetch under the rooted deadline',async()=>{
    let signal:AbortSignal|undefined;const h=harness(vi.fn((_url,init)=>{signal=init?.signal??undefined;return new Promise<Response>(()=>{})}))
    const p=expect(h.invoke()).rejects.toMatchObject({statusCode:503});await vi.advanceTimersByTimeAsync(20000);await p
    expect(signal?.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0);expect(h.fetcher).toHaveBeenCalledOnce()
  })
  it('cancels stalled reading and caller abort without renewing or retrying',async()=>{
    const cancel=vi.fn();const h=harness(vi.fn(async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{})},cancel}))))
    const controller=new AbortController();const p=expect(h.invoke(first.label,controller.signal)).rejects.toMatchObject({statusCode:503})
    await vi.advanceTimersByTimeAsync(1);controller.abort();await p;expect(cancel).toHaveBeenCalledOnce();expect(h.fetcher).toHaveBeenCalledOnce()
  })
  it('requires effect verification before any next operation and does not expose private diagnostics',async()=>{
    const h=harness();await h.invoke();expect(()=>h.transport.readContext(f.cases[1].label)).toThrow()
    expect(h.transport.diagnostic()).not.toContain(first.testId);expect(h.transport.diagnostic()).not.toContain(key)
  })
  describe.sequential('all20 chained helper contexts retain full effects and one cumulative ledger',()=>{
    let current=sourceSnapshot();let expected=first
    const h=harness(vi.fn(async()=>{
      if(expected.expectedHTTP!==200)return new Response(JSON.stringify({code:expected.expectedHTTP===503?'42501':expected.expectedHTTP===404?'PT404':'PT403',message:'PRIVATE'}),{status:expected.expectedHTTP===503?403:expected.expectedHTTP})
      const test=current['public.tests'].find(t=>t.id===expected.testId)!;const draft=current['public.assessment_drafts'].find(d=>d.assessment_id===expected.testId)??null
      return new Response(JSON.stringify({version:1,actor_id:expected.actorId,test_id:expected.testId,classroom:{id:test.classroom_id,teacher_id:expected.actorId,archived_at:null},
        test,draft,discarded:expected.expectedDiscarded,...(expected.expectedDiscarded===false?{reason:'draft_changed'}:{})}))
    }))
    const order=[...f.cases.filter(c=>c.label!=='restored-privilege-success'),...f.privilegeProbes,f.cases.at(-1)!]
    it.each(order.map(c=>[c.label,c]as const))('accepts complete effects for chained case %s',async(_label,c)=>{
      expected=c;const before=structuredClone(current);let result:unknown
      if(c.expectedHTTP===200)result=await h.invoke(c.label);else await expect(h.invoke(c.label)).rejects.toMatchObject({statusCode:c.expectedHTTP})
      if(c.expectedDiscarded===true){const test=current['public.tests'].find(t=>t.id===c.testId)!;current['public.tests']=current['public.tests'].filter(t=>t.id!==c.testId)
        current['public.assessment_drafts']=current['public.assessment_drafts'].filter(d=>d.assessment_id!==c.testId)
        const classroom=current['public.classrooms'].find(r=>r.id===test.classroom_id)!;const archive=current['public.classroom_archive_revisions'].find(r=>r.classroom_id===test.classroom_id)!
        classroom.blueprint_source_revision=Number(classroom.blueprint_source_revision)+2;archive.revision=Number(archive.revision)+4
        classroom.updated_at=archive.updated_at=new Date().toISOString()
      }
      h.transport.verifyEffects(before,current,result)
    })
    it('accepts the full20-context receipt only after six removals and both distinct raw42501 probes',()=>{
    expect(h.transport.getVerifiedLedger()).toHaveLength(12);expect(h.transport.getVerifiedLedger().every(w=>w.state==='verified')).toBe(true)
    expect(current['public.tests']).toHaveLength(995);expect(h.transport.counts.network).toBe(20);expect(h.transport.counts.rpc).toBe(20)
    expect(h.transport.counts.totalBytes).toBeLessThanOrEqual(67108864);expect(h.transport.evidence.rawPrivilegeFailures).toBe(2)
    expect(h.transport.evidence.rawPrivilegeContexts).toEqual(['inner-156-capability','outer-rpc-acl']);expect(h.transport.counts.storage).toBe(0)
    })
  })
  it.each(['content-profile','authorization','apikey','x-client-info','content-type'])('requires exact installed SDK header %s',async field=>{
    const h=harness();h.transport.readContext(first.label);const hs=new Headers(headers());hs.delete(field)
    await expect(h.transport.fetch(url,{method:'POST',headers:hs,body:JSON.stringify(args())})).rejects.toThrow();expect(h.fetcher).not.toHaveBeenCalled()
  })
  it.each(['GET','DELETE','PATCH'])('rejects non-RPC verb %s',async method=>{
    const h=harness();h.transport.readContext(first.label);await expect(h.transport.fetch(url,{method,headers:headers(),body:JSON.stringify(args())})).rejects.toThrow();expect(h.fetcher).not.toHaveBeenCalled()
  })
  it('rejects invalid target, credentials and project without dispatch',()=>{
    const fetcher=vi.fn<typeof fetch>()
    for(const bad of [{...target,API_URL:'http://127.0.0.1:54321'},{...target,DB_URL:'postgresql://postgres:x@localhost:54332/postgres'},{...target,SERVICE_ROLE_KEY:'invalid'}])
      expect(()=>createTestOwnerPristineDiscardProofTransport(f,bad,project,fetcher,async()=>{})).toThrow()
    expect(()=>createTestOwnerPristineDiscardProofTransport(f,target,'production',fetcher,async()=>{})).toThrow();expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['oversize','invalid-utf8','redirect','content-length','unknown-error'])('rejects closed result boundary %s',async mode=>{
    const h=harness(vi.fn(async()=>mode==='invalid-utf8'?new Response(new Uint8Array([255])):
      mode==='redirect'?new Response('{}',{status:302,headers:{location:'https://example.invalid'}}):
      mode==='content-length'?new Response('{}',{headers:{'content-length':'16385'}}):
      mode==='unknown-error'?new Response(JSON.stringify({code:'XXUNKNOWN',message:'PRIVATE'}),{status:500}):new Response('x'.repeat(16385))))
    await expect(h.invoke()).rejects.toMatchObject({statusCode:503});expect(h.transport.getPendingWitness()).toBeUndefined();expect(h.fetcher).toHaveBeenCalledOnce()
  })
  it('never renews request budget after delayed helper invocation',async()=>{
    const h=harness();const start=Date.now();h.transport.readContext(first.label,start);vi.setSystemTime(start+5000)
    await expect(discardContextualPristineTestDraft({supabase:h.client,actorId:first.actorId,testId:first.testId,input:first.input})).rejects.toMatchObject({statusCode:503})
    expect(h.fetcher).not.toHaveBeenCalled()
  })
})
