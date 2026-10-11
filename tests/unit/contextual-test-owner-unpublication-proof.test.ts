import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerUnpublicationFixture } from '../../scripts/contextual-test-owner-unpublication-proof-fixture'
import { testOwnerUnpublicationNativePlan, validateTestOwnerUnpublicationNativePlanSql,runTestOwnerUnpublicationNativeContracts,runTestOwnerUnpublicationNativeRaces } from '../../scripts/contextual-test-owner-unpublication-native-contracts'
import * as platform from '../../scripts/contextual-assignment-list-proof-platform'
import { buildTestOwnerUnpublicationNativeContractsManifest } from '../../scripts/contextual-test-draft-save-native-contracts'
import type { DraftSaveDriver,DraftSaveTarget } from '../../scripts/check-contextual-test-draft-save-db-contracts'
import { TEST_OWNER_UNPUBLICATION_REVIEWED_MIGRATION, validateTestOwnerUnpublicationReviewedMigration } from '../../scripts/test-owner-unpublication-reviewed-migration'

const original = newAssignmentListProofFixture(new Date('2026-10-11T12:00:00Z'))
const plan=()=>testOwnerUnpublicationNativePlan(original,'b'.repeat(40),process.cwd())
const digest=(v:string)=>createHash('sha256').update(v).digest('hex')
const target=(m:ReturnType<typeof plan>,phase:'contracts'|'concurrency'):DraftSaveTarget=>Object.freeze({
  projectId:m.projectId,containerProjectLabel:m.projectId,apiUrl:'http://127.0.0.1:54331',databaseHost:'127.0.0.1',databasePort:54332,
  containerId:'a'.repeat(64),disposable:true,reviewedHead:m.reviewedHead,migrationManifestSha256:m.migrationManifestSha256,
  reviewedSourceSha256:m.sourceSha256,acceptedManifestSha256:digest(JSON.stringify(m[phase])),
})
describe('inert unpublication source proof', () => {
  it('uses closed unlocked publication fixtures without observed attempts', () => {
    const f = newTestOwnerUnpublicationFixture(original)
    expect(Object.isFrozen(f)).toBe(true)
    expect(f.tests.every(t => t.status === 'closed' && t.questions_locked_at === null)).toBe(true)
    expect(f).not.toHaveProperty('observedAttempts')
    expect(f.allocatedIds.length).toBe(new Set(f.allocatedIds).size)
  })
  it('binds actual current bytes to the externally fixed seal', () => {
    const name = TEST_OWNER_UNPUBLICATION_REVIEWED_MIGRATION.name, sql = readFileSync(`supabase/migrations/${name}`, 'utf8')
    expect(() => validateTestOwnerUnpublicationReviewedMigration({ name, sql, sha256: createHash('sha256').update(sql).digest('hex') })).not.toThrow()
    const m = testOwnerUnpublicationNativePlan(original, 'b'.repeat(40), process.cwd())
    expect(m.migrations).toHaveLength(261)
    expect(m.nativeVerified).toBe(false)
    for (const sql of [m.setup,m.snapshot,m.contracts.sql,...m.concurrency.schedules.flatMap(s=>[s.holderSql,s.rejectSql])]) {
      expect(validateTestOwnerUnpublicationNativePlanSql(m,sql)).toBe(true)
      expect(validateTestOwnerUnpublicationNativePlanSql(m,sql+'select 1;')).toBe(false)
    }
    expect(validateTestOwnerUnpublicationNativePlanSql(m,m.preparation)).toBe(false)
    expect(validateTestOwnerUnpublicationNativePlanSql(Object.freeze({...m,setup:'select 1;'}),'select 1;')).toBe(false)
  })
  it.each(['name', 'digest', 'bytes'])('rejects unreviewed %s and self-hashed substitution', defect => {
    const candidate = { name: TEST_OWNER_UNPUBLICATION_REVIEWED_MIGRATION.name, sql: 'select 1;', sha256: 'f'.repeat(64) }
    if (defect === 'name') candidate.name = '262_unknown.sql'
    if (defect === 'digest') candidate.sha256 = '0'.repeat(64)
    if (defect === 'bytes') candidate.sql += '\n'
    expect(() => validateTestOwnerUnpublicationReviewedMigration(candidate)).toThrow()
  })
  it('retains every requested matrix and holder source in the finite proof', () => {
    const sql = readFileSync('scripts/check-contextual-test-owner-unpublication.sql', 'utf8')
    for (const label of ['service-only-empty-search-path', 'private-core-service-denial', 'mixed-role-current-owner', 'canonical-published-source', 'whole-graph-preservation', 'idempotent-draft-full-equality', 'late-fault-atomic-rollback']) expect(sql).toContain(label)
    expect(sql).toContain('rollback;')
  })
  it.each(['gap','unknown262',...[253,254,255,256,257,258,259,260,261].flatMap(n=>[`name${n}`,`digest${n}`,`bytes${n}`,`selfhash${n}`])])('rejects altered complete actual source %s',defect=>{
    const inventory=platform.loadAssignmentListReviewedMigrations(process.cwd()).map(m=>({...m}))
    if(defect==='gap') inventory.splice(100,1)
    if(defect==='unknown262') inventory.push({name:'262_unknown.sql',sql:'select 1;',sha256:digest('select 1;')})
    for(const n of [253,254,255,256,257,258,259,260,261]){
      if(defect===`name${n}`) inventory[n-1].name=`${n}_unknown.sql`
      if(defect===`digest${n}`) inventory[n-1].sha256='f'.repeat(64)
      if(defect===`bytes${n}`||defect===`selfhash${n}`) inventory[n-1].sql+='\n'
      if(defect===`selfhash${n}`) inventory[n-1].sha256=digest(inventory[n-1].sql)
    }
    const loader=vi.spyOn(platform,'loadAssignmentListReviewedMigrations').mockReturnValueOnce(inventory)
    try{expect(plan).toThrow()}finally{loader.mockRestore()}
  })
  it('keeps engine caps, backend cancellation, restoration and no programmable selectors',()=>{
    const m=buildTestOwnerUnpublicationNativeContractsManifest(original,'b'.repeat(40),process.cwd())
    expect(m.capabilities).toMatchObject({sessions:2,totalMs:900000,controlCalls:4000,actions:200})
    expect(m.privilege.expectedEvidence).toEqual({status:503,rpcCalls:1,rawCode:'42501'})
    expect(m.termination).toContain('backend_start');expect(m.termination).toContain('owned_pid')
    expect(m.privilege.restore).toContain('grant execute');expect(m.setup).not.toMatch(/\b(?:insert|update|delete|commit)\b/i)
  })
  it('requires exact fixed receipts and closes sessions on success or failure',async()=>{
    const m=plan(),t=target(m,'contracts'),close=vi.fn(async()=>{}),execute=vi.fn(async()=>[{result:{checks:m.contracts.checks}}])
    const d:DraftSaveDriver={verifyTarget:vi.fn(async()=>t),openSession:vi.fn(async name=>({name,execute,rollbackAndClose:close}))}
    expect(await runTestOwnerUnpublicationNativeContracts(m,t,d)).toEqual({checks:m.contracts.checks,nativeVerified:false})
    execute.mockResolvedValueOnce([{result:{checks:[]}}]);await expect(runTestOwnerUnpublicationNativeContracts(m,t,d)).rejects.toThrow()
    expect(close).toHaveBeenCalledTimes(2);d.openSession=vi.fn()
    await expect(runTestOwnerUnpublicationNativeContracts(m,Object.freeze({...t,databasePort:54322}),d)).rejects.toThrow()
    await expect(runTestOwnerUnpublicationNativeContracts(Object.freeze({...m,sourceSha256:'0'.repeat(64)}),t,d)).rejects.toThrow()
    expect(d.openSession).not.toHaveBeenCalled()
  })
  it('validates reached-holder transaction/backend/scope receipts and closes both mock sessions',async()=>{
    const m=plan(),t=target(m,'concurrency'),close=vi.fn(async()=>{})
    const d:DraftSaveDriver={verifyTarget:vi.fn(async()=>t),openSession:vi.fn(async name=>({name,rollbackAndClose:close,execute:async sql=>{
      const s=m.concurrency.schedules.find(s=>s.holderSql===sql||s.rejectSql===sql)!
      return[{result:s.holderSql===sql?{held:true,transaction:true,scope:true,backend_pid:11,application_name:name,label:s.label,relation:s.relation}
        :{rejected:true,code:s.code,rows_unchanged:true,label:s.label}}]
    }}))}
    expect((await runTestOwnerUnpublicationNativeRaces(m,t,d)).outcomes).toHaveLength(m.concurrency.schedules.length)
    expect(close).toHaveBeenCalledTimes(2*m.concurrency.schedules.length)
    d.openSession=vi.fn(async name=>({name,rollbackAndClose:close,execute:async()=>[{result:{held:false}}]}))
    await expect(runTestOwnerUnpublicationNativeRaces(m,t,d)).rejects.toThrow();expect(close).toHaveBeenCalledTimes(2*m.concurrency.schedules.length+2)
  })
})
