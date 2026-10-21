-- SOURCE ONLY until an exact isolated target is authorized. Run with ON_ERROR_STOP.
-- Rollback-only read-boundary proof; synthetic archive evidence does not prove stored bytes.
begin;

do $acl$
begin
  if pg_catalog.has_function_privilege('anon', 'public.read_classroom_archive_recovery_for_owner_v1(uuid,uuid,uuid)', 'execute')
    or pg_catalog.has_function_privilege('authenticated', 'public.read_classroom_archive_recovery_for_owner_v1(uuid,uuid,uuid)', 'execute')
    or not pg_catalog.has_function_privilege('service_role', 'public.read_classroom_archive_recovery_for_owner_v1(uuid,uuid,uuid)', 'execute') then
    raise exception 'Owner archive recovery ACL invalid';
  end if;
  if not exists (select 1 from pg_catalog.pg_proc p where p.oid = 'public.read_classroom_archive_recovery_for_owner_v1(uuid,uuid,uuid)'::regprocedure
    and p.provolatile = 's' and not p.prosecdef and 'search_path=""' = any(p.proconfig)) then
    raise exception 'Owner archive recovery snapshot or search-path contract invalid';
  end if;
end;
$acl$;

insert into public.users(id,email,role) values
  ('e1000000-0000-4000-8000-000000000001','archive-owner-teacher@example.invalid','teacher'),
  ('e1000000-0000-4000-8000-000000000002','archive-owner-student@example.invalid','student'),
  ('e1000000-0000-4000-8000-000000000003','archive-nonmember@example.invalid','student');
insert into public.classrooms(id,teacher_id,title,class_code,archived_at) values
  ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Archive A','ARCA26',now()),
  ('e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000002','Archive B','ARCB26',now());
insert into public.classroom_enrollments(classroom_id,student_id) values
  ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001'),
  ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002'),
  ('e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000001');

set local role service_role;
do $mixed_roles$
declare
  v_actor uuid;
  v_other_class uuid;
  v_result jsonb;
begin
  foreach v_actor in array array['e1000000-0000-4000-8000-000000000001'::uuid,'e1000000-0000-4000-8000-000000000002'::uuid] loop
    v_result := public.read_classroom_archive_recovery_for_owner_v1(v_actor);
    if jsonb_array_length(v_result->'hot_classrooms') is distinct from 1
      or v_result #>> '{hot_classrooms,0,classroom,teacher_id}' is distinct from v_actor::text
      or coalesce(v_result #> '{hot_classrooms,0,current_revision}', 'null'::jsonb) = 'null'::jsonb then
      raise exception 'Mixed-role ownership list invalid: %', v_result;
    end if;
    v_other_class := case when v_actor = 'e1000000-0000-4000-8000-000000000001'::uuid
      then 'e2000000-0000-4000-8000-000000000002'::uuid else 'e2000000-0000-4000-8000-000000000001'::uuid end;
    v_result := public.read_classroom_archive_recovery_for_owner_v1(v_actor,v_other_class);
    if v_result->'hot_classrooms' is distinct from '[]'::jsonb or v_result->'cold_archives' is distinct from '[]'::jsonb or v_result->'verified_export' is distinct from 'null'::jsonb then
      raise exception 'Membership granted owner recovery: %',v_result;
    end if;
  end loop;
  v_result := public.read_classroom_archive_recovery_for_owner_v1('e1000000-0000-4000-8000-000000000003');
  if v_result->'hot_classrooms' is distinct from '[]'::jsonb then raise exception 'Nonmember obtained recovery'; end if;
end;
$mixed_roles$;
reset role;

-- Database-valid synthetic text, intentionally beyond the authoring API limit.
-- Proves the expanded UTF-8 result ceiling, not a browser/network allocation cap.
do $response_budget$
declare
  v_class constant uuid := 'e2000000-0000-4000-8000-000000000001';
  v_actor constant uuid := 'e1000000-0000-4000-8000-000000000001';
begin
  update public.classrooms set title=repeat('x',16777217) where id=v_class;
  if public.read_classroom_archive_recovery_for_owner_v1(v_actor,v_class) is not null then
    raise exception 'Oversized complete archive projection was accepted';
  end if;
  update public.classrooms set title='Archive A' where id=v_class;
end;
$response_budget$;

-- A synthetic completed ledger/archive pair exercises exact identity binding only.
insert into public.classroom_archive_operations(
  id,teacher_id,classroom_id,operation_type,request_sha256,status,source_revision,
  source_schema_migration,source_app_commit,retention,archive_id,storage_bucket,storage_path,
  artifact_sha256,content_sha256,compressed_byte_size,uncompressed_byte_size,resource_counts,
  storage_object_counts,verification,snapshot_created_at,snapshot_expires_at,completed_at,
  source_contract_version,archive_format_version,restore_contract_version
)
select 'e3000000-0000-4000-8000-000000000001',c.teacher_id,c.id,'export',repeat('a',64),'completed',r.revision,
  '107_classroom_archive_v2_direct_source','abcdef1','{"mode":"teacher_managed","delete_after":null}'::jsonb,
  'e4000000-0000-4000-8000-000000000001','classroom-archives','read-proof/synthetic.tar.gz',
  repeat('a',64),repeat('b',64),100,200,'{"classrooms":1}'::jsonb,'{}'::jsonb,
  jsonb_build_object('read_back_verified',true,'artifact_checksum_verified',true,'manifest_verified',true,
    'resource_checksums_verified',true,'resource_counts_verified',true,'storage_objects_verified',true,
    'actor_snapshots_verified',true,'verified_at',now()),now(),now()+interval '1 hour',now(),2,2,2
from public.classrooms c join public.classroom_archive_revisions r on r.classroom_id=c.id
where c.id='e2000000-0000-4000-8000-000000000001';
insert into public.classroom_archives(
  id,operation_id,classroom_id,teacher_id,format,format_version,source_revision,source_schema_migration,
  source_app_commit,storage_bucket,storage_path,artifact_sha256,content_sha256,compressed_byte_size,
  uncompressed_byte_size,resource_counts,storage_object_counts,verification,retention,created_at,verified_at
)
select archive_id,id,classroom_id,teacher_id,'pika.classroom-archive',2,source_revision,source_schema_migration,
  source_app_commit,storage_bucket,storage_path,artifact_sha256,content_sha256,compressed_byte_size,
  uncompressed_byte_size,resource_counts,storage_object_counts,verification,retention,snapshot_created_at,completed_at
from public.classroom_archive_operations where id='e3000000-0000-4000-8000-000000000001';

do $terminal$
declare
  v_actor constant uuid := 'e1000000-0000-4000-8000-000000000001';
  v_class constant uuid := 'e2000000-0000-4000-8000-000000000001';
  v_op constant uuid := 'e3000000-0000-4000-8000-000000000001';
  v_result jsonb;
  v_revision bigint;
begin
  v_result := public.read_classroom_archive_recovery_for_owner_v1(v_actor,v_class,v_op);
  if v_result #>> '{verified_export,operation_id}' is distinct from v_op::text
    or v_result #>> '{verified_export,classroom_id}' is distinct from v_class::text
    or v_result #>> '{verified_export,teacher_id}' is distinct from v_actor::text then raise exception 'Exact export missing: %',v_result; end if;
  if public.read_classroom_archive_recovery_for_owner_v1(v_actor,'e2000000-0000-4000-8000-000000000002',v_op)->'verified_export' is distinct from 'null'::jsonb then
    raise exception 'Cross-class operation substitution accepted';
  end if;
  select revision into v_revision from public.classroom_archive_revisions where classroom_id=v_class;
  update public.classrooms set title='Archive A changed' where id=v_class;
  v_result := public.read_classroom_archive_recovery_for_owner_v1(v_actor,v_class,v_op);
  if coalesce((v_result #>> '{hot_classrooms,0,current_revision}')::bigint,0) <= v_revision
    or v_result->'verified_export' is distinct from 'null'::jsonb
    or v_result #>> '{hot_classrooms,0,latest_archive,operation_id}' is distinct from v_op::text then
    raise exception 'Historical archive was promoted to current-revision success';
  end if;
  update public.classrooms set teacher_id='e1000000-0000-4000-8000-000000000002' where id=v_class;
  v_result := public.read_classroom_archive_recovery_for_owner_v1(v_actor,v_class,v_op);
  if v_result->'hot_classrooms' is distinct from '[]'::jsonb or v_result->'verified_export' is distinct from 'null'::jsonb then raise exception 'Former owner retained recovery'; end if;
  update public.classrooms set archived_at=null where id=v_class;
  if public.read_classroom_archive_recovery_for_owner_v1('e1000000-0000-4000-8000-000000000002',v_class)->'hot_classrooms' is distinct from '[]'::jsonb then
    raise exception 'Unarchived classroom remained hot recovery';
  end if;
  -- Cold ownership is current tombstone ownership; archive binding remains explicit.
  insert into public.classroom_cold_tombstones(classroom_id,teacher_id,archive_id,title,archived_at,source_revision)
  select classroom_id,teacher_id,id,'Archive A cold',created_at,source_revision
  from public.classroom_archives where operation_id=v_op;
  delete from public.classrooms where id=v_class;
  v_result := public.read_classroom_archive_recovery_for_owner_v1(v_actor,v_class,v_op);
  if v_result->'hot_classrooms' is distinct from '[]'::jsonb or jsonb_array_length(v_result->'cold_archives') is distinct from 1
    or v_result #>> '{cold_archives,0,archive_teacher_id}' is distinct from v_actor::text
    or v_result->'verified_export' is distinct from 'null'::jsonb then raise exception 'Cold recovery binding invalid'; end if;
  delete from public.classroom_cold_tombstones where classroom_id=v_class;
  if public.read_classroom_archive_recovery_for_owner_v1(v_actor,v_class)->'cold_archives' is distinct from '[]'::jsonb then raise exception 'Deleted cold root remained visible'; end if;
end;
$terminal$;

rollback;

select pg_catalog.jsonb_build_object('version',1,'scope','lifecycle-services-rollback-contract-v1',
  'outcome','passed','stage','archive-recovery','sqlstate',null);
