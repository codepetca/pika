-- Disposable292 SQL-role contract only; not SDK, authentication or browser evidence.
-- Temporary proof objects survive the fixture ROLLBACK solely to verify restoration.
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on
set client_min_messages='warning';
set statement_timeout='30s';
set lock_timeout='1s';

create function pg_temp.home_recovery_graph() returns jsonb
language plpgsql security invoker set search_path='' as $body$
declare t record; rows jsonb; graph jsonb:='{}'::jsonb;
begin
  for t in select n.nspname,c.relname from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relkind in ('r','p')
    order by n.nspname,c.relname loop
    execute pg_catalog.format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb) from %I.%I r',t.nspname,t.relname) into rows;
    graph:=graph||jsonb_build_object(t.nspname||'.'||t.relname,rows);
  end loop;
  return graph;
end;
$body$;
create function pg_temp.home_recovery_catalog() returns jsonb
language sql security invoker set search_path='' as $body$
  select jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_object(
    'definition',pg_catalog.pg_get_functiondef(p.oid),'owner',p.proowner,
    'config',p.proconfig,'acl',p.proacl::text,'definer',p.prosecdef))
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname in (
    'get_classroom_creation_access_v1','set_effective_feature_entitlement_v1',
    'create_classroom_atomic_v1','assert_classroom_creation_allowed_v1',
    'create_default_gradebook_categories','provision_default_classroom_creation_entitlement_v1',
    'read_classroom_home_visibility_v1','set_classroom_home_visibility_v1',
    'try_lock_classroom_membership_change','guard_classroom_purge_lifecycle',
    'bump_classroom_archive_revision_from_classroom','bump_classroom_archive_revision_from_resource');
$body$;
-- Remove only the new creation and its source-required defaults/revision row.
create function pg_temp.home_recovery_without_creation(graph jsonb,classroom uuid) returns jsonb
language plpgsql security invoker set search_path='' as $body$
declare name text; column_name text; rows jsonb;
begin
  foreach name in array array['classrooms','classroom_creation_operations','gradebook_categories','classroom_archive_revisions'] loop
    column_name:=case when name='classrooms' then 'id' else 'classroom_id' end;
    select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) into rows
      from jsonb_array_elements(graph->('public.'||name)) item(value)
      where value->>column_name is distinct from classroom::text;
    graph:=jsonb_set(graph,array['public.'||name],rows);
  end loop;
  return graph;
end;
$body$;
revoke all on function pg_temp.home_recovery_graph(),pg_temp.home_recovery_catalog(),
  pg_temp.home_recovery_without_creation(jsonb,uuid) from public,anon,authenticated,service_role;
create temporary table home_recovery_original as
  select pg_temp.home_recovery_graph() graph,pg_temp.home_recovery_catalog() catalog;

begin;
set local statement_timeout='30s';
set local lock_timeout='1s';
do $precondition$
declare p pg_catalog.pg_proc; service oid:='service_role'::regrole; owner_id oid:='postgres'::regrole;
begin
  if current_user<>'postgres' or current_setting('transaction_isolation')<>'read committed' then
    raise exception 'Recovery proof requires postgres and READ COMMITTED';
  end if;
  if (select graph::text like '%e2920000-0000-4000-8000-%'
    or graph::text like '%home-recovery-%@example.invalid%' from pg_temp.home_recovery_original)
    or exists(select 1 from public.classrooms where class_code in ('HREC292A','HREC292B','HREC292C','HREC292D')) then
    raise exception 'Recovery fixture identity collision';
  end if;
  select * into strict p from pg_catalog.pg_proc
    where oid='public.get_classroom_creation_access_v1(uuid,timestamptz)'::regprocedure;
  if p.proowner<>owner_id or not p.prosecdef or not p.proconfig @> array['search_path=""']
    or (select rolsuper from pg_catalog.pg_roles where oid=service)
    or exists(select 1 from pg_catalog.pg_auth_members where member=service)
    or p.proacl is distinct from array[pg_catalog.makeaclitem(owner_id,owner_id,'EXECUTE',false),
      pg_catalog.makeaclitem(service,owner_id,'EXECUTE',false)]
    or not has_function_privilege('service_role',p.oid,'EXECUTE')
    or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE') then
    raise exception 'Recovery getter must have exact owner/service-only noninherited EXECUTE';
  end if;
end;
$precondition$;
insert into public.users(id,email,role) values
  ('e2920000-0000-4000-8000-000000000001','home-recovery-owner@example.invalid','student'),
  ('e2920000-0000-4000-8000-000000000002','home-recovery-member@example.invalid','teacher');
set local role service_role;
do $grants$
declare actor uuid; revision bigint;
begin
  foreach actor in array array['e2920000-0000-4000-8000-000000000001'::uuid,'e2920000-0000-4000-8000-000000000002'::uuid] loop
    select coalesce((select e.revision from public.effective_feature_entitlements e
      where e.subject_user_id=actor and e.feature_key='classrooms.create'),0) into revision;
    perform public.set_effective_feature_entitlement_v1(
      case when actor='e2920000-0000-4000-8000-000000000001' then 'e2920000-0000-4000-8000-000000000101'::uuid
        else 'e2920000-0000-4000-8000-000000000102'::uuid end,
      actor,'classrooms.create','manual',true,'2020-01-01',null,null,'test:home-recovery','recovery_fixture',revision);
  end loop;
end;
$grants$;
reset role;
insert into public.classrooms(id,teacher_id,title,class_code) values
  ('e2920000-0000-4000-8000-000000000011','e2920000-0000-4000-8000-000000000001','Recovery student-owned','HREC292A'),
  ('e2920000-0000-4000-8000-000000000012','e2920000-0000-4000-8000-000000000002','Recovery teacher-owned','HREC292B');
insert into public.classroom_enrollments(id,classroom_id,student_id) values
  ('e2920000-0000-4000-8000-000000000021','e2920000-0000-4000-8000-000000000011','e2920000-0000-4000-8000-000000000002'),
  ('e2920000-0000-4000-8000-000000000022','e2920000-0000-4000-8000-000000000012','e2920000-0000-4000-8000-000000000001');
insert into public.assignments(id,classroom_id,title,description,due_at,created_by) values
  ('e2920000-0000-4000-8000-000000000031','e2920000-0000-4000-8000-000000000012','Recovery work sentinel','Keep exact work','2099-01-01','e2920000-0000-4000-8000-000000000002');
insert into public.assignment_docs(id,assignment_id,student_id,content,is_submitted,submitted_at) values
  ('e2920000-0000-4000-8000-000000000032','e2920000-0000-4000-8000-000000000031','e2920000-0000-4000-8000-000000000001','{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Recovery submitted-work sentinel"}]}]}'::jsonb,true,'2020-01-01');
set local role service_role;
do $hidden$ begin
  perform public.set_classroom_home_visibility_v1('e2920000-0000-4000-8000-000000000001',
    'e2920000-0000-4000-8000-000000000012','e2920000-0000-4000-8000-000000000022',true);
end; $hidden$;
reset role;
create temporary table home_recovery_state(key text primary key,value jsonb);
grant select,insert on pg_temp.home_recovery_state to service_role;
insert into pg_temp.home_recovery_state values ('seed',pg_temp.home_recovery_graph());
set local role service_role;
do $create$
declare result jsonb;
begin
  if current_user<>'service_role' then raise exception 'Real service role required'; end if;
  result:=public.get_classroom_creation_access_v1('e2920000-0000-4000-8000-000000000001');
  if result->>'managed' is distinct from 'true' or result->>'allowed' is distinct from 'true'
    or result->>'subject_user_id' is distinct from 'e2920000-0000-4000-8000-000000000001' then raise exception 'Initial managed getter differs'; end if;
  result:=public.create_classroom_atomic_v1('e2920000-0000-4000-8000-000000000201',
    'e2920000-0000-4000-8000-000000000001',repeat('a',64),'Recovery new classroom','HREC292C',null,'teal');
  if result->>'ok' is distinct from 'true' or result->>'status' is distinct from '201' or result->>'replayed' is distinct from 'false'
    or result->>'operation_id' is distinct from 'e2920000-0000-4000-8000-000000000201'
    or result#>>'{classroom,teacher_id}' is distinct from 'e2920000-0000-4000-8000-000000000001' then
    raise exception 'Initial real creation contract differs';
  end if;
  insert into pg_temp.home_recovery_state values ('created',result);
end;
$create$;
reset role;
do $created_graph$
declare created_id uuid:=(select (value#>>'{classroom,id}')::uuid from pg_temp.home_recovery_state where key='created');
begin
  if created_id is null or pg_temp.home_recovery_without_creation(pg_temp.home_recovery_graph(),created_id)
    is distinct from (select value from pg_temp.home_recovery_state where key='seed')
    or (select count(*) from public.classroom_creation_operations where classroom_id=created_id
      and operation_id='e2920000-0000-4000-8000-000000000201' and subject_user_id='e2920000-0000-4000-8000-000000000001'
      and request_sha256=repeat('a',64))<>1
    or (select count(*) from public.classroom_creation_operations where classroom_id=created_id)<>1
    or (select count(*) from public.classrooms where id=created_id and teacher_id='e2920000-0000-4000-8000-000000000001'
      and title='Recovery new classroom' and class_code='HREC292C' and theme_color='teal')<>1
    --095 creates revision1;147's three category insert triggers each add1.
    or (select count(*) from public.classroom_archive_revisions where classroom_id=created_id and revision=4)<>1
    or (select jsonb_agg(jsonb_build_array(name,percentage,default_assessment_weight,position,is_default) order by position)
      from public.gradebook_categories where classroom_id=created_id)
      is distinct from '[["Attendance",10,10,0,false],["Term",65,10,1,true],["Final",25,10,2,false]]'::jsonb then
    raise exception 'Creation changed rows outside one classroom/operation/exact defaults';
  end if;
end;
$created_graph$;
insert into pg_temp.home_recovery_state values ('before-disable',pg_temp.home_recovery_graph());
set local role service_role;
do $disable$
declare revision bigint;
begin
  select e.revision into strict revision from public.effective_feature_entitlements e
    where subject_user_id='e2920000-0000-4000-8000-000000000001' and feature_key='classrooms.create';
  perform public.set_effective_feature_entitlement_v1('e2920000-0000-4000-8000-000000000103',
    'e2920000-0000-4000-8000-000000000001','classrooms.create','manual',false,'2020-01-01',null,0,
    'test:home-recovery','recovery_disabled',revision);
end;
$disable$;
reset role;
do $disable_graph$
declare before_graph jsonb:=(select value from pg_temp.home_recovery_state where key='before-disable');
  after_graph jsonb:=pg_temp.home_recovery_graph(); name text; rows jsonb; prior jsonb; changed jsonb; audit jsonb; expected jsonb;
begin
  select value into strict prior from jsonb_array_elements(before_graph->'public.effective_feature_entitlements') item(value)
    where value->>'subject_user_id'='e2920000-0000-4000-8000-000000000001' and value->>'feature_key'='classrooms.create';
  select to_jsonb(e) into strict changed from public.effective_feature_entitlements e
    where e.subject_user_id='e2920000-0000-4000-8000-000000000001' and e.feature_key='classrooms.create';
  select to_jsonb(a) into strict audit from public.effective_feature_entitlement_audit a
    where operation_id='e2920000-0000-4000-8000-000000000103';
  expected:=jsonb_build_object('operation_id','e2920000-0000-4000-8000-000000000103',
    'subject_user_id',prior->'subject_user_id','feature_key','classrooms.create',
    'previous_source',prior->'source','previous_enabled',prior->'enabled','previous_starts_at',prior->'starts_at',
    'previous_expires_at',prior->'expires_at','previous_quota_limit',prior->'quota_limit',
    'new_source','manual','new_enabled',false,'new_starts_at',to_jsonb('2020-01-01'::timestamptz),'new_expires_at',null,
    'new_quota_limit',0,'entitlement_revision',(prior->>'revision')::bigint+1,
    'actor_ref','test:home-recovery','reason_code','recovery_disabled','request_fingerprint',
    md5(jsonb_build_object('subject_user_id',prior->'subject_user_id','feature_key','classrooms.create','source','manual',
      'enabled',false,'starts_at','2020-01-01'::timestamptz,'expires_at',null,'quota_limit',0,
      'actor_ref','test:home-recovery','reason_code','recovery_disabled','expected_revision',(prior->>'revision')::bigint)::text));
  if changed-array['enabled','quota_limit','revision','updated_at'] is distinct from prior-array['enabled','quota_limit','revision','updated_at']
    or changed->'enabled' is distinct from 'false'::jsonb or changed->'quota_limit' is distinct from '0'::jsonb
    or (changed->>'revision')::bigint is distinct from (prior->>'revision')::bigint+1
    or (changed->>'updated_at')::timestamptz<(prior->>'updated_at')::timestamptz
    or audit-array['id','created_at'] is distinct from expected
    or (audit->>'created_at')::timestamptz<(changed->>'updated_at')::timestamptz then raise exception 'Disable grant/audit delta differs'; end if;
  foreach name in array array['effective_feature_entitlements','effective_feature_entitlement_audit'] loop
    select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) into rows
      from jsonb_array_elements(after_graph->('public.'||name)) item(value)
      where case when name='effective_feature_entitlement_audit' then value->>'operation_id'<>'e2920000-0000-4000-8000-000000000103'
        else not (value->>'subject_user_id'='e2920000-0000-4000-8000-000000000001' and value->>'feature_key'='classrooms.create') end;
    after_graph:=jsonb_set(after_graph,array['public.'||name],rows);
    select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) into rows
      from jsonb_array_elements(before_graph->('public.'||name)) item(value)
      where name='effective_feature_entitlement_audit' or not
        (value->>'subject_user_id'='e2920000-0000-4000-8000-000000000001' and value->>'feature_key'='classrooms.create');
    before_graph:=jsonb_set(before_graph,array['public.'||name],rows);
  end loop;
  if before_graph is distinct from after_graph then
    raise exception 'Disable changed unrelated relationship/work/private rows';
  end if;
end;
$disable_graph$;
insert into pg_temp.home_recovery_state values ('disabled',pg_temp.home_recovery_graph());
set local role service_role;
do $denial_replay$
declare original jsonb:=(select value from pg_temp.home_recovery_state where key='created'); result jsonb;
begin
  result:=public.get_classroom_creation_access_v1('e2920000-0000-4000-8000-000000000001');
  if result->>'managed' is distinct from 'true' or result->>'allowed' is distinct from 'false'
    or result->>'reason' is distinct from 'disabled' then raise exception 'Disabled managed getter differs'; end if;
  begin
    perform public.create_classroom_atomic_v1('e2920000-0000-4000-8000-000000000202',
      'e2920000-0000-4000-8000-000000000001',repeat('b',64),'Must not create','HREC292D',null,'teal');
    raise exception 'Disabled new operation accepted';
  exception when insufficient_privilege then
    if sqlstate<>'42501' or sqlerrm<>'classroom_creation_entitlement_disabled' then raise; end if;
  end;
  result:=public.create_classroom_atomic_v1('e2920000-0000-4000-8000-000000000201',
    'e2920000-0000-4000-8000-000000000001',repeat('a',64),'Recovery new classroom','HREC292C',null,'teal');
  if result is distinct from jsonb_set(original,'{replayed}','true') then raise exception 'Disabled completed replay differs'; end if;
end;
$denial_replay$;
reset role;
do $denial_effects$ begin
  if pg_temp.home_recovery_graph() is distinct from (select value from pg_temp.home_recovery_state where key='disabled') then
    raise exception 'Disabled denial/replay changed graph';
  end if;
end; $denial_effects$;
revoke execute on function public.get_classroom_creation_access_v1(uuid,timestamptz) from service_role;
set local role service_role;
do $outage$
declare snapshot jsonb;
begin
  begin
    perform public.get_classroom_creation_access_v1('e2920000-0000-4000-8000-000000000001');
    raise exception 'Getter outage did not reject real service-role call';
  exception when insufficient_privilege then
    if sqlstate<>'42501' or sqlerrm<>'permission denied for function get_classroom_creation_access_v1' then raise; end if;
  end;
  if (select count(*) from public.classrooms where teacher_id='e2920000-0000-4000-8000-000000000001' and archived_at is null)<>2
    or (select count(*) from public.classroom_enrollments e join public.classrooms c on c.id=e.classroom_id
      where e.student_id in ('e2920000-0000-4000-8000-000000000001','e2920000-0000-4000-8000-000000000002') and c.archived_at is null)<>2 then
    raise exception 'Existing relationship reads failed during getter outage';
  end if;
  snapshot:=public.read_classroom_home_visibility_v1('e2920000-0000-4000-8000-000000000001');
  if snapshot is distinct from '{"actor_id":"e2920000-0000-4000-8000-000000000001","hidden_enrollment_ids":["e2920000-0000-4000-8000-000000000022"]}'::jsonb then
    raise exception 'Existing visibility failed during getter outage';
  end if;
end;
$outage$;
reset role;
grant execute on function public.get_classroom_creation_access_v1(uuid,timestamptz) to service_role;
set local role service_role;
do $recovered$
declare result jsonb; original jsonb:=(select value from pg_temp.home_recovery_state where key='created');
begin
  result:=public.get_classroom_creation_access_v1('e2920000-0000-4000-8000-000000000001');
  if result->>'managed' is distinct from 'true' or result->>'allowed' is distinct from 'false' or result->>'reason' is distinct from 'disabled'
    or result->>'subject_user_id' is distinct from 'e2920000-0000-4000-8000-000000000001' then raise exception 'Recovered getter lost disabled state'; end if;
  result:=public.create_classroom_atomic_v1('e2920000-0000-4000-8000-000000000201',
    'e2920000-0000-4000-8000-000000000001',repeat('a',64),'Recovery new classroom','HREC292C',null,'teal');
  if result is distinct from jsonb_set(original,'{replayed}','true') then raise exception 'Recovered completed replay differs'; end if;
end;
$recovered$;
reset role;
do $preserved$ begin
  if pg_temp.home_recovery_graph() is distinct from (select value from pg_temp.home_recovery_state where key='disabled')
    or pg_temp.home_recovery_catalog() is distinct from (select catalog from pg_temp.home_recovery_original) then
    raise exception 'Denial/outage/recovery changed graph or canonical function catalog';
  end if;
end; $preserved$;
rollback;
do $rolled_back$ begin
  if pg_temp.home_recovery_graph() is distinct from (select graph from pg_temp.home_recovery_original)
    or pg_temp.home_recovery_catalog() is distinct from (select catalog from pg_temp.home_recovery_original) then
    raise exception 'Recovery fixture rollback did not restore original graph/catalog';
  end if;
end; $rolled_back$;
select 'ok';
select '{"version":1,"scope":"classroom-home-recovery-v1","outcome":"passed","stage":"rolled-back","nativeVerified":false}';
