-- Root-run only after reviewed236 is installed. All fixture/fault writes roll back.
-- No provider, Storage API, migration application, or rollout-setting changes.
create temp table removal_fixture as select gen_random_uuid() owner,gen_random_uuid() teacher,
  gen_random_uuid() learner,gen_random_uuid() classmate,gen_random_uuid() removed,
  gen_random_uuid() classroom,gen_random_uuid() other_classroom,
  gen_random_uuid() learner_roster,gen_random_uuid() classmate_roster,
  gen_random_uuid() invite_roster,gen_random_uuid() removed_roster,
  gen_random_uuid() other_roster,gen_random_uuid() item,gen_random_uuid() assignment,
  gen_random_uuid() document,gen_random_uuid() test,gen_random_uuid() attempt,gen_random_uuid() purge_operation,
  replace(gen_random_uuid()::text,'-','') tag;

-- Hash real installed table rows; nothing private or identity-bearing is printed.
-- Includes work/history, provider ledgers, settings and Storage metadata. Real
-- storage rows are observed, never fabricated or deleted by this proof.
create function pg_temp.removal_fingerprint(p_mutable boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $f$
declare t record; result jsonb:='{}'; fingerprint jsonb;
begin
  for t in select n.nspname,c.relname from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and n.nspname in ('public','private','storage')
      and (p_mutable or not (n.nspname='public' and c.relname in
        ('classrooms','classroom_roster','classroom_roster_student_bindings',
         'classroom_enrollments','attendance_participant_mappings','classroom_archive_revisions')))
    order by n.nspname,c.relname
  loop
    execute format('select jsonb_build_object(''count'',count(*),''digest'',md5(coalesce(string_agg(md5((to_jsonb(r)%s)::text),'''' order by md5((to_jsonb(r)%s)::text)),''''))) from %I.%I r',
      case when not p_mutable and t.nspname='private' and t.relname='pal_membership_generations' then '-''state''' else '' end,
      case when not p_mutable and t.nspname='private' and t.relname='pal_membership_generations' then '-''state''' else '' end,t.nspname,t.relname)
      into fingerprint;
    result:=result||jsonb_build_object(t.nspname||'.'||t.relname,fingerprint);
  end loop;
  return result;
end;
$f$;
revoke all on function pg_temp.removal_fingerprint(boolean) from public;
grant execute on function pg_temp.removal_fingerprint(boolean) to service_role;
create temp table removal_baseline as select pg_temp.removal_fingerprint() fingerprint;
begin;
set local lock_timeout='4s';
set local statement_timeout='60s';
grant select on removal_fixture,removal_baseline to service_role;
do $acl$
declare signature text:='public.remove_classroom_students_for_owner_v1(uuid,uuid,uuid[])';
begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version='236') then
    raise exception 'Reviewed236 must already be installed'; end if;
  if not exists(select 1 from pg_proc where oid=to_regprocedure(signature) and prosecdef and proconfig @> array['search_path=""'])
    or has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute')
    or not has_function_privilege('service_role',signature,'execute')
    or exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=to_regprocedure(signature) and a.grantee=0 and a.privilege_type='EXECUTE') then
    raise exception 'Removal RPC ACL/search_path differs'; end if;
  if exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid='private.valid_roster_removal_result_v1(jsonb,uuid,uuid,uuid[])'::regprocedure
        and a.grantee in (0,'anon'::regrole::oid,'authenticated'::regrole::oid,'service_role'::regrole::oid)
        and a.privilege_type='EXECUTE') then raise exception 'Private validator exposed'; end if;
  if not exists(select 1 from pg_index where indexrelid='public.classroom_roster_one_removed_membership_per_student'::regclass and indisunique)
    or position('count(*)' in pg_get_functiondef('private.authorize_removed_academic_cleanup(uuid,uuid,uuid,uuid,uuid)'::regprocedure))=0
    or position('<> 1' in pg_get_functiondef('private.authorize_removed_academic_cleanup(uuid,uuid,uuid,uuid,uuid)'::regprocedure))=0 then
    raise exception '164 uniqueness /173 exactly-one retained guard changed'; end if;
  if coalesce((select automatic_enabled or enabled or live_enabled from private.student_provider_cleanup_settings where singleton),false) then
    raise exception 'Provider/automatic cleanup must remain OFF before local proof'; end if;
end;
$acl$;

insert into public.users(id,email,role)
  select owner,'owner-'||tag||'@example.invalid','student' from removal_fixture union all
  select teacher,'teacher-'||tag||'@example.invalid','teacher' from removal_fixture union all
  select learner,'learner-'||tag||'@example.invalid','teacher' from removal_fixture union all
  select classmate,'classmate-'||tag||'@example.invalid','student' from removal_fixture union all
  select removed,'removed-'||tag||'@example.invalid','student' from removal_fixture;
set local role service_role;
select public.set_effective_feature_entitlement_v1(gen_random_uuid(),subject,'classrooms.create','manual',true,
  clock_timestamp(),null,3,'test:236','removal_rollback',
  coalesce((select revision from public.effective_feature_entitlements where subject_user_id=subject and feature_key='classrooms.create'),0))
  from (select owner subject from removal_fixture union all select teacher from removal_fixture) p;
reset role;
insert into public.classrooms(id,teacher_id,title,class_code)
  select classroom,owner,'Removal236 '||tag,'r236p_'||left(tag,8) from removal_fixture union all
  select other_classroom,teacher,'Removal236 other '||tag,'r236o_'||left(tag,8) from removal_fixture;
insert into public.classroom_enrollments(classroom_id,student_id,manual_attendance_marks,created_at)
  select classroom,learner,'{"2026-09-30":"late"}'::jsonb,'2026-09-01T13:14:15.123456Z'::timestamptz from removal_fixture union all
  select classroom,classmate,'{}'::jsonb,clock_timestamp() from removal_fixture union all
  select other_classroom,learner,'{}'::jsonb,clock_timestamp() from removal_fixture;
insert into public.classroom_roster(id,classroom_id,email,first_name,last_name,student_number,join_source)
  select learner_roster,classroom,'learner-'||tag||'@example.invalid','Learner','Historical','42','manual' from removal_fixture union all
  select classmate_roster,classroom,'classmate-'||tag||'@example.invalid','Classmate','Historical','43','csv' from removal_fixture union all
  select invite_roster,classroom,'invite-'||tag||'@example.invalid','Invite','Only',null,'manual' from removal_fixture union all
  select other_roster,other_classroom,'learner-'||tag||'@example.invalid','Other','Historical','42','manual' from removal_fixture;
insert into public.classroom_roster(id,classroom_id,email,first_name,last_name,removed_at,removed_student_id,
  removed_enrollment_id,removed_enrolled_at,retained_manual_attendance_marks)
  select removed_roster,classroom,'historical-'||tag||'@example.invalid','Removed','Historical',clock_timestamp(),removed,gen_random_uuid(),
    '2026-01-01T00:00:00Z'::timestamptz,'{"2026-01-01":"absent"}'::jsonb from removal_fixture;
-- Provision the precise rollback-only fence operation before127/171 attendance
-- state exists. Never disable those guards or fabricate a provider binding.
insert into public.student_purge_operations(id,teacher_id,classroom_id,student_id,student_email,student_binding_sha256,
  request_sha256,status,source_revision,retryable)
  select purge_operation,owner,classroom,learner,'learner-'||tag||'@example.invalid',repeat('a',64),repeat('b',64),'failed',1,true
  from removal_fixture;
insert into public.attendance_participant_mappings(classroom_id,student_id)
  select classroom,learner from removal_fixture union all select classroom,classmate from removal_fixture union all
  select other_classroom,learner from removal_fixture;
-- The teacher-labelled learner starts unbound, as existing235 permits.
delete from public.classroom_roster_student_bindings where roster_id=(select learner_roster from removal_fixture);
insert into public.entries(classroom_id,student_id,date,text,on_time)
  select classroom,learner,'2026-09-30','Synthetic retained daily work',true from removal_fixture;
insert into public.gradebook_items(id,classroom_id,title,points_possible,created_by)
  select item,classroom,'Retained grade',10,owner from removal_fixture;
insert into public.gradebook_item_scores(item_id,classroom_id,student_id,earned,returned_at)
  select item,classroom,learner,7.5,clock_timestamp() from removal_fixture;
insert into public.assignments(id,classroom_id,title,due_at,created_by)
  select assignment,classroom,'Retained assignment','2026-10-10T00:00:00Z',owner from removal_fixture;
insert into public.assignment_docs(id,assignment_id,student_id,content)
  select document,assignment,learner,'{"type":"doc","content":[]}'::jsonb from removal_fixture;
insert into public.assignment_doc_history(assignment_doc_id,snapshot,word_count,char_count,trigger)
  select document,'{"type":"doc","content":[]}'::jsonb,0,0,'baseline' from removal_fixture;
insert into public.tests(id,classroom_id,title,created_by)
  select test,classroom,'Retained test',owner from removal_fixture;
insert into public.test_attempts(id,test_id,student_id,responses)
  select attempt,test,learner,'{}'::jsonb from removal_fixture;
insert into public.test_attempt_history(test_attempt_id,snapshot,trigger)
  select attempt,'{}'::jsonb,'baseline' from removal_fixture;

-- Invoke under actual service_role, returning to postgres for fixture setup.
create function pg_temp.removal_call(a uuid,c uuid,r uuid[]) returns jsonb language plpgsql as $f$
declare result jsonb;
begin
  set local role service_role;
  result:=public.remove_classroom_students_for_owner_v1(a,c,r);
  reset role;
  return result;
end;
$f$;
create function pg_temp.removal_rejected(a uuid,c uuid,r uuid[],code text,expected_message text default null) returns void language plpgsql as $f$
declare before_state jsonb:=pg_temp.removal_fingerprint();
begin
  begin
    perform pg_temp.removal_call(a,c,r);
    raise exception using errcode='ZX999',message='Expected rejection';
  exception when others then
    if sqlstate<>code then raise exception 'Expected %, received %',code,sqlstate; end if;
    if expected_message is not null and sqlerrm is distinct from expected_message then raise exception 'Safe conflict message differs'; end if;
  end;
  if pg_temp.removal_fingerprint() is distinct from before_state then raise exception 'Rejected removal changed persisted state'; end if;
end;
$f$;

do $behavior$
declare f record; result jsonb; before_row jsonb; enrollment jsonb; mapping jsonb; binding jsonb;
  untouched jsonb; other_state jsonb; retry_state jsonb; generation_state jsonb; duplicate uuid:=gen_random_uuid(); operation uuid;
begin
  select * into f from removal_fixture;
  perform pg_temp.removal_rejected(f.learner,f.classroom,array[f.learner_roster],'42501');
  perform pg_temp.removal_rejected(f.classmate,f.classroom,array[f.learner_roster],'42501');
  perform pg_temp.removal_rejected(f.teacher,f.classroom,array[f.learner_roster],'42501');
  perform pg_temp.removal_rejected(f.owner,gen_random_uuid(),array[f.learner_roster],'42501');
  perform pg_temp.removal_rejected(f.owner,f.classroom,array[f.other_roster],'PT409');
  perform pg_temp.removal_rejected(f.owner,f.classroom,array[gen_random_uuid()],'PT409');
  perform pg_temp.removal_rejected(f.owner,f.classroom,array[]::uuid[],'22023');
  perform pg_temp.removal_rejected(f.owner,f.classroom,array[null]::uuid[],'22023');
  perform pg_temp.removal_rejected(f.owner,f.classroom,(select array_agg(gen_random_uuid()) from generate_series(1,101)),'22023');
  update public.classrooms set archived_at=clock_timestamp() where id=f.classroom;
  perform pg_temp.removal_rejected(f.owner,f.classroom,array[f.learner_roster],'42501');
  update public.classrooms set archived_at=null where id=f.classroom;
  -- An apparently invitation-only row must not erase a plausible unbound membership.
  perform pg_temp.removal_rejected(f.owner,f.classroom,array[f.invite_roster],'PT409');
  -- Current normalized email ambiguity: unique emails can differ by case/space.
  begin
    delete from public.classroom_roster_student_bindings where roster_id=f.classmate_roster;
    update public.users set email=upper('learner-'||f.tag||'@example.invalid') where id=f.classmate;
    perform pg_temp.removal_rejected(f.owner,f.classroom,array[f.learner_roster],'PT409');
    raise exception using errcode='ZX001',message='Reset ambiguity fixture';
  exception when sqlstate 'ZX001' then null; end;
  -- Both selected-one and selected-all duplicates reject before any DML.
  begin
    insert into public.classroom_roster_student_bindings(roster_id,classroom_id,student_id) values(f.learner_roster,f.classroom,f.learner);
    insert into public.classroom_roster(id,classroom_id,email,first_name,last_name)
      values(duplicate,f.classroom,'duplicate-'||f.tag||'@example.invalid','Duplicate','Bound');
    insert into public.classroom_roster_student_bindings(roster_id,classroom_id,student_id) values(duplicate,f.classroom,f.learner);
    perform pg_temp.removal_rejected(f.owner,f.classroom,array[f.learner_roster],'PT409',
      'This student has multiple roster rows. Resolve the duplicate roster entries before removing them.');
    perform pg_temp.removal_rejected(f.owner,f.classroom,array[f.learner_roster,duplicate],'PT409',
      'This student has multiple roster rows. Resolve the duplicate roster entries before removing them.');
    raise exception using errcode='ZX001',message='Reset duplicate fixture';
  exception when sqlstate 'ZX001' then null; end;
  -- Exact purge fences block only the subject; safe classmate removal succeeds.
  begin
    operation:=f.purge_operation;
    insert into public.student_purge_fences(classroom_id,student_id,operation_id,teacher_id) values(f.classroom,f.learner,operation,f.owner);
    perform pg_temp.removal_rejected(f.owner,f.classroom,array[f.learner_roster],'PT409');
    result:=pg_temp.removal_call(f.owner,f.classroom,array[f.classmate_roster]);
    if result->>'removed_count'<>'1' then raise exception 'Subject fence blocked classmate'; end if;
    result:=pg_temp.removal_call(f.teacher,f.other_classroom,array[f.other_roster]);
    if result->>'removed_count'<>'1' then raise exception 'Subject fence blocked other classroom'; end if;
    raise exception using errcode='ZX001',message='Reset exact fence fixture';
  exception when sqlstate 'ZX001' then null; end;
  -- Bound teacher-valued learner remains stable across current-email reassignment.
  begin
    insert into public.classroom_roster_student_bindings(roster_id,classroom_id,student_id) values(f.learner_roster,f.classroom,f.learner);
    select to_jsonb(b) into binding from public.classroom_roster_student_bindings b where roster_id=f.learner_roster;
    update public.users set email='changed-'||f.tag||'@example.invalid' where id=f.learner;
    update public.users set email='learner-'||f.tag||'@example.invalid' where id=f.classmate;
    result:=pg_temp.removal_call(f.owner,f.classroom,array[f.learner_roster]);
    if (select removed_student_id from public.classroom_roster where id=f.learner_roster)<>f.learner
      or (select to_jsonb(b) from public.classroom_roster_student_bindings b where roster_id=f.learner_roster) is distinct from binding
      or not exists(select 1 from public.classroom_enrollments where classroom_id=f.classroom and student_id=f.classmate) then
      raise exception 'Stable binding reassigned or classmate enrollment deleted'; end if;
    raise exception using errcode='ZX001',message='Reset stable binding fixture';
  exception when sqlstate 'ZX001' then null; end;
  select to_jsonb(r) into before_row from public.classroom_roster r where id=f.learner_roster;
  select to_jsonb(e) into enrollment from public.classroom_enrollments e where classroom_id=f.classroom and student_id=f.learner;
  select to_jsonb(m) into mapping from public.attendance_participant_mappings m where classroom_id=f.classroom and student_id=f.learner;
  untouched:=pg_temp.removal_fingerprint(false);
  select jsonb_object_agg(generation_id::text,to_jsonb(g)) into generation_state from private.pal_membership_generations g;
  select jsonb_build_object('roster',(select to_jsonb(r) from public.classroom_roster r where id=f.classmate_roster),
    'other',(select to_jsonb(r) from public.classroom_roster r where id=f.other_roster),
    'other_enrollment',(select to_jsonb(e) from public.classroom_enrollments e where classroom_id=f.other_classroom and student_id=f.learner),
    'other_mapping',(select to_jsonb(m) from public.attendance_participant_mappings m where classroom_id=f.other_classroom and student_id=f.learner)) into other_state;
  result:=pg_temp.removal_call(f.owner,f.classroom,array[f.learner_roster,f.learner_roster]);
  if result is distinct from jsonb_build_object('actor_id',f.owner,'classroom_id',f.classroom,'roster_ids',jsonb_build_array(f.learner_roster),
    'requested_count',1,'removed_count',1) then raise exception 'Strict transport/counts differ'; end if;
  if (select (to_jsonb(r)-array['removed_at','removed_student_id','removed_enrollment_id','removed_enrolled_at',
      'retained_manual_attendance_marks','retained_attendance_participant_active','updated_at']) is distinct from before_row
        -array['removed_at','removed_student_id','removed_enrollment_id','removed_enrolled_at','retained_manual_attendance_marks',
          'retained_attendance_participant_active','updated_at'] from public.classroom_roster r where id=f.learner_roster)
    or not exists(select 1 from public.classroom_roster r where id=f.learner_roster and removed_at is not null and removed_student_id=f.learner
      and removed_enrollment_id=(enrollment->>'id')::uuid and removed_enrolled_at=(enrollment->>'created_at')::timestamptz
      and retained_manual_attendance_marks=enrollment->'manual_attendance_marks' and retained_attendance_participant_active=true)
    or not exists(select 1 from public.classroom_roster_student_bindings where roster_id=f.learner_roster and student_id=f.learner)
    or exists(select 1 from public.classroom_enrollments where id=(enrollment->>'id')::uuid)
    or (select to_jsonb(m)-array['active','updated_at'] from public.attendance_participant_mappings m where classroom_id=f.classroom and student_id=f.learner)
      is distinct from mapping-array['active','updated_at']
    or (select active from public.attendance_participant_mappings where classroom_id=f.classroom and student_id=f.learner) then
    raise exception 'Six retained fields, exact enrollment/mapping, or identity differ'; end if;
  if pg_temp.removal_fingerprint(false) is distinct from untouched then raise exception 'Work/history/storage/provider/settings changed'; end if;
  if (select jsonb_object_agg(generation_id::text,to_jsonb(g)) from private.pal_membership_generations g)
      is distinct from jsonb_set(generation_state,array[enrollment->>'id','state'],'"removed"'::jsonb) then
    raise exception '168 generation identity/nonselected state changed'; end if;
  if jsonb_build_object('roster',(select to_jsonb(r) from public.classroom_roster r where id=f.classmate_roster),
    'other',(select to_jsonb(r) from public.classroom_roster r where id=f.other_roster),
    'other_enrollment',(select to_jsonb(e) from public.classroom_enrollments e where classroom_id=f.other_classroom and student_id=f.learner),
    'other_mapping',(select to_jsonb(m) from public.attendance_participant_mappings m where classroom_id=f.other_classroom and student_id=f.learner))
      is distinct from other_state then raise exception 'Classmate/other classroom changed'; end if;
  retry_state:=pg_temp.removal_fingerprint();
  result:=pg_temp.removal_call(f.owner,f.classroom,array[f.learner_roster,f.removed_roster]);
  if result->>'requested_count'<>'2' or result->>'removed_count'<>'0' or pg_temp.removal_fingerprint() is distinct from retry_state then
    raise exception 'Already-removed retry wrote state'; end if;
  -- Bound active alias alongside retained identity cannot silently repair it.
  begin
    insert into public.classroom_roster(id,classroom_id,email,first_name,last_name)
      values(duplicate,f.classroom,'alias-'||f.tag||'@example.invalid','Alias','Historical');
    insert into public.classroom_roster_student_bindings(roster_id,classroom_id,student_id) values(duplicate,f.classroom,f.learner);
    perform pg_temp.removal_rejected(f.owner,f.classroom,array[duplicate],'PT409');
    update public.users set email='alias-'||f.tag||'@example.invalid' where id=f.learner;
    delete from public.classroom_roster_student_bindings where roster_id=duplicate;
    perform pg_temp.removal_rejected(f.owner,f.classroom,array[duplicate],'PT409');
    raise exception using errcode='ZX001',message='Reset retained-identity alias';
  exception when sqlstate 'ZX001' then null; end;
  begin
    insert into public.classroom_enrollments(classroom_id,student_id) values(f.classroom,f.learner);
    raise exception using errcode='ZX999',message='165 readmission accepted';
  exception when sqlstate '55000' then null; end;
  result:=pg_temp.removal_call(f.owner,f.classroom,array[f.invite_roster]);
  if result->>'removed_count'<>'1' or exists(select 1 from public.classroom_roster where id=f.invite_roster) then
    raise exception 'Pure invitation was not deleted'; end if;
  -- Teacher global role is equally permitted when the teacher owns the class.
  result:=pg_temp.removal_call(f.teacher,f.other_classroom,array[f.other_roster]);
  if result->>'removed_count'<>'1' then raise exception 'Teacher owner denied'; end if;
end;
$behavior$;

-- Fault probes are exact synthetic class only; each failed call must preserve
-- the FULL public/private/storage row fingerprint including revision and work.
create function pg_temp.removal_probe() returns trigger language plpgsql as $f$
declare f record; mode text:=current_setting('pika.removal_probe',true);
begin
  select * into f from removal_fixture;
  if pg_trigger_depth()>1 or (case when tg_op='DELETE' then old.classroom_id else new.classroom_id end)<>f.classroom then
    return case when tg_op='DELETE' then old else new end; end if;
  if tg_when='BEFORE' then
    if mode=tg_table_name||':suppress' then return null; end if;
    if tg_op='UPDATE' and mode=tg_table_name||':substitute' then
      if tg_table_name='classroom_roster' then new.first_name:='Substituted';
      elsif tg_table_name='attendance_participant_mappings' then new.active:=true; end if;
    end if;
  elsif mode=tg_table_name||':late' and (tg_table_name<>'classroom_roster' or tg_op='UPDATE') then
    raise exception using errcode='55000',message='Synthetic late failure';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$f$;
create trigger zz_removal_roster_before before update or delete on public.classroom_roster for each row execute function pg_temp.removal_probe();
create trigger zz_removal_roster_after after update or delete on public.classroom_roster for each row execute function pg_temp.removal_probe();
create trigger zz_removal_enrollment_before before delete on public.classroom_enrollments for each row execute function pg_temp.removal_probe();
create trigger zz_removal_enrollment_after after delete on public.classroom_enrollments for each row execute function pg_temp.removal_probe();
create trigger zz_removal_mapping_before before update on public.attendance_participant_mappings for each row execute function pg_temp.removal_probe();
create trigger zz_removal_mapping_after after update on public.attendance_participant_mappings for each row execute function pg_temp.removal_probe();
do $faults$
declare f record; mode text; invitation uuid:=('00000000-'||substr(gen_random_uuid()::text,10))::uuid;
begin
  select * into f from removal_fixture;
  insert into public.classroom_roster(id,classroom_id,email,first_name,last_name)
    values(invitation,f.classroom,'fault-invite-'||f.tag||'@example.invalid','Fault','Invite');
  foreach mode in array array['classroom_roster:suppress','classroom_roster:substitute','classroom_roster:late',
    'classroom_enrollments:suppress','classroom_enrollments:late','attendance_participant_mappings:suppress',
    'attendance_participant_mappings:substitute','attendance_participant_mappings:late'] loop
    perform set_config('pika.removal_probe',mode,true);
    perform pg_temp.removal_rejected(f.owner,f.classroom,array[f.classmate_roster,invitation],'PT409');
    perform set_config('pika.removal_probe','',true);
  end loop;
end;
$faults$;
rollback;
do $cleanup$
declare f record;
begin
  select * into f from removal_fixture;
  if exists(select 1 from public.users where id=any(array[f.owner,f.teacher,f.learner,f.classmate,f.removed]))
    or exists(select 1 from public.classrooms where id=any(array[f.classroom,f.other_classroom]))
    or exists(select 1 from public.classroom_roster_student_bindings where classroom_id=any(array[f.classroom,f.other_classroom]))
    or exists(select 1 from public.classroom_archive_revisions where classroom_id=any(array[f.classroom,f.other_classroom]))
    or exists(select 1 from public.pal_event_outbox where student_id=any(array[f.owner,f.teacher,f.learner,f.classmate,f.removed]))
    or exists(select 1 from private.removed_student_cleanup_jobs where classroom_id=any(array[f.classroom,f.other_classroom]))
    or exists(select 1 from public.account_plan_audit where subject_user_id=any(array[f.owner,f.teacher,f.learner,f.classmate,f.removed]))
    or exists(select 1 from public.effective_feature_entitlement_audit where subject_user_id=any(array[f.owner,f.teacher,f.learner,f.classmate,f.removed]))
    or pg_temp.removal_fingerprint() is distinct from (select fingerprint from removal_baseline) then
    raise exception 'Rollback residual state/global baseline differs'; end if;
end;
$cleanup$;
select 'PASS preserving-removal SQL ACL, roles, identity, exact fences, retained history, fault rollback; zero residual rows; global baseline unchanged';
