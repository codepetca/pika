-- Slice A: consumer compatibility only. Migration164 singleton index and236
-- duplicate-removal rejection remain installed. Apply before the app deployment;
-- older app versions retain singleton discovery until upgraded. Missing RPC is503.
begin;
set local lock_timeout='5s';

-- Exact transaction-scoped deletion sets, not another identity or work queue.
alter table private.removed_academic_mutations
  add column retained_roster_ids uuid[],
  add column retained_binding_roster_ids uuid[];

create function private.retained_roster_cleanup_group(
  p_teacher_id uuid,p_classroom_id uuid,p_student_id uuid,p_generation_id uuid
) returns uuid[] language plpgsql volatile security definer set search_path='' as $$
declare v_ids uuid[]; v_first public.classroom_roster; v_generation private.pal_membership_generations;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='55000',message='academic_cleanup_isolation_required';
  end if;
  perform private.try_lock_classroom_membership_change(p_classroom_id,p_student_id);
  perform 1 from public.classrooms where id=p_classroom_id and teacher_id=p_teacher_id for share;
  if not found then raise exception using errcode='42501',message='student_provider_cleanup_forbidden'; end if;
  -- Ownership takes precedence even for a historical self-enrollment.
  if p_student_id=p_teacher_id or p_generation_id is null
    or exists(select 1 from public.classroom_enrollments where classroom_id=p_classroom_id and student_id=p_student_id) then
    raise exception using errcode='55000',message='retained_roster_cleanup_group_invalid';
  end if;
  perform 1 from public.classroom_roster where classroom_id=p_classroom_id
    and removed_student_id=p_student_id order by id for update;
  select array_agg(id order by id) into v_ids from public.classroom_roster
    where classroom_id=p_classroom_id and removed_student_id=p_student_id;
  if coalesce(cardinality(v_ids),0)=0 then
    raise exception using errcode='55000',message='retained_roster_cleanup_group_invalid';
  end if;
  select * into strict v_first from public.classroom_roster where id=v_ids[1];
  perform 1 from public.classroom_roster_student_bindings
    where roster_id=any(v_ids) or (classroom_id=p_classroom_id and student_id=p_student_id)
    order by roster_id for update;
  if exists(select 1 from public.classroom_roster roster
      left join public.classroom_roster_student_bindings binding on binding.roster_id=roster.id
      where roster.id=any(v_ids) and (roster.removed_at is null
        or roster.removed_enrollment_id is distinct from p_generation_id
        or roster.removed_enrolled_at is null or roster.retained_manual_attendance_marks is null
        or (roster.removed_enrolled_at,roster.removed_at,roster.retained_attendance_participant_active)
          is distinct from (v_first.removed_enrolled_at,v_first.removed_at,v_first.retained_attendance_participant_active)
        or roster.retained_manual_attendance_marks is distinct from v_first.retained_manual_attendance_marks
        or binding.classroom_id is distinct from p_classroom_id
        or binding.student_id is distinct from p_student_id))
    or exists(select 1 from public.classroom_roster_student_bindings binding
      where binding.classroom_id=p_classroom_id and binding.student_id=p_student_id
        and not (binding.roster_id=any(v_ids))) then
    raise exception using errcode='55000',message='retained_roster_cleanup_group_invalid';
  end if;
  select * into v_generation from private.pal_membership_generations
    where generation_id=p_generation_id for update;
  if not found or v_generation.state is distinct from 'removed'
    or v_generation.scope_digest is distinct from private.pal_membership_scope(p_classroom_id,p_student_id) then
    raise exception using errcode='55000',message='retained_roster_cleanup_group_invalid';
  end if;
  return v_ids;
end;
$$;
revoke all on function private.retained_roster_cleanup_group(uuid,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;

-- This guard checks OLD and NEW provider-bound identities before the legacy GUC path.
-- Nonprovider purge semantics remain under123/173; the retained ID fence below
-- closes unfenced retained inserts for those operations without changing finalization.
-- Binding cascades are allowed only for the exact snapshotted live-finalize set.
create function private.guard_retained_roster_cleanup_identity()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_row jsonb; v_rows jsonb[]; v_classroom uuid; v_student uuid; v_roster uuid; v_identity record;
begin
  v_rows:=case when tg_op='INSERT' then array[to_jsonb(new)]
    when tg_op='DELETE' then array[to_jsonb(old)] else array[to_jsonb(old),to_jsonb(new)] end;
  if tg_op='DELETE' and exists(
    select 1 from private.removed_academic_mutations capability
    join public.student_purge_operations operation on operation.id=capability.operation_id
    join private.student_provider_cleanup_bindings provider on provider.operation_id=operation.id
    where capability.transaction_id=txid_current() and capability.action='live_finalize'
      and provider.pal_schema_version=2 and provider.pal_policy='pika-live-v1'
      and operation.status='provider_pending'
      and operation.classroom_id=(to_jsonb(old)->>'classroom_id')::uuid
      and operation.student_id=(case when tg_table_name='classroom_roster'
        then to_jsonb(old)->>'removed_student_id' else to_jsonb(old)->>'student_id' end)::uuid
      and (case when tg_table_name='classroom_roster'
        then (to_jsonb(old)->>'id')::uuid=any(capability.retained_roster_ids)
          and (to_jsonb(old)->>'removed_enrollment_id')::uuid=provider.generation_id
        else (to_jsonb(old)->>'roster_id')::uuid=any(capability.retained_binding_roster_ids) end)
  ) then return old; end if;
  if tg_table_name='classroom_roster' and tg_op='UPDATE'
    and private.removed_academic_delete_allowed(tg_table_name,to_jsonb(old),to_jsonb(new)) then return new; end if;
  foreach v_row in array v_rows loop
    v_classroom:=(v_row->>'classroom_id')::uuid;
    v_roster:=(case when tg_table_name='classroom_roster' then v_row->>'id' else v_row->>'roster_id' end)::uuid;
    perform private.try_lock_classroom_membership_change(v_classroom);
    for v_identity in
      select distinct classroom_id,student_id from (
        select v_classroom classroom_id,(v_row->>'removed_student_id')::uuid student_id
        union all select v_classroom,(v_row->>'student_id')::uuid
        union all select classroom_id,student_id from public.classroom_roster_student_bindings where roster_id=v_roster
        union all select classroom_id,removed_student_id from public.classroom_roster where id=v_roster
      ) identities where student_id is not null order by classroom_id,student_id
    loop
      v_student:=v_identity.student_id;
      perform private.try_lock_classroom_membership_change(v_identity.classroom_id,v_student);
      perform public.student_purge_lock(v_identity.classroom_id,v_student);
      if exists(select 1 from public.student_purge_fences fence
        join private.student_provider_cleanup_bindings provider on provider.operation_id=fence.operation_id
        where fence.classroom_id=v_identity.classroom_id and fence.student_id=v_student) then
        raise exception using errcode='55000',message='student_purge_active';
      end if;
    end loop;
  end loop;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
revoke all on function private.guard_retained_roster_cleanup_identity()
  from public,anon,authenticated,service_role;
create trigger guard_retained_roster_cleanup_identity
  before insert or update or delete on public.classroom_roster
  for each row execute function private.guard_retained_roster_cleanup_identity();
create trigger guard_retained_roster_cleanup_binding
  before insert or update or delete on public.classroom_roster_student_bindings
  for each row execute function private.guard_retained_roster_cleanup_identity();

-- Preserve173 resource guard verbatim except independently fence retained identity
-- before the unchanged binding/email resolution. Neither identity can mask the other.
create or replace function public.reject_student_resource_change_during_purge()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb;
  v_rows jsonb[] := case when tg_op = 'INSERT' then array[to_jsonb(new)]
    when tg_op = 'DELETE' then array[to_jsonb(old)] else array[to_jsonb(old), to_jsonb(new)] end;
  v_classroom_id uuid;
  v_student_id uuid;
  v_parent_id uuid;
begin
  if tg_op='DELETE' and private.removed_academic_delete_allowed(tg_table_name,to_jsonb(old)) then return old; end if;
  if tg_table_name='classroom_roster' and tg_op='UPDATE'
    and private.removed_academic_delete_allowed(tg_table_name,to_jsonb(old),to_jsonb(new)) then return new; end if;
  if current_setting('pika.student_purge_finalize', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  foreach v_row in array v_rows loop
    v_classroom_id := null;
    v_student_id := nullif(coalesce(v_row->>'student_id', v_row->>'user_id'), '')::uuid;
    v_parent_id := null;
    if tg_table_name in ('entries', 'classroom_enrollments') then
      v_classroom_id := nullif(v_row->>'classroom_id', '')::uuid;
    elsif tg_table_name = 'classroom_roster' then
      v_classroom_id := nullif(v_row->>'classroom_id', '')::uuid;
      v_student_id := nullif(v_row->>'removed_student_id', '')::uuid;
      if v_student_id is not null then
        perform public.student_purge_lock(v_classroom_id,v_student_id);
        if exists(select 1 from public.student_purge_fences
            where classroom_id=v_classroom_id and student_id=v_student_id) then
          raise exception using errcode='55000',message='student_purge_active';
        end if;
      end if;
      select binding.student_id into v_student_id
      from public.classroom_roster_student_bindings binding
      where binding.roster_id = nullif(v_row->>'id', '')::uuid;
      if v_student_id is null then
        select enrollment.student_id into v_student_id
        from public.classroom_enrollments enrollment
        join public.users student on student.id = enrollment.student_id and student.role = 'student'
        where enrollment.classroom_id = v_classroom_id
          and lower(btrim(student.email)) = lower(btrim(v_row->>'email'))
        order by enrollment.created_at, enrollment.id limit 1;
      end if;
    elsif tg_table_name = 'managed_storage_objects' then
      if tg_op <> 'DELETE' and nullif(v_row->>'storage_path', '') is not null and exists (
        select 1 from public.student_purge_objects purge_object
        where purge_object.storage_bucket = v_row->>'storage_bucket'
          and purge_object.storage_path_sha256 = public.managed_storage_identity_sha256(
            v_row->>'storage_bucket', v_row->>'storage_path')
      ) then raise exception using errcode = '55000', message = 'student_purge_path_reserved'; end if;
      v_classroom_id := nullif(v_row->>'classroom_id', '')::uuid;
      if v_classroom_id is null then
        select target_classroom_id into v_classroom_id from public.managed_storage_provisional_owners
        where id = nullif(v_row->>'provisional_owner_id', '')::uuid;
      end if;
      v_student_id := nullif(coalesce(v_row->>'data_subject_user_id',
        case when v_row->>'purpose' in ('student_assignment_artifact', 'student_inline_image')
          then v_row->>'created_by_user_id' end), '')::uuid;
    elsif tg_table_name in ('assignment_docs', 'assignment_feedback_entries', 'assignment_repo_review_results',
        'assignment_repo_targets', 'assignment_ai_grading_run_items') then
      v_parent_id := nullif(v_row->>'assignment_id', '')::uuid;
      select classroom_id into v_classroom_id from public.assignments where id = v_parent_id;
    elsif tg_table_name = 'assignment_submission_artifacts' then
      select assignment.classroom_id into v_classroom_id from public.assignment_docs doc
        join public.assignments assignment on assignment.id = doc.assignment_id
        where doc.id = nullif(v_row->>'assignment_doc_id', '')::uuid;
    elsif tg_table_name in ('test_attempts', 'test_responses', 'test_focus_events',
        'test_student_availability', 'test_ai_grading_run_items') then
      v_parent_id := nullif(v_row->>'test_id', '')::uuid;
      select classroom_id into v_classroom_id from public.tests where id = v_parent_id;
    elsif tg_table_name = 'survey_responses' then
      select classroom_id into v_classroom_id from public.surveys where id = nullif(v_row->>'survey_id', '')::uuid;
    elsif tg_table_name = 'announcement_reads' then
      select classroom_id into v_classroom_id from public.announcements where id = nullif(v_row->>'announcement_id', '')::uuid;
    elsif tg_table_name = 'report_card_rows' then
      select classroom_id into v_classroom_id from public.report_cards where id = nullif(v_row->>'report_card_id', '')::uuid;
    elsif tg_table_name in ('pal_event_outbox', 'pal_daily_log_week_configurations') then
      perform pg_advisory_xact_lock(hashtextextended('pika-student-purge-subject:' || v_student_id::text, 0));
      if exists (select 1 from public.student_purge_fences where student_id = v_student_id) then
        raise exception using errcode = '55000', message = 'student_purge_active';
      end if;
      continue;
    end if;
    if v_classroom_id is not null and v_student_id is not null then
      perform public.student_purge_lock(v_classroom_id, v_student_id);
      if exists (select 1 from public.student_purge_fences
        where classroom_id = v_classroom_id and student_id = v_student_id)
      then raise exception using errcode = '55000', message = 'student_purge_active'; end if;
    end if;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Preserve173 unchanged except replacing its exact-one check with coherent group authorization.
create or replace function private.authorize_removed_academic_cleanup(
  p_operation_id uuid,p_teacher_id uuid,p_classroom_id uuid,p_student_id uuid,p_generation_id uuid
) returns public.student_purge_operations
language plpgsql security definer set search_path = '' as $$
declare v_op public.student_purge_operations;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='55000',message='academic_cleanup_isolation_required';
  end if;
  perform private.try_lock_classroom_membership_change(p_classroom_id,p_student_id);
  if not coalesce((select enabled from private.removed_student_academic_settings where singleton for share),false) then
    raise exception using errcode='55000',message='academic_cleanup_disabled';
  end if;
  perform public.authorize_student_provider_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
  select * into strict v_op from public.student_purge_operations where id=p_operation_id for update;
  perform 1 from public.classrooms where id=p_classroom_id and teacher_id=p_teacher_id for share;
  if not found then raise exception using errcode='42501',message='academic_cleanup_binding_invalid'; end if;
  perform private.retained_roster_cleanup_group(p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
  return v_op;
end;
$$;

-- Preserve175 reservation policy/role/cutoff checks; add complete group validation.
create or replace function private.reserve_live_student_cleanup(
  p_operation_id uuid,p_teacher_id uuid,p_classroom_id uuid,p_student_id uuid,p_generation_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_settings private.student_provider_cleanup_settings;
  v_generation private.pal_membership_generations;
  v_existing public.student_purge_operations;
  v_binding private.student_provider_cleanup_bindings;
  v_scope text;
  v_participant text; v_roster text; v_actor text;
begin
  if p_operation_id is null or p_generation_id is null or p_teacher_id is null
    or p_classroom_id is null or p_student_id is null then
    raise exception using errcode='22023',message='invalid_provider_cleanup_request';
  end if;
  perform private.try_lock_classroom_membership_change(p_classroom_id,p_student_id);
  select * into v_settings from private.student_provider_cleanup_settings where singleton for share;
  if not coalesce(v_settings.enabled,false) then raise exception using errcode='55000',message='student_provider_cleanup_disabled'; end if;
  v_scope:=private.pal_membership_scope(p_classroom_id,p_student_id);
  select * into v_existing from public.student_purge_operations where id=p_operation_id for update;
  if found then
    select * into v_binding from private.student_provider_cleanup_bindings where operation_id=p_operation_id;
    if v_existing.teacher_id is distinct from p_teacher_id or v_existing.classroom_id is distinct from p_classroom_id
      or (v_existing.status<>'completed' and v_existing.student_id is distinct from p_student_id) or v_binding.generation_id is distinct from p_generation_id
      or v_binding.scope_digest is distinct from v_scope or v_binding.pal_schema_version is distinct from 2 then
      raise exception using errcode='55000',message='student_provider_binding_conflict';
    end if;
    if v_existing.status<>'completed' then
      perform private.retained_roster_cleanup_group(p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
    end if;
    return public.get_student_provider_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
  end if;
  if not coalesce((select live_enabled from private.student_provider_cleanup_settings where singleton for share),false) then
    raise exception using errcode='55000',message='student_live_cleanup_disabled';
  end if;
  if not exists(select 1 from public.classrooms where id=p_classroom_id and teacher_id=p_teacher_id)
    or not exists(select 1 from public.users where id=p_student_id and role='student') then
    raise exception using errcode='42501',message='student_provider_cleanup_forbidden';
  end if;
  perform private.try_lock_classroom_membership_change(p_classroom_id,p_student_id);
  if not exists(select 1 from public.classroom_roster where classroom_id=p_classroom_id
    and removed_student_id=p_student_id and removed_enrollment_id=p_generation_id
    and removed_at >= v_settings.eligible_after)
    or exists(select 1 from public.classroom_enrollments where classroom_id=p_classroom_id and student_id=p_student_id) then
    raise exception using errcode='55000',message='student_provider_removed_generation_required';
  end if;
  select * into v_generation from private.pal_membership_generations where generation_id=p_generation_id for update;
  if not found or v_generation.state<>'removed' or v_generation.scope_digest<>v_scope then
    raise exception using errcode='55000',message='student_provider_removed_generation_required';
  end if;
  perform private.retained_roster_cleanup_group(p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
  perform public.guard_classroom_purge_lifecycle(p_classroom_id);
  if public.classroom_purge_conflict(p_classroom_id) is not null
    or exists(select 1 from public.classroom_cold_tombstones where classroom_id=p_classroom_id)
    or exists(select 1 from public.classroom_archive_operations where classroom_id=p_classroom_id
      and status<>'completed' and (status<>'failed' or coalesce(retryable,false)))
    or exists(select 1 from public.student_purge_fences where classroom_id=p_classroom_id) then
    raise exception using errcode='55000',message='student_provider_operation_conflict';
  end if;
  -- A whole-class copy cannot be erased to settle an individual prerequisite.
  if exists(select 1 from public.managed_storage_objects object
      left join public.managed_storage_provisional_owners provisional on provisional.id=object.provisional_owner_id
      where (object.classroom_id=p_classroom_id or provisional.target_classroom_id=p_classroom_id)
        and (object.purpose in ('classroom_archive','gradex_extract') and not (
          exists(select 1 from public.classroom_archives archive join public.classroom_archive_operations operation
            on operation.id=archive.operation_id and operation.status='completed' where archive.managed_object_id=object.id)
          or exists(select 1 from public.classroom_gradex_extracts artifact join public.classroom_archive_operations operation
            on operation.id=artifact.operation_id and operation.status='completed' where artifact.managed_object_id=object.id))))
    or exists(select 1 from public.managed_storage_provisional_owners
      where target_classroom_id=p_classroom_id and adopted_at is null) then
    raise exception using errcode='55000',message='student_provider_copy_policy_required';
  end if;
  select mapping.participant_ref into v_participant from public.attendance_participant_mappings mapping
    join private.attendance_membership_generations generation on generation.participant_ref=mapping.participant_ref
    where mapping.classroom_id=p_classroom_id and mapping.student_id=p_student_id and not mapping.active
      and generation.generation_id=p_generation_id and generation.scope_digest=v_scope;
  select roster_ref into v_roster from public.attendance_roster_mappings where classroom_id=p_classroom_id;
  select principal_ref into v_actor from public.attendance_principal_mappings where user_id=p_teacher_id;
  if v_participant is null or v_roster is null or v_actor is null then
    raise exception using errcode='55000',message='student_provider_mapping_unverified';
  end if;
  insert into private.student_provider_cleanup_bindings(operation_id,generation_id,scope_digest,pal_reference,
    pal_origin,pal_integration_id,bara_origin,installation_ref,roster_ref,participant_ref,actor_principal_ref,pal_schema_version,pal_policy)
    values(p_operation_id,p_generation_id,v_scope,v_generation.pal_reference,v_settings.pal_origin,
      v_settings.pal_integration_id,v_settings.bara_origin,v_settings.installation_ref,v_roster,v_participant,v_actor,2,'pika-live-v1');
  insert into public.student_purge_operations(id,teacher_id,classroom_id,student_id,student_binding_sha256,
    request_sha256,status,source_revision) values(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,
      encode(extensions.digest(p_operation_id::text||':'||p_student_id::text,'sha256'),'hex'),
      encode(extensions.digest('provider-v1:'||p_operation_id::text||':'||p_generation_id::text||':'||v_scope,'sha256'),'hex'),
      'provider_pending',1);
  insert into public.student_purge_fences(classroom_id,student_id,operation_id,teacher_id)
    values(p_classroom_id,p_student_id,p_operation_id,p_teacher_id);
  return public.get_student_provider_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
end;
$$;

-- Preserve177 readiness and immutable provider policy; add complete group validation.
create or replace function public.authorize_student_provider_cleanup(
  p_operation_id uuid,p_teacher_id uuid,p_classroom_id uuid,p_student_id uuid,p_generation_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_op jsonb; v_settings private.student_provider_cleanup_settings;
begin
  v_op:=public.get_student_provider_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
  select * into v_settings from private.student_provider_cleanup_settings where singleton for share;
  if (v_op->>'pal_schema_version'='2' and not v_settings.live_enabled)
    or not coalesce(v_settings.enabled,false) or v_settings.pal_origin is distinct from v_op->>'pal_origin'
    or v_settings.pal_integration_id::text is distinct from v_op->>'pal_integration_id'
    or v_settings.bara_origin is distinct from v_op->>'bara_origin'
    or v_settings.installation_ref is distinct from v_op->>'installation_ref' then
    raise exception using errcode='55000',message='student_provider_cleanup_disabled';
  end if;
  if v_op->>'pal_schema_version'='2' then
    perform 1 from private.removed_student_academic_settings
      where singleton and enabled for share;
    if not found then
      raise exception using errcode='55000',message='student_live_cleanup_prerequisite_paused';
    end if;
    perform 1 from public.managed_storage_settings
      where singleton and mode='enforced' for share;
    if not found then
      raise exception using errcode='55000',message='student_live_cleanup_prerequisite_paused';
    end if;
  end if;
  if exists(select 1 from public.classroom_enrollments where classroom_id=p_classroom_id and student_id=p_student_id)
    or not exists(select 1 from private.pal_membership_generations where generation_id=p_generation_id and state='removed') then
    raise exception using errcode='55000',message='student_provider_removed_generation_required';
  end if;
  perform private.retained_roster_cleanup_group(p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
  return v_op;
end;
$$;

-- Preserve175 delivery redaction; require exact local deletion and completion.
create or replace function private.complete_live_student_cleanup(
  p_operation_id uuid,p_teacher_id uuid,p_classroom_id uuid,p_student_id uuid,p_generation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_op public.student_purge_operations; v_binding private.student_provider_cleanup_bindings; v_read jsonb;
  v_roster_ids uuid[]; v_binding_ids uuid[]; v_count integer;
  v_generation private.pal_membership_generations; v_mapping public.attendance_participant_mappings;
  v_completed public.student_purge_operations; v_fence jsonb; v_now timestamptz;
begin
  v_read:=public.get_student_provider_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
  select * into strict v_binding from private.student_provider_cleanup_bindings where operation_id=p_operation_id;
  if v_binding.pal_schema_version<>2 or v_binding.pal_policy<>'pika-live-v1' then
    raise exception using errcode='55000',message='student_live_policy_required';
  end if;
  if v_read->>'status'='completed' then return v_read; end if;
  if not coalesce((select live_enabled from private.student_provider_cleanup_settings where singleton for share),false) then
    raise exception using errcode='55000',message='student_live_cleanup_disabled';
  end if;
  v_op:=private.authorize_removed_academic_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
  perform public.lock_managed_storage_protocol();
  if v_op.local_academic_cleanup->>'status' is distinct from 'local_completed'
    or cardinality(private.removed_academic_blockers(p_operation_id))<>0
    or private.live_student_attendance_blockers(p_operation_id)
    or exists(select 1 from private.removed_academic_resources(p_classroom_id,p_student_id))
    or exists(select 1 from private.removed_academic_objects(p_classroom_id,p_student_id))
    or exists(select 1 from public.student_purge_objects where operation_id=p_operation_id and status<>'deleted')
    or exists(select 1 from storage.objects stored join public.student_purge_objects staged
      on staged.storage_bucket=stored.bucket_id and staged.storage_path_sha256=
        public.managed_storage_identity_sha256(stored.bucket_id,stored.name) where staged.operation_id=p_operation_id) then
    raise exception using errcode='55000',message='student_live_absence_unverified';
  end if;
  v_roster_ids:=private.retained_roster_cleanup_group(p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
  select array_agg(roster_id order by roster_id) into v_binding_ids
    from public.classroom_roster_student_bindings where roster_id=any(v_roster_ids);
  select * into strict v_generation from private.pal_membership_generations where generation_id=p_generation_id for update;
  select * into strict v_mapping from public.attendance_participant_mappings
    where classroom_id=p_classroom_id and student_id=p_student_id
      and participant_ref=v_binding.participant_ref and not active for update;
  select to_jsonb(fence) into strict v_fence from public.student_purge_fences fence
    where operation_id=p_operation_id and teacher_id=p_teacher_id and classroom_id=p_classroom_id and student_id=p_student_id for update;
  insert into private.removed_academic_mutations(transaction_id,operation_id,action,retained_roster_ids,retained_binding_roster_ids)
    values(txid_current(),p_operation_id,'live_finalize',v_roster_ids,v_binding_ids);
  -- Delivery rows are live retained payloads, not backups. Preserve classmates in
  -- mixed snapshots and their shared acknowledgement. Replays stay superseded.
  update public.attendance_integration_outbox outbox set payload=jsonb_set(payload,'{participants}',
    coalesce((select jsonb_agg(participant order by ordinal) from jsonb_array_elements(payload->'participants')
      with ordinality parts(participant,ordinal) where participant->>'participant_ref'<>v_binding.participant_ref),'[]'::jsonb)),
    status='superseded',lease_token=null,lease_expires_at=null
    where classroom_id=p_classroom_id and message_type='roster.snapshot'
      and exists(select 1 from jsonb_array_elements(payload->'participants') participant
        where participant->>'participant_ref'=v_binding.participant_ref);
  delete from public.attendance_integration_outbox where classroom_id=p_classroom_id
    and message_type='check_in.invalidate' and payload->>'participant_ref'=v_binding.participant_ref;
  delete from public.attendance_integration_inbox where classroom_id=p_classroom_id
    and event_type in ('attendance.check_in.accepted','attendance.check_in.invalidated')
    and payload->'metadata'->>'participant_ref'=v_binding.participant_ref;
  delete from public.pal_event_outbox outbox using private.pal_membership_outbox binding
    where outbox.id=binding.outbox_id and binding.generation_id=p_generation_id
      and binding.classroom_id=p_classroom_id and binding.student_id=p_student_id;
  delete from private.pal_membership_week_configurations where generation_id=p_generation_id;
  if exists(select 1 from public.attendance_integration_inbox where classroom_id=p_classroom_id
      and private.attendance_payload_targets_participant(p_classroom_id,payload,v_binding.participant_ref))
    or exists(select 1 from public.attendance_integration_outbox where classroom_id=p_classroom_id
      and private.attendance_payload_targets_participant(p_classroom_id,payload,v_binding.participant_ref))
    or exists(select 1 from public.pal_event_outbox outbox join private.pal_membership_outbox binding
      on binding.outbox_id=outbox.id where binding.generation_id=p_generation_id) then
    raise exception using errcode='55000',message='student_live_delivery_absence_unverified';
  end if;
  delete from public.attendance_participant_mappings where classroom_id=p_classroom_id and student_id=p_student_id
    and participant_ref=v_binding.participant_ref and not active and to_jsonb(attendance_participant_mappings)=to_jsonb(v_mapping);
  get diagnostics v_count=row_count;
  if v_count<>1 or exists(select 1 from public.attendance_participant_mappings
    where (classroom_id=p_classroom_id and student_id=p_student_id) or participant_ref=v_binding.participant_ref) then
    raise exception using errcode='55000',message='student_live_mapping_changed';
  end if;
  delete from public.classroom_roster_student_bindings where roster_id=any(v_binding_ids)
    and classroom_id=p_classroom_id and student_id=p_student_id;
  get diagnostics v_count=row_count;
  if v_count<>cardinality(v_binding_ids)
    or exists(select 1 from public.classroom_roster_student_bindings where roster_id=any(v_binding_ids)) then
    raise exception using errcode='55000',message='student_live_roster_changed';
  end if;
  delete from public.classroom_roster where id=any(v_roster_ids) and classroom_id=p_classroom_id
    and removed_student_id=p_student_id and removed_enrollment_id=p_generation_id and removed_at is not null;
  get diagnostics v_count=row_count;
  if v_count<>cardinality(v_roster_ids)
    or exists(select 1 from public.classroom_roster where id=any(v_roster_ids)
      or (classroom_id=p_classroom_id and removed_student_id=p_student_id))
    or exists(select 1 from public.classroom_roster_student_bindings where roster_id=any(v_binding_ids)
      or (classroom_id=p_classroom_id and student_id=p_student_id)) then
    raise exception using errcode='55000',message='student_live_roster_changed';
  end if;
  update private.pal_membership_generations set state='purged',scope_digest=null
    where generation_id=p_generation_id and to_jsonb(pal_membership_generations)=to_jsonb(v_generation);
  get diagnostics v_count=row_count;
  if v_count<>1 or not exists(select 1 from private.pal_membership_generations generation
      where generation_id=p_generation_id and to_jsonb(generation)=
        (to_jsonb(v_generation)||jsonb_build_object('state','purged','scope_digest',null))) then
    raise exception using errcode='55000',message='student_live_generation_changed';
  end if;
  -- Preserve public completion privacy and immutable private scope replay.
  v_now:=clock_timestamp();
  update public.student_purge_operations set status='completed',student_id=null,student_email=null,
    completed_at=v_now,updated_at=v_now where id=p_operation_id and to_jsonb(student_purge_operations)=to_jsonb(v_op)
    returning * into v_completed;
  get diagnostics v_count=row_count;
  if v_count<>1 or to_jsonb(v_completed) is distinct from (to_jsonb(v_op)||jsonb_build_object(
    'status','completed','student_id',null,'student_email',null,'completed_at',v_now,'updated_at',v_now)) then
    raise exception using errcode='55000',message='student_live_completion_changed';
  end if;
  delete from public.student_purge_fences where operation_id=p_operation_id and to_jsonb(student_purge_fences)=v_fence;
  get diagnostics v_count=row_count;
  if v_count<>1 or exists(select 1 from public.student_purge_fences where operation_id=p_operation_id
      or (classroom_id=p_classroom_id and student_id=p_student_id)) then
    raise exception using errcode='55000',message='student_live_fence_changed';
  end if;
  delete from private.removed_academic_mutations where transaction_id=txid_current()
    and operation_id=p_operation_id and action='live_finalize'
    and retained_roster_ids=v_roster_ids and retained_binding_roster_ids=v_binding_ids;
  get diagnostics v_count=row_count;
  if v_count<>1 or exists(select 1 from private.removed_academic_mutations where transaction_id=txid_current()) then
    raise exception using errcode='55000',message='student_live_capability_changed';
  end if;
  -- Recheck persisted completion after all DELETE triggers have finished.
  if not exists(select 1 from public.student_purge_operations operation
      where id=p_operation_id and to_jsonb(operation)=to_jsonb(v_completed))
    or exists(select 1 from public.classroom_roster where id=any(v_roster_ids)
      or (classroom_id=p_classroom_id and removed_student_id=p_student_id))
    or exists(select 1 from public.classroom_roster_student_bindings where roster_id=any(v_binding_ids)
      or (classroom_id=p_classroom_id and student_id=p_student_id))
    or exists(select 1 from public.attendance_participant_mappings
      where (classroom_id=p_classroom_id and student_id=p_student_id) or participant_ref=v_binding.participant_ref)
    or not exists(select 1 from private.pal_membership_generations generation
      where generation_id=p_generation_id and to_jsonb(generation)=
        (to_jsonb(v_generation)||jsonb_build_object('state','purged','scope_digest',null)))
    or exists(select 1 from public.student_purge_fences where operation_id=p_operation_id
      or (classroom_id=p_classroom_id and student_id=p_student_id)) then
    raise exception using errcode='55000',message='student_live_completion_changed';
  end if;
  return public.get_student_provider_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
end;
$$;

-- Preserve179 mapping repair, eligibility and quarantine; kick only a first insert.
create or replace function private.enqueue_removed_student_cleanup()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_settings private.student_provider_cleanup_settings;
  v_teacher_id uuid;
  v_scope text;
  v_participant_ref text;
  v_ready boolean;
  v_inserted integer;
begin
  if old.removed_at is not null or new.removed_at is null
    or new.removed_student_id is null or new.removed_enrollment_id is null then
    return new;
  end if;

  select teacher_id into v_teacher_id
  from public.classrooms
  where id=new.classroom_id;
  if v_teacher_id is null then return new; end if;

  -- Serialize admission with rollout/cutoff changes. Historical generations
  -- remain outside the queue because they have no exact Pal generation proof.
  select * into v_settings
  from private.student_provider_cleanup_settings
  where singleton
  for update;
  if not coalesce(v_settings.enabled,false)
    or not coalesce(v_settings.live_enabled,false)
    or not coalesce(v_settings.automatic_enabled,false)
    or v_settings.eligible_after is null
    or new.removed_at<v_settings.eligible_after
    or new.removed_enrolled_at is null
    or new.removed_enrolled_at<v_settings.eligible_after then
    return new;
  end if;

  v_scope:=private.pal_membership_scope(new.classroom_id,new.removed_student_id);
  if not exists(
    select 1 from private.pal_membership_generations membership
    where membership.generation_id=new.removed_enrollment_id
      and membership.scope_digest=v_scope
      and membership.state in ('active','removed')
  ) then
    return new;
  end if;

  -- A participant mapping may predate automatic cleanup activation even when
  -- the exact enrollment generation is eligible. Reconstruct only from the
  -- still-active, primary-key-bound classroom/student mapping while the removal
  -- transaction holds the membership lock.
  select participant_ref into v_participant_ref
  from public.attendance_participant_mappings
  where classroom_id=new.classroom_id
    and student_id=new.removed_student_id
    and active;

  if v_participant_ref is not null then
    insert into private.attendance_membership_generations(
      generation_id,participant_ref,scope_digest)
    values(new.removed_enrollment_id,v_participant_ref,v_scope)
    on conflict do nothing;
  end if;

  v_ready:=exists(
    select 1
    from private.attendance_membership_generations attendance
    join public.attendance_participant_mappings participant
      on participant.participant_ref=attendance.participant_ref
      and participant.classroom_id=new.classroom_id
      and participant.student_id=new.removed_student_id
      and participant.active
    join public.attendance_roster_mappings roster
      on roster.classroom_id=new.classroom_id
    join public.attendance_principal_mappings actor
      on actor.user_id=v_teacher_id
    where attendance.generation_id=new.removed_enrollment_id
      and attendance.scope_digest=v_scope
  );

  insert into private.removed_student_cleanup_jobs(
    operation_id,teacher_id,classroom_id,student_id,generation_id,
    status,last_error_code,quarantined_at)
  values(
    gen_random_uuid(),v_teacher_id,new.classroom_id,new.removed_student_id,
    new.removed_enrollment_id,
    case when v_ready then 'queued' else 'quarantined' end,
    case when v_ready then null else 'cleanup_eligibility_missing' end,
    case when v_ready then null else clock_timestamp() end)
  on conflict(generation_id) do nothing;

  get diagnostics v_inserted=row_count;
  if v_ready and v_inserted=1 then
    perform private.kick_removed_student_cleanup('removal');
  end if;
  return new;
end;
$$;

-- Page-safe server discovery: each page proves current owner and coherent groups.
-- Labels choose the smallest roster UUID only AFTER the whole generation agrees.
create function public.discover_retained_student_cleanup_groups(
  p_teacher_id uuid,p_classroom_id uuid,p_student_id uuid default null,
  p_after_student_id uuid default null,p_include_unreserved boolean default false,p_snapshot_sha256 text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_students uuid[]; v_student uuid; v_roster_ids uuid[]; v_roster public.classroom_roster;
  v_operation uuid; v_operation_count integer; v_targets jsonb:='[]'::jsonb;
  v_next uuid; v_index integer:=0; v_binding private.student_provider_cleanup_bindings; v_snapshot text;
begin
  if p_teacher_id is null or p_classroom_id is null or p_include_unreserved is null
    or (p_student_id is not null and p_after_student_id is not null)
    or (p_after_student_id is not null and p_snapshot_sha256 is null)
    or (p_snapshot_sha256 is not null and p_snapshot_sha256 !~ '^[a-f0-9]{64}$') then
    raise exception using errcode='22023',message='invalid_provider_cleanup_request';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='55000',message='academic_cleanup_isolation_required';
  end if;
  perform private.try_lock_classroom_membership_change(p_classroom_id);
  perform 1 from public.classrooms where id=p_classroom_id and teacher_id=p_teacher_id for share;
  if not found then raise exception using errcode='42501',message='student_provider_cleanup_forbidden'; end if;
  -- Keyset pages must describe one exact discovery snapshot. New rows before the
  -- cursor, deleted rows, binding changes and completed operations invalidate it.
  select encode(extensions.digest(jsonb_build_object(
    'roster',(select coalesce(jsonb_agg(to_jsonb(roster) order by id),'[]'::jsonb)
      from public.classroom_roster roster where classroom_id=p_classroom_id),
    'bindings',(select coalesce(jsonb_agg(to_jsonb(binding) order by roster_id),'[]'::jsonb)
      from public.classroom_roster_student_bindings binding where classroom_id=p_classroom_id),
    'operations',(select coalesce(jsonb_agg(to_jsonb(operation) order by id),'[]'::jsonb)
      from public.student_purge_operations operation where classroom_id=p_classroom_id),
    'provider_bindings',(select coalesce(jsonb_agg(to_jsonb(binding) order by binding.operation_id),'[]'::jsonb)
      from private.student_provider_cleanup_bindings binding join public.student_purge_operations operation
        on operation.id=binding.operation_id where operation.classroom_id=p_classroom_id),
    'fences',(select coalesce(jsonb_agg(to_jsonb(fence) order by operation_id),'[]'::jsonb)
      from public.student_purge_fences fence where classroom_id=p_classroom_id),
    'generations',(select coalesce(jsonb_agg(to_jsonb(generation) order by generation_id),'[]'::jsonb)
      from private.pal_membership_generations generation where scope_digest in (
        select private.pal_membership_scope(p_classroom_id,removed_student_id)
          from public.classroom_roster where classroom_id=p_classroom_id and removed_at is not null))
    )::text,'sha256'),'hex') into v_snapshot;
  if p_snapshot_sha256 is not null and p_snapshot_sha256 is distinct from v_snapshot then
    raise exception using errcode='40001',message='retained_roster_cleanup_discovery_changed';
  end if;
  if p_after_student_id is not null and not exists(
    select 1 from public.classroom_roster roster where roster.classroom_id=p_classroom_id
      and roster.removed_student_id=p_after_student_id and roster.removed_at is not null
      and (p_include_unreserved or exists(select 1 from public.student_purge_operations operation
        where operation.teacher_id=p_teacher_id and operation.classroom_id=p_classroom_id
          and operation.student_id=p_after_student_id and operation.status='provider_pending'))) then
    raise exception using errcode='22023',message='retained_roster_cleanup_cursor_invalid';
  end if;
  select array_agg(student_id order by student_id) into v_students from (
    select distinct roster.removed_student_id student_id from public.classroom_roster roster
      where roster.classroom_id=p_classroom_id and roster.removed_at is not null
        and (p_student_id is null or roster.removed_student_id=p_student_id)
        and (p_after_student_id is null or roster.removed_student_id>p_after_student_id)
        and (p_student_id is not null or p_include_unreserved or exists(
          select 1 from public.student_purge_operations operation where operation.teacher_id=p_teacher_id
            and operation.classroom_id=p_classroom_id and operation.student_id=roster.removed_student_id
            and operation.status='provider_pending'))
      order by student_id limit 101
  ) candidates;
  foreach v_student in array coalesce(v_students,array[]::uuid[]) loop
    v_index:=v_index+1;
    if v_index>100 then v_next:=v_students[100]; exit; end if;
    select * into strict v_roster from public.classroom_roster where classroom_id=p_classroom_id
      and removed_student_id=v_student and removed_at is not null order by id limit 1;
    v_roster_ids:=private.retained_roster_cleanup_group(p_teacher_id,p_classroom_id,v_student,v_roster.removed_enrollment_id);
    select * into strict v_roster from public.classroom_roster where id=v_roster_ids[1];
    select count(*), (array_agg(id order by id))[1] into v_operation_count,v_operation
      from public.student_purge_operations where classroom_id=p_classroom_id and student_id=v_student and status<>'completed';
    if v_operation_count>1 then
      raise exception using errcode='55000',message='retained_roster_cleanup_group_invalid';
    end if;
    if v_operation is not null then
      select * into v_binding from private.student_provider_cleanup_bindings where operation_id=v_operation;
      if not found or v_binding.generation_id is distinct from v_roster.removed_enrollment_id
        or v_binding.scope_digest is distinct from private.pal_membership_scope(p_classroom_id,v_student)
        or not exists(select 1 from public.student_purge_operations where id=v_operation
          and teacher_id=p_teacher_id and classroom_id=p_classroom_id and student_id=v_student and status='provider_pending')
        or not exists(select 1 from public.student_purge_fences where operation_id=v_operation
          and teacher_id=p_teacher_id and classroom_id=p_classroom_id and student_id=v_student) then
        raise exception using errcode='55000',message='retained_roster_cleanup_group_invalid';
      end if;
    end if;
    v_targets:=v_targets||jsonb_build_array(jsonb_build_object('student_id',v_student,
      'generation_id',v_roster.removed_enrollment_id,'operation_id',v_operation,
      'operation_status',case when v_operation is not null then 'provider_pending' end,'email',v_roster.email,
      'name',coalesce(nullif(concat_ws(' ',nullif(v_roster.first_name,''),nullif(v_roster.last_name,'')),''),v_roster.email)));
  end loop;
  return jsonb_build_object('schema_version',1,'teacher_id',p_teacher_id,'classroom_id',p_classroom_id,
    'student_id',p_student_id,'after_student_id',p_after_student_id,'include_unreserved',p_include_unreserved,
    'targets',v_targets,'target_count',jsonb_array_length(v_targets),'next_student_id',v_next,'snapshot_sha256',v_snapshot);
end;
$$;
revoke all on function public.discover_retained_student_cleanup_groups(uuid,uuid,uuid,uuid,boolean,text)
  from public,anon,authenticated,service_role;
grant execute on function public.discover_retained_student_cleanup_groups(uuid,uuid,uuid,uuid,boolean,text)
  to service_role;
commit;
