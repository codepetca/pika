/** Offline source/driver checks; reads the same fixed owning checkouts as the
 * existing remaining269 carrier tests. No native SQL or process dispatch. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { SURVEY_269_COMPONENT_ROOTS, SURVEY_269_SHARED_FILES, SURVEY_NATIVE_CAPS, surveyNativePlan,
  survey269ComponentPlan, survey269RemainingPlan, runSurvey269ComponentRollback, runSurveyNativeRollbackContracts,
  validateSurvey269ComponentSql, validateSurveyNativeSql, type Survey269ComponentBinding } from '../../scripts/contextual-surveys-native-contracts'
import { buildSurvey269RemainingManifest } from '../../scripts/contextual-test-draft-save-native-contracts'
import type { DraftSaveDriver, DraftSaveTarget } from '../../scripts/check-contextual-test-draft-save-db-contracts'
const faults=vi.hoisted(()=>({source:''}))
vi.mock('node:fs',async original=>{
  const fs=await original<typeof import('node:fs')>()
  return {...fs,readFileSync:((path,options)=>{
    const value=fs.readFileSync(path,options)
    if(!faults.source||!String(path).endsWith('/scripts/contextual-surveys-db-contracts.sql'))return value
    const text=value.toString(),header="set local statement_timeout = '35s';"
    const changed=faults.source==='missing'?text.replace(header,''):faults.source==='duplicate'?text+header:text.replace(header,"set local statement_timeout = '90s';")
    return Buffer.isBuffer(value)?Buffer.from(changed):changed
  }) as typeof fs.readFileSync}
})
const sha=(s:string)=>createHash('sha256').update(s).digest('hex')
const original=newAssignmentListProofFixture(),head='a'.repeat(40),raw=readFileSync('scripts/contextual-surveys-db-contracts.sql','utf8')
const binding:Survey269ComponentBinding={product:{head,tree:head},carrier:{head,tree:head},sharedSources:Object.fromEntries(SURVEY_269_SHARED_FILES.map(file=>[file,sha(readFileSync(`${SURVEY_269_COMPONENT_ROOTS.carrier}/${file}`,'utf8'))])) as Survey269ComponentBinding['sharedSources']}
const header="set local statement_timeout = '35s';"
function target(plan:ReturnType<typeof survey269ComponentPlan>|ReturnType<typeof survey269RemainingPlan>|ReturnType<typeof surveyNativePlan>):DraftSaveTarget{
  return {projectId:plan.projectId,apiUrl:'http://127.0.0.1:54331',databaseHost:'127.0.0.1',databasePort:54332,containerId:'b'.repeat(64),containerProjectLabel:plan.projectId,disposable:true,reviewedHead:plan.reviewedHead,migrationManifestSha256:plan.migrationManifestSha256,reviewedSourceSha256:plan.sourceSha256,acceptedManifestSha256:sha(JSON.stringify(plan.contracts))}
}
describe('approved remaining-only49-case90-second frame',()=>{
  it.each(['missing','duplicate','already90'])('rejects changed raw%s source before deriving a remaining contract',defect=>{
    faults.source=defect
    try{expect(()=>survey269RemainingPlan(original,binding)).toThrow()}
    finally{faults.source=''}
  })
  it('changes only the unique timeout header and binds the derivative in the full manifest',()=>{
    const component=survey269ComponentPlan(original,binding),remaining=survey269RemainingPlan(original,binding),native=surveyNativePlan(original,head,process.cwd())
    expect(raw.split(header)).toHaveLength(2)
    expect(component.contracts.sql).toBe(raw);expect(native.contracts.sql).toBe(raw)
    expect(remaining.contracts.sql).toBe(raw.replace(header,"set local statement_timeout = '90s';"))
    expect(remaining.contracts).not.toBe(component.contracts)
    expect(remaining.inventory.originalClock).toEqual({workMs:720000,cleanupMs:180000,sdkPhaseMs:60000,sqlContractMs:90000,rpcMs:8000})
    expect(remaining.sources.contracts.sha256).toBe(sha(raw));expect(SURVEY_NATIVE_CAPS.actionMs).toBe(35000)
    const full=buildSurvey269RemainingManifest(original,binding)
    expect(full.contracts.sql).toBe(remaining.contracts.sql)
    expect(validateSurvey269ComponentSql(full,full.contracts.sql)).toBe(true)
    expect(validateSurvey269ComponentSql(component,remaining.contracts.sql)).toBe(false)
    expect(validateSurvey269ComponentSql(remaining,raw)).toBe(false)
    expect(validateSurveyNativeSql(native,remaining.contracts.sql)).toBe(false)
    expect(validateSurvey269ComponentSql(remaining,remaining.contracts.sql+'\n')).toBe(false)
    expect(validateSurvey269ComponentSql(Object.freeze({...remaining,contracts:Object.freeze({...remaining.contracts})}),remaining.contracts.sql)).toBe(false)
    expect(validateSurvey269ComponentSql(Object.freeze({...remaining,kind:component.kind}) as unknown as typeof component,remaining.contracts.sql)).toBe(false)
  })
  it.each(['remaining','component','native'] as const)('verifies target before opening and dispatches the actual%s deadline',async kind=>{
    const plan=kind==='remaining'?survey269RemainingPlan(original,binding):kind==='component'?survey269ComponentPlan(original,binding):surveyNativePlan(original,head,process.cwd())
    const bound=target(plan),events:string[]=[],execute=vi.fn(async()=>[]),close=vi.fn(async()=>{})
    const driver:DraftSaveDriver={verifyTarget:vi.fn(async()=>{events.push('verify');return bound}),openSession:vi.fn(async name=>{events.push('open');return{name,execute,rollbackAndClose:close}})}
    if(kind==='native')await runSurveyNativeRollbackContracts(plan as ReturnType<typeof surveyNativePlan>,bound,driver)
    else await runSurvey269ComponentRollback(plan as ReturnType<typeof survey269ComponentPlan>,bound,driver)
    expect(events).toEqual(['verify','open']);expect(execute).toHaveBeenCalledWith(plan.contracts.sql,kind==='remaining'?90000:35000)
    expect(close).toHaveBeenCalledWith(12000)
    const changed={...bound,acceptedManifestSha256:'0'.repeat(64)};vi.mocked(driver.openSession).mockClear()
    if(kind!=='native')await expect(runSurvey269ComponentRollback(plan as ReturnType<typeof survey269ComponentPlan>,changed,driver)).rejects.toThrow()
    expect(driver.openSession).not.toHaveBeenCalled()
  })
})
