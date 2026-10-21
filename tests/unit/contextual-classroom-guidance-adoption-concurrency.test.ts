/** CPU-only descriptor and receipt checks. No executor, database or native evidence. */
import {describe,expect,it} from 'vitest'
import {newClassroomGuidanceAdoptionFixture,classroomGuidanceAdoptionHash as hash,classroomGuidanceAdoptionSnapshotHash} from '../../scripts/contextual-classroom-guidance-adoption-native-fixture'
import {CLASSROOM_GUIDANCE_ADOPTION_LOCK_CAPS as caps,classroomGuidanceAdoptionConcurrencyDescriptors,
 assertClassroomGuidanceAdoptionConcurrencyDescriptors,parseClassroomGuidanceAdoptionConcurrencyReceipt,validateClassroomGuidanceAdoptionConcurrencyPair,
 parseClassroomGuidanceAdoptionPostflightReceipt,validateClassroomGuidanceAdoptionPostflight} from '../../scripts/contextual-classroom-guidance-adoption-concurrency'
const fixture=()=>newClassroomGuidanceAdoptionFixture('assignmentlist_012345abcdef')
const backend=(pid:number,xact='2026-10-20 00:00:01.000001+00')=>({pid,started:'2026-10-20 00:00:00+00',xact})
function receipts(index=0){
 const f=fixture(),pair=classroomGuidanceAdoptionConcurrencyDescriptors(f).pairs[index],state='a'.repeat(64)
 const base={version:1,scope:'classroom-guidance-adoption-lock-pair-v1',label:pair.label,bindingSha256:pair.bindingSha256,beforeSha256:state,afterBusySha256:state,terminalSha256:state,requests:0,sessions:2,executionEnabled:false,nativeVerified:false}
 return{f,pair,a:{...base,role:'A',self:backend(101),peer:backend(102),holderWitnessed:false,conflict:'acknowledged',busy:false,partialLocksReleased:false,freshSucceeded:false,freshRolledBack:false,freshSha256:null,freshSelf:null,sentinel:null},
 b:{...base,role:'B',self:backend(102),peer:backend(101),holderWitnessed:true,conflict:'PT409',busy:true,partialLocksReleased:true,freshSucceeded:true,freshRolledBack:true,freshSha256:'b'.repeat(64),freshSelf:backend(102,'2026-10-20 00:00:02+00'),sentinel:'classroom_guidance_adoption_fresh_rollback'}}
}
describe('inert guidance adoption three real contention pairs',()=>{
 it('returns immutable exact three-pair/one-postflight inventory with original finite caps',()=>{
  const f=fixture(),d=classroomGuidanceAdoptionConcurrencyDescriptors(f)
  expect(d).toEqual(classroomGuidanceAdoptionConcurrencyDescriptors(f));expect(Object.isFrozen(d.pairs)).toBe(true)
  expect(d.pairs.map(p=>p.label)).toEqual(['classroom-operation-advisory','blueprint-purge-advisory','classroom-row-nowait'])
  expect(d).toMatchObject({scope:'classroom-guidance-adoption-lock-v1',sessions:2,requests:0,executionEnabled:false,nativeVerified:false})
  expect(caps).toEqual({pairs:3,sessions:2,requests:0,sqlBytes:262144,replyBytes:4096,observationMs:750,polls:150,cadenceMs:5,sqlMs:8000,lockMs:1000,automaticRetries:0})
  for(const p of d.pairs){expect(p.sha256).toBe(hash(JSON.stringify({a:p.a,b:p.b})))
   for(const sql of[p.a,p.b]){expect(Buffer.byteLength(sql)).toBeLessThanOrEqual(caps.sqlBytes)
    for(const token of["statement_timeout='8s'","lock_timeout='1s'","interval '750 milliseconds'",'v_attempts>=150','pg_sleep(0.005)','pg_stat_clear_snapshot()','query_start>=backend_start'])expect(sql).toContain(token)
    expect(sql).not.toMatch(/dblink|pg_terminate_backend|http_request|disable trigger|session_replication_role|create table private\./i)}
  }
  expect(d.postflight.sha256).toBe(hash(d.postflight.sql));expect(d.postflight.sql).toContain('begin read only')
 })
 it('rejects SQL, application, binding, caps and inventory substitutions',()=>{
  const f=fixture(),d=classroomGuidanceAdoptionConcurrencyDescriptors(f);expect(assertClassroomGuidanceAdoptionConcurrencyDescriptors(f,d)).toBe(true)
  for(const change of[{...d,requests:1},{...d,sessions:3},{...d,pairs:d.pairs.slice(1)},{...d,pairs:d.pairs.toReversed()},
   {...d,pairs:d.pairs.map((p,n)=>n?p:{...p,b:p.b+'select 1;'})},{...d,pairs:d.pairs.map((p,n)=>n?p:{...p,bindingSha256:'0'.repeat(64)})},
   {...d,pairs:d.pairs.map((p,n)=>n?p:{...p,applications:{...p.applications,A:'foreign'}})},{...d,postflight:{...d.postflight,sql:'select 1;'}},{...d,caps:{...d.caps,polls:151}}])
   expect(()=>assertClassroomGuidanceAdoptionConcurrencyDescriptors(f,change)).toThrow()
 })
 it('calls actual280 under service_role with exact118/120 locks and rolled-back row probes',()=>{
  const f=fixture(),d=classroomGuidanceAdoptionConcurrencyDescriptors(f)
  expect(d.pairs[0].a).toContain('public.classroom_purge_try_lock(');expect(d.pairs[0].a).toContain('pika-classroom-operation:')
  expect(d.pairs[1].a).toContain('public.guard_course_blueprint_purge_lifecycle(');expect(d.pairs[1].a).toContain("'course_blueprint_purge'")
  expect(d.pairs[2].a).toContain('from public.classrooms where id=');expect(d.pairs[2].b).toContain("when sqlstate '55P03'")
  for(const p of d.pairs){expect(p.b.match(/public\.save_and_adopt_classroom_guidance_for_owner_v1\(/g)).toHaveLength(2)
   for(const token of['set local role service_role','reset role',"when sqlstate 'PT409'",'class_guidance_adoption_busy','partial advisory locks retained',
    "locktype='advisory'",'classid::bigint=','objid::bigint=',"when sqlstate 'PZ280'",'classroom_guidance_adoption_fresh_rollback','fresh complete graph effect differs','fresh rollback graph differs','v_fresh_self:=','private.classroom_guidance_adoption_source_v1'])expect(p.b).toContain(token)
   expect(p.b).toContain(f.dedupVersionId);expect(p.b).toContain(classroomGuidanceAdoptionSnapshotHash(f,2))
   expect(p.b).not.toMatch(/delete from public\.course_blueprint_versions|update public\.course_blueprint_versions|save_course_blueprint_version_atomic\(/i)
  }
  expect(d.pairs[2].b).toContain("errcode='PZ281'");expect(d.pairs[2].b).toContain('classroom_guidance_adoption_row_probe')
  expect(d.pairs[2].a).toContain('from public.course_blueprints where id=')
  expect(d.pairs[2].a).toContain("errcode='PZ282'");expect(d.pairs[2].a).toContain('classroom_guidance_adoption_parent_probe')
  expect(d.pairs[2].a.indexOf("'classroom_guidance_adoption_parent_probe'")).toBeGreaterThan(d.pairs[2].a.indexOf('v_attempts>=150'))
 })
 it('binds complete63-table synthetic/complement state to postSDK observed5 checkpoint',()=>{
  const d=classroomGuidanceAdoptionConcurrencyDescriptors(fixture())
  for(const p of d.pairs)for(const sql of[p.a,p.b]){
   expect(sql).toContain('b.observed<>5');expect(sql).toContain('b.checkpoint');expect(sql).toContain('original_sha256')
   for(const table of['public.course_blueprint_versions','public.course_blueprint_authoring_guidance_revisions','private.pal_membership_generations','public.account_plans','public.attendance_integration_outbox']){
    expect(sql).toContain('from '+table+' r where (');expect(sql).toContain('from '+table+' r where not (')}
  }
 })
 it.each([0,1,2])('validates reciprocal receipts and fresh rollback for pair%i',index=>{
  const r=receipts(index);expect(parseClassroomGuidanceAdoptionConcurrencyReceipt(JSON.stringify(r.a))).toEqual(r.a)
  const summary=validateClassroomGuidanceAdoptionConcurrencyPair(r.f,r.pair.label,r.a,r.b)
  expect(summary).toMatchObject({beforeSha256:'a'.repeat(64),terminalSha256:'a'.repeat(64),busy:true,freshAuthorization:true,freshRolledBack:true,exactGraphEffect:true,nativeVerified:false})
  for(const patch of[{peer:backend(999)},{self:backend(101)},{holderWitnessed:false},{busy:false},{partialLocksReleased:false},{freshSucceeded:false},{freshRolledBack:false},
   {freshSha256:null},{freshSha256:'a'.repeat(64)},{freshSelf:backend(102)},{sentinel:'wrong'},{afterBusySha256:'c'.repeat(64)},{terminalSha256:'c'.repeat(64)},{bindingSha256:'0'.repeat(64)},
   {nativeVerified:true},{executionEnabled:true},{requests:1},{sessions:3},{privatePayload:'secret'}])
   expect(()=>validateClassroomGuidanceAdoptionConcurrencyPair(r.f,r.pair.label,r.a,{...r.b,...patch})).toThrow('Guidance adoption lock pair rejected')
 })
 it('rejects malformed, duplicate, escaped, private, cyclic and accessor receipts',()=>{
  const r=receipts(),text=JSON.stringify(r.a)
  for(const raw of['private-secret','x'.repeat(4097),text+'\n'+text,text.replace('"version":1','"version":1,"version":1'),text.replace('"version":1','"version":1,"\\u0076ersion":1')])
   expect(()=>parseClassroomGuidanceAdoptionConcurrencyReceipt(raw)).toThrow('receipt rejected')
  const getter={...r.a};Object.defineProperty(getter,'self',{enumerable:true,get:()=>{throw Error('getter evaluated')}})
  expect(()=>validateClassroomGuidanceAdoptionConcurrencyPair(r.f,r.pair.label,getter,r.b)).toThrow('lock pair rejected')
  const cycle={...r.a,self:{...r.a.self}}as Record<string,unknown>;cycle.self=cycle;expect(()=>validateClassroomGuidanceAdoptionConcurrencyPair(r.f,r.pair.label,cycle,r.b)).toThrow('lock pair rejected')
 })
 it('preserves microsecond fresh transaction identity',()=>{
  const r=receipts();r.b.freshSelf={...r.b.self,xact:'2026-10-20 00:00:01.000002+00'}
  expect(()=>validateClassroomGuidanceAdoptionConcurrencyPair(r.f,r.pair.label,r.a,r.b)).not.toThrow()
  r.b.freshSelf={...r.b.self,xact:'2026-10-20 00:00:01.000001+00'}
  expect(()=>validateClassroomGuidanceAdoptionConcurrencyPair(r.f,r.pair.label,r.a,r.b)).toThrow()
 })
 it('requires final independent postflight binding and last-pair whole-checkpoint equality',()=>{
  const r=receipts(2),last=validateClassroomGuidanceAdoptionConcurrencyPair(r.f,r.pair.label,r.a,r.b),p=classroomGuidanceAdoptionConcurrencyDescriptors(r.f).postflight
  const result={version:1,scope:'classroom-guidance-adoption-lock-postflight-v1',bindingSha256:p.bindingSha256,terminalSha256:last.terminalSha256,sourcePreserved:true,originalsPreserved:true,postSdkCheckpoint:true,requests:0,sessions:0,executionEnabled:false,nativeVerified:false}
  expect(parseClassroomGuidanceAdoptionPostflightReceipt(JSON.stringify(result))).toEqual(result);expect(validateClassroomGuidanceAdoptionPostflight(r.f,last,result)).toEqual(result)
  for(const patch of[{sourcePreserved:false},{originalsPreserved:false},{postSdkCheckpoint:false},{bindingSha256:'0'.repeat(64)},{terminalSha256:'b'.repeat(64)},{unknown:true},{sessions:1},{nativeVerified:true}])
   expect(()=>validateClassroomGuidanceAdoptionPostflight(r.f,last,{...result,...patch})).toThrow()
  expect(()=>validateClassroomGuidanceAdoptionPostflight(r.f,{...last,label:'classroom-operation-advisory'},result)).toThrow()
 })
})
