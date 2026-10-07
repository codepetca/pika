import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerReorderFixture } from '../../scripts/contextual-test-reorder-proof-fixture'
import { runTestOwnerReorderCommittedTransitions, testOwnerReorderCommittedManifest, validateTestOwnerReorderCommittedSql } from '../../scripts/check-contextual-test-reorder-committed'
import type { DraftSaveDriver, DraftSaveTarget } from '../../scripts/check-contextual-test-draft-save-db-contracts'
import * as ownerFixture from '../../scripts/contextual-test-owner-detail-proof-fixture'

const fixture=newTestOwnerReorderFixture(newAssignmentListProofFixture(new Date('2026-10-07T04:00:00Z')))
const manifest=testOwnerReorderCommittedManifest(fixture)
const hash=(v:string)=>createHash('sha256').update(v).digest('hex')
const target:DraftSaveTarget=Object.freeze({projectId:manifest.projectId,containerProjectLabel:manifest.projectId,disposable:true,
  apiUrl:'http://127.0.0.1:54331',databaseHost:'127.0.0.1',databasePort:54332,containerId:'a'.repeat(64),reviewedHead:'b'.repeat(40),
  migrationManifestSha256:'c'.repeat(64),reviewedSourceSha256:manifest.sourceSha256,acceptedManifestSha256:hash(JSON.stringify(manifest))})
function mockDriver(mutate?:(receipt:Record<string,unknown>,index:number)=>void) {
  const close=[vi.fn(async()=>{}),vi.fn(async()=>{})],calls:{sql:string;timeout:number}[]=[]
  let opened=0,index=0,prior=hash('initial')
  const caches=new Map<string,string>(),ids=new Map<string,string[]>()
  const driver:DraftSaveDriver={verifyTarget:vi.fn(async()=>target),openSession:vi.fn(async name=>{
    const session=opened++
    return {name,rollbackAndClose:close[session],execute:vi.fn(async(sql,timeout)=>{
      const step=manifest.steps[index];expect(sql).toBe(step.sql);calls.push({sql,timeout})
      const key=`${step.label.split(':')[0]}:${step.side}`
      const memberIds=fixture.tests.filter(t=>t.classroom_id===step.classroomId).map(t=>t.id).sort()
      if(step.side==='contender')memberIds.reverse()
      const requestIds=step.chain==='cached'?ids.get(key)!:step.outcome==='cached'?memberIds:[]
      const r:Record<string,unknown>={label:step.label,outcome:step.outcome,before_sha256:prior,
        after_sha256:step.chain==='same'||step.outcome.startsWith('PT')?prior:hash(String(index)),cached_sha256:step.chain==='cached'?caches.get(key)!:null,
        actor_id:step.actorId,classroom_id:step.classroomId,test_ids:requestIds,count:requestIds.length,full_graph_verified:true}
      if(step.outcome==='cached'){caches.set(key,prior);ids.set(key,memberIds)}
      prior=String(r.after_sha256);mutate?.(r,index);index++;return [{result:r}]
    })}
  })}
  return {driver,close,calls}
}

describe('inert fixed committed owner Test reorder contracts',()=>{
  it('creates the deletion source with a namespaced title accepted by both genuine156 pristine predicates',()=>{
    const source=readFileSync('supabase/migrations/156_harden_pristine_test_draft_discard.sql','utf8')
    const testPattern=/btrim\(v_test\.title\) !~\s*'([^']+)'/.exec(source)?.[1]
    const draftPattern=/btrim\(coalesce\(v_draft\.content->>'title', ''\)\) !~\s*'([^']+)'/.exec(source)?.[1]
    expect(testPattern).toBeDefined();expect(draftPattern).toBeDefined();expect(testPattern).toBe(draftPattern)
    const create=manifest.steps.find(s=>s.label==='create-freshness:writer')!
    const discard=manifest.steps.find(s=>s.label==='delete-freshness:writer')!
    const title=/expected_graph:=pg_temp\.reorder_committed_create\(before_graph,[^\n]*,'([^']+)'\);/.exec(create.sql)?.[1]
    expect(title).toBeDefined()
    for(const pattern of [testPattern!,draftPattern!]){
      // This regression checks the actual SQL patterns against ASCII source
      // titles. Only POSIX whitespace syntax is translated for the JS engine;
      // it is not a claim that native PostgreSQL execution has been verified.
      const predicate=new RegExp(pattern.replaceAll('[[:space:]]','\\s'))
      expect(predicate.test(title!)).toBe(true)
      expect(predicate.test(`${fixture.tag} committed create`)).toBe(false)
    }
    expect(title).toBe(`Untitled (${fixture.now.slice(0,10)} ${fixture.tag} committed create)`)
    expect(discard.sql).toContain(`and title='${title}'`)
    expect(create.sql).toContain("'content',jsonb_build_object('title',title,'show_results',false")
    expect(discard.sql).toContain("'discarded',true")
  })
  it('guards the exact phase side in one writable transaction and preserves every inherited safety predicate',()=>{
    const prefix="begin read only;set local lock_timeout='3s';set local statement_timeout='30s';"
    const terminal="end;$guard$;select 'ok';rollback;"
    const original=ownerFixture.testOwnerGuardSql(manifest.projectId)
    expect(original.startsWith(prefix)&&original.endsWith(terminal)).toBe(true)
    const identity=`current_setting('application_name')<>'${manifest.projectId}_fixture'`
    expect(original.split(identity)).toHaveLength(2)
    for(const step of manifest.steps){
      const own=`current_setting('application_name')<>'${manifest.projectId}_draft_${step.side}'`
      const inherited=original.slice(prefix.length,-terminal.length).replace(identity,own)
      expect(step.sql.startsWith("begin;set local lock_timeout='1s';set local statement_timeout='12s';set local idle_in_transaction_session_timeout='30s';")).toBe(true)
      expect(step.sql).toContain(inherited)
      expect(step.sql).toContain("current_database()<>'postgres' or current_user<>'postgres'")
      expect(step.sql).toContain("to_regprocedure('public.reorder_tests_for_owner_v1(uuid,uuid,uuid[],timestamptz)') is null")
      expect(step.sql).not.toContain("select 'ok'")
      expect(step.sql).not.toContain('rollback;')
      expect(step.sql).not.toContain(`${manifest.projectId}_fixture`)
      expect(step.sql).not.toContain(`${manifest.projectId}_draft_${step.side==='holder'?'contender':'holder'}`)
      expect(step.sql.match(/(?:^|;)begin;/g)).toHaveLength(1)
      expect(step.sql.match(/select result from reorder_committed_result;/g)).toHaveLength(1)
      for(const wrong of ['fixture',step.side==='holder'?'draft_contender':'draft_holder','draft_contracts'])
        expect(validateTestOwnerReorderCommittedSql(manifest,step.sql.replace(`_draft_${step.side}'`,`_${wrong}'`))).toBe(false)
    }
  })
  it('fails closed if the inherited guard wrappers or sole setup identity change',()=>{
    const original=ownerFixture.testOwnerGuardSql(manifest.projectId)
    const identity=`current_setting('application_name')<>'${manifest.projectId}_fixture'`
    for(const altered of [original.replace('begin read only;','begin;'),original.replace("lock_timeout='3s'","lock_timeout='2s'"),
      original.replace("statement_timeout='30s'","statement_timeout='12s'"),original.replace("select 'ok';rollback;",'rollback;'),
      original.replace(identity,'true'),original.replace(identity,`${identity} or ${identity}`)]){
      const spy=vi.spyOn(ownerFixture,'testOwnerGuardSql').mockReturnValue(altered)
      try{expect(()=>testOwnerReorderCommittedManifest(fixture)).toThrow()}finally{spy.mockRestore()}
    }
  })
  it('has seven sealed ordered schedules and exactly31 admitted dispatches',()=>{
    expect(manifest.schedules).toEqual(['create-freshness','delete-freshness','reparent-freshness','archive-freshness','last-writer','owner-freshness','legacy-max'])
    expect(manifest.steps).toHaveLength(31);expect(Object.isFrozen(manifest.steps)).toBe(true)
    for(const step of manifest.steps){expect(validateTestOwnerReorderCommittedSql(manifest,step.sql)).toBe(true)
      expect(validateTestOwnerReorderCommittedSql(manifest,step.sql+' select 1;')).toBe(false)
      expect(Buffer.byteLength(step.sql)).toBeLessThanOrEqual(262144)
      expect(step.sql).toContain('before_graph:=pg_temp.reorder_committed_graph()')
      expect(step.sql).toContain('after_graph is distinct from expected_graph')
      expect(step.sql).toContain('select result from reorder_committed_result;commit;')}
    expect(validateTestOwnerReorderCommittedSql({...manifest},manifest.steps[0].sql)).toBe(false)
    expect(validateTestOwnerReorderCommittedSql(manifest,'rollback;')).toBe(false)
    expect(validateTestOwnerReorderCommittedSql(manifest,'x'.repeat(262145))).toBe(false)
  })
  it('captures every complete table row internally, including controls, with no caller catalog or reduced bulk graph',()=>{
    const sql=manifest.steps[0].sql
    expect(sql).toContain("n.nspname in ('public','private','storage')")
    expect(sql).toContain("c.relkind in ('r','p')")
    expect(sql).toContain('jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)')
    expect(sql).toContain("jsonb_build_object('__catalog',catalog)")
    expect(sql).not.toContain("to_jsonb(r)-'position'")
    expect(sql).not.toContain('__bulk_tests')
    expect(sql).not.toMatch(/setval|disable trigger|set_config|pika\.classroom_archive_restore|update (public|private)\..*settings/i)
    expect(sql).toContain('public.create_test_for_owner_v1(')
    expect(sql).toContain('Reorder request-bound witness differs')
    expect(sql).toContain('transaction_timestamp()')
    expect(manifest.caps).toMatchObject({responseBytes:8192,totalBytes:67108864,requestMs:12000,totalMs:900000,sessions:2})
  })
  it('attests seed/create/discard/reparent separately and retains legacy residual without compensation',()=>{
    const step=(label:string)=>manifest.steps.find(s=>s.label===label)!.sql
    expect(step('create-freshness:writer')).toContain('pg_temp.reorder_committed_create(before_graph')
    expect(step('delete-freshness:writer')).toContain('public.discard_pristine_test_draft_for_owner_v1(')
    expect(step('delete-freshness:writer')).toContain("'discarded',true")
    expect(step('reparent-freshness:seed')).toContain('Seed collision')
    expect(step('reparent-freshness:writer')).toContain('gradebook_category_id=null')
    expect(step('reparent-freshness:writer')).toContain('0,1)')
    expect(step('archive-freshness:stale-reorder')).toContain("code is distinct from 'PT403'")
    expect(step('owner-freshness:stale-reorder')).toContain("code is distinct from 'PT403'")
    expect(step('create-freshness:stale-reorder')).toContain("code is distinct from 'PT409'")
    expect(step('last-writer:apply-b')).toContain("where c.label='last-writer'")
    expect(step('legacy-max:late-insert')).toContain('Cached MAX residual not representative')
    expect(step('legacy-max:post-commit')).toContain('Legacy duplicate disappeared')
    expect(manifest.steps.at(-1)!.label).toBe('legacy-max:post-commit')
    expect(manifest.limitations.join(' ')).toContain('nontransactional')
  })
  it('rejects non-source fixtures during construction',()=>{
    expect(()=>testOwnerReorderCommittedManifest({...fixture})).toThrow()
    expect(()=>testOwnerReorderCommittedManifest(Object.freeze({...fixture,actors:[]}))).toThrow()
    expect(()=>testOwnerReorderCommittedManifest(Object.freeze({...fixture,tests:[]}))).toThrow()
  })
  it('returns only bounded source-bound compact evidence after31mocked steps, not native acceptance',async()=>{
    const {driver,close,calls}=mockDriver()
    const result=await runTestOwnerReorderCommittedTransitions(manifest,target,driver,Date.now()+60000)
    expect(result).toMatchObject({kind:'committed-test-owner-reorder-transitions',projectId:manifest.projectId,schedules:manifest.schedules,
      dispatches:31,remainingSessions:0,complete:true,manifestSha256:target.acceptedManifestSha256})
    expect(result.receipts).toHaveLength(31);expect(result.bytes).toBeLessThan(31*8192)
    expect(Object.isFrozen(result.receipts)).toBe(true);expect(calls.every(c=>c.timeout>0&&c.timeout<=12000)).toBe(true)
    expect(close[0]).toHaveBeenCalledOnce();expect(close[1]).toHaveBeenCalledOnce()
    expect(driver.openSession).toHaveBeenNthCalledWith(1,`${manifest.projectId}_draft_holder`)
    expect(driver.openSession).toHaveBeenNthCalledWith(2,`${manifest.projectId}_draft_contender`)
  })
  it.each(['label','outcome','actor_id','classroom_id','full_graph_verified','before_sha256','count'])('rejects tampered%s and closes both sessions',async key=>{
    const {driver,close}=mockDriver(r=>{r[key]=key==='count'?999:'tampered'})
    await expect(runTestOwnerReorderCommittedTransitions(manifest,target,driver,Date.now()+60000)).rejects.toThrow()
    close.forEach(fn=>expect(fn).toHaveBeenCalledOnce())
  })
  it('rejects changed cached IDs, a broken cross-session chain, an oversized receipt and extra fields',async()=>{
    for(const change of [(r:Record<string,unknown>,i:number)=>{if(i===2)r.before_sha256='f'.repeat(64)},
      (r:Record<string,unknown>,i:number)=>{if(i===19){r.test_ids=[];r.count=0}},
      (r:Record<string,unknown>)=>{r.extra='unexpected'},(r:Record<string,unknown>)=>{r.extra='x'.repeat(8192)}]){
      const {driver,close}=mockDriver(change)
      await expect(runTestOwnerReorderCommittedTransitions(manifest,target,driver,Date.now()+60000)).rejects.toThrow()
      close.forEach(fn=>expect(fn).toHaveBeenCalledOnce())
    }
  })
  it('fails before opening on target/manifest/deadline drift and never renews an elapsed deadline',async()=>{
    for(const [t,deadline] of [[Object.freeze({...target,databasePort:54322}),Date.now()+60000],[target,Date.now()-1],
      [target,Date.now()+1000000],[Object.freeze({...target,acceptedManifestSha256:'d'.repeat(64)}),Date.now()+60000]] as const){
      const {driver}=mockDriver();await expect(runTestOwnerReorderCommittedTransitions(manifest,t,driver,deadline)).rejects.toThrow();expect(driver.openSession).not.toHaveBeenCalled()
    }
    const {driver}=mockDriver();await expect(runTestOwnerReorderCommittedTransitions({...manifest},target,driver,Date.now()+60000)).rejects.toThrow()
  })
  it('closes a partially opened pair and preserves primary plus cleanup failures without restoration',async()=>{
    const {driver,close}=mockDriver()
    vi.mocked(driver.openSession).mockRejectedValueOnce(new Error('opening failed'))
    await expect(runTestOwnerReorderCommittedTransitions(manifest,target,driver,Date.now()+60000)).rejects.toThrow('opening failed')
    close.forEach(fn=>expect(fn).not.toHaveBeenCalled())
    const failure=mockDriver(()=>{throw new Error('primary')});failure.close[1].mockRejectedValue(new Error('cleanup'))
    await expect(runTestOwnerReorderCommittedTransitions(manifest,target,failure.driver,Date.now()+60000)).rejects.toThrow('dispose target without compensation')
  })
})
