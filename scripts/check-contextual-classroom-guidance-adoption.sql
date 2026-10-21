-- SOURCE ONLY until separately authorized isolated execution. No PostgreSQL claim.
begin;
create function pg_temp.adoption_full_graph() returns jsonb language plpgsql security invoker set search_path='' as $body$
declare t record;rows jsonb;graph jsonb:='{}'::jsonb;begin
 for t in select n.nspname,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relkind in ('r','p') order by n.nspname,c.relname loop
  execute pg_catalog.format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb) from %I.%I r',t.nspname,t.relname) into rows;
  graph:=graph||pg_catalog.jsonb_build_object(t.nspname||'.'||t.relname,rows);
 end loop;return graph;end;$body$;
revoke all on function pg_temp.adoption_full_graph() from public,anon,authenticated,service_role;
create temporary table adoption_original on commit drop as select pg_temp.adoption_full_graph() graph;
create temporary table adoption_before_read on commit drop as select pg_temp.adoption_full_graph() graph;
create function pg_temp.assert_adoption_unchanged() returns void language plpgsql security invoker set search_path='' as $body$
begin if pg_temp.adoption_full_graph() is distinct from (select graph from pg_temp.adoption_before_read)
 then raise exception 'Adoption source changed complete public/private graph';end if;end;$body$;
revoke all on function pg_temp.assert_adoption_unchanged() from public,anon,authenticated,service_role;


create temporary table adoption_request(classroom_id uuid primary key,data jsonb not null,canonical text not null) on commit drop;
grant select,insert,update on table pg_temp.adoption_request to service_role;
create function pg_temp.expect_adoption_source(actor uuid,classroom uuid,expected_code text default '00000',expected_message text default null,revision_offset bigint default 0)
returns jsonb language plpgsql security invoker set search_path='' as $body$
declare c record;b record;v jsonb;code text;message text;k text;begin
 if current_user<>'service_role' then raise exception 'Adoption contract did not exercise service role';end if;
 select x.source_blueprint_id,x.source_blueprint_version_id,coalesce(x.authoring_guidance_version_id,x.source_blueprint_version_id) guidance
 into c from public.classrooms x where x.id=classroom;
 select x.content_revision into b from public.course_blueprints x where x.id=c.source_blueprint_id;
 begin v:=public.read_classroom_guidance_adoption_source_v1(actor,classroom,
 coalesce(c.source_blueprint_id,'c3000000-0000-4000-8000-000000000001'),coalesce(c.source_blueprint_version_id,'c4000000-0000-4000-8000-000000000001'),
 coalesce(c.guidance,'c4000000-0000-4000-8000-000000000001'),coalesce(b.content_revision,1)+revision_offset);
 exception when others then get stacked diagnostics code=returned_sqlstate,message=message_text;
 if code is distinct from expected_code or message is distinct from expected_message then raise exception 'Adoption source exact error differs';end if;return null;end;
 if expected_code<>'00000' then raise exception 'Adoption source expected denial absent';end if;
 if v->>'actor_id' is distinct from actor::text or v->>'classroom_id' is distinct from classroom::text
 or (select array_agg(key order by key) from jsonb_object_keys(v) key) is distinct from array['actor_id','classroom','classroom_id','counts','source','source_sha256','versions']::text[]
 or v#>>'{classroom,teacher_id}' is distinct from actor::text or v#>'{classroom,archived_at}'<>'null'::jsonb
 or v#>>'{source,blueprint,teacher_id}' is distinct from actor::text or v#>>'{source,blueprint,id}' is distinct from c.source_blueprint_id::text
 or v#>>'{versions,content,id}' is distinct from c.source_blueprint_version_id::text or v#>>'{versions,guidance,id}' is distinct from c.guidance::text
 or v#>>'{versions,content,course_blueprint_id}' is distinct from c.source_blueprint_id::text
 or v#>>'{versions,guidance,course_blueprint_id}' is distinct from c.source_blueprint_id::text
 or v->>'source_sha256' is distinct from encode(sha256(convert_to((v->'source')::text,'UTF8')),'hex') then raise exception 'Adoption source binding differs';end if;
 foreach k in array array['assignments','assessments','lesson_templates','materials','surveys'] loop
 if jsonb_array_length(v->'source'->k)::bigint is distinct from (v->'counts'->>k)::bigint
 or exists(select 1 from jsonb_array_elements(v->'source'->k) child where child->>'course_blueprint_id' is distinct from c.source_blueprint_id::text)
 then raise exception 'Adoption complete source count/parent differs';end if;end loop;
 return v;end;$body$;
create function pg_temp.capture_adoption(actor uuid,classroom uuid) returns void language plpgsql security invoker set search_path='' as $body$
declare v jsonb;canonical text;begin
 v:=pg_temp.expect_adoption_source(actor,classroom);
 -- Independent small opaque RPC fixture, NOT a duplicate JS snapshot serializer.
 -- Native SDK acceptance separately exercises the existing complete TS builder.
 canonical:=pg_catalog.format('{"authoring_guidance":{"assignment_guidance_markdown":"","course_expectations_markdown":"","test_guidance_markdown":"","unit_exceptions":[]},"blueprint_id":"%s","draft_revision":%s,"schema_version":3}',
 v#>>'{source,blueprint,id}',v#>>'{source,blueprint,content_revision}');
 insert into pg_temp.adoption_request values(classroom,v,canonical) on conflict(classroom_id) do update set data=excluded.data,canonical=excluded.canonical;
end;$body$;
create function pg_temp.expect_adoption_write(actor uuid,classroom uuid,expected_code text default '00000',expected_message text default null)
returns jsonb language plpgsql security invoker set search_path='' as $body$
declare r record;v jsonb;code text;message text;begin
 if current_user<>'service_role' then raise exception 'Adoption write did not exercise service role';end if;
 select * into strict r from pg_temp.adoption_request where classroom_id=classroom;
 begin v:=public.save_and_adopt_classroom_guidance_for_owner_v1(actor,classroom,(r.data#>>'{source,blueprint,id}')::uuid,
 (r.data#>>'{versions,content,id}')::uuid,(r.data#>>'{versions,guidance,id}')::uuid,(r.data#>>'{source,blueprint,content_revision}')::bigint,
 r.data->>'source_sha256',r.canonical,encode(sha256(convert_to(r.canonical,'UTF8')),'hex'));
 exception when others then get stacked diagnostics code=returned_sqlstate,message=message_text;
 if code is distinct from expected_code or message is distinct from expected_message then raise exception 'Adoption write exact error differs';end if;return null;end;
 if expected_code<>'00000' then raise exception 'Adoption write expected denial absent';end if;
 if v->>'actor_id' is distinct from actor::text or v->>'classroom_id' is distinct from classroom::text
 or v->>'blueprint_id' is distinct from r.data#>>'{source,blueprint,id}' or v->>'content_version_id' is distinct from r.data#>>'{versions,content,id}'
 or v->>'previous_guidance_version_id' is distinct from r.data#>>'{versions,guidance,id}' or v->>'source_sha256' is distinct from r.data->>'source_sha256'
 or v#>>'{guidance_version,course_blueprint_id}' is distinct from v->>'blueprint_id'
 or v#>>'{guidance_version,source_draft_revision}' is distinct from r.data#>>'{source,blueprint,content_revision}'
 or v#>>'{guidance_version,snapshot_sha256}' is distinct from encode(sha256(convert_to(r.canonical,'UTF8')),'hex')
 or v#>>'{guidance_version,id}' is distinct from (select authoring_guidance_version_id::text from public.classrooms where id=classroom)
 then raise exception 'Adoption write binding differs';end if;
 return v;end;$body$;
do $temp_acl$ declare ns name;begin
 select nspname into strict ns from pg_catalog.pg_namespace where oid=pg_catalog.pg_my_temp_schema();
 if ns!~'^pg_temp_[0-9]+$' then raise exception 'Unexpected temporary schema';end if;
 execute pg_catalog.format('grant usage on schema %I to service_role',ns);
end;$temp_acl$;
revoke all on function pg_temp.expect_adoption_source(uuid,uuid,text,text,bigint),pg_temp.capture_adoption(uuid,uuid),pg_temp.expect_adoption_write(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function pg_temp.expect_adoption_source(uuid,uuid,text,text,bigint),pg_temp.capture_adoption(uuid,uuid),pg_temp.expect_adoption_write(uuid,uuid,text,text) to service_role;

do $catalog$ declare p pg_catalog.pg_proc%rowtype;signature text;expected_args integer;begin
 foreach signature in array array['private.classroom_guidance_adoption_source_v1(uuid)','public.read_classroom_guidance_adoption_source_v1(uuid,uuid,uuid,uuid,uuid,bigint)','public.save_and_adopt_classroom_guidance_for_owner_v1(uuid,uuid,uuid,uuid,uuid,bigint,text,text,text)'] loop
 select * into strict p from pg_catalog.pg_proc where oid=signature::regprocedure;
 expected_args:=case when signature like 'private.%' then 1 when signature like 'public.read_%' then 6 else 9 end;
 if not p.prosecdef or p.provolatile<>(case when expected_args=9 then 'v' else 's' end) or p.prokind<>'f' or p.proretset or p.proisstrict or p.proleakproof
 or p.pronargs<>expected_args or p.pronargdefaults<>0 or p.prorettype<>'jsonb'::regtype or pg_get_userbyid(p.proowner)<>'postgres'
 or (select lanname from pg_catalog.pg_language where oid=p.prolang)<>'plpgsql'
 or p.proconfig is null or cardinality(p.proconfig)<>3 or not('search_path=""'=any(p.proconfig) and 'lock_timeout=1s'=any(p.proconfig) and 'statement_timeout=8s'=any(p.proconfig))
 or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute')
 or has_function_privilege('service_role',p.oid,'execute') is distinct from (expected_args<>1)
 or exists(select 1 from aclexplode(p.proacl) a where a.grantee not in(p.proowner,'service_role'::regrole::oid) or a.privilege_type<>'EXECUTE' or a.is_grantable)
 then raise exception 'Adoption catalog/ACL differs';end if;
 end loop;
 if not exists(select 1 from pg_catalog.pg_trigger where tgname='prevent_blueprint_version_update' and tgrelid='public.course_blueprint_versions'::regclass and tgenabled in('O','A') and not tgisinternal)
 then raise exception 'Version immutability trigger absent';end if;
end;$catalog$;

create function pg_temp.assert_adoption_effects(classroom uuid,blueprint uuid,new_version boolean) returns void
language plpgsql security invoker set search_path='' as $body$
declare old_graph jsonb;new_graph jsonb;before_row jsonb;after_row jsonb;k text;new_id uuid;begin
 select graph into old_graph from pg_temp.adoption_before_read;new_graph:=pg_temp.adoption_full_graph();
 if (new_graph-array['public.classrooms','public.course_blueprints','public.course_blueprint_versions','public.classroom_archive_revisions'])
 is distinct from (old_graph-array['public.classrooms','public.course_blueprints','public.course_blueprint_versions','public.classroom_archive_revisions'])
 then raise exception 'Adoption unrelated graph changed';end if;
 select authoring_guidance_version_id into strict new_id from public.classrooms where id=classroom;
 foreach k in array array['public.classrooms','public.course_blueprints','public.classroom_archive_revisions'] loop
  if jsonb_array_length(new_graph->k)<>jsonb_array_length(old_graph->k) then raise exception 'Adoption parent row count differs';end if;
  for before_row in select value from jsonb_array_elements(old_graph->k) loop
   select value into strict after_row from jsonb_array_elements(new_graph->k) where value->>'id'=before_row->>'id' or (k='public.classroom_archive_revisions' and value->>'classroom_id'=before_row->>'classroom_id');
   if k='public.classrooms' and before_row->>'id'=classroom::text then
    if after_row-array['authoring_guidance_version_id','updated_at'] is distinct from before_row-array['authoring_guidance_version_id','updated_at']
    or after_row->>'authoring_guidance_version_id'<>new_id::text or (after_row->>'updated_at')::timestamptz<>transaction_timestamp() then raise exception 'Adoption classroom footprint differs';end if;
   elsif k='public.course_blueprints' and before_row->>'id'=blueprint::text then
    if after_row-array['latest_version_number','updated_at'] is distinct from before_row-array['latest_version_number','updated_at']
    or (after_row->>'latest_version_number')::bigint<>(before_row->>'latest_version_number')::bigint+(case when new_version then 1 else 0 end)
    or (new_version and (after_row->>'updated_at')::timestamptz<>transaction_timestamp()) then raise exception 'Adoption Blueprint footprint differs';end if;
   elsif k='public.classroom_archive_revisions' and before_row->>'classroom_id'=classroom::text then
    if after_row-array['revision','updated_at'] is distinct from before_row-array['revision','updated_at']
    or (after_row->>'revision')::bigint<>(before_row->>'revision')::bigint+1
    or (after_row->>'updated_at')::timestamptz<>transaction_timestamp() then raise exception 'Adoption archive revision footprint differs';end if;
   elsif after_row is distinct from before_row then raise exception 'Adoption other parent changed';end if;
  end loop;
 end loop;
 if jsonb_array_length(new_graph->'public.course_blueprint_versions')<>jsonb_array_length(old_graph->'public.course_blueprint_versions')+(case when new_version then 1 else 0 end)
 or exists(select 1 from jsonb_array_elements(old_graph->'public.course_blueprint_versions') old_row where not (new_graph->'public.course_blueprint_versions') @> jsonb_build_array(old_row))
 then raise exception 'Adoption immutable Versions differ';end if;
 if new_version and not exists(select 1 from public.course_blueprint_versions where id=new_id and source_kind='pika' and source_metadata='{}'::jsonb)
 then raise exception 'Adoption new provenance differs';end if;
end;$body$;
revoke all on function pg_temp.assert_adoption_effects(uuid,uuid,boolean) from public,anon,authenticated,service_role;
savepoint fixture;
insert into public.users(id,email,role) values
 ('c1000000-0000-4000-8000-000000000001','adoption_student_owner@example.invalid','student'),('c1000000-0000-4000-8000-000000000002','adoption_teacher_owner@example.invalid','teacher'),
 ('c1000000-0000-4000-8000-000000000003','adoption_member@example.invalid','teacher'),('c1000000-0000-4000-8000-000000000004','adoption_stranger@example.invalid','student'),('c1000000-0000-4000-8000-000000000005','adoption_former@example.invalid','teacher');
insert into public.course_blueprints(id,teacher_id,title) values
 ('c3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Complete source'),('c3000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000002','Teacher empty source'),('c3000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000001','Student empty source');
insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_json,snapshot_sha256,created_by) values
 ('c4000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001',1,1,'{}',encode(sha256(convert_to('{}','UTF8')),'hex'),'c1000000-0000-4000-8000-000000000001'),
 ('c4000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000002',1,1,'{}',encode(sha256(convert_to('{}','UTF8')),'hex'),'c1000000-0000-4000-8000-000000000002'),
 ('c4000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000003',1,1,'{}',encode(sha256(convert_to('{}','UTF8')),'hex'),'c1000000-0000-4000-8000-000000000001');
-- Existing112 saver allocates from this legitimate saved-Version bookkeeping.
update public.course_blueprints set latest_version_number=1 where id in('c3000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000003');
insert into public.classrooms(id,teacher_id,title,class_code,source_blueprint_id,source_blueprint_version_id) values
 ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Complete source class','ADOPT1','c3000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001'),
 ('c2000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000002','Teacher writable class','ADOPT2','c3000000-0000-4000-8000-000000000002','c4000000-0000-4000-8000-000000000002'),
 ('c2000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000001','Student writable class','ADOPT3','c3000000-0000-4000-8000-000000000003','c4000000-0000-4000-8000-000000000003'),
 ('c2000000-0000-4000-8000-000000000004','c1000000-0000-4000-8000-000000000001','Attendance-free purge class','ADOPT4','c3000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001');
insert into public.classroom_enrollments(classroom_id,student_id) values ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001'),('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000003');
insert into public.course_blueprint_assignments(course_blueprint_id,title,position,instructions_markdown) select 'c3000000-0000-4000-8000-000000000001','Assignment '||n,n-502,'Preserve 雪 '||n from generate_series(1,1001) n;
insert into public.course_blueprint_assessments(course_blueprint_id,assessment_type,title,position,content,documents) select 'c3000000-0000-4000-8000-000000000001','test','Test '||n,n-502,'{"questions":[]}'::jsonb,'[]'::jsonb from generate_series(1,1001) n;
insert into public.course_blueprint_lesson_templates(course_blueprint_id,title,position,content_markdown) select 'c3000000-0000-4000-8000-000000000001','Lesson '||n,n-502,'Lesson body '||n from generate_series(1,1001) n;
insert into public.course_blueprint_materials(course_blueprint_id,title,position,content_markdown) select 'c3000000-0000-4000-8000-000000000001','Material '||n,n-502,'Material body '||n from generate_series(1,1001) n;
insert into public.course_blueprint_surveys(course_blueprint_id,title,position,questions_json) select 'c3000000-0000-4000-8000-000000000001','Survey '||n,n-502,'[]'::jsonb from generate_series(1,1001) n;
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $read$ declare result jsonb;k text;begin
 result:=pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001');foreach k in array array['assignments','assessments','lesson_templates','materials','surveys'] loop
 if (result->'counts'->>k)::integer<>1001 or result#>>array['source',k,'0','position']<>'-501' or result#>>array['source',k,'1000','position']<>'499' then raise exception 'Adoption1001 complete order differs';end if;end loop;
 perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002');perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','PT403','class_guidance_adoption_forbidden');perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000003','c2000000-0000-4000-8000-000000000001','PT403','class_guidance_adoption_forbidden');perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000004','c2000000-0000-4000-8000-000000000001','PT403','class_guidance_adoption_forbidden');perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000005','c2000000-0000-4000-8000-000000000001','PT403','class_guidance_adoption_forbidden');
 perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000099','PT404','class_guidance_adoption_classroom_missing');perform pg_temp.expect_adoption_source(null,'c2000000-0000-4000-8000-000000000001','PT400','class_guidance_adoption_invalid_argument');
 perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','PT409','class_guidance_adoption_changed',1);
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;
savepoint success_3;
set local role service_role;do $capture$ begin perform pg_temp.capture_adoption('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003'); end;$capture$;reset role;
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $write$ begin perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003');end;$write$;reset role;
do $effects$ begin perform pg_temp.assert_adoption_effects('c2000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000003',true);end;$effects$;
set local role service_role;do $capture$ begin perform pg_temp.capture_adoption('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003'); end;$capture$;reset role;
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $write$ begin perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003');end;$write$;reset role;
do $effects$ begin perform pg_temp.assert_adoption_effects('c2000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000003',false);end;$effects$;rollback to success_3;
savepoint success_2;
set local role service_role;do $capture$ begin perform pg_temp.capture_adoption('c1000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002'); end;$capture$;reset role;
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $write$ begin perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002');end;$write$;reset role;
do $effects$ begin perform pg_temp.assert_adoption_effects('c2000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000002',true);end;$effects$;
set local role service_role;do $capture$ begin perform pg_temp.capture_adoption('c1000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002'); end;$capture$;reset role;
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $write$ begin perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002');end;$write$;reset role;
do $effects$ begin perform pg_temp.assert_adoption_effects('c2000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000002',false);end;$effects$;rollback to success_2;
set local role service_role;do $capture$ begin perform pg_temp.capture_adoption('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003');perform pg_temp.capture_adoption('c1000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002'); end;$capture$;reset role;
savepoint failure_after_save;
create function pg_temp.adoption_force_failure() returns trigger language plpgsql set search_path='' as $body$
begin if not exists(select 1 from public.course_blueprint_versions where id=new.authoring_guidance_version_id)
 then raise exception 'Adoption injected failure did not observe saved Version';end if;
 raise exception using errcode='PZ280',message='adoption_forced_after_save';end;$body$;
revoke all on function pg_temp.adoption_force_failure() from public,anon,authenticated,service_role;
create trigger adoption_force_failure before update of authoring_guidance_version_id on public.classrooms
for each row execute function pg_temp.adoption_force_failure();
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $read$ declare result jsonb;k text;begin
 perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PZ280','adoption_forced_after_save');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;
rollback to failure_after_save;
savepoint other_provenance;
--112 legitimate dedup with original non-pika provenance must remain untouched.
insert into public.course_blueprint_versions(course_blueprint_id,version_number,source_draft_revision,snapshot_json,snapshot_sha256,created_by,source_kind,source_metadata)
 select 'c3000000-0000-4000-8000-000000000003',2,(data#>>'{source,blueprint,content_revision}')::bigint,canonical::jsonb,encode(sha256(convert_to(canonical,'UTF8')),'hex'),'c1000000-0000-4000-8000-000000000001','repository','{"original":"retained"}'::jsonb
 from pg_temp.adoption_request where classroom_id='c2000000-0000-4000-8000-000000000003';
update public.course_blueprints set latest_version_number=2 where id='c3000000-0000-4000-8000-000000000003';
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $write$ begin perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003');end;$write$;reset role;
do $effects$ begin perform pg_temp.assert_adoption_effects('c2000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000003',false);end;$effects$;rollback to other_provenance;
savepoint child_parent_move;
--112 UPDATE column lists omit parent-only moves.120 still locks both parents.
update public.course_blueprint_materials set course_blueprint_id='c3000000-0000-4000-8000-000000000003' where id=(select id from public.course_blueprint_materials where course_blueprint_id='c3000000-0000-4000-8000-000000000001' order by position,id limit 1);
do $revision$ begin
 if (select content_revision from public.course_blueprints where id='c3000000-0000-4000-8000-000000000003') is distinct from
 (select (data#>>'{source,blueprint,content_revision}')::bigint from pg_temp.adoption_request where classroom_id='c2000000-0000-4000-8000-000000000003')
 then raise exception 'Parent-only move no longer isolates the raw source digest guard';end if;
end;$revision$;
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $read$ declare result jsonb;k text;begin
 perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT409','class_guidance_adoption_changed');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;
rollback to child_parent_move;

savepoint archived;
update public.classrooms set archived_at=statement_timestamp() where id in('c2000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000003');
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $read$ declare result jsonb;k text;begin
 perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT403','class_guidance_adoption_archived');perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT403','class_guidance_adoption_archived');perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002','PT403','class_guidance_adoption_archived');perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002','PT403','class_guidance_adoption_archived');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;
rollback to archived;

savepoint blueprint_owner;
update public.course_blueprints set teacher_id='c1000000-0000-4000-8000-000000000002' where id='c3000000-0000-4000-8000-000000000003';
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $read$ declare result jsonb;k text;begin
 perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT403','class_guidance_adoption_forbidden');perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT403','class_guidance_adoption_forbidden');perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000003','PT403','class_guidance_adoption_forbidden');perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000003','PT403','class_guidance_adoption_forbidden');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;
rollback to blueprint_owner;

savepoint classroom_owner;
update public.classrooms set teacher_id='c1000000-0000-4000-8000-000000000002' where id='c2000000-0000-4000-8000-000000000003';
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $read$ declare result jsonb;k text;begin
 perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT403','class_guidance_adoption_forbidden');perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT403','class_guidance_adoption_forbidden');perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000003','PT403','class_guidance_adoption_forbidden');perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000003','PT403','class_guidance_adoption_forbidden');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;
rollback to classroom_owner;

savepoint both_owners;
update public.classrooms set teacher_id='c1000000-0000-4000-8000-000000000002' where id='c2000000-0000-4000-8000-000000000003';update public.course_blueprints set teacher_id='c1000000-0000-4000-8000-000000000002' where id='c3000000-0000-4000-8000-000000000003';
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $read$ declare result jsonb;k text;begin
 perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT403','class_guidance_adoption_forbidden');perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT403','class_guidance_adoption_forbidden');perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000003');perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000003','PT409','class_guidance_adoption_changed');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;
rollback to both_owners;

savepoint draft_changed;
update public.course_blueprints set title='Fresh Draft' where id='c3000000-0000-4000-8000-000000000003';
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $read$ declare result jsonb;k text;begin
 perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003');perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT409','class_guidance_adoption_changed');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;
rollback to draft_changed;

savepoint unlinked;
update public.classrooms set source_blueprint_version_id=null where id='c2000000-0000-4000-8000-000000000003';
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $read$ declare result jsonb;k text;begin
 perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT409','class_guidance_adoption_unlinked');perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT409','class_guidance_adoption_unlinked');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;
rollback to unlinked;

savepoint partial_link;
update public.classrooms set source_blueprint_id=null where id='c2000000-0000-4000-8000-000000000003';
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $read$ declare result jsonb;k text;begin
 perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT409','class_guidance_adoption_unlinked');perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT409','class_guidance_adoption_unlinked');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;
rollback to partial_link;

savepoint mismatched_parent;
update public.classrooms set source_blueprint_version_id='c4000000-0000-4000-8000-000000000001' where id='c2000000-0000-4000-8000-000000000003';
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $read$ declare result jsonb;k text;begin
 perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT503','class_guidance_adoption_invalid');perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT409','class_guidance_adoption_changed');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;
rollback to mismatched_parent;

savepoint adopted_changed;
insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_json,snapshot_sha256,created_by)
 values('c4000000-0000-4000-8000-000000000004','c3000000-0000-4000-8000-000000000003',2,2,'{}',encode(sha256(convert_to('{}','UTF8')),'hex'),'c1000000-0000-4000-8000-000000000001');
update public.classrooms set authoring_guidance_version_id='c4000000-0000-4000-8000-000000000004' where id='c2000000-0000-4000-8000-000000000003';
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $read$ declare result jsonb;k text;begin
 perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003');perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT409','class_guidance_adoption_changed');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;
rollback to adopted_changed;
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $read$ declare result jsonb;k text;begin
 foreach k in array array['pika.classroom_archive_restore','pika.classroom_archive_compaction','pika.identity_mapping','pika.classroom_purge_finalize','pika.course_blueprint_purge_finalize','pika.student_purge_finalize'] loop
 perform set_config(k,'on',true);perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT503','class_guidance_adoption_fenced');perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT503','class_guidance_adoption_fenced');
 perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000003','c2000000-0000-4000-8000-000000000003','PT403','class_guidance_adoption_forbidden');perform set_config(k,'off',true);end loop;
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;

savepoint hot_fence;
--127: the synthetic fenced class has no attendance rows.
set local role service_role;do $capture$ begin perform pg_temp.capture_adoption('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000004');end;$capture$;reset role;
insert into public.classroom_purge_operations(id,teacher_id,classroom_id,request_sha256,source_revision,impact_summary) values
 ('c5000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000004',repeat('a',64),1,'{}');
insert into public.classroom_purge_fences(classroom_id,operation_id,teacher_id) values ('c2000000-0000-4000-8000-000000000004','c5000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001');
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $read$ declare result jsonb;k text;begin
 perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000004','PT503','class_guidance_adoption_fenced');perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000004','PT503','class_guidance_adoption_fenced');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;
rollback to hot_fence;

savepoint blueprint_fence;
insert into public.course_blueprint_purge_operations(id,course_blueprint_id,teacher_id,request_sha256,inventory_sha256,finalization_sha256,source_revision,status) values
 ('c5000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000001',repeat('a',64),repeat('b',64),repeat('c',64),1,'inventorying');
insert into public.course_blueprint_purge_fences(course_blueprint_id,operation_id) values ('c3000000-0000-4000-8000-000000000003','c5000000-0000-4000-8000-000000000002');
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $read$ declare result jsonb;k text;begin
 perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT503','class_guidance_adoption_fenced');perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT503','class_guidance_adoption_fenced');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;
rollback to blueprint_fence;

savepoint source_digest;
update pg_temp.adoption_request set data=jsonb_set(data,'{source_sha256}',to_jsonb(repeat('f',64))) where classroom_id='c2000000-0000-4000-8000-000000000003';
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $read$ declare result jsonb;k text;begin
 perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT409','class_guidance_adoption_changed');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;
rollback to source_digest;

savepoint invalid_canonical;
update pg_temp.adoption_request set canonical='{' where classroom_id='c2000000-0000-4000-8000-000000000003';
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $read$ declare result jsonb;k text;begin
 perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT400','class_guidance_adoption_invalid_argument');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;
rollback to invalid_canonical;

savepoint invalid_provenance;
update pg_temp.adoption_request set canonical=replace(canonical,'c3000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000002') where classroom_id='c2000000-0000-4000-8000-000000000003';
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $read$ declare result jsonb;k text;begin
 perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT400','class_guidance_adoption_invalid_argument');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;
rollback to invalid_provenance;

savepoint quoted_schema_version;
-- Correct hash, wrong JSON numeric type: reject before112 and preserve all rows.
update pg_temp.adoption_request set canonical=replace(canonical,'"schema_version":3','"schema_version":"3"') where classroom_id='c2000000-0000-4000-8000-000000000003';
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $write$ begin perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT400','class_guidance_adoption_invalid_argument');end;$write$;reset role;
do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;rollback to quoted_schema_version;

savepoint quoted_draft_revision;
update pg_temp.adoption_request set canonical=replace(canonical,'"draft_revision":'||(data#>>'{source,blueprint,content_revision}'),
 '"draft_revision":"'||(data#>>'{source,blueprint,content_revision}')||'"') where classroom_id='c2000000-0000-4000-8000-000000000003';
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $write$ begin perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT400','class_guidance_adoption_invalid_argument');end;$write$;reset role;
do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;rollback to quoted_draft_revision;

savepoint source_limit;
-- Complete final source envelope at8MiB and one byte beyond. The preaggregate
-- raw-row sum is independently checked by the helper before array construction.
create temporary table adoption_source_budget on commit drop as select octet_length(convert_to(
 public.read_classroom_guidance_adoption_source_v1('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000003','c4000000-0000-4000-8000-000000000003','c4000000-0000-4000-8000-000000000003',1)::text,'UTF8')) overhead;
update public.course_blueprints set overview_markdown=repeat('x',8388608-(select overhead from pg_temp.adoption_source_budget)) where id='c3000000-0000-4000-8000-000000000003';
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $read$ declare result jsonb;k text;begin
 result:=pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003');if octet_length(convert_to(result::text,'UTF8'))<>8388608 then raise exception 'Adoption exact source envelope boundary differs';end if;
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;
update public.course_blueprints set overview_markdown=overview_markdown||'x' where id='c3000000-0000-4000-8000-000000000003';
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $read$ declare result jsonb;k text;begin
 perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT503','class_guidance_adoption_too_large');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;
-- Parent projection alone beyond8MiB must refuse before any jsonb_agg.
update public.course_blueprints set overview_markdown=repeat('é',4194305) where id='c3000000-0000-4000-8000-000000000003';
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $read$ declare result jsonb;k text;begin
 perform pg_temp.expect_adoption_source('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT503','class_guidance_adoption_too_large');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;
rollback to source_limit;

savepoint snapshot_limit;
-- Independent RPC byte-bound fixture only, not a new canonical TS serializer.
-- Exact parsed representation8MiB succeeds; canonical text remains below8MiB.
create temporary table adoption_snapshot_budget on commit drop as select replace(canonical,',"schema_version":3}',',"padding":"","schema_version":3}') base,
 octet_length(convert_to(replace(canonical,',"schema_version":3}',',"padding":"","schema_version":3}')::jsonb::text,'UTF8')) overhead
 from pg_temp.adoption_request where classroom_id='c2000000-0000-4000-8000-000000000003';
update pg_temp.adoption_request set canonical=replace((select base from pg_temp.adoption_snapshot_budget),'"padding":""','"padding":"'||repeat('x',8388608-(select overhead from pg_temp.adoption_snapshot_budget))||'"') where classroom_id='c2000000-0000-4000-8000-000000000003';
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $write$ begin perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003');end;$write$;reset role;
do $effects$ begin perform pg_temp.assert_adoption_effects('c2000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000003',true);end;$effects$;
rollback to snapshot_limit;

savepoint snapshot_parsed_over_limit;
create temporary table adoption_parsed_budget on commit drop as select replace(canonical,',"schema_version":3}',',"padding":"","schema_version":3}') base,
 octet_length(convert_to(replace(canonical,',"schema_version":3}',',"padding":"","schema_version":3}')::jsonb::text,'UTF8')) overhead
 from pg_temp.adoption_request where classroom_id='c2000000-0000-4000-8000-000000000003';
update pg_temp.adoption_request set canonical=replace((select base from pg_temp.adoption_parsed_budget),'"padding":""','"padding":"'||repeat('x',8388609-(select overhead from pg_temp.adoption_parsed_budget))||'"') where classroom_id='c2000000-0000-4000-8000-000000000003';
do $bound$ declare text_bytes bigint;parsed_bytes bigint;begin
 select octet_length(convert_to(canonical,'UTF8')),octet_length(convert_to(canonical::jsonb::text,'UTF8')) into text_bytes,parsed_bytes
 from pg_temp.adoption_request where classroom_id='c2000000-0000-4000-8000-000000000003';
 if text_bytes>8388608 or parsed_bytes<>8388609 then raise exception 'Adoption parsed one-byte boundary fixture differs';end if;end;$bound$;
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $write$ begin perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT503','class_guidance_adoption_too_large');end;$write$;reset role;
do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;rollback to snapshot_parsed_over_limit;

savepoint snapshot_text_exact_limit;
create temporary table adoption_text_budget on commit drop as select replace(canonical,',"schema_version":3}',',"padding":"","schema_version":3}') base,
 octet_length(convert_to(replace(canonical,',"schema_version":3}',',"padding":"","schema_version":3}'),'UTF8')) overhead
 from pg_temp.adoption_request where classroom_id='c2000000-0000-4000-8000-000000000003';
update pg_temp.adoption_request set canonical=replace((select base from pg_temp.adoption_text_budget),'"padding":""','"padding":"'||repeat('x',8388608-(select overhead from pg_temp.adoption_text_budget))||'"') where classroom_id='c2000000-0000-4000-8000-000000000003';
do $bound$ begin if (select octet_length(convert_to(canonical,'UTF8')) from pg_temp.adoption_request where classroom_id='c2000000-0000-4000-8000-000000000003')<>8388608 then raise exception 'Adoption exact text boundary fixture differs';end if;end;$bound$;
-- Text fits but parsed JSONB exceeds the independent bound.
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $write$ begin perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT503','class_guidance_adoption_too_large');end;$write$;reset role;
do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;rollback to snapshot_text_exact_limit;
savepoint snapshot_over_limit;
update pg_temp.adoption_request set canonical=replace(canonical,',"schema_version":3}',',"padding":"'||repeat('x',8388608)||'","schema_version":3}') where classroom_id='c2000000-0000-4000-8000-000000000003';
update pg_temp.adoption_before_read set graph=pg_temp.adoption_full_graph();
set local role service_role;do $read$ declare result jsonb;k text;begin
 perform pg_temp.expect_adoption_write('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','PT503','class_guidance_adoption_too_large');
end;$read$;reset role;do $unchanged$ begin perform pg_temp.assert_adoption_unchanged();end;$unchanged$;
rollback to snapshot_over_limit;

-- No fabricated cold fence on a hot parent (122), immutable Version rewrite,
-- missing-FK row or trigger bypass. Real concurrent-session proof is separate.
rollback to fixture;
do $whole_rollback$ begin if pg_temp.adoption_full_graph() is distinct from (select graph from pg_temp.adoption_original)
 then raise exception 'Adoption fixture automatic Free/Pal/full graph rollback differs';end if;end;$whole_rollback$;
rollback;
select pg_catalog.json_build_object('version',1,'scope','classroom-guidance-adoption-rollback-contract-v1','outcome','passed','stage','complete','sqlstate',null);
