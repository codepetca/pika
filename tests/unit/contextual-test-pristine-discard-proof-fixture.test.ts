import { describe, expect, it } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerPristineDiscardFixture, TEST_OWNER_PRISTINE_DISCARD_CAPS, TEST_OWNER_PRISTINE_DISCARD_SNAPSHOT_TABLES,
  testOwnerPristineDiscardSetupSql, testOwnerPristineDiscardSnapshotSql, validateTestOwnerPristineDiscardSetupSnapshot,
  registerTestOwnerPristineDiscardWitness, verifyTestOwnerPristineDiscardEffects } from '../../scripts/contextual-test-pristine-discard-proof-fixture'

const original = newAssignmentListProofFixture(new Date('2026-10-06T03:00:00Z'))
const f = newTestOwnerPristineDiscardFixture(original)
const project = `pika_assignment_list_${f.tag.slice(-12)}`
type Row = Record<string, unknown>
export function baseline() {
  const s: Record<string, Row[]> = Object.fromEntries(TEST_OWNER_PRISTINE_DISCARD_SNAPSHOT_TABLES.map(t => [t, []]))
  s['public.users'] = f.actors.map(a => ({ ...a, preserved: true }))
  s['public.classrooms'] = f.classes.map(c => ({ id:c.id, teacher_id:c.owner, title:c.title, class_code:c.code,
    archived_at:c.archived ? f.now : null, blueprint_source_revision:7, updated_at:f.now, preserved:true }))
  s['public.classroom_archive_revisions'] = f.classes.map(c => ({ classroom_id:c.id, revision:13, updated_at:f.now }))
  s['public.gradebook_categories'] = f.classes.flatMap((c,ci) => [0,1,2].map(i => ({ id:`99999999-9999-4999-8999-${String(ci*3+i).padStart(12,'0')}`,
    classroom_id:c.id, is_default:i===0, position:i, default_assessment_weight:10 })))
  s['public.tests'] = f.tests.map(t => ({ ...t, gradebook_category_id:s['public.gradebook_categories'].find(c => c.classroom_id===t.classroom_id)!.id }))
  s['public.assessment_drafts'] = f.drafts.map(d => structuredClone(d))
  s['public.classroom_enrollments'] = f.enrollments.map(e => ({...e,created_at:f.now}))
  s['public.test_student_availability'] = f.availability.map(r => ({...r,created_at:f.now,updated_at:f.now}))
  s['public.gradebook_score_overrides'] = f.overrides.map(r => ({...r,created_at:f.now,updated_at:f.now}))
  s['private.pal_membership_generations'] = [{generation_id:f.retainedEnrollment.id,state:'removed',scope_digest:'a'.repeat(64)}]
  s.__nontarget_fingerprints = [...TEST_OWNER_PRISTINE_DISCARD_SNAPSHOT_TABLES,'storage.objects','storage.buckets'].map(table => ({table,fingerprint:'unchanged'}))
  return s
}
function witness(s:ReturnType<typeof baseline>,label=f.cases[0].label) {
  const c=f.cases.find(c=>c.label===label)!;const test=s['public.tests'].find(t=>t.id===c.testId)!
  const draft=s['public.assessment_drafts'].find(d=>d.assessment_id===c.testId)??null
  return {version:1,actor_id:c.actorId,test_id:c.testId,classroom:{id:test.classroom_id,teacher_id:c.actorId,archived_at:null},test,draft,
    discarded:c.expectedDiscarded,...(c.expectedDiscarded===false?{reason:'draft_changed'}:{})}
}
describe('finite synthetic pristine discard source',()=>{
  it('freezes a deterministic disjoint genuine1001 source and18+2 fixed cases',()=>{
    expect(newTestOwnerPristineDiscardFixture(original)).toEqual(f)
    expect(f.tests).toHaveLength(1001);expect(f.classes).toHaveLength(4);expect(f.cases).toHaveLength(18);expect(f.privilegeProbes).toHaveLength(2)
    expect(f.actors.map(a=>a.role)).toEqual(['student','teacher','student','teacher'])
    expect(Object.isFrozen(f.cases[0].input)).toBe(true)
    expect(new Set(f.allocatedIds).size).toBe(f.allocatedIds.length)
    expect(f.allocatedIds.some(id=>original.allocatedIds.includes(id))).toBe(false)
    expect(f.privilegeProbes.map(p=>p.context)).toEqual(['outer-rpc-acl','inner-156-capability'])
    expect(f.cases.find(c=>c.label==='later-version-pristine')!.input.expected_draft_version).toBe(7)
    expect(f.cases.filter(c=>c.expectedDiscarded===true)).toHaveLength(6)
  })
  it('authors fixed immutable CAS stamps with natural counters and no cleanup/bypass',()=>{
    const sql=testOwnerPristineDiscardSetupSql(f,project)
    expect(Buffer.byteLength(sql)).toBeLessThanOrEqual(TEST_OWNER_PRISTINE_DISCARD_CAPS.sqlBytes)
    expect(sql).toContain('updated_at');expect(sql).toContain(f.now)
    expect(sql).toContain('insert into public.assessment_drafts')
    expect(sql).not.toMatch(/delete from public\.(?!classroom_enrollments\b)|delete from private\.|truncate |set (blueprint_source_revision|revision)\s*=|set_config/i)
    expect(()=>testOwnerPristineDiscardSetupSql(f,'production')).toThrow()
  })
  it('creates a retained unenrolled mark through natural membership transitions without bypassing164/168',()=>{
    const sql=testOwnerPristineDiscardSetupSql(f,project)
    const retained=f.retainedEnrollment
    expect(f.allocatedIds).toContain(retained.id)
    expect(f.enrollments).toHaveLength(4)
    expect(f.enrollments.some(e=>e.classroom_id===retained.classroom_id&&e.student_id===retained.student_id)).toBe(false)
    expect(retained.student_id).toBe(f.overrides[0].student_id)
    const insert=`insert into public.classroom_enrollments(id,classroom_id,student_id) values ('${retained.id}','${retained.classroom_id}','${retained.student_id}');`
    const deletion=`delete from public.classroom_enrollments where id='${retained.id}' and classroom_id='${retained.classroom_id}' and student_id='${retained.student_id}';`
    expect(sql).toContain(insert);expect(sql).toContain(deletion)
    expect(sql.indexOf(insert)).toBeLessThan(sql.indexOf('insert into public.gradebook_score_overrides'))
    expect(sql.indexOf('insert into public.gradebook_score_overrides')).toBeLessThan(sql.indexOf(deletion))
    expect(sql).toContain("state='removed'")
    expect(sql).not.toMatch(/disable trigger|session_replication_role|is_classroom_archive_maintenance_mode\s*\(|set_config|update private\.pal_membership_generations/i)
    const before=baseline(),tables=before.__nontarget_fingerprints.map(r=>String(r.table))
    expect(validateTestOwnerPristineDiscardSetupSnapshot(f,before,tables)).toEqual(before)
    for(const state of ['active','purged']){
      const bad=structuredClone(before);bad['private.pal_membership_generations'][0].state=state
      expect(()=>validateTestOwnerPristineDiscardSetupSnapshot(f,bad,tables)).toThrow()
    }
    const missing=structuredClone(before);missing['private.pal_membership_generations']=[]
    expect(()=>validateTestOwnerPristineDiscardSetupSnapshot(f,missing,tables)).toThrow()
  })
  it('captures fixed IDs OR current scope, all dependency tables and complete global catalog fingerprints',()=>{
    const sql=testOwnerPristineDiscardSnapshotSql(f)
    expect(sql).toContain('repeatable read read only');expect(sql).toContain(f.tests[0].id)
    expect(sql).toContain('id in (');expect(sql).toContain('or classroom_id in (')
    for(const table of ['test_focus_events','test_ai_grading_runs','test_ai_grading_run_items','classroom_guided_draft_provenance','gradebook_score_overrides'])expect(sql).toContain(table)
    expect(sql).toContain("n.nspname in ('public','private','storage')")
  })
  it('binds external full catalog and rejects missing/altered source preimages',()=>{
    const s=baseline();const tables=s.__nontarget_fingerprints.map(r=>String(r.table))
    expect(validateTestOwnerPristineDiscardSetupSnapshot(f,s,tables)).toEqual(s)
    expect(()=>validateTestOwnerPristineDiscardSetupSnapshot(f,s,tables.slice(1))).toThrow()
    for(const table of ['public.tests','public.assessment_drafts','public.users','public.gradebook_categories']) {
      const bad=structuredClone(s);bad[table].pop();expect(()=>validateTestOwnerPristineDiscardSetupSnapshot(f,bad,tables)).toThrow()
    }
    const bad=structuredClone(s);bad['public.tests'][0].show_results=true
    expect(()=>validateTestOwnerPristineDiscardSetupSnapshot(f,bad,tables)).toThrow()
  })
})
describe('closed discard witness/effect acceptance',()=>{
  function selectedPair() {
    const before=baseline();const e=witness(before);const after=structuredClone(before);const stamp='2026-10-06T04:00:00Z'
    after['public.tests']=after['public.tests'].filter(t=>t.id!==e.test_id)
    after['public.assessment_drafts']=after['public.assessment_drafts'].filter(d=>d.assessment_id!==e.test_id)
    const classroom=after['public.classrooms'].find(c=>c.id===e.classroom.id)!;classroom.blueprint_source_revision=9;classroom.updated_at=stamp
    const archive=after['public.classroom_archive_revisions'].find(c=>c.classroom_id===e.classroom.id)!;archive.revision=17;archive.updated_at=stamp
    const pending=registerTestOwnerPristineDiscardWitness(f,[],f.cases[0].label,e,{startMs:Date.parse(stamp)-1000,deadlineMs:Date.parse(stamp)+1000})
    return { before, e, after, stamp, pending }
  }
  it('accepts only exact selected pair deletion and whole +2/+4 rows with shared transaction stamp',()=>{
    const {before,after,stamp,pending}=selectedPair()
    expect(pending[0].state).toBe('provisional')
    const accepted=verifyTestOwnerPristineDiscardEffects(f,before,after,f.cases[0].label,pending,{discarded:true},stamp)
    expect(accepted[0].state).toBe('verified');expect(Object.isFrozen(accepted[0])).toBe(true)
  })
  it('rejects a second pending witness before the first effect is verified',()=>{
    const {e,pending}=selectedPair()
    expect(()=>registerTestOwnerPristineDiscardWitness(f,pending,f.cases[1].label,e)).toThrow()
  })
  it('rejects reuse of an already verified discard witness',()=>{
    const {before,after,stamp,pending}=selectedPair()
    const accepted=verifyTestOwnerPristineDiscardEffects(f,before,after,f.cases[0].label,pending,{discarded:true},stamp)
    expect(()=>verifyTestOwnerPristineDiscardEffects(f,before,after,f.cases[0].label,accepted,{discarded:true},stamp)).toThrow()
  })
  it.each(['draft-restored','classroom-drift','fingerprint-drift','test-drift'] as const)('rejects selected-pair %s with the complete1001-row fixture',kind=>{
    const {before,after,stamp,pending}=selectedPair();const bad=structuredClone(after)
    if(kind==='draft-restored')bad['public.assessment_drafts']=before['public.assessment_drafts']
    else if(kind==='classroom-drift')bad['public.classrooms'][0].preserved=false
    else if(kind==='fingerprint-drift')bad.__nontarget_fingerprints[0].fingerprint='changed'
    else bad['public.tests'][0].title='drift'
    expect(()=>verifyTestOwnerPristineDiscardEffects(f,before,bad,f.cases[0].label,pending,{discarded:true},stamp)).toThrow()
  })
  it('rejects private reason fields on a public success result',()=>{
    const {before,after,stamp,pending}=selectedPair()
    expect(()=>verifyTestOwnerPristineDiscardEffects(f,before,after,f.cases[0].label,pending,{discarded:true,reason:'private'},stamp)).toThrow()
  })
  it.each(['stale-version','stale-test-cas','title-changed','missing-draft','availability-child','retained-override'])('false %s retains every complete row',label=>{
    const s=baseline();const e=witness(s,label);const pending=registerTestOwnerPristineDiscardWitness(f,[],label,e)
    expect(verifyTestOwnerPristineDiscardEffects(f,s,s,label,pending,{discarded:false,test:e.test})[0].state).toBe('verified')
    const bad=structuredClone(s);bad['public.tests'][0].title='drift'
    expect(()=>verifyTestOwnerPristineDiscardEffects(f,s,bad,label,pending,{discarded:false,test:e.test})).toThrow()
  })
  it.each([...f.cases.filter(c=>c.expectedHTTP!==200),...f.privilegeProbes])('denial/probe $label requires whole equality and no witness/public result',c=>{
    const s=baseline()
    expect(verifyTestOwnerPristineDiscardEffects(f,s,s,c.label,[])).toEqual([])
    expect(()=>verifyTestOwnerPristineDiscardEffects(f,s,s,c.label,[],{discarded:true})).toThrow()
  })
  it('rejects unbound/current-owner/private-shape witnesses',()=>{
    const e=witness(baseline())
    for(const bad of [{...e,extra:true},{...e,actor_id:f.actors[2].id},{...e,test_id:f.missingTestId},
      {...e,classroom:{...e.classroom,teacher_id:f.actors[2].id}},{...e,draft:null}])expect(()=>registerTestOwnerPristineDiscardWitness(f,[],f.cases[0].label,bad)).toThrow()
  })
  it('preserves microsecond CAS and permits equivalent timestamp offsets',()=>{
    const e=witness(baseline());e.test.updated_at='2026-10-05T23:00:00.000000-04:00'
    expect(()=>registerTestOwnerPristineDiscardWitness(f,[],f.cases[0].label,e)).not.toThrow()
    e.test.updated_at='2026-10-06T03:00:00.000001Z'
    expect(()=>registerTestOwnerPristineDiscardWitness(f,[],f.cases[0].label,e)).toThrow()
  })
  it('refuses manually promoted/cloned ledgers and ancillary before-row drift across verified operations',()=>{
    const s=baseline();const label='missing-draft';const e=witness(s,label)
    const pending=registerTestOwnerPristineDiscardWitness(f,[],label,e)
    const promoted=structuredClone(pending);promoted[0].state='verified'
    expect(()=>registerTestOwnerPristineDiscardWitness(f,promoted,'stale-version',witness(s,'stale-version'))).toThrow()
    const accepted=verifyTestOwnerPristineDiscardEffects(f,s,s,label,pending,{discarded:false,test:e.test})
    const next=registerTestOwnerPristineDiscardWitness(f,accepted,'stale-version',witness(s,'stale-version'))
    const drift=structuredClone(s);drift['public.users'][0].preserved=false
    expect(()=>verifyTestOwnerPristineDiscardEffects(f,drift,drift,'stale-version',next,{discarded:false,test:witness(s,'stale-version').test})).toThrow()
    const driftStamp=structuredClone(s);driftStamp['public.tests'][0].updated_at='2026-10-06T03:00:00.000001Z'
    expect(()=>validateTestOwnerPristineDiscardSetupSnapshot(f,driftStamp,s.__nontarget_fingerprints.map(r=>String(r.table)))).toThrow()
  })
})
