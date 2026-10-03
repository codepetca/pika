-- ROOT EXECUTION ONLY after frozen review and local239 application.
-- All DDL/data/setting/fault writes roll back. The SINGLETON index is dropped
-- only inside this transaction to exercise future multirow consumers. The
-- installed168 guards stay enabled and must be byte-exact after rollback.
-- This proves SQL metadata; no provider HTTP, Storage API or physical-byte claim.
\set ON_ERROR_STOP on
create function pg_temp.group_cleanup_fingerprint() returns jsonb
language plpgsql security definer set search_path='' as $f$
declare t record; result jsonb:='{}'; fingerprint jsonb;
begin
  for t in select n.nspname,c.relname from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and n.nspname in ('public','private','storage')
    order by n.nspname,c.relname
  loop
    execute format('select jsonb_build_object(''count'',count(*),''digest'',md5(coalesce(string_agg(md5(to_jsonb(r)::text),'''' order by md5(to_jsonb(r)::text)),''''))) from %I.%I r',
      t.nspname,t.relname) into fingerprint;
    result:=result||jsonb_build_object(t.nspname||'.'||t.relname,fingerprint);
  end loop;
  return result;
end;
$f$;
revoke all on function pg_temp.group_cleanup_fingerprint() from public;
-- Capture every168 function and its installed trigger state, not just rows.
create function pg_temp.group_cleanup_membership_contract() returns jsonb
language sql stable set search_path='' as $f$
  select jsonb_build_object(
    'functions',(select jsonb_object_agg(signature,pg_get_functiondef(signature::regprocedure))
      from unnest(array['private.pal_membership_scope(uuid,uuid)',
        'private.guard_pal_membership_evidence()',
        'private.register_pal_membership(uuid,uuid,uuid,text)',
        'private.track_pal_membership_enrollment()',
        'private.track_pal_removed_roster()',
        'public.resolve_pal_membership(uuid,uuid)']) signatures(signature)),
    'triggers',(select jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(installed_trigger.oid),
      'enabled',installed_trigger.tgenabled) order by installed_trigger.tgname)
      from pg_catalog.pg_trigger installed_trigger where installed_trigger.tgfoid=any(array[
        'private.guard_pal_membership_evidence()'::regprocedure,
        'private.track_pal_membership_enrollment()'::regprocedure,
        'private.track_pal_removed_roster()'::regprocedure])),
    'tables',(select jsonb_agg(jsonb_build_object('name',relation.relname,
      'rls',relation.relrowsecurity,'acl',relation.relacl) order by relation.relname)
      from pg_catalog.pg_class relation where relation.oid in (
        'private.pal_membership_generations'::regclass,'private.pal_membership_settings'::regclass)));
$f$;
revoke all on function pg_temp.group_cleanup_membership_contract() from public;
create temp table group_cleanup_baseline as select pg_temp.group_cleanup_fingerprint() rows,
  pg_temp.group_cleanup_membership_contract() membership_contract,
  pg_get_functiondef('private.kick_removed_student_cleanup(text)'::regprocedure) kick_callback,
  pg_get_indexdef('public.classroom_roster_one_removed_membership_per_student'::regclass) singleton_index,
  pg_get_functiondef('private.guard_pal_membership_evidence()'::regprocedure) generation_guard,
  pg_get_functiondef('private.register_pal_membership(uuid,uuid,uuid,text)'::regprocedure) registration_guard;
begin;
set local lock_timeout='4s';
set local statement_timeout='60s';
do $preflight$
declare signature text:='public.discover_retained_student_cleanup_groups(uuid,uuid,uuid,uuid,boolean,text)';
begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version='239')
    or to_regprocedure(signature) is null then raise exception 'Reviewed239 must be installed'; end if;
  if not exists(select 1 from pg_index where indexrelid=
      'public.classroom_roster_one_removed_membership_per_student'::regclass and indisunique) then
    raise exception 'Singleton index must remain installed'; end if;
  if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute')
    or not has_function_privilege('service_role',signature,'execute')
    or exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=to_regprocedure(signature) and a.grantee=0 and a.privilege_type='EXECUTE')
    or has_function_privilege('service_role','private.retained_roster_cleanup_group(uuid,uuid,uuid,uuid)','execute')
    or has_table_privilege('service_role','private.removed_academic_mutations','insert') then
    raise exception 'Cleanup discovery/capability ACL differs'; end if;
  if coalesce((select enabled or live_enabled or automatic_enabled from private.student_provider_cleanup_settings where singleton),false) then
    raise exception 'Provider/automatic cleanup must be disabled before proof'; end if;
  if coalesce((select enabled from private.removed_student_academic_settings where singleton),false) then
    raise exception 'Academic cleanup must be disabled before proof'; end if;
end;
$preflight$;
create temp table group_cleanup_fixture as select gen_random_uuid() owner,gen_random_uuid() student,
  gen_random_uuid() peer,gen_random_uuid() classroom,gen_random_uuid() generation,
  gen_random_uuid() first_roster,gen_random_uuid() second_roster,gen_random_uuid() peer_roster,
  gen_random_uuid() operation,replace(gen_random_uuid()::text,'-','') tag;
create temp table group_cleanup_fault(mode text not null);
insert into group_cleanup_fault values('none');
grant select on group_cleanup_fixture to service_role;
insert into public.users(id,email,role)
  select owner,'owner-'||tag||'@example.invalid','teacher' from group_cleanup_fixture union all
  select student,'student-'||tag||'@example.invalid','student' from group_cleanup_fixture union all
  select peer,'peer-'||tag||'@example.invalid','student' from group_cleanup_fixture;
set local role service_role;
select public.set_effective_feature_entitlement_v1(gen_random_uuid(),owner,'classrooms.create','manual',true,
  clock_timestamp(),null,3,'test:239','group_cleanup_rollback',
  coalesce((select revision from public.effective_feature_entitlements where subject_user_id=owner and feature_key='classrooms.create'),0))
  from group_cleanup_fixture;
select public.set_effective_feature_entitlement_v1(gen_random_uuid(),peer,'classrooms.create','manual',true,
  clock_timestamp(),null,3,'test:239','group_cleanup_owner_change',
  coalesce((select revision from public.effective_feature_entitlements where subject_user_id=peer and feature_key='classrooms.create'),0))
  from group_cleanup_fixture;
reset role;
insert into public.classrooms(id,teacher_id,title,class_code)
  select classroom,owner,'Cleanup239 '||tag,'gc239_'||left(tag,8) from group_cleanup_fixture;
update private.student_provider_cleanup_settings set enabled=true,live_enabled=true,automatic_enabled=false,
  eligible_after=clock_timestamp()-interval '1 hour',pal_origin='https://pal.example.invalid',
  pal_integration_id=gen_random_uuid(),bara_origin='https://bara.example.invalid',installation_ref='pika_rollback_239' where singleton;
update private.removed_student_academic_settings set enabled=true where singleton;
-- Simulated prerequisites exist only inside this rollback; this is not activation evidence.
update public.managed_storage_settings set mode='enforced',activated_at=clock_timestamp(),
  readiness_verified_at=clock_timestamp(),readiness_digest=repeat('e',64) where singleton;
insert into public.classroom_enrollments(id,classroom_id,student_id,manual_attendance_marks)
  select generation,classroom,student,'{"2026-10-01":"present"}'::jsonb from group_cleanup_fixture;
insert into public.classroom_roster(id,classroom_id,email,first_name)
  select first_roster,classroom,'student-'||tag||'@example.invalid','First label' from group_cleanup_fixture union all
  select peer_roster,classroom,'invite-'||tag||'@example.invalid','Untouched invitation' from group_cleanup_fixture;
insert into public.attendance_roster_mappings(classroom_id) select classroom from group_cleanup_fixture;
insert into public.attendance_principal_mappings(user_id) select owner from group_cleanup_fixture;
insert into public.attendance_participant_mappings(classroom_id,student_id) select classroom,student from group_cleanup_fixture;
select public.remove_classroom_students_preserving_data(owner,classroom,array[first_roster]) from group_cleanup_fixture;
-- Explicit rollback-scoped test DDL. Persistent singleton opening is OUT OF SCOPE.
drop index public.classroom_roster_one_removed_membership_per_student;
insert into public.classroom_roster(id,classroom_id,email,first_name,removed_at,removed_student_id,
  removed_enrollment_id,removed_enrolled_at,retained_manual_attendance_marks,retained_attendance_participant_active)
  select f.second_roster,r.classroom_id,'second-'||f.tag||'@example.invalid','Second label',r.removed_at,
    r.removed_student_id,r.removed_enrollment_id,r.removed_enrolled_at,r.retained_manual_attendance_marks,
    r.retained_attendance_participant_active from group_cleanup_fixture f join public.classroom_roster r on r.id=f.first_roster;

create function pg_temp.group_cleanup_discover(actor uuid,course uuid,subject uuid default null,cursor uuid default null,snapshot text default null)
returns jsonb language plpgsql as $f$
declare result jsonb;
begin
  set local role service_role;
  result:=public.discover_retained_student_cleanup_groups(actor,course,subject,cursor,true,snapshot);
  reset role;
  return result;
end;
$f$;
create function pg_temp.group_cleanup_advance(action text) returns jsonb language plpgsql as $f$
declare f record; result jsonb;
begin
  select * into f from group_cleanup_fixture;
  set local role service_role;
  result:=public.advance_removed_student_academic_cleanup(f.operation,f.owner,f.classroom,f.student,f.generation,action);
  reset role;
  return result;
end;
$f$;
-- Role transition is inside each wrapper; it is not a grant of private SQL authority.
grant select on group_cleanup_fixture to service_role;
-- A separate synthetic classroom supplies101 real retained learner groups,
-- crossing the exact RPC page size without involving a provider/mapping.
create temp table group_cleanup_pages as select gen_random_uuid() classroom;
create temp table group_cleanup_page_learners as
  select gen_random_uuid() student,gen_random_uuid() generation,gen_random_uuid() roster
    from generate_series(1,101);
insert into public.users(id,email,role)
  select student,'page-'||replace(student::text,'-','')||'@example.invalid','student' from group_cleanup_page_learners;
insert into public.classrooms(id,teacher_id,title,class_code)
  select pages.classroom,f.owner,'Pagination239 '||f.tag,'gp239_'||left(f.tag,8)
    from group_cleanup_pages pages cross join group_cleanup_fixture f;
-- Register synthetic removed generations explicitly through installed168;
-- the unchanged roster AFTER INSERT trigger must agree with the same scope.
select private.register_pal_membership(learner.generation,pages.classroom,learner.student,'removed')
  from group_cleanup_page_learners learner cross join group_cleanup_pages pages;
insert into public.classroom_roster(id,classroom_id,email,removed_at,removed_student_id,removed_enrollment_id,
  removed_enrolled_at,retained_manual_attendance_marks,retained_attendance_participant_active)
  select learner.roster,pages.classroom,'page-'||replace(learner.student::text,'-','')||'@example.invalid',
    '2026-10-01T16:00:00Z',learner.student,learner.generation,'2026-10-01T15:00:00Z','{}',false
    from group_cleanup_page_learners learner cross join group_cleanup_pages pages;
do $pagination$
declare f record; course uuid; first_page jsonb; second_page jsonb; terminal jsonb; cursor uuid;
  before_state jsonb; retained public.classroom_roster;
begin
  select * into f from group_cleanup_fixture;
  select classroom into course from group_cleanup_pages;
  if (select count(*) from group_cleanup_page_learners learner
      join private.pal_membership_generations generation on generation.generation_id=learner.generation
        and generation.state='removed'
        and generation.scope_digest=private.pal_membership_scope(course,learner.student)
      join public.classroom_roster roster on roster.id=learner.roster and roster.classroom_id=course
        and roster.removed_student_id=learner.student and roster.removed_enrollment_id=learner.generation
      join public.classroom_roster_student_bindings binding on binding.roster_id=roster.id
        and binding.classroom_id=course and binding.student_id=learner.student)<>101 then
    raise exception 'Synthetic retained page generations differ'; end if;
  first_page:=pg_temp.group_cleanup_discover(f.owner,course);
  if first_page->>'target_count'<>'100' or jsonb_array_length(first_page->'targets')<>100
    or first_page->>'next_student_id' is distinct from first_page->'targets'->99->>'student_id' then
    raise exception 'First100-group page/count/cursor differs'; end if;
  cursor:=(first_page->>'next_student_id')::uuid;
  second_page:=pg_temp.group_cleanup_discover(f.owner,course,null,cursor,first_page->>'snapshot_sha256');
  if second_page->>'target_count'<>'1' or jsonb_array_length(second_page->'targets')<>1
    or second_page->'next_student_id'<>'null'::jsonb
    or (second_page->'targets'->0->>'student_id')::uuid<=cursor
    or second_page->>'snapshot_sha256' is distinct from first_page->>'snapshot_sha256' then
    raise exception '101st retained group omitted or repeated'; end if;
  terminal:=pg_temp.group_cleanup_discover(f.owner,course,null,
    (second_page->'targets'->0->>'student_id')::uuid,first_page->>'snapshot_sha256');
  if terminal->>'target_count'<>'0' or terminal->'targets'<>'[]'::jsonb
    or terminal->'next_student_id'<>'null'::jsonb then raise exception 'Empty terminal page differs'; end if;
  before_state:=pg_temp.group_cleanup_fingerprint();
  begin
    perform pg_temp.group_cleanup_discover(f.owner,course,null,gen_random_uuid(),first_page->>'snapshot_sha256');
    raise exception using errcode='ZX999',message='Unknown continuation cursor accepted';
  exception when sqlstate '22023' then if sqlerrm<>'retained_roster_cleanup_cursor_invalid' then raise; end if; end;
  begin
    perform pg_temp.group_cleanup_discover(f.owner,course,null,cursor,repeat('b',64));
    raise exception using errcode='ZX999',message='Wrong snapshot accepted';
  exception when sqlstate '40001' then if sqlerrm<>'retained_roster_cleanup_discovery_changed' then raise; end if; end;
  begin
    update public.classrooms set teacher_id=f.peer where id=course;
    if not exists(select 1 from public.classrooms where id=course and teacher_id=f.peer) then
      raise exception using errcode='ZX999',message='Owner change was suppressed'; end if;
    perform pg_temp.group_cleanup_discover(f.owner,course,null,cursor,first_page->>'snapshot_sha256');
    raise exception using errcode='ZX999',message='Owner changed between pages accepted';
  exception when sqlstate '42501' then null; end;
  if before_state is distinct from pg_temp.group_cleanup_fingerprint() then raise exception 'Ownership rejection did not restore rows'; end if;
  select * into strict retained from public.classroom_roster where classroom_id=course order by id limit 1;
  begin
    insert into public.classroom_roster(classroom_id,email,removed_at,removed_student_id,removed_enrollment_id,
      removed_enrolled_at,retained_manual_attendance_marks,retained_attendance_participant_active)
      values(course,'changed-'||f.tag||'@example.invalid',retained.removed_at+interval '1 second',
        retained.removed_student_id,retained.removed_enrollment_id,retained.removed_enrolled_at,'{}',false);
    perform pg_temp.group_cleanup_discover(f.owner,course,null,cursor,first_page->>'snapshot_sha256');
    raise exception using errcode='ZX999',message='Retained group changed between pages accepted';
  exception when sqlstate '40001' then if sqlerrm<>'retained_roster_cleanup_discovery_changed' then raise; end if; end;
  if before_state is distinct from pg_temp.group_cleanup_fingerprint() then raise exception 'Snapshot rejection did not restore rows'; end if;
end;
$pagination$;
do $groups$
declare f record; result jsonb; before_state jsonb; cursor uuid;
begin
  select * into f from group_cleanup_fixture;
  result:=pg_temp.group_cleanup_discover(f.owner,f.classroom);
  if result->>'target_count'<>'1' or result->'targets'->0->>'student_id'<>f.student::text
    or result->'targets'->0->>'generation_id'<>f.generation::text
    or result->'targets'->0->>'operation_id' is not null then raise exception 'Coherent group discovery failed'; end if;
  before_state:=pg_temp.group_cleanup_fingerprint();
  begin
    perform pg_temp.group_cleanup_discover(f.peer,f.classroom);
    raise exception using errcode='ZX999',message='Nonowner discovery accepted';
  exception when sqlstate '42501' then null; end;
  if before_state is distinct from pg_temp.group_cleanup_fingerprint() then raise exception 'Rejected discovery mutated rows'; end if;
  -- Incoherent duplicates are inserted only in exception subtransactions;
  -- successful rejection must restore their exact global pre-state.
  begin
    insert into public.classroom_roster(classroom_id,email,removed_at,removed_student_id,removed_enrollment_id,
      removed_enrolled_at,retained_manual_attendance_marks,retained_attendance_participant_active)
      select classroom_id,'conflict-'||f.tag||'@example.invalid',removed_at+interval '1 second',removed_student_id,
        removed_enrollment_id,removed_enrolled_at,retained_manual_attendance_marks,retained_attendance_participant_active
        from public.classroom_roster where id=f.first_roster;
    perform pg_temp.group_cleanup_discover(f.owner,f.classroom);
    raise exception using errcode='ZX999',message='Contradictory retained timestamps accepted';
  exception when sqlstate '55000' then if sqlerrm<>'retained_roster_cleanup_group_invalid' then raise; end if; end;
  begin
    delete from public.classroom_roster_student_bindings where roster_id=f.second_roster;
    perform pg_temp.group_cleanup_discover(f.owner,f.classroom);
    raise exception using errcode='ZX999',message='Missing stable binding accepted';
  exception when sqlstate '55000' then if sqlerrm<>'retained_roster_cleanup_group_invalid' then raise; end if; end;
  begin
    insert into public.classroom_roster(classroom_id,email,removed_at,removed_student_id,removed_enrollment_id,
      removed_enrolled_at,retained_manual_attendance_marks)
      values(f.classroom,'self-'||f.tag||'@example.invalid',clock_timestamp(),f.owner,gen_random_uuid(),clock_timestamp(),'{}');
    perform pg_temp.group_cleanup_discover(f.owner,f.classroom,f.owner);
    raise exception using errcode='ZX999',message='Current owner historical self-membership accepted';
  exception when sqlstate '55000' then if sqlerrm<>'retained_roster_cleanup_group_invalid' then raise; end if; end;
  if before_state is distinct from pg_temp.group_cleanup_fingerprint() then raise exception 'Incoherent group rejection changed global rows'; end if;
  -- Empty terminal pages must still authorize current owner.
  result:=pg_temp.group_cleanup_discover(f.owner,f.classroom,null,f.student,result->>'snapshot_sha256');
  if result->>'target_count'<>'0' then raise exception 'Terminal page is not exact'; end if;
  update public.users set role='student' where id=f.owner;
  result:=pg_temp.group_cleanup_discover(f.owner,f.classroom);
  if result->>'target_count'<>'1' then raise exception 'Student-labelled current owner discovery rejected'; end if;
  begin
    perform private.retained_roster_cleanup_group(f.student,f.classroom,f.student,f.generation);
    raise exception using errcode='ZX999',message='Former owner accepted';
  exception when sqlstate '42501' then null; end;
  perform pg_temp.group_cleanup_advance('live_reserve');
  -- Both copies of retained marks must be inventoried.
  perform pg_temp.group_cleanup_advance('inventory');
  if (select count(*) from public.student_purge_resources where operation_id=f.operation
      and table_name='retained_manual_attendance_marks')<>2 then raise exception 'Retained mark copy omitted'; end if;
end;
$groups$;

-- Faults execute only for our random fixture scope; each rejected finalization
-- compares complete global rows before/after its exception subtransaction.
create function pg_temp.group_cleanup_fault_trigger() returns trigger language plpgsql security definer set search_path='' as $f$
declare mode text; f record; v_old jsonb; v_new jsonb;
begin
  v_old:=to_jsonb(old); v_new:=to_jsonb(new);
  select fault.mode into mode from pg_temp.group_cleanup_fault fault;
  select * into f from pg_temp.group_cleanup_fixture;
  if tg_table_name='classroom_roster' and tg_op='DELETE' and (v_old->>'id')::uuid=f.second_roster and mode='suppress_second_roster' then return null; end if;
  if tg_table_name='classroom_roster' and tg_op='DELETE' and (v_old->>'id')::uuid=f.first_roster and mode='substitute_roster' then
    delete from public.classroom_roster where id=f.peer_roster; return null; end if;
  if tg_table_name='classroom_roster_student_bindings' and (v_old->>'roster_id')::uuid=f.second_roster and mode='suppress_binding' then return null; end if;
  if tg_table_name='attendance_participant_mappings' and (v_old->>'classroom_id')::uuid=f.classroom and mode='suppress_mapping' then return null; end if;
  if tg_table_name='pal_membership_generations' and (v_old->>'generation_id')::uuid=f.generation and mode='suppress_generation' then return old; end if;
  if tg_table_name='student_purge_operations' and (v_old->>'id')::uuid=f.operation and v_new->>'status'='completed' and mode='suppress_completion' then return old; end if;
  if tg_table_name='student_purge_fences' and (v_old->>'operation_id')::uuid=f.operation and mode='suppress_fence' then return null; end if;
  return case when tg_op='DELETE' then old else new end;
end;
$f$;
create trigger z239_fault_roster before delete on public.classroom_roster for each row execute function pg_temp.group_cleanup_fault_trigger();
create trigger z239_fault_binding before delete on public.classroom_roster_student_bindings for each row execute function pg_temp.group_cleanup_fault_trigger();
create trigger z239_fault_mapping before delete on public.attendance_participant_mappings for each row execute function pg_temp.group_cleanup_fault_trigger();
create trigger z239_fault_generation before update on private.pal_membership_generations for each row execute function pg_temp.group_cleanup_fault_trigger();
create trigger z239_fault_completion before update on public.student_purge_operations for each row execute function pg_temp.group_cleanup_fault_trigger();
create trigger z239_fault_fence before delete on public.student_purge_fences for each row execute function pg_temp.group_cleanup_fault_trigger();
create function pg_temp.group_cleanup_late_write() returns trigger language plpgsql security definer set search_path='' as $f$
declare mode text; f record;
begin
  select fault.mode into mode from pg_temp.group_cleanup_fault fault;
  select * into f from pg_temp.group_cleanup_fixture;
  if old.operation_id=f.operation and mode='late_binding' then
    insert into public.classroom_roster_student_bindings(roster_id,classroom_id,student_id)
      values(f.peer_roster,f.classroom,f.student);
  elsif old.operation_id=f.operation and mode='late_retained_roster' then
    insert into public.classroom_roster(classroom_id,email,removed_at,removed_student_id,removed_enrollment_id,
      removed_enrolled_at,retained_manual_attendance_marks)
      values(f.classroom,'late-'||f.tag||'@example.invalid',clock_timestamp(),f.student,f.generation,clock_timestamp(),'{}');
  end if;
  return old;
end;
$f$;
create trigger z239_late_fence after delete on public.student_purge_fences for each row execute function pg_temp.group_cleanup_late_write();

do $completion$
declare f record; saved jsonb; result jsonb; receipt jsonb; before_state jsonb; v_mode text;
begin
  select * into f from group_cleanup_fixture;
  saved:=public.get_student_provider_cleanup(f.operation,f.owner,f.classroom,f.student,f.generation);
  receipt:=jsonb_build_object('schema_version',2,'policy','pika-live-v1','historical_backups','excluded',
    'backup_retention','not_attested','operation_id',f.operation,'learner_id',saved->>'pal_reference',
    'status','completed','begun_at','2026-10-01T15:00:00.000Z','completed_at','2026-10-01T15:01:00.000Z');
  perform public.record_student_provider_cleanup_receipt(f.operation,f.owner,f.classroom,f.student,f.generation,'pal',receipt);
  receipt:=jsonb_build_object('schema_version',1,'ok',true,'installation_ref',saved->>'installation_ref',
    'roster_ref',saved->>'roster_ref','participant_ref',saved->>'participant_ref',
    'operation_ref','erase_participant_'||replace(f.operation::text,'-',''),'state','deleted','absence_verified',true,'deleted_count',0);
  perform public.record_student_provider_cleanup_receipt(f.operation,f.owner,f.classroom,f.student,f.generation,'bara',receipt);
  result:=pg_temp.group_cleanup_advance('claim');
  if result->>'local_status'<>'local_completed' then raise exception 'Group local cleanup incomplete'; end if;
  if exists(select 1 from public.classroom_roster where id in (f.first_roster,f.second_roster)
      and retained_manual_attendance_marks<>'{}'::jsonb) then raise exception 'Retained marks copy survived'; end if;
  foreach v_mode in array array['suppress_second_roster','substitute_roster','suppress_binding','suppress_mapping',
    'suppress_generation','suppress_completion','suppress_fence','late_binding','late_retained_roster'] loop
    update group_cleanup_fault set mode=v_mode;
    before_state:=pg_temp.group_cleanup_fingerprint();
    begin
      perform pg_temp.group_cleanup_advance('live_complete');
      raise exception using errcode='ZX999',message='Fault finalization unexpectedly succeeded';
    exception when sqlstate '55000' then
      if sqlerrm not in ('student_live_roster_changed','student_live_mapping_changed','student_live_generation_changed',
        'student_live_completion_changed','student_live_fence_changed','pal_membership_generation_closed') then raise; end if;
    end;
    if before_state is distinct from pg_temp.group_cleanup_fingerprint() then raise exception 'Fault finalization changed global persisted rows'; end if;
  end loop;
  update group_cleanup_fault set mode='none';
  -- A caller-set legacy GUC cannot bypass the provider-bound retained/binding fence.
  perform set_config('pika.student_purge_finalize','on',true);
  before_state:=pg_temp.group_cleanup_fingerprint();
  begin
    delete from public.classroom_roster_student_bindings where roster_id=f.second_roster;
    raise exception using errcode='ZX999',message='Binding bypass accepted';
  exception when sqlstate '55000' then if sqlerrm<>'student_purge_active' then raise; end if; end;
  begin
    update public.classroom_roster_student_bindings set student_id=f.peer where roster_id=f.second_roster;
    raise exception using errcode='ZX999',message='Binding OLD identity bypass accepted';
  exception when sqlstate '55000' then if sqlerrm<>'student_purge_active' then raise; end if; end;
  begin
    insert into public.classroom_roster_student_bindings(roster_id,classroom_id,student_id)
      values(f.peer_roster,f.classroom,f.peer);
    update public.classroom_roster_student_bindings set student_id=f.student where roster_id=f.peer_roster;
    raise exception using errcode='ZX999',message='Binding NEW identity bypass accepted';
  exception when sqlstate '55000' then if sqlerrm<>'student_purge_active' then raise; end if; end;
  begin
    update public.classroom_roster set removed_student_id=f.peer where id=f.second_roster;
    raise exception using errcode='ZX999',message='Roster OLD identity bypass accepted';
  exception when sqlstate '55000' then if sqlerrm<>'student_class_data_pending_purge' then raise; end if; end;
  -- The existing final-roster guard sorts first and must retain its deny contract.
  -- Transactional rename orders the independent new guard first for this one
  -- additional assertion, with every guard enabled and metadata restored below.
  alter trigger guard_retained_roster_cleanup_identity on public.classroom_roster
    rename to a_group_cleanup_proof_retained_identity;
  begin
    update public.classroom_roster set removed_student_id=f.peer where id=f.second_roster;
    raise exception using errcode='ZX999',message='Roster OLD independent identity bypass accepted';
  exception when sqlstate '55000' then if sqlerrm<>'student_purge_active' then raise; end if; end;
  alter trigger a_group_cleanup_proof_retained_identity on public.classroom_roster
    rename to guard_retained_roster_cleanup_identity;
  begin
    update public.classroom_roster set removed_at=clock_timestamp(),removed_student_id=f.student,
      removed_enrollment_id=f.generation,removed_enrolled_at=clock_timestamp(),
      retained_manual_attendance_marks='{}' where id=f.peer_roster;
    raise exception using errcode='ZX999',message='Roster NEW identity bypass accepted';
  exception when sqlstate '55000' then if sqlerrm<>'student_purge_active' then raise; end if; end;
  begin
    insert into public.classroom_roster(classroom_id,email,removed_at,removed_student_id,removed_enrollment_id,
      removed_enrolled_at,retained_manual_attendance_marks)
      values(f.classroom,'unbound-'||f.tag||'@example.invalid',clock_timestamp(),f.student,f.generation,clock_timestamp(),'{}');
    raise exception using errcode='ZX999',message='Unbound retained bypass accepted';
  exception when sqlstate '55000' then if sqlerrm<>'student_purge_active' then raise; end if; end;
  if before_state is distinct from pg_temp.group_cleanup_fingerprint() then
    raise exception 'Identity fence rejection changed global persisted rows'; end if;
  perform set_config('pika.student_purge_finalize','off',true);
  result:=pg_temp.group_cleanup_advance('live_complete');
  if result->>'status'<>'completed' or result<>pg_temp.group_cleanup_advance('live_complete') then raise exception 'Completion replay changed'; end if;
  if exists(select 1 from public.classroom_roster where id in (f.first_roster,f.second_roster))
    or exists(select 1 from public.classroom_roster_student_bindings where classroom_id=f.classroom and student_id=f.student)
    or exists(select 1 from public.student_purge_fences where operation_id=f.operation)
    or not exists(select 1 from public.classroom_roster where id=f.peer_roster)
    or not exists(select 1 from private.pal_membership_generations where generation_id=f.generation and state='purged' and scope_digest is null)
    or exists(select 1 from private.removed_academic_mutations where transaction_id=txid_current()) then raise exception 'Exact group completion residue'; end if;
  begin
    perform private.register_pal_membership(f.generation,f.classroom,f.student,'active');
    raise exception using errcode='ZX999',message='Old generation reopened';
  exception when sqlstate '55000' then if sqlerrm<>'pal_membership_generation_closed' then raise; end if; end;
end;
$completion$;

-- SQL metadata only: replace the callback inside this rollback with a local
-- counter before opening automatic admission. No provider or network executes.
create temp table group_cleanup_kicks(source text not null);
create or replace function private.kick_removed_student_cleanup(p_source text)
returns bigint language plpgsql security definer set search_path='' as $f$
begin
  insert into pg_temp.group_cleanup_kicks(source) values(p_source);
  return null;
end;
$f$;
create temp table group_cleanup_queue as select gen_random_uuid() classroom,
  f.peer student,gen_random_uuid() quarantine_student,gen_random_uuid() ineligible_student,
  gen_random_uuid() generation,gen_random_uuid() quarantine_generation,gen_random_uuid() ineligible_generation,
  gen_random_uuid() first_roster,gen_random_uuid() second_roster,
  gen_random_uuid() quarantine_roster,gen_random_uuid() ineligible_roster
  from group_cleanup_fixture f;
insert into public.users(id,email,role)
  select quarantine_student,'quarantine-'||replace(quarantine_student::text,'-','')||'@example.invalid','student'
    from group_cleanup_queue union all
  select ineligible_student,'ineligible-'||replace(ineligible_student::text,'-','')||'@example.invalid','student'
    from group_cleanup_queue;
insert into public.classrooms(id,teacher_id,title,class_code)
  select queue.classroom,f.owner,'Queue239 '||f.tag,'gq239_'||left(f.tag,8)
    from group_cleanup_queue queue cross join group_cleanup_fixture f;
insert into public.classroom_enrollments(id,classroom_id,student_id,created_at)
  select generation,classroom,student,clock_timestamp() from group_cleanup_queue union all
  select quarantine_generation,classroom,quarantine_student,clock_timestamp() from group_cleanup_queue union all
  select ineligible_generation,classroom,ineligible_student,clock_timestamp()-interval '2 hours' from group_cleanup_queue;
insert into public.classroom_roster(id,classroom_id,email)
  select first_roster,queue.classroom,student.email from group_cleanup_queue queue join public.users student on student.id=queue.student union all
  select second_roster,queue.classroom,upper(student.email) from group_cleanup_queue queue join public.users student on student.id=queue.student union all
  select quarantine_roster,queue.classroom,student.email from group_cleanup_queue queue join public.users student on student.id=queue.quarantine_student union all
  select ineligible_roster,queue.classroom,student.email from group_cleanup_queue queue join public.users student on student.id=queue.ineligible_student;
insert into public.attendance_roster_mappings(classroom_id) select classroom from group_cleanup_queue;
insert into public.attendance_participant_mappings(classroom_id,student_id) select classroom,student from group_cleanup_queue;
update private.student_provider_cleanup_settings set automatic_enabled=true where singleton;
do $queue$
declare f record; q record; v_removed_at timestamptz:=clock_timestamp(); actual integer; ids uuid[];
begin
  select * into f from group_cleanup_fixture;
  select * into q from group_cleanup_queue;
  -- Synthetic future writer state, not an invocation or widening of236.
  -- The shared generation transitions through installed168 only once.
  update public.classroom_roster roster set removed_at=v_removed_at,
    removed_student_id=enrollment.student_id,removed_enrollment_id=enrollment.id,
    removed_enrolled_at=enrollment.created_at,retained_manual_attendance_marks='{}',
    retained_attendance_participant_active=case when enrollment.student_id=q.student then true else null end
    from public.classroom_enrollments enrollment
    where roster.classroom_id=q.classroom and enrollment.classroom_id=q.classroom
      and enrollment.student_id=(select student_id from public.classroom_roster_student_bindings where roster_id=roster.id);
  get diagnostics actual=row_count;
  if actual<>4 then raise exception 'Queue synthetic roster fixture differs'; end if;
  delete from public.classroom_enrollments where classroom_id=q.classroom;
  get diagnostics actual=row_count;
  if actual<>3 then raise exception 'Queue synthetic enrollment deletion differs'; end if;
  update public.attendance_participant_mappings set active=false
    where classroom_id=q.classroom and student_id=q.student and active;
  get diagnostics actual=row_count;
  if actual<>1 then raise exception 'Queue synthetic mapping transition differs'; end if;
  ids:=private.retained_roster_cleanup_group(f.owner,q.classroom,q.student,q.generation);
  if cardinality(ids)<>2 or not(q.first_roster=any(ids) and q.second_roster=any(ids))
    or (select count(*) from private.removed_student_cleanup_jobs where classroom_id=q.classroom)<>2
    or (select count(*) from private.removed_student_cleanup_jobs where classroom_id=q.classroom
      and student_id=q.student and generation_id=q.generation and status='queued' and last_error_code is null)<>1
    or exists(select 1 from private.removed_student_cleanup_jobs where generation_id=q.ineligible_generation)
    or (select count(*) from private.removed_student_cleanup_jobs where classroom_id=q.classroom
      and student_id=q.quarantine_student and generation_id=q.quarantine_generation
      and status='quarantined' and last_error_code='cleanup_eligibility_missing' and quarantined_at is not null)<>1
    or (select count(*) from pg_temp.group_cleanup_kicks)<>1
    or (select source from pg_temp.group_cleanup_kicks)<>'removal' then
    raise exception 'Group removal must insert one generation job and attempt one callback'; end if;
end;
$queue$;
rollback;
do $teardown$
declare baseline record;
begin
  select * into baseline from group_cleanup_baseline;
  if baseline.rows is distinct from pg_temp.group_cleanup_fingerprint()
    or baseline.membership_contract is distinct from pg_temp.group_cleanup_membership_contract()
    or baseline.kick_callback is distinct from pg_get_functiondef('private.kick_removed_student_cleanup(text)'::regprocedure)
    or baseline.singleton_index is distinct from pg_get_indexdef('public.classroom_roster_one_removed_membership_per_student'::regclass)
    or baseline.generation_guard is distinct from pg_get_functiondef('private.guard_pal_membership_evidence()'::regprocedure)
    or baseline.registration_guard is distinct from pg_get_functiondef('private.register_pal_membership(uuid,uuid,uuid,text)'::regprocedure)
    or exists(select 1 from pg_trigger where tgname like 'z239_%') then raise exception 'Group cleanup global teardown differs'; end if;
end;
$teardown$;
\echo PASS retained roster group cleanup SQL and exact rollback teardown
