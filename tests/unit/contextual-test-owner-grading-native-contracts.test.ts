import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerGradingFixture, testOwnerGradingRequest, validateTestOwnerGradingWitness } from '../../scripts/contextual-test-owner-grading-proof-fixture'
import { testOwnerGradingNativePlan, validateTestOwnerGradingNativePlanSql, runTestOwnerGradingNativeContracts, runTestOwnerGradingNativeRaces } from '../../scripts/contextual-test-owner-grading-native-contracts'
import type { DraftSaveDriver, DraftSaveTarget } from '../../scripts/check-contextual-test-draft-save-db-contracts'
import { buildTestOwnerGradingNativeContractsManifest, createTestOwnerGradingNativeContracts } from '../../scripts/contextual-test-draft-save-native-contracts'

// A synthetic seal exercises the driver contract without blessing unfinished258
// bytes. The actual migration inventory and all native execution remain held.
const mockSource=vi.hoisted(()=>({enabled:false,sql:'-- synthetic mock258\n'}))
vi.mock('node:fs',async importOriginal=>{
  const actual=await importOriginal<typeof import('node:fs')>()
  return {...actual,readFileSync:(...args:Parameters<typeof actual.readFileSync>)=>mockSource.enabled&&String(args[0]).endsWith('/258_contextual_test_owner_grading.sql')?mockSource.sql:actual.readFileSync(...args)}
})
vi.mock('../../scripts/contextual-assignment-list-proof-platform',async importOriginal=>{
  const actual=await importOriginal<typeof import('../../scripts/contextual-assignment-list-proof-platform')>()
  return {...actual,loadAssignmentListReviewedMigrations:(repository:string)=>mockSource.enabled?Array.from({length:258},(_,i)=>({
    name:i===257?'258_contextual_test_owner_grading.sql':`${String(i+1).padStart(3,'0')}_mock.sql`,sql:mockSource.sql,
    sha256:createHash('sha256').update(mockSource.sql).digest('hex'),
  })):actual.loadAssignmentListReviewedMigrations(repository)}
})
vi.mock('../../scripts/test-owner-grading-reviewed-migration',async importOriginal=>{
  const actual=await importOriginal<typeof import('../../scripts/test-owner-grading-reviewed-migration')>()
  const {createHash:sha}=await import('node:crypto')
  return {TEST_OWNER_GRADING_REVIEWED_MIGRATION:{name:actual.TEST_OWNER_GRADING_REVIEWED_MIGRATION.name,
    get sha256(){return mockSource.enabled?sha('sha256').update(mockSource.sql).digest('hex'):actual.TEST_OWNER_GRADING_REVIEWED_MIGRATION.sha256}},
    validateTestOwnerGradingReviewedMigration:(migration:{name:string;sql:string;sha256:string})=>{
      if(!mockSource.enabled)return actual.validateTestOwnerGradingReviewedMigration(migration)
      expect(migration.name).toBe(actual.TEST_OWNER_GRADING_REVIEWED_MIGRATION.name)
      expect(migration.sql).toBe(mockSource.sql);expect(migration.sha256).toBe(sha('sha256').update(mockSource.sql).digest('hex'))
    }}
})
afterEach(()=>{mockSource.enabled=false})

const original = newAssignmentListProofFixture(new Date('2026-10-10T12:00:00Z'))
const fixture = newTestOwnerGradingFixture(original)
const observed = Object.freeze([1,2].map(i => Object.freeze({ actorId: fixture.actors[i].id, attemptId: randomUUID(), revision: 1 })))
const plan = () => testOwnerGradingNativePlan(original, observed, 'b'.repeat(40), process.cwd())
const sealedMockPlan=()=>{mockSource.enabled=true;return testOwnerGradingNativePlan(original,observed,'b'.repeat(40),process.cwd())}
const targetFor = (m: ReturnType<typeof plan>, phase: 'contracts'|'concurrency'): DraftSaveTarget => Object.freeze({
  projectId:m.projectId,containerProjectLabel:m.projectId,apiUrl:'http://127.0.0.1:54331',databaseHost:'127.0.0.1',databasePort:54332,
  containerId:'a'.repeat(64),disposable:true,reviewedHead:m.reviewedHead,migrationManifestSha256:m.migrationManifestSha256,
  reviewedSourceSha256:m.sourceSha256,acceptedManifestSha256:createHash('sha256').update(JSON.stringify(m[phase])).digest('hex'),
})

describe('inert contextual owner grading proof', () => {
  it('reuses the learner fixture and requires real observed attempt identities', () => {
    expect(fixture.actors.map(row=>row.role)).toEqual(['student','teacher','student','teacher'])
    expect(fixture.responses).toHaveLength(4)
    expect(fixture.nativeVerified).toBe(false)
    expect(()=>testOwnerGradingNativePlan(original,[...observed],'b'.repeat(40),process.cwd())).toThrow()
    expect(()=>testOwnerGradingNativePlan(original,Object.freeze([observed[0],observed[0]]),'b'.repeat(40),process.cwd())).toThrow()
  })
  it('binds original Test, operation, subject and response revision in requests', () => {
    const test = Object.freeze({id:fixture.testId,classroom_id:fixture.classroomId})
    const request = testOwnerGradingRequest(fixture,'manual-save',test,'2026-10-10T12:00:30.000Z')
    expect(request.p_expected_test).toBe(test)
    expect(request.p_payload).toEqual({student_id:fixture.actors[1].id,grades:[{response_id:fixture.responses[0].id,
      question_id:fixture.questions[0].id,expected_response_revision:1,clear_grade:false,score:0,feedback:'Synthetic manual feedback'}]})
    const result={student_id:fixture.actors[1].id,saved_count:1,cleared_count:0,clear_context:[],responses:[{id:fixture.responses[0].id,revision:2,score:0,feedback:'Synthetic manual feedback'}]}
    const raw={version:1,actor_id:fixture.actors[0].id,classroom_id:fixture.classroomId,test_id:fixture.testId,operation:'manual-save',test,result}
    expect(validateTestOwnerGradingWitness(fixture,request,raw).result).toEqual(result)
    for (const bad of [{...raw,actor_id:fixture.actors[1].id},{...raw,operation:'return'},
      {...raw,result:{...result,responses:[{...result.responses[0],revision:0}]}}, {...raw,result:{...result,saved_count:2}}])
      expect(()=>validateTestOwnerGradingWitness(fixture,request,bad)).toThrow()
  })
  it('accepts only literal false and exact return count accounting', () => {
    const test={id:fixture.testId,classroom_id:fixture.classroomId},request=testOwnerGradingRequest(fixture,'return',test,'2026-10-10T12:00:30.000Z')
    const raw={version:1,actor_id:fixture.actors[0].id,classroom_id:fixture.classroomId,test_id:fixture.testId,operation:'return',test,
      result:{student_ids:[fixture.actors[1].id,fixture.actors[2].id],returned_count:1,already_returned_count:0,skipped_count:1,test_closed:false}}
    expect(validateTestOwnerGradingWitness(fixture,request,raw).result).toEqual(raw.result)
    expect(()=>validateTestOwnerGradingWitness(fixture,request,{...raw,result:{...raw.result,test_closed:true}})).toThrow()
    expect(()=>validateTestOwnerGradingWitness(fixture,request,{...raw,result:{...raw.result,skipped_count:0}})).toThrow()
  })
  it('validates clear subset counts and permits inherited unchanged revisions',()=>{
    const test={id:fixture.testId,classroom_id:fixture.classroomId}
    const request=testOwnerGradingRequest(fixture,'manual-save',test,'2026-10-10T12:00:30.000Z')
    const clearRequest=Object.freeze({...request,p_payload:Object.freeze({student_id:fixture.actors[1].id,grades:Object.freeze([
      Object.freeze({...request.p_payload.grades![0],clear_grade:true,score:null,feedback:null}),
    ])})})
    const raw={version:1,actor_id:fixture.actors[0].id,classroom_id:fixture.classroomId,test_id:fixture.testId,operation:'manual-save',test,
      result:{student_id:fixture.actors[1].id,saved_count:1,cleared_count:1,clear_context:[{response_id:fixture.responses[0].id,question_id:fixture.questions[0].id,question_type:'open_response',selected_option:null}],responses:[{id:fixture.responses[0].id,revision:1,score:null,feedback:null}]}}
    expect(validateTestOwnerGradingWitness(fixture,clearRequest,raw).result).toEqual(raw.result)
    expect(()=>validateTestOwnerGradingWitness(fixture,clearRequest,{...raw,result:{...raw.result,cleared_count:0}})).toThrow()
    expect(()=>validateTestOwnerGradingWitness(fixture,clearRequest,{...raw,result:{...raw.result,clear_context:[]}})).toThrow()
    expect(()=>validateTestOwnerGradingWitness(fixture,clearRequest,{...raw,result:{...raw.result,clear_context:[{...raw.result.clear_context[0],question_type:'multiple_choice',selected_option:0}],responses:[{...raw.result.responses[0],score:0}]}})).toThrow()
  })
  it('binds answered MC clear normalization to the exact fixed response/question',()=>{
    const test={id:fixture.testId,classroom_id:fixture.classroomId},request=testOwnerGradingRequest(fixture,'manual-save',test,'2026-10-10T12:00:30.000Z')
    const clear=Object.freeze({...request,p_payload:Object.freeze({student_id:null,grades:Object.freeze([{response_id:fixture.responses[1].id,question_id:fixture.questions[1].id,expected_response_revision:1,clear_grade:true,score:null,feedback:null}])})})
    const result={student_id:null,saved_count:1,cleared_count:1,clear_context:[{response_id:fixture.responses[1].id,question_id:fixture.questions[1].id,question_type:'multiple_choice',selected_option:0}],responses:[{id:fixture.responses[1].id,revision:2,score:0,feedback:null}]}
    const raw={version:1,actor_id:fixture.actors[0].id,classroom_id:fixture.classroomId,test_id:fixture.testId,operation:'manual-save',test,result}
    expect(validateTestOwnerGradingWitness(fixture,clear,raw).result).toEqual(result)
    for(const changed of [{...result,clear_context:[{...result.clear_context[0],question_id:fixture.questions[0].id}]},
      {...result,clear_context:[{...result.clear_context[0],selected_option:null}]},
      {...result,responses:[{...result.responses[0],score:null}]},
      {...result,clear_context:[...result.clear_context,...result.clear_context]}])
      expect(()=>validateTestOwnerGradingWitness(fixture,clear,{...raw,result:changed})).toThrow()
  })
  it('keeps result collections on exactly the current nonowner roster', () => {
    const test={id:fixture.testId,classroom_id:fixture.classroomId},request=testOwnerGradingRequest(fixture,'results',test,'2026-10-10T12:00:30.000Z')
    const result={questions:fixture.questions.map(row=>({id:row.id,test_id:fixture.testId})),student_ids:fixture.actors.slice(1,3).map(row=>row.id),responses:[],attempts:[],users:fixture.actors.slice(1,3).map(row=>({id:row.id,email:row.email})),profiles:[],focus_events:[],availability:[],active_ai_grading_run:null}
    const raw={version:1,actor_id:fixture.actors[0].id,classroom_id:fixture.classroomId,test_id:fixture.testId,operation:'results',test,result}
    expect(validateTestOwnerGradingWitness(fixture,request,raw).result).toEqual(result)
    expect(()=>validateTestOwnerGradingWitness(fixture,request,{...raw,result:{...result,student_ids:[fixture.actors[0].id]}})).toThrow()
    expect(()=>validateTestOwnerGradingWitness(fixture,request,{...raw,result:{...result,responses:[{student_id:fixture.actors[3].id}]}})).toThrow()
  })
  it('ships rollback-only SQL assertions bound to the coordinator source candidate', () => {
    const m=plan(),sql=readFileSync('scripts/check-contextual-test-owner-grading.sql','utf8')
    expect(m.nativeVerified).toBe(false);expect(m.sourceSha256).toMatch(/^[a-f0-9]{64}$/);expect(m.migrations).toHaveLength(258)
    expect(sql).toContain('rollback;');expect(sql).not.toMatch(/\bcommit\s*;/i)
    for(const text of m.contracts.checks) expect(sql).toContain(text)
    expect(sql).toContain("repeat('x',1200000)")
    expect(sql).toContain('repeat(chr(1),180000)')
    expect(sql).not.toMatch(/delete\s+from\s+public\.test_questions/i)
    expect(sql).toContain("empty_test_id uuid:='a2580000-0000-4000-8000-000000000012'")
    expect(sql).toContain("'Initially empty owner grading'")
    expect(m.contracts.sql).toContain(fixture.emptyTestId)
    expect(m.contracts.sql).toContain(fixture.emptyAttemptIds[0])
    expect(m.contracts.sql).toContain(fixture.emptyAttemptIds[1])
    expect(fixture.allocatedIds).toContain(fixture.emptyTestId)
    expect(fixture.emptyAttemptIds.every(id=>fixture.allocatedIds.includes(id))).toBe(true)
    expect(m.snapshot).toContain(fixture.emptyTestId)
    expect(m.setup).not.toMatch(/\b(?:insert|update|delete|commit)\b/i)
    for(const sql of [m.setup,m.snapshot,m.contracts.sql,...m.concurrency.schedules.flatMap(s=>[s.holderSql,s.rejectSql])]) {
      expect(validateTestOwnerGradingNativePlanSql(m,sql)).toBe(true)
      expect(validateTestOwnerGradingNativePlanSql(m,sql+' select 1;')).toBe(false)
    }
    const forged=Object.freeze({...m,setup:'select 1;'})
    expect(validateTestOwnerGradingNativePlanSql(forged,forged.setup)).toBe(false)
  })
  it('cannot dispatch a forged source candidate even with a matching mock target', async () => {
    const m=plan(),open=vi.fn(),driver:DraftSaveDriver={verifyTarget:vi.fn(async()=>targetFor(m,'contracts')),openSession:open}
    const forged=Object.freeze({...m,sourceSha256:'0'.repeat(64)})
    await expect(runTestOwnerGradingNativeContracts(forged,targetFor(m,'contracts'),driver)).rejects.toThrow()
    await expect(runTestOwnerGradingNativeRaces(forged,targetFor(m,'concurrency'),driver)).rejects.toThrow()
    expect(open).not.toHaveBeenCalled()
  })
  it('validates every finite holder and closes both mock sessions', async()=>{
    const m=sealedMockPlan(),target=targetFor(m,'concurrency'),closed=vi.fn(async()=>{}),dispatched:string[]=[]
    const driver:DraftSaveDriver={verifyTarget:vi.fn(async()=>target),openSession:vi.fn(async name=>({name,rollbackAndClose:closed,execute:vi.fn(async sql=>{
      dispatched.push(sql);const s=m.concurrency.schedules.find(s=>s.holderSql===sql||s.rejectSql===sql)!
      return[{result:sql===s.holderSql?{held:true,transaction:true,scope:true,backend_pid:11,application_name:name,label:s.label,relation:s.relation}
        :{rejected:true,code:s.code,rows_unchanged:true,label:s.label}}]
    })}))}
    const receipt=await runTestOwnerGradingNativeRaces(m,target,driver)
    expect(receipt.outcomes).toHaveLength(12);expect(dispatched).toHaveLength(24);expect(closed).toHaveBeenCalledTimes(24)
    expect(receipt.nativeVerified).toBe(false)
  })
  it('rejects forged holder results, target drift and unconfirmed close',async()=>{
    const m=sealedMockPlan(),target=targetFor(m,'concurrency'),close=vi.fn(async()=>{}),execute=vi.fn(async()=>[{result:{held:false}}])
    const driver:DraftSaveDriver={verifyTarget:vi.fn(async()=>target),openSession:vi.fn(async name=>({name,execute,rollbackAndClose:close}))}
    await expect(runTestOwnerGradingNativeRaces(m,target,driver)).rejects.toThrow();expect(close).toHaveBeenCalledTimes(2)
    close.mockRejectedValueOnce(new Error('termination unconfirmed'))
    await expect(runTestOwnerGradingNativeRaces(m,target,driver)).rejects.toThrow('termination unconfirmed')
    driver.openSession=vi.fn();await expect(runTestOwnerGradingNativeRaces(m,Object.freeze({...target,databasePort:54322}),driver)).rejects.toThrow()
    expect(driver.openSession).not.toHaveBeenCalled()
  })
  it('requires exact contract receipts and always closes the single mock session',async()=>{
    const m=sealedMockPlan(),target=targetFor(m,'contracts'),close=vi.fn(async()=>{}),execute=vi.fn(async()=>[{result:{checks:m.contracts.checks}}])
    const driver:DraftSaveDriver={verifyTarget:vi.fn(async()=>target),openSession:vi.fn(async name=>({name,execute,rollbackAndClose:close}))}
    expect(await runTestOwnerGradingNativeContracts(m,target,driver)).toEqual({checks:m.contracts.checks,nativeVerified:false})
    execute.mockResolvedValueOnce([{result:{checks:[]}}]);await expect(runTestOwnerGradingNativeContracts(m,target,driver)).rejects.toThrow()
    expect(close).toHaveBeenCalledTimes(2)
    vi.mocked(driver.verifyTarget).mockResolvedValueOnce(Object.freeze({...target,containerId:'c'.repeat(64)}))
    await expect(runTestOwnerGradingNativeContracts(m,target,driver)).rejects.toThrow();expect(execute).toHaveBeenCalledTimes(2)
  })
  it('reuses a fixed factory and denies all probes before setup',async()=>{
    mockSource.enabled=true
    const manifest=buildTestOwnerGradingNativeContractsManifest(original,observed,'b'.repeat(40),process.cwd())
    const factory=createTestOwnerGradingNativeContracts({repository:process.cwd(),original,observedAttempts:observed,reviewedHead:'b'.repeat(40),
      containerId:'a'.repeat(64),capturedResources:[],absoluteDeadline:Date.now()+60000,
      acceptedManifestSha256:createHash('sha256').update(JSON.stringify(manifest)).digest('hex')})
    expect(Object.keys(factory).sort()).toEqual(['diagnostic','manifest','probeOwnerGradingPrivilegeDrift','run','setup','verifyTarget'])
    expect(factory.manifest.privilege.revoke).toContain('test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamp with time zone)')
    const callback=vi.fn();await expect(factory.probeOwnerGradingPrivilegeDrift(callback)).rejects.toThrow();expect(callback).not.toHaveBeenCalled()
    await expect(factory.run()).rejects.toThrow()
  })
})
