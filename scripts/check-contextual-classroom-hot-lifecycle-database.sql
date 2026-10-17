-- Root-run rollback-only contracts. Requires reviewed migration 268 installed.
-- Authoring this proof does not authorize executing it or installing a migration.
begin;
set local statement_timeout = '45s';
set local lock_timeout = '3s';

do $installed$ begin
  if to_regprocedure('public.set_classroom_hot_archive_for_owner_v1(uuid,uuid,boolean)') is null then
    raise exception 'Reviewed hot lifecycle RPC is not installed';
  end if;
  if has_function_privilege('anon','public.set_classroom_hot_archive_for_owner_v1(uuid,uuid,boolean)','execute')
    or has_function_privilege('authenticated','public.set_classroom_hot_archive_for_owner_v1(uuid,uuid,boolean)','execute')
    or not has_function_privilege('service_role','public.set_classroom_hot_archive_for_owner_v1(uuid,uuid,boolean)','execute')
    or exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where p.oid='public.set_classroom_hot_archive_for_owner_v1(uuid,uuid,boolean)'::regprocedure and acl.grantee=0) then
    raise exception 'Hot lifecycle RPC execute privileges differ';
  end if;
  if not exists (select 1 from pg_proc where oid='public.set_classroom_hot_archive_for_owner_v1(uuid,uuid,boolean)'::regprocedure
    and prosecdef and proconfig @> array['search_path=""']) then
    raise exception 'Hot lifecycle RPC definer/search path differ';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.classrooms'::regclass
    and tgname='enforce_classroom_creation_entitlement' and tgenabled='O') then
    raise exception 'Creation entitlement trigger must remain enabled';
  end if;
  if exists (select 1 from unnest(array['update_classrooms_updated_at','bump_classroom_blueprint_source_revision',
      'classroom_archive_revision_from_classroom','attendance_decommission_reactivation']) expected(name)
    where not exists (select 1 from pg_trigger where tgrelid='public.classrooms'::regclass
      and tgname=expected.name and tgenabled='O')) then
    raise exception 'Expected timestamp, Blueprint, archive or decommission trigger differs';
  end if;
end; $installed$;

create temp table hot_fixture(name text primary key, id uuid not null unique default gen_random_uuid());
insert into hot_fixture(name) values ('owner_teacher'),('owner_student'),('member'),('outsider'),
  ('class_a'),('class_b'),('class_top'),('enrollment'),('announcement'),('owner_self_enrollment');
insert into public.users(id,email,role)
  select id,'hot_lifecycle_sql_'||id::text||'@example.invalid',case when name='owner_teacher' then 'teacher' else 'student' end
  from hot_fixture where name in ('owner_teacher','owner_student','member','outsider');
do $default_free$ begin
  -- 206 replaces 181's provisioning body: strict-mode inserts receive a Free
  -- account plan and creation snapshot before hot_grant reads their revision.
  if (select strict_enforcement_enabled from private.classroom_creation_entitlement_settings where singleton)
    and exists (select 1 from hot_fixture f where f.name in ('owner_teacher','owner_student','member','outsider')
      and (not exists(select 1 from public.account_plans p where p.subject_user_id=f.id and p.plan_key='free' and p.revision=1)
        or not exists(select 1 from public.effective_feature_entitlements e where e.subject_user_id=f.id
          and e.feature_key='classrooms.create' and not e.enabled and e.quota_limit=0 and e.revision=1))) then
    raise exception 'Strict-mode fixture did not receive the automatic Free plan and snapshot';
  end if;
end; $default_free$;

create function pg_temp.hot_grant(actor uuid, enabled boolean, starts timestamptz, expires timestamptz, capacity integer)
returns void language plpgsql as $grant$
begin
  perform public.set_effective_feature_entitlement_v1(gen_random_uuid(),actor,'classrooms.create','manual',enabled,
    starts,expires,capacity,'test:hot-lifecycle-sql','hot_lifecycle_contract',
    coalesce((select revision from public.effective_feature_entitlements where subject_user_id=actor and feature_key='classrooms.create'),0));
end; $grant$;
select pg_temp.hot_grant(id,true,clock_timestamp(),null,3) from hot_fixture where name in ('owner_teacher','owner_student');
insert into public.classrooms(id,teacher_id,title,class_code,position,course_overview_markdown,course_outline_markdown)
  select classroom.id,owner.id,'hot_lifecycle_sql_'||classroom.id::text,'hot_lifecycle_sql_'||classroom.id::text,
    case when classroom.name='class_top' then -7 else 4 end,'Preserved overview','Preserved outline'
  from hot_fixture classroom join hot_fixture owner on owner.name=case classroom.name when 'class_b' then 'owner_student' else 'owner_teacher' end
  where classroom.name in ('class_a','class_b','class_top');
insert into public.classroom_enrollments(id,classroom_id,student_id)
  select enrollment.id,classroom.id,member.id from hot_fixture enrollment
  join hot_fixture classroom on classroom.name='class_a' join hot_fixture member on member.name='member'
  where enrollment.name='enrollment';
-- Persisted owner self-enrollment is legal in the current schema, although the
-- ordinary join RPC rejects creating it. Keep every real membership trigger.
insert into public.classroom_enrollments(id,classroom_id,student_id)
  select enrollment.id,classroom.id,owner.id from hot_fixture enrollment
  join hot_fixture classroom on classroom.name='class_a' join hot_fixture owner on owner.name='owner_teacher'
  where enrollment.name='owner_self_enrollment';
insert into public.announcements(id,classroom_id,created_by,content)
  select announcement.id,classroom.id,owner.id,'Preserved announcement' from hot_fixture announcement
  join hot_fixture classroom on classroom.name='class_a' join hot_fixture owner on owner.name='owner_teacher'
  where announcement.name='announcement';

create function pg_temp.hot_content_state() returns jsonb language sql as $content$
  select jsonb_build_object(
    'enrollments',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.classroom_enrollments e join hot_fixture f on f.id=e.classroom_id),'[]'),
    'announcements',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.announcements a join hot_fixture f on f.id=a.classroom_id),'[]'),
    'categories',coalesce((select jsonb_agg(to_jsonb(g) order by g.id) from public.gradebook_categories g join hot_fixture f on f.id=g.classroom_id),'[]'));
$content$;
create function pg_temp.hot_state() returns jsonb language sql as $state$
  select jsonb_build_object('classrooms',coalesce((select jsonb_agg(to_jsonb(c) order by c.id)
    from public.classrooms c join hot_fixture f on f.id=c.id),'[]'),
    'archive',coalesce((select jsonb_agg(to_jsonb(r) order by r.classroom_id)
      from public.classroom_archive_revisions r join hot_fixture f on f.id=r.classroom_id),'[]'),
    'content',pg_temp.hot_content_state(),
    'admission_settings',(select to_jsonb(s) from private.classroom_creation_entitlement_settings s where singleton),
    'entitlements',coalesce((select jsonb_agg(to_jsonb(e) order by e.subject_user_id,e.feature_key)
      from public.effective_feature_entitlements e join hot_fixture f on f.id=e.subject_user_id),'[]'),
    'entitlement_audit',coalesce((select jsonb_agg(to_jsonb(e) order by e.id)
      from public.effective_feature_entitlement_audit e join hot_fixture f on f.id=e.subject_user_id),'[]'),
    'plans',coalesce((select jsonb_agg(to_jsonb(p) order by p.subject_user_id)
      from public.account_plans p join hot_fixture f on f.id=p.subject_user_id),'[]'),
    'plan_audit',coalesce((select jsonb_agg(to_jsonb(p) order by p.id)
      from public.account_plan_audit p join hot_fixture f on f.id=p.subject_user_id),'[]'));
$state$;
create function pg_temp.expect_hot_error(actor uuid,classroom uuid,archived boolean,state text,message text)
returns void language plpgsql as $test$
declare v_before jsonb:=pg_temp.hot_state();v_failed boolean:=false;
begin
  begin
    perform public.set_classroom_hot_archive_for_owner_v1(actor,classroom,archived);
  exception when others then
    if sqlstate is distinct from state or sqlerrm is distinct from message then
      raise exception 'Unexpected hot lifecycle error % %, expected % %',sqlstate,sqlerrm,state,message;
    end if;
    v_failed:=true;
  end;
  if not v_failed then raise exception 'Expected hot lifecycle rejection % %',state,message; end if;
  if v_before is distinct from pg_temp.hot_state() then raise exception 'Hot lifecycle/content/revision state did not roll back'; end if;
end; $test$;
create function pg_temp.expect_hot_success(actor uuid,classroom uuid,archived boolean)
returns void language plpgsql as $success$
declare before_row jsonb;after_row jsonb;result jsonb;before_revision jsonb;after_revision jsonb;
  before_content jsonb:=pg_temp.hot_content_state();expected_position integer;other_rows jsonb;
begin
  select to_jsonb(c) into before_row from public.classrooms c where id=classroom;
  select to_jsonb(r) into before_revision from public.classroom_archive_revisions r where classroom_id=classroom;
  select jsonb_agg(to_jsonb(c) order by c.id) into other_rows from public.classrooms c join hot_fixture f on f.id=c.id where c.id<>classroom;
  select case when archived then (before_row->>'position')::integer else coalesce(min(position),1)-1 end into expected_position
    from public.classrooms where teacher_id=actor and archived_at is null;
  result:=public.set_classroom_hot_archive_for_owner_v1(actor,classroom,archived);
  select to_jsonb(c) into after_row from public.classrooms c where id=classroom;
  select to_jsonb(r) into after_revision from public.classroom_archive_revisions r where classroom_id=classroom;
  if result is distinct from after_row or (select count(*) from jsonb_object_keys(result))<>30
    or (after_row->>'archived_at' is not null) is distinct from archived
    or (after_row->>'position')::integer is distinct from expected_position
    or after_row - array['archived_at','position','updated_at'] is distinct from before_row - array['archived_at','position','updated_at']
    or after_row->'updated_at' is distinct from to_jsonb(transaction_timestamp())
    or after_revision is distinct from (before_revision||jsonb_build_object('revision',(before_revision->>'revision')::bigint+1,'updated_at',transaction_timestamp()))
    or before_content is distinct from pg_temp.hot_content_state()
    or other_rows is distinct from (select jsonb_agg(to_jsonb(c) order by c.id) from public.classrooms c join hot_fixture f on f.id=c.id where c.id<>classroom) then
    raise exception 'Hot lifecycle exact row/projection/revision/content preservation differs';
  end if;
end; $success$;

do $policy$
declare a uuid;b uuid;owner_a uuid;owner_b uuid;member uuid;outsider uuid;boundary timestamptz;before_boundary jsonb;
begin
  select id into a from hot_fixture where name='class_a';select id into b from hot_fixture where name='class_b';
  select id into owner_a from hot_fixture where name='owner_teacher';select id into owner_b from hot_fixture where name='owner_student';
  select id into member from hot_fixture where name='member';select id into outsider from hot_fixture where name='outsider';
  perform pg_temp.expect_hot_error(member,a,true,'PT403','classroom_hot_lifecycle_forbidden');
  perform pg_temp.expect_hot_error(outsider,a,true,'PT403','classroom_hot_lifecycle_forbidden');
  perform pg_temp.expect_hot_error(owner_a,gen_random_uuid(),true,'PT404','classroom_hot_lifecycle_not_found');
  perform pg_temp.expect_hot_error(null,a,true,'PT400','classroom_hot_lifecycle_invalid_patch');
  perform pg_temp.expect_hot_error(owner_a,null,true,'PT400','classroom_hot_lifecycle_invalid_patch');
  perform pg_temp.expect_hot_error(owner_a,a,null,'PT400','classroom_hot_lifecycle_invalid_patch');
  perform pg_temp.expect_hot_error(owner_a,a,false,'PT400','classroom_hot_lifecycle_not_archived');
  -- Both persisted account role values authorize ownership, including restore with no active peers.
  perform pg_temp.expect_hot_success(owner_b,b,true);
  perform pg_temp.expect_hot_error(member,b,false,'PT403','classroom_hot_lifecycle_forbidden');
  perform pg_temp.expect_hot_error(outsider,b,false,'PT403','classroom_hot_lifecycle_forbidden');
  perform pg_temp.expect_hot_error(owner_b,b,true,'PT400','classroom_hot_lifecycle_already_archived');
  perform pg_temp.expect_hot_success(owner_b,b,false);
  -- Archive remains available without a creation grant; restore preserves native admission failures.
  perform pg_temp.hot_grant(owner_a,false,clock_timestamp(),null,0);
  perform pg_temp.expect_hot_success(owner_a,a,true);
  perform pg_temp.expect_hot_error(owner_a,a,false,'42501','classroom_creation_entitlement_disabled');
  perform pg_temp.hot_grant(owner_a,true,clock_timestamp()+interval '1 day',null,3);
  perform pg_temp.expect_hot_error(owner_a,a,false,'42501','classroom_creation_entitlement_not_started');
  perform pg_temp.hot_grant(owner_a,true,clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day',3);
  perform pg_temp.expect_hot_error(owner_a,a,false,'42501','classroom_creation_entitlement_expired');
  -- Pass a fixed instant to the established admission assertion: starts_at is
  -- inclusive and expires_at exclusive, without a clock race or sleep.
  boundary:=clock_timestamp()+interval '1 day';
  perform pg_temp.hot_grant(owner_a,true,boundary,boundary+interval '1 day',3);
  before_boundary:=pg_temp.hot_state();
  begin
    perform public.assert_classroom_creation_allowed_v1(owner_a,a,boundary-interval '1 microsecond');
    raise exception 'Creation admission accepted one microsecond before starts_at';
  exception when insufficient_privilege then
    if sqlerrm<>'classroom_creation_entitlement_not_started' then raise; end if;
  end;
  perform public.assert_classroom_creation_allowed_v1(owner_a,a,boundary);
  perform public.assert_classroom_creation_allowed_v1(owner_a,a,boundary+interval '1 day'-interval '1 microsecond');
  begin
    perform public.assert_classroom_creation_allowed_v1(owner_a,a,boundary+interval '1 day');
    raise exception 'Creation admission accepted exact expires_at';
  exception when insufficient_privilege then
    if sqlerrm<>'classroom_creation_entitlement_expired' then raise; end if;
  end;
  if before_boundary is distinct from pg_temp.hot_state() then raise exception 'Timestamp admission assertion changed persisted state'; end if;
  perform pg_temp.hot_grant(owner_a,true,clock_timestamp(),null,1);
  perform pg_temp.expect_hot_error(owner_a,a,false,'23514','classroom_creation_active_limit_reached');
  -- A deleted managed snapshot fails closed even if global strict enforcement is off.
  delete from public.effective_feature_entitlements where subject_user_id=owner_a and feature_key='classrooms.create';
  perform pg_temp.expect_hot_error(owner_a,a,false,'55000','classroom_creation_entitlement_unavailable');
  perform pg_temp.hot_grant(owner_a,true,clock_timestamp(),null,3);
  perform pg_temp.expect_hot_success(owner_a,a,false);
  -- Maintenance modes must never be accepted by this ordinary hot lifecycle path.
  perform set_config('pika.classroom_archive_restore','on',true);
  perform pg_temp.expect_hot_error(owner_a,a,true,'PT403','classroom_hot_lifecycle_fenced');
  perform set_config('pika.classroom_archive_restore','off',true);
  perform set_config('pika.classroom_archive_compaction','on',true);
  perform pg_temp.expect_hot_error(owner_a,a,true,'PT403','classroom_hot_lifecycle_fenced');
  perform set_config('pika.classroom_archive_compaction','off',true);
end; $policy$;

-- Current ownership, not enrollment or prior ownership, is authoritative.
-- The transfer is a legal ordinary UPDATE under the existing admission trigger;
-- the deliberate subtransaction exception restores the complete fixture.
do $ownership$
declare a uuid;owner_a uuid;owner_b uuid;baseline jsonb;
begin
  select id into a from hot_fixture where name='class_a';
  select id into owner_a from hot_fixture where name='owner_teacher';select id into owner_b from hot_fixture where name='owner_student';
  baseline:=pg_temp.hot_state();
  begin
    perform public.lock_effective_feature_entitlement_v1(owner_b,'classrooms.create');
    perform public.guard_classroom_purge_lifecycle(a);
    update public.classrooms set teacher_id=owner_b where id=a;
    perform pg_temp.expect_hot_error(owner_a,a,true,'PT403','classroom_hot_lifecycle_forbidden');
    perform pg_temp.expect_hot_success(owner_b,a,true);
    perform pg_temp.expect_hot_error(owner_a,a,false,'PT403','classroom_hot_lifecycle_forbidden');
    perform pg_temp.expect_hot_success(owner_b,a,false);
    if not exists(select 1 from public.classroom_enrollments where classroom_id=a and student_id=owner_a) then
      raise exception 'Lifecycle removed the former owner self-enrollment';
    end if;
    raise exception using errcode='ZX001',message='restore transferred ownership fixture';
  exception when sqlstate 'ZX001' then null; end;
  if baseline is distinct from pg_temp.hot_state() then raise exception 'Ownership fixture escaped rollback'; end if;
end; $ownership$;

-- Root-only snapshot corruption fixtures, matching the established entitlement
-- database proof pattern. No triggers or privilege checks are bypassed. Private
-- settings are varied with their complete constrained row shape only inside an
-- aborted subtransaction; this never invokes or claims a real cutover.
do $missing_admission_snapshots$
declare a uuid;owner_a uuid;mode text;baseline jsonb;
begin
  select id into a from hot_fixture where name='class_a';select id into owner_a from hot_fixture where name='owner_teacher';
  foreach mode in array array['legacy_unaudited','legacy_audited','strict_unaudited','strict_audited','settings_missing'] loop
    baseline:=pg_temp.hot_state();
    begin
      if mode like 'legacy_%' then
        update private.classroom_creation_entitlement_settings set strict_enforcement_enabled=false,
          activated_at=null,activation_operation_id=null,activated_by=null where singleton;
      else
        update private.classroom_creation_entitlement_settings set strict_enforcement_enabled=true,
          activated_at=clock_timestamp(),activation_operation_id=gen_random_uuid(),activated_by='test:hot-lifecycle-sql' where singleton;
      end if;
      delete from public.effective_feature_entitlements where subject_user_id=owner_a and feature_key='classrooms.create';
      if mode in ('legacy_unaudited','strict_unaudited') then
        delete from public.effective_feature_entitlement_audit where subject_user_id=owner_a and feature_key='classrooms.create';
      end if;
      if mode='settings_missing' then delete from private.classroom_creation_entitlement_settings where singleton; end if;
      -- Capacity release is available even when the admission snapshot is gone.
      perform pg_temp.expect_hot_success(owner_a,a,true);
      if mode='legacy_unaudited' then
        perform pg_temp.expect_hot_success(owner_a,a,false);
      else
        perform pg_temp.expect_hot_error(owner_a,a,false,'55000','classroom_creation_entitlement_unavailable');
      end if;
      raise exception using errcode='ZX001',message='restore admission snapshot fixture';
    exception when sqlstate 'ZX001' then null; end;
    if baseline is distinct from pg_temp.hot_state() then raise exception 'Admission snapshot fixture escaped rollback: %',mode; end if;
  end loop;
end; $missing_admission_snapshots$;

-- Missing/malformed archive snapshots must reject before writing. Subblocks
-- roll back the proof's own snapshot corruption; constraints stay enabled.
do $snapshots$
declare a uuid;owner_a uuid;
begin
  select id into a from hot_fixture where name='class_a';select id into owner_a from hot_fixture where name='owner_teacher';
  begin
    delete from public.classroom_archive_revisions where classroom_id=a;
    perform pg_temp.expect_hot_error(owner_a,a,true,'PT503','classroom_hot_lifecycle_postcondition_failed');
    raise exception using errcode='ZX001',message='restore test snapshot';
  exception when sqlstate 'ZX001' then null; end;
  begin
    update public.classroom_archive_revisions set revision=9223372036854775807 where classroom_id=a;
    perform pg_temp.expect_hot_error(owner_a,a,true,'PT503','classroom_hot_lifecycle_postcondition_failed');
    raise exception using errcode='ZX001',message='restore test snapshot';
  exception when sqlstate 'ZX001' then null; end;
end; $snapshots$;

-- The actual decommission guard fences both lifecycle directions. Each proof
-- subblock rolls back its own synthetic operation without altering real fences.
do $decommission$
declare a uuid;owner_a uuid;direction boolean;
begin
  select id into a from hot_fixture where name='class_a';select id into owner_a from hot_fixture where name='owner_teacher';
  foreach direction in array array[true,false] loop
    if not direction then perform pg_temp.expect_hot_success(owner_a,a,true); end if;
    begin
      insert into public.attendance_decommission_operations(id,classroom_id,teacher_id,installation_ref,roster_ref,actor_principal_ref)
        values(gen_random_uuid(),a,owner_a,'hot-lifecycle-sql-'||a::text,'hot-lifecycle-sql-'||a::text,'hot-lifecycle-sql-proof');
      perform pg_temp.expect_hot_error(owner_a,a,direction,'PT403','classroom_hot_lifecycle_fenced');
      raise exception using errcode='ZX001',message='restore test fence';
    exception when sqlstate 'ZX001' then null; end;
    if not direction then perform pg_temp.expect_hot_success(owner_a,a,false); end if;
  end loop;
end; $decommission$;

-- Owned rollback-only fault triggers; installed definitions remain intact.
create function pg_temp.hot_fault() returns trigger language plpgsql as $fault$
declare mode text:=current_setting('pika.hot_lifecycle_proof_fault',true);target uuid;transfer uuid;
begin
  select id into target from hot_fixture where name='class_a';
  if new.id<>target or pg_trigger_depth()>1 then return new; end if;
  select id into transfer from hot_fixture where name='outsider';
  if tg_when='BEFORE' then
    if mode='suppress' then return null; end if;
    if mode='before_archive' then new.archived_at:=old.archived_at; end if;
    if mode='before_position' then new.position:=old.position+20; end if;
  else
    if mode='late_owner' then update public.classrooms set teacher_id=transfer where id=target;
    elsif mode='late_title' then update public.classrooms set title='substituted' where id=target;
    elsif mode='late_provenance' then update public.classrooms set source_blueprint_origin='{"tampered":true}' where id=target;
    elsif mode='late_blueprint_revision' then update public.classrooms set blueprint_source_revision=blueprint_source_revision+7 where id=target;
    elsif mode='late_archive_revision' then update public.classroom_archive_revisions set revision=revision+7 where classroom_id=target;
    end if;
  end if;
  return new;
end; $fault$;
create trigger zz_hot_lifecycle_before_fault before update on public.classrooms for each row execute function pg_temp.hot_fault();
create trigger zz_hot_lifecycle_after_fault after update on public.classrooms for each row execute function pg_temp.hot_fault();
do $faults$
declare a uuid;owner_a uuid;outsider uuid;mode text;
begin
  select id into a from hot_fixture where name='class_a';select id into owner_a from hot_fixture where name='owner_teacher';
  select id into outsider from hot_fixture where name='outsider';
  perform pg_temp.hot_grant(outsider,false,clock_timestamp(),null,0);
  foreach mode in array array['suppress','before_archive','before_position','late_owner','late_title','late_provenance','late_blueprint_revision','late_archive_revision'] loop
    perform set_config('pika.hot_lifecycle_proof_fault',mode,true);
    perform pg_temp.expect_hot_error(owner_a,a,true,'PT503','classroom_hot_lifecycle_postcondition_failed');
  end loop;
  perform set_config('pika.hot_lifecycle_proof_fault','off',true);
  perform pg_temp.expect_hot_success(owner_a,a,true);
  foreach mode in array array['suppress','before_archive','before_position','late_title','late_provenance','late_blueprint_revision','late_archive_revision'] loop
    perform set_config('pika.hot_lifecycle_proof_fault',mode,true);
    perform pg_temp.expect_hot_error(owner_a,a,false,'PT503','classroom_hot_lifecycle_postcondition_failed');
  end loop;
  -- On restore, a late owner substitution itself must pass the retained
  -- entitlement trigger. Its native rejection also rolls the entire RPC back.
  perform set_config('pika.hot_lifecycle_proof_fault','late_owner',true);
  perform pg_temp.expect_hot_error(owner_a,a,false,'42501','classroom_creation_entitlement_disabled');
  perform set_config('pika.hot_lifecycle_proof_fault','off',true);
  perform pg_temp.expect_hot_success(owner_a,a,false);
end; $faults$;

select 'PASS hot lifecycle rollback-only owner policy, archive/restore admission, full-row/content/revision preservation and fault rollback';
rollback;
