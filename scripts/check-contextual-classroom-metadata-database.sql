-- Root-run rollback-only contracts. Requires the reviewed RPC to be installed.
begin;
set local statement_timeout = '45s';
set local lock_timeout = '3s';

do $installed$ begin
  if to_regprocedure('public.update_classroom_metadata_for_owner_v1(uuid,uuid,jsonb)') is null then
    raise exception 'Reviewed metadata RPC is not installed';
  end if;
  if has_function_privilege('anon','public.update_classroom_metadata_for_owner_v1(uuid,uuid,jsonb)','execute')
    or has_function_privilege('authenticated','public.update_classroom_metadata_for_owner_v1(uuid,uuid,jsonb)','execute')
    or not has_function_privilege('service_role','public.update_classroom_metadata_for_owner_v1(uuid,uuid,jsonb)','execute') then
    raise exception 'Metadata RPC execute privileges differ';
  end if;
end; $installed$;

create temp table metadata_fixture(name text primary key, id uuid not null unique default gen_random_uuid());
insert into metadata_fixture(name) values ('owner_teacher'),('owner_student'),('transfer_target'),('class_a'),('class_b'),('enrollment');
insert into public.users(id,email,role)
  select id,'metadata_sql_'||id::text||'@example.invalid',case when name='owner_teacher' then 'teacher' else 'student' end
  from metadata_fixture where name in ('owner_teacher','owner_student','transfer_target');
select public.set_effective_feature_entitlement_v1(gen_random_uuid(),id,'classrooms.create','manual',true,
  clock_timestamp(),null,3,'test:metadata-sql','metadata_source_contract',
  coalesce((select revision from public.effective_feature_entitlements where subject_user_id=fixture.id and feature_key='classrooms.create'),0))
from metadata_fixture fixture where name in ('owner_teacher','owner_student','transfer_target');
insert into public.classrooms(id,teacher_id,title,class_code)
  select classroom.id,owner.id,'metadata_sql_'||classroom.id::text,'metadata_sql_'||classroom.id::text
  from metadata_fixture classroom join metadata_fixture owner on owner.name=case classroom.name when 'class_a' then 'owner_teacher' else 'owner_student' end
  where classroom.name in ('class_a','class_b');
insert into public.classroom_enrollments(id,classroom_id,student_id)
  select enrollment.id,classroom.id,member.id from metadata_fixture enrollment
  join metadata_fixture classroom on classroom.name='class_a' join metadata_fixture member on member.name='transfer_target'
  where enrollment.name='enrollment';

create function pg_temp.metadata_state() returns jsonb language sql as $state$
  select jsonb_build_object('classrooms',coalesce((select jsonb_agg(to_jsonb(c) order by c.id)
    from public.classrooms c join metadata_fixture f on f.id=c.id),'[]'),
    'archive',coalesce((select jsonb_agg(to_jsonb(r) order by r.classroom_id)
      from public.classroom_archive_revisions r join metadata_fixture f on f.id=r.classroom_id),'[]'));
$state$;
create function pg_temp.expect_metadata_error(actor uuid,classroom uuid,patch jsonb,state text) returns void language plpgsql as $test$
declare v_before jsonb:=pg_temp.metadata_state();v_after jsonb;v_failed boolean:=false;
begin
  begin
    perform public.update_classroom_metadata_for_owner_v1(actor,classroom,patch);
  exception when others then
    if sqlstate is distinct from state then raise exception 'Unexpected metadata error state %, expected %',sqlstate,state; end if;
    v_failed:=true;
  end;
  if not v_failed then raise exception 'Expected metadata rejection %',state; end if;
  v_after:=pg_temp.metadata_state();
  if v_before is distinct from v_after then raise exception 'Metadata/archive/Blueprint state did not roll back'; end if;
end; $test$;

do $policy$
declare a uuid;b uuid;owner_a uuid;owner_b uuid;member uuid;patch jsonb;result jsonb;collision text;
begin
  select id into a from metadata_fixture where name='class_a';select id into b from metadata_fixture where name='class_b';
  select id into owner_a from metadata_fixture where name='owner_teacher';select id into owner_b from metadata_fixture where name='owner_student';
  select id into member from metadata_fixture where name='transfer_target';
  perform pg_temp.expect_metadata_error(member,a,'{"title":"denied"}','PT403');
  perform pg_temp.expect_metadata_error(owner_a,gen_random_uuid(),'{"title":"missing"}','PT404');
  perform pg_temp.expect_metadata_error(null,a,'{"title":"invalid"}','PT400');
  for patch in select value from jsonb_array_elements('[null,[],{},false,{"archived_at":null},{"teacher_id":null},{"position":2},{"authoring_guidance_version_id":null},{"manual_attendance_revision":4},{"title":null},{"title":""},{"class_code":null},{"term_label":null},{"allow_enrollment":1},{"theme_color":"wrong"},{"join_policy":"wrong"},{"lesson_plan_visibility":"wrong"},{"actual_site_slug":"UPPER"},{"actual_site_slug":false},{"actual_site_published":null},{"course_overview_markdown":null},{"course_outline_markdown":null},{"feature_visibility":{}},{"actual_site_config":{}},{"feature_visibility":false},{"actual_site_config":null}]'::jsonb) loop
    perform pg_temp.expect_metadata_error(owner_a,a,patch,'PT400');
  end loop;
  patch:='{"title":"  metadata title  ","class_code":"","term_label":"","allow_enrollment":false,"join_policy":"open_join","theme_color":"teal","lesson_plan_visibility":"all","feature_visibility":{"attendance":true,"classwork":true,"tests":true,"gradebook":true,"student_grades":false,"calendar":true,"syllabus":false,"announcements":true,"achievements":true},"actual_site_published":true,"actual_site_config":{"overview":true,"outline":true,"resources":true,"assignments":true,"tests":true,"lesson_plans":true,"announcements":true,"lesson_plan_scope":"all"},"course_overview_markdown":"Overview","course_outline_markdown":"Outline"}'::jsonb||jsonb_build_object('actual_site_slug','metadata-sql-'||a::text);
  result:=public.update_classroom_metadata_for_owner_v1(owner_a,a,patch);
  if (select count(*) from jsonb_object_keys(result))<>30 or result->>'title'<>'  metadata title  ' or result->>'class_code'<>'' then raise exception 'Full normalized metadata contract differs'; end if;
  perform pg_temp.expect_metadata_error(owner_a,a,'{"actual_site_slug":null}','PT400');
  perform public.update_classroom_metadata_for_owner_v1(owner_a,a,'{"actual_site_slug":null,"actual_site_published":false}');
  perform pg_temp.expect_metadata_error(owner_a,a,'{"actual_site_published":true}','PT400');
  -- Historical persisted empty slug: omitted slug must reject publish-only with full state unchanged.
  update public.classrooms set actual_site_slug='',actual_site_published=false where id=a;
  perform pg_temp.expect_metadata_error(owner_a,a,'{"actual_site_published":true}','PT400');
  result:=public.update_classroom_metadata_for_owner_v1(owner_a,a,'{"actual_site_published":false}');
  if result->>'actual_site_slug' is distinct from '' or result->'actual_site_published' is distinct from 'false'::jsonb then
    raise exception 'Persisted empty slug must remain unpublished';
  end if;
  collision:='metadata-sql-'||b::text;
  update public.classrooms set actual_site_slug=upper(collision) where id=b;
  -- Genuine case-insensitive idx_classrooms_actual_site_slug_unique collision.
  perform pg_temp.expect_metadata_error(owner_a,a,jsonb_build_object('actual_site_slug',collision),'PT409');
  perform public.update_classroom_metadata_for_owner_v1(owner_b,b,'{"title":"student-valued owner"}');
  update public.classrooms set archived_at=clock_timestamp() where id=b;
  perform pg_temp.expect_metadata_error(owner_b,b,'{"title":"archived"}','PT403');
end; $policy$;

-- Owned, rollback-only fault trigger; production trigger definitions remain intact.
create function pg_temp.metadata_fault() returns trigger language plpgsql as $fault$
declare mode text:=current_setting('pika.metadata_proof_fault',true);target uuid;transfer uuid;
begin
  select id into target from metadata_fixture where name='class_a';
  if new.id<>target or pg_trigger_depth()>1 then return new; end if;
  select id into transfer from metadata_fixture where name='transfer_target';
  if tg_when='BEFORE' then
    if mode='suppress_noop' then return null; end if;
    if mode='before_title' then new.title:='substituted'; end if;
  else
    if mode='late_owner' then update public.classrooms set teacher_id=transfer where id=target;
    elsif mode='late_archive' then update public.classrooms set archived_at=clock_timestamp() where id=target;
    elsif mode='late_title' then update public.classrooms set title='late substituted' where id=target;
    elsif mode='late_provenance' then update public.classrooms set source_blueprint_origin='{"tampered":true}' where id=target;
    elsif mode='late_blueprint_revision' then update public.classrooms set blueprint_source_revision=blueprint_source_revision+7 where id=target;
    elsif mode='late_archive_revision' then update public.classroom_archive_revisions set revision=revision+7 where classroom_id=target;
    end if;
  end if;
  return new;
end; $fault$;
create trigger zz_metadata_before_fault before update on public.classrooms for each row execute function pg_temp.metadata_fault();
create trigger zz_metadata_after_fault after update on public.classrooms for each row execute function pg_temp.metadata_fault();
do $rollback_faults$
declare a uuid;owner_a uuid;mode text;patch jsonb;
begin
  select id into a from metadata_fixture where name='class_a';select id into owner_a from metadata_fixture where name='owner_teacher';
  foreach mode in array array['suppress_noop','before_title','late_owner','late_archive','late_title','late_provenance','late_blueprint_revision','late_archive_revision'] loop
    perform set_config('pika.metadata_proof_fault',mode,true);
    select jsonb_build_object('title',case when mode='suppress_noop' then title else 'requested fault value' end) into patch from public.classrooms where id=a;
    perform pg_temp.expect_metadata_error(owner_a,a,patch,'PT503');
  end loop;
  perform set_config('pika.metadata_proof_fault','off',true);
end; $rollback_faults$;
-- Explicit disabled creation entitlement does not prohibit ordinary metadata.
select public.set_effective_feature_entitlement_v1(gen_random_uuid(),id,'classrooms.create','manual',false,
  clock_timestamp(),null,null,'test:metadata-sql','metadata_no_creation_requirement',
  (select revision from public.effective_feature_entitlements where subject_user_id=fixture.id and feature_key='classrooms.create'))
from metadata_fixture fixture where name='owner_teacher';
select public.update_classroom_metadata_for_owner_v1(
  (select id from metadata_fixture where name='owner_teacher'),(select id from metadata_fixture where name='class_a'),'{"theme_color":"cyan"}');
select 'PASS metadata rollback-only direct contracts, full owner output, genuine slug collision and suppression/substitution/late trigger faults restore metadata and both revision effects';
rollback;
