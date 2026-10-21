-- Relationship-based LIVE removed-membership cleanup only.
-- Strict-v1 reservation, duplicate-removal closure and every rollout setting stay unchanged.
begin;
set local lock_timeout='5s';

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
        join public.users student on student.id = enrollment.student_id
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
  if not exists(select 1 from public.classrooms where id=p_classroom_id and teacher_id=p_teacher_id) then
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
  -- Exact removed enrollment/generation/scope and complete retained bindings,
  -- including current-owner exclusion, authorize the live subject; never users.role.
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

revoke all on function private.reserve_live_student_cleanup(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
alter function private.reserve_live_student_cleanup(uuid,uuid,uuid,uuid,uuid) owner to postgres;
alter function public.reject_student_resource_change_during_purge() owner to postgres;
commit;
