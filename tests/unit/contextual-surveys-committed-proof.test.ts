import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import type { AssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newSurveyNativeFixture } from '../../scripts/contextual-surveys-native-contracts'
import { surveyCommittedProofManifest, validateSurveyCommittedSql, validateSurveyCommittedSource, verifySurveyCommittedEffects,
  surveyCommittedObservationSql, verifySurveyCommittedWitness, verifySurveyCommittedEnvelopes,
  verifySurveyCommittedSeed, parseSurveyCommittedGraph } from '../../scripts/contextual-surveys-committed-proof'

// No entropy, native driver, filesystem target, provider or database is used.
const f = newSurveyNativeFixture({ manifest: { syntheticTag: 'assignmentlist_123456abcdef' }, allocatedIds: [] } as unknown as AssignmentListProofFixture)
const manifest = () => surveyCommittedProofManifest(f)
import {surveyCommittedCpuFixtures,type SurveyCpuGraph as Graph} from '../helpers/survey-committed-cpu-fixtures'
const {capturedSeed,seedBefore,admitSeed,changedCase,practicalFixture,envelopes}=surveyCommittedCpuFixtures(f)
const seedStamp='2026-10-13T02:59:00Z',writeStamp='2026-10-13T03:00:00Z'
const fullTables = new Set(['public.classrooms','public.classroom_archive_revisions','public.classroom_enrollments',
  'public.surveys','public.survey_questions','public.survey_responses','public.gradebook_categories','private.pal_membership_generations'])
// Wire-shaped synthetic witnesses only: the genuine ordered jsonb::text digest
// is produced by PostgreSQL, not by this offline fixture's JSON serializer.
function compact(g: Graph) {
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sorted(v)])) : value
  return parseSurveyCommittedGraph(Object.fromEntries(Object.entries(g).map(([table, rows]) => [table, fullTables.has(table) ? structuredClone(rows) : {
    count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows.map(sorted).map(r => JSON.stringify(r)).sort())).digest('hex'),
    identities: Object.fromEntries(['id','artifact_id','generation_id'].map(field => [field, rows.flatMap(r => typeof r[field] === 'string' ? [String(r[field])] : [])
      .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))])),
  }])) )
}
describe('source-only Survey committed directions', () => {
  it('emits complete catalog/count/digest witnesses and retains exact identity projections', () => {
    const m = manifest(), sql = m.seed
    expect(sql).toContain("n.nspname in ('public','private','storage')")
    expect(sql).toContain("c.relkind in ('r','p')")
    expect(sql).toContain('jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)')
    expect(sql).toContain("encode(sha256(convert_to(rows::text,'UTF8')),'hex')")
    expect(sql).toContain("'count',jsonb_array_length(rows)")
    for (const table of fullTables) expect(sql).toContain(`'${table}'`)
    for (const field of ['id','artifact_id','generation_id']) {
      expect(sql).toContain(`jsonb_typeof(r.value->'${field}')='string'`)
      expect(sql).toContain(`(r.value->>'${field}') collate "C"`)
    }
    expect(m.nativeVerified).toBe(false); expect(m.executionEnabled).toBe(false)
    expect(m.caps.responseBytes).toBe(8388608)
  })
  it('strictly rejects malformed, missing, extra and mixed compact representations', () => {
    const g = compact(capturedSeed(manifest()))
    for (const defect of ['full-missing','full-witness','sha','count','count-missing','identity-missing','identity-shape','identity-type','identity-count','identity-order','extra','schema','mixed'] as const) {
      const bad = structuredClone(g)
      const witness = bad['public.untouched']; if (Array.isArray(witness)) throw new Error('Expected compact fixture')
      if (defect === 'full-missing') Reflect.deleteProperty(bad, 'public.classrooms')
      if (defect === 'full-witness') Object.assign(bad, { 'public.classrooms': witness })
      if (defect === 'sha') witness.sha256 = 'A'.repeat(64)
      if (defect === 'count') witness.count = -1
      if (defect === 'count-missing') Reflect.deleteProperty(witness, 'count')
      if (defect === 'identity-missing') Reflect.deleteProperty(witness.identities, 'id')
      if (defect === 'identity-shape') Object.assign(witness.identities, { extra: [] })
      if (defect === 'identity-type') Object.assign(witness.identities, { id: [1] })
      if (defect === 'identity-count') witness.identities.id = ['one','two']
      if (defect === 'identity-order') { witness.count = 2; witness.identities.id = ['z','a'] }
      if (defect === 'extra') Object.assign(witness, { extra: true })
      if (defect === 'schema') bad['auth.users'] = witness
      if (defect === 'mixed') bad['public.extra'] = []
      expect(() => parseSurveyCommittedGraph(bad)).toThrow()
    }
    expect(parseSurveyCommittedGraph(g)).toBe(g)
  })
  it('retains duplicate and non-UUID off-table identities without transporting unrelated content', () => {
    const full = capturedSeed(manifest())
    full['storage.objects'] = [{ id: 'é', artifact_id: 'same', generation_id: 'z', content: 'private synthetic content' },
      { id: 'é', artifact_id: 'same', generation_id: 'a', content: 'more synthetic content' }]
    const g = compact(full), witness = g['storage.objects']
    expect(witness).toEqual({ count: 2, sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      identities: { id: ['é','é'], artifact_id: ['same','same'], generation_id: ['a','z'] } })
    const changed = structuredClone(full); changed['storage.objects'][0].content = 'changed synthetic content'
    expect(compact(changed)['storage.objects']).not.toEqual(witness)
    expect(JSON.stringify(witness)).not.toContain('synthetic content')
  })
  it('detects changed off-table content/count/identity and complete table inventory at seed and terminal', () => {
    for (const defect of ['data','count','identity','delete','add'] as const) {
      const m = manifest(), original = capturedSeed(m), before = compact(seedBefore(original)), after = compact(original), bad = structuredClone(after)
      const witness = bad['public.untouched']; if (Array.isArray(witness)) throw new Error('Expected compact fixture')
      if (defect === 'data') witness.sha256 = '0'.repeat(64)
      if (defect === 'count') witness.count++
      if (defect === 'identity') witness.identities.id = ['substituted']
      if (defect === 'delete') delete bad['public.untouched']
      if (defect === 'add') bad['storage.extra'] = structuredClone(witness)
      expect(() => verifySurveyCommittedSeed(m, before, bad, { startedAt: seedStamp, endedAt: seedStamp, seedTimestamp: seedStamp })).toThrow()
      verifySurveyCommittedSeed(m, before, after, { startedAt: seedStamp, endedAt: seedStamp, seedTimestamp: seedStamp })
      const s = m.schedules.find(s => s.index === 5 && s.direction === 'forward')!
      const times = { startedAt: writeStamp, endedAt: '2026-10-13T03:00:02Z', writerTimestamp: writeStamp }
      expect(() => verifySurveyCommittedEffects(m, s.label, after, bad, times)).toThrow()
      // Corruption cannot be laundered by changing both next snapshots.
      expect(() => verifySurveyCommittedEffects(m, s.label, bad, structuredClone(bad), times)).toThrow()
      expect(verifySurveyCommittedEffects(m, s.label, after, after, times).fullGraphVerified).toBe(true)
    }
  })
  it('retains cross-table id/artifact/generation collision rejection at seed and response insertion', () => {
    for (const field of ['id','artifact_id','generation_id'] as const) {
      const m = manifest(), original = capturedSeed(m), collision = String(original['public.surveys'][0].artifact_id)
      original['public.untouched'].push({ [field]: collision })
      expect(() => verifySurveyCommittedSeed(m, compact(seedBefore(original)), compact(original), {
        startedAt: seedStamp, endedAt: seedStamp, seedTimestamp: seedStamp })).toThrow()
    }
    const m = manifest(), s = m.schedules.find(s => s.index === 13)!, original = capturedSeed(m)
    const response = changedCase(s, original)
    original['public.untouched'].push({ id: response.times.responseId })
    const before = compact(original)
    verifySurveyCommittedSeed(m, compact(seedBefore(original)), before, { startedAt: seedStamp, endedAt: seedStamp, seedTimestamp: seedStamp })
    const { after, times } = changedCase(s, original)
    expect(() => verifySurveyCommittedEffects(m, s.label, before, compact(after), times)).toThrow()
  })
  it('authenticates all 30 compact directions with unchanged envelopes and full inspected rows', () => {
    const m = manifest(); let full = capturedSeed(m), graph = compact(full)
    verifySurveyCommittedSeed(m, compact(seedBefore(full)), graph, { startedAt: seedStamp, endedAt: seedStamp, seedTimestamp: seedStamp })
    for (const s of m.schedules) {
      const before = graph, result = changedCase(s, full), after = compact(result.after)
      expect(verifySurveyCommittedEffects(m, s.label, before, after, result.times).fullGraphVerified).toBe(true)
      expect(verifySurveyCommittedEnvelopes(m, s.label, before, after, envelopes(s, full, result.after)).operationEnvelopesVerified).toBe(true)
      const practical = practicalFixture(m, s, full)
      expect(verifySurveyCommittedWitness(m, s.label, practical.bootstrap, practical.witness, practical.clock).nativeVerified).toBe(false)
      full = result.after; graph = after
    }
  })
  it('derives separate closed cohorts for all original pairs and both directions', () => {
    const m = manifest()
    expect(m.schedules).toHaveLength(30)
    expect(new Set(m.schedules.map(s => s.cohort.classroomId)).size).toBe(30)
    expect(m.allocatedIds.some(id => f.allocatedIds.includes(id))).toBe(false)
    expect(m.actors).toBe(f.actors)
    expect(m.nativeVerified).toBe(false)
    expect(m.inventory.withRollbackReplayFits).toBe(false)
    expect(m.schedules.every(s => s.frames.holder.includes("lock_timeout='1s'"))).toBe(true)
  })
  it('rejects forged fixture, foreign IDs, wrong direction and substituted SQL', () => {
    const m = manifest(), s = m.schedules[0]
    expect(validateSurveyCommittedSql(m, s.label, 'holder', 'holder', s.frames.holder)).toBe(true)
    expect(validateSurveyCommittedSql(m, m.schedules[1].label, 'holder', 'holder', s.frames.holder)).toBe(false)
    expect(validateSurveyCommittedSql(m, s.label, 'contender', 'holder', s.frames.holder)).toBe(false)
    expect(validateSurveyCommittedSql(m, s.label, 'holder', 'holder', s.frames.holder.replace(s.cohort.surveyId, f.surveys[0].id))).toBe(false)
    expect(validateSurveyCommittedSql({ ...m }, s.label, 'holder', 'holder', s.frames.holder)).toBe(false)
    expect(() => surveyCommittedProofManifest({ ...f, actors: f.actors.map((a, i) => i ? a : { ...a, id: f.actors[1].id }) })).toThrow()
    expect(() => validateSurveyCommittedSource(m, { migration: 'substituted', races: 'substituted' })).toThrow('Stale Survey migration SQL')
    expect(() => surveyCommittedProofManifest({ ...f, question: { ...f.question, updated_at: '2026-10-01T00:00:00Z' } })).toThrow()
  })
  it('does not invent a waiter for NOWAIT, but requires the successful original held operation', () => {
    const m = manifest(), s = m.schedules.find(s => s.mode === 'nowait')!
    const bootstrap = { holder: { pid: 101, started: '2026-10-13T03:00:00Z', name: m.projectId + '_draft_holder', database: 'postgres' as const, user: 'postgres' as const },
      contender: { pid: 102, started: '2026-10-13T03:00:01Z', name: m.projectId + '_draft_contender', database: 'postgres' as const, user: 'postgres' as const } }
    const sql = surveyCommittedObservationSql(m, s.label, bootstrap)
    expect(sql).toContain('pg_stat_clear_snapshot()')
    expect(sql).toContain('pg_blocking_pids')
    expect(sql).not.toContain('pg_sleep')
    expect(() => surveyCommittedObservationSql(m, s.label, { ...bootstrap, contender: { ...bootstrap.contender, name: 'foreign' } })).toThrow()
    const now = Date.parse('2026-10-13T03:00:02Z')
    const before=capturedSeed(m);admitSeed(m,before)
    const {witness}=practicalFixture(m,s,before)
    const clock = { startedAt: now - 500, workDeadline: now + 100, dispatchedAt: now - 10, observedAt: now, contenderPending: false, poll: 1 }
    expect(verifySurveyCommittedWitness(m, s.label, bootstrap, witness, clock).nativeVerified).toBe(false)
    expect(() => verifySurveyCommittedWitness(m, s.label, bootstrap, { ...witness, held: { ...witness.held, sourceSha256:'0'.repeat(64) } }, clock)).toThrow()
    expect(() => verifySurveyCommittedWitness(m, s.label, bootstrap, { ...witness, held: { ...witness.held, operation:{code:'PT409',result:null} } }, clock)).toThrow()
    expect(sql).not.toContain('xmin');expect(sql).not.toContain('xmax');expect(sql).not.toContain('ctid');expect(sql).not.toContain('pgrowlocks')
    expect(() => verifySurveyCommittedWitness(m, s.label, bootstrap, witness, { ...clock, workDeadline: now })).toThrow()
    expect(() => verifySurveyCommittedWitness(m, s.label, bootstrap, { ...witness, holder: { ...bootstrap.holder, started: '2026-10-13T02:00:00Z' } }, clock)).toThrow()
    expect(() => verifySurveyCommittedWitness(m, s.label, bootstrap, { ...witness, blockers: [101], waiter: { wait_event_type: 'Lock' } }, clock)).toThrow()
  })
  it('requires the original successful holder and actual fixed-pair pending backend edge', () => {
    const m = manifest(), s = m.schedules[0], now = Date.parse('2026-10-13T03:00:02Z')
    const bootstrap = { holder: { pid: 101, started: '2026-10-13T03:00:00Z', name: m.projectId + '_draft_holder', database: 'postgres' as const, user: 'postgres' as const },
      contender: { pid: 102, started: '2026-10-13T03:00:01Z', name: m.projectId + '_draft_contender', database: 'postgres' as const, user: 'postgres' as const } }
    const before=capturedSeed(m);admitSeed(m,before)
    const {witness:w}=practicalFixture(m,s,before)
    const clock = { startedAt: now - 500, workDeadline: now + 100, dispatchedAt: now - 10, observedAt: now, contenderPending: true, poll: 1 }
    expect(verifySurveyCommittedWitness(m, s.label, bootstrap, w, clock).blockingEdgeVerified).toBe(true)
    for (const defect of [{ ...w, blockers: [999] }, { ...w, held: { ...w.held, sourceSha256:'0'.repeat(64) } },
      { ...w, contenderDispatch:{...w.contenderDispatch,sqlSha256:'0'.repeat(64)} },{ ...w, held:{...w.held,operation:{code:null,result:{}}} },
      { ...w, held:{...w.held,backend:{...bootstrap.holder,started:'2026-10-13T02:00:00Z'}} },
      { ...w, held:{...w.held,transactionStartedAt:'2026-10-13T03:00:02Z'} },
      { ...w, waiter: { ...w.waiter, wait_event: 'advisory' } },
      { ...w, waiter: { ...w.waiter, state:'idle in transaction' } }]) expect(() => verifySurveyCommittedWitness(m, s.label, bootstrap, defect, clock)).toThrow()
    expect(() => verifySurveyCommittedWitness(m, s.label, bootstrap, w, { ...clock, contenderPending: false })).toThrow()
    expect(() => verifySurveyCommittedWitness(m, s.label, bootstrap, w, { ...clock, poll: 4 })).toThrow()
    expect(() => verifySurveyCommittedWitness(m, s.label, bootstrap, w, { ...clock, dispatchedAt: now - 1000, startedAt: now - 1000 })).toThrow()
  })
  it('requires exact full graph, source membership and timestamps', () => {
    const m = manifest(), s = m.schedules.find(s => s.index === 5 && s.direction === 'forward')!
    const c = s.cohort
    const g = capturedSeed(m);admitSeed(m,g)
    const times = { startedAt: '2026-10-13T03:00:00Z', endedAt: '2026-10-13T03:00:01Z', writerTimestamp: '2026-10-13T03:00:00Z' }
    expect(() => verifySurveyCommittedEffects(m, s.label, g, { ...g, 'public.foreign': [] }, times)).toThrow()
    const altered = structuredClone(g); altered['private.pal_membership_generations'][0].state = 'removed'
    expect(() => verifySurveyCommittedEffects(m, s.label, g, altered, times)).toThrow('Survey exact terminal graph differs')
    expect(() => verifySurveyCommittedEffects(m, s.label, g, g, { ...times, writerTimestamp: '2026-10-12T00:00:00Z' })).toThrow()
    const stale = structuredClone(g); stale['public.classrooms'][0].blueprint_source_revision=999
    expect(() => verifySurveyCommittedEffects(m, s.label, g, stale, times)).toThrow('Survey exact terminal graph differs')
    const substituted = structuredClone(g); substituted['public.classroom_enrollments'][0].id = f.enrollments[1].id
    expect(() => verifySurveyCommittedEffects(m, s.label, g, substituted, times)).toThrow('Survey exact terminal graph differs')
    expect(verifySurveyCommittedEffects(m, s.label, g, g, times).nativeVerified).toBe(false)
  })
  it('counts Blueprint/archive and duplicate response effects from actual triggers', () => {
    const m = manifest()
    for (const s of m.schedules.filter(s => [0, 1, 8, 9, 10, 11].includes(s.index))) {
      expect(s.effects.blueprint).toBe(1)
      expect(s.effects.archive).toBe(s.index >= 8 && s.direction === 'reverse' ? 3 : 2)
    }
    expect(m.schedules.filter(s => s.index === 7).every(s => s.effects.blueprint === 0 && s.effects.archive === 1 && s.effects.foreignArchive === 1)).toBe(true)
    expect(m.schedules.filter(s => s.index === 14).every(s => s.effects.archive === 3 && s.effects.responseCount === 1)).toBe(true)
    expect(m.inventory).toMatchObject({ minActions: 185, maxActions: 185, wait: 13, nowait: 17, remainingOnlyFits: true, holderWitnessFrames: 0, minObserverPolls: 13, maxObserverPolls: 39 })
  })
  it('uses the exact enrollment row only for forward removal, and retains actual RPC results', () => {
    const m = manifest(), forward = m.schedules.find(s => s.index === 4 && s.direction === 'forward')!, reverse = m.schedules.find(s => s.index === 4 && s.direction === 'reverse')!
    expect(forward.lock).toMatchObject({ kind: 'row', relation: 'public.classroom_enrollments', targetColumn: 'id', targetId: forward.cohort.enrollmentId })
    expect(reverse.lock).toMatchObject({ kind: 'advisory', key: 'pika-classroom-operation:' + reverse.cohort.classroomId })
    expect(forward.frames.holder).toContain("'operation'")
    expect(forward.frames.terminal).toContain('get_survey_for_member_v1')
    expect(m.schedules.find(s => s.index === 2 && s.direction === 'forward')!.frames.terminal).toContain("'PT403'")
    expect(typeof verifySurveyCommittedEnvelopes).toBe('function')
    expect(typeof verifySurveyCommittedSeed).toBe('function')
  })
  it('rejects seed drift, non-target changes, repeated generations, stale epochs and default-category drift',()=>{
    for(const defect of ['non-target','category','generation','stamp','revision'] as const){
      const m=manifest(),g=capturedSeed(m),before=seedBefore(g),bad=structuredClone(g)
      if(defect==='non-target')bad['public.untouched'][0].value='changed'
      if(defect==='category')bad['public.gradebook_categories'][0].percentage=99
      if(defect==='generation')bad['private.pal_membership_generations'][0].state='removed'
      if(defect==='stamp')bad['public.classroom_enrollments'][0].created_at='2026-10-12T00:00:00Z'
      if(defect==='revision')bad['public.classroom_archive_revisions'][0].revision=999
      expect(()=>verifySurveyCommittedSeed(m,before,bad,{startedAt:seedStamp,endedAt:seedStamp,seedTimestamp:seedStamp})).toThrow('Exact committed seed/full non-target graph differs')
      expect(verifySurveyCommittedSeed(m,before,g,{startedAt:seedStamp,endedAt:seedStamp,seedTimestamp:seedStamp}).nativeVerified).toBe(false)
    }
  })
  it('authenticates the entire next baseline, including unchanged corruption in both graphs',()=>{
    const m=manifest(),g=capturedSeed(m),s=m.schedules.find(s=>s.index===5&&s.direction==='forward')!;admitSeed(m,g)
    const times={startedAt:writeStamp,endedAt:'2026-10-13T03:00:02Z',writerTimestamp:writeStamp}
    for(const defect of ['non-target-value','non-target-delete','original-actor','original-actor-delete','other-cohort','other-cohort-delete','catalog-delete','catalog-add'] as const){
      const bad=structuredClone(g)
      if(defect==='non-target-value')bad['public.untouched'][0].value='laundered'
      if(defect==='non-target-delete')bad['public.untouched']=[]
      if(defect==='original-actor')bad['public.users'][0].role='teacher'
      if(defect==='original-actor-delete')bad['public.users'].shift()
      if(defect==='other-cohort')bad['public.classrooms'][0].title='laundered'
      if(defect==='other-cohort-delete')bad['public.classrooms'].shift()
      if(defect==='catalog-delete')delete bad['public.untouched']
      if(defect==='catalog-add')bad['public.foreign']=[]
      expect(()=>verifySurveyCommittedEffects(m,s.label,bad,structuredClone(bad),times)).toThrow()
    }
  })
  it('accepts nested JSON key equivalence but refuses changed values and array order',()=>{
    const m=manifest(),g=capturedSeed(m),s=m.schedules.find(s=>s.index===5&&s.direction==='forward')!
    for(const c of g['public.classrooms'])c.feature_visibility=Object.fromEntries(Object.entries(c.feature_visibility as Record<string,unknown>).reverse())
    admitSeed(m,g)
    const times={startedAt:writeStamp,endedAt:'2026-10-13T03:00:02Z',writerTimestamp:writeStamp},same=structuredClone(g)
    same['public.untouched'][0].nested={ordered:[{b:2,a:1},{b:4,a:3}],left:{b:2,a:1}}
    const wrong=structuredClone(same);(wrong['public.untouched'][0].nested as {ordered:unknown[]}).ordered.reverse()
    expect(()=>verifySurveyCommittedEffects(m,s.label,g,wrong,times)).toThrow()
    const changed=structuredClone(same);(changed['public.untouched'][0].nested as {left:{a:number}}).left.a=99
    expect(()=>verifySurveyCommittedEffects(m,s.label,g,changed,times)).toThrow()
    expect(verifySurveyCommittedEffects(m,s.label,g,same,times).fullGraphVerified).toBe(true)
  })
  it('authenticates all 30 sequential direction effects without erasing prior accepted changes',()=>{
    const m=manifest();let graph=capturedSeed(m);admitSeed(m,graph)
    for(const [position,s]of m.schedules.entries()){
      const before=structuredClone(graph),{after,times}=changedCase(s,before)
      if(position>0){
        const badBefore=structuredClone(before),badAfter=structuredClone(after)
        badBefore['public.survey_questions'][0].question_text='laundered prior cohort'
        badAfter['public.survey_questions'][0].question_text='laundered prior cohort'
        expect(()=>verifySurveyCommittedEffects(m,s.label,badBefore,badAfter,times)).toThrow()
      }
      expect(verifySurveyCommittedEffects(m,s.label,before,after,times).fullGraphVerified).toBe(true)
      graph=after
    }
    expect(graph['public.survey_questions'][0].question_text).toBe('Concurrent question')
    expect(()=>admitSeed(m,graph)).toThrow('already authenticated')
    const s=m.schedules[0],{after,times}=changedCase(s,graph)
    expect(()=>verifySurveyCommittedEffects(m,s.label,graph,after,times)).toThrow('already authenticated')
  })
  for(let index=0;index<15;index++)for(const direction of ['forward','reverse'] as const)it(`exact effects and retained envelopes ${index}:${direction}`,()=>{
    const m=manifest(),s=m.schedules.find(s=>s.index===index&&s.direction===direction)!,c=s.cohort,before=capturedSeed(m);admitSeed(m,before)
    const {after,one,times,delta}=changedCase(s,before)
    if(index===3){
      expect(s.frames.holder+s.frames.contender).toContain('archived_at=clock_timestamp()')
      expect(s.frames.holder+s.frames.contender).toContain("'archiveReceipt'")
      expect(()=>verifySurveyCommittedEffects(m,s.label,before,after,{...times,archiveReceipt:{...times.archiveReceipt!,archivedAt:times.writerTimestamp}})).toThrow('Survey exact terminal graph differs')
      expect(()=>verifySurveyCommittedEffects(m,s.label,before,after,{...times,archiveReceipt:{...times.archiveReceipt!,classroomId:f.classes[0].id}})).toThrow()
      expect(()=>verifySurveyCommittedEffects(m,s.label,before,after,{...times,archiveReceipt:{...times.archiveReceipt!,transactionTimestamp:times.archiveReceipt!.archivedAt}})).toThrow()
      expect(()=>verifySurveyCommittedEffects(m,s.label,before,after,{...times,archiveReceipt:{...times.archiveReceipt!,operationFinishedAt:times.writerTimestamp}})).toThrow('outside actual operation window')
    }
    const unrelated=structuredClone(after);unrelated['public.untouched'][0].value='changed'
    expect(()=>verifySurveyCommittedEffects(m,s.label,before,unrelated,times)).toThrow('Survey exact terminal graph differs')
    const revision=structuredClone(after);one(revision,'public.classroom_archive_revisions','classroom_id',c.classroomId).revision=1000
    expect(()=>verifySurveyCommittedEffects(m,s.label,before,revision,times)).toThrow('Survey exact terminal graph differs')
    expect(verifySurveyCommittedEffects(m,s.label,before,after,times)).toMatchObject({archiveRevisionDelta:delta,nativeVerified:false})
    const receipts=envelopes(s,before,after)
    const success=(result:unknown)=>({code:null,result})
    expect(verifySurveyCommittedEnvelopes(m,s.label,before,after,receipts).nativeVerified).toBe(false)
    const practical=practicalFixture(m,s,before)
    expect(verifySurveyCommittedWitness(m,s.label,practical.bootstrap,practical.witness,practical.clock)).toMatchObject({holderOperationVerified:true,blockingEdgeVerified:s.mode==='wait',nativeVerified:false})
    expect(()=>verifySurveyCommittedEnvelopes(m,s.label,before,after,{...receipts,freshRead:success({})})).toThrow()
    expect(()=>verifySurveyCommittedEnvelopes(m,s.label,before,after,{...receipts,cachedQuestions:[c.question]})).toThrow()
    const launderedBefore=structuredClone(before),launderedAfter=structuredClone(after)
    launderedBefore['public.users'][0].role='teacher';launderedAfter['public.users'][0].role='teacher'
    expect(()=>verifySurveyCommittedEnvelopes(m,s.label,launderedBefore,launderedAfter,receipts)).toThrow('Authenticated envelope graphs differ')
  })
})
