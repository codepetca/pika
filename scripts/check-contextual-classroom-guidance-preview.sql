-- SOURCE ONLY until separately authorized isolated execution. No PostgreSQL claim.
begin;
create function pg_temp.preview_full_graph() returns jsonb language plpgsql security invoker set search_path='' as $body$
declare t record;rows jsonb;graph jsonb:='{}'::jsonb;begin
 for t in select n.nspname,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relkind in ('r','p') order by n.nspname,c.relname loop
  execute pg_catalog.format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb) from %I.%I r',t.nspname,t.relname) into rows;
  graph:=graph||pg_catalog.jsonb_build_object(t.nspname||'.'||t.relname,rows);
 end loop;return graph;end;$body$;
revoke all on function pg_temp.preview_full_graph() from public,anon,authenticated,service_role;
create temporary table preview_original on commit drop as select pg_temp.preview_full_graph() graph;
create temporary table preview_before_read on commit drop as select pg_temp.preview_full_graph() graph;
create function pg_temp.assert_preview_unchanged() returns void language plpgsql security invoker set search_path='' as $body$
begin if pg_temp.preview_full_graph() is distinct from (select graph from pg_temp.preview_before_read)
 then raise exception 'Preview read changed complete public/private graph';end if;end;$body$;
revoke all on function pg_temp.assert_preview_unchanged() from public,anon,authenticated,service_role;

create function pg_temp.expect_preview(actor uuid,classroom uuid,expected_code text default '00000',expected_message text default null)
returns jsonb language plpgsql security invoker set search_path='' as $body$
declare result jsonb;c jsonb;b jsonb;v jsonb;code text;message text;begin
 if current_user<>'service_role' then raise exception 'Preview contract did not exercise service role';end if;
 begin result:=public.preview_classroom_authoring_guidance_for_owner_v1(actor,classroom);
 exception when others then get stacked diagnostics code=returned_sqlstate,message=message_text;
  if code is distinct from expected_code or message is distinct from expected_message then raise exception 'Preview exact error differs';end if;
  return null;
 end;
 if expected_code<>'00000' then raise exception 'Preview expected denial absent';end if;
 if result is null or result->>'actor_id' is distinct from actor::text or result->>'classroom_id' is distinct from classroom::text
  or (select array_agg(key order by key) from jsonb_object_keys(result) key) is distinct from
   array['actor_id','blueprint','classroom','classroom_id','current_guidance','guidance','versions']::text[] then raise exception 'Preview top binding/schema differs';end if;
 c:=result->'classroom';b:=result->'blueprint';v:=result->'versions';
 if c->>'id' is distinct from classroom::text or c->>'teacher_id' is distinct from actor::text or c->'archived_at'<>'null'::jsonb
  or (select array_agg(key order by key) from jsonb_object_keys(c) key) is distinct from
   array['archived_at','authoring_guidance_version_id','id','source_blueprint_id','source_blueprint_version_id','teacher_id']::text[]
  or b->>'id' is distinct from c->>'source_blueprint_id' or b->>'teacher_id' is distinct from actor::text
  or (select array_agg(key order by key) from jsonb_object_keys(b) key) is distinct from array['content_revision','id','teacher_id']::text[]
  or (select array_agg(key order by key) from jsonb_object_keys(v) key) is distinct from array['content','guidance']::text[]
  or (select array_agg(key order by key) from jsonb_object_keys(v->'content') key) is distinct from array['course_blueprint_id','id']::text[]
  or (select array_agg(key order by key) from jsonb_object_keys(v->'guidance') key) is distinct from array['course_blueprint_id','id','version_number']::text[]
  or v#>>'{content,id}' is distinct from c->>'source_blueprint_version_id'
  or v#>>'{guidance,id}' is distinct from coalesce(c->>'authoring_guidance_version_id',c->>'source_blueprint_version_id')
  or v#>>'{content,course_blueprint_id}' is distinct from b->>'id' or v#>>'{guidance,course_blueprint_id}' is distinct from b->>'id'
  or (b->>'content_revision')::bigint not between 1 and 9007199254740991 or (v#>>'{guidance,version_number}')::bigint not between 1 and 9007199254740991
  then raise exception 'Preview nested binding/schema differs';end if;
 return result;end;$body$;
do $temp_acl$ declare ns name;begin
 select nspname into strict ns from pg_catalog.pg_namespace where oid=pg_catalog.pg_my_temp_schema();
 if ns !~ '^pg_temp_[0-9]+$' then raise exception 'Unexpected temporary schema';end if;
 execute pg_catalog.format('grant usage on schema %I to service_role',ns);
end;$temp_acl$;
revoke all on function pg_temp.expect_preview(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function pg_temp.expect_preview(uuid,uuid,text,text) to service_role;

do $catalog$ declare p pg_catalog.pg_proc%rowtype;a record;r text;priv text;begin
 select * into strict p from pg_catalog.pg_proc where oid='public.preview_classroom_authoring_guidance_for_owner_v1(uuid,uuid)'::regprocedure;
 if p.provolatile<>'s' or p.prosecdef or p.prokind<>'f' or p.proretset or p.proisstrict or p.proleakproof
  or (select lanname from pg_catalog.pg_language where oid=p.prolang)<>'plpgsql' or p.prorettype<>'jsonb'::regtype
  or pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' or p.pronargs<>2 or p.pronargdefaults<>0
  or p.proargnames is distinct from array['p_actor_id','p_classroom_id']::text[]
  or p.proargtypes is distinct from '2950 2950'::oidvector
  or p.proconfig is null or cardinality(p.proconfig)<>3
  or not ('search_path=""'=any(p.proconfig) and 'lock_timeout=1s'=any(p.proconfig) and 'statement_timeout=8s'=any(p.proconfig))
  or pg_catalog.has_function_privilege('anon',p.oid,'execute') or pg_catalog.has_function_privilege('authenticated',p.oid,'execute')
  or not pg_catalog.has_function_privilege('service_role',p.oid,'execute')
  or exists(select 1 from pg_catalog.aclexplode(p.proacl) x where x.grantee not in (p.proowner,'service_role'::regrole::oid) or x.privilege_type<>'EXECUTE' or x.is_grantable)
  then raise exception 'Preview RPC catalog/ACL differs';end if;
 if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.course_blueprint_versions'::regclass
   and tgname='prevent_blueprint_version_update' and not tgisinternal and tgenabled in ('O','A'))
  or not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.classrooms'::regclass
   and tgname='ab_classroom_authoring_guidance_version' and not tgisinternal and tgenabled in ('O','A'))
  or not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.classrooms'::regclass
   and tgname='classrooms_blueprint_purge_lineage_fence' and not tgisinternal and tgenabled in ('O','A'))
  then raise exception 'Preview genuine immutability/lineage triggers absent';end if;
 --278 column-only fence privilege must remain exact;279 adds no data privileges.
 foreach r in array array['anon','authenticated','service_role'] loop
  foreach priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
   if pg_catalog.has_table_privilege(r,'public.course_blueprint_purge_fences',priv) then raise exception 'Blueprint fence table privilege widened';end if;
  end loop;
  for a in select attname,attacl from pg_catalog.pg_attribute where attrelid='public.course_blueprint_purge_fences'::regclass and attnum>0 and not attisdropped loop
   if pg_catalog.has_column_privilege(r,'public.course_blueprint_purge_fences',a.attname,'SELECT') is distinct from (r='service_role' and a.attname='course_blueprint_id')
    or pg_catalog.has_column_privilege(r,'public.course_blueprint_purge_fences',a.attname,'SELECT WITH GRANT OPTION')
    or pg_catalog.has_column_privilege(r,'public.course_blueprint_purge_fences',a.attname,'INSERT')
    or pg_catalog.has_column_privilege(r,'public.course_blueprint_purge_fences',a.attname,'UPDATE')
    or pg_catalog.has_column_privilege(r,'public.course_blueprint_purge_fences',a.attname,'REFERENCES')
    then raise exception 'Blueprint fence exact column privilege differs';end if;
   if exists(select 1 from pg_catalog.aclexplode(a.attacl) x where x.grantee='service_role'::regrole::oid
    and (a.attname<>'course_blueprint_id' or x.privilege_type<>'SELECT' or x.is_grantable)) then raise exception 'Blueprint fence column ACL differs';end if;
  end loop;
 end loop;
end;$catalog$;

savepoint fixture;
insert into public.users(id,email,role) values
 ('b1000000-0000-4000-8000-000000000001','preview_student_owner@example.invalid','student'),
 ('b1000000-0000-4000-8000-000000000002','preview_teacher_owner@example.invalid','teacher'),
 ('b1000000-0000-4000-8000-000000000003','preview_member@example.invalid','teacher'),
 ('b1000000-0000-4000-8000-000000000004','preview_stranger@example.invalid','student'),
 ('b1000000-0000-4000-8000-000000000005','preview_former@example.invalid','teacher');
insert into public.course_blueprints(id,teacher_id,title) values
 ('b3000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','SECRET LIVE COURSE A'),
 ('b3000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000002','SECRET LIVE COURSE B');
update public.course_blueprints set authoring_guidance=jsonb_build_object('course_expectations_markdown','Live rules','assignment_guidance_markdown','','test_guidance_markdown','','unit_exceptions','[]'::jsonb) where id='b3000000-0000-4000-8000-000000000001';
create temporary table preview_snapshots(revision bigint primary key,blueprint uuid,snapshot jsonb not null) on commit drop;
insert into preview_snapshots values
 (1,'b3000000-0000-4000-8000-000000000001',jsonb_build_object('metadata',jsonb_build_object('title','SECRET FROZEN COURSE'),'answers','SECRET ANSWERS','materials','SECRET MATERIALS','authoring_guidance',jsonb_build_object('course_expectations_markdown','Frozen rules','assignment_guidance_markdown','','test_guidance_markdown','','unit_exceptions','[]'::jsonb))),
 (2,'b3000000-0000-4000-8000-000000000001',jsonb_build_object('authoring_guidance',jsonb_build_object('course_expectations_markdown','Adopted rules','assignment_guidance_markdown','','test_guidance_markdown','','unit_exceptions','[]'::jsonb))),
 (3,'b3000000-0000-4000-8000-000000000001',jsonb_build_object('authoring_guidance',jsonb_build_object('course_expectations_markdown','Rebound rules','assignment_guidance_markdown','','test_guidance_markdown','','unit_exceptions','[]'::jsonb))),
 (4,'b3000000-0000-4000-8000-000000000001','[]'::jsonb),(11,'b3000000-0000-4000-8000-000000000002','{}'::jsonb);
insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_json,snapshot_sha256,created_by)
 select ('b4000000-0000-4000-8000-'||lpad(revision::text,12,'0'))::uuid,blueprint,revision,revision,snapshot,
 encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),case when blueprint='b3000000-0000-4000-8000-000000000001' then 'b1000000-0000-4000-8000-000000000001'::uuid else 'b1000000-0000-4000-8000-000000000002'::uuid end from preview_snapshots;
insert into public.classrooms(id,teacher_id,title,class_code,source_blueprint_id,source_blueprint_version_id) values
 ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Preview A','PREVA1','b3000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001'),
 ('b2000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000002','Preview B','PREVB2','b3000000-0000-4000-8000-000000000002','b4000000-0000-4000-8000-000000000011'),
 ('b2000000-0000-4000-8000-000000000003','b1000000-0000-4000-8000-000000000001','Class-only ownership','PREVC3','b3000000-0000-4000-8000-000000000002','b4000000-0000-4000-8000-000000000011'),
 ('b2000000-0000-4000-8000-000000000004','b1000000-0000-4000-8000-000000000001','Attendance-free purge class','PREVD4','b3000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001');
update public.classrooms set authoring_guidance_version_id='b4000000-0000-4000-8000-000000000002' where id='b2000000-0000-4000-8000-000000000001';
insert into public.classroom_enrollments(classroom_id,student_id) values ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001'),('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000003');
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;
do $read$ declare result jsonb;begin
 result:=pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001');
 if result#>>'{current_guidance,course_expectations_markdown}'<>'Adopted rules' or result#>>'{guidance,course_expectations_markdown}'<>'Live rules'
  or result#>>'{versions,content,id}'<>'b4000000-0000-4000-8000-000000000001' or result#>>'{versions,guidance,id}'<>'b4000000-0000-4000-8000-000000000002' or result::text like '%SECRET%' or result::text like '%Rebound rules%'
  then raise exception 'Preview adopted/frozen/live privacy binding differs';end if;
 result:=pg_temp.expect_preview('b1000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000002');if result->'current_guidance'<>'null'::jsonb then raise exception 'Historical missing guidance differs';end if;
 perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000003','PT403','class_guidance_preview_forbidden'); -- classroom owner, not Blueprint owner
 perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000003','PT403','class_guidance_preview_forbidden'); -- Blueprint owner, not classroom owner
 perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','PT403','class_guidance_preview_forbidden');
 perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000003','b2000000-0000-4000-8000-000000000001','PT403','class_guidance_preview_forbidden');perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000004','b2000000-0000-4000-8000-000000000001','PT403','class_guidance_preview_forbidden');perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000005','b2000000-0000-4000-8000-000000000001','PT403','class_guidance_preview_forbidden');
 perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000099','b2000000-0000-4000-8000-000000000001','PT403','class_guidance_preview_forbidden');perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000099','PT404','class_guidance_preview_classroom_missing');
 perform pg_temp.expect_preview(null,'b2000000-0000-4000-8000-000000000001','PT400','class_guidance_preview_invalid_argument');
 perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001',null,'PT400','class_guidance_preview_invalid_argument');
end;$read$;reset role;
do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;

savepoint archived;
update public.classrooms set archived_at=statement_timestamp() where id in ('b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002');
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;
do $read$ declare result jsonb;begin
 perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','PT403','class_guidance_preview_archived');perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000002','PT403','class_guidance_preview_archived');
end;$read$;reset role;
do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;
rollback to archived;

savepoint stale_owner;
update public.classrooms set teacher_id='b1000000-0000-4000-8000-000000000002' where id='b2000000-0000-4000-8000-000000000001';
update public.course_blueprints set teacher_id='b1000000-0000-4000-8000-000000000002' where id='b3000000-0000-4000-8000-000000000001';
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;
do $read$ declare result jsonb;begin
 perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','PT403','class_guidance_preview_forbidden');perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001');
end;$read$;reset role;
do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;
rollback to stale_owner;

savepoint blueprint_owner;
update public.course_blueprints set teacher_id='b1000000-0000-4000-8000-000000000002' where id='b3000000-0000-4000-8000-000000000001';
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;
do $read$ declare result jsonb;begin
 perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','PT403','class_guidance_preview_forbidden');perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','PT403','class_guidance_preview_forbidden');
end;$read$;reset role;
do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;
rollback to blueprint_owner;

savepoint adopted;
update public.classrooms set authoring_guidance_version_id=null where id='b2000000-0000-4000-8000-000000000001';
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;
do $read$ declare result jsonb;begin
 result:=pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001');if result#>>'{current_guidance,course_expectations_markdown}'<>'Frozen rules' then raise exception 'Fallback selection differs';end if;
end;$read$;reset role;
do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;
rollback to adopted;

savepoint rebind;
update public.classrooms set source_blueprint_version_id='b4000000-0000-4000-8000-000000000003' where id='b2000000-0000-4000-8000-000000000001';
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;
do $read$ declare result jsonb;begin
 result:=pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001');if result#>>'{current_guidance,course_expectations_markdown}'<>'Rebound rules' or result#>>'{versions,content,id}'<>'b4000000-0000-4000-8000-000000000003' then raise exception 'Fresh structural link differs';end if;
end;$read$;reset role;
do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;
rollback to rebind;

savepoint draft_change;
update public.course_blueprints set authoring_guidance=jsonb_build_object('course_expectations_markdown','New live rules','assignment_guidance_markdown','','test_guidance_markdown','','unit_exceptions','[]'::jsonb) where id='b3000000-0000-4000-8000-000000000001';
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;
do $read$ declare result jsonb;begin
 result:=pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001');if result#>>'{current_guidance,course_expectations_markdown}'<>'Adopted rules' or result#>>'{guidance,course_expectations_markdown}'<>'New live rules'
 or (result#>>'{blueprint,content_revision}')::bigint is distinct from (select content_revision from public.course_blueprints where id='b3000000-0000-4000-8000-000000000001') then raise exception 'Fresh live Draft/revision differs';end if;
end;$read$;reset role;
do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;
rollback to draft_change;

savepoint partial_source;
update public.classrooms set source_blueprint_version_id=null where id='b2000000-0000-4000-8000-000000000001';
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;
do $read$ declare result jsonb;begin
 perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','PT409','class_guidance_preview_unlinked');
end;$read$;reset role;
do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;
rollback to partial_source;

savepoint partial_version_only;
update public.classrooms set source_blueprint_id=null where id='b2000000-0000-4000-8000-000000000001';
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;
do $read$ declare result jsonb;begin
 perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','PT409','class_guidance_preview_unlinked');
end;$read$;reset role;
do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;
rollback to partial_version_only;

savepoint invalid_snapshot;
update public.classrooms set source_blueprint_version_id='b4000000-0000-4000-8000-000000000004' where id='b2000000-0000-4000-8000-000000000001';
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;
do $read$ declare result jsonb;begin
 perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','PT503','class_guidance_preview_invalid');
end;$read$;reset role;
do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;
rollback to invalid_snapshot;

savepoint invalid_adopted_snapshot;
update public.classrooms set authoring_guidance_version_id='b4000000-0000-4000-8000-000000000004' where id='b2000000-0000-4000-8000-000000000001';
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;
do $read$ declare result jsonb;begin
 perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','PT503','class_guidance_preview_invalid');
end;$read$;reset role;
do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;
rollback to invalid_adopted_snapshot;

savepoint mismatched_parent;
update public.classrooms set source_blueprint_version_id='b4000000-0000-4000-8000-000000000011' where id='b2000000-0000-4000-8000-000000000001';
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;
do $read$ declare result jsonb;begin
 perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','PT503','class_guidance_preview_unavailable');
end;$read$;reset role;
do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;
rollback to mismatched_parent;
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;
do $read$ declare k text;begin
 foreach k in array array['pika.classroom_archive_restore','pika.classroom_archive_compaction','pika.identity_mapping','pika.classroom_purge_finalize','pika.course_blueprint_purge_finalize','pika.student_purge_finalize'] loop
 perform set_config(k,'on',true);perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','PT503','class_guidance_preview_fenced');perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000002','PT503','class_guidance_preview_fenced');
 perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000003','PT403','class_guidance_preview_forbidden');perform set_config(k,'off',true);end loop;
end;$read$;reset role;
do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;

savepoint hot_fence;
--127 requires a genuinely attendance-free class, with all ordinary triggers enabled.
insert into public.classroom_purge_operations(id,teacher_id,classroom_id,request_sha256,source_revision,impact_summary) values
 ('b5000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000004',repeat('a',64),1,'{}');
insert into public.classroom_purge_fences(classroom_id,operation_id,teacher_id) values ('b2000000-0000-4000-8000-000000000004','b5000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001');
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;
do $read$ declare result jsonb;begin
 perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000004','PT503','class_guidance_preview_fenced');
end;$read$;reset role;
do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;
rollback to hot_fence;

savepoint blueprint_fence;
insert into public.course_blueprint_purge_operations(id,course_blueprint_id,teacher_id,request_sha256,inventory_sha256,finalization_sha256,source_revision,status) values
 ('b5000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',repeat('a',64),repeat('b',64),repeat('c',64),1,'inventorying');
insert into public.course_blueprint_purge_fences(course_blueprint_id,operation_id) values ('b3000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000002');
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;
do $read$ declare result jsonb;begin
 perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','PT503','class_guidance_preview_fenced');perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','PT403','class_guidance_preview_forbidden');
end;$read$;reset role;
do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;
rollback to blueprint_fence;

savepoint safe_metadata;
insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_json,snapshot_sha256,created_by)
 select 'b4000000-0000-4000-8000-000000000030','b3000000-0000-4000-8000-000000000001',9007199254740991,30,s,encode(sha256(convert_to(s::text,'UTF8')),'hex'),'b1000000-0000-4000-8000-000000000001' from (select '{}'::jsonb s) seed;
insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_json,snapshot_sha256,created_by)
 select 'b4000000-0000-4000-8000-000000000031','b3000000-0000-4000-8000-000000000001',9007199254740992,31,s,encode(sha256(convert_to(s::text,'UTF8')),'hex'),'b1000000-0000-4000-8000-000000000001' from (select '{}'::jsonb s) seed;
update public.classrooms set source_blueprint_version_id='b4000000-0000-4000-8000-000000000030' where id='b2000000-0000-4000-8000-000000000001';
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;do $read$ declare result jsonb;begin
 result:=pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001');if (result#>>'{versions,guidance,version_number}')::bigint<>9007199254740991 then raise exception 'Preview safe Version boundary differs';end if;
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;
update public.classrooms set source_blueprint_version_id='b4000000-0000-4000-8000-000000000031' where id='b2000000-0000-4000-8000-000000000001';
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;do $read$ declare result jsonb;begin
 perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','PT503','class_guidance_preview_invalid');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;
rollback to safe_metadata;

savepoint safe_live_revision;
update public.course_blueprints set content_revision=9007199254740991 where id='b3000000-0000-4000-8000-000000000001';
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;do $read$ declare result jsonb;begin
 result:=pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001');if (result#>>'{blueprint,content_revision}')::bigint<>9007199254740991 then raise exception 'Preview safe Draft boundary differs';end if;
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;
update public.course_blueprints set content_revision=9007199254740992 where id='b3000000-0000-4000-8000-000000000001';
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;do $read$ declare result jsonb;begin
 perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','PT503','class_guidance_preview_invalid');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;
rollback to safe_live_revision;

savepoint snapshot_limit;
-- Distinct selected snapshots PLUS live rules: exact UTF8 aggregate, fallback
-- counted once. Multibyte padding proves byte count rather than character count.
create temporary table preview_raw_budget on commit drop as
 select octet_length(convert_to(authoring_guidance::text,'UTF8')) live_bytes,
 octet_length(convert_to(jsonb_build_object('padding','')::text,'UTF8')) overhead from public.course_blueprints where id='b3000000-0000-4000-8000-000000000001';
insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_json,snapshot_sha256,created_by)
 select 'b4000000-0000-4000-8000-000000000008','b3000000-0000-4000-8000-000000000001',8,8,s,encode(sha256(convert_to(s::text,'UTF8')),'hex'),'b1000000-0000-4000-8000-000000000001' from (select jsonb_build_object('padding',repeat('é',((8388608+0-live_bytes-overhead)/2)::integer)||repeat('x',((8388608+0-live_bytes-overhead)%2)::integer)) s from pg_temp.preview_raw_budget) seed;
update public.classrooms set source_blueprint_version_id='b4000000-0000-4000-8000-000000000008' where id='b2000000-0000-4000-8000-000000000001';
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;do $read$ declare result jsonb;begin
 perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;
savepoint distinct_pair_limit;
update public.classrooms set authoring_guidance_version_id='b4000000-0000-4000-8000-000000000002' where id='b2000000-0000-4000-8000-000000000001';
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;do $read$ declare result jsonb;begin
 perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','PT503','class_guidance_preview_too_large');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;
rollback to distinct_pair_limit;
insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_json,snapshot_sha256,created_by)
 select 'b4000000-0000-4000-8000-000000000009','b3000000-0000-4000-8000-000000000001',9,9,s,encode(sha256(convert_to(s::text,'UTF8')),'hex'),'b1000000-0000-4000-8000-000000000001' from (select jsonb_build_object('padding',repeat('é',((8388608+1-live_bytes-overhead)/2)::integer)||repeat('x',((8388608+1-live_bytes-overhead)%2)::integer)) s from pg_temp.preview_raw_budget) seed;
update public.classrooms set source_blueprint_version_id='b4000000-0000-4000-8000-000000000009' where id='b2000000-0000-4000-8000-000000000001';
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;do $read$ declare result jsonb;begin
 perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','PT503','class_guidance_preview_too_large');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;
rollback to snapshot_limit;

savepoint wire_limit;
-- SQL wire boundary only: raw immutable guidance strings are table-legal but
-- intentionally noncanonical. The server codec must reject these; this is NOT
-- a claim that a browser DTO accepts a multi-megabyte malformed guidance string.
insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_json,snapshot_sha256,created_by)
 select 'b4000000-0000-4000-8000-000000000020','b3000000-0000-4000-8000-000000000001',20,20,s,encode(sha256(convert_to(s::text,'UTF8')),'hex'),'b1000000-0000-4000-8000-000000000001' from (select jsonb_build_object('authoring_guidance','') s) seed;
update public.classrooms set source_blueprint_version_id='b4000000-0000-4000-8000-000000000020' where id='b2000000-0000-4000-8000-000000000001';
-- Compute fixed wire overhead with a small raw string. All boundary observations
-- below still exercise the actual service_role RPC and complete graph equality.
create temporary table preview_wire_budget on commit drop as select octet_length(convert_to(
 public.preview_classroom_authoring_guidance_for_owner_v1('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001')::text,'UTF8')) overhead;
insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_json,snapshot_sha256,created_by)
 select 'b4000000-0000-4000-8000-000000000021','b3000000-0000-4000-8000-000000000001',21,21,s,encode(sha256(convert_to(s::text,'UTF8')),'hex'),'b1000000-0000-4000-8000-000000000001' from (select jsonb_build_object('authoring_guidance',repeat('x',8388608+0-overhead)) s from pg_temp.preview_wire_budget) seed;
update public.classrooms set source_blueprint_version_id='b4000000-0000-4000-8000-000000000021' where id='b2000000-0000-4000-8000-000000000001';
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;do $read$ declare result jsonb;begin
 result:=pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001');if octet_length(convert_to(result::text,'UTF8'))<>8388608 then raise exception 'Preview exact wire boundary differs';end if;
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;
insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_json,snapshot_sha256,created_by)
 select 'b4000000-0000-4000-8000-000000000022','b3000000-0000-4000-8000-000000000001',22,22,s,encode(sha256(convert_to(s::text,'UTF8')),'hex'),'b1000000-0000-4000-8000-000000000001' from (select jsonb_build_object('authoring_guidance',repeat('x',8388608+1-overhead)) s from pg_temp.preview_wire_budget) seed;
update public.classrooms set source_blueprint_version_id='b4000000-0000-4000-8000-000000000022' where id='b2000000-0000-4000-8000-000000000001';
update pg_temp.preview_before_read set graph=pg_temp.preview_full_graph();
set local role service_role;do $read$ declare result jsonb;begin
 perform pg_temp.expect_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','PT503','class_guidance_preview_too_large');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_preview_unchanged();end;$unchanged$;
rollback to wire_limit;

--122 forbids cold fences on a hot parent; no fabricated cold fence, disabled
--trigger, missing-FK Blueprint, or immutable Version UPDATE is used. Impossible
--corrupt bindings are CPU-codec cases, not an assertion of executed PostgreSQL.
rollback to fixture;
do $whole_rollback$ begin if pg_temp.preview_full_graph() is distinct from (select graph from pg_temp.preview_original)
 then raise exception 'Preview fixture automatic Free/Pal/full graph rollback differs';end if;end;$whole_rollback$;
rollback;
select pg_catalog.json_build_object('version',1,'scope','classroom-guidance-preview-rollback-contract-v1','outcome','passed','stage','complete','sqlstate',null);
