import { createHash, randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestLearnerWorkflowFixture } from '../../scripts/contextual-test-learner-proof-fixture'
import { testLearnerNativePlan, validateTestLearnerNativePlanSql, runTestLearnerNativeContracts, runTestLearnerNativeRaces } from '../../scripts/contextual-test-learner-native-contracts'
import type { DraftSaveDriver, DraftSaveTarget } from '../../scripts/check-contextual-test-draft-save-db-contracts'
import { buildTestLearnerNativeContractsManifest, createTestLearnerNativeContracts } from '../../scripts/contextual-test-draft-save-native-contracts'

const original = newAssignmentListProofFixture(new Date('2026-10-10T12:00:00Z'))
const fixture = newTestLearnerWorkflowFixture(original)
const observed = Object.freeze([1,2].map(index => Object.freeze({ actorId: fixture.actors[index].id, attemptId: randomUUID(), revision: 1 })))
const plan = () => testLearnerNativePlan(original, observed, 'b'.repeat(40), process.cwd())
const targetFor = (manifest: ReturnType<typeof plan>, phase: 'contracts'|'concurrency'): DraftSaveTarget => Object.freeze({
  projectId: manifest.projectId, containerProjectLabel: manifest.projectId, apiUrl: 'http://127.0.0.1:54331',
  databaseHost: '127.0.0.1', databasePort: 54332, containerId: 'a'.repeat(64), disposable: true,
  reviewedHead: manifest.reviewedHead, migrationManifestSha256: manifest.migrationManifestSha256,
  reviewedSourceSha256: manifest.sourceSha256, acceptedManifestSha256: createHash('sha256').update(JSON.stringify(manifest[phase])).digest('hex'),
})

describe('closed learner native profile source', () => {
  it('derives the mixed-role fixture and presence-checks rather than seeding a predecessor', () => {
    const m = plan()
    expect(m.fixture).toEqual(fixture)
    expect(m.sourceSha256).toBe('d4f12d17b79e4800e5bdd6ea7db2c0fee7cf51d19a5dfde93084c243b22c1e2a')
    expect(m.migrations).toHaveLength(258)
    expect(m.migrations.at(-1)).toEqual({ name: '258_contextual_test_owner_grading.sql',
      sha256: '698948d58fabdceb9df2869dfa99dc3cd22be6640a198da6de31b17fb9fa3540' })
    expect(m.setup).not.toMatch(/\b(?:insert|update|delete|commit)\b/i)
    expect(m.setup).toContain('Migration257 learner fixture presence differs')
    expect(m.nativeVerified).toBe(false)
    expect(Object.isFrozen(m.concurrency.schedules)).toBe(true)
  })
  it('rejects preallocated, duplicate, wrong-actor and mutable first-Start ledgers', () => {
    for (const bad of [observed.slice(0,1), [{ ...observed[0], attemptId: fixture.attemptId }, observed[1]],
      [observed[0], { ...observed[1], attemptId: observed[0].attemptId }],
      [{ ...observed[0], actorId: fixture.actors[0].id }, observed[1]]])
      expect(() => testLearnerNativePlan(original, Object.freeze(bad.map(row=>Object.freeze(row))), 'b'.repeat(40), process.cwd())).toThrow()
    expect(() => testLearnerNativePlan(original, [...observed], 'b'.repeat(40), process.cwd())).toThrow()
  })
  it('admits only complete fixed SQL frames, with restoration reserved to the engine', () => {
    const m = plan()
    const frames = [m.setup,m.snapshot,m.contracts.sql,m.cancellation.catalog,m.cancellation.install,m.cancellation.installed,
      ...m.concurrency.schedules.flatMap(row=>[row.holderSql,row.rejectSql])]
    for (const sql of frames) {
      expect(validateTestLearnerNativePlanSql(m,sql)).toBe(true)
      expect(validateTestLearnerNativePlanSql(m,sql+' select 1;')).toBe(false)
    }
    expect(validateTestLearnerNativePlanSql(m,m.cancellation.restore)).toBe(false)
    expect(validateTestLearnerNativePlanSql(m,'delete from public.users;')).toBe(false)
    expect(m.concurrency.schedules.map(row=>row.label)).toEqual(['test-advisory','classroom','test','enrollment','attempt','history','document-object','save-competitor','submit-competitor','history-cas-competitor'])
    expect(m.contracts.sql).toContain('same-attempt-save-cas')
    expect(m.contracts.sql).toContain('same-attempt-submit-cas')
    expect(m.contracts.sql).toContain('same-attempt-history-cas')
    // Global sequence allocations and cancelled writes can leave gaps.
    expect(m.contracts.sql).toContain(`'draft_revision')::bigint>${observed[0].revision},false)`)
    expect(m.contracts.sql).not.toContain(`'draft_revision')::bigint is distinct from ${observed[0].revision+1}`)
    expect(m.cancellation.install).toContain('pg_catalog.pg_sleep(9)')
    expect(m.cancellation.install).toContain(observed[0].attemptId)
    expect(m.cancellation.install).not.toContain('pg_sleep(1)')
    expect(Object.keys(m.cancellation.payload.responses).sort()).toEqual(fixture.questions.map(row=>row.id).sort())
    expect(m.setup).toContain('object.content_type is null')
    expect(m.setup).toContain("document->>'managed_object_id'")
    expect(m.snapshot).toContain("from storage.objects r where bucket_id='test-documents'")
    const forged=Object.freeze({...m,setup:'delete from public.users;'})
    expect(validateTestLearnerNativePlanSql(forged,forged.setup)).toBe(false)
    expect(validateTestLearnerNativePlanSql(Object.freeze({...m,contracts:Object.freeze({...m.contracts,sql:'select 1;'})}),'select 1;')).toBe(false)
  })
  it('validates exact outcomes and closes both sessions on each finite race', async () => {
    const m = plan(), target = targetFor(m,'concurrency'), closed = vi.fn(async()=>{}), dispatched: string[]=[]
    const driver: DraftSaveDriver={verifyTarget:vi.fn(async()=>target),openSession:vi.fn(async name=>({name,rollbackAndClose:closed,
      execute:vi.fn(async sql=>{dispatched.push(sql);const schedule=m.concurrency.schedules.find(row=>row.holderSql===sql||row.rejectSql===sql)!
        return [{result:sql===schedule.holderSql?{held:true,transaction:true,scope:true,backend_pid:11,application_name:name,label:schedule.label,relation:schedule.relation}
          :{rejected:true,code:'PT409',rows_unchanged:true,label:schedule.label}}]})}))}
    const receipt=await runTestLearnerNativeRaces(m,target,driver)
    expect(receipt.outcomes).toHaveLength(10);expect(dispatched).toHaveLength(20);expect(closed).toHaveBeenCalledTimes(20)
    expect(receipt.nativeVerified).toBe(false)
  })
  it('does not accept holder flags, unknown outcomes, drift or incomplete termination', async () => {
    const m=plan(),target=targetFor(m,'concurrency'),close=vi.fn(async()=>{}),execute=vi.fn(async()=>[{result:{held:false}}])
    const d:DraftSaveDriver={verifyTarget:vi.fn(async()=>target),openSession:vi.fn(async name=>({name,execute,rollbackAndClose:close}))}
    await expect(runTestLearnerNativeRaces(m,target,d)).rejects.toThrow();expect(close).toHaveBeenCalledTimes(2)
    close.mockRejectedValueOnce(new Error('termination unconfirmed'))
    await expect(runTestLearnerNativeRaces(m,target,d)).rejects.toThrow('termination unconfirmed')
    d.openSession=vi.fn();await expect(runTestLearnerNativeRaces(m,Object.freeze({...target,acceptedManifestSha256:'0'.repeat(64)}),d)).rejects.toThrow()
    expect(d.openSession).not.toHaveBeenCalled()
  })
  it('settles the single contract session after a bad CAS witness', async () => {
    const m=plan(),target=targetFor(m,'contracts'),close=vi.fn(async()=>{})
    const d:DraftSaveDriver={verifyTarget:vi.fn(async()=>target),openSession:vi.fn(async name=>({name,execute:vi.fn(async()=>[{result:{checks:[]}}]),rollbackAndClose:close}))}
    await expect(runTestLearnerNativeContracts(m,target,d)).rejects.toThrow();expect(close).toHaveBeenCalledOnce()
  })
  it('accepts the exact CAS checks and rejects target drift before dispatch', async () => {
    const m=plan(),target=targetFor(m,'contracts'),close=vi.fn(async()=>{}),execute=vi.fn(async()=>[{result:{checks:m.contracts.checks}}])
    const d:DraftSaveDriver={verifyTarget:vi.fn(async()=>target),openSession:vi.fn(async name=>({name,execute,rollbackAndClose:close}))}
    expect(await runTestLearnerNativeContracts(m,target,d)).toEqual({checks:m.contracts.checks,nativeVerified:false})
    expect(close).toHaveBeenCalledOnce()
    vi.mocked(d.verifyTarget).mockResolvedValue(Object.freeze({...target,databasePort:54322}))
    await expect(runTestLearnerNativeContracts(m,target,d)).rejects.toThrow();expect(execute).toHaveBeenCalledOnce()
  })
  it('exports one fixed factory facade and requires setup before any SDK callback', async () => {
    const manifest=buildTestLearnerNativeContractsManifest(original,observed,'b'.repeat(40),process.cwd())
    const factory=createTestLearnerNativeContracts({repository:process.cwd(),original,observedAttempts:observed,reviewedHead:'b'.repeat(40),
      containerId:'a'.repeat(64),capturedResources:[],absoluteDeadline:Date.now()+60000,
      acceptedManifestSha256:createHash('sha256').update(JSON.stringify(manifest)).digest('hex')})
    expect(Object.keys(factory).sort()).toEqual(['diagnostic','manifest','probeLearnerCancellation','probeLearnerPrivilegeDrift','run','setup','verifyTarget'])
    expect(factory.manifest.privilege.revoke).toContain('test_learner_workflow_v1(uuid,uuid,uuid,text,jsonb,timestamp with time zone)')
    expect(factory.manifest.bootstrap).toContain("set statement_timeout='8s'")
    expect(factory.manifest.termination).toContain("backend_start=:'owned_started'::timestamptz")
    const callback=vi.fn()
    await expect(factory.probeLearnerCancellation(callback)).rejects.toThrow();expect(callback).not.toHaveBeenCalled()
    await expect(factory.probeLearnerPrivilegeDrift(callback)).rejects.toThrow();expect(callback).not.toHaveBeenCalled()
    await expect(factory.run()).rejects.toThrow()
  })
})
