-- Root-run rollback-only contract. Never installs235 or changes rollout settings.
-- Fixture identities and baseline live only in this connection's temporary schema.
create temp table roster_owner_fixture as select gen_random_uuid() as owner,gen_random_uuid() as teacher,
  gen_random_uuid() as learner,gen_random_uuid() as classmate,gen_random_uuid() as removed,
  gen_random_uuid() as classroom,gen_random_uuid() as other_classroom,
  gen_random_uuid() as learner_roster,gen_random_uuid() as classmate_roster,gen_random_uuid() as patch_roster,
  gen_random_uuid() as removed_roster,replace(gen_random_uuid()::text,'-','') as tag;
create function pg_temp.roster_owner_counts() returns jsonb language sql as $function$
  select jsonb_build_object('users',(select count(*) from public.users),'classes',(select count(*) from public.classrooms),
    'roster',(select count(*) from public.classroom_roster),'bindings',(select count(*) from public.classroom_roster_student_bindings),
    'enrollments',(select count(*) from public.classroom_enrollments),'fences',(select count(*) from public.student_purge_fences),
    'purges',(select count(*) from public.student_purge_operations),'revisions',(select count(*) from public.classroom_archive_revisions),
    'plans',(select count(*) from public.account_plans),'plan_audit',(select count(*) from public.account_plan_audit),
    'entitlements',(select count(*) from public.effective_feature_entitlements),
    'entitlement_audit',(select count(*) from public.effective_feature_entitlement_audit),
    'entries',(select count(*) from public.entries),'grades',(select count(*) from public.gradebook_item_scores),
    'attendance',(select count(*) from public.attendance_check_in_facts));
$function$;
create temp table roster_owner_baseline as select pg_temp.roster_owner_counts() as counts;
begin;
set local lock_timeout='4s';
set local statement_timeout='45s';
grant select on roster_owner_fixture,roster_owner_baseline to service_role;
do $acl$
declare v_signature text; v_role text;
begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version='235') then
    raise exception 'Reviewed235 must already be installed; proof never applies migrations';
  end if;
  foreach v_signature in array array[
    'public.upsert_classroom_roster_for_owner_v1(uuid,uuid,jsonb,text)',
    'public.update_classroom_roster_counselor_for_owner_v1(uuid,uuid,uuid,text,text)'] loop
    if to_regprocedure(v_signature) is null
      or not exists(select 1 from pg_proc where oid=to_regprocedure(v_signature) and prosecdef
        and proconfig @> array['search_path=""']::text[])
      or has_function_privilege('anon',v_signature,'execute')
      or has_function_privilege('authenticated',v_signature,'execute')
      or not has_function_privilege('service_role',v_signature,'execute')
      or exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where p.oid=to_regprocedure(v_signature) and a.grantee=0 and a.privilege_type='EXECUTE') then
      raise exception 'Roster RPC security metadata differs: %',v_signature;
    end if;
  end loop;
  foreach v_signature in array array[
    'private.valid_roster_owner_write_values_v1(jsonb,boolean)',
    'private.roster_owner_write_values_v1(public.classroom_roster)',
    'private.valid_roster_owner_write_row_v1(public.classroom_roster)',
    'private.roster_owner_write_binding_v1(uuid,uuid,uuid)',
    'private.lock_roster_owner_context_v1(uuid,uuid,text[],uuid)'] loop
    foreach v_role in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(v_role,v_signature,'execute') then raise exception 'Private helper directly executable: %',v_signature; end if;
    end loop;
    if exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=to_regprocedure(v_signature) and a.grantee=0 and a.privilege_type='EXECUTE') then
      raise exception 'Private helper has PUBLIC execute: %',v_signature;
    end if;
  end loop;
end;
$acl$;
insert into public.users(id,email,role)
  select owner,'owner-'||tag||'@example.invalid','student' from roster_owner_fixture union all
  select teacher,'teacher-'||tag||'@example.invalid','teacher' from roster_owner_fixture union all
  select learner,'learner-'||tag||'@example.invalid','teacher' from roster_owner_fixture union all
  select classmate,'classmate-'||tag||'@example.invalid','student' from roster_owner_fixture union all
  select removed,'removed-'||tag||'@example.invalid','student' from roster_owner_fixture;
set local role service_role;
select public.set_effective_feature_entitlement_v1(gen_random_uuid(),subject,'classrooms.create','manual',true,
  clock_timestamp(),null,3,'test:235','roster_owner_rollback',
  coalesce((select revision from public.effective_feature_entitlements where subject_user_id=subject and feature_key='classrooms.create'),0))
  from (select owner as subject from roster_owner_fixture union all select teacher from roster_owner_fixture) people;
reset role;
insert into public.classrooms(id,teacher_id,title,class_code)
  select classroom,owner,'Roster235 '||tag,'r235p_'||left(tag,8) from roster_owner_fixture union all
  select other_classroom,teacher,'Roster235 other '||tag,'r235o_'||left(tag,8) from roster_owner_fixture;
insert into public.classroom_enrollments(classroom_id,student_id)
  select classroom,learner from roster_owner_fixture union all select classroom,classmate from roster_owner_fixture;
insert into public.classroom_roster(id,classroom_id,email,first_name,last_name,student_number,join_source,updated_at)
  select learner_roster,classroom,'learner-'||tag||'@example.invalid','First','Last','42','manual',clock_timestamp() from roster_owner_fixture union all
  select classmate_roster,classroom,'classmate-'||tag||'@example.invalid','First','Last','42','manual',clock_timestamp() from roster_owner_fixture union all
  select patch_roster,classroom,'patch-'||tag||'@example.invalid','Patch','Only',null,'manual','2026-10-04T12:34:56.123456Z'::timestamptz from roster_owner_fixture;
insert into public.classroom_roster(id,classroom_id,email,first_name,last_name,removed_at,removed_student_id,removed_enrollment_id,
  removed_enrolled_at,retained_manual_attendance_marks)
  select removed_roster,classroom,'historical-'||tag||'@example.invalid','Removed','Historical',clock_timestamp(),removed,gen_random_uuid(),
    '2026-01-01T00:00:00Z'::timestamptz,'{}'::jsonb from roster_owner_fixture;
delete from public.classroom_roster_student_bindings where roster_id=(select learner_roster from roster_owner_fixture)
  and classroom_id=(select classroom from roster_owner_fixture) and student_id=(select learner from roster_owner_fixture);

create function pg_temp.roster_owner_state() returns jsonb language sql as $function$
  select jsonb_build_object(
    'roster',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from public.classroom_roster r where classroom_id in(select classroom from roster_owner_fixture union all select other_classroom from roster_owner_fixture)),
    'bindings',(select coalesce(jsonb_agg(to_jsonb(b) order by roster_id),'[]') from public.classroom_roster_student_bindings b where classroom_id in(select classroom from roster_owner_fixture union all select other_classroom from roster_owner_fixture)),
    'enrollments',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from public.classroom_enrollments e where classroom_id in(select classroom from roster_owner_fixture union all select other_classroom from roster_owner_fixture)),
    'revisions',(select coalesce(jsonb_agg(to_jsonb(r) order by classroom_id),'[]') from public.classroom_archive_revisions r where classroom_id in(select classroom from roster_owner_fixture union all select other_classroom from roster_owner_fixture)),
    'blueprint',(select jsonb_agg(jsonb_build_object('id',id,'revision',blueprint_source_revision) order by id) from public.classrooms where id in(select classroom from roster_owner_fixture union all select other_classroom from roster_owner_fixture)));
$function$;
create function pg_temp.roster_owner_rejected(p_statement text,p_code text) returns void language plpgsql as $function$
declare v_before jsonb:=pg_temp.roster_owner_state();
begin
  begin
    execute p_statement;
    raise exception using errcode='ZX999',message='Expected roster rejection';
  exception when others then
    if sqlstate <> p_code then raise exception 'Expected %, received %',p_code,sqlstate; end if;
  end;
  if pg_temp.roster_owner_state() is distinct from v_before then raise exception 'Rejected operation changed roster/binding/enrollment/revision state'; end if;
end;
$function$;
set local role service_role;
do $behavior$
declare f record; v_students jsonb; v_result jsonb; v_before jsonb; v_binding jsonb; v_revision bigint; v_email text; v_bad jsonb;
begin
  select * into f from roster_owner_fixture;
  v_students:=jsonb_build_array(jsonb_build_object('email','learner-'||f.tag||'@example.invalid','firstName','Changed','lastName','Last','studentNumber','42','counselorEmail',null),
    jsonb_build_object('email','new-'||f.tag||'@example.invalid','firstName','New','lastName','Last','studentNumber',null,'counselorEmail',null));
  v_before:=pg_temp.roster_owner_state();
  v_result:=public.upsert_classroom_roster_for_owner_v1(f.owner,f.classroom,v_students,'csv-preview');
  if v_result->>'needs_confirmation' <> 'true' or (v_result->>'update_count')::int<>1
    or (v_result->>'new_count')::int<>1 or (v_result->>'total_count')::int<>2
    or pg_temp.roster_owner_state() is distinct from v_before then raise exception 'CSV preview wrote rows/bindings/revision or returned invalid counts'; end if;
  if exists(select 1 from public.classroom_roster_student_bindings where roster_id=f.learner_roster) then raise exception 'Preview repaired binding'; end if;
  v_result:=public.upsert_classroom_roster_for_owner_v1(f.owner,f.classroom,v_students,'csv-confirmed');
  if v_result->>'needs_confirmation'<>'false' or jsonb_array_length(v_result->'rows')<>2
    or not exists(select 1 from public.classroom_roster_student_bindings where roster_id=f.learner_roster and student_id=f.learner) then
    raise exception 'Confirmed write did not bind teacher-valued learner'; end if;
  select to_jsonb(b) into v_binding from public.classroom_roster_student_bindings b where roster_id=f.learner_roster;
  v_before:=pg_temp.roster_owner_state();
  select revision into v_revision from public.classroom_archive_revisions where classroom_id=f.classroom;
  v_result:=public.upsert_classroom_roster_for_owner_v1(f.owner,f.classroom,v_students,'csv-preview');
  -- Installed095 resource trigger bumps on every accepted UPDATE, including equal values
  -- within this one transaction where now()/updated_at deliberately remain identical.
  if v_result->>'needs_confirmation'<>'false' or (select revision from public.classroom_archive_revisions where classroom_id=f.classroom)
    <> v_revision+jsonb_array_length(v_students) then raise exception 'No-change preview did not immediately upsert every requested row'; end if;
  if (select to_jsonb(b) from public.classroom_roster_student_bindings b where roster_id=f.learner_roster) is distinct from v_binding then raise exception 'Stable binding changed'; end if;
  perform pg_temp.roster_owner_rejected(format('select public.upsert_classroom_roster_for_owner_v1(%L,%L,%L::jsonb,%L)',f.learner,f.classroom,v_students,'manual'),'42501');
  perform pg_temp.roster_owner_rejected(format('select public.upsert_classroom_roster_for_owner_v1(%L,%L,%L::jsonb,%L)',f.owner,gen_random_uuid(),v_students,'manual'),'P0002');
  perform pg_temp.roster_owner_rejected(format('select public.update_classroom_roster_counselor_for_owner_v1(%L,%L,%L,null,%L)',f.teacher,f.other_classroom,f.patch_roster,'2026-10-04T12:34:56.123456Z'),'PT404');
  v_result:=public.update_classroom_roster_counselor_for_owner_v1(f.owner,f.classroom,f.patch_roster,'MiXeD@Example.INVALID','2026-10-04T08:34:56.123456-04:00');
  if v_result->'roster'->>'counselor_email'<>'MiXeD@Example.INVALID' then raise exception 'PATCH case changed'; end if;
  -- The whole script uses one transaction: exact stale comparison is tested against the original inserted microsecond timestamp.
  perform pg_temp.roster_owner_rejected(format('select public.update_classroom_roster_counselor_for_owner_v1(%L,%L,%L,null,%L)',f.owner,f.classroom,f.patch_roster,'2026-10-04T08:34:56.123455-04:00'),'PT409');
  foreach v_email in array array['historical-'||f.tag||'@example.invalid','removed-'||f.tag||'@example.invalid'] loop
    v_bad:=jsonb_build_array(jsonb_build_object('email',v_email,'firstName','Denied','lastName','Last','studentNumber',null,'counselorEmail',null));
    perform pg_temp.roster_owner_rejected(format('select public.upsert_classroom_roster_for_owner_v1(%L,%L,%L::jsonb,%L)',f.owner,f.classroom,v_bad,'csv-preview'),'PT409');
  end loop;
  perform pg_temp.roster_owner_rejected(format('select public.update_classroom_roster_counselor_for_owner_v1(%L,%L,%L,null,%L)',f.owner,f.classroom,f.removed_roster,'2026-10-04T00:00:00Z'),'PT409');
  foreach v_bad in array array['[]'::jsonb,v_students||v_students,
    jsonb_build_array(jsonb_build_object('email','too-long-'||f.tag||'@example.invalid','firstName',repeat('😀',501),'lastName','Last','studentNumber',null,'counselorEmail',null))] loop
    perform pg_temp.roster_owner_rejected(format('select public.upsert_classroom_roster_for_owner_v1(%L,%L,%L::jsonb,%L)',f.owner,f.classroom,v_bad,'manual'),'22023');
  end loop;
  v_bad:=(select jsonb_agg(jsonb_build_object('email','bound-'||i||'-'||f.tag||'@example.invalid','firstName','First','lastName','Last','studentNumber',null,'counselorEmail',null)) from generate_series(1,1001)i);
  perform pg_temp.roster_owner_rejected(format('select public.upsert_classroom_roster_for_owner_v1(%L,%L,%L::jsonb,%L)',f.owner,f.classroom,v_bad,'manual'),'22023');
  -- Finite, exact SQL transport validation happens inside the transaction.
  begin
    set local role postgres;
    update public.classroom_roster set created_at='infinity' where id=f.patch_roster;
    set local role service_role;
    perform pg_temp.roster_owner_rejected(format('select public.update_classroom_roster_counselor_for_owner_v1(%L,%L,%L,%L,%L)',
      f.owner,f.classroom,f.patch_roster,'Valid@Example.INVALID',(select to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.classroom_roster where id=f.patch_roster)),'PT503');
    raise exception using errcode='ZX001',message='Rollback malformed historical timestamp';
  exception when sqlstate 'ZX001' then null; end;
end;
$behavior$;
reset role;

do $fences_and_identity$
declare f record; v_operation uuid; v_target uuid; v_result jsonb; v_before jsonb; v_rows jsonb; v_binding jsonb;
  v_case record; v_fenced_roster uuid; v_fenced_email text;
  v_retained_enrollment public.classroom_enrollments%rowtype; v_second_roster uuid; v_mode text;
begin
  select * into f from roster_owner_fixture;
  -- Stable learner A remains authoritative when current email now matches enrolled B.
  update public.users set email='learner-changed-'||f.tag||'@example.invalid' where id=f.learner;
  update public.users set email='learner-'||f.tag||'@example.invalid' where id=f.classmate;
  select to_jsonb(b) into v_binding from public.classroom_roster_student_bindings b where roster_id=f.learner_roster;
  v_rows:=jsonb_build_array(jsonb_build_object('email','learner-'||f.tag||'@example.invalid','firstName','Stable','lastName','Last','studentNumber','42','counselorEmail',null));
  set local role service_role;
  v_result:=public.upsert_classroom_roster_for_owner_v1(f.owner,f.classroom,v_rows,'manual');
  if (select to_jsonb(b) from public.classroom_roster_student_bindings b where roster_id=f.learner_roster) is distinct from v_binding then raise exception 'Email reassignment moved stable binding'; end if;
  reset role;
  update public.users set email='classmate-'||f.tag||'@example.invalid' where id=f.classmate;
  v_rows:=jsonb_build_array(jsonb_build_object('email','learner-changed-'||f.tag||'@example.invalid','firstName','Second','lastName','Last','studentNumber',null,'counselorEmail',null));
  set local role service_role;
  v_result:=public.upsert_classroom_roster_for_owner_v1(f.owner,f.classroom,v_rows,'manual');
  if (select count(*) from public.classroom_roster_student_bindings where classroom_id=f.classroom and student_id=f.learner)<>2 then raise exception 'Legitimate second binding was rejected'; end if;
  reset role;
  -- A tombstone fences the resolved identity, not only its historical/current
  -- emails. A second legitimate bound row must not bypass final removal.
  begin
    select * into strict v_retained_enrollment from public.classroom_enrollments
      where classroom_id=f.classroom and student_id=f.learner;
    select id into strict v_second_roster from public.classroom_roster
      where classroom_id=f.classroom and email='learner-changed-'||f.tag||'@example.invalid';
    update public.classroom_roster set removed_at=clock_timestamp(),removed_student_id=f.learner,
      removed_enrollment_id=v_retained_enrollment.id,removed_enrolled_at=v_retained_enrollment.created_at,
      retained_manual_attendance_marks=coalesce(v_retained_enrollment.manual_attendance_marks,'{}'::jsonb)
      where id=f.learner_roster and classroom_id=f.classroom;
    delete from public.classroom_enrollments where id=v_retained_enrollment.id
      and classroom_id=f.classroom and student_id=f.learner;
    update public.users set email='learner-current-c-'||f.tag||'@example.invalid' where id=f.learner;
    v_rows:=jsonb_build_array(jsonb_build_object('email','learner-changed-'||f.tag||'@example.invalid',
      'firstName','Forbidden second row','lastName','Last','studentNumber',null,'counselorEmail',null));
    set local role service_role;
    foreach v_mode in array array['manual','csv-preview','csv-confirmed'] loop
      perform pg_temp.roster_owner_rejected(format(
        'select public.upsert_classroom_roster_for_owner_v1(%L,%L,%L::jsonb,%L)',
        f.owner,f.classroom,v_rows,v_mode),'PT409');
    end loop;
    perform pg_temp.roster_owner_rejected(format(
      'select public.update_classroom_roster_counselor_for_owner_v1(%L,%L,%L,%L,%L)',
      f.owner,f.classroom,v_second_roster,'Forbidden@Example.INVALID',
      (select to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        from public.classroom_roster where id=v_second_roster)),'PT409');
    raise exception using errcode='ZX001',message='Rollback duplicate-bound retained-identity regression';
  exception when sqlstate 'ZX001' then null; end;
  -- Exact teacher-valued target fence rejects that learner while the classmate remains writable.
  for v_case in select * from (values(f.learner,true),(f.learner,false),(f.classmate,true)) cases(subject,bound) loop
    begin
      v_target:=v_case.subject;
      v_fenced_email:=case when v_target=f.classmate then 'classmate-'||f.tag||'@example.invalid'
        when v_case.bound then 'learner-'||f.tag||'@example.invalid' else 'learner-changed-'||f.tag||'@example.invalid' end;
      select id into strict v_fenced_roster from public.classroom_roster where classroom_id=f.classroom and email=v_fenced_email;
      if not v_case.bound then delete from public.classroom_roster_student_bindings where roster_id=v_fenced_roster
        and classroom_id=f.classroom and student_id=v_target; end if;
      v_operation:=gen_random_uuid();
      insert into public.student_purge_operations(id,teacher_id,classroom_id,student_id,student_email,student_binding_sha256,
        request_sha256,status,source_revision,retryable) values(v_operation,f.owner,f.classroom,v_target,
        (select email from public.users where id=v_target),repeat('a',64),repeat('b',64),'failed',1,true);
      insert into public.student_purge_fences(classroom_id,student_id,operation_id,teacher_id) values(f.classroom,v_target,v_operation,f.owner);
      set local role service_role;
      v_rows:=jsonb_build_array(jsonb_build_object('email',v_fenced_email,
        'firstName','Denied','lastName','Last','studentNumber','42','counselorEmail',null));
      perform pg_temp.roster_owner_rejected(format('select public.upsert_classroom_roster_for_owner_v1(%L,%L,%L::jsonb,%L)',f.owner,f.classroom,v_rows,'manual'),'PT409');
      perform pg_temp.roster_owner_rejected(format('select public.update_classroom_roster_counselor_for_owner_v1(%L,%L,%L,null,%L)',f.owner,f.classroom,
        v_fenced_roster,'2026-10-04T00:00:00Z'),'PT409');
      v_rows:=jsonb_build_array(jsonb_build_object('email',case when v_target=f.learner then 'classmate-' else 'learner-' end||f.tag||'@example.invalid',
        'firstName','Isolated','lastName','Last','studentNumber','42','counselorEmail',null));
      v_result:=public.upsert_classroom_roster_for_owner_v1(f.owner,f.classroom,v_rows,'manual');
      if v_result->>'needs_confirmation'<>'false' then raise exception 'Exact target fence blocked classmate'; end if;
      raise exception using errcode='ZX001',message='Rollback exact synthetic fence';
    exception when sqlstate 'ZX001' then null; end;
  end loop;
  -- Owner/archive state is re-read separately on confirmation, not inherited from preview.
  update public.classrooms set teacher_id=f.teacher where id=f.classroom;
  set local role service_role;
  perform pg_temp.roster_owner_rejected(format('select public.upsert_classroom_roster_for_owner_v1(%L,%L,%L::jsonb,%L)',f.owner,f.classroom,v_rows,'csv-confirmed'),'42501');
  reset role;
  update public.classrooms set teacher_id=f.owner,archived_at=clock_timestamp() where id=f.classroom;
  set local role service_role;
  perform pg_temp.roster_owner_rejected(format('select public.upsert_classroom_roster_for_owner_v1(%L,%L,%L::jsonb,%L)',f.owner,f.classroom,v_rows,'csv-confirmed'),'42501');
  reset role;
  update public.classrooms set archived_at=null where id=f.classroom;
end;
$fences_and_identity$;

create function pg_temp.roster_owner_probe() returns trigger language plpgsql as $function$
declare f record; v_mode text:=current_setting('pika.roster_owner_probe',true);
begin
  select * into f from roster_owner_fixture;
  if pg_trigger_depth()>1 or new.classroom_id not in(f.classroom,f.other_classroom) then return new; end if;
  if tg_when='BEFORE' then
    if v_mode='suppress' then return null;
    elsif v_mode='substitute' then new.first_name:='Substituted'; new.counselor_email:='Substituted@Example.INVALID';
    elsif v_mode='immutable' then new.created_at:='2000-01-01T00:00:00Z';
    elsif v_mode='rebind' then new.classroom_id:=f.other_classroom;
    end if;
  elsif v_mode='late' then raise exception using errcode='55000',message='Synthetic late roster failure';
  elsif v_mode='after_change' then update public.classroom_roster set first_name='After substitution',counselor_email='After@Example.INVALID' where id=new.id;
  elsif v_mode='after_binding' then update public.classroom_roster_student_bindings set student_id=f.classmate where roster_id=new.id;
  elsif v_mode='after_classmate' then update public.classroom_roster set first_name='Collateral change' where id=f.classmate_roster;
  end if;
  return new;
end;
$function$;
create trigger zz_roster235_before_probe before insert or update on public.classroom_roster for each row execute function pg_temp.roster_owner_probe();
create trigger zz_roster235_after_probe after insert or update on public.classroom_roster for each row execute function pg_temp.roster_owner_probe();
set local role service_role;
do $faults$
declare f record; v_mode text; v_operation text; v_students jsonb; v_statement text;
begin
  select * into f from roster_owner_fixture;
  foreach v_operation in array array['manual','csv-confirmed','patch'] loop
    foreach v_mode in array array['suppress','substitute','immutable','rebind','late','after_change','after_binding','after_classmate'] loop
      perform set_config('pika.roster_owner_probe',v_mode,true);
      if v_operation='patch' then
        v_statement:=format('select public.update_classroom_roster_counselor_for_owner_v1(%L,%L,%L,%L,%L)',f.owner,f.classroom,f.learner_roster,
          'Requested@Example.INVALID',(select to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.classroom_roster where id=f.learner_roster));
      else
        -- Two requested rows prove the entire batch rolls back, not just the failed row.
        v_students:=jsonb_build_array(jsonb_build_object('email','learner-'||f.tag||'@example.invalid','firstName','Requested','lastName','Last','studentNumber','42','counselorEmail',null),
          jsonb_build_object('email','batch-new-'||f.tag||'@example.invalid','firstName','New','lastName','Last','studentNumber',null,'counselorEmail',null));
        v_statement:=format('select public.upsert_classroom_roster_for_owner_v1(%L,%L,%L::jsonb,%L)',f.owner,f.classroom,v_students,v_operation);
      end if;
      perform pg_temp.roster_owner_rejected(v_statement,'PT409');
      perform set_config('pika.roster_owner_probe','',true);
    end loop;
  end loop;
end;
$faults$;
reset role;
rollback;
do $cleanup$
declare f record;
begin
  select * into f from roster_owner_fixture;
  if exists(select 1 from public.users where id=any(array[f.owner,f.teacher,f.learner,f.classmate,f.removed]))
    or exists(select 1 from public.classrooms where id=any(array[f.classroom,f.other_classroom]))
    or exists(select 1 from public.classroom_roster where classroom_id=any(array[f.classroom,f.other_classroom]))
    or exists(select 1 from public.classroom_roster_student_bindings where classroom_id=any(array[f.classroom,f.other_classroom]))
    or exists(select 1 from public.classroom_enrollments where classroom_id=any(array[f.classroom,f.other_classroom]))
    or exists(select 1 from public.student_purge_fences where classroom_id=any(array[f.classroom,f.other_classroom]))
    or exists(select 1 from public.student_purge_operations where classroom_id=any(array[f.classroom,f.other_classroom]))
    or exists(select 1 from public.classroom_archive_revisions where classroom_id=any(array[f.classroom,f.other_classroom]))
    or exists(select 1 from public.account_plan_audit where subject_user_id=any(array[f.owner,f.teacher,f.learner,f.classmate,f.removed]))
    or exists(select 1 from public.effective_feature_entitlement_audit where subject_user_id=any(array[f.owner,f.teacher,f.learner,f.classmate,f.removed]))
    or pg_temp.roster_owner_counts() is distinct from (select counts from roster_owner_baseline) then
    raise exception 'Roster rollback fixture left residual state or changed global baseline';
  end if;
end;
$cleanup$;
select 'PASS roster owner security, CSV/purge identity, exact PATCH and whole-row/binding/revision rollback proofs';
