import {describe,expect,it} from 'vitest'
import {createHash} from 'node:crypto'
import {newSurveyNativeFixture} from '../../scripts/contextual-surveys-native-contracts'
import {newAssignmentListProofFixture} from '../../scripts/contextual-assignment-list-proof-fixture'
import {surveyCommittedProofManifest} from '../../scripts/contextual-surveys-committed-proof'
import {verifySurveyCommittedEnvelopes,verifySurveyCommittedEffects} from '../../scripts/contextual-surveys-committed-proof'
import {surveyCommittedCpuFixtures} from '../helpers/survey-committed-cpu-fixtures'
import {surveyCancellationProofDescriptor} from '../../scripts/contextual-surveys-cancellation-proof'
import {surveyWireProofDescriptor,validateSurveyWireSql,verifySurveyPrimaryMembership,inspectSurveyWireReceipt} from '../../scripts/contextual-surveys-wire-proof'
const f=newSurveyNativeFixture(newAssignmentListProofFixture(new Date('2026-10-12T12:00:00Z'))),m=surveyCommittedProofManifest(f)
const h=(s:string)=>createHash('sha256').update(s).digest('hex')
describe('closed wire fixture and primary membership source proof (no SQL/native)',()=>{
  it('binds each complete generated guard to its one actual fixed holder or fixture dispatch identity',()=>{
    const c=surveyCancellationProofDescriptor(f),w=surveyWireProofDescriptor(f)
    for(const [sql,suffix]of [[c.frames.prepare,'draft_holder'],[c.frames.observer,'draft_holder'],[w.frames.prepare,'draft_holder'],[c.frames.restoreBeforeDispatch,'fixture'],[c.frames.restoreAfterDispatch,'fixture'],[w.frames.restore,'fixture']]){
      const expected=[...sql.matchAll(/current_setting\('application_name'\)<>'([^']+)'/g)]
      expect(expected).toHaveLength(1);expect(expected[0][1]).toBe(`${f.projectId}_${suffix}`)
      const guard=sql.slice(0,sql.indexOf('end;$guard$;')+'end;$guard$;'.length)
      // The instrumentation body legitimately marks the PostgREST backend;
      // the target guard itself must never rename its native session.
      expect(guard).not.toMatch(/set(?:_config|\s+(?:local\s+)?)\(?['"]?application_name/i)
      expect(sql).toContain('Integrated guards or buckets differ');expect(sql).toContain('Test proof bucket differs')
      for(const wrong of ['fixture','draft_holder','draft_contender'].filter(s=>s!==suffix))expect(expected[0][1]).not.toBe(`${f.projectId}_${wrong}`)
    }
  })
  it('pins foreign original read and only two fixed SQL frames with no executor/admission',()=>{
    const d=surveyWireProofDescriptor(f)
    expect(d).toEqual(surveyWireProofDescriptor(f));expect(d.nativeVerified).toBe(false);expect(d.executionEnabled).toBe(false)
    expect(d.request.body).toEqual({p_actor_id:f.actors[1].id,p_survey_id:f.surveys[1].id})
    expect(d.request.path).toBe('/rest/v1/rpc/get_survey_for_owner_v1')
    for(const key of ['prepare','restore'] as const){expect(validateSurveyWireSql(d,key,d.frames[key])).toBe(true);expect(validateSurveyWireSql(d,key,d.frames[key]+' ')).toBe(false);expect(Buffer.byteLength(d.frames[key])).toBeLessThan(262144)}
    expect(validateSurveyWireSql({...d},'prepare',d.frames.prepare)).toBe(false)
    expect(d.frames.prepare).toContain("'{updated_at}',to_jsonb(transaction_timestamp())")
    expect(d.frames.prepare.match(/update public\.surveys set title=/g)).toHaveLength(1)
    expect(d.frames.restore.match(/update public\.surveys set title=/g)).toHaveLength(1)
    expect(d.frames.prepare).toContain('inner_size=8388608')
    expect(d.frames.prepare).toContain('minimum_size>8388608')
    expect(d.frames.prepare).toContain("position(chr(92) in payload::text)=0")
    expect(d.frames.prepare).toContain("to_regprocedure('pg_temp.survey_cancel_state()')")
    expect(d.frames.prepare.indexOf('do $guard$')).toBeLessThan(d.frames.prepare.indexOf('create or replace function pg_temp.survey_cancel_state'))
    expect(d.frames.restore).toContain("pg_temp.survey_cancel_state()=actual")
    expect(d.frames.prepare).toContain("chr(32)||chr(9)||chr(13)||chr(10)")
    expect(d.frames.restore).toContain("normalized=captured")
    expect(d.frames.restore).not.toMatch(/set\s+(revision|blueprint_source_revision|updated_at)|disable\s+trigger|maintenance_mode|identity_mapping/i)
    expect(d.frames.restore).toContain('::bigint+2');expect(d.frames.restore).toContain('::bigint+4')
  })
  it('strictly parses compact wire receipts but cannot turn public matching data into provenance',()=>{
    const d=surveyWireProofDescriptor(f),prepared={stage:'wire-prepared',descriptorSha256:d.descriptorSha256,innerBytes:8388608,minimumWireBytes:8388609,sqlWireBytes:8388700,nativeVerified:false}
    expect(inspectSurveyWireReceipt(d,'wire-prepared',prepared).nativeVerified).toBe(false)
    const restored={stage:'wire-restored',descriptorSha256:d.descriptorSha256,archiveRevisionDelta:4,blueprintRevisionDelta:2,stateSha256:'a'.repeat(64),nativeVerified:false}
    expect(inspectSurveyWireReceipt(d,'wire-restored',restored).nativeVerified).toBe(false)
    for(const bad of [{...prepared,minimumWireBytes:8388608},{...prepared,sqlWireBytes:8388608+4097},{...prepared,innerBytes:8388607},{...prepared,extra:true},{...prepared,stage:'absent-unverified'},{...prepared,nativeVerified:true}])expect(()=>inspectSurveyWireReceipt(d,'wire-prepared',bad)).toThrow()
    expect(()=>inspectSurveyWireReceipt(d,'wire-restored',{...restored,archiveRevisionDelta:2})).toThrow()
    expect(()=>inspectSurveyWireReceipt({...d},'wire-prepared',prepared)).toThrow()
  })
  it('independently distinguishes SQL inner8MiB from minimum ASCII wrapper bytes without allocating giant payloads',()=>{
    const survey={id:f.surveys[1].id,classroom_id:f.classes[1].id,created_by:f.actors[1].id,title:'',status:'active',show_results:true,dynamic_responses:false,opens_at:'2026-10-12T00:00:00+00:00',created_at:'2026-10-12T00:00:00+00:00',updated_at:'2026-10-18T03:42:28.123456+00:00',position:0,artifact_id:f.question.artifact_id,source_artifact_id:null,source_blueprint_version_id:null,blueprint_archived_at:null}
    const jsonb=(v:unknown):string=>Array.isArray(v)?`[${v.map(jsonb).join(', ')}]`:v&&typeof v==='object'?`{${Object.entries(v).map(([k,x])=>`${JSON.stringify(k)}: ${jsonb(x)}`).join(', ')}}`:JSON.stringify(v)
    const overhead=Buffer.byteLength(jsonb(survey))+4,pad=8388608-overhead
    const payload={classroom:{id:f.classes[1].id,teacher_id:f.actors[1].id,archived_at:null},survey,questions:[],responses:[]}
    expect(overhead+pad).toBe(8388608)
    expect(Buffer.byteLength(JSON.stringify(payload))+pad).toBeGreaterThan(8388608)
    expect(Buffer.byteLength(jsonb(payload))+pad).toBeLessThan(8388608+4096)
  })
  function memberships(){
    const removed=m.schedules.filter(s=>s.effects.membershipRemoved),primary=f.enrollments[1]
    const entries=[{id:primary.id,classroom_id:primary.classroomId,student_id:primary.actorId,created_at:'2026-10-12T00:00:00Z',manual_attendance_marks:{}},
      ...removed.map(s=>({id:s.cohort.enrollmentId,classroom_id:s.cohort.classroomId,student_id:f.actors[1].id,created_at:'2026-10-12T00:00:00Z',manual_attendance_marks:{}})),
      {id:f.enrollments[0].id,classroom_id:f.classes[0].id,student_id:f.actors[0].id,created_at:'2026-10-12T00:00:00Z',manual_attendance_marks:{}}]
    const generations=entries.map(r=>({generation_id:r.id,scope_digest:h(`pika-membership-scope-v1:${r.classroom_id}:${r.student_id}`),pal_reference:'pika-membership-v1-'+h(r.id).slice(0,32),state:'active'}))
    const seed={'public.classroom_enrollments':entries,'private.pal_membership_generations':generations},after=structuredClone(seed),ids=new Set(removed.map(s=>s.cohort.enrollmentId))
    after['public.classroom_enrollments']=after['public.classroom_enrollments'].filter(r=>!ids.has(r.id));after['private.pal_membership_generations'].forEach(r=>{if(ids.has(r.generation_id))r.state='removed'})
    return {seed,after}
  }
  it('keeps the actual primary unchanged and both isolated retired generations, without an impossible primary INSERT',()=>{
    const {seed,after}=memberships();expect(verifySurveyPrimaryMembership(f,m,seed,after)).toEqual({primaryUnchanged:true,removedCohorts:2,nativeVerified:false})
  })
  it.each(['primary-drift','primary-removed','primary-replaced','primary-generation','first-reactivated','second-reactivated','first-reinserted','second-reinserted','other-removed','retired-deleted'])('refuses membership invariant defect%s',defect=>{
    const {seed,after}=memberships(),enroll=after['public.classroom_enrollments'],gens=after['private.pal_membership_generations']
    if(defect==='primary-drift')enroll[0].manual_attendance_marks={changed:true}
    if(defect==='primary-removed')enroll.splice(0,1)
    if(defect==='primary-replaced')enroll[0].id=f.replacementEnrollment.id
    if(defect==='primary-generation')gens.push({...gens[0],generation_id:f.replacementEnrollment.id})
    if(defect==='first-reactivated')gens[1].state='active'
    if(defect==='second-reactivated')gens[2].state='active'
    if(defect==='first-reinserted')enroll.push(seed['public.classroom_enrollments'][1])
    if(defect==='second-reinserted')enroll.push(seed['public.classroom_enrollments'][2])
    if(defect==='other-removed')enroll.pop()
    if(defect==='retired-deleted')gens.splice(1,1)
    expect(()=>verifySurveyPrimaryMembership(f,m,seed,after)).toThrow()
  })
  it.each(['forward','reverse'] as const)('retains the real committed removed-cohort terminal PT403 oracle (%s)',direction=>{
    const current=surveyCommittedProofManifest(f),s=current.schedules.find(s=>s.index===4&&s.direction===direction)!,helper=surveyCommittedCpuFixtures(f),before=helper.capturedSeed(current)
    helper.admitSeed(current,before);const {after,times}=helper.changedCase(s,before),e=helper.envelopes(s,before,after)
    verifySurveyCommittedEffects(current,s.label,before,after,times)
    expect(e.freshRead.code).toBe('PT403')
    expect(()=>verifySurveyCommittedEnvelopes(current,s.label,before,after,e)).not.toThrow()
    expect(()=>verifySurveyCommittedEnvelopes(current,s.label,before,after,{...e,freshRead:{code:null,result:{}}})).toThrow()
  })
})
