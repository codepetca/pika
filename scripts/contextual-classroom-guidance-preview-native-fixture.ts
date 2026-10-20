/** Inert dual-owner preview fixture. No native executor or ambient client. */
import assert from 'node:assert/strict'
import {normalizeCourseBlueprintAuthoringGuidance} from '../src/lib/course-blueprint-authoring-guidance'
import {attendancePolicyWriteFreeze as freeze,attendancePolicyWriteHash as hash} from './contextual-attendance-policy-write-native-fixture'
export {attendancePolicyWriteFreeze as classroomGuidancePreviewFreeze,attendancePolicyWriteHash as classroomGuidancePreviewHash} from './contextual-attendance-policy-write-native-fixture'
export const CLASSROOM_GUIDANCE_PREVIEW_CAPS=freeze({sdkRequests:12,sqlFrames:18,sqlBytes:65536,requestBytes:4096,responseBytes:65536,bytes:1048576,sessions:1,controls:2048,requestMs:8000,workMs:720000,cleanupMs:180000})
export const CLASSROOM_GUIDANCE_PREVIEW_ACCOUNTING=freeze({sqlFrames:18,http:12,fullGuards:60,leafActions:90})
const q=(s:string)=>`'${s.replaceAll("'","''")}'`,json=(value:unknown)=>`${q(JSON.stringify(value))}::jsonb`
export function newClassroomGuidancePreviewFixture(tag:string){
  assert.match(tag,/^assignmentlist_[a-f0-9]{12}$/);const name=`guidance_preview_${tag.slice(-12)}`
  const id=(label:string)=>{const h=hash(`${name}:${label}`);return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`}
  const actors=(['student','teacher','teacher','student','teacher']as const).map((role,n)=>({id:id(`actor:${n}`),role,email:`${name}_${n}@example.invalid`}))
  const forbiddenSentinels=['private_course','live_children','latest_unselected','structural_unadopted'].map(s=>`${s}_${name}`),unitId=id('unit')
  const adoptedGuidance={course_expectations_markdown:'Adopted course rules',assignment_guidance_markdown:'Adopted assignment rules',test_guidance_markdown:'Adopted Test rules',unit_exceptions:[{id:unitId,unit_label:' \t\u00a0Unit\u00a0\r ',assignment_guidance_markdown:'Unit assignment rules',test_guidance_markdown:'Unit Test rules'}]}
  const liveGuidance={...normalizeCourseBlueprintAuthoringGuidance(adoptedGuidance),course_expectations_markdown:'Live changed course rules'}
  const emptyGuidance=normalizeCourseBlueprintAuthoringGuidance(null)
  const blueprints=[{id:id('blueprint:0'),owner:actors[0].id,expectedRevision:5,latestVersion:3,guidance:liveGuidance},{id:id('blueprint:1'),owner:actors[1].id,expectedRevision:4,latestVersion:1,guidance:emptyGuidance}]
  const snapshot=(guidance?:unknown)=>({schema_version:3,metadata:{title:forbiddenSentinels[0]},sections:{outline_markdown:forbiddenSentinels[0]},assignments:[{title:forbiddenSentinels[0]}],assessments:[{title:forbiddenSentinels[0]}],...(guidance===undefined?{}:{authoring_guidance:guidance})})
  const versions=[{id:id('version:0'),blueprintId:blueprints[0].id,versionNumber:1,sourceDraftRevision:1,snapshot:snapshot({...adoptedGuidance,course_expectations_markdown:forbiddenSentinels[3]})},
    {id:id('version:1'),blueprintId:blueprints[0].id,versionNumber:2,sourceDraftRevision:2,snapshot:snapshot(adoptedGuidance)},
    {id:id('version:2'),blueprintId:blueprints[0].id,versionNumber:3,sourceDraftRevision:3,snapshot:[{private:forbiddenSentinels[2]}]},
    {id:id('version:3'),blueprintId:blueprints[1].id,versionNumber:1,sourceDraftRevision:1,snapshot:snapshot()}]
  const classes=['adopted','fallback','class-only','unlinked','malformed','archived'].map((label,n)=>({id:id(`class:${n}`),label,owner:actors[n===1?1:0].id,code:`${name}_${n}`,
    source_blueprint_id:n===3?null:blueprints[n===1||n===2?1:0].id,source_blueprint_version_id:n===3?null:versions[n===1||n===2?3:0].id,authoring_guidance_version_id:n===0||n===5?versions[1].id:n===4?versions[2].id:null}))
  const enrollments=[[0,0],[0,2],[5,3]].map(([ci,ai],n)=>({id:id(`enrollment:${n}`),actorId:actors[ai].id,classroomId:classes[ci].id}))
  const liveChildren=blueprints.map((b,n)=>({blueprintId:b.id,assignmentId:id(`live-assignment:${n}`),assignmentArtifactId:id(`assignment-artifact:${n}`),testId:id(`live-test:${n}`),testArtifactId:id(`test-artifact:${n}`)}))
  const missingClassId=id('missing-class'),purgeId=id('purge'),allocatedIds=[...actors.map(a=>a.id),...classes.map(c=>c.id),...enrollments.map(e=>e.id),...blueprints.map(b=>b.id),...versions.map(v=>v.id),unitId,...liveChildren.flatMap(c=>[c.assignmentId,c.assignmentArtifactId,c.testId,c.testArtifactId]),missingClassId,purgeId]
  assert.equal(new Set(allocatedIds).size,allocatedIds.length)
  return freeze({version:1 as const,tag:name,projectId:`pika_assignment_list_${tag.slice(-12)}`,actors,classes,enrollments,blueprints,versions,adoptedGuidance,liveGuidance,emptyGuidance,liveChildren,forbiddenSentinels,allocatedIds,missingClassId,purgeId,baseline:`private.${name}_baseline`})
}
export type ClassroomGuidancePreviewFixture=ReturnType<typeof newClassroomGuidancePreviewFixture>
export function assertClassroomGuidancePreviewFixture(f:ClassroomGuidancePreviewFixture){assert.deepEqual(f,newClassroomGuidancePreviewFixture(`assignmentlist_${f.tag.slice(-12)}`));assert(Object.isFrozen(f.versions))}
export type ClassroomGuidancePreviewSqlName='prepare'|'setup'|'witness'|'purge-fenced'|'restore-baseline'|'preservation'|`observe-${number}`
export type ClassroomGuidancePreviewSqlDescriptor=Readonly<{name:ClassroomGuidancePreviewSqlName;sql:string;sha256:string;profile:'baseline-off';nativeVerified:false}>
export type ClassroomGuidancePreviewSdkCall=Readonly<{label:string;status:200|403|404|409|503;error?:string;transition?:ClassroomGuidancePreviewSqlName;args:{p_actor_id:string;p_classroom_id:string}}>
export function classroomGuidancePreviewSdkInventory(f:ClassroomGuidancePreviewFixture):readonly ClassroomGuidancePreviewSdkCall[]{
  assertClassroomGuidancePreviewFixture(f);const[o,t,m,,former]=f.actors,[a,b,c,d,e,archived]=f.classes
  const call=(label:string,actor:string,classroom:string,status:ClassroomGuidancePreviewSdkCall['status']=200,error?:string,transition?:ClassroomGuidancePreviewSqlName):ClassroomGuidancePreviewSdkCall=>({label,status,...(error?{error}:{}),...(transition?{transition}:{}),args:{p_actor_id:actor,p_classroom_id:classroom}})
  return freeze([call('student-dual-owner-adopted',o.id,a.id),call('teacher-dual-owner-fallback-equal',t.id,b.id),call('blueprint-only-owner-denied',t.id,c.id,403,'forbidden'),call('classroom-only-owner-denied',o.id,c.id,403,'forbidden'),
    call('teacher-member-denied',m.id,a.id,403,'forbidden'),call('former-owner-denied',former.id,a.id,403,'forbidden'),call('archived-owner-denied',o.id,archived.id,403,'archived'),call('unlinked-owner-denied',o.id,d.id,409,'unlinked'),
    call('missing-class',o.id,f.missingClassId,404,'classroom_missing'),call('malformed-selected-snapshot',o.id,e.id,503,'invalid'),call('attendance-free-purge-fenced',t.id,b.id,503,'fenced','purge-fenced'),call('restored-owner-fallback-equal',t.id,b.id,200,undefined,'restore-baseline')])
}
/** Independent synthetic facts, not the production adapter or legacy helper. */
export function classroomGuidancePreviewExpectedWire(f:ClassroomGuidancePreviewFixture,call:ClassroomGuidancePreviewSdkCall){
  if(call.status!==200)return{code:`PT${call.status}`,message:`class_guidance_preview_${call.error}`,details:null,hint:null}
  const ci=f.classes.findIndex(c=>c.id===call.args.p_classroom_id);assert(ci===0||ci===1);const c=f.classes[ci],bp=f.blueprints[ci],content=f.versions[ci===0?0:3],guidance=f.versions[ci===0?1:3]
  return{actor_id:call.args.p_actor_id,classroom_id:c.id,classroom:{id:c.id,teacher_id:c.owner,archived_at:null,source_blueprint_id:c.source_blueprint_id,source_blueprint_version_id:c.source_blueprint_version_id,authoring_guidance_version_id:c.authoring_guidance_version_id},
    blueprint:{id:bp.id,teacher_id:bp.owner,content_revision:bp.expectedRevision},versions:{content:{id:content.id,course_blueprint_id:bp.id},guidance:{id:guidance.id,course_blueprint_id:bp.id,version_number:guidance.versionNumber}},current_guidance:ci===0?f.adoptedGuidance:null,guidance:bp.guidance}
}
export function classroomGuidancePreviewExpectedView(f:ClassroomGuidancePreviewFixture,call:ClassroomGuidancePreviewSdkCall){
  if(call.status!==200)return null
  const first=call.args.p_classroom_id===f.classes[0].id,bp=f.blueprints[first?0:1]
  return{preview:{blueprint_id:bp.id,expected_content_version_id:f.versions[first?0:3].id,expected_guidance_version_id:f.versions[first?1:3].id,expected_draft_revision:bp.expectedRevision,current_guidance_version_number:first?2:1,
    current_guidance:normalizeCourseBlueprintAuthoringGuidance(first?f.adoptedGuidance:null),guidance:normalizeCourseBlueprintAuthoringGuidance(bp.guidance),changed:first}}
}
/** Exact accepted63-table graph. ID CTEs compress repeated identity literals,
 * not SQL whitespace or predicates. NULL belongs only to the complement. */
export function classroomGuidancePreviewGraphScopes(){
  const actors='select id from fixture_actors',classes='select id from fixture_classes',bp='select id from fixture_blueprints'
  const generation=`generation_id in (select id from fixture_enrollments) or scope_digest in (select scope_digest from fixture_pal_scopes)`
  const scopes:[string,string][]=[['public.users',`id in (${actors})`],...['effective_feature_entitlements','account_plans','account_plan_audit','effective_feature_entitlement_audit'].map(t=>[`public.${t}`,`subject_user_id in (${actors})`]as[string,string]),
    ['public.classrooms',`id in (${classes})`],['private.pal_membership_generations',generation],
    ...['classroom_enrollments','classroom_roster','classroom_roster_student_bindings','classroom_archive_revisions','gradebook_categories','gradebook_settings','class_days','entries','attendance_window_policies','attendance_roster_mappings','attendance_participant_mappings','attendance_occurrence_mappings','attendance_integration_outbox','attendance_integration_inbox','attendance_session_projection','attendance_record_projection','attendance_check_in_facts','attendance_status_overrides','attendance_status_override_events','attendance_override_requests','classroom_purge_operations','classroom_purge_fences','attendance_decommission_operations'].map(t=>[`public.${t}`,`classroom_id in (${classes})`]as[string,string]),
    ['public.attendance_principal_mappings',`user_id in (${actors})`],...['attendance_teacher_entitlements','attendance_teacher_entitlement_audit','attendance_outbox_epoch_recovery_audit'].map(t=>[`public.${t}`,`teacher_id in (${actors})`]as[string,string]),
    ['public.pal_event_outbox',`student_id in (${actors})`],['private.pal_membership_outbox',`classroom_id in (${classes}) or student_id in (${actors})`],['private.attendance_membership_generations',generation],
    ['public.student_profiles',`user_id in (${actors})`],['public.course_blueprints',`id in (${bp})`],['public.course_blueprint_draft_admissions',`teacher_id in (${actors})`],
    ...['course_blueprint_versions','course_blueprint_assignments','course_blueprint_assessments','course_blueprint_materials','course_blueprint_surveys','course_blueprint_lesson_templates','course_blueprint_editing_sessions','course_blueprint_change_proposals','course_blueprint_authoring_guidance_revisions','course_blueprint_purge_operations','course_blueprint_purge_fences'].map(t=>[`public.${t}`,`course_blueprint_id in (${bp})`]as[string,string]),
    ['public.course_blueprint_operations',`source_blueprint_id in (${bp}) or result_blueprint_id in (${bp})`],['public.course_blueprint_purge_objects','operation_id in (select id from fixture_blueprint_purge_operations)'],
    ...['classroom_guided_draft_provenance','classroom_archives','classroom_archive_operations','classroom_cold_tombstones','cold_classroom_purge_fences'].map(t=>[`public.${t}`,`classroom_id in (${classes})`]as[string,string]),
    ...['classroom_archive_snapshot_resources','classroom_archive_snapshot_actors','classroom_archive_object_upload_cleanup','classroom_archive_restore_staging','classroom_archive_restore_expected_objects'].map(t=>[`public.${t}`,'operation_id in (select id from fixture_archive_operations)']as[string,string])]
  assert.equal(scopes.length,63);return freeze(scopes.map(([table,predicate])=>({table,predicate})))
}
export function classroomGuidancePreviewGraphSql(f:ClassroomGuidancePreviewFixture,synthetic:boolean){
  const values=(rows:readonly{id:string}[])=>rows.map(r=>`(${q(r.id)}::uuid)`).join(',')
  const cte=`with fixture_actors(id) as(values${values(f.actors)}),fixture_classes(id) as(values${values(f.classes)}),fixture_enrollments(id) as(values${values(f.enrollments)}),fixture_blueprints(id) as(values${values(f.blueprints)}),fixture_pal_scopes(scope_digest) as(select private.pal_membership_scope(c.id,a.id) from fixture_classes c cross join fixture_actors a),fixture_archive_operations(id) as(select id from public.classroom_archive_operations where classroom_id in (select id from fixture_classes)),fixture_blueprint_purge_operations(id) as(select id from public.course_blueprint_purge_operations where course_blueprint_id in (select id from fixture_blueprints))`
  const scopes=classroomGuidancePreviewGraphScopes(),group=(rows:typeof scopes)=>`jsonb_build_object(${rows.map(({table,predicate})=>`${q(table.split('.')[1])},coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from ${table} r where ${synthetic?'':'not '}(coalesce((${predicate}),false))),'[]'::jsonb)`).join(',')})`
  // PostgreSQL's100-argument ceiling: preserve predecessor40+23 key split.
  return`(${cte} select ${group(scopes.slice(0,40))}||${group(scopes.slice(40))})`
}
export function classroomGuidancePreviewSqlDescriptors(f:ClassroomGuidancePreviewFixture):readonly ClassroomGuidancePreviewSqlDescriptor[]{
  assertClassroomGuidancePreviewFixture(f);const graph=classroomGuidancePreviewGraphSql(f,true),original=`encode(extensions.digest((${classroomGuidancePreviewGraphSql(f,false)})::text,'sha256'),'hex')`
  const prefix="begin;set local lock_timeout='1s';set local statement_timeout='8s';",stage=(name:string)=>`commit;select jsonb_build_object('stage',${q(name)},'nativeVerified',false);`
  const owner=q(f.actors[0].id),seeder=q(f.actors[4].id),empty=q(f.classes[1].id),emptyOwner=q(f.actors[1].id),bpIds=f.blueprints.map(b=>q(b.id)).join(',')
  const prepare=`${prefix}do $collision$ begin if to_regclass(${q(f.baseline)}) is not null or exists(select 1 from jsonb_each(${graph}) where value<>'[]'::jsonb) or exists(select 1 from public.classrooms where id=${q(f.missingClassId)}) then raise exception 'preview_fixture_collision';end if;end;$collision$;
 create table ${f.baseline}(singleton boolean primary key check(singleton),original_sha256 text not null,graph jsonb,checkpoint jsonb,observed integer not null default -1);revoke all on ${f.baseline} from public,anon,authenticated,service_role;insert into ${f.baseline}(singleton,original_sha256) values(true,${original});${stage('prepare')}`
  const setup=`${prefix}insert into public.users(id,email,role) values${f.actors.map(a=>`(${q(a.id)},${q(a.email)},${q(a.role)})`).join(',')};
 insert into public.effective_feature_entitlements(subject_user_id,feature_key,source,enabled,starts_at,quota_limit,revision) values${[0,1,4].map(n=>`(${q(f.actors[n].id)},'classrooms.create','manual',true,'2020-01-01',10,1)`).join(',')} on conflict(subject_user_id,feature_key) do update set enabled=true,quota_limit=10,starts_at='2020-01-01',expires_at=null;
 insert into public.course_blueprints(id,teacher_id,title) values${f.blueprints.map(b=>`(${q(b.id)},${seeder},${q(f.forbiddenSentinels[0])})`).join(',')};
 ${f.liveChildren.map(c=>`insert into public.course_blueprint_assignments(id,artifact_id,course_blueprint_id,title) values(${q(c.assignmentId)},${q(c.assignmentArtifactId)},${q(c.blueprintId)},${q(f.forbiddenSentinels[1])});insert into public.course_blueprint_assessments(id,artifact_id,course_blueprint_id,assessment_type,title) values(${q(c.testId)},${q(c.testArtifactId)},${q(c.blueprintId)},'test',${q(f.forbiddenSentinels[1])});`).join('\n')}
 update public.course_blueprints set outline_markdown=${q(f.forbiddenSentinels[0])} where id in (${bpIds});
 ${f.versions.map(v=>`with saved as(select ${json(v.snapshot)} snapshot) insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_schema_version,snapshot_json,snapshot_sha256,source_kind,source_metadata,created_by) select ${q(v.id)},${q(v.blueprintId)},${v.versionNumber},${v.sourceDraftRevision},3,snapshot,encode(extensions.digest(snapshot::text,'sha256'),'hex'),'pika',${json({fixture:f.tag})},${seeder} from saved;`).join('\n')}
 ${f.blueprints.map(b=>`update public.course_blueprints set latest_version_number=${b.latestVersion},authoring_guidance=${json(b.guidance)} where id=${q(b.id)};`).join('\n')}
 insert into public.classrooms(id,teacher_id,title,class_code,source_blueprint_id,source_blueprint_version_id,authoring_guidance_version_id) values${f.classes.map(c=>`(${q(c.id)},${seeder},${q(f.tag)},${q(c.code)},${c.source_blueprint_id?q(c.source_blueprint_id):'null'},${c.source_blueprint_version_id?q(c.source_blueprint_version_id):'null'},${c.authoring_guidance_version_id?q(c.authoring_guidance_version_id):'null'})`).join(',')};
 ${f.classes.map(c=>`update public.classrooms set teacher_id=${q(c.owner)} where id=${q(c.id)};`).join('\n')}
 ${f.blueprints.map(b=>`update public.course_blueprints set teacher_id=${q(b.owner)} where id=${q(b.id)};`).join('\n')}
 insert into public.classroom_enrollments(id,classroom_id,student_id) values${f.enrollments.map(e=>`(${q(e.id)},${q(e.classroomId)},${q(e.actorId)})`).join(',')};update public.classrooms set archived_at='2026-10-20T00:00:00Z' where id=${q(f.classes[5].id)};
 update ${f.baseline} set graph=${graph};update ${f.baseline} set checkpoint=graph;${stage('setup')}`
  const witness=`begin read only;set local statement_timeout='8s';select jsonb_build_object('studentDualOwner',exists(select 1 from public.classrooms c join public.users u on u.id=c.teacher_id join public.course_blueprints b on b.id=c.source_blueprint_id where c.id=${q(f.classes[0].id)} and u.id=${owner} and u.role='student' and b.teacher_id=u.id),
 'membershipGenerationRows',(select count(*) from private.pal_membership_generations g join public.classroom_enrollments e on e.id=g.generation_id where e.id in (${f.enrollments.map(e=>q(e.id)).join(',')}) and g.state='active' and g.scope_digest=private.pal_membership_scope(e.classroom_id,e.student_id)),
 'archivedGenerationRetained',exists(select 1 from private.pal_membership_generations g join public.classroom_enrollments e on e.id=g.generation_id join public.classrooms c on c.id=e.classroom_id where e.id=${q(f.enrollments[2].id)} and c.archived_at is not null and g.state='active' and g.scope_digest=private.pal_membership_scope(c.id,e.student_id)),
 'versions',(select count(*) from public.course_blueprint_versions where course_blueprint_id in (${bpIds})),'honestVersionHashes',not exists(select 1 from public.course_blueprint_versions where course_blueprint_id in (${bpIds}) and snapshot_sha256<>encode(extensions.digest(snapshot_json::text,'sha256'),'hex')),
 'blueprintRevisions',(select jsonb_agg(content_revision order by case id when ${q(f.blueprints[0].id)} then 0 else 1 end) from public.course_blueprints where id in (${bpIds})),'nativeVerified',false);rollback;`
  const frames:[ClassroomGuidancePreviewSqlName,string][]=[['prepare',prepare],['setup',setup],['witness',witness]]
  for(const[n,call]of classroomGuidancePreviewSdkInventory(f).entries())frames.push([`observe-${n}`,`${prefix}do $observe$ begin if (select observed from ${f.baseline}) <> ${n-1} or (${graph}) is distinct from (select checkpoint from ${f.baseline}) or ${original} is distinct from (select original_sha256 from ${f.baseline}) then raise exception 'preview_read_changed_graph';end if;update ${f.baseline} set observed=${n};end;$observe$;select jsonb_build_object('case',${q(call.label)},'preserved',true,'nativeVerified',false);commit;`])
  frames.push(['purge-fenced',`${prefix}insert into public.classroom_purge_operations(id,teacher_id,classroom_id,request_sha256,source_revision,impact_summary) values(${q(f.purgeId)},${emptyOwner},${empty},'${'0'.repeat(64)}',1,'{}');insert into public.classroom_purge_fences(classroom_id,operation_id,teacher_id) values(${empty},${q(f.purgeId)},${emptyOwner});update ${f.baseline} set checkpoint=${graph};${stage('purge-fenced')}`],
    ['restore-baseline',`${prefix}delete from public.classroom_purge_fences where operation_id=${q(f.purgeId)};delete from public.classroom_purge_operations where id=${q(f.purgeId)};do $restore$ declare v_graph jsonb;begin v_graph:=${graph};if (select graph from ${f.baseline}) is null then if exists(select 1 from jsonb_each(v_graph) where value<>'[]'::jsonb) then raise exception 'preview_partial_setup';end if;update ${f.baseline} set graph=v_graph;end if;if v_graph is distinct from (select graph from ${f.baseline}) or ${original} is distinct from (select original_sha256 from ${f.baseline}) then raise exception 'preview_restore_mismatch';end if;update ${f.baseline} set checkpoint=v_graph;end;$restore$;${stage('restore-baseline')}`],
    ['preservation',`begin read only;set local statement_timeout='8s';select jsonb_build_object('sourcePreserved',(${graph}) is not distinct from (select graph from ${f.baseline}),'originalsPreserved',${original} is not distinct from (select original_sha256 from ${f.baseline}),'nativeVerified',false);rollback;`])
  assert.equal(frames.length,18);return freeze(frames.map(([name,sql])=>{assert(Buffer.byteLength(sql)<=65536,`${name}:SQL cap ${Buffer.byteLength(sql)}`);return{name,sql,sha256:hash(sql),profile:'baseline-off'as const,nativeVerified:false as const}}))
}
export function assertClassroomGuidancePreviewSqlDescriptor(f:ClassroomGuidancePreviewFixture,frame:ClassroomGuidancePreviewSqlDescriptor){const expected=classroomGuidancePreviewSqlDescriptors(f).find(r=>r.name===frame.name);assert(expected);assert.deepEqual(frame,expected)}
