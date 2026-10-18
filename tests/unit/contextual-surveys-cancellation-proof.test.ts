import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { newSurveyNativeFixture } from '../../scripts/contextual-surveys-native-contracts'
import type { AssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { surveyCancellationProofDescriptor, surveyRemainingScheduleLowerBound, validateSurveyCancellationSql, inspectSurveyCancellationPendingShape,
  SURVEY_CANCELLATION_CAPS } from '../../scripts/contextual-surveys-cancellation-proof'

// SQL generation and pure source-shape checks only; no native parsing/execution,
// request-setting support, pooled-backend provenance or cancellation is proved.
const f = newSurveyNativeFixture({ manifest: { syntheticTag: 'assignmentlist_123456abcdef' }, allocatedIds: [] } as unknown as AssignmentListProofFixture)
const make = () => surveyCancellationProofDescriptor(f)
function pending(d: ReturnType<typeof make>) {
  return { stage: 'pending', descriptorSha256: d.descriptorSha256, nativeVerified: false,
    backend: { pid: 321, started: '2026-10-17T20:00:01Z', database: 'postgres', sessionUser: 'authenticator', name: d.binding.marker,
      state: 'active', waitType: 'Timeout', waitEvent: 'PgSleep', transactionStartedAt: '2026-10-17T20:00:02Z',
      queryStartedAt: '2026-10-17T20:00:02Z', observedAt: '2026-10-17T20:00:03Z', poll: 1 } }
}

describe('inert source-owned Survey cancellation descriptor', () => {
  it('keeps the separately authorized TOAST regression rollback-contained with real external-storage and negative equality checks', () => {
    const sql=readFileSync('scripts/contextual-surveys-restoration-toast-regression.sql','utf8')
    expect(sql).toContain("set local statement_timeout='8s'")
    expect(sql).toContain('alter column state set storage external')
    expect(sql).toContain('reltoastrelid');expect(sql).toContain("assert chunks>1")
    expect(sql).toContain("array['comparison','hash']")
    expect(sql).toContain("sqlstate<>'XX000' or sqlerrm<>format('could not open relation with OID %s',toast_oid)")
    expect(sql).toContain('select (state::text)::jsonb into strict captured')
    expect(sql).toContain("assert negative_seen,'Full equality failed to reject changed catalog'")
    expect(sql.trim().endsWith('rollback;')).toBe(true)
    expect(sql).not.toMatch(/\bcommit\s*;|\b(?:public|private)\./i)
  })
  it('materializes complete baseline JSONB before DROP in both restoration variants', () => {
    const d=make()
    for(const sql of [d.frames.restoreBeforeDispatch,d.frames.restoreAfterDispatch]) {
      const projection='select (state::text)::jsonb,pending,installed into strict captured,pending_backend,saved_installed'
      expect(sql).toContain(projection)
      expect(sql.indexOf(projection)).toBeLessThan(sql.indexOf(`drop table ${d.baselineTable}`))
      expect(sql.match(/pg_temp\.survey_cancel_state\(\) is distinct from captured/g)).toHaveLength(2)
      expect(sql).toContain("convert_to(captured::text,'UTF8')")
      expect(sql).toContain("convert_to((captured->'catalog')::text,'UTF8')")
      expect(validateSurveyCancellationSql(d,sql===d.frames.restoreAfterDispatch?'restoreAfterDispatch':'restoreBeforeDispatch',sql.replace('(state::text)::jsonb','state'))).toBe(false)
    }
  })
  it('counts the fixed remaining candidate without granting admission or inventing missing wire/restoration execution',()=>{
    const r=surveyRemainingScheduleLowerBound(f,{containers:1,volumes:1,networks:1})
    expect(r).toMatchObject({guardCommands:15,baseGuards:254,baseControls:3822,typeControls:49,rootGitControls:28,
      proposedActions:198,proposedRequests:16,proposedObservers:14,candidateControlLowerBound:4036,controlDeficit:0,partialControlHeadroom:1964,
      cleanupReserve:218,completeControls:null,completeFailureControls:null,completeExchangeBytes:null,inventoryComplete:false,executionEnabled:false,nativeVerified:false})
    expect(r.frames.cancellation).toEqual(Object.fromEntries(Object.entries(make().frames).map(([key,sql])=>[key,{sha256:createHash('sha256').update(sql).digest('hex'),bytes:Buffer.byteLength(sql)}])))
    expect(r.frames.wire).toEqual({implemented:false,sqlBytes:null})
    expect(r.frames.membership).toEqual({source:'verifySurveyPrimaryMembership',bound:true,sqlBytes:0})
    expect(r.caps).toMatchObject({nativeControls:6000,sdkMs:60000,nativeActions:200,totalBytes:67108864,sdkRequests:16,nativeSessions:2,workMs:720000,cleanupMs:180000})
    expect(make().caps.nativeControls).toBe(4000)
    expect(r.failureCases.every(row=>row.completeControls===null && row.completeActions===null)).toBe(true)
  })
  it('counts every128-item inventory batch and exposes the unchanged frame-limited global upper bound',()=>{
    const a=surveyRemainingScheduleLowerBound(f,{containers:128,volumes:128,networks:128})
    const b=surveyRemainingScheduleLowerBound(f,{containers:129,volumes:128,networks:128})
    expect(a.guardCommands).toBe(15);expect(b.guardCommands).toBe(16)
    expect(b.candidateControlLowerBound-a.candidateControlLowerBound).toBe(267)
    expect(a.listCountUpperBounds).toEqual({containers:129055,volumes:4194304,networks:129055})
    expect(a.maximumListBatches).toBe(34786)
    expect(a.maximumGuardCommands).toBe(34798)
    for(const value of [-1,0.5,Infinity,129056])expect(()=>surveyRemainingScheduleLowerBound(f,{containers:value,volumes:1,networks:1})).toThrow()
    expect(()=>surveyRemainingScheduleLowerBound(f,{containers:1,volumes:1,networks:1,extra:1} as never)).toThrow()
  })
  it('is deterministic, deeply frozen and explicitly grants no execution/native acceptance', () => {
    const d = make(), same = make()
    expect(d).toEqual(same)
    const frozen = (value: unknown) => { if (value && typeof value === 'object') { expect(Object.isFrozen(value)).toBe(true);Object.values(value).forEach(frozen) } }
    frozen(d)
    expect(d.inventoryComplete).toBe(false);expect(d.executionEnabled).toBe(false);expect(d.nativeVerified).toBe(false)
    expect(d.inventory.inventoryComplete).toBe(false)
    expect(d.binding.fixtureSha256).toBe(createHash('sha256').update(JSON.stringify(f)).digest('hex'))
    expect(d.descriptorSha256).toBe(createHash('sha256').update(JSON.stringify(d.binding)).digest('hex'))
    expect(d.binding.marker.length).toBeLessThan(64)
    expect(d.requestContextGucsUsed).toBe(false)
    expect(Object.keys(d).some(key => /execute|fetch|approve|authorize|admit/i.test(key))).toBe(false)
    expect(d.integrationRequirements.join(' ')).toContain('pure DTO validation is not provenance')
  })
  it('rejects changed fixtures instead of accepting caller-selected actors, namespaces or questions', () => {
    for (const defect of ['member','survey','question','extra'] as const) {
      const changed = structuredClone(f)
      if (defect === 'member') changed.actors[1].id=f.actors[2].id
      if (defect === 'survey') changed.surveys[0].id=f.surveys[1].id
      if (defect === 'question') changed.question.question_text='Substituted'
      if (defect === 'extra') Object.assign(changed,{target:'remote'})
      expect(() => surveyCancellationProofDescriptor(Object.freeze(changed))).toThrow()
    }
    expect(() => surveyCancellationProofDescriptor(structuredClone(f))).toThrow()
  })
  it('pins the original primary-fixture HTTP request without a proxy, supplied SQL or callbacks', () => {
    const d = make()
    expect(d.request).toEqual({ origin:'http://127.0.0.1:54331',path:'/rest/v1/rpc/respond_to_survey_for_member_v1',method:'POST',
      body:{p_actor_id:f.actors[1].id,p_survey_id:f.surveys[0].id,p_classroom_id:f.classes[0].id,p_expected_questions:[f.question],
        p_responses:{[f.question.id]:{question_type:'short_text',response_text:'Synthetic cancellation response'}}} })
    expect(Buffer.byteLength(JSON.stringify(d.request.body))).toBeLessThanOrEqual(4096)
    expect(d.binding.requestSha256).toBe(createHash('sha256').update(JSON.stringify(d.request)).digest('hex'))
    expect('run' in d || 'client' in d || 'statusTarget' in d).toBe(false)
  })
  it('installs an exact-row9s BEFORE INSERT fault that returns NEW and preserves original RPC/ACL/RLS/timeout', () => {
    const d = make(), sql = d.frames.prepare
    expect(sql).toContain(`create trigger ${d.triggerName} before insert on public.survey_responses for each row execute function ${d.functionName}()`)
    for (const [field,id] of [['survey_id',f.surveys[0].id],['question_id',f.question.id],['student_id',f.actors[1].id]]) expect(sql).toContain(`new.${field} is distinct from '${id}'::uuid`)
    expect(sql).toContain("then return new;end if;")
    expect(sql).toContain("if session_user<>'authenticator'")
    expect(sql).toContain(`set_config('application_name','${d.binding.marker}',true)`)
    expect(sql).toContain('pg_catalog.pg_sleep(9);return new;')
    expect(sql).toContain('returns trigger language plpgsql security invoker')
    expect(sql).toContain(`revoke all on function ${d.functionName}() from public,anon,authenticated,service_role`)
    expect(sql).not.toMatch(/new\.[a-z_]+\s*:=|alter\s+function|create(?:\s+or\s+replace)?\s+function\s+public\.|disable\s+trigger|session_replication_role/i)
    expect(sql).not.toContain("current_setting('request.path'")
    expect(sql).not.toContain("current_setting('request.method'")
    expect(sql).toContain('function_row.prosrc is distinct from')
    for (const field of ['proowner','prosecdef','prorettype','prolang','proconfig','provolatile','pronargs']) expect(sql).toContain(`function_row.${field}`)
    expect(sql).toContain('aclexplode(function_row.proacl)')
    expect(sql).toContain('trigger_row.tgtype<>7')
    expect(sql).toContain('trigger_row.tgqual is not null')
  })
  it('guards absence and full-row/catalog capture before installation and emits readiness only AFTER COMMIT', () => {
    const d = make(), sql = d.frames.prepare
    expect(sql.indexOf('do $guard$')).toBeLessThan(sql.indexOf('create or replace function pg_temp.survey_cancel_state'))
    expect(sql.indexOf('Survey cancellation namespace occupied')).toBeLessThan(sql.indexOf(`create table ${d.baselineTable}`))
    expect(sql.indexOf('insert into survey_cancel_prepare values(pg_temp.survey_cancel_state())')).toBeLessThan(sql.indexOf(`create table ${d.baselineTable}`))
    expect(sql).toContain("c.relkind in ('r','p') and n.nspname in ('public','private','storage')")
    expect(sql).toContain('jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)')
    for (const catalog of ['functions','triggers','relations','columns','constraints','indexes','policies','roleSettings','cron']) expect(sql).toContain(`'${catalog}'`)
    // Baseline pkey index attributes must not contaminate the relation snapshot.
    expect(sql).toContain("c.relkind in ('r','p','v','m','f','S') and a.attnum>0")
    expect(sql).toContain('Survey cancellation installation changed baseline')
    expect(sql.indexOf("commit;\n select jsonb_build_object('stage','prepared'")).toBeGreaterThan(0)
    const receipt = sql.slice(sql.lastIndexOf("select jsonb_build_object('stage','prepared'"))
    expect(receipt).toContain('stateSha256');expect(receipt).toContain('catalogSha256')
    expect(receipt).not.toMatch(/'state',state|'rows',|'catalog',/)
    expect(d.integrationRequirements[0]).toContain('before prepare write/ambiguous COMMIT')
  })
  it('observes one actual marked client backend and persists its identity rather than accepting a caller PID', () => {
    const d = make(), sql = d.frames.observer
    expect(sql).toContain(`where a.application_name='${d.binding.marker}' and a.backend_type='client backend'`)
    expect(sql).toContain('pg_stat_clear_snapshot()')
    expect(sql).toContain('for poll in 1..3 loop')
    expect(sql).toContain("interval '750 milliseconds'")
    for (const item of ["'database'='postgres'","'sessionUser'='authenticator'","'state'='active'","'waitType'='Timeout'","'waitEvent'='PgSleep'"]) expect(sql).toContain(item)
    expect(sql).toContain('if matches<>1')
    expect(sql).toContain('set pending=observed where singleton and pending is null')
    expect(sql).toContain("observed->>'transactionStartedAt' is null")
    expect(sql).not.toContain('pg_sleep')
    expect(d.integrationRequirements.join(' ')).toContain('prove it pending at observer dispatch/completion')
  })
  it('permits a legitimate newly opened pooled backend after prepare, but never after its own transaction', () => {
    const d = make(), r = pending(d)
    // Hypothetical prepare00s; pooled backend opens01s, request starts02s.
    expect(inspectSurveyCancellationPendingShape(d,r)).toEqual({sourceShapeMatches:true,backendOwnershipVerified:false,nativeVerified:false})
    expect(d.frames.observer).toContain("(observed->>'started')::timestamptz>(observed->>'transactionStartedAt')::timestamptz")
    expect(d.frames.observer).not.toContain("(observed->>'started')::timestamptz>(select prepared_at")
    r.backend.started='2026-10-17T20:00:04Z'
    expect(()=>inspectSurveyCancellationPendingShape(d,r)).toThrow()
  })
  it('rejects malformed/extra/cross-backend pending DTOs and never promotes matching shapes into provenance', () => {
    const d=make()
    for(const defect of ['pid','started','database','user','marker','state','wait','poll','extra','binding','native','missing','timezone','prototype'] as const){
      const r=pending(d)
      if(defect==='pid')r.backend.pid=0
      if(defect==='started')r.backend.started='not-a-time'
      if(defect==='database')r.backend.database='remote'
      if(defect==='user')r.backend.sessionUser='postgres'
      if(defect==='marker')r.backend.name='foreign'
      if(defect==='state')r.backend.state='idle'
      if(defect==='wait')r.backend.waitEvent='advisory'
      if(defect==='poll')r.backend.poll=4
      if(defect==='extra')Object.assign(r.backend,{query:'private contents'})
      if(defect==='binding')r.descriptorSha256='0'.repeat(64)
      if(defect==='native')r.nativeVerified=true
      if(defect==='missing')Reflect.deleteProperty(r.backend,'transactionStartedAt')
      if(defect==='timezone')r.backend.observedAt='2026-10-17T20:00:03'
      if(defect==='prototype')Object.setPrototypeOf(r.backend,{untrusted:true})
      expect(()=>inspectSurveyCancellationPendingShape(d,r)).toThrow()
    }
    expect(()=>inspectSurveyCancellationPendingShape({...d},pending(d))).toThrow()
    expect(inspectSurveyCancellationPendingShape(d,pending(d)).backendOwnershipVerified).toBe(false)
  })
  it('requires exact stored backend settlement and exact installed identities before any DROP', () => {
    const d=make(),sql=d.frames.restoreAfterDispatch
    expect(sql).toContain('dispatched backend ownership absent')
    expect(sql).toContain("pid=(pending_backend->>'pid')::integer and backend_start=(pending_backend->>'started')::timestamptz")
    expect(sql).toContain("state is distinct from 'idle' or xact_start is not null")
    expect(sql.indexOf('owned backend not settled')).toBeLessThan(sql.indexOf(`drop trigger ${d.triggerName}`))
    expect(sql.indexOf('tagged backend remains')).toBeLessThan(sql.indexOf(`drop trigger ${d.triggerName}`))
    expect(sql.indexOf('installed identity changed')).toBeLessThan(sql.indexOf(`drop trigger ${d.triggerName}`))
    expect(sql).toContain("saved_installed is distinct from jsonb_build_object('functionOid'")
    expect(sql.match(/pg_temp\.survey_cancel_state\(\) is distinct from captured/g)).toHaveLength(2)
    expect(sql).toContain(`drop table ${d.baselineTable}`)
    expect(sql).toContain('commit;select result from survey_cancel_restored;')
    expect(sql).not.toMatch(/pg_terminate_backend|pg_cancel_backend|drop\s+.*cascade/i)
  })
  it('provides only a fixed no-dispatch recovery variant and refuses orphan or uncertain restoration as success', () => {
    const d=make(),sql=d.frames.restoreBeforeDispatch
    expect(sql).toContain('before-dispatch state differs')
    expect(sql).toContain('orphan instrumentation')
    expect(sql).toContain("'stage','absent-unverified'")
    expect(d.integrationRequirements.join(' ')).toContain('Only privately proved never-dispatched state')
    expect(d.integrationRequirements.join(' ')).toContain('Absent-unverified is cleanup information only')
    expect(d.integrationRequirements.join(' ')).toContain('unobserved dispatched backend or unjoined child')
    expect(d.integrationRequirements.join(' ')).toContain('after failure use existing owned restoration admission')
  })
  it('pins every frame and keeps caps/observer/request arithmetic provisional rather than executable admission', () => {
    const d=make()
    for(const [frame,sql]of Object.entries(d.frames)){
      expect(Buffer.byteLength(sql)).toBeLessThanOrEqual(262144)
      expect(validateSurveyCancellationSql(d,frame as keyof typeof d.frames,sql)).toBe(true)
      expect(validateSurveyCancellationSql(d,frame as keyof typeof d.frames,sql+' ')).toBe(false)
      expect(validateSurveyCancellationSql({...d},frame as keyof typeof d.frames,sql)).toBe(false)
    }
    expect(validateSurveyCancellationSql(d,'unknown' as never,d.frames.prepare)).toBe(false)
    expect(SURVEY_CANCELLATION_CAPS).toMatchObject({nativeActions:200,nativeControls:4000,nativeSessions:2,totalBytes:67108864,sdkRequests:16,workMs:720000,cleanupMs:180000})
    expect(d.inventory).toMatchObject({successSqlDispatches:3,addedObserverFrames:1,totalObserverFrames:14,addedHttpRequests:1,
      ordinaryPlusCancellationRequests:15,withApprovedWireOverflowRequests:16,completeControls:null,completeExchangeBytes:null,inventoryComplete:false})
    expect(d.inventory.ifAllFramesUseSingle).toEqual({actions:6,sessionSpawns:3,identityBootstraps:3,sessionCloses:3,knownTotalActions:199})
    expect(d.integrationRequirements.join(' ')).toContain('reserve wire fixture and membership restoration')
  })
})
