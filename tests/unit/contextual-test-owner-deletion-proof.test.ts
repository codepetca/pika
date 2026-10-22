import * as platform from '../../scripts/contextual-assignment-list-proof-platform'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe,expect,it,vi } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerDeletionFixture,testOwnerDeletionSetupSql,testOwnerDeletionSnapshotSql } from '../../scripts/contextual-test-owner-deletion-proof-fixture'
import { testOwnerDeletionNativePlan,validateTestOwnerDeletionNativePlanSql,runTestOwnerDeletionNativeContracts,runTestOwnerDeletionNativeRaces } from '../../scripts/contextual-test-owner-deletion-native-contracts'
import type { DraftSaveDriver,DraftSaveTarget } from '../../scripts/check-contextual-test-draft-save-db-contracts'
import { buildTestOwnerDeletionNativeContractsManifest,createTestOwnerDeletionNativeContracts } from '../../scripts/contextual-test-draft-save-native-contracts'
const sourceMutation=vi.hoisted(()=>({kind:''}))
vi.mock('node:fs',async load=>{
  const actual=await load<typeof import('node:fs')>()
  return {...actual,readFileSync:((...args:unknown[])=>{
    const result=Reflect.apply(actual.readFileSync,undefined,args)
    if(typeof result!=='string'||!String(args[0]).endsWith('check-contextual-test-owner-deletion.sql'))return result
    const marker='\n-- deletion-frame-teacher\n'
    if(sourceMutation.kind==='missing')return result.replace(marker,'\n')
    if(sourceMutation.kind==='duplicate')return result.replace(marker,marker+marker)
    if(sourceMutation.kind==='order')return result.replace(marker,'\n-- placeholder\n').replace('\n-- deletion-frame-student\n',marker).replace('\n-- placeholder\n','\n-- deletion-frame-student\n')
    return result
  }) as typeof actual.readFileSync}
})

const original=newAssignmentListProofFixture(new Date('2026-10-12T12:00:00Z'))
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
const plan=()=>testOwnerDeletionNativePlan(original,'b'.repeat(40),process.cwd())
const target=(m:ReturnType<typeof plan>,kind:'contracts'|'concurrency'):DraftSaveTarget=>Object.freeze({projectId:m.projectId,containerProjectLabel:m.projectId,
  apiUrl:'http://127.0.0.1:54331',databaseHost:'127.0.0.1',databasePort:54332,containerId:'a'.repeat(64),disposable:true,
  reviewedHead:m.reviewedHead,reviewedSourceSha256:m.sourceSha256,migrationManifestSha256:m.migrationManifestSha256,acceptedManifestSha256:hash(JSON.stringify(m[kind]))})
describe('finite deletion proof source, never native acceptance',()=>{
  it('uses the fixed private factory without executing setup/run or exposing execution knobs',()=>{
    const m=buildTestOwnerDeletionNativeContractsManifest(original,'b'.repeat(40),process.cwd())
    expect(m.capabilities).toMatchObject({sessions:2,actions:200,controlCalls:4000,totalMs:900000})
    expect(m.privilege.expectedEvidence).toEqual({status:503,rpcCalls:1,rawCode:'42501'})
    expect(m.privilege.restore).toContain('grant execute');expect(m.nativeVerified).toBe(false)
    expect(validateTestOwnerDeletionNativePlanSql(m,m.contracts.sql)).toBe(false)
    const e=createTestOwnerDeletionNativeContracts({repository:process.cwd(),reviewedHead:'b'.repeat(40),original,containerId:'a'.repeat(64),
      capturedResources:[],acceptedManifestSha256:hash(JSON.stringify(m)),absoluteDeadline:Date.now()+60000})
    expect(e.diagnostic()).toContain('phase=idle');expect(e).not.toHaveProperty('driver');expect(e).not.toHaveProperty('execute')
  })
  it('has small fixed work fixtures but no committed AI rows or legacy policy changes',()=>{
    const f=newTestOwnerDeletionFixture(original),sql=testOwnerDeletionSetupSql(f,`pika_assignment_list_${f.tag.slice(-12)}`)
    expect(Object.isFrozen(f)).toBe(true);expect(f.allocatedIds.length).toBe(new Set(f.allocatedIds).size)
    expect(f.tests).toHaveLength(8);expect(f.attempts.length).toBeGreaterThan(0);expect(f.history.length).toBe(f.attempts.length)
    expect(f.responses.some(r=>r.student_id===f.actors[3].id)).toBe(true)
    expect(f.enrollments.some(e=>e.student_id===f.actors[3].id)).toBe(false)
    expect(sql).not.toMatch(/insert into public\.test_ai_grading|disable trigger|session_replication_role|set_config/)
    for(const table of ['test_attempt_history','test_responses','test_focus_events','test_student_availability','assessment_drafts','managed_storage_objects','classroom_guided_draft_provenance'])expect(sql).toContain(table)
    expect(Buffer.byteLength(sql)).toBeLessThanOrEqual(256*1024)
    expect(testOwnerDeletionSnapshotSql(f)).toContain(f.history[0].id)
    expect(testOwnerDeletionSnapshotSql(f)).toContain('public.test_attempt_history')
  })
  it('seals actual262 bytes and admits only eight registered source frames plus sixteen schedules',()=>{
    const m=plan();expect(m.migrations).toHaveLength(290);expect(m.contracts.frames).toHaveLength(8);expect(m.concurrency.schedules).toHaveLength(16)
    expect(m.contracts.frames.length+2*m.concurrency.schedules.length).toBe(40)
    expect(m.caps).toMatchObject({sqlBytes:524288,responseBytes:8388608,requestMs:12000,totalMs:180000,dispatches:40})
    expect(m.sourceSha256).toBe(hash(readFileSync('supabase/migrations/262_contextual_test_owner_delete.sql','utf8')))
    expect(validateTestOwnerDeletionNativePlanSql(m,m.contracts.sql)).toBe(false)
    for(const sql of [m.setup,m.snapshot,...m.contracts.frames.map(f=>f.sql),...m.concurrency.schedules.flatMap(s=>[s.holderSql,s.rejectSql])]){
      expect(validateTestOwnerDeletionNativePlanSql(m,sql)).toBe(true);expect(validateTestOwnerDeletionNativePlanSql(m,sql+'select 1;')).toBe(false)
      expect(Buffer.byteLength(sql)).toBeLessThanOrEqual(256*1024)
    }
    expect(validateTestOwnerDeletionNativePlanSql(Object.freeze({...m,sourceSha256:'0'.repeat(64)}),m.setup)).toBe(false)
    const body=m.contracts.frames.map((f,i)=>i===7?f.sql:f.sql.replace(`\nselect jsonb_build_object('frame','${f.label}','transaction',txid_current()::text) as result;`,''))
    expect(body.join('')).toBe(m.contracts.sql)
  })
  it('contains actual legacy/contextual closure, retained Draft/foreign override and absence/restoration assertions',()=>{
    const sql=readFileSync('scripts/check-contextual-test-owner-deletion.sql','utf8')
    for(const marker of ['test_absent','responses_count','public.delete_test_atomic','retained Draft','foreign-Class override','test_attempt_history',
      'suppressed','reinserted','late delete fault','trigger catalog','AccessExclusiveLock','queued','running','shared material','cleanup_pending'])expect(sql).toContain(marker)
    expect(sql).not.toMatch(/disable trigger|session_replication_role/)
    expect(sql).toContain("exception when sqlstate 'ZX262'")
    expect(sql).toContain("row->>'id' in ('a2620000-0000-4000-8000-000000005115','a2620000-0000-4000-8000-000000005116')")
    expect(sql).toContain("status='cleanup_pending' and cleanup_reason_code='test_snapshot_reference_removed'")
    expect(sql).toContain('pg_temp.deletion_comparable(actual_graph) is distinct from pg_temp.deletion_comparable(legacy_graph)')
    expect(sql).toContain("array['queued','running','completed']")
    expect(sql).toContain('set questions_locked_at=clock_timestamp()')
    expect(sql).toContain('private.student_provider_cleanup_bindings')
    expect(sql).toContain('public.classroom_purge_fences')
    expect(testOwnerDeletionSnapshotSql(newTestOwnerDeletionFixture(original))).toContain('__nontarget_catalog')
  })
  it.each(['missing','duplicate','order'])('fails closed on %s immutable source boundary',kind=>{
    sourceMutation.kind=kind;try{expect(plan).toThrow()}finally{sourceMutation.kind=''}
  })
  it('retains one aggregate180s clock across all frames and closes on expiry',async()=>{
    const m=plan(),t=target(m,'contracts'),close=vi.fn(async()=>{});let clock=1000,calls=0
    const now=vi.spyOn(Date,'now').mockImplementation(()=>clock)
    const d:DraftSaveDriver={verifyTarget:async()=>t,openSession:async name=>({name,rollbackAndClose:close,execute:async sql=>{
      const f=m.contracts.frames.find(f=>f.sql===sql)!;if(++calls===3)clock+=180001
      return[{result:{frame:f.label,transaction:'17'}}]
    }})}
    try{await expect(runTestOwnerDeletionNativeContracts(m,t,d)).rejects.toThrow();expect(calls).toBe(3);expect(close).toHaveBeenCalledTimes(1)}finally{now.mockRestore()}
  })
  it.each(['malformed','order','transaction','throw'])('stops frames and closes on %s',async defect=>{
    const m=plan(),t=target(m,'contracts'),close=vi.fn(async()=>{}),execute=vi.fn(async(sql:string)=>{
      const i=m.contracts.frames.findIndex(f=>f.sql===sql),f=m.contracts.frames[i]
      if(i===2){if(defect==='throw')throw Error('modeled failure');return[{result:defect==='malformed'?{}:{frame:defect==='order'?'authority':f.label,transaction:defect==='transaction'?'18':'17'}}]}
      return[{result:{frame:f.label,transaction:'17'}}]
    }),driver:DraftSaveDriver={verifyTarget:async()=>t,openSession:async name=>({name,execute,rollbackAndClose:close})}
    await expect(runTestOwnerDeletionNativeContracts(m,t,driver)).rejects.toThrow();expect(execute).toHaveBeenCalledTimes(3);expect(close).toHaveBeenCalledTimes(1)
  })
  it('runs exact receipts in one mock session with unchanged request bounds',async()=>{
    const m=plan(),t=target(m,'contracts'),close=vi.fn(async()=>{}),execute=vi.fn(async(sql:string,_timeout:number)=>{
      const f=m.contracts.frames.find(f=>f.sql===sql)!
      return[{result:f.label==='final'?{checks:m.contracts.checks}:{frame:f.label,transaction:'17'}}]
    }),open=vi.fn(async(name:string)=>({name,execute,rollbackAndClose:close})),d:DraftSaveDriver={verifyTarget:async()=>t,openSession:open}
    expect(await runTestOwnerDeletionNativeContracts(m,t,d)).toEqual({checks:m.contracts.checks,nativeVerified:false})
    expect(open).toHaveBeenCalledTimes(1);expect(close).toHaveBeenCalledTimes(1);expect(execute.mock.calls.map(([sql])=>sql)).toEqual(m.contracts.frames.map(f=>f.sql))
    expect(execute.mock.calls.every(([,ms])=>ms<=12000)).toBe(true)
  })
  it('uses actual writer locks and explicit absence for delete-first holders',()=>{
    const m=plan(),s=m.concurrency.schedules
    const membership=readFileSync('supabase/migrations/164_student_classroom_removal.sql','utf8')
    expect(membership).toMatch(/private\.try_lock_classroom_membership_change[\s\S]*?returns void/)
    expect(s.find(s=>s.label==='classroom-membership-operation')!.holderSql).toContain('perform private.try_lock_classroom_membership_change')
    expect(s.find(s=>s.label==='classroom-membership-operation')!.holderSql).not.toContain('if not private.try_lock_classroom_membership_change')
    expect(s.find(s=>s.label==='access-before-delete')!.holderSql).toContain('public.update_test_student_access_atomic')
    expect(s.find(s=>s.label==='grade-before-delete')!.holderSql).toContain('public.save_test_response_grades_atomic')
    expect(s.find(s=>s.label==='ai-before-delete')!.holderSql).toContain('public.create_test_ai_grading_run_atomic')
    for(const x of s.filter(s=>s.label.startsWith('delete-before-'))){expect(x.holderSql).toContain("'test_absent'");expect(x.deletedFirst).toBe(true);expect(x.code).toBe('55P03')}
  })
  it('validates actual holder scope/absence receipts and closes both mock sessions',async()=>{
    const m=plan(),t=target(m,'concurrency'),close=vi.fn(async()=>{}),d:DraftSaveDriver={verifyTarget:async()=>t,openSession:async name=>({name,rollbackAndClose:close,execute:async sql=>{
      const s=m.concurrency.schedules.find(s=>s.holderSql===sql||s.rejectSql===sql)!
      return[{result:s.holderSql===sql?{held:true,transaction:true,scope:true,test_absent:s.deletedFirst,backend_pid:11,application_name:name,label:s.label,relation:s.relation}
        :{rejected:true,code:s.code,rows_unchanged:true,label:s.label}}]
    }})}
    expect((await runTestOwnerDeletionNativeRaces(m,t,d)).outcomes).toHaveLength(16);expect(close).toHaveBeenCalledTimes(32)
  })
})

describe('complete reviewed268 source profile (offline)', () => {
  it.each([263, 264, 265, 266, 267, 268])('accepts exact complete source profile %i', count => {
    const migrations = platform.loadAssignmentListReviewedMigrations(process.cwd()).slice(0, count)
    const loader = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
    try { expect(() => plan()).not.toThrow() } finally { loader.mockRestore() }
  })
  it.each([263, 264, 265, 266, 267, 268].flatMap(number => ['name', 'digest', 'bytes', 'self-hashed-bytes'].map(defect => ({ number, defect }))))('rejects altered migration $number: $defect', ({ number, defect }) => {
    const migrations = platform.loadAssignmentListReviewedMigrations(process.cwd()).map(migration => ({ ...migration }))
    const tail = migrations[number - 1]
    if (defect === 'name') tail.name = `${number}_unknown.sql`
    if (defect === 'digest') tail.sha256 = 'f'.repeat(64)
    if (defect === 'bytes' || defect === 'self-hashed-bytes') tail.sql += '\n'
    if (defect === 'self-hashed-bytes') tail.sha256 = createHash('sha256').update(tail.sql).digest('hex')
    const loader = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
    try { expect(() => plan()).toThrow() } finally { loader.mockRestore() }
  })
  it('rejects a contiguous unknown289 source tail', () => {
    const migrations = platform.loadAssignmentListReviewedMigrations(process.cwd()).map(migration => ({ ...migration }))
    migrations.push({ name: '289_unknown.sql', sql: 'select 1;', sha256: createHash('sha256').update('select 1;').digest('hex') })
    const loader = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
    try { expect(() => plan()).toThrow() } finally { loader.mockRestore() }
  })
})
