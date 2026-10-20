/** CPU-only source/receipt evidence; never SQL execution or native admission. */
import { describe,expect,it } from 'vitest'
import { newAttendancePolicyWriteFixture,attendancePolicyWriteHash as hash } from '../../scripts/contextual-attendance-policy-write-native-fixture'
import { ATTENDANCE_POLICY_WRITE_LOCK_CAPS as caps,attendancePolicyWriteConcurrencyDescriptors,
  assertAttendancePolicyWriteConcurrencyDescriptors,parseAttendancePolicyWriteConcurrencyReceipt,
  validateAttendancePolicyWriteConcurrencyPair } from '../../scripts/contextual-attendance-policy-write-concurrency'

const fixture=()=>newAttendancePolicyWriteFixture('assignmentlist_012345abcdef')
const backend=(pid:number,xact='2026-10-20 00:00:01+00')=>({pid,started:'2026-10-20 00:00:00+00',xact})
function receipts(index=0){
  const f=fixture(),pair=attendancePolicyWriteConcurrencyDescriptors(f).pairs[index],state='a'.repeat(64)
  const base={version:1,scope:'attendance-policy-write-lock-pair-v1',label:pair.label,bindingSha256:pair.bindingSha256,
    beforeSha256:state,afterBusySha256:state,terminalSha256:state,nativeVerified:false,executionEnabled:false,requests:0,sessions:2}
  return{f,pair,a:{...base,role:'A',self:backend(101),peer:backend(102),holderWitnessed:false,conflict:'acknowledged',busy:false,
    partialLocksReleased:false,freshSucceeded:false,freshRolledBack:false,freshSha256:null,freshSelf:null,sentinel:null},
  b:{...base,role:'B',self:backend(102),peer:backend(101),holderWitnessed:true,conflict:'PT409',busy:true,partialLocksReleased:true,
    freshSucceeded:true,freshRolledBack:true,freshSha256:'b'.repeat(64),freshSelf:backend(102,'2026-10-20 00:00:02+00'),sentinel:'attendance_policy_write_fresh_rollback'}}
}
describe('inert attendance write concurrency leaves',()=>{
  it('issues only three deterministic frozen SQL pairs and unchanged finite caps',()=>{
    const f=fixture(),d=attendancePolicyWriteConcurrencyDescriptors(f)
    expect(d).toEqual(attendancePolicyWriteConcurrencyDescriptors(f));expect(Object.isFrozen(d.pairs)).toBe(true)
    expect(d).toMatchObject({scope:'attendance-policy-write-lock-v1',sessions:2,requests:0,executionEnabled:false,nativeVerified:false})
    expect(d.pairs.map(p=>p.label)).toEqual(['classroom-operation-advisory','classroom-owner-nowait','entitlement-actor-advisory'])
    expect(caps).toEqual({pairs:3,sessions:2,requests:0,sqlBytes:262144,replyBytes:4096,observationMs:750,polls:150,cadenceMs:5,sqlMs:8000,lockMs:1000,automaticRetries:0})
    for(const p of d.pairs){expect(p.sha256).toBe(hash(JSON.stringify({a:p.a,b:p.b})))
      for(const sql of [p.a,p.b]){expect(Buffer.byteLength(sql)).toBeLessThanOrEqual(caps.sqlBytes)
        expect(sql).toContain("statement_timeout='8s'");expect(sql).toContain("lock_timeout='1s'")
        expect(sql).toContain("interval '750 milliseconds'");expect(sql).toContain('v_attempts>=150');expect(sql).toContain('pg_sleep(0.005)')
        expect(sql).toContain('pg_stat_clear_snapshot()');expect(sql).toContain('query_start>=backend_start')
        expect(sql).not.toMatch(/dblink|pg_terminate_backend|http_request|disable trigger|session_replication_role|create table private\./i)
      }
    }
  })
  it('rejects substituted SQL, hashes, labels, applications, sessions or network inventory',()=>{
    const f=fixture(),d=attendancePolicyWriteConcurrencyDescriptors(f)
    expect(assertAttendancePolicyWriteConcurrencyDescriptors(f,d)).toBe(true)
    for(const changed of [{...d,requests:1},{...d,sessions:3},{...d,pairs:d.pairs.slice(1)},
      {...d,pairs:d.pairs.map((p,n)=>n?p:{...p,a:p.a+'select 1;'})},
      {...d,pairs:d.pairs.map((p,n)=>n?p:{...p,sha256:'0'.repeat(64)})},
      {...d,pairs:d.pairs.map((p,n)=>n?p:{...p,label:'private'})},
      {...d,pairs:d.pairs.map((p,n)=>n?p:{...p,applications:{...p.applications,A:'foreign'}})}])
      expect(()=>assertAttendancePolicyWriteConcurrencyDescriptors(f,changed)).toThrow()
  })
  it('uses real 274 under service_role with independently observed exact production lock keys',()=>{
    const d=attendancePolicyWriteConcurrencyDescriptors(fixture())
    expect(d.pairs[0].a).toContain('pika-classroom-operation:');expect(d.pairs[0].a).toContain('public.classroom_purge_try_lock(')
    expect(d.pairs[1].a).toContain('for update nowait');expect(d.pairs[1].b).toContain("when sqlstate '55P03'")
    expect(d.pairs[2].a).toContain('13220260823')
    for(const p of d.pairs){expect(p.b.match(/public\.save_attendance_policy_for_owner_v1\(/g)).toHaveLength(2)
      expect(p.b).toContain('set local role service_role');expect(p.b).toContain('reset role')
      expect(p.b).toContain("when sqlstate 'PT409'");expect(p.b).toContain('partial advisory locks retained')
      expect(p.b).toContain("locktype='advisory'");expect(p.b).toContain('classid::bigint=');expect(p.b).toContain('objid::bigint=')
      expect(p.b).toContain('attendance_policy_write_fresh_rollback');expect(p.b).toContain("when sqlstate 'PZ274'")
      expect(p.b).toContain('fresh complete row differs');expect(p.b).toContain('fresh DTO differs')
      expect(p.b).toContain('fresh rollback graph differs');expect(p.b).toContain('v_fresh_self:=')
      expect(p.b).not.toContain('upsert_attendance_timing_policy_v1(')
    }
  })
  it('binds synthetic and untouched complete rows to the restored SDK baseline',()=>{
    const d=attendancePolicyWriteConcurrencyDescriptors(fixture())
    for(const p of d.pairs)for(const sql of [p.a,p.b]){
      expect(sql).toContain('b.observed<>15');expect(sql).toContain('b.graph');expect(sql).toContain('original_sha256')
      expect(sql).toContain('jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)')
      for(const table of ['private.pal_membership_generations','public.account_plans','public.account_plan_audit','public.effective_feature_entitlement_audit',
        'public.attendance_principal_mappings','public.attendance_integration_outbox','public.attendance_status_override_events']){
        expect(sql).toContain(`from ${table} r where (`);expect(sql).toContain(`from ${table} r where not (`)
      }
    }
  })
  it.each([0,1,2])('validates reciprocal bounded pair %s without claiming native execution',index=>{
    const r=receipts(index)
    expect(parseAttendancePolicyWriteConcurrencyReceipt(JSON.stringify(r.a))).toEqual(r.a)
    expect(validateAttendancePolicyWriteConcurrencyPair(r.f,r.pair.label,r.a,r.b)).toMatchObject({busy:true,freshRolledBack:true,nativeVerified:false,executionEnabled:false})
    for(const patch of [{peer:backend(999)},{self:backend(101)},{holderWitnessed:false},{busy:false},{partialLocksReleased:false},
      {freshSucceeded:false},{freshRolledBack:false},{freshSha256:null},{freshSha256:'a'.repeat(64)},{freshSelf:backend(102)},
      {sentinel:'wrong'},{afterBusySha256:'c'.repeat(64)},{terminalSha256:'d'.repeat(64)},{bindingSha256:'0'.repeat(64)},
      {nativeVerified:true},{executionEnabled:true},{requests:1},{sessions:3},{privatePayload:'secret'}])
      expect(()=>validateAttendancePolicyWriteConcurrencyPair(r.f,r.pair.label,r.a,{...r.b,...patch})).toThrow('Attendance write lock pair rejected')
  })
  it('rejects private text, malformed, duplicate or escaped fields and accessors',()=>{
    const r=receipts(),text=JSON.stringify(r.a)
    for(const raw of ['private-secret','x'.repeat(4097),text+'\n'+text,
      text.replace('"version":1','"version":1,"version":1'),text.replace('"version":1','"version":1,"\\u0076ersion":1')])
      expect(()=>parseAttendancePolicyWriteConcurrencyReceipt(raw)).toThrow('Attendance write lock receipt rejected')
    const bad={...r.b};Object.defineProperty(bad,'self',{enumerable:true,get(){throw Error('private-secret')}})
    expect(()=>validateAttendancePolicyWriteConcurrencyPair(r.f,r.pair.label,r.a,bad)).toThrow('Attendance write lock pair rejected')
  })
  it('keeps PostgreSQL microsecond ordering for separate transactions in one JS millisecond',()=>{
    const r=receipts(),first=backend(102,'2026-10-20 00:00:01.000001+00')
    const a={...r.a,peer:first},b={...r.b,self:first,freshSelf:backend(102,'2026-10-20 00:00:01.000002+00')}
    expect(validateAttendancePolicyWriteConcurrencyPair(r.f,r.pair.label,a,b).freshAuthorization).toBe(true)
    expect(()=>validateAttendancePolicyWriteConcurrencyPair(r.f,r.pair.label,a,{...b,freshSelf:{...first,xact:'2026-10-20 00:00:01.000001+00:00'}})).toThrow('Attendance write lock pair rejected')
  })
})
