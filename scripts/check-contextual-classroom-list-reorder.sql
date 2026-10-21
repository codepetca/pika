-- SOURCE ONLY until separately authorized isolated execution. No concurrency claim.
begin;
create function pg_temp.classroom_list_graph() returns jsonb language plpgsql security invoker set search_path='' as $body$
declare t record; rows jsonb; graph jsonb:='{}'::jsonb;
begin
 for t in select n.nspname,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relkind in ('r','p') order by n.nspname,c.relname loop
  execute pg_catalog.format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb) from %I.%I r',t.nspname,t.relname) into rows;
  graph:=graph||jsonb_build_object(t.nspname||'.'||t.relname,rows);
 end loop;return graph;
end;$body$;
revoke all on function pg_temp.classroom_list_graph() from public,anon,authenticated,service_role;
create temporary table classroom_list_original on commit drop as select pg_temp.classroom_list_graph() as graph;
create temporary table classroom_list_before on commit drop as select pg_temp.classroom_list_graph() as graph;
create function pg_temp.expect_classroom_list(actor uuid,ids uuid[],expected_code text default null,expected_message text default null)
returns jsonb language plpgsql security invoker set search_path='' as $body$
declare result jsonb;
begin
 if current_user<>'service_role' then raise exception 'List contract did not exercise service role';end if;
 begin
  result:=public.reorder_classrooms_for_owner_v1(actor,ids);
  if expected_code is not null then raise exception 'Expected list reorder refusal';end if;
 exception when others then
  if expected_code is null or sqlstate<>expected_code or sqlerrm is distinct from expected_message then raise;end if;
  return null;
 end;
 if result is distinct from jsonb_build_object('actor_id',actor,'classroom_ids',to_jsonb(ids),'reordered',true)
  then raise exception 'List reorder result binding/schema differs';end if;
 return result;
end;$body$;
do $temp_acl$ declare ns name;begin
 select nspname into strict ns from pg_catalog.pg_namespace where oid=pg_catalog.pg_my_temp_schema();
 if ns !~ '^pg_temp_[0-9]+$' then raise exception 'Unexpected temporary schema';end if;
 execute pg_catalog.format('grant usage on schema %I to service_role',ns);
end;$temp_acl$;
revoke all on function pg_temp.expect_classroom_list(uuid,uuid[],text,text) from public,anon,authenticated;
grant execute on function pg_temp.expect_classroom_list(uuid,uuid[],text,text) to service_role;
create function pg_temp.check_classroom_list_effects(before_graph jsonb,ids uuid[]) returns void
language plpgsql security invoker set search_path='' as $body$
declare expected jsonb:=before_graph; rows jsonb;
begin
 select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) into rows from (
  select case when (r->>'id')::uuid=any(ids) then r||jsonb_build_object('position',array_position(ids,(r->>'id')::uuid)-1,
   'updated_at',transaction_timestamp()) else r end value from jsonb_array_elements(before_graph->'public.classrooms') r) q;
 expected:=expected||jsonb_build_object('public.classrooms',rows);
 select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) into rows from (
  select case when (r->>'classroom_id')::uuid=any(ids) then r||jsonb_build_object('revision',(r->>'revision')::bigint+1,
   'updated_at',transaction_timestamp()) else r end value from jsonb_array_elements(before_graph->'public.classroom_archive_revisions') r) q;
 expected:=expected||jsonb_build_object('public.classroom_archive_revisions',rows);
 if pg_temp.classroom_list_graph() is distinct from expected then raise exception 'List reorder whole public/private graph differs';end if;
end;$body$;
revoke all on function pg_temp.check_classroom_list_effects(jsonb,uuid[]) from public,anon,authenticated,service_role;
do $catalog$ declare p pg_catalog.pg_proc%rowtype;begin
 select * into strict p from pg_catalog.pg_proc where oid='public.reorder_classrooms_for_owner_v1(uuid,uuid[])'::regprocedure;
 if p.provolatile<>'v' or not p.prosecdef or p.prokind<>'f' or p.proretset or p.proisstrict or p.proleakproof
  or (select lanname from pg_catalog.pg_language where oid=p.prolang)<>'plpgsql' or pg_catalog.pg_get_userbyid(p.proowner)<>'postgres'
  or p.prorettype<>'jsonb'::regtype or p.pronargs<>2 or p.pronargdefaults<>0 or p.proargnames is distinct from array['p_actor_id','p_classroom_ids']::text[]
  or p.proconfig is null or cardinality(p.proconfig)<>3 or not ('search_path=""'=any(p.proconfig) and 'lock_timeout=1s'=any(p.proconfig) and 'statement_timeout=8s'=any(p.proconfig))
  or pg_catalog.has_function_privilege('anon',p.oid,'execute') or pg_catalog.has_function_privilege('authenticated',p.oid,'execute')
  or not pg_catalog.has_function_privilege('service_role',p.oid,'execute')
  or exists(select 1 from pg_catalog.aclexplode(p.proacl) a where a.grantee not in (p.proowner,'service_role'::regrole::oid) or a.privilege_type<>'EXECUTE' or a.is_grantable)
  then raise exception 'List reorder catalog/ACL differs';end if;
end;$catalog$;
savepoint fixture;
insert into public.users(id,email,role) values
 ('f1000000-0000-4000-8000-000000000001','list_teacher@example.invalid','teacher'),
 ('f1000000-0000-4000-8000-000000000002','list_student_owner@example.invalid','student'),
 ('f1000000-0000-4000-8000-000000000003','list_empty@example.invalid','student'),
 ('f1000000-0000-4000-8000-000000000004','list_member@example.invalid','teacher'),
 ('f1000000-0000-4000-8000-000000000005','list_purge_owner@example.invalid','teacher');
-- Fixture construction only, not grant provisioning or a live/account-plan change.
insert into public.effective_feature_entitlements(subject_user_id,feature_key,source,enabled,starts_at,quota_limit,revision)
 select id,'classrooms.create','manual',true,'2020-01-01',null,1 from public.users where id in
 ('f1000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000005')
 on conflict(subject_user_id,feature_key) do update set enabled=true,starts_at='2020-01-01',expires_at=null,quota_limit=null;
insert into public.classrooms(id,teacher_id,title,class_code,position,archived_at) values
 ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','List A','LREORA',7,null),
 ('f2000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000001','List B','LREORB',4,null),
 ('f2000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000001','Archived list','LREORC',8,statement_timestamp()),
 ('f2000000-0000-4000-8000-000000000004','f1000000-0000-4000-8000-000000000005','Attendance-free purge','LREORD',3,null);
-- Genuine >1000 complete owned-classroom set; no PostgREST preflight/pagination.
insert into public.classrooms(id,teacher_id,title,class_code,position)
 select ('f3000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'f1000000-0000-4000-8000-000000000002',
 'List bulk '||n,'RL'||lpad(n::text,4,'0'),1001-n from generate_series(1,1001) n;
insert into public.classroom_enrollments(classroom_id,student_id) values
 ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000004');
update public.effective_feature_entitlements set enabled=false,quota_limit=0 where feature_key='classrooms.create' and subject_user_id in
 ('f1000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000002');
update pg_temp.classroom_list_before set graph=pg_temp.classroom_list_graph();
set local role service_role;
do $teacher$ begin perform pg_temp.expect_classroom_list('f1000000-0000-4000-8000-000000000001',array[
 'f2000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000001']::uuid[]);end;$teacher$;
reset role;
do $check$ begin perform pg_temp.check_classroom_list_effects((select graph from pg_temp.classroom_list_before),array[
 'f2000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000001']::uuid[]);end;$check$;
update pg_temp.classroom_list_before set graph=pg_temp.classroom_list_graph();
set local role service_role;
-- Same order is a real repeated update, with the same legitimate trigger footprint.
do $repeat$ begin perform pg_temp.expect_classroom_list('f1000000-0000-4000-8000-000000000001',array[
 'f2000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000001']::uuid[]);end;$repeat$;
reset role;
do $check$ begin perform pg_temp.check_classroom_list_effects((select graph from pg_temp.classroom_list_before),array[
 'f2000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000001']::uuid[]);end;$check$;
update pg_temp.classroom_list_before set graph=pg_temp.classroom_list_graph();
set local role service_role;
do $student$ declare ids uuid[];v jsonb;begin
 select array_agg(('f3000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid order by n desc) into ids from generate_series(1,1001) n;
 v:=pg_temp.expect_classroom_list('f1000000-0000-4000-8000-000000000002',ids);
 if jsonb_array_length(v->'classroom_ids')<>1001 then raise exception 'Complete1001 list truncated';end if;
end;$student$;
reset role;
do $check$ declare ids uuid[];begin
 select array_agg(('f3000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid order by n desc) into ids from generate_series(1,1001) n;
 perform pg_temp.check_classroom_list_effects((select graph from pg_temp.classroom_list_before),ids);
end;$check$;
update pg_temp.classroom_list_before set graph=pg_temp.classroom_list_graph();
set local role service_role;
do $denials$ declare a uuid:='f1000000-0000-4000-8000-000000000001';c uuid:='f1000000-0000-4000-8000-000000000003';
 x uuid:='f2000000-0000-4000-8000-000000000001';y uuid:='f2000000-0000-4000-8000-000000000002';ids uuid[];begin
 perform pg_temp.expect_classroom_list(c,'{}'::uuid[]);
 perform pg_temp.expect_classroom_list('f1000000-0000-4000-8000-000000000099','{}'::uuid[],'PT403','classroom_list_reorder_forbidden');
 perform pg_temp.expect_classroom_list(a,null,'PT400','classroom_list_reorder_invalid_request');
 perform pg_temp.expect_classroom_list(a,array[x,x],'PT400','classroom_list_reorder_invalid_request');
 perform pg_temp.expect_classroom_list(a,array[x,null],'PT400','classroom_list_reorder_invalid_request');
 perform pg_temp.expect_classroom_list(a,array[[x,y]],'PT400','classroom_list_reorder_invalid_request');
 perform pg_temp.expect_classroom_list(a,'[0:1]={f2000000-0000-4000-8000-000000000001,f2000000-0000-4000-8000-000000000002}'::uuid[],'PT400','classroom_list_reorder_invalid_request');
 select array_agg(('f6000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid) into ids from generate_series(1,4097) n;
 perform pg_temp.expect_classroom_list(a,ids,'PT400','classroom_list_reorder_invalid_request');
 perform pg_temp.expect_classroom_list(a,array[x],'PT400','classroom_list_reorder_invalid_set');
 perform pg_temp.expect_classroom_list(a,'{}'::uuid[],'PT400','classroom_list_reorder_invalid_set');
 perform pg_temp.expect_classroom_list(c,array[x,y],'PT400','classroom_list_reorder_invalid_set');
 perform pg_temp.expect_classroom_list('f1000000-0000-4000-8000-000000000004',array[x,y],'PT400','classroom_list_reorder_invalid_set');
 perform pg_temp.expect_classroom_list(a,array[x,'f2000000-0000-4000-8000-000000000003'::uuid],'PT400','classroom_list_reorder_invalid_set');
 perform pg_temp.expect_classroom_list(a,array[x,'f3000000-0000-4000-8000-000000000001'::uuid],'PT400','classroom_list_reorder_invalid_set');
 perform pg_temp.expect_classroom_list(a,array[x,'f2000000-0000-4000-8000-000000000099'::uuid],'PT400','classroom_list_reorder_invalid_set');
end;$denials$;reset role;
do $check$ begin perform pg_temp.check_classroom_list_effects((select graph from pg_temp.classroom_list_before),'{}'::uuid[]);end;$check$;
savepoint stale_set;
update public.classrooms set archived_at=statement_timestamp() where id='f2000000-0000-4000-8000-000000000002';
update pg_temp.classroom_list_before set graph=pg_temp.classroom_list_graph();
set local role service_role;do $stale$ begin perform pg_temp.expect_classroom_list('f1000000-0000-4000-8000-000000000001',array[
 'f2000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002']::uuid[],'PT400','classroom_list_reorder_invalid_set');end;$stale$;reset role;
do $check$ begin perform pg_temp.check_classroom_list_effects((select graph from pg_temp.classroom_list_before),'{}'::uuid[]);end;$check$;
rollback to stale_set;
savepoint midbatch_failure;
create temporary table list_failure_counter(n integer) on commit drop;insert into list_failure_counter values(0);
create function pg_temp.fail_second_list_update() returns trigger language plpgsql set search_path='' as $body$
declare n integer;begin update pg_temp.list_failure_counter c set n=c.n+1 returning c.n into n;
 if n=2 then raise exception using errcode='PZ277',message='synthetic_list_midbatch_failure';end if;return new;end;$body$;
create trigger zz_synthetic_list_failure after update of position on public.classrooms for each row execute function pg_temp.fail_second_list_update();
update pg_temp.classroom_list_before set graph=pg_temp.classroom_list_graph();
set local role service_role;do $failure$ begin perform pg_temp.expect_classroom_list('f1000000-0000-4000-8000-000000000001',array[
 'f2000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002']::uuid[],'PZ277','synthetic_list_midbatch_failure');end;$failure$;reset role;
do $check$ begin perform pg_temp.check_classroom_list_effects((select graph from pg_temp.classroom_list_before),'{}'::uuid[]);end;$check$;
rollback to midbatch_failure;
savepoint postcondition_failure;
create function pg_temp.tamper_list_update() returns trigger language plpgsql set search_path='' as $body$
begin update public.classrooms set title=title||' synthetic tamper' where id=new.id;return new;end;$body$;
create trigger zz_synthetic_list_tamper after update of position on public.classrooms for each row execute function pg_temp.tamper_list_update();
update pg_temp.classroom_list_before set graph=pg_temp.classroom_list_graph();
set local role service_role;do $failure$ begin perform pg_temp.expect_classroom_list('f1000000-0000-4000-8000-000000000001',array[
 'f2000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002']::uuid[],'PT503','classroom_list_reorder_postcondition_failed');end;$failure$;reset role;
do $check$ begin perform pg_temp.check_classroom_list_effects((select graph from pg_temp.classroom_list_before),'{}'::uuid[]);end;$check$;
rollback to postcondition_failure;
update pg_temp.classroom_list_before set graph=pg_temp.classroom_list_graph();
set local role service_role;do $maintenance$ declare k text;begin
 foreach k in array array['pika.classroom_archive_restore','pika.classroom_archive_compaction','pika.identity_mapping','pika.classroom_purge_finalize','pika.course_blueprint_purge_finalize','pika.student_purge_finalize'] loop
  perform set_config(k,'on',true);perform pg_temp.expect_classroom_list('f1000000-0000-4000-8000-000000000001',array[
   'f2000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002']::uuid[],'PT503','classroom_list_reorder_fenced');perform set_config(k,'off',true);
 end loop;end;$maintenance$;reset role;
do $check$ begin perform pg_temp.check_classroom_list_effects((select graph from pg_temp.classroom_list_before),'{}'::uuid[]);end;$check$;
savepoint hot_fence;
-- Genuine127 prerequisite: the isolated purge-owner class contains NO attendance state.
insert into public.classroom_purge_operations(id,teacher_id,classroom_id,request_sha256,source_revision,impact_summary) values
 ('f4000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000005','f2000000-0000-4000-8000-000000000004',repeat('a',64),1,'{}');
insert into public.classroom_purge_fences(classroom_id,operation_id,teacher_id) values
 ('f2000000-0000-4000-8000-000000000004','f4000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000005');
update pg_temp.classroom_list_before set graph=pg_temp.classroom_list_graph();
set local role service_role;do $purge$ begin perform pg_temp.expect_classroom_list('f1000000-0000-4000-8000-000000000005',array[
 'f2000000-0000-4000-8000-000000000004']::uuid[],'PT503','classroom_list_reorder_fenced');end;$purge$;reset role;
do $check$ begin perform pg_temp.check_classroom_list_effects((select graph from pg_temp.classroom_list_before),'{}'::uuid[]);end;$check$;
rollback to hot_fence;
-- No fabricated cold-fence/hot-parent or provider operation. Concurrency is a separate native proof.
rollback to fixture;
do $whole_rollback$ begin if pg_temp.classroom_list_graph() is distinct from (select graph from pg_temp.classroom_list_original)
 then raise exception 'List fixture automatic Free/Pal/full graph rollback differs';end if;end;$whole_rollback$;
rollback;
select pg_catalog.json_build_object('version',1,'scope','classroom-list-reorder-rollback-contract-v1','outcome','passed','stage','complete','sqlstate',null);
