/** Inert reorder descriptors. Semantic position restoration retains legitimate version history. */
import assert from 'node:assert/strict'
import {attendancePolicyWriteFreeze as freeze,attendancePolicyWriteHash as hash,attendancePolicyWriteGraphSql} from './contextual-attendance-policy-write-native-fixture'
export {attendancePolicyWriteFreeze as classroomListReorderFreeze,attendancePolicyWriteHash as classroomListReorderHash} from './contextual-attendance-policy-write-native-fixture'
export const CLASSROOM_LIST_REORDER_CAPS=freeze({sdkRequests:12,sqlFrames:18,sqlBytes:65536,requestBytes:4096,responseBytes:16384,bytes:1048576,sessions:1,controls:2048,requestMs:8000,workMs:720000,cleanupMs:180000})
export const CLASSROOM_LIST_REORDER_ACCOUNTING=freeze({sqlFrames:18,http:12,fullGuards:60,leafActions:90})
const q=(v:string)=>`'${v.replaceAll("'","''")}'`,json=(v:unknown)=>`${q(JSON.stringify(v))}::jsonb`
export function newClassroomListReorderFixture(tag:string){
  assert.match(tag,/^assignmentlist_[a-f0-9]{12}$/);const name=`classroom_reorder_${tag.slice(-12)}`
  const id=(label:string)=>{const h=hash(`${name}:${label}`);return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`}
  const actors=(['student','teacher','student','teacher','teacher']as const).map((role,n)=>({id:id(`actor:${n}`),role,email:`${name}_${n}@example.invalid`}))
  const classes=['student-a','student-b','teacher-c','teacher-d','archived'].map((label,n)=>({id:id(`class:${n}`),label,owner:actors[n===2||n===3?1:0].id,code:`${name}_${n}`,position:n===4?7:n%2}))
  const enrollments=[[0,0],[0,3],[2,1]].map(([ci,ai],n)=>({id:id(`enrollment:${n}`),actorId:actors[ai].id,classroomId:classes[ci].id}))
  const missingClassId=id('missing'),purgeId=id('purge'),allocatedIds=[...actors.map(r=>r.id),...classes.map(r=>r.id),...enrollments.map(r=>r.id),missingClassId,purgeId]
  assert.equal(new Set(allocatedIds).size,allocatedIds.length)
  return freeze({version:1 as const,tag:name,projectId:`pika_assignment_list_${tag.slice(-12)}`,actors,classes,enrollments,missingClassId,purgeId,allocatedIds,baseline:`private.${name}_baseline`})
}
export type ClassroomListReorderFixture=ReturnType<typeof newClassroomListReorderFixture>
export function assertClassroomListReorderFixture(f:ClassroomListReorderFixture){assert.deepEqual(f,newClassroomListReorderFixture(`assignmentlist_${f.tag.slice(-12)}`));assert(Object.isFrozen(f.classes))}
export type ClassroomListReorderSqlName='prepare'|'setup'|'witness'|'purge-fenced'|'restore-baseline'|'preservation'|`observe-${number}`
export type ClassroomListReorderSqlDescriptor=Readonly<{name:ClassroomListReorderSqlName;profile:'baseline-off';sql:string;sha256:string;nativeVerified:false}>
export type ClassroomListReorderSdkCall=Readonly<{label:string;status:200|400|503;transition?:ClassroomListReorderSqlName;args:{p_actor_id:string;p_classroom_ids:string[]}}>
export function classroomListReorderSdkInventory(f:ClassroomListReorderFixture):readonly ClassroomListReorderSdkCall[]{
  assertClassroomListReorderFixture(f);const[o,t,e,m]=f.actors,[a,b,c,d,archived]=f.classes
  const call=(label:string,actor:string,ids:string[],status:ClassroomListReorderSdkCall['status']=200,transition?:ClassroomListReorderSqlName):ClassroomListReorderSdkCall=>({label,status,...(transition?{transition}:{}),args:{p_actor_id:actor,p_classroom_ids:ids}})
  return freeze([call('student-owner-reverse',o.id,[b.id,a.id]),call('student-owner-repeat-equal',o.id,[b.id,a.id]),call('teacher-owner-equal',t.id,[c.id,d.id]),call('empty-owner',e.id,[]),
    call('teacher-member-invalid-set',m.id,[a.id,b.id],400),call('cross-owner-invalid-set',t.id,[a.id,b.id],400),call('omitted-owned-class',o.id,[a.id],400),
    call('archived-included',o.id,[a.id,b.id,archived.id],400),call('missing-class-included',o.id,[a.id,f.missingClassId],400),
    call('disabled-creation-grant',o.id,[a.id,b.id]),call('attendance-free-purge-fenced',o.id,[a.id,b.id],503,'purge-fenced'),call('restored-final-order',o.id,[a.id,b.id],200,'restore-baseline')])
}
export function classroomListReorderGraphSql(f:ClassroomListReorderFixture,synthetic:boolean){return`(${attendancePolicyWriteGraphSql(f,synthetic)})||jsonb_build_object('student_profiles',coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.student_profiles r where ${synthetic?'':'not '}(coalesce((user_id in (${f.actors.map(a=>q(a.id)).join(',')})),false))),'[]'::jsonb))`}
/** Independent full-row oracle: only submitted active rows may change position/time;
 * every such update (including equal order) has exactly one archive revision bump.
 * Blueprint revision remains covered by immutable complete-row equality. */
function rowOracle(){return`if (v_graph-'classrooms'-'classroom_archive_revisions') is distinct from (v_before-'classrooms'-'classroom_archive_revisions') then raise exception 'reorder_other_graph_changed';end if;
 if jsonb_array_length(v_graph->'classrooms')<>jsonb_array_length(v_before->'classrooms') or jsonb_array_length(v_graph->'classroom_archive_revisions')<>jsonb_array_length(v_before->'classroom_archive_revisions') then raise exception 'reorder_row_count_changed';end if;
 for v_row in select value from jsonb_array_elements(v_graph->'classrooms') loop
 select value into v_old from jsonb_array_elements(v_before->'classrooms') where value->>'id'=v_row->>'id';
 if v_order ? (v_row->>'id') then
 if (v_row-'position'-'updated_at') is distinct from (v_old-'position'-'updated_at') or (v_row->>'position')::integer<>(v_order->>(v_row->>'id'))::integer
 or (v_row->>'updated_at')::timestamptz < v_window_start or (v_row->>'updated_at')::timestamptz > statement_timestamp() then raise exception 'reorder_class_effect_mismatch';end if;
 else if v_row is distinct from v_old then raise exception 'reorder_untargeted_class_changed';end if;end if;end loop;
 for v_row in select value from jsonb_array_elements(v_graph->'classroom_archive_revisions') loop
 select value into v_old from jsonb_array_elements(v_before->'classroom_archive_revisions') where value->>'classroom_id'=v_row->>'classroom_id';
 if v_order ? (v_row->>'classroom_id') then
 if (v_row-'revision'-'updated_at') is distinct from (v_old-'revision'-'updated_at') or (v_row->>'revision')::bigint<>(v_old->>'revision')::bigint+1
 or v_row->>'updated_at' is distinct from (select value->>'updated_at' from jsonb_array_elements(v_graph->'classrooms') where value->>'id'=v_row->>'classroom_id') then raise exception 'reorder_archive_effect_mismatch';end if;
 else if v_row is distinct from v_old then raise exception 'reorder_untargeted_revision_changed';end if;end if;end loop;`}
function semanticGraph(graph:string,active:string[]){return`(${graph})||jsonb_build_object('classrooms',(select jsonb_agg(case when value->>'id' in (${active.map(q).join(',')}) then value-'updated_at' else value end order by value->>'id') from jsonb_array_elements((${graph})->'classrooms')),
 'classroom_archive_revisions',(select jsonb_agg(case when value->>'classroom_id' in (${active.map(q).join(',')}) then value-'revision'-'updated_at' else value end order by value->>'classroom_id') from jsonb_array_elements((${graph})->'classroom_archive_revisions')))`}
export function classroomListReorderSqlDescriptors(f:ClassroomListReorderFixture):readonly ClassroomListReorderSqlDescriptor[]{
  assertClassroomListReorderFixture(f);const graph=classroomListReorderGraphSql(f,true),original=`encode(extensions.digest((${classroomListReorderGraphSql(f,false)})::text,'sha256'),'hex')`
  const prefix="begin;set local lock_timeout='1s';set local statement_timeout='8s';",stage=(name:string)=>`commit;select jsonb_build_object('stage',${q(name)},'nativeVerified',false);`
  const owner=q(f.actors[0].id),empty=q(f.classes[1].id),active=f.classes.slice(0,4).map(c=>c.id)
  const declarations='v_before jsonb;v_graph jsonb;v_order jsonb;v_row jsonb;v_old jsonb;v_window_start timestamptz;'
  const unchanged=`if ${original} is distinct from (select original_sha256 from ${f.baseline}) then raise exception 'reorder_original_graph_changed';end if;`
  const prepare=`${prefix}do $collision$ begin if to_regclass(${q(f.baseline)}) is not null or exists(select 1 from jsonb_each(${graph}) where value<>'[]'::jsonb) or exists(select 1 from public.classrooms where id=${q(f.missingClassId)}) then raise exception 'reorder_fixture_collision';end if;end;$collision$;
 create table ${f.baseline}(singleton boolean primary key check(singleton),original_sha256 text not null,graph jsonb,checkpoint jsonb,window_start timestamptz not null default statement_timestamp(),observed integer not null default -1);
 revoke all on ${f.baseline} from public,anon,authenticated,service_role;insert into ${f.baseline}(singleton,original_sha256) values(true,${original});${stage('prepare')}`
  const setup=`${prefix}insert into public.users(id,email,role) values${f.actors.map(a=>`(${q(a.id)},${q(a.email)},${q(a.role)})`).join(',')};
 insert into public.effective_feature_entitlements(subject_user_id,feature_key,source,enabled,starts_at,quota_limit,revision) values${[0,1,4].map(n=>`(${q(f.actors[n].id)},'classrooms.create','manual',true,'2020-01-01',10,1)`).join(',')} on conflict(subject_user_id,feature_key) do update set enabled=true,quota_limit=10,starts_at='2020-01-01',expires_at=null;
 insert into public.classrooms(id,teacher_id,title,class_code,position) values${f.classes.map((c,n)=>`(${q(c.id)},${q(n===2||n===3?c.owner:f.actors[4].id)},${q(f.tag)},${q(c.code)},${c.position})`).join(',')};
 update public.classrooms set teacher_id=${owner} where id in (${[0,1,4].map(n=>q(f.classes[n].id)).join(',')});
 insert into public.classroom_enrollments(id,classroom_id,student_id) values${f.enrollments.map(e=>`(${q(e.id)},${q(e.classroomId)},${q(e.actorId)})`).join(',')};
 update public.classrooms set archived_at='2026-10-20T00:00:00Z' where id=${q(f.classes[4].id)};
 update public.effective_feature_entitlements set enabled=false where subject_user_id=${owner} and feature_key='classrooms.create';
 update ${f.baseline} set graph=${graph};update ${f.baseline} set checkpoint=graph,window_start=statement_timestamp();${stage('setup')}`
  const witness=`begin read only;set local statement_timeout='8s';select jsonb_build_object('studentOwner',exists(select 1 from public.classrooms c join public.users u on u.id=c.teacher_id where c.id=${q(f.classes[0].id)} and u.role='student'),
 'membershipGenerationRows',(select count(*) from private.pal_membership_generations g join public.classroom_enrollments e on g.generation_id=e.id where e.id in (${f.enrollments.map(e=>q(e.id)).join(',')}) and g.state='active' and g.scope_digest=private.pal_membership_scope(e.classroom_id,e.student_id)),
 'creationGrantDisabled',exists(select 1 from public.effective_feature_entitlements where subject_user_id=${owner} and feature_key='classrooms.create' and not enabled),'nativeVerified',false);rollback;`
  const frames:[ClassroomListReorderSqlName,string][]=[['prepare',prepare],['setup',setup],['witness',witness]]
  for(const[n,call]of classroomListReorderSdkInventory(f).entries()){
    const order=call.status===200?Object.fromEntries(call.args.p_classroom_ids.map((id,n)=>[id,n])):{}
    const orderHash=call.status===200?`encode(extensions.digest(coalesce((select string_agg(c.id::text,',' order by c.position) from public.classrooms c where c.teacher_id=${q(call.args.p_actor_id)} and c.archived_at is null),''),'sha256'),'hex')`:'null'
    frames.push([`observe-${n}`,`${prefix}do $observe$ declare ${declarations} begin
 if (select observed from ${f.baseline}) <> ${n-1} or (select graph from ${f.baseline}) is null then raise exception 'reorder_observation_order';end if;
 select checkpoint,window_start into v_before,v_window_start from ${f.baseline};v_graph:=${graph};v_order:=${json(order)};${rowOracle()}${unchanged}
 update ${f.baseline} set checkpoint=v_graph,window_start=statement_timestamp(),observed=${n};end;$observe$;
 select jsonb_build_object('case',${q(call.label)},'preserved',true,'orderSha256',${orderHash},'nativeVerified',false);commit;`])
  }
  frames.push(['purge-fenced',`${prefix}insert into public.classroom_purge_operations(id,teacher_id,classroom_id,request_sha256,source_revision,impact_summary) values(${q(f.purgeId)},${owner},${empty},'${'0'.repeat(64)}',1,'{}');insert into public.classroom_purge_fences(classroom_id,operation_id,teacher_id) values(${empty},${q(f.purgeId)},${owner});update ${f.baseline} set checkpoint=${graph},window_start=statement_timestamp();${stage('purge-fenced')}`])
  const restore=`${prefix}delete from public.classroom_purge_fences where operation_id=${q(f.purgeId)};delete from public.classroom_purge_operations where id=${q(f.purgeId)};
 do $restore$ declare ${declarations} begin select checkpoint,window_start into v_before,v_window_start from ${f.baseline};
 v_before:=jsonb_set(jsonb_set(v_before,'{classroom_purge_fences}',coalesce((select jsonb_agg(value order by value::text) from jsonb_array_elements(v_before->'classroom_purge_fences') where value->>'operation_id'<>${q(f.purgeId)}),'[]'::jsonb)),'{classroom_purge_operations}',coalesce((select jsonb_agg(value order by value::text) from jsonb_array_elements(v_before->'classroom_purge_operations') where value->>'id'<>${q(f.purgeId)}),'[]'::jsonb));
 select coalesce(jsonb_object_agg(c.id::text,r.position),'{}'::jsonb) into v_order from public.classrooms c,${f.baseline} b,lateral jsonb_populate_recordset(null::public.classrooms,b.graph->'classrooms') r where c.id=r.id and c.id in (${active.map(q).join(',')}) and c.position is distinct from r.position;
 update public.classrooms c set position=(v_order->>c.id::text)::integer where v_order ? c.id::text;
 v_graph:=${graph};if (select graph from ${f.baseline}) is null then if exists(select 1 from jsonb_each(v_graph) where value<>'[]'::jsonb) then raise exception 'reorder_partial_setup';end if;v_before:=v_graph;update ${f.baseline} set graph=v_graph;end if;${rowOracle()}${unchanged}
 if ${semanticGraph('v_graph',active)} is distinct from ${semanticGraph(`(select graph from ${f.baseline})`,active)} then raise exception 'reorder_semantic_restore_mismatch';end if;
 update ${f.baseline} set checkpoint=v_graph,window_start=statement_timestamp();end;$restore$;${stage('restore-baseline')}`
  frames.push(['restore-baseline',restore],['preservation',`begin read only;set local statement_timeout='8s';with current_graph as materialized(select ${graph} as g) select jsonb_build_object('sourcePreserved',g is not distinct from (select checkpoint from ${f.baseline}) and ${semanticGraph('g',active)} is not distinct from ${semanticGraph(`(select graph from ${f.baseline})`,active)},'originalsPreserved',${original} is not distinct from (select original_sha256 from ${f.baseline}),'nativeVerified',false) from current_graph;rollback;`])
  assert.equal(frames.length,18);return freeze(frames.map(([name,sql])=>{assert(Buffer.byteLength(sql)<=65536,`${name}:SQL cap ${Buffer.byteLength(sql)}`);return{name,sql,profile:'baseline-off'as const,sha256:hash(sql),nativeVerified:false as const}}))
}
export function assertClassroomListReorderSqlDescriptor(f:ClassroomListReorderFixture,frame:ClassroomListReorderSqlDescriptor){const expected=classroomListReorderSqlDescriptors(f).find(r=>r.name===frame.name);assert(expected);assert.deepEqual(frame,expected)}
