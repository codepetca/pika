import { describe, expect, it } from 'vitest'
import type { AssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newSurveyNativeFixture } from '../../scripts/contextual-surveys-native-contracts'
import { surveyCommittedProofManifest, validateSurveyCommittedSql, validateSurveyCommittedSource, verifySurveyCommittedEffects,
  surveyCommittedObservationSql, verifySurveyCommittedWitness, verifySurveyCommittedEnvelopes,
  verifySurveyCommittedSeed } from '../../scripts/contextual-surveys-committed-proof'

// No entropy, native driver, filesystem target, provider or database is used.
const f = newSurveyNativeFixture({ manifest: { syntheticTag: 'assignmentlist_123456abcdef' }, allocatedIds: [] } as unknown as AssignmentListProofFixture)
const manifest = () => surveyCommittedProofManifest(f)
type Graph = Record<string,Record<string,unknown>[]>
const seedStamp='2026-10-13T02:59:00Z',writeStamp='2026-10-13T03:00:00Z'
function capturedSeed(m:ReturnType<typeof manifest>) {
  let n=1;const generated=()=>`deafbeef-0000-4000-8000-${(n++).toString(16).padStart(12,'0')}`
  const g:Graph=Object.fromEntries(['public.classrooms','public.classroom_archive_revisions','public.classroom_enrollments','public.surveys','public.survey_questions','public.survey_responses','public.gradebook_categories','private.pal_membership_generations','public.untouched'].map(t=>[t,[]]))
  g['public.untouched']=[{id:'unchanged',value:'retain',nested:{left:{a:1,b:2},ordered:[{a:1,b:2},{a:3,b:4}]}}]
  g['public.users']=f.actors.map(a=>({id:a.id,role:a.role,email:a.email}))
  for(const s of m.schedules){const c=s.cohort
    for(const [cid,teacher_id,blueprint_source_revision,revision] of [[c.classroomId,f.actors[0].id,5,15],[c.foreignClassroomId,f.actors[1].id,2,6]] as const){
      g['public.classrooms'].push({id:cid,teacher_id,title:f.tag,class_code:cid,term_label:null,created_at:seedStamp,updated_at:seedStamp,start_date:null,end_date:null,archived_at:null,position:0,allow_enrollment:true,join_policy:'roster',lesson_plan_visibility:'current_week',theme_color:'blue',source_blueprint_id:null,source_blueprint_origin:null,source_blueprint_version_id:null,authoring_guidance_version_id:null,actual_site_slug:null,actual_site_published:false,actual_site_config:{overview:true,outline:true,resources:true,assignments:true,tests:true,lesson_plans:true,announcements:true,lesson_plan_scope:'current_week'},course_overview_markdown:'',course_outline_markdown:'',blueprint_source_revision,manual_attendance_source_mode:'manual',manual_attendance_revision:1,manual_attendance_session_starts_local:null,manual_attendance_session_ends_local:null,feature_visibility:{attendance:true,classwork:true,tests:true,gradebook:true,student_grades:false,calendar:true,syllabus:true,announcements:true,achievements:true}})
      g['public.classroom_archive_revisions'].push({classroom_id:cid,revision,updated_at:seedStamp})
      for(const [name,percentage,position,is_default] of [['Attendance',10,0,false],['Term',65,1,true],['Final',25,2,false]] as const)g['public.gradebook_categories'].push({id:generated(),classroom_id:cid,name,percentage,position,is_default,default_assessment_weight:10,created_at:seedStamp,updated_at:seedStamp})
    }
    for(const [eid,actor] of [[c.enrollmentId,f.actors[1].id],[c.readerEnrollmentId,f.actors[3].id]]){
      g['public.classroom_enrollments'].push({id:eid,classroom_id:c.classroomId,student_id:actor,created_at:seedStamp,manual_attendance_marks:{}})
      // Source-derived scope digest, genuine-shaped but explicitly mocked Pal reference.
      const scope=actor===f.actors[1].id?c.scopeDigest:scopeDigest(c.classroomId,actor)
      g['private.pal_membership_generations'].push({generation_id:eid,scope_digest:scope,pal_reference:'pika-membership-v1-'+(n++).toString(16).padStart(32,'0'),state:'active'})
    }
    for(const [sid,cid,owner,position,dynamic] of [[c.surveyId,c.classroomId,f.actors[0].id,0,s.index===14],[c.foreignSurveyId,c.foreignClassroomId,f.actors[1].id,0,false],[c.resultSurveyId,c.classroomId,f.actors[0].id,1,false]] as const)g['public.surveys'].push({id:sid,classroom_id:cid,created_by:owner,position,dynamic_responses:dynamic,title:f.tag,artifact_id:generated(),source_artifact_id:null,source_blueprint_version_id:null,blueprint_archived_at:null,status:'active',show_results:true,opens_at:null,created_at:seedStamp,updated_at:seedStamp})
    g['public.survey_questions'].push(...[c.question,c.aggregateQuestion].map(r=>({...r,created_at:seedStamp,updated_at:seedStamp})))
    g['public.survey_responses'].push({id:c.aggregateResponseId,survey_id:c.resultSurveyId,question_id:c.aggregateQuestion.id,student_id:f.actors[1].id,selected_option:null,response_text:'Synthetic shared result',submitted_at:seedStamp,updated_at:seedStamp})
  }
  return g
}
import {createHash} from 'node:crypto'
const scopeDigest=(cid:string,actor:string)=>createHash('sha256').update(`pika-membership-scope-v1:${cid}:${actor}`).digest('hex')
function admitSeed(m:ReturnType<typeof manifest>,g:Graph){const before=Object.fromEntries(Object.entries(g).map(([t,rows])=>[t,['public.untouched','public.users'].includes(t)?rows:[]]));verifySurveyCommittedSeed(m,before,g,{startedAt:seedStamp,endedAt:seedStamp,seedTimestamp:seedStamp});return before}
function changedCase(s:ReturnType<typeof manifest>['schedules'][number],before:Graph){
  const {index,direction,cohort:c}=s
  const after=structuredClone(before),one=(g:Graph,t:string,key:string,value:string)=>g[t].find(r=>r[key]===value)!
  const cl=one(after,'public.classrooms','id',c.classroomId),ar=one(after,'public.classroom_archive_revisions','classroom_id',c.classroomId),question=one(after,'public.survey_questions','id',c.question.id)
  const timestamp='2026-10-13T03:00:01Z';let delta=0
  if([0,1,8,9,10,11].includes(index)){
    if([0,1,8].includes(index))question.question_text='Concurrent question'
    if(index===9||index===10){question.question_type='multiple_choice';question.options=index===9?['A','B']:['Changed A','Changed B']}
    if(index===11)question.response_max_chars=1
    question.updated_at=timestamp;cl.blueprint_source_revision=6;cl.updated_at=timestamp;delta+=2
  }
  if(index===7){question.survey_id=c.foreignSurveyId;question.updated_at=timestamp;delta++
    const foreign=one(after,'public.classroom_archive_revisions','classroom_id',c.foreignClassroomId);foreign.revision=7;foreign.updated_at=timestamp}
  if(index===2){cl.teacher_id=f.actors[1].id;cl.updated_at=timestamp;delta++}
  const archivedAt='2026-10-13T03:00:01.250Z'
  if(index===3){cl.archived_at=archivedAt;cl.updated_at=timestamp;delta++}
  if(index===4){after['public.classroom_enrollments']=after['public.classroom_enrollments'].filter(r=>r.id!==c.enrollmentId);one(after,'private.pal_membership_generations','generation_id',c.enrollmentId).state='removed';delta++}
  if(index===12){const survey=one(after,'public.surveys','id',c.surveyId);survey.status='closed';survey.updated_at=timestamp;delta++}
  const responded=index>=13||index>=8&&index<=12&&direction==='reverse'
  const response={id:`cafebabe-0000-4000-8000-${(index*2+(direction==='reverse'?1:0)).toString(16).padStart(12,'0')}`,survey_id:c.surveyId,question_id:c.question.id,student_id:f.actors[1].id,selected_option:null,response_text:'Synthetic response',submitted_at:writeStamp,updated_at:index===14?timestamp:writeStamp}
  if(responded){after['public.survey_responses'].push(response);delta+=index===14?3:1}
  if(delta){ar.revision=15+delta;ar.updated_at=timestamp}
  const times={startedAt:writeStamp,endedAt:'2026-10-13T03:00:02Z',writerTimestamp:timestamp,responseId:responded?response.id:undefined,responseSubmittedAt:responded?writeStamp:undefined,responseTimestamp:responded?String(response.updated_at):undefined,firstResponse:index===14?{...response,updated_at:writeStamp}:undefined,
    archiveReceipt:index===3?{label:s.label,classroomId:c.classroomId,archivedAt,transactionTimestamp:timestamp,operationStartedAt:timestamp,operationFinishedAt:'2026-10-13T03:00:01.500Z'}:undefined}
  return {after,one,times,delta}
}
describe('source-only Survey committed directions', () => {
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
  it('does not invent a waiter for NOWAIT, but requires the actual held target', () => {
    const m = manifest(), s = m.schedules.find(s => s.mode === 'nowait')!
    const bootstrap = { holder: { pid: 101, started: '2026-10-13T03:00:00Z', name: m.projectId + '_draft_holder', database: 'postgres' as const, user: 'postgres' as const },
      contender: { pid: 102, started: '2026-10-13T03:00:01Z', name: m.projectId + '_draft_contender', database: 'postgres' as const, user: 'postgres' as const } }
    const sql = surveyCommittedObservationSql(m, s.label, bootstrap)
    expect(sql).toContain('pg_stat_clear_snapshot()')
    expect(sql).toContain('pg_blocking_pids')
    expect(sql).not.toContain('pg_sleep')
    expect(() => surveyCommittedObservationSql(m, s.label, { ...bootstrap, contender: { ...bootstrap.contender, name: 'foreign' } })).toThrow()
    const now = Date.parse('2026-10-13T03:00:02Z')
    const witness = { label: s.label, poll: 1, observedAt: '2026-10-13T03:00:02Z', holder: bootstrap.holder, contender: bootstrap.contender,
      held: { ...s.lock, xid: '900', relationOid: 123, tuple: '(0,1)', owned: true, identity: { locktype: 'transactionid', transactionid: '900' } }, blockers: [], waiter: null, code: 'PT409', immediateMs: 10 }
    const clock = { startedAt: now - 500, workDeadline: now + 100, dispatchedAt: now - 10, observedAt: now, contenderPending: false, poll: 1 }
    expect(verifySurveyCommittedWitness(m, s.label, bootstrap, witness, clock).nativeVerified).toBe(false)
    expect(() => verifySurveyCommittedWitness(m, s.label, bootstrap, { ...witness, held: { ...witness.held, targetId: f.classes[0].id } }, clock)).toThrow()
    expect(() => verifySurveyCommittedWitness(m, s.label, bootstrap, witness, { ...clock, workDeadline: now })).toThrow()
    expect(() => verifySurveyCommittedWitness(m, s.label, bootstrap, { ...witness, holder: { ...bootstrap.holder, started: '2026-10-13T02:00:00Z' } }, clock)).toThrow()
    expect(() => verifySurveyCommittedWitness(m, s.label, bootstrap, { ...witness, blockers: [101], waiter: { wait_event_type: 'Lock' } }, clock)).toThrow()
  })
  it('requires an actual pending edge to the exact backend and correct lock type', () => {
    const m = manifest(), s = m.schedules[0], now = Date.parse('2026-10-13T03:00:02Z')
    const bootstrap = { holder: { pid: 101, started: '2026-10-13T03:00:00Z', name: m.projectId + '_draft_holder', database: 'postgres' as const, user: 'postgres' as const },
      contender: { pid: 102, started: '2026-10-13T03:00:01Z', name: m.projectId + '_draft_contender', database: 'postgres' as const, user: 'postgres' as const } }
    const w = { label: s.label, poll: 1, observedAt: '2026-10-13T03:00:02Z', holder: bootstrap.holder, contender: bootstrap.contender,
      held: { ...s.lock, xid: '900', relationOid: 123, tuple: '(0,1)', owned: true, identity: { locktype: 'transactionid', transactionid: '900' } }, blockers: [101],
      waiter: { wait_event_type: 'Lock', wait_event: 'transactionid', state: 'active', identity: { locktype: 'transactionid', transactionid: '900' } } }
    const clock = { startedAt: now - 500, workDeadline: now + 100, dispatchedAt: now - 10, observedAt: now, contenderPending: true, poll: 1 }
    expect(verifySurveyCommittedWitness(m, s.label, bootstrap, w, clock).blockingEdgeVerified).toBe(true)
    for (const defect of [{ ...w, blockers: [999] }, { ...w, held: { ...w.held, owned: false } },
      { ...w, waiter: { ...w.waiter, wait_event: 'advisory' } },
      { ...w, waiter: { ...w.waiter, identity: { locktype: 'transactionid', transactionid: '901' } } }]) expect(() => verifySurveyCommittedWitness(m, s.label, bootstrap, defect, clock)).toThrow()
    expect(() => verifySurveyCommittedWitness(m, s.label, bootstrap, w, { ...clock, contenderPending: false })).toThrow()
    expect(() => verifySurveyCommittedWitness(m, s.label, bootstrap, w, { ...clock, poll: 4 })).toThrow()
    expect(() => verifySurveyCommittedWitness(m, s.label, bootstrap, w, { ...clock, dispatchedAt: now - 1000, startedAt: now - 1000 })).toThrow()
  })
  it('requires exact full graph, source membership and timestamps', () => {
    const m = manifest(), s = m.schedules.find(s => s.index === 5 && s.direction === 'forward')!
    const c = s.cohort
    const g = capturedSeed(m);admitSeed(m,g)
    const times = { startedAt: '2026-10-13T03:00:00Z', endedAt: '2026-10-13T03:00:01Z', writerTimestamp: '2026-10-13T03:00:00Z' }
    expect(verifySurveyCommittedEffects(m, s.label, g, g, times).nativeVerified).toBe(false)
    expect(() => verifySurveyCommittedEffects(m, s.label, g, { ...g, 'public.foreign': [] }, times)).toThrow()
    const altered = structuredClone(g); altered['private.pal_membership_generations'][0].state = 'removed'
    expect(() => verifySurveyCommittedEffects(m, s.label, g, altered, times)).toThrow()
    expect(() => verifySurveyCommittedEffects(m, s.label, g, g, { ...times, writerTimestamp: '2026-10-12T00:00:00Z' })).toThrow()
    const stale = structuredClone(g); stale['public.classrooms'][0].blueprint_source_revision=999
    expect(() => verifySurveyCommittedEffects(m, s.label, g, stale, times)).toThrow()
    const substituted = structuredClone(g); substituted['public.classroom_enrollments'][0].id = f.enrollments[1].id
    expect(() => verifySurveyCommittedEffects(m, s.label, g, substituted, times)).toThrow()
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
    const m=manifest(),g=capturedSeed(m),before=admitSeed(m,g)
    for(const defect of ['non-target','category','generation','stamp','revision'] as const){const bad=structuredClone(g)
      if(defect==='non-target')bad['public.untouched'][0].value='changed'
      if(defect==='category')bad['public.gradebook_categories'][0].percentage=99
      if(defect==='generation')bad['private.pal_membership_generations'][0].state='removed'
      if(defect==='stamp')bad['public.classroom_enrollments'][0].created_at='2026-10-12T00:00:00Z'
      if(defect==='revision')bad['public.classroom_archive_revisions'][0].revision=999
      expect(()=>verifySurveyCommittedSeed(m,before,bad,{startedAt:seedStamp,endedAt:seedStamp,seedTimestamp:seedStamp})).toThrow()
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
    expect(verifySurveyCommittedEffects(m,s.label,before,after,times)).toMatchObject({archiveRevisionDelta:delta,nativeVerified:false})
    const detail=(g:Graph,member:boolean)=>{const klass=one(g,'public.classrooms','id',c.classroomId);return{classroom:{id:klass.id,teacher_id:klass.teacher_id,archived_at:klass.archived_at},survey:one(g,'public.surveys','id',c.surveyId),questions:g['public.survey_questions'].filter(r=>r.survey_id===c.surveyId),responses:member?g['public.survey_responses'].filter(r=>r.survey_id===c.surveyId&&r.student_id===f.actors[1].id):[]}}
    const aggregate=(g:Graph)=>{const klass=one(g,'public.classrooms','id',c.classroomId),survey=one(g,'public.surveys','id',c.resultSurveyId),r=one(g,'public.survey_responses','id',c.aggregateResponseId);return{classroom:{id:klass.id,teacher_id:klass.teacher_id,archived_at:klass.archived_at},survey:{id:survey.id,title:survey.title,status:survey.status,show_results:survey.show_results,dynamic_responses:survey.dynamic_responses},results:[{question_id:c.aggregateQuestion.id,question_type:'short_text',question_text:c.aggregateQuestion.question_text,options:[],counts:[],total_responses:1,responses:[{response_id:r.id,response_text:r.response_text,submitted_at:r.submitted_at,updated_at:r.updated_at}]}]}}
    const success=(result:unknown)=>({code:null,result}),denied=(code:string)=>({code,result:null})
    const isRead=index<=7,firstRead=isRead&&([1,5,6].includes(index)?direction==='reverse':direction==='forward')
    const read=(g:Graph)=>index===5?aggregate(g):detail(g,[3,4].includes(index))
    const holder=success(firstRead?read(before):index>=13||index>=8&&direction==='reverse'?{success:true,updated:false}:null)
    const secondRead=isRead&&!firstRead,secondRespond=index>=13||index>=8&&direction==='forward'
    const contender=s.mode==='nowait'?denied('PT409'):success(secondRead?read(after):secondRespond?{success:true,updated:false}:null)
    const retry=s.mode==='nowait'?(s.retryCode?denied(s.retryCode):success(secondRead?read(after):secondRespond?{success:true,updated:index===14}:null)):undefined
    const probe=index>=8&&index<=11?'PT409':index===12||index===13?'PT400':null
    const receipts={holder,contender,retry,cachedQuestions:[one(before,'public.survey_questions','id',c.question.id)],freshRead:[2,3,4].includes(index)?denied('PT403'):success(index===5?aggregate(after):detail(after,![0,1,2,6,7].includes(index))),cachedResponseProbe:probe?denied(probe):null}
    expect(verifySurveyCommittedEnvelopes(m,s.label,before,after,receipts).nativeVerified).toBe(false)
    expect(()=>verifySurveyCommittedEnvelopes(m,s.label,before,after,{...receipts,freshRead:success({})})).toThrow()
    expect(()=>verifySurveyCommittedEnvelopes(m,s.label,before,after,{...receipts,cachedQuestions:[c.question]})).toThrow()
    const launderedBefore=structuredClone(before),launderedAfter=structuredClone(after)
    launderedBefore['public.users'][0].role='teacher';launderedAfter['public.users'][0].role='teacher'
    expect(()=>verifySurveyCommittedEnvelopes(m,s.label,launderedBefore,launderedAfter,receipts)).toThrow('Authenticated envelope graphs differ')
    const unrelated=structuredClone(after);unrelated['public.untouched'][0].value='changed'
    expect(()=>verifySurveyCommittedEffects(m,s.label,before,unrelated,times)).toThrow()
    const revision=structuredClone(after);one(revision,'public.classroom_archive_revisions','classroom_id',c.classroomId).revision=1000
    expect(()=>verifySurveyCommittedEffects(m,s.label,before,revision,times)).toThrow()
  })
})
