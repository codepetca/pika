import * as fs from 'node:fs'
import { validateStudentTestSessionStatusReviewedMigration } from '../../scripts/student-test-session-status-reviewed-migration'
import { validateTestOwnerGradingReviewedMigration } from '../../scripts/test-owner-grading-reviewed-migration'
import { validateTestOwnerRecoveryReviewedMigration } from '../../scripts/test-owner-recovery-reviewed-migration'
import { validateTestOwnerUnpublicationReviewedMigration } from '../../scripts/test-owner-unpublication-reviewed-migration'
import { validateTestOwnerDeletionReviewedMigration } from '../../scripts/test-owner-deletion-reviewed-migration'
import { validateTestCalendarDateReviewedMigration } from '../../scripts/test-calendar-date-reviewed-migration'
import { validateTestAiGradingSavedWorkReviewedMigration } from '../../scripts/test-ai-grading-saved-work-reviewed-migration'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerGradingFixture, testOwnerGradingRequest, validateTestOwnerGradingWitness } from '../../scripts/contextual-test-owner-grading-proof-fixture'
import { testOwnerGradingNativePlan, validateTestOwnerGradingNativePlanSql, runTestOwnerGradingNativeContracts, runTestOwnerGradingNativeRaces } from '../../scripts/contextual-test-owner-grading-native-contracts'
import type { DraftSaveDriver, DraftSaveTarget } from '../../scripts/check-contextual-test-draft-save-db-contracts'
import { buildTestOwnerGradingNativeContractsManifest, createTestOwnerGradingNativeContracts } from '../../scripts/contextual-test-draft-save-native-contracts'
import * as platform from '../../scripts/contextual-assignment-list-proof-platform'

// A synthetic seal exercises the driver contract without blessing candidate259
// bytes. The actual migration inventory and all native execution remain held.
const mockSource=vi.hoisted(()=>({enabled:false,sql:'-- synthetic mock259\n'}))
vi.mock('node:fs',async importOriginal=>{
  const actual=await importOriginal<typeof import('node:fs')>()
  return {...actual,readFileSync:(...args:Parameters<typeof actual.readFileSync>)=>mockSource.enabled&&String(args[0]).endsWith('/259_contextual_test_owner_grading.sql')?mockSource.sql:actual.readFileSync(...args)}
})
vi.mock('../../scripts/contextual-assignment-list-proof-platform',async importOriginal=>{
  const actual=await importOriginal<typeof import('../../scripts/contextual-assignment-list-proof-platform')>()
  return {...actual,loadAssignmentListReviewedMigrations:(repository:string)=>actual.loadAssignmentListReviewedMigrations(repository).map(migration=>
    mockSource.enabled&&migration.name==='259_contextual_test_owner_grading.sql'?{...migration,sql:mockSource.sql,
      sha256:createHash('sha256').update(mockSource.sql).digest('hex')}:migration)}
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
  it.each(['projection258-only', 'bad262name', 'bad262digest', 'bad262bytes', 'self-hashed262bytes', 'bad261name', 'bad261digest', 'bad261bytes', 'self-hashed261bytes', 'future268', 'missing258', 'replaced258', 'bad258name', 'bad258digest', 'bad258bytes', 'self-hashed258bytes',
    'bad259name', 'bad259digest', 'bad259bytes', 'self-hashed259bytes', 'bad260name', 'bad260digest', 'bad260bytes', 'self-hashed260bytes'] as const)('refuses incomplete or altered owner source profile %s', defect => {
    const migrations = platform.loadAssignmentListReviewedMigrations(process.cwd()).map(migration => ({ ...migration }))
    const digest = (sql: string) => createHash('sha256').update(sql).digest('hex')
    if (defect === 'projection258-only') migrations.splice(258)
    if (defect === 'future268') migrations.push({ name: '268_unknown.sql', sql: 'select 1;', sha256: digest('select 1;') })
    if (defect === 'missing258') migrations.splice(257, 1)
    if (defect === 'replaced258') migrations[257] = { ...migrations[258], name: '258_student_test_session_status_projection.sql' }
    for (const [number, index] of [[258, 257], [259, 258], [260, 259], [261, 260], [262, 261]] as const) {
      const tail = migrations[index]
      if (defect === `bad${number}name`) tail.name = `${number}_unknown.sql`
      if (defect === `bad${number}digest`) tail.sha256 = 'f'.repeat(64)
      if (defect === `bad${number}bytes` || defect === `self-hashed${number}bytes`) tail.sql += '\n'
      if (defect === `self-hashed${number}bytes`) tail.sha256 = digest(tail.sql)
    }
    const loader = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValueOnce(migrations)
    try { expect(plan).toThrow() }
    finally { loader.mockRestore() }
  })
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
    expect(m.nativeVerified).toBe(false);expect(m.sourceSha256).toMatch(/^[a-f0-9]{64}$/);expect(m.migrations).toHaveLength(267)
    expect(m.migrations[257]).toEqual({name:'258_student_test_session_status_projection.sql',sha256:'7e251740234687bfc9a429e9268e1edb6b331016474a96f3a2a0fe82e718737f'})
    expect(m.migrations[258]).toEqual({name:'259_contextual_test_owner_grading.sql',sha256:'698948d58fabdceb9df2869dfa99dc3cd22be6640a198da6de31b17fb9fa3540'})
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
  it('moves a parent with its matching category and proves full-row rollback restoration', () => {
    const sql=readFileSync('scripts/check-contextual-test-owner-grading.sql','utf8')
    const parent=sql.slice(sql.indexOf('-- category-consistent-parent-change'),sql.indexOf('-- category-consistent-parent-end'))
    expect(parent).toContain('select to_jsonb(t) into parent_before')
    expect(parent).toContain('select id into strict wrong_category from public.gradebook_categories')
    expect(parent).toContain('where classroom_id=wrong_class and is_default')
    expect(parent).toContain('set classroom_id=wrong_class,gradebook_category_id=wrong_category')
    expect(parent).toContain("exception when sqlstate 'PT409' then null")
    expect(parent).toContain('is distinct from parent_before')
    expect(parent).toContain("raise exception 'Changed parent rollback restoration differs'")
    expect(plan().contracts.sql).toContain(parent)
    expect(sql).not.toContain('set classroom_id=wrong_class where id=test_id')
    expect(sql).not.toMatch(/disable\s+trigger|session_replication_role/i)
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

describe('complete reviewed267 source profile (offline)', () => {
  it.each([265, 266, 267])('accepts exact source profile %i for the current native grading harness', count => {
    const migrations = platform.loadAssignmentListReviewedMigrations(process.cwd()).slice(0, count)
    const spy = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
    try { expect(() => plan()).not.toThrow() } finally { spy.mockRestore() }
  })
  it.each([259, 260, 261, 262, 263, 264])('refuses historical native profile %i before reading the265 harness', count => {
    const migrations = platform.loadAssignmentListReviewedMigrations(process.cwd()).slice(0, count)
    const loader = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
    const reads = vi.spyOn(fs, 'readFileSync')
    try {
      expect(() => plan()).toThrow('Owner grading native proof requires the exact migration265 profile')
      expect(reads.mock.calls.some(([path]) => String(path).endsWith('/scripts/check-contextual-test-owner-grading.sql'))).toBe(false)
    } finally { reads.mockRestore(); loader.mockRestore() }
  })
  it.each([259, 260, 261, 262, 263, 264])('retains exact predecessor source seals independently of retired native profile %i', count => {
    const migrations = platform.loadAssignmentListReviewedMigrations(process.cwd()).slice(0, count)
    const seals = [
      [258, validateStudentTestSessionStatusReviewedMigration], [259, validateTestOwnerGradingReviewedMigration],
      [260, validateTestOwnerRecoveryReviewedMigration], [261, validateTestOwnerUnpublicationReviewedMigration],
      [262, validateTestOwnerDeletionReviewedMigration], [263, validateTestCalendarDateReviewedMigration],
      [264, validateTestAiGradingSavedWorkReviewedMigration],
    ] as const
    for (const [number, validate] of seals) if (number <= count) {
      expect(() => validate(migrations[number - 1])).not.toThrow()
      const sql = migrations[number - 1].sql + '\n'
      expect(() => validate({ ...migrations[number - 1], sql, sha256: createHash('sha256').update(sql).digest('hex') })).toThrow()
    }
  })
  it.each([263, 264, 265, 266, 267].flatMap(number => ['name', 'digest', 'bytes', 'self-hashed-bytes'].map(defect => ({ number, defect }))))('rejects altered migration $number: $defect', ({ number, defect }) => {
    const migrations = platform.loadAssignmentListReviewedMigrations(process.cwd()).map(migration => ({ ...migration }))
    const tail = migrations[number - 1]
    if (defect === 'name') tail.name = `${number}_unknown.sql`
    if (defect === 'digest') tail.sha256 = 'f'.repeat(64)
    if (defect === 'bytes' || defect === 'self-hashed-bytes') tail.sql += '\n'
    if (defect === 'self-hashed-bytes') tail.sha256 = createHash('sha256').update(tail.sql).digest('hex')
    const loader = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
    try { expect(() => plan()).toThrow() } finally { loader.mockRestore() }
  })
  it('rejects a contiguous unknown268 source tail', () => {
    const migrations = platform.loadAssignmentListReviewedMigrations(process.cwd()).map(migration => ({ ...migration }))
    migrations.push({ name: '268_unknown.sql', sql: 'select 1;', sha256: createHash('sha256').update('select 1;').digest('hex') })
    const loader = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
    try { expect(() => plan()).toThrow() } finally { loader.mockRestore() }
  })
})
