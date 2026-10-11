/** Inert finite DELETE proof source. SQL/catalog assumptions require fresh native
 * acceptance. Identities grant no cleanup authority; dispose the exact project. */
import assert from 'node:assert/strict'
import { z } from 'zod'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { testOwnerDigest, testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
import { TEST_OWNER_CREATE_CAPS, TEST_OWNER_CREATE_SNAPSHOT_TABLES } from './contextual-test-owner-create-proof-fixture'
import { contextualTestPristineDiscardResultSchema } from '../src/lib/validations/contextual-test-pristine-discard'
import { contextualTestListTestSchema } from '../src/lib/validations/contextual-test-list-read'
import { contextualTestDraftGetRowSchema } from '../src/lib/validations/contextual-test-draft-get'
import { boundedAssignmentListJson } from '../src/lib/validations/contextual-assignment-list-read'

export const TEST_OWNER_PRISTINE_DISCARD_CAPS = Object.freeze({ ...TEST_OWNER_CREATE_CAPS, totalBytes:64*1024*1024 })
export const TEST_OWNER_PRISTINE_DISCARD_SNAPSHOT_TABLES = Object.freeze([...TEST_OWNER_CREATE_SNAPSHOT_TABLES,
  'public.test_focus_events','public.test_ai_grading_runs','public.test_ai_grading_run_items','public.test_attempt_history',
  'public.classroom_guided_draft_provenance','public.gradebook_score_overrides'])
const q=(s:string)=>`'${s.replaceAll("'","''")}'`
function freeze<T>(v:T):T {if(v && typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v}
export function newTestOwnerPristineDiscardFixture(original:AssignmentListProofFixture) {
  assert.match(original.manifest.syntheticTag,/^assignmentlist_[a-f0-9]{12}$/)
  assert(Number.isFinite(Date.parse(original.manifest.now)));assert(original.allocatedIds.length<=20000)
  const tag=`testownerpristinediscard_${original.manifest.syntheticTag.slice(-12)}`;const now=original.manifest.now
  const id=(label:string)=>{const h=testOwnerDigest(`${tag}:${label}`);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`}
  const actors=(['student','teacher','student','teacher'] as const).map((role,i)=>({id:id(`actor${i}`),role,email:`${tag}_${i}@example.invalid`}))
  const classes=[0,1,2,3].map(i=>({id:id(`class${i}`),owner:actors[i===1?1:0].id,title:`${tag} Class ${i}`,code:`${tag}_${i}`,archived:i===2}))
  const labels=['student-owner','teacher-owner','self-enrolled-owner','later-version-pristine','different-historical-creator',
    'stale-version','stale-test-cas','title-changed','missing-draft','availability-child','retained-override',
    'student-member-denied','teacher-member-denied','unrelated-owner-denied','archived-class-denied','retired-test-denied','missing-test','restored-privilege-success'] as const
  const missingTestId=id('missing-test');const testId=(label:string)=>label==='missing-test'?missingTestId:id(`target:${label}`)
  const ciFor=(label:string)=>label==='teacher-owner'?1:label==='archived-class-denied'?2:label==='different-historical-creator'?3:0
  const aiFor=(label:string)=>label==='teacher-owner'?1:label==='student-member-denied'?2:label==='teacher-member-denied'?3:label==='unrelated-owner-denied'?1:0
  const targetLabels=labels.filter(l=>l!=='missing-test')
  const makeTest=(label:string,i:number,ci:number)=>({id:testId(label),artifact_id:id(`artifact:${label}`),classroom_id:classes[ci].id,
    created_by:actors[label==='different-historical-creator'?3:ci===1?1:0].id,title:label==='title-changed'?'Edited title':label.startsWith('bulk')?`${tag} ${label}`:'Untitled',
    status:'draft' as const,show_results:false,documents:[],position:i,points_possible:100,include_in_final:true,created_at:now,updated_at:now,
    source_artifact_id:null,source_blueprint_version_id:null,blueprint_archived_at:label==='retired-test-denied'?now:null,questions_locked_at:null,
    gradebook_category_id:null,gradebook_weight:10,gradebook_maximum_override:null,gradebook_score_scale:1})
  const tests=[...targetLabels.map((l,i)=>makeTest(l,i,ciFor(l))),...Array.from({length:1001-targetLabels.length},(_,i)=>makeTest(`bulk${i}`,i,3))]
  const drafts=targetLabels.filter(l=>l!=='missing-draft').map(label=>({id:id(`draft:${label}`),assessment_type:'test' as const,
    assessment_id:testId(label),classroom_id:classes[ciFor(label)].id,version:label==='later-version-pristine'?7:1,
    content:{title:label==='title-changed'?'Edited title':'Untitled',show_results:false,question_identity_version:1,questions:[],source_format:'markdown'},
    created_by:actors[label==='different-historical-creator'?3:ciFor(label)===1?1:0].id,
    updated_by:actors[label==='different-historical-creator'?3:ciFor(label)===1?1:0].id,created_at:now,updated_at:now}))
  const enrollments=[[0,0],[0,2],[0,3],[1,1]].map(([ci,ai],i)=>({id:id(`enrollment${i}`),classroom_id:classes[ci].id,student_id:actors[ai].id}))
  const retainedEnrollment={id:id('retained-enrollment'),classroom_id:classes[0].id,student_id:actors[1].id}
  const availability=[{id:id('availability'),test_id:testId('availability-child'),student_id:actors[2].id,state:'closed',updated_by:actors[0].id}]
  // Actor1 is enrolled while the mark is created, then naturally unenrolled.
  // The retained mark and closed168 generation must both remain in the baseline.
  const overrides=[{id:id('retained-override'),classroom_id:classes[0].id,student_id:actors[1].id,assessment_type:'test',
    assessment_id:testId('retained-override'),earned:0,created_by:actors[0].id}]
  const cases=labels.map(label=>{
    const denial=label.endsWith('-denied') || label==='missing-test';const falseResult=['stale-version','stale-test-cas','title-changed','missing-draft','availability-child','retained-override'].includes(label)
    return {label,actorId:actors[aiFor(label)].id,testId:testId(label),input:{expected_draft_version:label==='later-version-pristine'?7:label==='stale-version'?2:1,
      expected_test_updated_at:label==='stale-test-cas'?new Date(Date.parse(now)-1000).toISOString():now},
      expectedHTTP:(label==='missing-test'?404:denial?403:200) as 200|403|404|503,expectedDiscarded:denial?undefined:!falseResult}
  })
  const restored=cases.find(c=>c.label==='restored-privilege-success')!
  const privilegeProbes=(['outer-rpc-acl','inner-156-capability'] as const).map(context=>({...restored,label:`raw-42501-${context}`,context,
    expectedHTTP:503 as const,expectedDiscarded:undefined,expectedCode:'42501' as const}))
  const allocatedIds=[...actors.map(a=>a.id),...classes.map(c=>c.id),...tests.flatMap(t=>[t.id,t.artifact_id]),...drafts.map(d=>d.id),
    ...enrollments.map(e=>e.id),retainedEnrollment.id,...availability.map(r=>r.id),...overrides.map(r=>r.id),missingTestId]
  assert.equal(new Set(allocatedIds).size,allocatedIds.length);const originalIds=new Set<string>(original.allocatedIds)
  assert(allocatedIds.every(i=>!originalIds.has(i)));assert(cases.length+privilegeProbes.length<=TEST_OWNER_PRISTINE_DISCARD_CAPS.rpcRequests)
  return freeze({version:1 as const,tag,now,actors,classes,tests,drafts,enrollments,retainedEnrollment,availability,overrides,cases,privilegeProbes,missingTestId,allocatedIds,
    inventory:{actors:4,classes:4,tests:1001,drafts:drafts.length,enrollments:4,triggerCategories:12,archiveRevisionRows:4,cases:18,successes:6},
    nativeVerified:false as const,caveats:['Full156 predicate and dualCAS retained; later pristine version may delete',
      'Managed writer sequence is nontransactional; never reset or claimed equal','Lost acknowledgement fails run; no retry/discovery/cleanup',
      'Legacy no-FK stale override insertion may occur after discard; no orphan-proof claim']})
}
export type TestOwnerPristineDiscardFixture=ReturnType<typeof newTestOwnerPristineDiscardFixture>
function boundedSql(sql:string){assert(Buffer.byteLength(sql)<=TEST_OWNER_PRISTINE_DISCARD_CAPS.sqlBytes);return sql}
export function testOwnerPristineDiscardSetupSql(f:TestOwnerPristineDiscardFixture,projectId:string) {
  assert.equal(projectId,`pika_assignment_list_${f.tag.slice(-12)}`)
  const json=(v:unknown)=>`${q(JSON.stringify(v))}::jsonb`
  return boundedSql(`${testOwnerGuardSql(projectId)}
begin;set local lock_timeout='3s';set local statement_timeout='30s';
do $collision$ declare owned uuid[]:=array[${f.allocatedIds.map(q).join(',')}]::uuid[];begin
 if ${['users','classrooms','tests','test_questions','assessment_drafts','classroom_enrollments','test_student_availability','gradebook_score_overrides','managed_storage_objects'].map(t=>`exists(select 1 from public.${t} where id=any(owned))`).join('\n or ')}
 or exists(select 1 from public.users where email like ${q(f.tag+'%')})
 or exists(select 1 from public.classrooms where class_code like ${q(f.tag+'%')})
 or exists(select 1 from public.tests where classroom_id=any(owned) or artifact_id=any(owned) or source_artifact_id=any(owned))
 or exists(select 1 from public.assessment_drafts where classroom_id=any(owned) or assessment_id=any(owned))
 or exists(select 1 from public.gradebook_categories where classroom_id=any(owned))
 or exists(select 1 from public.classroom_enrollments where classroom_id=any(owned) or student_id=any(owned))
 or exists(select 1 from public.managed_storage_objects where classroom_id=any(owned) or resource_id=any(owned))
 or exists(select 1 from public.managed_storage_json_references where test_id=any(owned) or managed_object_id=any(owned))
 or exists(select 1 from public.classroom_guided_draft_provenance where test_id=any(owned) or draft_id=any(owned) or classroom_id=any(owned))
 or exists(select 1 from public.gradebook_score_overrides where classroom_id=any(owned) or assessment_id=any(owned))
 or exists(select 1 from private.pal_membership_generations where generation_id=any(owned))
 then raise exception 'Pristine discard namespace collision';end if;end;$collision$;
insert into public.users(id,email,role) values ${f.actors.map(a=>`(${q(a.id)},${q(a.email)},${q(a.role)})`).join(',')};
insert into public.classrooms(id,teacher_id,title,class_code,feature_visibility) values ${f.classes.map(c=>`(${q(c.id)},${q(c.owner)},${q(c.title)},${q(c.code)},'{"classwork":false}'::jsonb)`).join(',')};
insert into public.classroom_enrollments(id,classroom_id,student_id) values ${f.enrollments.map(e=>`(${q(e.id)},${q(e.classroom_id)},${q(e.student_id)})`).join(',')};
-- Explicit INSERT updated_at is an immutable CAS fixture stamp. No UPDATE
-- timestamp trigger bypass or natural revision/category counter overwrite.
insert into public.tests(id,artifact_id,classroom_id,created_by,title,status,show_results,documents,position,points_possible,include_in_final,created_at,updated_at,source_artifact_id,source_blueprint_version_id,blueprint_archived_at,questions_locked_at,gradebook_weight,gradebook_maximum_override,gradebook_score_scale)
values ${f.tests.map(t=>`(${[t.id,t.artifact_id,t.classroom_id,t.created_by,t.title,t.status].map(q).join(',')},false,'[]'::jsonb,${t.position},100,true,${q(f.now)},${q(f.now)},null,null,${t.blueprint_archived_at?q(t.blueprint_archived_at):'null'},null,10,null,1)`).join(',')};
insert into public.assessment_drafts(id,assessment_type,assessment_id,classroom_id,version,content,created_by,updated_by,created_at,updated_at)
values ${f.drafts.map(d=>`(${q(d.id)},'test',${q(d.assessment_id)},${q(d.classroom_id)},${d.version},${json(d.content)},${q(d.created_by)},${q(d.updated_by)},${q(f.now)},${q(f.now)})`).join(',')};
insert into public.test_student_availability(id,test_id,student_id,state,updated_by,created_at,updated_at) values ${f.availability.map(r=>`(${q(r.id)},${q(r.test_id)},${q(r.student_id)},${q(r.state)},${q(r.updated_by)},${q(f.now)},${q(f.now)})`).join(',')};
insert into public.classroom_enrollments(id,classroom_id,student_id) values (${q(f.retainedEnrollment.id)},${q(f.retainedEnrollment.classroom_id)},${q(f.retainedEnrollment.student_id)});
insert into public.gradebook_score_overrides(id,classroom_id,student_id,assessment_type,assessment_id,earned,created_by,created_at,updated_at) values ${f.overrides.map(r=>`(${q(r.id)},${q(r.classroom_id)},${q(r.student_id)},'test',${q(r.assessment_id)},0,${q(r.created_by)},${q(f.now)},${q(f.now)})`).join(',')};
do $retained$ declare affected integer;begin
 delete from public.classroom_enrollments where id=${q(f.retainedEnrollment.id)} and classroom_id=${q(f.retainedEnrollment.classroom_id)} and student_id=${q(f.retainedEnrollment.student_id)};
 get diagnostics affected=row_count;
 if affected<>1 or exists(select 1 from public.classroom_enrollments where classroom_id=${q(f.retainedEnrollment.classroom_id)} and student_id=${q(f.retainedEnrollment.student_id)})
 or not exists(select 1 from public.gradebook_score_overrides where id=${q(f.overrides[0].id)} and classroom_id=${q(f.retainedEnrollment.classroom_id)} and student_id=${q(f.retainedEnrollment.student_id)} and assessment_type='test' and assessment_id=${q(f.overrides[0].assessment_id)})
 or not exists(select 1 from private.pal_membership_generations where generation_id=${q(f.retainedEnrollment.id)} and state='removed' and scope_digest=private.pal_membership_scope(${q(f.retainedEnrollment.classroom_id)}::uuid,${q(f.retainedEnrollment.student_id)}::uuid))
 then raise exception 'Pristine discard retained membership differs';end if;end;$retained$;
do $archive$ declare affected integer;begin
 update public.classrooms set archived_at=${q(f.now)} where id=${q(f.classes[2].id)} and teacher_id=${q(f.classes[2].owner)} and archived_at is null;
 get diagnostics affected=row_count;if affected<>1 then raise exception 'Pristine discard archive differs';end if;end;$archive$;
commit;`)
}
export function testOwnerPristineDiscardSnapshotSql(f:TestOwnerPristineDiscardFixture) {
  const fixedIds=f.tests.map(t=>q(t.id)).join(',');const ids='select id from fixed_test_ids';const classes=f.classes.map(c=>q(c.id)).join(',');const actors=f.actors.map(a=>q(a.id)).join(',')
  const current='select id from source_test_ids'
  const drafts=f.drafts.map(d=>q(d.id)).join(',')
  const scopes:Array<[string,string]>=[['public.users',`id in (${actors})`],['public.classrooms',`id in (${classes})`],
    ['public.tests',`id in (${ids}) or classroom_id in (${classes})`],['public.gradebook_categories',`classroom_id in (${classes})`],
    ['public.test_questions',`test_id in (${ids}) or test_id in (${current})`],
    ['public.assessment_drafts',`id in (${drafts}) or classroom_id in (${classes}) or assessment_id in (${ids}) or assessment_id in (${current})`],
    ...['test_attempts','test_responses','test_student_availability'].map(t=>[`public.${t}`,`test_id in (${ids}) or test_id in (${current})`] as [string,string]),
    ['public.classroom_enrollments',`classroom_id in (${classes})`],['public.classroom_roster',`classroom_id in (${classes})`],
    ['public.classroom_archive_revisions',`classroom_id in (${classes})`],
    ['public.managed_storage_objects',`classroom_id in (${classes}) or resource_id in (${ids}) or resource_id in (${current})`],
    ['public.managed_storage_json_references',`test_id in (${ids}) or test_id in (${current})`],['public.test_document_snapshot_storage_cleanup','true'],
    ['public.pal_event_outbox',`student_id in (${actors})`],['private.pal_membership_outbox',`classroom_id in (${classes}) or student_id in (${actors})`],
    ['private.pal_membership_generations',`generation_id in (${[...f.enrollments.map(e=>e.id),f.retainedEnrollment.id].map(q).join(',')}) or scope_digest in (${f.classes.flatMap(c=>f.actors.map(a=>`private.pal_membership_scope(${q(c.id)}::uuid,${q(a.id)}::uuid)`)).join(',')})`],
    ...['pal_membership_settings','pal_classroom_signal_settings','student_provider_cleanup_settings','classroom_creation_entitlement_settings'].map(t=>[`private.${t}`,'true'] as [string,string]),
    ...['test_focus_events','test_ai_grading_runs','test_ai_grading_run_items'].map(t=>[`public.${t}`,`test_id in (${ids}) or test_id in (${current})`] as [string,string]),
    ['public.test_attempt_history',`test_attempt_id in (select id from public.test_attempts where test_id in (${ids}) or test_id in (${current}))`],
    ['public.classroom_guided_draft_provenance',`test_id in (${ids}) or test_id in (${current}) or classroom_id in (${classes}) or draft_id in (${drafts})`],
    ['public.gradebook_score_overrides',`classroom_id in (${classes}) or (assessment_type='test' and assessment_id in (${ids}))`]]
  assert.deepEqual(scopes.map(([t])=>t),TEST_OWNER_PRISTINE_DISCARD_SNAPSHOT_TABLES)
  // Only the four predicted tables exclude owned rows. Every other table has
  // its WHOLE fingerprint, including all immediate/indirect DELETE dependencies.
  const excludes:Record<string,string>={'public.classrooms':`where r.id not in (${classes})`,
    'public.classroom_archive_revisions':`where r.classroom_id not in (${classes})`,
    'public.tests':`where not (r.id in (${fixedIds}) or r.classroom_id in (${classes}))`,
    'public.assessment_drafts':`where not (r.id in (${drafts}) or r.classroom_id in (${classes}) or r.assessment_id in (${fixedIds}))`}
  const fingerprints=`(select coalesce(jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'fingerprint',query_to_xml(format('select count(*) as count,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'''' order by md5(to_jsonb(r)::text)),'''')) as digest from %I.%I r %s',n.nspname,c.relname,case ${Object.entries(excludes).map(([table,p])=>`when n.nspname||'.'||c.relname=${q(table)} then ${q(p)}`).join(' ')} else '' end),true,false,'')::text) order by n.nspname,c.relname),'[]'::jsonb) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','private','storage'))`
  return boundedSql(`begin isolation level repeatable read read only;set local lock_timeout='3s';set local statement_timeout='30s';with fixed_test_ids as (select unnest(array[${fixedIds}]::uuid[]) as id), source_test_ids as (select id from public.tests where id in (${ids}) or classroom_id in (${classes})) select jsonb_build_object(${scopes.map(([t,p])=>`${q(t)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from ${t} t where ${p})`).join(',')},'__nontarget_fingerprints',${fingerprints});rollback;`)
}
type Row=Record<string,unknown>
type Snapshot=Record<string,Row[]>
type Envelope=z.infer<typeof contextualTestPristineDiscardResultSchema>
export type TestOwnerPristineDiscardWitness={caseLabel:string;envelope:Envelope;state:'provisional'|'verified';requestWindow:{startMs:number;deadlineMs:number}}
const issuedLedgers=new WeakSet<object>()
const ledgerSnapshots=new WeakMap<object,string>()
function ledger(value:TestOwnerPristineDiscardWitness[]){assert(Array.isArray(value) && value.length<=18);assert(value.length===0 || issuedLedgers.has(value),'Unissued ledger');return value}
function snapshot(value:unknown):Snapshot {
  assert(boundedAssignmentListJson(value,TEST_OWNER_PRISTINE_DISCARD_CAPS.snapshotBytes),'Oversize/non-JSON snapshot')
  const s=z.record(z.string(),z.array(z.record(z.string(),z.unknown())).max(TEST_OWNER_PRISTINE_DISCARD_CAPS.rowsPerTable)).parse(value)
  assert.deepEqual(Object.keys(s).sort(),[...TEST_OWNER_PRISTINE_DISCARD_SNAPSHOT_TABLES,'__nontarget_fingerprints'].sort())
  assert(Object.values(s).reduce((n,r)=>n+r.length,0)<=TEST_OWNER_PRISTINE_DISCARD_CAPS.snapshotRows)
  const fingerprints=z.array(z.object({table:z.string().regex(/^(public|private|storage)\.[a-z_0-9]+$/),fingerprint:z.string().min(1).max(4096)}).strict()).min(1).max(TEST_OWNER_PRISTINE_DISCARD_CAPS.fingerprintTables).parse(s.__nontarget_fingerprints)
  assert.equal(new Set(fingerprints.map(r=>r.table)).size,fingerprints.length)
  for(const t of [...TEST_OWNER_PRISTINE_DISCARD_SNAPSHOT_TABLES,'storage.objects','storage.buckets'])assert(fingerprints.some(r=>r.table===t),'Incomplete catalog fingerprint')
  return s
}
function indexed(rows:Row[],key:string){const pairs=rows.map(r=>[z.string().uuid().parse(r[key]),r] as const);assert.equal(new Set(pairs.map(([id])=>id)).size,pairs.length);return new Map(pairs)}
function canonical(v:unknown):string {if(Array.isArray(v))return `[${v.map(canonical).join(',')}]`;if(v&&typeof v==='object')return `{${Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${canonical(x)}`).join(',')}}`;return JSON.stringify(v)}
function timestampInstant(v:unknown):string {
  const s=z.string().datetime({offset:true}).parse(v);const fraction=/(?:\.(\d+))?(?:Z|[+-]\d{2}:\d{2})$/.exec(s)?.[1]??''
  assert(Number.isFinite(Date.parse(s)));return `${Math.floor(Date.parse(s)/1000)}:${fraction.replace(/0+$/,'')}`
}
function sameRows(a:Row[],b:Row[]){assert.deepEqual(a.map(canonical).sort(),b.map(canonical).sort())}
function snapshotSignature(s:Snapshot){return testOwnerDigest(canonical(Object.fromEntries(Object.entries(s).map(([t,r])=>[t,r.map(canonical).sort()]))))}
function plannedRows(actual:Row[],expected:readonly Row[],key='id'){const a=indexed(actual,key);assert.equal(a.size,expected.length);for(const e of expected)for(const [k,v]of Object.entries(e))assert.deepEqual(a.get(String(e[key]))?.[k],v)}
function baseline(f:TestOwnerPristineDiscardFixture,s:Snapshot,prior:TestOwnerPristineDiscardWitness[]) {
  const removed=new Set(prior.filter(w=>w.envelope.discarded).map(w=>w.envelope.test_id))
  const tests=indexed(s['public.tests'],'id');const expected=f.tests.filter(t=>!removed.has(t.id));assert.equal(tests.size,expected.length)
  const categories=s['public.gradebook_categories'];assert.equal(indexed(categories,'id').size,12)
  for(const c of f.classes)assert.equal(categories.filter(r=>r.classroom_id===c.id).length,3)
  for(const p of expected){const t=contextualTestListTestSchema.parse(tests.get(p.id));for(const [k,v]of Object.entries(p)){
    if(k==='gradebook_category_id') {const sorted=categories.filter(c=>c.classroom_id===p.classroom_id).sort((a,b)=>Number(b.is_default)-Number(a.is_default)||Number(a.position)-Number(b.position)||String(a.id).localeCompare(String(b.id)));assert.equal(t.gradebook_category_id,sorted[0]?.id??null)}
    else if(k.endsWith('_at') && v!==null)assert.equal(timestampInstant(t[k as keyof typeof t]),timestampInstant(v))
    else assert.deepEqual(t[k as keyof typeof t],v)
  }}
  const ds=s['public.assessment_drafts'].map(d=>contextualTestDraftGetRowSchema.parse(d));const expectedDrafts=f.drafts.filter(d=>!removed.has(d.assessment_id))
  assert.equal(ds.length,expectedDrafts.length)
  for(const p of expectedDrafts){const d=ds.find(d=>d.id===p.id);assert(d);for(const[k,v]of Object.entries(p))if(k.endsWith('_at'))assert.equal(timestampInstant(d[k as keyof typeof d]),timestampInstant(v));else assert.deepEqual(d[k as keyof typeof d],v)}
  plannedRows(s['public.users'],f.actors);plannedRows(s['public.classroom_enrollments'],f.enrollments)
  plannedRows(s['public.test_student_availability'],f.availability);plannedRows(s['public.gradebook_score_overrides'],f.overrides)
  assert(!s['public.classroom_enrollments'].some(r=>r.classroom_id===f.retainedEnrollment.classroom_id&&r.student_id===f.retainedEnrollment.student_id))
  const retained=s['private.pal_membership_generations'].filter(r=>r.generation_id===f.retainedEnrollment.id)
  assert.equal(retained.length,1);assert.equal(retained[0].state,'removed');assert.match(String(retained[0].scope_digest),/^[a-f0-9]{64}$/)
  const cs=indexed(s['public.classrooms'],'id');const ars=indexed(s['public.classroom_archive_revisions'],'classroom_id');assert.equal(cs.size,4);assert.equal(ars.size,4)
  for(const c of f.classes){const r=cs.get(c.id);assert(r&&ars.has(c.id));assert.equal(r.teacher_id,c.owner);assert.equal(r.title,c.title);assert.equal(r.class_code,c.code);assert(c.archived?Number.isFinite(Date.parse(String(r.archived_at))):r.archived_at===null)}
  for(const t of ['public.test_questions','public.test_attempts','public.test_responses','public.test_focus_events','public.test_ai_grading_runs','public.test_ai_grading_run_items','public.test_attempt_history','public.managed_storage_objects','public.managed_storage_json_references','public.classroom_guided_draft_provenance'])assert.equal(s[t].length,0)
}
export function validateTestOwnerPristineDiscardSetupSnapshot(f:TestOwnerPristineDiscardFixture,value:unknown,expectedTables:readonly string[]) {
  const s=snapshot(value);assert(expectedTables.length>0&&expectedTables.length<=TEST_OWNER_PRISTINE_DISCARD_CAPS.fingerprintTables)
  assert(expectedTables.every(t=>/^(public|private|storage)\.[a-z_0-9]+$/.test(t)));assert.equal(new Set(expectedTables).size,expectedTables.length)
  assert.deepEqual(s.__nontarget_fingerprints.map(r=>r.table).sort(),[...expectedTables].sort(),'Complete table catalog differs');baseline(f,s,[]);return s
}
export function registerTestOwnerPristineDiscardWitness(f:TestOwnerPristineDiscardFixture,prior:TestOwnerPristineDiscardWitness[],caseLabel:string,value:unknown,
  rawRequestWindow?:{startMs:number;deadlineMs:number}) {
  const startMs=Date.now();const requestWindow=rawRequestWindow??{startMs,deadlineMs:startMs+TEST_OWNER_PRISTINE_DISCARD_CAPS.requestMs}
  ledger(prior);assert(prior.every(w=>w.state==='verified'));assert(!prior.some(w=>w.caseLabel===caseLabel))
  assert(Number.isSafeInteger(requestWindow.startMs)&&Number.isSafeInteger(requestWindow.deadlineMs)&&requestWindow.deadlineMs>requestWindow.startMs&&requestWindow.deadlineMs-requestWindow.startMs<=TEST_OWNER_PRISTINE_DISCARD_CAPS.requestMs)
  const c=f.cases.find(c=>c.label===caseLabel);assert(c&&c.expectedHTTP===200)
  assert(boundedAssignmentListJson(value,TEST_OWNER_PRISTINE_DISCARD_CAPS.resultBytes));const e=contextualTestPristineDiscardResultSchema.parse(value)
  assert.equal(e.actor_id,c.actorId);assert.equal(e.test_id,c.testId);assert.equal(e.test.id,c.testId);assert.equal(e.classroom.teacher_id,c.actorId)
  assert.equal(e.test.classroom_id,e.classroom.id);assert.equal(e.test.blueprint_archived_at,null);assert.equal(e.discarded,c.expectedDiscarded)
  if(e.draft){assert.equal(e.draft.assessment_id,c.testId);assert.equal(e.draft.classroom_id,e.classroom.id)}
  if(e.discarded){assert.equal(e.draft.version,c.input.expected_draft_version);assert.equal(timestampInstant(e.test.updated_at),timestampInstant(c.input.expected_test_updated_at))}
  const result=freeze([...prior,{caseLabel,envelope:e,state:'provisional' as const,requestWindow:{...requestWindow}}]);issuedLedgers.add(result)
  const previous=ledgerSnapshots.get(prior);if(previous)ledgerSnapshots.set(result,previous);return result
}
/** Only this full-effect sink issues a verified ledger. No state/ledger setter. */
export function verifyTestOwnerPristineDiscardEffects(f:TestOwnerPristineDiscardFixture,beforeValue:unknown,afterValue:unknown,caseLabel:string,
  entries:TestOwnerPristineDiscardWitness[],publicResult?:unknown,effectTimestamp?:string) {
  ledger(entries);const before=snapshot(beforeValue);const after=snapshot(afterValue)
  const previous=ledgerSnapshots.get(entries);if(previous)assert.equal(snapshotSignature(before),previous,'Previous verified snapshot differs')
  const c=[...f.cases,...f.privilegeProbes].find(c=>c.label===caseLabel);assert(c)
  const w=entries.find(w=>w.caseLabel===caseLabel);const prior=entries.filter(w=>w.caseLabel!==caseLabel)
  assert(prior.every(w=>w.state==='verified'));baseline(f,before,prior)
  if(c.expectedHTTP!==200){assert(!w);assert.equal(publicResult,undefined);for(const t of Object.keys(before))sameRows(before[t],after[t]);return entries}
  assert(w&&w.state==='provisional'&&entries.at(-1)===w,'Missing/reused/out-of-order witness')
  const e=w.envelope;const test=before['public.tests'].find(t=>t.id===c.testId);assert.deepEqual(test,e.test)
  const draft=before['public.assessment_drafts'].find(d=>d.assessment_type==='test'&&d.assessment_id===c.testId)??null;assert.deepEqual(draft,e.draft)
  assert(boundedAssignmentListJson(publicResult,TEST_OWNER_PRISTINE_DISCARD_CAPS.resultBytes));assert.deepEqual(publicResult,e.discarded?{discarded:true}:{discarded:false,test:e.test})
  if(!e.discarded){for(const t of Object.keys(before))sameRows(before[t],after[t])}
  else {
    assert(e.draft);sameRows(before['public.tests'].filter(t=>t.id!==c.testId),after['public.tests'])
    sameRows(before['public.assessment_drafts'].filter(d=>d.id!==e.draft!.id),after['public.assessment_drafts'])
    assert(!after['public.assessment_drafts'].some(d=>d.assessment_type==='test'&&d.assessment_id===c.testId),'Pair resurrected')
    const classAfter=after['public.classrooms'].find(r=>r.id===e.classroom.id);const archiveAfter=after['public.classroom_archive_revisions'].find(r=>r.classroom_id===e.classroom.id)
    assert(classAfter&&archiveAfter);const stamp=String(classAfter.updated_at)
    assert.equal(stamp,archiveAfter.updated_at);if(effectTimestamp!==undefined)assert.equal(stamp,effectTimestamp)
    const ms=Date.parse(stamp);assert(Number.isFinite(ms)&&ms>=w.requestWindow.startMs&&ms<=w.requestWindow.deadlineMs,'Effect timestamp outside request')
    for(const [table,key,revision,delta]of [['public.classrooms','id','blueprint_source_revision',2],['public.classroom_archive_revisions','classroom_id','revision',4]]as const){
      const old=indexed(before[table],key);const current=indexed(after[table],key);assert.equal(old.size,current.size)
      for(const[id,r]of old)if(id!==e.classroom.id)assert.deepEqual(current.get(id),r);else{
        assert(Number.isSafeInteger(r[revision])&&Number(r[revision])<=Number.MAX_SAFE_INTEGER-delta)
        if(table==='public.classrooms'){assert.equal(r.teacher_id,c.actorId);assert.equal(r.archived_at,null)}
        assert.deepEqual(current.get(id),{...r,[revision]:Number(r[revision])+delta,updated_at:stamp})
      }
    }
    for(const t of Object.keys(before))if(!['public.tests','public.assessment_drafts','public.classrooms','public.classroom_archive_revisions'].includes(t))sameRows(before[t],after[t])
  }
  const result=freeze(entries.map(v=>v===w?{...v,state:'verified' as const}:v));issuedLedgers.add(result);ledgerSnapshots.set(result,snapshotSignature(after));return result
}
