/** Inert frozen-guidance fixture. No executor, environment access or native admission. */
import assert from 'node:assert/strict'
import {normalizeCourseBlueprintAuthoringGuidance} from '../src/lib/course-blueprint-authoring-guidance'
import {attendancePolicyWriteFreeze as freeze,attendancePolicyWriteHash as hash,attendancePolicyWriteGraphSql} from './contextual-attendance-policy-write-native-fixture'
export {attendancePolicyWriteFreeze as classroomAuthoringGuidanceFreeze,attendancePolicyWriteHash as classroomAuthoringGuidanceHash} from './contextual-attendance-policy-write-native-fixture'
export const CLASSROOM_AUTHORING_GUIDANCE_CAPS=freeze({sdkRequests:12,sqlFrames:18,sqlBytes:65536,requestBytes:4096,responseBytes:65536,bytes:1048576,sessions:1,controls:2048,requestMs:8000,workMs:720000,cleanupMs:180000})
export const CLASSROOM_AUTHORING_GUIDANCE_ACCOUNTING=freeze({sqlFrames:18,http:12,fullGuards:60,leafActions:90})
const q=(v:string)=>`'${v.replaceAll("'","''")}'`,json=(v:unknown)=>`${q(JSON.stringify(v))}::jsonb`
export function newClassroomAuthoringGuidanceFixture(tag:string){
  assert.match(tag,/^assignmentlist_[a-f0-9]{12}$/);const name=`classroom_guidance_${tag.slice(-12)}`
  const id=(label:string)=>{const h=hash(`${name}:${label}`);return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`}
  const actors=(['student','teacher','teacher','student','teacher']as const).map((role,n)=>({id:id(`actor:${n}`),role,email:`${name}_${n}@example.invalid`}))
  const forbiddenSentinels=['live_draft','unselected_latest','adopted_course_only','null_guidance_course_only'].map(v=>`${v}_${name}`)
  const blueprint={id:id('blueprint'),owner:actors[4].id},unitId=id('unit')
  const guidance={course_expectations_markdown:'\nAdopted course rule\t',assignment_guidance_markdown:'Adopted assignment rule',test_guidance_markdown:'Adopted Test rule',
    unit_exceptions:[{id:unitId,unit_label:' \t\u00a0Unit\u00a0\r ',assignment_guidance_markdown:'Unit assignment rule',test_guidance_markdown:'Unit Test rule'}]}
  const assignmentTitles=Array.from({length:500},(_,n)=>n===0?' \t ':n===1?'  Frozen Assignment 002  ':`Frozen Assignment ${String(n+1).padStart(3,'0')}`)
  const testTitles=Array.from({length:200},(_,n)=>`Frozen Test ${String(n+1).padStart(3,'0')}`)
  const item=(kind:string,title:string,n:number)=>({id:id(`${kind}-row:${n+1}`),artifact_id:id(`${kind}-artifact:${n+1}`),position:n,title,...(kind==='assessment'?{assessment_type:'test'}:{})})
  const structural={schema_version:3,metadata:{title:'Frozen structural course',subject:'Computer Science',grade_level:'11'},sections:{outline_markdown:'Frozen structural outline'},
    assignments:[...assignmentTitles.map((title,n)=>item('assignment',title,n)),null,{}, {title:123},{title:''}],assessments:[...testTitles.map((title,n)=>item('assessment',title,n)),null,{}, {title:false},{title:''}]}
  const versions=Array.from({length:4},(_,n)=>({id:id(`version:${n}`),versionNumber:n+1,sourceDraftRevision:n+1,
    rawGuidance:n===1?guidance:null,snapshot:n===0?structural:{schema_version:3,metadata:{title:forbiddenSentinels[n===1?2:n===2?3:1]},sections:{outline_markdown:forbiddenSentinels[n===1?2:n===2?3:1]},
      assignments:[{title:forbiddenSentinels[n===1?2:n===2?3:1]}],assessments:[{title:forbiddenSentinels[n===1?2:n===2?3:1]}],authoring_guidance:n===1?guidance:n===2?null:{...guidance,course_expectations_markdown:forbiddenSentinels[1]}}}))
  const classes=['adopted','fallback','archived','unlinked','missing-blueprint','missing-version'].map((label,n)=>({id:id(`class:${n}`),label,owner:actors[n===1?1:0].id,code:`${name}_${n}`,
    source_blueprint_id:n===3||n===4?null:blueprint.id,source_blueprint_version_id:n===3||n===5?null:versions[0].id,authoring_guidance_version_id:n===0?versions[1].id:n===2?versions[2].id:null}))
  const enrollments=[[0,0],[0,2],[2,3]].map(([ci,ai],n)=>({id:id(`enrollment:${n}`),actorId:actors[ai].id,classroomId:classes[ci].id}))
  const liveAssignment={id:id('live-assignment'),artifactId:id('live-assignment-artifact')},liveTest={id:id('live-test'),artifactId:id('live-test-artifact')}
  const missingClassId=id('missing-class'),purgeId=id('purge'),allocatedIds=[...actors.map(a=>a.id),...classes.map(c=>c.id),...enrollments.map(e=>e.id),blueprint.id,...versions.map(v=>v.id),unitId,liveAssignment.id,liveAssignment.artifactId,liveTest.id,liveTest.artifactId,missingClassId,purgeId]
  const snapshotIds=[...structural.assignments,...structural.assessments].flatMap(r=>r&&'id'in r&&'artifact_id'in r?[r.id,r.artifact_id]:[])
  assert.equal(new Set([...allocatedIds,...snapshotIds]).size,allocatedIds.length+snapshotIds.length)
  return freeze({version:1 as const,tag:name,projectId:`pika_assignment_list_${tag.slice(-12)}`,actors,classes,enrollments,blueprint,versions,assignmentTitles,testTitles,guidance,unitId,liveAssignment,liveTest,
    forbiddenSentinels,missingClassId,purgeId,allocatedIds,baseline:`private.${name}_baseline`})
}
export type ClassroomAuthoringGuidanceFixture=ReturnType<typeof newClassroomAuthoringGuidanceFixture>
export function assertClassroomAuthoringGuidanceFixture(f:ClassroomAuthoringGuidanceFixture){assert.deepEqual(f,newClassroomAuthoringGuidanceFixture(`assignmentlist_${f.tag.slice(-12)}`));assert(Object.isFrozen(f.versions))}
export type ClassroomAuthoringGuidanceSqlName='prepare'|'setup'|'witness'|'purge-fenced'|'restore-baseline'|'preservation'|`observe-${number}`
export type ClassroomAuthoringGuidanceSqlDescriptor=Readonly<{name:ClassroomAuthoringGuidanceSqlName;profile:'baseline-off';sql:string;sha256:string;nativeVerified:false}>
export type ClassroomAuthoringGuidanceSdkCall=Readonly<{label:string;status:200|403|404|503;transition?:ClassroomAuthoringGuidanceSqlName;args:{p_actor_id:string;p_classroom_id:string}}>
export function classroomAuthoringGuidanceSdkInventory(f:ClassroomAuthoringGuidanceFixture):readonly ClassroomAuthoringGuidanceSdkCall[]{
  assertClassroomAuthoringGuidanceFixture(f);const[o,t,m,s,former]=f.actors,[a,b,c,d,e,partial]=f.classes
  const call=(label:string,actor:string,classroom:string,status:ClassroomAuthoringGuidanceSdkCall['status']=200,transition?:ClassroomAuthoringGuidanceSqlName):ClassroomAuthoringGuidanceSdkCall=>({label,status,...(transition?{transition}:{}),args:{p_actor_id:actor,p_classroom_id:classroom}})
  return freeze([call('student-owner-adopted',o.id,a.id),call('teacher-owner-fallback',t.id,b.id),call('archived-owner-null-guidance',o.id,c.id),call('unlinked-owner',o.id,d.id),call('missing-blueprint-pointer',o.id,e.id),call('missing-version-pointer',o.id,partial.id),
    call('teacher-member-denied',m.id,a.id,403),call('stranger-denied',s.id,a.id,403),call('former-class-blueprint-owner-denied',former.id,a.id,403),call('missing-class',o.id,f.missingClassId,404),
    call('attendance-free-purge-fenced',o.id,d.id,503,'purge-fenced'),call('restored-unlinked-owner',o.id,d.id,200,'restore-baseline')])
}
function expectedContext(f:ClassroomAuthoringGuidanceFixture,ci:number){
  if(ci<0||ci>=3)return null
  const content=f.versions[0],guidance=f.versions[ci===0?1:ci===2?2:0]
  return{blueprint_id:f.blueprint.id,content_version_id:content.id,content_version_number:content.versionNumber,source_blueprint_version_id:guidance.id,
    source_blueprint_version_number:guidance.versionNumber,source_draft_revision:guidance.sourceDraftRevision,guidance:guidance.rawGuidance,
    course:{title:'Frozen structural course',subject:'Computer Science',grade_level:'11',outline_markdown:'Frozen structural outline',assignment_titles:[...f.assignmentTitles],test_titles:[...f.testTitles]}}
}
/** Independent saved-fixture oracle: never invokes the production reader. */
export function classroomAuthoringGuidanceExpectedWire(f:ClassroomAuthoringGuidanceFixture,call:ClassroomAuthoringGuidanceSdkCall){
  if(call.status!==200)return{code:`PT${call.status}`,message:`class_authoring_guidance_${call.status===403?'forbidden':call.status===404?'missing':'fenced'}`,details:null,hint:null}
  const ci=f.classes.findIndex(c=>c.id===call.args.p_classroom_id),c=f.classes[ci];assert(c);const context=expectedContext(f,ci)
  return{actor_id:call.args.p_actor_id,classroom_id:c.id,classroom:{id:c.id,teacher_id:c.owner,source_blueprint_id:c.source_blueprint_id,source_blueprint_version_id:c.source_blueprint_version_id,authoring_guidance_version_id:c.authoring_guidance_version_id},
    version_parents:context?{content:f.blueprint.id,guidance:f.blueprint.id}:null,context}
}
export function classroomAuthoringGuidanceExpectedView(f:ClassroomAuthoringGuidanceFixture,call:ClassroomAuthoringGuidanceSdkCall){
  if(call.status!==200)return null
  const context=expectedContext(f,f.classes.findIndex(c=>c.id===call.args.p_classroom_id))
  return{context:context?{...context,guidance:normalizeCourseBlueprintAuthoringGuidance(context.guidance)}:null}
}
/** Full rows in exact fixture scopes; a foreign classroom merely linked to our
 * Blueprint remains in the complement, never silently excluded by that link. */
export function classroomAuthoringGuidanceGraphSql(f:ClassroomAuthoringGuidanceFixture,synthetic:boolean){
  const bp=q(f.blueprint.id),classes=f.classes.map(c=>q(c.id)).join(','),actors=f.actors.map(a=>q(a.id)).join(',')
  const archiveOps=`select id from public.classroom_archive_operations where classroom_id in (${classes})`,purgeOps=`select id from public.course_blueprint_purge_operations where course_blueprint_id=${bp}`
  const scopes:[string,string][]=[['student_profiles',`user_id in (${actors})`],['course_blueprints',`id=${bp}`],['course_blueprint_draft_admissions',`teacher_id in (${actors})`],
    ...['course_blueprint_versions','course_blueprint_assignments','course_blueprint_assessments','course_blueprint_materials','course_blueprint_surveys','course_blueprint_lesson_templates','course_blueprint_editing_sessions','course_blueprint_change_proposals','course_blueprint_authoring_guidance_revisions','course_blueprint_purge_operations','course_blueprint_purge_fences'].map(table=>[table,`course_blueprint_id=${bp}`]as[string,string]),
    ['course_blueprint_operations',`source_blueprint_id=${bp} or result_blueprint_id=${bp}`],['course_blueprint_purge_objects',`operation_id in (${purgeOps})`],
    ...['classroom_guided_draft_provenance','classroom_archives','classroom_archive_operations','classroom_cold_tombstones','cold_classroom_purge_fences'].map(table=>[table,`classroom_id in (${classes})`]as[string,string]),
    ...['classroom_archive_snapshot_resources','classroom_archive_snapshot_actors','classroom_archive_object_upload_cleanup','classroom_archive_restore_staging','classroom_archive_restore_expected_objects'].map(table=>[table,`operation_id in (${archiveOps})`]as[string,string])]
  return`(${attendancePolicyWriteGraphSql(f,synthetic)})||jsonb_build_object(${scopes.map(([table,predicate])=>`${q(table)},coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.${table} r where ${synthetic?'':'not '}(coalesce((${predicate}),false))),'[]'::jsonb)`).join(',')})`
}
/** SQL-generation is bounded independently of700 snapshot objects. */
export function classroomAuthoringGuidanceSqlDescriptors(f:ClassroomAuthoringGuidanceFixture):readonly ClassroomAuthoringGuidanceSqlDescriptor[]{
  assertClassroomAuthoringGuidanceFixture(f);const graph=classroomAuthoringGuidanceGraphSql(f,true),original=`encode(extensions.digest((${classroomAuthoringGuidanceGraphSql(f,false)})::text,'sha256'),'hex')`
  const prefix="begin;set local lock_timeout='1s';set local statement_timeout='8s';",stage=(name:string)=>`commit;select jsonb_build_object('stage',${q(name)},'nativeVerified',false);`
  const owner=q(f.actors[0].id),seeder=q(f.actors[4].id),bp=q(f.blueprint.id),empty=q(f.classes[3].id)
  const prepare=`${prefix}do $collision$ begin if to_regclass(${q(f.baseline)}) is not null or exists(select 1 from jsonb_each(${graph}) where value<>'[]'::jsonb) or exists(select 1 from public.classrooms where id=${q(f.missingClassId)}) then raise exception 'guidance_fixture_collision';end if;end;$collision$;
 create table ${f.baseline}(singleton boolean primary key check(singleton),original_sha256 text not null,graph jsonb,checkpoint jsonb,observed integer not null default -1);
 revoke all on ${f.baseline} from public,anon,authenticated,service_role;insert into ${f.baseline}(singleton,original_sha256) values(true,${original});${stage('prepare')}`
  const generatedId=(kind:string)=>{const seed=`encode(extensions.digest(${q(`${f.tag}:${kind}:`)}||n::text,'sha256'),'hex')`;return`(select (substr(h,1,8)||'-'||substr(h,9,4)||'-4'||substr(h,14,3)||'-8'||substr(h,18,3)||'-'||substr(h,21,12))::uuid from (select ${seed} h) digest)`}
  const items=(kind:string,count:number)=>`(select jsonb_agg(jsonb_build_object('id',${generatedId(`${kind}-row`)},'artifact_id',${generatedId(`${kind}-artifact`)},'position',n-1,'title',${kind==='assignment'?`case when n=1 then E' \\t ' when n=2 then '  Frozen Assignment 002  ' else 'Frozen Assignment '||lpad(n::text,3,'0') end`:`'Frozen Test '||lpad(n::text,3,'0')`}${kind==='assessment'?",'assessment_type','test'":''}) order by n) from generate_series(1,${count}) n)||'[null,{},{"title":${kind==='assignment'?'123':'false'}},{"title":""}]'::jsonb`
  const structural=`jsonb_build_object('schema_version',3,'metadata',${json({title:'Frozen structural course',subject:'Computer Science',grade_level:'11'})},'sections',${json({outline_markdown:'Frozen structural outline'})},'assignments',${items('assignment',500)},'assessments',${items('assessment',200)})`
  const versionSeeds=f.versions.map((v,n)=>`with saved as(select ${n===0?structural:json(v.snapshot)} snapshot) insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_schema_version,snapshot_json,snapshot_sha256,source_kind,source_metadata,created_by)
 select ${q(v.id)},${bp},${v.versionNumber},${v.sourceDraftRevision},3,snapshot,encode(extensions.digest(snapshot::text,'sha256'),'hex'),'pika',${json({fixture:f.tag})},${seeder} from saved;`).join('\n')
  const setup=`${prefix}insert into public.users(id,email,role) values${f.actors.map(a=>`(${q(a.id)},${q(a.email)},${q(a.role)})`).join(',')};
 insert into public.effective_feature_entitlements(subject_user_id,feature_key,source,enabled,starts_at,quota_limit,revision) values${[0,1,4].map(n=>`(${q(f.actors[n].id)},'classrooms.create','manual',true,'2020-01-01',10,1)`).join(',')} on conflict(subject_user_id,feature_key) do update set enabled=true,quota_limit=10,starts_at='2020-01-01',expires_at=null;
 insert into public.course_blueprints(id,teacher_id,title) values(${bp},${seeder},${q(f.forbiddenSentinels[0])});
 insert into public.course_blueprint_assignments(id,artifact_id,course_blueprint_id,title) values(${q(f.liveAssignment.id)},${q(f.liveAssignment.artifactId)},${bp},${q(f.forbiddenSentinels[0])});
 insert into public.course_blueprint_assessments(id,artifact_id,course_blueprint_id,assessment_type,title) values(${q(f.liveTest.id)},${q(f.liveTest.artifactId)},${bp},'test',${q(f.forbiddenSentinels[0])});
 update public.course_blueprints set outline_markdown=${q(f.forbiddenSentinels[0])} where id=${bp};${versionSeeds}
 update public.course_blueprints set latest_version_number=4,authoring_guidance=${json({...f.guidance,course_expectations_markdown:f.forbiddenSentinels[0]})} where id=${bp};
 insert into public.classrooms(id,teacher_id,title,class_code,source_blueprint_id,source_blueprint_version_id,authoring_guidance_version_id) values${f.classes.map((c,n)=>`(${q(c.id)},${n===1?q(c.owner):seeder},${q(f.tag)},${q(c.code)},${c.source_blueprint_id?q(c.source_blueprint_id):'null'},${c.source_blueprint_version_id?q(c.source_blueprint_version_id):'null'},${c.authoring_guidance_version_id?q(c.authoring_guidance_version_id):'null'})`).join(',')};
 update public.classrooms set teacher_id=${owner} where id in (${f.classes.filter((_,n)=>n!==1).map(c=>q(c.id)).join(',')});
 insert into public.classroom_enrollments(id,classroom_id,student_id) values${f.enrollments.map(e=>`(${q(e.id)},${q(e.classroomId)},${q(e.actorId)})`).join(',')};
 update public.classrooms set archived_at='2026-10-20T00:00:00Z' where id=${q(f.classes[2].id)};
 update ${f.baseline} set graph=${graph};update ${f.baseline} set checkpoint=graph;${stage('setup')}`
  const witness=`begin read only;set local statement_timeout='8s';select jsonb_build_object('studentOwner',exists(select 1 from public.classrooms c join public.users u on u.id=c.teacher_id where c.id=${q(f.classes[0].id)} and u.id=${owner} and u.role='student'),
 'blueprintOwnerDifferent',exists(select 1 from public.course_blueprints where id=${bp} and teacher_id=${seeder} and teacher_id<>${owner}),
 'membershipGenerationRows',(select count(*) from private.pal_membership_generations g join public.classroom_enrollments e on e.id=g.generation_id where e.id in (${f.enrollments.map(e=>q(e.id)).join(',')}) and g.state='active' and g.scope_digest=private.pal_membership_scope(e.classroom_id,e.student_id)),
 'archivedGenerationRetained',exists(select 1 from private.pal_membership_generations g join public.classroom_enrollments e on e.id=g.generation_id join public.classrooms c on c.id=e.classroom_id where e.id=${q(f.enrollments[2].id)} and c.archived_at is not null and g.state='active' and g.scope_digest=private.pal_membership_scope(c.id,e.student_id)),
 'versions',(select count(*) from public.course_blueprint_versions where course_blueprint_id=${bp}),
 'structuralAssignments',(select count(*) from public.course_blueprint_versions v,lateral jsonb_array_elements(v.snapshot_json->'assignments') item where v.id=${q(f.versions[0].id)} and jsonb_typeof(item->'title')='string' and item->>'title'<>''),
 'structuralTests',(select count(*) from public.course_blueprint_versions v,lateral jsonb_array_elements(v.snapshot_json->'assessments') item where v.id=${q(f.versions[0].id)} and jsonb_typeof(item->'title')='string' and item->>'title'<>''),
 'honestVersionHashes',not exists(select 1 from public.course_blueprint_versions where course_blueprint_id=${bp} and snapshot_sha256<>encode(extensions.digest(snapshot_json::text,'sha256'),'hex')),
 'liveDraftNewer',(select content_revision>4 and latest_version_number=4 from public.course_blueprints where id=${bp}),'nativeVerified',false);rollback;`
  const frames:[ClassroomAuthoringGuidanceSqlName,string][]=[['prepare',prepare],['setup',setup],['witness',witness]]
  for(const[n,call]of classroomAuthoringGuidanceSdkInventory(f).entries())frames.push([`observe-${n}`,`${prefix}do $observe$ begin if (select observed from ${f.baseline}) <> ${n-1} or (${graph}) is distinct from (select checkpoint from ${f.baseline}) or ${original} is distinct from (select original_sha256 from ${f.baseline}) then raise exception 'guidance_read_changed_graph';end if;update ${f.baseline} set observed=${n};end;$observe$;select jsonb_build_object('case',${q(call.label)},'preserved',true,'nativeVerified',false);commit;`])
  frames.push(['purge-fenced',`${prefix}insert into public.classroom_purge_operations(id,teacher_id,classroom_id,request_sha256,source_revision,impact_summary) values(${q(f.purgeId)},${owner},${empty},'${'0'.repeat(64)}',1,'{}');insert into public.classroom_purge_fences(classroom_id,operation_id,teacher_id) values(${empty},${q(f.purgeId)},${owner});update ${f.baseline} set checkpoint=${graph};${stage('purge-fenced')}`],
    ['restore-baseline',`${prefix}delete from public.classroom_purge_fences where operation_id=${q(f.purgeId)};delete from public.classroom_purge_operations where id=${q(f.purgeId)};
 do $restore$ declare v_graph jsonb;begin v_graph:=${graph};if (select graph from ${f.baseline}) is null then if exists(select 1 from jsonb_each(v_graph) where value<>'[]'::jsonb) then raise exception 'guidance_partial_setup';end if;update ${f.baseline} set graph=v_graph;end if;
 if v_graph is distinct from (select graph from ${f.baseline}) or ${original} is distinct from (select original_sha256 from ${f.baseline}) then raise exception 'guidance_restore_mismatch';end if;update ${f.baseline} set checkpoint=v_graph;end;$restore$;${stage('restore-baseline')}`],
    ['preservation',`begin read only;set local statement_timeout='8s';select jsonb_build_object('sourcePreserved',(${graph}) is not distinct from (select graph from ${f.baseline}),'originalsPreserved',${original} is not distinct from (select original_sha256 from ${f.baseline}),'nativeVerified',false);rollback;`])
  assert.equal(frames.length,18);return freeze(frames.map(([name,sql])=>{assert(Buffer.byteLength(sql)<=65536,`${name}:SQL cap ${Buffer.byteLength(sql)}`);return{name,sql,sha256:hash(sql),profile:'baseline-off'as const,nativeVerified:false as const}}))
}
export function assertClassroomAuthoringGuidanceSqlDescriptor(f:ClassroomAuthoringGuidanceFixture,frame:ClassroomAuthoringGuidanceSqlDescriptor){const expected=classroomAuthoringGuidanceSqlDescriptors(f).find(r=>r.name===frame.name);assert(expected);assert.deepEqual(frame,expected)}
