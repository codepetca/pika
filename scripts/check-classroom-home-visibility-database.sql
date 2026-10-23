-- Source-only until an authorized disposable-clone run. All fixtures roll back.
begin;
set local statement_timeout='30s';

create function pg_temp.home_visibility_public_graph() returns jsonb
language plpgsql security invoker set search_path='' as $body$
declare t record; rows jsonb; graph jsonb:='{}'::jsonb;
begin
  for t in select c.relname from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') order by c.relname loop
    execute pg_catalog.format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb) from public.%I r',t.relname) into rows;
    graph:=graph||jsonb_build_object(t.relname,rows);
  end loop;
  return graph;
end;
$body$;
revoke all on function pg_temp.home_visibility_public_graph() from public,anon,authenticated,service_role;

do $acl$
declare role_name text; signature text;
begin
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(role_name,'private.classroom_home_hidden_enrollments','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'Personal preference table has a direct application grant';
    end if;
  end loop;
  foreach signature in array array['public.read_classroom_home_visibility_v1(uuid)', 'public.set_classroom_home_visibility_v1(uuid,uuid,uuid,boolean)'] loop
    if has_function_privilege('anon',signature,'EXECUTE') or has_function_privilege('authenticated',signature,'EXECUTE')
      or not has_function_privilege('service_role',signature,'EXECUTE') then
      raise exception 'Personal preference RPC ACL differs';
    end if;
  end loop;
  if not (select relrowsecurity from pg_catalog.pg_class where oid='private.classroom_home_hidden_enrollments'::regclass) then
    raise exception 'Private preference RLS missing';
  end if;
end;
$acl$;

insert into public.users(id,email,role) values
  ('c2910000-0000-4000-8000-000000000001','home-visibility-owner@example.invalid','teacher'),
  ('c2910000-0000-4000-8000-000000000002','home-visibility-member@example.invalid','teacher'),
  ('c2910000-0000-4000-8000-000000000003','home-visibility-other@example.invalid','student');
insert into public.effective_feature_entitlements(subject_user_id,feature_key,source,enabled,starts_at,quota_limit,revision)
  select id,'classrooms.create','manual',true,'2020-01-01',null,1 from public.users where id in
  ('c2910000-0000-4000-8000-000000000001','c2910000-0000-4000-8000-000000000002')
  on conflict(subject_user_id,feature_key) do update set enabled=true,starts_at='2020-01-01',expires_at=null,quota_limit=null;
insert into public.classrooms(id,teacher_id,title,class_code) values
  ('c2910000-0000-4000-8000-000000000010','c2910000-0000-4000-8000-000000000001','Joined visibility','HV291A'),
  ('c2910000-0000-4000-8000-000000000011','c2910000-0000-4000-8000-000000000002','Teaching unaffected','HV291B');
insert into public.classroom_enrollments(id,classroom_id,student_id) values
  ('c2910000-0000-4000-8000-000000000020','c2910000-0000-4000-8000-000000000010','c2910000-0000-4000-8000-000000000002'),
  ('c2910000-0000-4000-8000-000000000021','c2910000-0000-4000-8000-000000000010','c2910000-0000-4000-8000-000000000003'),
  ('c2910000-0000-4000-8000-000000000022','c2910000-0000-4000-8000-000000000010','c2910000-0000-4000-8000-000000000001');
-- Synthetic historical self-enrollment preference: ownership must win on read.
insert into private.classroom_home_hidden_enrollments(enrollment_id) values ('c2910000-0000-4000-8000-000000000022');
create temporary table home_visibility_before on commit drop as select pg_temp.home_visibility_public_graph() as graph;

set local role service_role;
do $personal$
declare
  owner_id uuid:='c2910000-0000-4000-8000-000000000001';
  actor uuid:='c2910000-0000-4000-8000-000000000002';
  other_actor uuid:='c2910000-0000-4000-8000-000000000003';
  classroom uuid:='c2910000-0000-4000-8000-000000000010';
  enrollment uuid:='c2910000-0000-4000-8000-000000000020';
  result jsonb;
  hidden boolean;
begin
  if current_user<>'service_role' then raise exception 'Visibility proof did not exercise service role'; end if;
  result:=public.read_classroom_home_visibility_v1(actor);
  if result is distinct from jsonb_build_object('actor_id',actor,'hidden_enrollment_ids','[]'::jsonb) then raise exception 'Initial visibility differs'; end if;
  foreach hidden in array array[true,true,false,false,true] loop
    result:=public.set_classroom_home_visibility_v1(actor,classroom,enrollment,hidden);
    if result is distinct from jsonb_build_object('actor_id',actor,'classroom_id',classroom,'enrollment_id',enrollment,'hidden',hidden) then
      raise exception 'Visibility write actor/classroom/enrollment binding differs';
    end if;
    result:=public.read_classroom_home_visibility_v1(actor);
    if result is distinct from jsonb_build_object('actor_id',actor,'hidden_enrollment_ids',case when hidden then jsonb_build_array(enrollment) else '[]'::jsonb end) then
      raise exception 'Personal visibility read differs';
    end if;
  end loop;
  if public.read_classroom_home_visibility_v1(other_actor) is distinct from jsonb_build_object('actor_id',other_actor,'hidden_enrollment_ids','[]'::jsonb) then
    raise exception 'Personal visibility crossed identities';
  end if;
  if public.read_classroom_home_visibility_v1(owner_id) is distinct from jsonb_build_object('actor_id',owner_id,'hidden_enrollment_ids','[]'::jsonb) then
    raise exception 'Owner precedence failed';
  end if;
  perform public.set_classroom_home_visibility_v1(other_actor,classroom,'c2910000-0000-4000-8000-000000000021',true);
  -- Owner, absent membership, unknown actor and null inputs must not mutate.
  begin
    perform public.set_classroom_home_visibility_v1(owner_id,classroom,'c2910000-0000-4000-8000-000000000022',true);
    raise exception 'Owner preference accepted';
  exception when sqlstate 'PT403' then if sqlerrm<>'classroom_home_visibility_forbidden' then raise; end if; end;
  begin
    perform public.set_classroom_home_visibility_v1(other_actor,'c2910000-0000-4000-8000-000000000011',enrollment,true);
    raise exception 'Nonmember preference accepted';
  exception when sqlstate 'PT403' then if sqlerrm<>'classroom_home_visibility_forbidden' then raise; end if; end;
  begin
    perform public.read_classroom_home_visibility_v1('c2910000-0000-4000-8000-000000000099');
    raise exception 'Unknown actor accepted';
  exception when sqlstate 'PT403' then if sqlerrm<>'classroom_home_visibility_forbidden' then raise; end if; end;
  begin
    perform public.set_classroom_home_visibility_v1(actor,classroom,enrollment,null);
    raise exception 'Null visibility accepted';
  exception when sqlstate 'PT400' then if sqlerrm<>'classroom_home_visibility_invalid_request' then raise; end if; end;
end;
$personal$;
reset role;
do $effects$
begin
  if pg_temp.home_visibility_public_graph() is distinct from (select graph from pg_temp.home_visibility_before) then
    raise exception 'Visibility changed public graph';
  end if;
  if (select count(*) from private.classroom_home_hidden_enrollments where enrollment_id in (
    'c2910000-0000-4000-8000-000000000020','c2910000-0000-4000-8000-000000000021','c2910000-0000-4000-8000-000000000022'))<>3 then
    raise exception 'Visibility changed another actor preference';
  end if;
end;
$effects$;

delete from public.classroom_enrollments where id='c2910000-0000-4000-8000-000000000020';
do $cascade$ begin
  if exists(select 1 from private.classroom_home_hidden_enrollments where enrollment_id='c2910000-0000-4000-8000-000000000020') then
    raise exception 'Enrollment removal retained hidden preference';
  end if;
end; $cascade$;
insert into public.classroom_enrollments(id,classroom_id,student_id) values
  ('c2910000-0000-4000-8000-000000000023','c2910000-0000-4000-8000-000000000010','c2910000-0000-4000-8000-000000000002');
set local role service_role;
do $rejoin$
declare actor uuid:='c2910000-0000-4000-8000-000000000002'; classroom uuid:='c2910000-0000-4000-8000-000000000010';
begin
  if public.read_classroom_home_visibility_v1(actor) is distinct from jsonb_build_object('actor_id',actor,'hidden_enrollment_ids','[]'::jsonb) then
    raise exception 'rejoin starts visible contract failed';
  end if;
  begin
    perform public.set_classroom_home_visibility_v1(actor,classroom,'c2910000-0000-4000-8000-000000000020',true);
    raise exception 'Stale enrollment preference accepted';
  exception when sqlstate 'PT409' then if sqlerrm<>'classroom_home_visibility_membership_changed' then raise; end if; end;
  if public.read_classroom_home_visibility_v1(actor)->'hidden_enrollment_ids'<>'[]'::jsonb then raise exception 'Stale request hid rejoin'; end if;
  perform public.set_classroom_home_visibility_v1(actor,classroom,'c2910000-0000-4000-8000-000000000023',true);
end;
$rejoin$;
reset role;
update public.classrooms set archived_at=clock_timestamp() where id='c2910000-0000-4000-8000-000000000010';
set local role service_role;
do $archive$
declare actor uuid:='c2910000-0000-4000-8000-000000000002';
begin
  if public.read_classroom_home_visibility_v1(actor)->'hidden_enrollment_ids'<>'[]'::jsonb then raise exception 'Archived class leaked into home visibility'; end if;
  begin
    perform public.set_classroom_home_visibility_v1(actor,'c2910000-0000-4000-8000-000000000010','c2910000-0000-4000-8000-000000000023',false);
    raise exception 'Archived preference write accepted';
  exception when sqlstate 'PT403' then if sqlerrm<>'classroom_home_visibility_forbidden' then raise; end if; end;
end;
$archive$;
reset role;
rollback;

begin isolation level repeatable read;
set local role service_role;
do $isolation$
begin
  begin
    perform public.read_classroom_home_visibility_v1('c2910000-0000-4000-8000-000000000002');
    raise exception 'Stale-snapshot read accepted';
  exception when sqlstate 'PT503' then if sqlerrm<>'classroom_home_visibility_unavailable' then raise; end if; end;
  begin
    perform public.set_classroom_home_visibility_v1('c2910000-0000-4000-8000-000000000002','c2910000-0000-4000-8000-000000000010','c2910000-0000-4000-8000-000000000023',true);
    raise exception 'Stale-snapshot write accepted';
  exception when sqlstate 'PT503' then if sqlerrm<>'classroom_home_visibility_unavailable' then raise; end if; end;
end;
$isolation$;
reset role;
rollback;
