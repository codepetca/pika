/** Inert descriptors only. Committed Versions/history are never compensated. */
import assert from 'node:assert/strict'
import {canonicalizeCourseBlueprintSnapshot,type CourseBlueprintSnapshot} from '../src/lib/server/course-blueprint-versions'
import {classroomGuidancePreviewGraphScopes} from './contextual-classroom-guidance-preview-native-fixture'
import {attendancePolicyWriteFreeze as freeze,attendancePolicyWriteHash as hash} from './contextual-attendance-policy-write-native-fixture'
export {attendancePolicyWriteFreeze as classroomGuidanceAdoptionFreeze,attendancePolicyWriteHash as classroomGuidanceAdoptionHash} from './contextual-attendance-policy-write-native-fixture'
export const CLASSROOM_GUIDANCE_ADOPTION_CAPS=freeze({requests:12,sqlFrames:17,sqlBytes:65536,requestBytes:8388608,responseBytes:8388608,bytes:33554432,sessions:1,controls:2048,requestMs:8000,workMs:720000,cleanupMs:180000})
export const CLASSROOM_GUIDANCE_ADOPTION_ACCOUNTING=freeze({sqlFrames:17,http:12,fullGuards:58,leafActions:87,outerActions:10,contentionReserve:45,totalPlannedActions:142})
const q=(s:string)=>`'${s.replaceAll("'","''")}'`,json=(v:unknown)=>`${q(JSON.stringify(v))}::jsonb`
const kinds=['assignments','assessments','lesson_templates','materials','surveys']as const
export function newClassroomGuidanceAdoptionFixture(tag:string){
  assert.match(tag,/^assignmentlist_[a-f0-9]{12}$/);const name=`guidance_adoption_${tag.slice(-12)}`
  const id=(label:string)=>{const h=hash(`${name}:${label}`);return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`}
  const actors=(['student','teacher','teacher']as const).map((role,n)=>({id:id(`actor:${n}`),role,email:`${name}_${n}@example.invalid`}))
  const guidance={course_expectations_markdown:'Explain every conclusion. 雪',assignment_guidance_markdown:'Preserve reasoning.',test_guidance_markdown:'Use self-contained questions.',unit_exceptions:[]}
  const site={overview:true,outline:true,resources:true,assignments:true,tests:true,lesson_plans:true}
  const blueprints=([1,1001,1]as const).map((count,n)=>({id:id(`blueprint:${n}`),owner:actors[n===1?0:1].id,count,revision:1+5*count,structuralVersionId:id(`structural:${n}`),title:`${name} ${['T','S','D'][n]}`}))
  const classes=blueprints.map((b,n)=>({id:id(`class:${n}`),owner:b.owner,blueprintId:b.id,structuralVersionId:b.structuralVersionId,code:`${name}_${n}`}))
  const dedupVersionId=id('dedup-version'),enrollments:readonly{id:string;actorId:string;classroomId:string}[]=[]
  const rowId=(kind:typeof kinds[number],bi:number,n:number)=>id(`row:${kind}:${bi}:${n}`),artifactId=(kind:typeof kinds[number],bi:number,n:number)=>id(`artifact:${kind}:${bi}:${n}`)
  const rows=blueprints.map((b,bi)=>{
    const base=(kind:typeof kinds[number],n:number)=>({id:rowId(kind,bi,n),course_blueprint_id:b.id,artifact_id:artifactId(kind,bi,n),title:`${kind} ${n} 雪`,position:kind==='materials'?b.count+n-1:kind==='surveys'?2*b.count+n-1:n-1})
    return{assignments:Array.from({length:b.count},(_,i)=>({...base('assignments',i+1),instructions_markdown:`Assignment body 雪 ${i+1}`,submission_requirements_json:[],default_due_days:-3,default_due_time:'23:59',points_possible:0,gradebook_weight:0,include_in_final:true,is_draft:true,track_authenticity:false})),
      assessments:Array.from({length:b.count},(_,i)=>({...base('assessments',i+1),assessment_type:'test'as const,content:{questions:[]},documents:[],points_possible:2.5,gradebook_weight:10,include_in_final:true})),
      lesson_templates:Array.from({length:b.count},(_,i)=>({...base('lesson_templates',i+1),content_markdown:`Lesson body ${i+1}`})),materials:Array.from({length:b.count},(_,i)=>({...base('materials',i+1),content_markdown:`Material body ${i+1}`})),
      surveys:Array.from({length:b.count},(_,i)=>({...base('surveys',i+1),show_results:true,dynamic_responses:false,questions_json:[]}))}
  })
  const allocatedIds=[...actors.map(a=>a.id),...blueprints.flatMap(b=>[b.id,b.structuralVersionId]),...classes.map(c=>c.id),dedupVersionId,...rows.flatMap(r=>kinds.flatMap(k=>r[k].flatMap(x=>[x.id,x.artifact_id])))]
  assert.equal(new Set(allocatedIds).size,allocatedIds.length)
  return freeze({version:1 as const,tag:name,projectId:`pika_assignment_list_${tag.slice(-12)}`,actors,blueprints,classes,enrollments,rows,guidance,site,dedupVersionId,allocatedIds,baseline:`private.${name}_baseline`})
}
export type ClassroomGuidanceAdoptionFixture=ReturnType<typeof newClassroomGuidanceAdoptionFixture>
export function assertClassroomGuidanceAdoptionFixture(f:ClassroomGuidanceAdoptionFixture){assert.deepEqual(f,newClassroomGuidanceAdoptionFixture(`assignmentlist_${f.tag.slice(-12)}`));assert(Object.isFrozen(f.rows))}
export function classroomGuidanceAdoptionFlows(f:ClassroomGuidanceAdoptionFixture){
  const labels=['teacher-new-version','student-complete-5005','existing-version-dedup','parent-only-stale-digest','classroom-owner-revoked','blueprint-owner-revoked']as const
  return freeze(labels.map((label,n)=>{const bi=n<2?n:2,b=f.blueprints[bi],c=f.classes[bi],status:200|409|403=n<3?200:n===3?409:403;return{label,index:n,blueprintIndex:bi,actorId:b.owner,classroomId:c.id,status,input:{blueprint_id:b.id,expected_content_version_id:b.structuralVersionId,expected_guidance_version_id:n>2?f.dedupVersionId:b.structuralVersionId,expected_draft_revision:b.revision}}}))
}
export function classroomGuidanceAdoptionSource(f:ClassroomGuidanceAdoptionFixture,index:number,sourceSha256:string){
  assert.match(sourceSha256,/^[a-f0-9]{64}$/);const flow=classroomGuidanceAdoptionFlows(f)[index];assert(flow);const b=f.blueprints[flow.blueprintIndex],c=f.classes[flow.blueprintIndex]
  return{actor_id:flow.actorId,classroom_id:c.id,classroom:{id:c.id,teacher_id:c.owner,archived_at:null,source_blueprint_id:b.id,source_blueprint_version_id:b.structuralVersionId,authoring_guidance_version_id:index>2?f.dedupVersionId:null},
    versions:{content:{id:b.structuralVersionId,course_blueprint_id:b.id},guidance:{id:flow.input.expected_guidance_version_id,course_blueprint_id:b.id,version_number:index>2?2:1}},
    source:{blueprint:{id:b.id,teacher_id:b.owner,content_revision:b.revision,title:b.title,subject:'Computer Science',grade_level:'11',course_code:'ICS3U',term_template:'Semester',overview_markdown:'Overview',outline_markdown:'Outline',resources_markdown:'Resources',authoring_guidance:f.guidance,gradebook_use_weights:false,gradebook_assignments_weight:70,gradebook_tests_weight:30,planned_site_slug:null,planned_site_published:false,planned_site_config:f.site},...f.rows[flow.blueprintIndex]},
    counts:Object.fromEntries(kinds.map(k=>[k,b.count])),source_sha256:sourceSha256}
}
/** Independent whole snapshot oracle: never calls buildCourseBlueprintSnapshot. */
export function classroomGuidanceAdoptionSnapshot(f:ClassroomGuidanceAdoptionFixture,bi:number):CourseBlueprintSnapshot{
  const b=f.blueprints[bi],r=f.rows[bi]
  return{schema_version:3,blueprint_id:b.id,draft_revision:b.revision,metadata:{title:b.title,subject:'Computer Science',grade_level:'11',course_code:'ICS3U',term_template:'Semester'},sections:{overview_markdown:'Overview',outline_markdown:'Outline',resources_markdown:'Resources'},authoring_guidance:{...f.guidance,unit_exceptions:[]},grading:{use_weights:false,assignments_weight:70,tests_weight:30},planned_site:{slug:null,published:false,config:{...f.site}},
    assignments:r.assignments.map(({artifact_id,title,instructions_markdown,default_due_days,default_due_time,points_possible,gradebook_weight,include_in_final,is_draft,track_authenticity,position})=>({artifact_id,title,instructions_markdown,submission_requirements:[],default_due_days,default_due_time,points_possible,gradebook_weight,include_in_final,is_draft,track_authenticity,position})),
    assessments:r.assessments.map(({artifact_id,title,points_possible,gradebook_weight,include_in_final,position})=>({artifact_id,assessment_type:'test',title,content:{title,show_results:false,question_identity_version:1,questions:[]},documents:[],points_possible,gradebook_weight,include_in_final,position})),
    lesson_templates:r.lesson_templates.map(({artifact_id,title,content_markdown,position})=>({artifact_id,title,content_markdown,position})),materials:r.materials.map(({artifact_id,title,content_markdown,position})=>({artifact_id,title,content_markdown,position})),surveys:r.surveys.map(({artifact_id,title,show_results,dynamic_responses,position})=>({artifact_id,title,show_results,dynamic_responses,questions:[],position}))}
}
export const classroomGuidanceAdoptionCanonical=(f:ClassroomGuidanceAdoptionFixture,bi:number)=>canonicalizeCourseBlueprintSnapshot(classroomGuidanceAdoptionSnapshot(f,bi))
export const classroomGuidanceAdoptionSnapshotHash=(f:ClassroomGuidanceAdoptionFixture,bi:number)=>hash(classroomGuidanceAdoptionCanonical(f,bi))
export function classroomGuidanceAdoptionGraphSql(f:ClassroomGuidanceAdoptionFixture,synthetic:boolean){
  const values=(rows:readonly{id:string}[])=>rows.length?`values${rows.map(r=>`(${q(r.id)}::uuid)`).join(',')}`:'select null::uuid where false'
  const cte=`with fixture_actors(id) as(${values(f.actors)}),fixture_classes(id) as(${values(f.classes)}),fixture_enrollments(id) as(${values(f.enrollments)}),fixture_blueprints(id) as(${values(f.blueprints)}),fixture_pal_scopes(scope_digest) as(select private.pal_membership_scope(c.id,a.id) from fixture_classes c cross join fixture_actors a),fixture_archive_operations(id) as(select id from public.classroom_archive_operations where classroom_id in (select id from fixture_classes)),fixture_blueprint_purge_operations(id) as(select id from public.course_blueprint_purge_operations where course_blueprint_id in (select id from fixture_blueprints))`
  const scopes=classroomGuidancePreviewGraphScopes(),group=(rows:typeof scopes)=>`jsonb_build_object(${rows.map(({table,predicate})=>`${q(table.split('.')[1])},coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from ${table} r where ${synthetic?'':'not '}(coalesce((${predicate}),false))),'[]'::jsonb)`).join(',')})`
  return`(${cte} select ${group(scopes.slice(0,40))}||${group(scopes.slice(40))})`
}
export type ClassroomGuidanceAdoptionSqlName='prepare'|'setup'|'witness'|'restore-temporary'|'preservation'|`source-${number}`|`observe-${number}`
export type ClassroomGuidanceAdoptionSqlDescriptor=Readonly<{name:ClassroomGuidanceAdoptionSqlName;sql:string;sha256:string;profile:'baseline-off';nativeVerified:false}>
/** SQL-side independent fixture projection; no canonical text interpolation. */
function generatedIdSql(f:ClassroomGuidanceAdoptionFixture,label:string){const seed=`encode(extensions.digest(${q(`${f.tag}:${label}:`)}||n::text,'sha256'),'hex')`;return`(select (substr(h,1,8)||'-'||substr(h,9,4)||'-4'||substr(h,14,3)||'-8'||substr(h,18,3)||'-'||substr(h,21,12))::uuid from (select ${seed} h) digest)`}
function snapshotSql(f:ClassroomGuidanceAdoptionFixture,bi:number){
  const b=f.blueprints[bi],base=classroomGuidanceAdoptionSnapshot(f,bi),{assignments:_,assessments:__,lesson_templates:___,materials:____,surveys:_____,...header}=base;void _;void __;void ___;void ____;void _____
  const items=kinds.map(kind=>{const id=generatedIdSql(f,`artifact:${kind}:${bi}`),title=`${q(`${kind} `)}||n::text||' 雪'`,position=kind==='materials'?`${b.count}+n-1`:kind==='surveys'?`${2*b.count}+n-1`:'n-1'
    const fields=kind==='assignments'?`,'instructions_markdown','Assignment body 雪 '||n::text,'submission_requirements','[]'::jsonb,'default_due_days',-3,'default_due_time','23:59','points_possible',0,'gradebook_weight',0,'include_in_final',true,'is_draft',true,'track_authenticity',false`:
      kind==='assessments'?`,'assessment_type','test','content',jsonb_build_object('title',${title},'show_results',false,'question_identity_version',1,'questions','[]'::jsonb),'documents','[]'::jsonb,'points_possible',2.5,'gradebook_weight',10,'include_in_final',true`:
      kind==='surveys'?`,'show_results',true,'dynamic_responses',false,'questions','[]'::jsonb`:`,'content_markdown',${q(kind==='lesson_templates'?'Lesson body ':'Material body ')}||n::text`
    return`${q(kind)},(select jsonb_agg(jsonb_build_object('artifact_id',${id},'title',${title},'position',${position}${fields}) order by n) from generate_series(1,${b.count}) n)`})
  return`(${json(header)}||jsonb_build_object(${items.join(',')}))`
}
function classDelta(target:string,field:'teacher_id'|'authoring_guidance_version_id',expected:string){return`
 if jsonb_array_length(v_graph->'classrooms')<>jsonb_array_length(v_before->'classrooms') or jsonb_array_length(v_graph->'classroom_archive_revisions')<>jsonb_array_length(v_before->'classroom_archive_revisions') then raise exception 'adoption_class_count_mismatch';end if;
 for v_row in select value from jsonb_array_elements(v_graph->'classrooms') loop select value into v_old from jsonb_array_elements(v_before->'classrooms') where value->>'id'=v_row->>'id';
 if v_old is null then raise exception 'adoption_class_identity_mismatch';end if;
 if v_row->>'id'=${target} then if (v_row-array[${q(field)},'updated_at']) is distinct from (v_old-array[${q(field)},'updated_at']) or v_row->>${q(field)} is distinct from ${expected} or v_row->>'updated_at' is null or (v_row->>'updated_at')::timestamptz<v_window or (v_row->>'updated_at')::timestamptz>statement_timestamp() then raise exception 'adoption_class_delta_mismatch';end if;
 elsif v_row is distinct from v_old then raise exception 'adoption_untargeted_class_changed';end if;end loop;
 for v_row in select value from jsonb_array_elements(v_graph->'classroom_archive_revisions') loop select value into v_old from jsonb_array_elements(v_before->'classroom_archive_revisions') where value->>'classroom_id'=v_row->>'classroom_id';
 if v_old is null then raise exception 'adoption_archive_identity_mismatch';end if;
 if v_row->>'classroom_id'=${target} then if (v_row-array['revision','updated_at']) is distinct from (v_old-array['revision','updated_at']) or (v_row->>'revision')::bigint<>(v_old->>'revision')::bigint+1 or v_row->>'updated_at' is distinct from (select value->>'updated_at' from jsonb_array_elements(v_graph->'classrooms') where value->>'id'=${target}) then raise exception 'adoption_archive_delta_mismatch';end if;
 elsif v_row is distinct from v_old then raise exception 'adoption_untargeted_archive_changed';end if;end loop;`}
function blueprintDelta(target:string,field:'teacher_id'|'latest_version_number',expected:string){return`
 if jsonb_array_length(v_graph->'course_blueprints')<>jsonb_array_length(v_before->'course_blueprints') then raise exception 'adoption_blueprint_count_mismatch';end if;
 for v_row in select value from jsonb_array_elements(v_graph->'course_blueprints') loop select value into v_old from jsonb_array_elements(v_before->'course_blueprints') where value->>'id'=v_row->>'id';
 if v_old is null then raise exception 'adoption_blueprint_identity_mismatch';end if;
 if v_row->>'id'=${target} then if (v_row-array[${q(field)},'updated_at']) is distinct from (v_old-array[${q(field)},'updated_at']) or v_row->>${q(field)} is distinct from ${expected} or v_row->>'updated_at' is null or (v_row->>'updated_at')::timestamptz<v_window or (v_row->>'updated_at')::timestamptz>statement_timestamp() then raise exception 'adoption_blueprint_delta_mismatch';end if;
 elsif v_row is distinct from v_old then raise exception 'adoption_untargeted_blueprint_changed';end if;end loop;`}
function materialDelta(f:ClassroomGuidanceAdoptionFixture,parent:string){return`
 if jsonb_array_length(v_graph->'course_blueprint_materials')<>jsonb_array_length(v_before->'course_blueprint_materials') then raise exception 'adoption_material_count_mismatch';end if;
 for v_row in select value from jsonb_array_elements(v_graph->'course_blueprint_materials') loop select value into v_old from jsonb_array_elements(v_before->'course_blueprint_materials') where value->>'id'=v_row->>'id';
 if v_old is null then raise exception 'adoption_material_identity_mismatch';end if;
 if v_row->>'id'=${q(f.rows[2].materials[0].id)} then if (v_row-array['course_blueprint_id','updated_at']) is distinct from (v_old-array['course_blueprint_id','updated_at']) or v_row->>'course_blueprint_id' is distinct from ${q(parent)} or v_row->>'updated_at' is null or (v_row->>'updated_at')::timestamptz<v_window or (v_row->>'updated_at')::timestamptz>statement_timestamp() then raise exception 'adoption_transition_mismatch';end if;
 elsif v_row is distinct from v_old then raise exception 'adoption_untargeted_material_changed';end if;end loop;`}
/** Restore semantic pointers only, retaining exact ordinary trigger history.
 * The PRE-restoration graph must still equal the denied RPC checkpoint. */
function restoreSql(f:ClassroomGuidanceAdoptionFixture,graph:string){
  const d=f.blueprints[2],c=f.classes[2]
  return`if b.recovery_kind is not null then
 if v_graph is distinct from b.checkpoint then raise exception 'adoption_denied_rpc_changed_graph';end if;
 v_before:=v_graph;v_window:=transaction_timestamp();
 if b.recovery_kind='parent' then update public.course_blueprint_materials set course_blueprint_id=${q(d.id)} where id=${q(f.rows[2].materials[0].id)};
 elsif b.recovery_kind='classroom' then update public.classrooms set teacher_id=${q(c.owner)} where id=${q(c.id)};
 elsif b.recovery_kind='blueprint' then update public.course_blueprints set teacher_id=${q(d.owner)} where id=${q(d.id)};
 else raise exception 'adoption_unknown_recovery';end if;v_graph:=${graph};
 if b.recovery_kind='parent' then
 if (v_graph-'course_blueprint_materials') is distinct from (v_before-'course_blueprint_materials') then raise exception 'adoption_transition_mismatch';end if;${materialDelta(f,d.id)}
 for v_row in select value from jsonb_array_elements(v_graph->'course_blueprint_materials') loop select value into v_old from jsonb_array_elements(b.recovery_before->'course_blueprint_materials') where value->>'id'=v_row->>'id';if (v_row-'updated_at') is distinct from (v_old-'updated_at') then raise exception 'adoption_restore_semantic_mismatch';end if;end loop;
 if (v_graph-'course_blueprint_materials') is distinct from (b.recovery_before-'course_blueprint_materials') then raise exception 'adoption_restore_semantic_mismatch';end if;
 elsif b.recovery_kind='classroom' then
 if (v_graph-array['classrooms','classroom_archive_revisions']) is distinct from (v_before-array['classrooms','classroom_archive_revisions']) then raise exception 'adoption_transition_mismatch';end if;${classDelta(q(c.id),'teacher_id',q(c.owner))}
 for v_row in select value from jsonb_array_elements(v_graph->'classrooms') loop select value into v_old from jsonb_array_elements(b.recovery_before->'classrooms') where value->>'id'=v_row->>'id';if (v_row-'updated_at') is distinct from (v_old-'updated_at') then raise exception 'adoption_restore_semantic_mismatch';end if;end loop;
 elsif b.recovery_kind='blueprint' then
 if (v_graph-'course_blueprints') is distinct from (v_before-'course_blueprints') then raise exception 'adoption_transition_mismatch';end if;${blueprintDelta(q(d.id),'teacher_id',q(d.owner))}
 for v_row in select value from jsonb_array_elements(v_graph->'course_blueprints') loop select value into v_old from jsonb_array_elements(b.recovery_before->'course_blueprints') where value->>'id'=v_row->>'id';if (v_row-'updated_at') is distinct from (v_old-'updated_at') then raise exception 'adoption_restore_semantic_mismatch';end if;end loop;
 else raise exception 'adoption_unknown_recovery';end if;
 v_projection:=private.classroom_guidance_adoption_source_v1(${q(d.id)});if v_projection->>'source_sha256' is distinct from b.source_sha256 then raise exception 'adoption_restore_source_digest_mismatch';end if;
 update ${f.baseline} set recovery_kind=null,recovery_before=null;end if;`
}
export function classroomGuidanceAdoptionSqlDescriptors(f:ClassroomGuidanceAdoptionFixture):readonly ClassroomGuidanceAdoptionSqlDescriptor[]{
  assertClassroomGuidanceAdoptionFixture(f);const graph=classroomGuidanceAdoptionGraphSql(f,true),original=`encode(extensions.digest((${classroomGuidanceAdoptionGraphSql(f,false)})::text,'sha256'),'hex')`
  const prefix="begin;set local lock_timeout='1s';set local statement_timeout='8s';",stage=(name:string)=>`commit;select jsonb_build_object('stage',${q(name)},'nativeVerified',false);`
  const declarations=`b record;v_graph jsonb;v_before jsonb;v_old jsonb;v_row jsonb;v_window timestamptz;v_projection jsonb;v_saved jsonb;v_new_id uuid;`
  const originalCheck=`if ${original} is distinct from b.original_sha256 then raise exception 'adoption_complement_changed';end if;`
  const prepare=`${prefix}do $collision$ begin if to_regclass(${q(f.baseline)}) is not null or exists(select 1 from jsonb_each(${graph}) where value<>'[]'::jsonb) then raise exception 'adoption_fixture_collision';end if;end;$collision$;
 create table ${f.baseline}(singleton boolean primary key check(singleton),original_sha256 text not null,graph jsonb,checkpoint jsonb,window_start timestamptz not null default transaction_timestamp(),observed integer not null default -1,source_flow integer,source_sha256 text,recovery_kind text,recovery_before jsonb);
 revoke all on ${f.baseline} from public,anon,authenticated,service_role;insert into ${f.baseline}(singleton,original_sha256) values(true,${original});${stage('prepare')}`
  const seedChildren=f.blueprints.map((b,bi)=>kinds.map(kind=>{const table=`public.course_blueprint_${kind}`,rid=generatedIdSql(f,`row:${kind}:${bi}`),aid=generatedIdSql(f,`artifact:${kind}:${bi}`),title=`${q(`${kind} `)}||n::text||' 雪'`,position=kind==='materials'?`${b.count}+n-1`:kind==='surveys'?`${2*b.count}+n-1`:'n-1'
    const columns=kind==='assignments'?',instructions_markdown,submission_requirements_json,default_due_days,default_due_time,points_possible,gradebook_weight,include_in_final,is_draft,track_authenticity':kind==='assessments'?',assessment_type,content,documents,points_possible,gradebook_weight,include_in_final':kind==='surveys'?',show_results,dynamic_responses,questions_json':',content_markdown'
    const fields=kind==='assignments'?",'Assignment body 雪 '||n::text,'[]',-3,'23:59',0,0,true,true,false":kind==='assessments'?",'test','{\"questions\":[]}'::jsonb,'[]',2.5,10,true":kind==='surveys'?",true,false,'[]'":`,${q(kind==='lesson_templates'?'Lesson body ':'Material body ')}||n::text`
    return`insert into ${table}(id,course_blueprint_id,artifact_id,title,position${columns}) select ${rid},${q(b.id)},${aid},${title},${position}${fields} from generate_series(1,${b.count}) n;`}).join('\n')).join('\n')
  const seeder=q(f.actors[2].id)
  const setup=`${prefix}insert into public.users(id,email,role) values${f.actors.map(a=>`(${q(a.id)},${q(a.email)},${q(a.role)})`).join(',')};insert into public.effective_feature_entitlements(subject_user_id,feature_key,source,enabled,starts_at,quota_limit,revision) values${f.actors.map(a=>`(${q(a.id)},'classrooms.create','manual',true,'2020-01-01',10,1)`).join(',')} on conflict(subject_user_id,feature_key) do update set enabled=true,quota_limit=10,starts_at='2020-01-01',expires_at=null;
 insert into public.course_blueprints(id,teacher_id,title,subject,grade_level,course_code,term_template,overview_markdown,outline_markdown,resources_markdown,authoring_guidance,planned_site_config) values${f.blueprints.map(b=>`(${q(b.id)},${seeder},${q(b.title)},'Computer Science','11','ICS3U','Semester','Overview','Outline','Resources',${json(f.guidance)},${json(f.site)})`).join(',')};${seedChildren}
 ${f.blueprints.map(b=>{const snapshot={schema_version:3,blueprint_id:b.id,draft_revision:1,authoring_guidance:{course_expectations_markdown:'',assignment_guidance_markdown:'',test_guidance_markdown:'',unit_exceptions:[]}};return`with saved as(select ${json(snapshot)} snapshot) insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_schema_version,snapshot_json,snapshot_sha256,source_kind,source_metadata,created_by) select ${q(b.structuralVersionId)},${q(b.id)},1,1,3,snapshot,encode(extensions.digest(snapshot::text,'sha256'),'hex'),'pika','{}',${seeder} from saved;update public.course_blueprints set latest_version_number=1 where id=${q(b.id)};`}).join('\n')}
 insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_schema_version,snapshot_json,snapshot_sha256,source_kind,source_metadata,created_by) values(${q(f.dedupVersionId)},${q(f.blueprints[2].id)},2,6,3,${snapshotSql(f,2)},${q(classroomGuidanceAdoptionSnapshotHash(f,2))},'repository','{"proof":"retained_original_provenance"}',${seeder});update public.course_blueprints set latest_version_number=2 where id=${q(f.blueprints[2].id)};
 insert into public.classrooms(id,teacher_id,title,class_code,source_blueprint_id,source_blueprint_version_id) values${f.classes.map(c=>`(${q(c.id)},${seeder},${q(f.tag)},${q(c.code)},${q(c.blueprintId)},${q(c.structuralVersionId)})`).join(',')};
 ${f.classes.map(c=>`update public.classrooms set teacher_id=${q(c.owner)} where id=${q(c.id)};`).join('\n')}${f.blueprints.map(b=>`update public.course_blueprints set teacher_id=${q(b.owner)} where id=${q(b.id)};`).join('\n')}
 update ${f.baseline} set graph=${graph};update ${f.baseline} set checkpoint=graph,window_start=transaction_timestamp();${stage('setup')}`
  const witness=`begin read only;set local statement_timeout='8s';select jsonb_build_object('blueprintRevisions',(select jsonb_agg(content_revision order by case id when ${q(f.blueprints[0].id)} then 0 when ${q(f.blueprints[1].id)} then 1 else 2 end) from public.course_blueprints where id in (${f.blueprints.map(b=>q(b.id)).join(',')})),
 'counts',(select jsonb_agg((value->'counts'->>'assignments')::integer+(value->'counts'->>'assessments')::integer+(value->'counts'->>'lesson_templates')::integer+(value->'counts'->>'materials')::integer+(value->'counts'->>'surveys')::integer order by n) from (values${f.blueprints.map((b,n)=>`(${n},private.classroom_guidance_adoption_source_v1(${q(b.id)}))`).join(',')}) t(n,value)),
 'previousVersions',(select jsonb_array_length(graph->'course_blueprint_versions') from ${f.baseline}),'membershipGenerationRows',(select jsonb_array_length(graph->'pal_membership_generations') from ${f.baseline}),'nativeVerified',false);rollback;`
  const rows:[ClassroomGuidanceAdoptionSqlName,string][]=[['prepare',prepare],['setup',setup],['witness',witness]]
  for(const flow of classroomGuidanceAdoptionFlows(f)){
    const n=flow.index,bp=f.blueprints[flow.blueprintIndex],c=f.classes[flow.blueprintIndex],kind=n===3?'parent':n===4?'classroom':n===5?'blueprint':null
    const intervention=n===3?`update public.course_blueprint_materials set course_blueprint_id=${q(f.blueprints[0].id)} where id=${q(f.rows[2].materials[0].id)};v_graph:=${graph};if (v_graph-'course_blueprint_materials') is distinct from (v_before-'course_blueprint_materials') then raise exception 'adoption_transition_mismatch';end if;${materialDelta(f,f.blueprints[0].id)}
      if (private.classroom_guidance_adoption_source_v1(${q(bp.id)})->>'source_sha256') is not distinct from v_projection->>'source_sha256' then raise exception 'adoption_parent_move_digest_unchanged';end if;`:
      n===4?`update public.classrooms set teacher_id=${q(f.actors[2].id)} where id=${q(c.id)};v_graph:=${graph};if (v_graph-array['classrooms','classroom_archive_revisions']) is distinct from (v_before-array['classrooms','classroom_archive_revisions']) then raise exception 'adoption_transition_mismatch';end if;${classDelta(q(c.id),'teacher_id',q(f.actors[2].id))}`:
      n===5?`update public.course_blueprints set teacher_id=${q(f.actors[2].id)} where id=${q(bp.id)};v_graph:=${graph};if (v_graph-'course_blueprints') is distinct from (v_before-'course_blueprints') then raise exception 'adoption_transition_mismatch';end if;${blueprintDelta(q(bp.id),'teacher_id',q(f.actors[2].id))}`:''
    rows.push([`source-${n}`,`${prefix}do $source$ declare ${declarations} begin select * into b from ${f.baseline};v_graph:=${graph};
 if b.observed <> ${n-1} or b.source_flow is not null or b.recovery_kind is not null or v_graph is distinct from b.checkpoint then raise exception 'adoption_source_order_mismatch';end if;${originalCheck}
 v_projection:=private.classroom_guidance_adoption_source_v1(${q(bp.id)});if v_projection->'counts' is distinct from ${json(Object.fromEntries(kinds.map(k=>[k,bp.count])))} or (v_projection#>>'{source,blueprint,content_revision}')::bigint<>${bp.revision} then raise exception 'adoption_source_projection_mismatch';end if;
 v_before:=v_graph;v_window:=transaction_timestamp();${intervention}
 update ${f.baseline} set source_flow=${n},source_sha256=v_projection->>'source_sha256',window_start=v_window,checkpoint=v_graph,recovery_kind=${kind?q(kind):'null'},recovery_before=${kind?'v_before':'null'};end;$source$;
 select jsonb_build_object('case',${q(flow.label)},'sourceSha256',source_sha256,'intervened',${kind?'true':'false'},'nativeVerified',false) from ${f.baseline};commit;`])
    const positive=n<3
    const newVersion=n<2?`if jsonb_array_length(v_graph->'course_blueprint_versions')<>jsonb_array_length(v_before->'course_blueprint_versions')+1 then raise exception 'adoption_new_version_count';end if;
 for v_old in select value from jsonb_array_elements(v_before->'course_blueprint_versions') loop if not exists(select 1 from jsonb_array_elements(v_graph->'course_blueprint_versions') r where r.value=v_old) then raise exception 'adoption_old_version_changed';end if;end loop;
 select value into strict v_saved from jsonb_array_elements(v_graph->'course_blueprint_versions') r where not exists(select 1 from jsonb_array_elements(v_before->'course_blueprint_versions') old where old.value->>'id'=r.value->>'id');v_new_id:=(v_saved->>'id')::uuid;
 if (v_saved-array['id','created_at']) is distinct from jsonb_build_object('course_blueprint_id',${q(bp.id)},'version_number',2,'source_draft_revision',${bp.revision},'snapshot_schema_version',3,'snapshot_json',${snapshotSql(f,flow.blueprintIndex)},'snapshot_sha256',${q(classroomGuidanceAdoptionSnapshotHash(f,flow.blueprintIndex))},'source_kind','pika','source_metadata','{}'::jsonb,'created_by',${q(flow.actorId)}) or v_saved->>'created_at' is null or (v_saved->>'created_at')::timestamptz<v_window or (v_saved->>'created_at')::timestamptz>statement_timestamp() then raise exception 'adoption_new_version_mismatch';end if;${blueprintDelta(q(bp.id),'latest_version_number',q('2'))}`:
      `if v_graph->'course_blueprint_versions' is distinct from v_before->'course_blueprint_versions' or v_graph->'course_blueprints' is distinct from v_before->'course_blueprints' then raise exception 'adoption_dedup_mutated_previous_rows';end if;v_new_id:=${q(f.dedupVersionId)}::uuid;select value into strict v_saved from jsonb_array_elements(v_graph->'course_blueprint_versions') where value->>'id'=v_new_id::text;`
    const effect=positive?`if (v_graph-array['course_blueprint_versions','course_blueprints','classrooms','classroom_archive_revisions']) is distinct from (v_before-array['course_blueprint_versions','course_blueprints','classrooms','classroom_archive_revisions']) then raise exception 'adoption_other_graph_changed';end if;
 ${newVersion}${classDelta(q(c.id),'authoring_guidance_version_id','v_new_id::text')}`:`if v_graph is distinct from b.checkpoint then raise exception 'adoption_denied_rpc_changed_graph';end if;${restoreSql(f,graph)}`
    rows.push([`observe-${n}`,`${prefix}do $observe$ declare ${declarations} begin select * into b from ${f.baseline};v_graph:=${graph};v_before:=b.checkpoint;v_window:=b.window_start;
 if b.observed <> ${n-1} or b.source_flow is distinct from ${n} then raise exception 'adoption_observe_order_mismatch';end if;${originalCheck}${effect}
 update ${f.baseline} set checkpoint=v_graph,observed=${n},source_flow=null,window_start=transaction_timestamp();end;$observe$;
 select jsonb_build_object('case',${q(flow.label)},'savedVersionId',${positive?`(select authoring_guidance_version_id from public.classrooms where id=${q(c.id)})`:'null'},'snapshotSha256',${positive?q(classroomGuidanceAdoptionSnapshotHash(f,flow.blueprintIndex)):'null'},'versionNumber',${positive?'2':'null'},'preserved',true,'restored',${positive?'false':'true'},'nativeVerified',false);commit;`])
  }
  // Rare failure cleanup restores ONLY proven temporary owner/parent changes.
  // An uncertain committed write differs from checkpoint and is refused.
  rows.push(['restore-temporary',`${prefix}do $restore$ declare ${declarations} begin select * into b from ${f.baseline};v_graph:=${graph};
 if b.graph is null then if exists(select 1 from jsonb_each(v_graph) where value<>'[]'::jsonb) then raise exception 'adoption_partial_setup';end if;update ${f.baseline} set graph=v_graph,checkpoint=v_graph;
 elsif v_graph is distinct from b.checkpoint then raise exception 'adoption_uncertain_write_refuse_restore';end if;${originalCheck}${restoreSql(f,graph)}update ${f.baseline} set checkpoint=v_graph,source_flow=null;end;$restore$;${stage('restore-temporary')}`],
    ['preservation',`begin read only;set local statement_timeout='8s';with current_graph as materialized(select ${graph} g) select jsonb_build_object('sourcePreserved',g is not distinct from b.checkpoint and b.recovery_kind is null,'originalsPreserved',${original}=b.original_sha256,'previousVersionsPreserved',not exists(select 1 from jsonb_array_elements(b.graph->'course_blueprint_versions') old where not exists(select 1 from jsonb_array_elements(g->'course_blueprint_versions') new where new.value=old.value)),'versionCount',jsonb_array_length(g->'course_blueprint_versions'),'nativeVerified',false) from current_graph,${f.baseline} b;rollback;`])
  assert.equal(rows.length,17);return freeze(rows.map(([name,sql])=>{assert(Buffer.byteLength(sql)<=65536,`${name}:SQL cap ${Buffer.byteLength(sql)}`);return{name,sql,sha256:hash(sql),profile:'baseline-off'as const,nativeVerified:false as const}}))
}
export function assertClassroomGuidanceAdoptionSqlDescriptor(f:ClassroomGuidanceAdoptionFixture,frame:ClassroomGuidanceAdoptionSqlDescriptor){const expected=classroomGuidanceAdoptionSqlDescriptors(f).find(r=>r.name===frame.name);assert(expected);assert.deepEqual(frame,expected)}
