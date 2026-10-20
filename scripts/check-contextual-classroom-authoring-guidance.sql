-- SOURCE ONLY until separately authorized isolated execution. No PostgreSQL claim.
begin;
create function pg_temp.guidance_full_graph() returns jsonb language plpgsql security invoker set search_path='' as $body$
declare t record;rows jsonb;graph jsonb:='{}'::jsonb;begin
 for t in select n.nspname,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relkind in ('r','p') order by n.nspname,c.relname loop
  execute pg_catalog.format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb) from %I.%I r',t.nspname,t.relname) into rows;
  graph:=graph||pg_catalog.jsonb_build_object(t.nspname||'.'||t.relname,rows);
 end loop;return graph;end;$body$;
revoke all on function pg_temp.guidance_full_graph() from public,anon,authenticated,service_role;
create temporary table guidance_original on commit drop as select pg_temp.guidance_full_graph() graph;
create temporary table guidance_before_read on commit drop as select pg_temp.guidance_full_graph() graph;
create function pg_temp.assert_guidance_unchanged() returns void language plpgsql security invoker set search_path='' as $body$
begin if pg_temp.guidance_full_graph() is distinct from (select graph from pg_temp.guidance_before_read)
 then raise exception 'Guidance read changed complete public/private graph';end if;end;$body$;
revoke all on function pg_temp.assert_guidance_unchanged() from public,anon,authenticated,service_role;

create function pg_temp.expect_guidance(actor uuid,classroom uuid,expected_code text default '00000',expected_message text default null)
returns jsonb language plpgsql security invoker set search_path='' as $body$
declare result jsonb;c jsonb;ctx jsonb;code text;message text;begin
 if current_user<>'service_role' then raise exception 'Guidance contract did not exercise service role';end if;
 begin result:=public.read_classroom_authoring_guidance_for_owner_v1(actor,classroom);
 exception when others then get stacked diagnostics code=returned_sqlstate,message=message_text;
  if code is distinct from expected_code or message is distinct from expected_message then raise exception 'Guidance exact error differs';end if;
  return null;
 end;
 if expected_code<>'00000' then raise exception 'Guidance expected denial absent';end if;
 if result is null or result->>'actor_id' is distinct from actor::text or result->>'classroom_id' is distinct from classroom::text
  or (select array_agg(key order by key) from jsonb_object_keys(result) key) is distinct from array['actor_id','classroom','classroom_id','context','version_parents']::text[]
  then raise exception 'Guidance top binding/schema differs';end if;
 c:=result->'classroom';ctx:=result->'context';
 if c->>'id' is distinct from classroom::text or c->>'teacher_id' is distinct from actor::text
  or (select array_agg(key order by key) from jsonb_object_keys(c) key) is distinct from
   array['authoring_guidance_version_id','id','source_blueprint_id','source_blueprint_version_id','teacher_id']::text[]
  then raise exception 'Guidance classroom binding/schema differs';end if;
 if ctx='null'::jsonb then
  if result->'version_parents'<>'null'::jsonb or (c->>'source_blueprint_id' is not null and c->>'source_blueprint_version_id' is not null)
   then raise exception 'Guidance null-lineage evidence differs';end if;
 else
  if (select array_agg(key order by key) from jsonb_object_keys(ctx) key) is distinct from
   array['blueprint_id','content_version_id','content_version_number','course','guidance','source_blueprint_version_id','source_blueprint_version_number','source_draft_revision']::text[]
   or (select array_agg(key order by key) from jsonb_object_keys(result->'version_parents') key) is distinct from array['content','guidance']::text[]
   or ctx->>'blueprint_id' is distinct from c->>'source_blueprint_id'
   or ctx->>'content_version_id' is distinct from c->>'source_blueprint_version_id'
   or ctx->>'source_blueprint_version_id' is distinct from coalesce(c->>'authoring_guidance_version_id',c->>'source_blueprint_version_id')
   or result#>>'{version_parents,content}' is distinct from c->>'source_blueprint_id'
   or result#>>'{version_parents,guidance}' is distinct from c->>'source_blueprint_id'
   or (select array_agg(key order by key) from jsonb_object_keys(ctx->'course') key) is distinct from
    array['assignment_titles','grade_level','outline_markdown','subject','test_titles','title']::text[]
   then raise exception 'Guidance selected version/schema differs';end if;
 end if;return result;end;$body$;
do $temp_acl$ declare ns name;begin
 select nspname into strict ns from pg_catalog.pg_namespace where oid=pg_catalog.pg_my_temp_schema();
 if ns !~ '^pg_temp_[0-9]+$' then raise exception 'Unexpected temporary schema';end if;
 execute pg_catalog.format('grant usage on schema %I to service_role',ns);
end;$temp_acl$;
revoke all on function pg_temp.expect_guidance(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function pg_temp.expect_guidance(uuid,uuid,text,text) to service_role;

do $catalog$ declare p pg_catalog.pg_proc%rowtype;a record;r text;priv text;begin
 select * into strict p from pg_catalog.pg_proc where oid='public.read_classroom_authoring_guidance_for_owner_v1(uuid,uuid)'::regprocedure;
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
  then raise exception 'Guidance RPC catalog/ACL differs';end if;
 if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.course_blueprint_versions'::regclass
   and tgname='prevent_blueprint_version_update' and not tgisinternal and tgenabled in ('O','A'))
  or not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.classrooms'::regclass
   and tgname='ab_classroom_authoring_guidance_version' and not tgisinternal and tgenabled in ('O','A'))
  or not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.classrooms'::regclass
   and tgname='classrooms_blueprint_purge_lineage_fence' and not tgisinternal and tgenabled in ('O','A'))
  then raise exception 'Guidance genuine immutability/lineage triggers absent';end if;
 --120 withheld the table.278 adds precisely one non-grantable column SELECT.
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
 ('f1000000-0000-4000-8000-000000000001','guidance_teacher@example.invalid','teacher'),
 ('f1000000-0000-4000-8000-000000000002','guidance_student_owner@example.invalid','student'),
 ('f1000000-0000-4000-8000-000000000003','guidance_member@example.invalid','teacher'),
 ('f1000000-0000-4000-8000-000000000004','guidance_blueprint_owner@example.invalid','teacher');
insert into public.course_blueprints(id,teacher_id,title) values
 ('f3000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000004','Different owner live Draft MUST NOT escape');
create temporary table guidance_snapshots(revision bigint primary key,snapshot jsonb not null) on commit drop;
insert into guidance_snapshots values(1,jsonb_build_object('metadata',jsonb_build_object('title','Frozen title','subject','Frozen subject','grade_level','11'),
 'sections',jsonb_build_object('outline_markdown','Frozen outline','answers','SECRET SECTION'),
 'assignments',(select jsonb_agg(jsonb_build_object('title','Assignment '||n,'answers','SECRET ANSWER') order by n) from generate_series(1,500) n)
  ||jsonb_build_array(null,jsonb_build_object('title',123),jsonb_build_object('title',''),jsonb_build_object('title','  '),jsonb_build_object('title',U&'\2003')),
 'assessments',(select jsonb_agg(jsonb_build_object('title','Test '||n,'answers','SECRET TEST ANSWER') order by n) from generate_series(1,200) n),
 'authoring_guidance',jsonb_build_object('course_expectations_markdown','Frozen rules','assignment_guidance_markdown','','test_guidance_markdown','','unit_exceptions','[]'::jsonb),
 'materials',jsonb_build_array(jsonb_build_object('title','SECRET MATERIAL'))));
insert into guidance_snapshots values
 (2,jsonb_build_object('metadata',jsonb_build_object('title','Adopted content MUST NOT escape'),'authoring_guidance',
  jsonb_build_object('course_expectations_markdown','Adopted rules','assignment_guidance_markdown','','test_guidance_markdown','','unit_exceptions','[]'::jsonb))),
 (3,jsonb_build_object('metadata',jsonb_build_object('title','Latest saved MUST NOT escape'),'authoring_guidance',null)),
 (4,jsonb_build_object('metadata',jsonb_build_object('title',77,'subject',null,'grade_level',false),'sections','[]'::jsonb,'assignments','not an array','assessments',null)),
 (5,'[]'::jsonb);
insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_json,snapshot_sha256,created_by)
 select ('f4000000-0000-4000-8000-'||lpad(revision::text,12,'0'))::uuid,'f3000000-0000-4000-8000-000000000001',revision,revision,
  snapshot,encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),'f1000000-0000-4000-8000-000000000004' from guidance_snapshots;
insert into public.classrooms(id,teacher_id,title,class_code,source_blueprint_id,source_blueprint_version_id) values
 ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','Guidance A','AGUIDA','f3000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001'),
 ('f2000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000002','Guidance B','AGUIDB','f3000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001'),
 ('f2000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000001','Attendance-free purge class','AGUIDC',null,null);
insert into public.classroom_enrollments(classroom_id,student_id) values
 ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001'),
 ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000003');
update pg_temp.guidance_before_read set graph=pg_temp.guidance_full_graph();
set local role service_role;
do $matrix$ declare v jsonb;a uuid:='f1000000-0000-4000-8000-000000000001';b uuid:='f1000000-0000-4000-8000-000000000002';c uuid:='f2000000-0000-4000-8000-000000000001';begin
 v:=pg_temp.expect_guidance(a,c);
 if v#>>'{context,course,title}'<>'Frozen title' or v#>>'{context,guidance,course_expectations_markdown}'<>'Frozen rules'
  or jsonb_array_length(v#>'{context,course,assignment_titles}')<>502 or jsonb_array_length(v#>'{context,course,test_titles}')<>200
  or v#>>'{context,course,assignment_titles,0}'<>'Assignment 1' or v#>>'{context,course,assignment_titles,499}'<>'Assignment 500'
  or v#>>'{context,course,assignment_titles,500}'<>'  ' or v#>>'{context,course,assignment_titles,501}'<>U&'\2003'
  or v#>>'{context,course,test_titles,199}'<>'Test 200' or v::text like '%SECRET%' or v::text like '%MUST NOT escape%'
  then raise exception 'Guidance complete order/string/privacy projection differs';end if;
 perform pg_temp.expect_guidance(b,'f2000000-0000-4000-8000-000000000002');
 v:=pg_temp.expect_guidance(a,'f2000000-0000-4000-8000-000000000003');if v->'context'<>'null'::jsonb then raise exception 'Unlinked guidance differs';end if;
 perform pg_temp.expect_guidance(b,c,'PT403','class_authoring_guidance_forbidden');
 perform pg_temp.expect_guidance('f1000000-0000-4000-8000-000000000003',c,'PT403','class_authoring_guidance_forbidden');
 perform pg_temp.expect_guidance('f1000000-0000-4000-8000-000000000099',c,'PT403','class_authoring_guidance_forbidden');
 perform pg_temp.expect_guidance(a,'f2000000-0000-4000-8000-000000000099','PT404','class_authoring_guidance_missing');
 perform pg_temp.expect_guidance(null,c,'PT400','class_authoring_guidance_invalid_argument');
 perform pg_temp.expect_guidance(a,null,'PT400','class_authoring_guidance_invalid_argument');
end;$matrix$;reset role;
do $unchanged$ begin perform pg_temp.assert_guidance_unchanged();end;$unchanged$;

savepoint adopted;
update public.classrooms set authoring_guidance_version_id='f4000000-0000-4000-8000-000000000002' where id='f2000000-0000-4000-8000-000000000001';
update pg_temp.guidance_before_read set graph=pg_temp.guidance_full_graph();
set local role service_role;do $read$ declare v jsonb;begin
 v:=pg_temp.expect_guidance('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001');
 if v#>>'{context,content_version_number}'<>'1' or v#>>'{context,source_blueprint_version_number}'<>'2'
  or v#>>'{context,guidance,course_expectations_markdown}'<>'Adopted rules' or v#>>'{context,course,title}'<>'Frozen title'
  then raise exception 'Adopted guidance changed structural context';end if;
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_guidance_unchanged();end;$unchanged$;rollback to adopted;

savepoint archived;
update public.classrooms set archived_at=statement_timestamp() where id in ('f2000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002');
update pg_temp.guidance_before_read set graph=pg_temp.guidance_full_graph();
set local role service_role;do $read$ begin
 perform pg_temp.expect_guidance('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001');
 perform pg_temp.expect_guidance('f1000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000002');end;$read$;
reset role;do $unchanged$ begin perform pg_temp.assert_guidance_unchanged();end;$unchanged$;rollback to archived;

savepoint stale_owner;
update public.classrooms set teacher_id='f1000000-0000-4000-8000-000000000002' where id='f2000000-0000-4000-8000-000000000001';
update pg_temp.guidance_before_read set graph=pg_temp.guidance_full_graph();
set local role service_role;do $read$ begin
 perform pg_temp.expect_guidance('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','PT403','class_authoring_guidance_forbidden');
 perform pg_temp.expect_guidance('f1000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000001');end;$read$;
reset role;do $unchanged$ begin perform pg_temp.assert_guidance_unchanged();end;$unchanged$;rollback to stale_owner;

savepoint historical;
update public.classrooms set source_blueprint_version_id='f4000000-0000-4000-8000-000000000004' where id='f2000000-0000-4000-8000-000000000001';
update pg_temp.guidance_before_read set graph=pg_temp.guidance_full_graph();
set local role service_role;do $read$ declare v jsonb;begin
 v:=pg_temp.expect_guidance('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001');
 if v#>'{context,guidance}'<>'null'::jsonb or v#>'{context,course}'<>jsonb_build_object('title','','subject','','grade_level','','outline_markdown','','assignment_titles','[]'::jsonb,'test_titles','[]'::jsonb)
  then raise exception 'Historical guidance/string fallback differs';end if;
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_guidance_unchanged();end;$unchanged$;rollback to historical;

savepoint invalid_snapshot;
update public.classrooms set source_blueprint_version_id='f4000000-0000-4000-8000-000000000005' where id='f2000000-0000-4000-8000-000000000001';
update pg_temp.guidance_before_read set graph=pg_temp.guidance_full_graph();
set local role service_role;do $read$ begin perform pg_temp.expect_guidance('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','PT503','class_authoring_guidance_invalid');end;$read$;
reset role;do $unchanged$ begin perform pg_temp.assert_guidance_unchanged();end;$unchanged$;rollback to invalid_snapshot;

savepoint partial_source;
update public.classrooms set source_blueprint_version_id=null where id='f2000000-0000-4000-8000-000000000001';
update pg_temp.guidance_before_read set graph=pg_temp.guidance_full_graph();
set local role service_role;do $read$ declare v jsonb;begin
 v:=pg_temp.expect_guidance('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001');
 if v->'context'<>'null'::jsonb then raise exception 'Partial source pair differs';end if;
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_guidance_unchanged();end;$unchanged$;rollback to partial_source;

savepoint partial_version_only;
update public.classrooms set source_blueprint_id=null where id='f2000000-0000-4000-8000-000000000001';
update pg_temp.guidance_before_read set graph=pg_temp.guidance_full_graph();
set local role service_role;do $read$ declare v jsonb;begin
 v:=pg_temp.expect_guidance('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001');
 if v->'context'<>'null'::jsonb then raise exception 'Version-only source pair differs';end if;
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_guidance_unchanged();end;$unchanged$;rollback to partial_version_only;

update pg_temp.guidance_before_read set graph=pg_temp.guidance_full_graph();
set local role service_role;do $maintenance$ declare k text;begin
 foreach k in array array['pika.classroom_archive_restore','pika.classroom_archive_compaction','pika.identity_mapping','pika.classroom_purge_finalize','pika.course_blueprint_purge_finalize','pika.student_purge_finalize'] loop
  perform set_config(k,'on',true);
  perform pg_temp.expect_guidance('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','PT503','class_authoring_guidance_fenced');
  perform pg_temp.expect_guidance('f1000000-0000-4000-8000-000000000003','f2000000-0000-4000-8000-000000000001','PT403','class_authoring_guidance_forbidden');
  perform set_config(k,'off',true);
 end loop;end;$maintenance$;reset role;
do $unchanged$ begin perform pg_temp.assert_guidance_unchanged();end;$unchanged$;

savepoint hot_fence;
--127 requires an attendance-free synthetic class; do not bypass its trigger.
insert into public.classroom_purge_operations(id,teacher_id,classroom_id,request_sha256,source_revision,impact_summary) values
 ('f5000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000003',repeat('a',64),1,'{}');
insert into public.classroom_purge_fences(classroom_id,operation_id,teacher_id) values
 ('f2000000-0000-4000-8000-000000000003','f5000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001');
update pg_temp.guidance_before_read set graph=pg_temp.guidance_full_graph();
set local role service_role;do $read$ begin perform pg_temp.expect_guidance('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000003','PT503','class_authoring_guidance_fenced');end;$read$;
reset role;do $unchanged$ begin perform pg_temp.assert_guidance_unchanged();end;$unchanged$;rollback to hot_fence;

savepoint blueprint_fence;
insert into public.course_blueprint_purge_operations(id,course_blueprint_id,teacher_id,request_sha256,inventory_sha256,finalization_sha256,source_revision,status) values
 ('f5000000-0000-4000-8000-000000000002','f3000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000004',repeat('a',64),repeat('b',64),repeat('c',64),1,'inventorying');
insert into public.course_blueprint_purge_fences(course_blueprint_id,operation_id) values
 ('f3000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000002');
update pg_temp.guidance_before_read set graph=pg_temp.guidance_full_graph();
set local role service_role;do $read$ begin perform pg_temp.expect_guidance('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','PT503','class_authoring_guidance_fenced');end;$read$;
reset role;do $unchanged$ begin perform pg_temp.assert_guidance_unchanged();end;$unchanged$;rollback to blueprint_fence;

savepoint title_work_limit;
-- Count discarded nonstrings too. New versions, never immutable-row mutation.
insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_json,snapshot_sha256,created_by)
 select 'f4000000-0000-4000-8000-000000000006','f3000000-0000-4000-8000-000000000001',6,6,s,encode(sha256(convert_to(s::text,'UTF8')),'hex'),'f1000000-0000-4000-8000-000000000004'
 from (select jsonb_build_object('assignments',(select jsonb_agg(null::jsonb) from generate_series(1,10000))) s) fixture;
update public.classrooms set source_blueprint_version_id='f4000000-0000-4000-8000-000000000006' where id='f2000000-0000-4000-8000-000000000001';
update pg_temp.guidance_before_read set graph=pg_temp.guidance_full_graph();
set local role service_role;do $read$ declare v jsonb;begin
 v:=pg_temp.expect_guidance('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001');
 if v#>'{context,course,assignment_titles}'<>'[]'::jsonb then raise exception 'Discarded title boundary differs';end if;
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_guidance_unchanged();end;$unchanged$;
insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_json,snapshot_sha256,created_by)
 select 'f4000000-0000-4000-8000-000000000007','f3000000-0000-4000-8000-000000000001',7,7,s,encode(sha256(convert_to(s::text,'UTF8')),'hex'),'f1000000-0000-4000-8000-000000000004'
 from (select jsonb_build_object('assignments',(select jsonb_agg(null::jsonb) from generate_series(1,10000)),'assessments',jsonb_build_array(null)) s) fixture;
update public.classrooms set source_blueprint_version_id='f4000000-0000-4000-8000-000000000007' where id='f2000000-0000-4000-8000-000000000001';
update pg_temp.guidance_before_read set graph=pg_temp.guidance_full_graph();
set local role service_role;do $read$ begin perform pg_temp.expect_guidance('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','PT503','class_authoring_guidance_too_large');end;$read$;
reset role;do $unchanged$ begin perform pg_temp.assert_guidance_unchanged();end;$unchanged$;rollback to title_work_limit;

savepoint safe_metadata;
insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_json,snapshot_sha256,created_by) values
 ('f4000000-0000-4000-8000-000000000010','f3000000-0000-4000-8000-000000000001',9007199254740991,9007199254740991,'{}',encode(sha256(convert_to('{}','UTF8')),'hex'),'f1000000-0000-4000-8000-000000000004'),
 ('f4000000-0000-4000-8000-000000000011','f3000000-0000-4000-8000-000000000001',9007199254740992,9007199254740992,'{}',encode(sha256(convert_to('{}','UTF8')),'hex'),'f1000000-0000-4000-8000-000000000004');
update public.classrooms set source_blueprint_version_id='f4000000-0000-4000-8000-000000000010' where id='f2000000-0000-4000-8000-000000000001';
update pg_temp.guidance_before_read set graph=pg_temp.guidance_full_graph();
set local role service_role;do $read$ declare v jsonb;begin
 v:=pg_temp.expect_guidance('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001');
 if (v#>>'{context,content_version_number}')::bigint<>9007199254740991 or (v#>>'{context,source_draft_revision}')::bigint<>9007199254740991 then raise exception 'Safe metadata boundary differs';end if;
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_guidance_unchanged();end;$unchanged$;
update public.classrooms set source_blueprint_version_id='f4000000-0000-4000-8000-000000000011' where id='f2000000-0000-4000-8000-000000000001';
update pg_temp.guidance_before_read set graph=pg_temp.guidance_full_graph();
set local role service_role;do $read$ begin perform pg_temp.expect_guidance('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','PT503','class_authoring_guidance_invalid');end;$read$;
reset role;do $unchanged$ begin perform pg_temp.assert_guidance_unchanged();end;$unchanged$;rollback to safe_metadata;

savepoint snapshot_limit;
-- Exact8MiB selected snapshot, inherited once, small projected wire.
insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_json,snapshot_sha256,created_by)
 select 'f4000000-0000-4000-8000-000000000008','f3000000-0000-4000-8000-000000000001',8,8,s,encode(sha256(convert_to(s::text,'UTF8')),'hex'),'f1000000-0000-4000-8000-000000000004'
 from (select jsonb_build_object('padding',repeat('x',8388608-octet_length(convert_to(jsonb_build_object('padding','')::text,'UTF8')))) s) fixture;
update public.classrooms set source_blueprint_version_id='f4000000-0000-4000-8000-000000000008' where id='f2000000-0000-4000-8000-000000000001';
update pg_temp.guidance_before_read set graph=pg_temp.guidance_full_graph();
set local role service_role;do $read$ begin perform pg_temp.expect_guidance('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001');end;$read$;
reset role;do $unchanged$ begin perform pg_temp.assert_guidance_unchanged();end;$unchanged$;
savepoint snapshot_pair_limit;
update public.classrooms set authoring_guidance_version_id='f4000000-0000-4000-8000-000000000002' where id='f2000000-0000-4000-8000-000000000001';
update pg_temp.guidance_before_read set graph=pg_temp.guidance_full_graph();
set local role service_role;do $read$ begin perform pg_temp.expect_guidance('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','PT503','class_authoring_guidance_too_large');end;$read$;
reset role;do $unchanged$ begin perform pg_temp.assert_guidance_unchanged();end;$unchanged$;rollback to snapshot_pair_limit;
insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_json,snapshot_sha256,created_by)
 select 'f4000000-0000-4000-8000-000000000009','f3000000-0000-4000-8000-000000000001',9,9,s,encode(sha256(convert_to(s::text,'UTF8')),'hex'),'f1000000-0000-4000-8000-000000000004'
 from (select jsonb_build_object('padding',repeat('x',8388609-octet_length(convert_to(jsonb_build_object('padding','')::text,'UTF8')))) s) fixture;
update public.classrooms set source_blueprint_version_id='f4000000-0000-4000-8000-000000000009' where id='f2000000-0000-4000-8000-000000000001';
update pg_temp.guidance_before_read set graph=pg_temp.guidance_full_graph();
set local role service_role;do $read$ begin perform pg_temp.expect_guidance('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','PT503','class_authoring_guidance_too_large');end;$read$;
reset role;do $unchanged$ begin perform pg_temp.assert_guidance_unchanged();end;$unchanged$;rollback to snapshot_limit;

savepoint wire_limit;
-- Selected raw snapshot fits exactly, but the complete selected wire does not.
insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_json,snapshot_sha256,created_by)
 select 'f4000000-0000-4000-8000-000000000012','f3000000-0000-4000-8000-000000000001',12,12,s,encode(sha256(convert_to(s::text,'UTF8')),'hex'),'f1000000-0000-4000-8000-000000000004'
 from (select jsonb_build_object('sections',jsonb_build_object('outline_markdown',repeat('x',8388608-octet_length(convert_to(jsonb_build_object('sections',jsonb_build_object('outline_markdown',''))::text,'UTF8'))))) s) fixture;
update public.classrooms set source_blueprint_version_id='f4000000-0000-4000-8000-000000000012' where id='f2000000-0000-4000-8000-000000000001';
update pg_temp.guidance_before_read set graph=pg_temp.guidance_full_graph();
set local role service_role;do $read$ begin perform pg_temp.expect_guidance('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','PT503','class_authoring_guidance_too_large');end;$read$;
reset role;do $unchanged$ begin perform pg_temp.assert_guidance_unchanged();end;$unchanged$;rollback to wire_limit;

--122 forbids a cold fence on a hot parent. No fabricated cold fixture, trigger
--bypass or immutable-version corruption. Forged impossible wire is CPU-only.
rollback to fixture;
do $whole_rollback$ begin if pg_temp.guidance_full_graph() is distinct from (select graph from pg_temp.guidance_original)
 then raise exception 'Guidance fixture automatic Free/Pal/full graph rollback differs';end if;end;$whole_rollback$;
rollback;
select pg_catalog.json_build_object('version',1,'scope','classroom-authoring-guidance-rollback-contract-v1','outcome','passed','stage','complete','sqlstate',null);
