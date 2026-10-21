/** CPU-only descriptor/receipt contracts; no database or native evidence. */
import {describe,expect,it} from 'vitest'
import {newClassroomListReorderFixture,classroomListReorderHash as hash} from '../../scripts/contextual-classroom-list-reorder-native-fixture'
import {CLASSROOM_LIST_REORDER_LOCK_CAPS as caps,classroomListReorderConcurrencyDescriptors,assertClassroomListReorderConcurrencyDescriptors,
  parseClassroomListReorderConcurrencyReceipt,validateClassroomListReorderConcurrencyPair,parseClassroomListReorderPostflightReceipt,validateClassroomListReorderPostflight} from '../../scripts/contextual-classroom-list-reorder-concurrency'
const fixture=()=>newClassroomListReorderFixture('assignmentlist_012345abcdef')
const backend=(pid:number,xact='2026-10-20 00:00:01.000001+00')=>({pid,started:'2026-10-20 00:00:00+00',xact})
function receipts(index=0){
  const f=fixture(),pair=classroomListReorderConcurrencyDescriptors(f).pairs[index],before='a'.repeat(64),committed='b'.repeat(64)
  const base={version:1,scope:'classroom-list-reorder-lock-pair-v1',label:pair.label,bindingSha256:pair.bindingSha256,beforeSha256:before,
    nativeVerified:false,executionEnabled:false,requests:0,sessions:2}
  return{f,pair,a:{...base,role:'A',self:backend(101),peer:backend(102),afterBusySha256:before,committedSha256:index?committed:null,terminalSha256:index?committed:before,
    holderWitnessed:false,blockedObserved:index===0,conflict:'acknowledged',busy:false,partialLocksReleased:false,freshDenied:false,freshSucceeded:false,freshRolledBack:false,freshSha256:null,freshSelf:null,sentinel:null,realRpcCalls:0},
  b:{...base,role:'B',self:backend(102),peer:backend(101),afterBusySha256:index?before:null,committedSha256:committed,terminalSha256:committed,
    holderWitnessed:true,blockedObserved:false,conflict:index?'PT409':'success',busy:index!==0,partialLocksReleased:index!==0,freshDenied:index!==0,freshSucceeded:true,freshRolledBack:true,
    freshSha256:'c'.repeat(64),freshSelf:backend(102,'2026-10-20 00:00:01.000002+00'),sentinel:'classroom_list_reorder_fresh_rollback',realRpcCalls:index?3:2}}
}
describe('inert classroom-list reorder concurrency',()=>{
  it('closes3 pairs and1 postflight under unchanged finite caps',()=>{
    const f=fixture(),p=classroomListReorderConcurrencyDescriptors(f)
    expect(p).toEqual(classroomListReorderConcurrencyDescriptors(f));expect(Object.isFrozen(p.pairs)).toBe(true)
    expect(p.pairs.map(r=>r.label)).toEqual(['subject-serialization','classroom-operation-archive','classroom-owner-nowait-transfer'])
    expect(p).toMatchObject({scope:'classroom-list-reorder-lock-v1',sessions:2,requests:0,executionEnabled:false,nativeVerified:false})
    expect(caps).toEqual({pairs:3,sessions:2,requests:0,sqlBytes:262144,replyBytes:4096,observationMs:750,polls:150,cadenceMs:5,sqlMs:8000,lockMs:1000,automaticRetries:0})
    for(const pair of p.pairs){expect(pair.sha256).toBe(hash(JSON.stringify({a:pair.a,b:pair.b})))
      for(const sql of[pair.a,pair.b]){expect(Buffer.byteLength(sql)).toBeLessThanOrEqual(caps.sqlBytes);expect(sql).toContain("statement_timeout='8s'");expect(sql).toContain("lock_timeout='1s'")
        expect(sql.match(/select result from clr_lock_result/g)).toHaveLength(1)
        expect(sql).toContain('pg_stat_clear_snapshot()');expect(sql).toContain('query_start>=backend_start');expect(sql).toContain('v_attempts>=150');expect(sql).toContain('pg_sleep(0.005)')
        expect(sql).not.toMatch(/pgrowlocks|dblink|pg_terminate_backend|http_request|disable trigger|session_replication_role|create table private\./i)
        expect(sql).not.toMatch(/\d(?:or|and|then)\b/i)
      }}
    expect(p.postflight.name).toBe('postflight');expect(p.postflight.sha256).toBe(hash(p.postflight.sql));expect(Buffer.byteLength(p.postflight.sql)).toBeLessThanOrEqual(65536)
  })
  it('binds actual166 blocking, actual277 writes and268 archive, not invented creation or transfer RPCs',()=>{
    const p=classroomListReorderConcurrencyDescriptors(fixture())
    expect(p.pairs[0].a).toContain('16620260912');expect(p.pairs[0].a).toContain('pg_blocking_pids(v_peer.pid)');expect(p.pairs[0].a).toContain('not granted')
    expect(p.pairs[1].a).toContain('public.classroom_purge_try_lock(');expect(p.pairs[1].a).toContain('public.set_classroom_hot_archive_for_owner_v1(')
    expect(p.pairs[2].a).toContain('set teacher_id=');expect(p.pairs[2].b).toContain("when sqlstate '55P03'")
    p.pairs.forEach((pair,n)=>{expect(pair.b.match(/public\.reorder_classrooms_for_owner_v1\(/g)).toHaveLength(n?3:2)
      expect(pair.b).toContain('set local role service_role');expect(pair.b).toContain('reset role');expect(pair.b).toContain('classroom_list_reorder_fresh_rollback')
      expect(pair.b).toContain("when sqlstate 'PZ277'");expect(pair.b).toContain('v_fresh_self:=');expect(pair.b).toContain('fresh rollback graph differs')
      expect(pair.a+pair.b).not.toContain('create_classroom_atomic_v1(');expect(pair.a+pair.b).not.toContain('set enabled=')})
  })
  it('keeps whole synthetic/complement rows, legitimate versions and current grants in the oracle',()=>{
    const p=classroomListReorderConcurrencyDescriptors(fixture())
    for(const pair of p.pairs)for(const sql of[pair.a,pair.b]){
      expect(sql).toContain('jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)');expect(sql).toContain('original_sha256');expect(sql).toContain('checkpoint')
      for(const table of['private.pal_membership_generations','public.account_plan_audit','public.attendance_principal_mappings','public.attendance_status_override_events','public.student_profiles']){
        expect(sql).toContain(`from ${table} r where (`);expect(sql).toContain(`from ${table} r where not (`)}}
    expect(p.postflight.sql).toContain('legitimateVersions');expect(p.postflight.sql).toContain('completeOwnedSets');expect(p.postflight.sql).toContain('observed=14')
    expect(p.postflight.sql).toContain('":6') // Explicit cumulative version deltas, not original timestamp restoration.
    expect(p.pairs[2].a).toContain('order by actor loop perform public.lock_effective_feature_entitlement_v1')
    expect(p.pairs[0].a).toContain("'freshSucceeded',false")
  })
  it('refuses substituted or replayed plan inventory and SQL',()=>{
    const f=fixture(),p=classroomListReorderConcurrencyDescriptors(f);expect(assertClassroomListReorderConcurrencyDescriptors(f,p)).toBe(true)
    for(const bad of[{...p,requests:1},{...p,sessions:3},{...p,pairs:[p.pairs[0],p.pairs[0],p.pairs[2]]},{...p,pairs:p.pairs.toReversed()},
      {...p,pairs:p.pairs.map((r,n)=>n?r:{...r,a:r.a+'select 1;'})},{...p,postflight:{...p.postflight,sha256:'0'.repeat(64)}}])expect(()=>assertClassroomListReorderConcurrencyDescriptors(f,bad)).toThrow()
  })
  it.each([0,1,2])('validates reciprocal pair%s and rejects false/conflicting/tampered evidence',index=>{
    const r=receipts(index);expect(parseClassroomListReorderConcurrencyReceipt(JSON.stringify(r.a))).toEqual(r.a)
    const value=validateClassroomListReorderConcurrencyPair(r.f,r.pair.label,r.a,r.b)
    expect(value).toMatchObject({blockedObserved:index===0,busy:index!==0,committedState:true,freshRolledBack:true,nativeVerified:false})
    for(const patch of[{self:backend(101)},{peer:backend(999)},{holderWitnessed:false},{freshSucceeded:false},{freshRolledBack:false},{freshSha256:null},{freshSha256:'b'.repeat(64)},
      {freshSelf:backend(102)},{sentinel:'wrong'},{terminalSha256:'d'.repeat(64)},{bindingSha256:'0'.repeat(64)},{committedSha256:null},{realRpcCalls:9},{requests:1},{sessions:3},{nativeVerified:true},{private:true},{busy:index===0},{freshDenied:index===0}])
      expect(()=>validateClassroomListReorderConcurrencyPair(r.f,r.pair.label,r.a,{...r.b,...patch})).toThrow()
    expect(()=>validateClassroomListReorderConcurrencyPair(r.f,r.pair.label,{...r.a,blockedObserved:index!==0},r.b)).toThrow()
    if(index)expect(()=>validateClassroomListReorderConcurrencyPair(r.f,r.pair.label,r.a,{...r.b,partialLocksReleased:false})).toThrow()
  })
  it('rejects private/duplicate/escaped fields and accessors without evaluating them',()=>{
    const r=receipts(),text=JSON.stringify(r.a)
    for(const value of['private','x'.repeat(4097),text+'\n'+text,text.replace('"version":1','"version":1,"version":1'),text.replace('"version":1','"version":1,"\\u0076ersion":1')])expect(()=>parseClassroomListReorderConcurrencyReceipt(value)).toThrow()
    let accessed=false;const bad={...r.b};Object.defineProperty(bad,'self',{enumerable:true,get(){accessed=true;throw Error('secret')}})
    expect(()=>validateClassroomListReorderConcurrencyPair(r.f,r.pair.label,r.a,bad)).toThrow();expect(accessed).toBe(false)
  })
  it('retains exact PostgreSQL microseconds and refuses reformatted equal transaction instants',()=>{
    const r=receipts();expect(validateClassroomListReorderConcurrencyPair(r.f,r.pair.label,r.a,r.b).freshAuthorization).toBe(true)
    expect(()=>validateClassroomListReorderConcurrencyPair(r.f,r.pair.label,r.a,{...r.b,freshSelf:backend(102,'2026-10-20 00:00:01.000001+00:00')})).toThrow()
  })
  it('binds final postflight to the last committed pair, never the old SDK baseline',()=>{
    const r=receipts(2),last=validateClassroomListReorderConcurrencyPair(r.f,r.pair.label,r.a,r.b),plan=classroomListReorderConcurrencyDescriptors(r.f)
    const value={version:1,scope:'classroom-list-reorder-lock-postflight-v1',bindingSha256:plan.postflight.bindingSha256,terminalSha256:last.terminalSha256,sourcePreserved:true,originalsPreserved:true,
      disabledCreationGrant:true,completeOwnedSets:true,legitimateVersions:true,requests:0,sessions:0,executionEnabled:false,nativeVerified:false}
    expect(validateClassroomListReorderPostflight(r.f,last,parseClassroomListReorderPostflightReceipt(JSON.stringify(value)))).toEqual(value)
    for(const patch of[{terminalSha256:'0'.repeat(64)},{sourcePreserved:false},{originalsPreserved:false},{disabledCreationGrant:false},{completeOwnedSets:false},{legitimateVersions:false},{requests:1},{sessions:1}])
      expect(()=>validateClassroomListReorderPostflight(r.f,last,{...value,...patch})).toThrow()
  })
})
