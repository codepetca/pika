-- Explicit, independently disabled local academic stage of a provider-bound purge.
-- Student+classroom owns data; the exact retained generation authorizes operation.
-- No overall completion, reference rotation, fence release, scheduler or backfill.
begin;
set local lock_timeout = '5s';

create table private.removed_student_academic_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false
);
insert into private.removed_student_academic_settings(singleton) values(true);
alter table private.removed_student_academic_settings enable row level security;
revoke all on private.removed_student_academic_settings from public,anon,authenticated,service_role;

alter table public.student_purge_operations add column local_academic_cleanup jsonb;
alter table public.student_purge_resources add column row_sha256 text
  check(row_sha256 ~ '^[a-f0-9]{64}$');
alter table public.student_purge_objects add column owner_sha256 text
  check(owner_sha256 ~ '^[a-f0-9]{64}$');

-- Internal transaction-scoped mutation capability, never a second work queue.
-- An entry is inserted/deleted within ONE RPC; rollback also removes it.
-- No caller-set GUC is accepted as authorization for this stage.
create table private.removed_academic_mutations (
  transaction_id bigint primary key,
  operation_id uuid not null references public.student_purge_operations(id) on delete restrict,
  action text not null check(action in ('inventory','claim','acknowledge','fail','finalize'))
);
alter table private.removed_academic_mutations enable row level security;
revoke all on private.removed_academic_mutations from public,anon,authenticated,service_role;

create function private.removed_academic_capability(p_operation_id uuid,p_actions text[])
returns boolean language sql volatile security definer set search_path = '' as $$
  select exists(select 1 from private.removed_academic_mutations
    where transaction_id=txid_current() and operation_id=p_operation_id and action=any(p_actions));
$$;

create function private.authorize_removed_academic_cleanup(
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
  -- Recheck the exact retained removal on EVERY claim, callback and finalization.
  perform 1 from public.classroom_roster where classroom_id=p_classroom_id
    and removed_student_id=p_student_id and removed_enrollment_id=p_generation_id
    and removed_at is not null for update;
  if not found or (select count(*) from public.classroom_roster where classroom_id=p_classroom_id
      and removed_student_id=p_student_id and removed_at is not null) <> 1 then
    raise exception using errcode='55000',message='academic_cleanup_binding_invalid';
  end if;
  return v_op;
end;
$$;

-- Reuse the complete current inventory (including157/163 gradebook additions).
-- The roster identity is retained; only its enrollment-owned marks are redacted.
-- JSON-reference rows are inventoried explicitly, not hidden by FK cascades.
create function private.removed_academic_resources(p_classroom_id uuid,p_student_id uuid)
returns table(table_name text,row_id uuid,disposition text)
language sql stable set search_path = '' as $$
  select * from public.student_purge_inventory_resources(p_classroom_id,p_student_id)
    where table_name not in ('classroom_roster','classroom_enrollments')
  union all select 'retained_manual_attendance_marks',roster.id,'redact'
    from public.classroom_roster roster where roster.classroom_id=p_classroom_id
      and roster.removed_student_id=p_student_id and roster.removed_at is not null
      and roster.retained_manual_attendance_marks <> '{}'::jsonb
  union all select 'attendance_check_in_facts',id,'redact' from public.attendance_check_in_facts
    where classroom_id=p_classroom_id and student_id=p_student_id
  union all select 'attendance_record_projection',id,'redact' from public.attendance_record_projection
    where classroom_id=p_classroom_id and student_id=p_student_id
  union all select 'attendance_status_overrides',id,'redact' from public.attendance_status_overrides
    where classroom_id=p_classroom_id and student_id=p_student_id
  union all select 'attendance_status_override_events',id,'redact' from public.attendance_status_override_events
    where classroom_id=p_classroom_id and student_id=p_student_id
  union all select 'managed_storage_json_references',reference.id,'delete'
    from public.managed_storage_json_references reference
    left join public.assignment_doc_history history on history.id=reference.assignment_doc_history_id
    join public.assignment_docs doc on doc.id=coalesce(reference.assignment_doc_id,history.assignment_doc_id)
    join public.assignments assignment on assignment.id=doc.assignment_id
    where assignment.classroom_id=p_classroom_id and doc.student_id=p_student_id;
$$;

create function private.removed_academic_objects(p_classroom_id uuid,p_student_id uuid)
returns setof public.managed_storage_objects language sql stable set search_path = '' as $$
  select object.* from public.managed_storage_objects object
  left join public.managed_storage_provisional_owners provisional on provisional.id=object.provisional_owner_id
  where ((object.classroom_id=p_classroom_id or provisional.target_classroom_id=p_classroom_id)
    and (object.data_subject_user_id=p_student_id or
      (object.created_by_user_id=p_student_id and object.purpose in ('student_assignment_artifact','student_inline_image'))))
    or object.id in (select artifact.managed_object_id from public.assignment_submission_artifacts artifact
      join public.assignment_docs doc on doc.id=artifact.assignment_doc_id
      join public.assignments assignment on assignment.id=doc.assignment_id
      where assignment.classroom_id=p_classroom_id and (doc.student_id=p_student_id or artifact.student_id=p_student_id))
    or object.id in (select reference.managed_object_id from public.managed_storage_json_references reference
      join private.removed_academic_resources(p_classroom_id,p_student_id) resource
        on resource.table_name='managed_storage_json_references' and resource.row_id=reference.id);
$$;

create function private.removed_academic_row_hash(p_table text,p_id uuid)
returns text language plpgsql stable set search_path = '' as $$
declare v_row jsonb;
begin
  if p_table='retained_manual_attendance_marks' then
    select jsonb_build_object('id',id,'marks',retained_manual_attendance_marks) into v_row
      from public.classroom_roster where id=p_id;
  elsif p_table=any(array['announcement_reads','assignment_ai_grading_run_items','assignment_ai_grading_runs',
    'assignment_doc_history','assignment_doc_save_operations','assignment_submission_artifacts','assignment_docs',
    'assignment_feedback_entries','assignment_repo_review_results','assignment_repo_targets','entries',
    'report_card_rows','survey_responses','test_ai_grading_run_items','test_ai_grading_runs',
    'test_attempt_history','test_attempts','test_focus_events','test_responses','test_student_availability',
    'log_summaries','developer_feedback_candidates','gradebook_score_overrides','gradebook_item_scores',
    'managed_storage_json_references','attendance_check_in_facts','attendance_record_projection',
    'attendance_status_overrides','attendance_status_override_events']) then
    execute format('select to_jsonb(row) from public.%I row where id=$1',p_table) into v_row using p_id;
  else
    raise exception using errcode='55000',message='academic_cleanup_unknown_resource';
  end if;
  if v_row is null then raise exception using errcode='40001',message='academic_cleanup_inventory_drift'; end if;
  return encode(extensions.digest(v_row::text,'sha256'),'hex');
end;
$$;

create function private.removed_academic_blockers(p_operation_id uuid)
returns text[] language plpgsql volatile set search_path = '' as $$
declare v_op public.student_purge_operations; v_binding private.student_provider_cleanup_bindings;
  v_blockers text[] := array[]::text[];
begin
  select * into strict v_op from public.student_purge_operations where id=p_operation_id;
  select * into strict v_binding from private.student_provider_cleanup_bindings where operation_id=p_operation_id;
  if v_binding.pal_receipt->>'status' is distinct from 'completed'
    or v_binding.pal_receipt->>'operation_id' is distinct from p_operation_id::text
    or v_binding.pal_receipt->>'learner_id' is distinct from v_binding.pal_reference
    or v_binding.bara_receipt->>'state' is distinct from 'deleted'
    or v_binding.bara_receipt->'absence_verified' is distinct from 'true'::jsonb
    or v_binding.bara_receipt->>'installation_ref' is distinct from v_binding.installation_ref
    or v_binding.bara_receipt->>'roster_ref' is distinct from v_binding.roster_ref
    or v_binding.bara_receipt->>'participant_ref' is distinct from v_binding.participant_ref
    or v_binding.bara_receipt->>'operation_ref' is distinct from 'erase_participant_'||replace(p_operation_id::text,'-','') then
    v_blockers:=array_append(v_blockers,'provider_completion_required');
  end if;
  if not coalesce((select mode='enforced' from public.managed_storage_settings where singleton),false) then
    v_blockers:=array_append(v_blockers,'managed_storage_enforcement_required');
  end if;
  -- Any archive/extract ledger, pending intent or provisional object is unknown copy
  -- evidence. Never clean up whole-class copies to settle this individual operation.
  if exists(select 1 from public.classroom_archives where classroom_id=v_op.classroom_id)
    or exists(select 1 from public.classroom_gradex_extracts where classroom_id=v_op.classroom_id)
    or exists(select 1 from public.classroom_archive_operations where classroom_id=v_op.classroom_id)
    or exists(select 1 from public.classroom_cold_tombstones where classroom_id=v_op.classroom_id)
    or exists(select 1 from public.managed_storage_provisional_owners where target_classroom_id=v_op.classroom_id)
    or exists(select 1 from public.managed_storage_objects where classroom_id=v_op.classroom_id
      and purpose in ('classroom_archive','gradex_extract')) then
    v_blockers:=array_append(v_blockers,'copy_policy_required');
  end if;
  if exists(select 1 from private.removed_academic_resources(v_op.classroom_id,v_op.student_id)
    where disposition='collateral_delete' or (disposition='redact' and table_name<>'retained_manual_attendance_marks')) then
    v_blockers:=array_append(v_blockers,'shared_resource_policy_required');
  end if;
  if exists(select 1 from public.attendance_override_requests where classroom_id=v_op.classroom_id) then
    v_blockers:=array_append(v_blockers,'shared_attendance_request_policy_required');
  end if;
  -- Grading history can imply remote copies even after its job has finished.
  if exists(select 1 from private.removed_academic_resources(v_op.classroom_id,v_op.student_id)
      where table_name in ('assignment_ai_grading_runs','assignment_ai_grading_run_items',
        'test_ai_grading_runs','test_ai_grading_run_items','assignment_repo_review_results','assignment_repo_targets'))
    or exists(select 1 from public.assignment_repo_review_runs run join public.assignments assignment
      on assignment.id=run.assignment_id where assignment.classroom_id=v_op.classroom_id)
    or exists(select 1 from public.assignment_docs doc join public.assignments assignment on assignment.id=doc.assignment_id
      where assignment.classroom_id=v_op.classroom_id and doc.student_id=v_op.student_id
        and (doc.ai_feedback_model is not null or doc.ai_feedback_suggested_at is not null
          or doc.ai_grading_provenance is not null or doc.ai_grading_review is not null))
    or exists(select 1 from public.test_responses response join public.tests test on test.id=response.test_id
      where test.classroom_id=v_op.classroom_id and response.student_id=v_op.student_id
        and (response.ai_model is not null or response.ai_grading_basis is not null
          or response.ai_grading_provenance is not null or response.ai_grading_review is not null)) then
    v_blockers:=array_append(v_blockers,'remote_grading_policy_required');
  end if;
  if exists(select 1 from public.classroom_retired_assessment_record_actors actor
    join public.classroom_retired_assessment_records record on record.id=actor.record_id
    where record.classroom_id=v_op.classroom_id and actor.actor_id=v_op.student_id) then
    v_blockers:=array_append(v_blockers,'retired_assessment_policy_required');
  end if;
  if exists(select 1 from private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
    where object.classroom_id is distinct from v_op.classroom_id
      or object.data_subject_user_id is distinct from v_op.student_id
      or object.provisional_owner_id is not null or object.course_blueprint_id is not null
      or object.status<>'ready' or object.purpose not in ('student_assignment_artifact','student_inline_image')
      or object.storage_bucket not in ('assignment-artifacts','submission-images')) then
    v_blockers:=array_append(v_blockers,'object_ownership_unknown');
  end if;
  if exists(select 1 from public.assignment_submission_artifacts artifact
    join public.assignment_docs doc on doc.id=artifact.assignment_doc_id
    join public.assignments assignment on assignment.id=doc.assignment_id
    join public.assignment_submission_requirements requirement on requirement.id=artifact.requirement_id
    where assignment.classroom_id=v_op.classroom_id and (doc.student_id=v_op.student_id or artifact.student_id=v_op.student_id)
      and (doc.student_id is distinct from artifact.student_id or requirement.assignment_id<>doc.assignment_id
        or (artifact.storage_path is not null and artifact.managed_object_id is null))) then
    v_blockers:=array_append(v_blockers,'artifact_ownership_unknown');
  end if;
  -- Every reference to a selected object must be an exact target resource.
  if exists(select 1 from private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
    join public.managed_storage_json_references reference on reference.managed_object_id=object.id
    where not exists(select 1 from private.removed_academic_resources(v_op.classroom_id,v_op.student_id) resource
      where resource.table_name='managed_storage_json_references' and resource.row_id=reference.id))
    or exists(select 1 from private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
      join public.assignment_submission_artifacts artifact on artifact.managed_object_id=object.id
      where not exists(select 1 from private.removed_academic_resources(v_op.classroom_id,v_op.student_id) resource
        where resource.table_name='assignment_submission_artifacts' and resource.row_id=artifact.id)) then
    v_blockers:=array_append(v_blockers,'shared_object_policy_required');
  end if;
  if exists(select 1 from public.student_purge_objects where operation_id=p_operation_id
    and status='failed' and attempt_count>=12) then
    v_blockers:=array_append(v_blockers,'object_retry_exhausted');
  end if;
  if exists(select 1 from public.assignment_artifact_storage_cleanup reference
    join private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
      on object.id=reference.managed_object_id) then
    v_blockers:=array_append(v_blockers,'pending_or_copy_reference:assignment_artifact_storage_cleanup');
  end if;
  if exists(select 1 from public.test_document_snapshot_storage_cleanup reference
    join private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
      on object.id=reference.managed_object_id) then
    v_blockers:=array_append(v_blockers,'pending_or_copy_reference:test_document_snapshot_storage_cleanup');
  end if;
  if exists(select 1 from public.classroom_archive_operations reference
    join private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
      on object.id=reference.managed_object_id) then
    v_blockers:=array_append(v_blockers,'pending_or_copy_reference:classroom_archive_operations');
  end if;
  if exists(select 1 from public.classroom_archives reference
    join private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
      on object.id=reference.managed_object_id) then
    v_blockers:=array_append(v_blockers,'pending_or_copy_reference:classroom_archives');
  end if;
  if exists(select 1 from public.classroom_archive_object_upload_cleanup reference
    join private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
      on object.id=reference.managed_object_id) then
    v_blockers:=array_append(v_blockers,'pending_or_copy_reference:classroom_archive_object_upload_cleanup');
  end if;
  if exists(select 1 from public.classroom_archive_restore_expected_objects reference
    join private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
      on object.id=reference.managed_object_id) then
    v_blockers:=array_append(v_blockers,'pending_or_copy_reference:classroom_archive_restore_expected_objects');
  end if;
  if exists(select 1 from public.classroom_archive_source_object_cleanup reference
    join private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
      on object.id=reference.managed_object_id) then
    v_blockers:=array_append(v_blockers,'pending_or_copy_reference:classroom_archive_source_object_cleanup');
  end if;
  if exists(select 1 from public.classroom_gradex_extracts reference
    join private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
      on object.id=reference.managed_object_id) then
    v_blockers:=array_append(v_blockers,'pending_or_copy_reference:classroom_gradex_extracts');
  end if;
  if exists(select 1 from public.classroom_gradex_extract_cleanup reference
    join private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
      on object.id=reference.managed_object_id) then
    v_blockers:=array_append(v_blockers,'pending_or_copy_reference:classroom_gradex_extract_cleanup');
  end if;
  return v_blockers;
end;
$$;

create function private.removed_academic_fingerprint(p_operation_id uuid)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare v_op public.student_purge_operations; v_rows text; v_objects text;
begin
  select * into strict v_op from public.student_purge_operations where id=p_operation_id;
  select coalesce(string_agg(table_name||':'||row_id::text||':'||disposition||':'||
    private.removed_academic_row_hash(table_name,row_id), E'\n' order by table_name,row_id),'') into v_rows
    from private.removed_academic_resources(v_op.classroom_id,v_op.student_id);
  select coalesce(string_agg(encode(extensions.digest(to_jsonb(object)::text,'sha256'),'hex'),
    E'\n' order by object.id),'') into v_objects
    from private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object;
  return jsonb_build_object('relational_inventory_sha256',encode(extensions.digest(v_rows,'sha256'),'hex'),
    'storage_inventory_sha256',encode(extensions.digest(v_objects,'sha256'),'hex'));
end;
$$;

create function private.removed_academic_delete_allowed(p_table text,p_row jsonb,p_new jsonb default null)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_operation uuid;
begin
  select operation_id into v_operation from private.removed_academic_mutations
    where transaction_id=txid_current() and action='finalize';
  if v_operation is null then return false; end if;
  if p_table='classroom_roster' then
    return p_new is not null and p_new->'retained_manual_attendance_marks'='{}'::jsonb
      and (p_new-'retained_manual_attendance_marks')=(p_row-'retained_manual_attendance_marks')
      and exists(select 1 from public.student_purge_resources where operation_id=v_operation
        and table_name='retained_manual_attendance_marks' and row_id=(p_row->>'id')::uuid);
  end if;
  if p_new is not null then return false; end if;
  if p_table='managed_storage_objects' then
    return exists(select 1 from public.student_purge_objects where operation_id=v_operation
      and managed_storage_object_id=(p_row->>'id')::uuid and status='deleted'
      and owner_sha256=encode(extensions.digest(p_row::text,'sha256'),'hex'));
  end if;
  return exists(select 1 from public.student_purge_resources where operation_id=v_operation
    and table_name=p_table and row_id=(p_row->>'id')::uuid and disposition='delete');
end;
$$;

-- Existing writer guard plus exact local finalization authority.
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

-- Existing writer guard plus exact local finalization authority.
create or replace function public.reject_student_indirect_change_during_purge()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb;
  v_rows jsonb[] := case when tg_op = 'INSERT' then array[to_jsonb(new)]
    when tg_op = 'DELETE' then array[to_jsonb(old)] else array[to_jsonb(old), to_jsonb(new)] end;
  v_classroom_id uuid;
  v_student_id uuid;
begin
  if tg_op='DELETE' and private.removed_academic_delete_allowed(tg_table_name,to_jsonb(old)) then return old; end if;
  if tg_table_name='classroom_roster' and tg_op='UPDATE'
    and private.removed_academic_delete_allowed(tg_table_name,to_jsonb(old),to_jsonb(new)) then return new; end if;
  if current_setting('pika.student_purge_finalize', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  foreach v_row in array v_rows loop
    v_classroom_id := null;
    v_student_id := null;
    if tg_table_name in ('assignment_doc_history', 'assignment_doc_save_operations') then
      select assignment.classroom_id, doc.student_id into v_classroom_id, v_student_id
      from public.assignment_docs doc join public.assignments assignment on assignment.id = doc.assignment_id
      where doc.id = nullif(v_row->>'assignment_doc_id', '')::uuid;
    elsif tg_table_name = 'test_attempt_history' then
      select test.classroom_id, attempt.student_id into v_classroom_id, v_student_id
      from public.test_attempts attempt join public.tests test on test.id = attempt.test_id
      where attempt.id = nullif(v_row->>'test_attempt_id', '')::uuid;
    elsif tg_table_name = 'assignment_ai_grading_runs' then
      select assignment.classroom_id into v_classroom_id from public.assignments assignment
      where assignment.id = nullif(v_row->>'assignment_id', '')::uuid;
    elsif tg_table_name = 'test_ai_grading_runs' then
      select test.classroom_id into v_classroom_id from public.tests test
      where test.id = nullif(v_row->>'test_id', '')::uuid;
    elsif tg_table_name = 'log_summaries' then
      v_classroom_id := nullif(v_row->>'classroom_id', '')::uuid;
    elsif tg_table_name = 'developer_feedback_candidates' then
      if exists (select 1 from public.student_purge_fences fence
        where (v_row->'source_classroom_ids') ? fence.classroom_id::text)
      then raise exception using errcode = '55000', message = 'student_purge_active'; end if;
      continue;
    end if;
    if v_classroom_id is not null then
      if v_student_id is null then
        perform pg_advisory_xact_lock(hashtextextended('pika-classroom-operation:' || v_classroom_id::text, 0));
      else
        perform public.student_purge_lock(v_classroom_id, v_student_id);
      end if;
      if exists (select 1 from public.student_purge_fences fence
        where fence.classroom_id = v_classroom_id
          and (v_student_id is null or fence.student_id = v_student_id))
      then raise exception using errcode = '55000', message = 'student_purge_active'; end if;
    end if;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.reject_gradebook_override_change_during_student_purge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.gradebook_score_overrides;
begin
  if tg_op='DELETE' and private.removed_academic_delete_allowed(tg_table_name,to_jsonb(old)) then return old; end if;
  if current_setting('pika.student_purge_finalize', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' and (
    new.classroom_id is distinct from old.classroom_id
    or new.student_id is distinct from old.student_id
    or new.assessment_type is distinct from old.assessment_type
    or new.assessment_id is distinct from old.assessment_id
  ) then
    raise exception using errcode = '55000', message = 'gradebook_override_identity_immutable';
  end if;

  v_row := case when tg_op = 'DELETE' then old else new end;
  perform public.student_purge_lock(v_row.classroom_id, v_row.student_id);
  if exists (
    select 1
    from public.student_purge_fences as fence
    where fence.classroom_id = v_row.classroom_id
      and fence.student_id = v_row.student_id
  ) then
    raise exception using errcode = '55000', message = 'student_purge_active';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function private.guard_final_student_roster_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op='UPDATE' and private.removed_academic_delete_allowed(tg_table_name,to_jsonb(old),to_jsonb(new)) then return new; end if;
  perform private.try_lock_classroom_membership_change(new.classroom_id);

  -- A re-add/upsert must not edit or clear the deny record. Whole-class archive
  -- restoration recreates tombstones with INSERT, retaining this same boundary.
  if tg_op = 'UPDATE' and old.removed_at is not null then
    raise exception using errcode = '55000', message = 'student_class_data_pending_purge';
  end if;

  -- The removal transaction and archive replay may write a retained identity.
  if new.removed_at is not null then
    return new;
  end if;

  -- Older two-call re-adds can leave an unbound invitation beside a retained
  -- identity. Replay that existing archive state regardless of row order;
  -- this does not restore enrollment or permit edits to a retained row.
  if tg_op = 'INSERT' and public.is_classroom_archive_maintenance_mode('restore') then
    return new;
  end if;

  if exists (
    select 1
    from public.classroom_roster as removed
    join public.users as student on student.id = removed.removed_student_id
    where removed.classroom_id = new.classroom_id
      and removed.removed_at is not null
      and (
        lower(btrim(removed.email)) = lower(btrim(new.email))
        or lower(btrim(student.email)) = lower(btrim(new.email))
      )
  ) then
    raise exception using errcode = '55000', message = 'student_class_data_pending_purge';
  end if;
  return new;
end;
$$;

create or replace function private.guard_student_provider_operation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  v_id := case when tg_op='DELETE' then old.id else new.id end;
  if exists(select 1 from private.student_provider_cleanup_bindings where operation_id=v_id) then
    if tg_op='DELETE' then raise exception using errcode='55000',message='student_provider_stage_required'; end if;
    if tg_op='UPDATE' and (to_jsonb(new)-'local_academic_cleanup')=(to_jsonb(old)-'local_academic_cleanup')
      and private.removed_academic_capability(v_id,array['inventory','claim','finalize']) then return new; end if;
    if new.status <> 'provider_pending' or (tg_op='UPDATE' and to_jsonb(new) is distinct from to_jsonb(old)) then
      raise exception using errcode='55000',message='student_provider_stage_required';
    end if;
  elsif tg_op <> 'DELETE' and new.status='provider_pending' then
    raise exception using errcode='55000',message='student_provider_binding_required';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

create or replace function private.guard_student_provider_purge_child()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  for v_id in select distinct id from unnest(array[
    case when tg_op<>'DELETE' then new.operation_id end,
    case when tg_op<>'INSERT' then old.operation_id end]) id where id is not null loop
    if exists(select 1 from private.student_provider_cleanup_bindings where operation_id=v_id) then
      -- Only our transaction-scoped RPC may stage or mutate local ledgers.
      if tg_table_name='student_purge_resources' and tg_op='INSERT'
        and private.removed_academic_capability(v_id,array['inventory']) then continue; end if;
      if tg_table_name='student_purge_objects' and (
        (tg_op='INSERT' and private.removed_academic_capability(v_id,array['inventory']))
        or (tg_op='UPDATE' and private.removed_academic_capability(v_id,array['claim','acknowledge','fail','finalize']))
      ) then continue; end if;
      -- Reservation installs one fence; no local action can modify/remove it.
      if tg_table_name <> 'student_purge_fences' or tg_op <> 'INSERT' then
        raise exception using errcode='55000',message='student_provider_stage_required';
      end if;
    end if;
  end loop;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

-- Freeze parent ownership and any new cross-owner object reference. These guards
-- also close insert paths that are not members of the original123 row inventory.
create function private.guard_removed_academic_parent()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_classroom uuid;
begin
  for v_classroom in select distinct value from unnest(array[old.classroom_id,
    case when tg_op='UPDATE' then new.classroom_id end]) value where value is not null loop
    perform private.try_lock_classroom_membership_change(v_classroom);
    if exists(select 1 from public.student_purge_operations operation
      join private.student_provider_cleanup_bindings binding on binding.operation_id=operation.id
      where operation.classroom_id=v_classroom) then
      raise exception using errcode='55000',message='academic_cleanup_parent_fenced';
    end if;
  end loop;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
do $$ declare v_table text; begin
  foreach v_table in array array['assignments','tests','surveys','announcements','report_cards','gradebook_items'] loop
    execute format('create trigger removed_academic_parent before update of id,classroom_id or delete on public.%I
      for each row execute function private.guard_removed_academic_parent()',v_table);
  end loop;
end $$;

create function private.guard_removed_academic_reference()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row jsonb; v_object public.managed_storage_objects;
begin
  if tg_op='DELETE' and private.removed_academic_delete_allowed(tg_table_name,to_jsonb(old)) then return old; end if;
  for v_row in select value from jsonb_array_elements(jsonb_build_array(
    case when tg_op<>'DELETE' then to_jsonb(new) end,case when tg_op<>'INSERT' then to_jsonb(old) end))
    where jsonb_typeof(value)='object' loop
    select * into v_object from public.managed_storage_objects where id=(v_row->>'managed_object_id')::uuid;
    if v_object.classroom_id is null or v_object.data_subject_user_id is null then continue; end if;
    perform private.try_lock_classroom_membership_change(v_object.classroom_id,v_object.data_subject_user_id);
    if exists(select 1 from public.student_purge_fences where classroom_id=v_object.classroom_id
      and student_id=v_object.data_subject_user_id) then
      raise exception using errcode='55000',message='academic_cleanup_reference_fenced';
    end if;
  end loop;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger removed_academic_reference before insert or update or delete
  on public.managed_storage_json_references for each row execute function private.guard_removed_academic_reference();

do $$ declare v_table text; begin
  foreach v_table in array array['assignment_submission_artifacts','assignment_artifact_storage_cleanup',
    'test_document_snapshot_storage_cleanup','classroom_archive_operations','classroom_archives',
    'classroom_archive_object_upload_cleanup','classroom_archive_restore_expected_objects',
    'classroom_archive_source_object_cleanup','classroom_gradex_extracts','classroom_gradex_extract_cleanup'] loop
    execute format('create trigger removed_academic_reference before insert or update or delete on public.%I
      for each row execute function private.guard_removed_academic_reference()',v_table);
  end loop;
end $$;

create function private.removed_academic_receipt(p_operation_id uuid,p_object jsonb default null)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare v_op public.student_purge_operations; v_binding private.student_provider_cleanup_bindings;
begin
  select * into strict v_op from public.student_purge_operations where id=p_operation_id;
  select * into strict v_binding from private.student_provider_cleanup_bindings where operation_id=p_operation_id;
  return jsonb_build_object('schema_version',1,'operation_id',v_op.id,'teacher_id',v_op.teacher_id,
    'classroom_id',v_op.classroom_id,'student_id',v_op.student_id,'generation_id',v_binding.generation_id,
    'overall_status','provider_pending','local_status',v_op.local_academic_cleanup->>'status',
    'revision',(v_op.local_academic_cleanup->>'revision')::integer,
    'relational_inventory_sha256',v_op.local_academic_cleanup->>'relational_inventory_sha256',
    'storage_inventory_sha256',v_op.local_academic_cleanup->>'storage_inventory_sha256',
    'blockers',to_jsonb(private.removed_academic_blockers(p_operation_id)),'object',p_object);
end;
$$;

-- ONE explicit service-only entry point; it never reserves a removal itself.
create function public.advance_removed_student_academic_cleanup(
  p_operation_id uuid,p_teacher_id uuid,p_classroom_id uuid,p_student_id uuid,p_generation_id uuid,
  p_action text,p_revision integer default null,p_object_id uuid default null,p_lease_token uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_op public.student_purge_operations; v_fingerprint jsonb; v_object public.student_purge_objects;
  v_resource record; v_token uuid; v_result jsonb; v_actual integer; v_blockers text[];
begin
  if p_action is null or p_action not in ('inventory','claim','acknowledge','fail') then
    raise exception using errcode='22023',message='academic_cleanup_action_invalid';
  end if;
  v_op:=private.authorize_removed_academic_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
  perform public.lock_managed_storage_protocol();
  insert into private.removed_academic_mutations(transaction_id,operation_id,action)
    values(txid_current(),p_operation_id,p_action);
  if v_op.local_academic_cleanup is null then
    if p_action<>'inventory' then raise exception using errcode='55000',message='academic_cleanup_inventory_required'; end if;
    v_fingerprint:=private.removed_academic_fingerprint(p_operation_id);
    insert into public.student_purge_resources(operation_id,table_name,row_id,disposition,row_sha256)
      select p_operation_id,table_name,row_id,disposition,private.removed_academic_row_hash(table_name,row_id)
      from private.removed_academic_resources(p_classroom_id,p_student_id);
    insert into public.student_purge_objects(operation_id,managed_storage_object_id,storage_bucket,
      storage_path,storage_path_sha256,owner_sha256)
      select p_operation_id,object.id,object.storage_bucket,object.storage_path,
        public.managed_storage_identity_sha256(object.storage_bucket,object.storage_path),
        encode(extensions.digest(to_jsonb(object)::text,'sha256'),'hex')
      from private.removed_academic_objects(p_classroom_id,p_student_id) object;
    update public.student_purge_operations set local_academic_cleanup=v_fingerprint||jsonb_build_object(
      'status','inventoried','revision',1,'inventoried_at',clock_timestamp(),'completed_at',null)
      where id=p_operation_id returning * into v_op;
  end if;
  if v_op.local_academic_cleanup->>'status'='local_completed' then
    v_result:=private.removed_academic_receipt(p_operation_id);
    delete from private.removed_academic_mutations where transaction_id=txid_current();
    return v_result;
  end if;
  v_fingerprint:=private.removed_academic_fingerprint(p_operation_id);
  if v_fingerprint is distinct from (v_op.local_academic_cleanup-
    array['status','revision','inventoried_at','completed_at']) then
    raise exception using errcode='40001',message='academic_cleanup_inventory_drift';
  end if;
  v_blockers:=private.removed_academic_blockers(p_operation_id);
  if p_action='inventory' or cardinality(v_blockers)>0 then
    v_result:=private.removed_academic_receipt(p_operation_id);
    delete from private.removed_academic_mutations where transaction_id=txid_current();
    return v_result;
  end if;
  -- Exact saved provider completion and all local no-copy proofs were checked
  -- above, after authorization and before any object/row deletion authority.
  if p_action in ('acknowledge','fail') then
    if p_revision is distinct from (v_op.local_academic_cleanup->>'revision')::integer
      or p_object_id is null or p_lease_token is null then
      raise exception using errcode='22023',message='academic_cleanup_callback_invalid';
    end if;
    select * into v_object from public.student_purge_objects
      where operation_id=p_operation_id and id=p_object_id for update;
    if not found then raise exception using errcode='55000',message='academic_cleanup_lease_lost'; end if;
    if v_object.status<>'deleted' then
      if v_object.status<>'processing' or v_object.lease_token is distinct from p_lease_token
        or v_object.lease_expires_at<=clock_timestamp() then
        raise exception using errcode='55000',message='academic_cleanup_lease_lost';
      end if;
      if p_action='acknowledge' then
        perform public.managed_storage_exact_lock(v_object.storage_bucket,v_object.storage_path);
        if exists(select 1 from storage.objects where bucket_id=v_object.storage_bucket and name=v_object.storage_path) then
          raise exception using errcode='55000',message='academic_cleanup_object_still_present';
        end if;
        update public.student_purge_objects set status='deleted',deleted_at=clock_timestamp(),storage_path=null,
          lease_token=null,lease_expires_at=null,last_error_code=null,updated_at=clock_timestamp() where id=p_object_id;
      else
        update public.student_purge_objects set status='failed',lease_token=null,lease_expires_at=null,
          last_error_code='storage_delete_failed',updated_at=clock_timestamp(),
          next_attempt_at=clock_timestamp()+make_interval(secs=>least(300,(2^least(attempt_count,8))::integer))
          where id=p_object_id;
      end if;
    end if;
  elsif p_action='claim' then
    update public.student_purge_objects set status='failed',lease_token=null,lease_expires_at=null,
      next_attempt_at=clock_timestamp(),updated_at=clock_timestamp()
      where operation_id=p_operation_id and status='processing' and lease_expires_at<=clock_timestamp();
    select * into v_object from public.student_purge_objects where operation_id=p_operation_id
      and status in ('pending','failed') and attempt_count<12 and next_attempt_at<=clock_timestamp()
      order by created_at,id for update skip locked limit 1;
    if found then
      v_token:=gen_random_uuid();
      update public.student_purge_objects set status='processing',attempt_count=attempt_count+1,
        lease_token=v_token,lease_expires_at=clock_timestamp()+interval '60 seconds',
        last_error_code=null,updated_at=clock_timestamp() where id=v_object.id;
      update public.student_purge_operations set local_academic_cleanup=jsonb_set(local_academic_cleanup,
        '{status}','"deleting"'::jsonb) where id=p_operation_id;
      v_result:=private.removed_academic_receipt(p_operation_id,jsonb_build_object('id',v_object.id,
        'storage_bucket',v_object.storage_bucket,'storage_path',v_object.storage_path,'lease_token',v_token));
      delete from private.removed_academic_mutations where transaction_id=txid_current();
      return v_result;
    end if;
    if not exists(select 1 from public.student_purge_objects where operation_id=p_operation_id and status<>'deleted') then
      update private.removed_academic_mutations set action='finalize' where transaction_id=txid_current();
      -- Reauthorize finalization explicitly; preserve every retained identity field.
      perform private.authorize_removed_academic_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
      for v_resource in select * from public.student_purge_resources where operation_id=p_operation_id
        order by case table_name when 'managed_storage_json_references' then 0
          when 'assignment_doc_history' then 10 when 'assignment_doc_save_operations' then 11
          when 'assignment_submission_artifacts' then 12 when 'test_attempt_history' then 15
          when 'assignment_docs' then 80 when 'test_attempts' then 81 else 30 end,table_name,row_id loop
        if v_resource.table_name='retained_manual_attendance_marks' then
          update public.classroom_roster set retained_manual_attendance_marks='{}'::jsonb where id=v_resource.row_id;
        elsif v_resource.disposition='delete' then
          execute format('delete from public.%I where id=$1',v_resource.table_name) using v_resource.row_id;
        else raise exception using errcode='55000',message='academic_cleanup_shared_resource'; end if;
        get diagnostics v_actual=row_count;
        if v_actual<>1 then raise exception using errcode='40001',message='academic_cleanup_inventory_drift'; end if;
      end loop;
      -- Pending cleanup/copy ledgers are blockers, never collateral deletion targets.
      delete from public.managed_storage_objects object using public.student_purge_objects staged
        where staged.operation_id=p_operation_id and staged.managed_storage_object_id=object.id;
      if exists(select 1 from private.removed_academic_resources(p_classroom_id,p_student_id))
        or exists(select 1 from private.removed_academic_objects(p_classroom_id,p_student_id))
        or exists(select 1 from storage.objects stored join public.student_purge_objects staged
          on staged.storage_bucket=stored.bucket_id and staged.storage_path_sha256=
            public.managed_storage_identity_sha256(stored.bucket_id,stored.name)
          where staged.operation_id=p_operation_id) then
        raise exception using errcode='55000',message='academic_cleanup_absence_unverified';
      end if;
      update public.student_purge_operations set local_academic_cleanup=
        jsonb_set(jsonb_set(local_academic_cleanup,'{status}','"local_completed"'::jsonb),
          '{completed_at}',to_jsonb(clock_timestamp())) where id=p_operation_id;
    end if;
  end if;
  v_result:=private.removed_academic_receipt(p_operation_id);
  delete from private.removed_academic_mutations where transaction_id=txid_current();
  return v_result;
end;
$$;

create or replace function public.guard_gradebook_item_score()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row public.gradebook_item_scores;
begin
  if tg_op='DELETE' and private.removed_academic_delete_allowed(tg_table_name,to_jsonb(old)) then return old; end if;
  if current_setting('pika.student_purge_finalize', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' then
    if new.classroom_id is distinct from old.classroom_id or new.student_id is distinct from old.student_id
      or new.item_id is distinct from old.item_id or new.id is distinct from old.id then
      raise exception using errcode = '55000', message = 'gradebook_item_score_identity_immutable';
    end if;
    new.updated_at := now();
    if new.earned is distinct from old.earned then new.returned_at := null; end if;
  end if;
  v_row := case when tg_op = 'DELETE' then old else new end;
  perform public.student_purge_lock(v_row.classroom_id, v_row.student_id);
  if exists (select 1 from public.student_purge_fences
    where classroom_id = v_row.classroom_id and student_id = v_row.student_id) then
    raise exception using errcode = '55000', message = 'student_purge_active';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.enqueue_deleted_assignment_artifact_storage_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op='DELETE' and private.removed_academic_delete_allowed(tg_table_name,to_jsonb(old)) then return old; end if;
  if current_setting('pika.classroom_purge_finalize', true) = 'on'
    or (tg_op = 'UPDATE' and old.storage_path is not distinct from new.storage_path)
    or old.storage_path is null or btrim(old.storage_path) = ''
    or public.is_classroom_archive_maintenance_mode('restore')
    or public.is_classroom_archive_maintenance_mode('compaction')
  then return case when tg_op = 'DELETE' then old else new end; end if;
  insert into public.assignment_artifact_storage_cleanup as existing_cleanup (
    storage_path, managed_object_id, status, attempt_count, next_attempt_at,
    lease_token, lease_expires_at, last_error, updated_at
  ) values (
    old.storage_path, old.managed_object_id, 'pending', 0, clock_timestamp(),
    null, null, null, clock_timestamp()
  ) on conflict (storage_path) do update
  set managed_object_id = coalesce(existing_cleanup.managed_object_id,
        excluded.managed_object_id),
      status = 'pending', next_attempt_at = clock_timestamp(),
      lease_token = null, lease_expires_at = null, last_error = null,
      updated_at = clock_timestamp()
  where existing_cleanup.status <> 'processing'
    or existing_cleanup.lease_expires_at <= clock_timestamp();
  if old.managed_object_id is not null then
    perform public.queue_managed_storage_cleanup(
      old.managed_object_id, 'assignment_artifact_reference_removed'
    );
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Preserve the retained roster's timestamp as well as its identity/control fields.
create function private.retain_removed_academic_roster_timestamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.removed_academic_delete_allowed(tg_table_name,to_jsonb(old),
    jsonb_set(to_jsonb(new),'{updated_at}',to_jsonb(old.updated_at))) then
    new.updated_at:=old.updated_at;
  end if;
  return new;
end;
$$;
create trigger zz_retain_removed_academic_roster_timestamp before update on public.classroom_roster
  for each row execute function private.retain_removed_academic_roster_timestamp();

create or replace function public.enforce_managed_storage_object_delete()
returns trigger language plpgsql security definer set search_path = public, storage as $$
declare v_enforced boolean; v_object public.managed_storage_objects; v_referenced boolean; v_academic record; v_academic_op public.student_purge_operations;
begin
  -- Physical storage deletion independently verifies the saved authority and
  -- live lease. A mocked successful remove response cannot provide this proof.
  select operation.id,operation.teacher_id,operation.classroom_id,operation.student_id,binding.generation_id
    into v_academic from public.managed_storage_objects object
    join public.student_purge_operations operation on operation.classroom_id=object.classroom_id
      and operation.student_id=object.data_subject_user_id
    join private.student_provider_cleanup_bindings binding on binding.operation_id=operation.id
    where object.storage_bucket=old.bucket_id and object.storage_path=old.name;
  if found then
    v_academic_op:=private.authorize_removed_academic_cleanup(v_academic.id,v_academic.teacher_id,
      v_academic.classroom_id,v_academic.student_id,v_academic.generation_id);
    if cardinality(private.removed_academic_blockers(v_academic.id))>0
      or v_academic_op.local_academic_cleanup->>'status' is distinct from 'deleting'
      or private.removed_academic_fingerprint(v_academic.id) is distinct from
        (v_academic_op.local_academic_cleanup-array['status','revision','inventoried_at','completed_at'])
      or not exists(select 1 from public.student_purge_objects object
        where object.operation_id=v_academic.id and object.storage_bucket=old.bucket_id
          and object.storage_path=old.name and object.status='processing'
          and object.lease_expires_at>clock_timestamp()) then
      raise exception using errcode='55000',message='academic_cleanup_storage_authority_required';
    end if;
    perform public.managed_storage_exact_lock(old.bucket_id,old.name);
    return old;
  end if;
  if old.bucket_id not in ('assignment-artifacts','submission-images','test-documents',
    'classroom-archives','gradex-analytics-extracts') then return old; end if;
  v_enforced := public.lock_managed_storage_protocol();
  select * into v_object from public.managed_storage_objects object
  where object.storage_bucket = old.bucket_id and object.storage_path = old.name for update;
  perform public.managed_storage_exact_lock(old.bucket_id, old.name);
  if v_object.id is not null and (
    exists (
      select 1 from public.classroom_purge_objects purge_object
      join public.classroom_purge_operations operation on operation.id = purge_object.operation_id
      where purge_object.managed_storage_object_id = v_object.id and purge_object.status = 'processing'
        and purge_object.lease_expires_at > clock_timestamp()
        and operation.status in ('deleting_objects','failed') and (
          exists (select 1 from public.classroom_purge_fences fence where fence.operation_id = operation.id
            and fence.classroom_id = operation.classroom_id and operation.purge_scope = 'hot_classroom')
          or exists (select 1 from public.cold_classroom_purge_fences fence where fence.operation_id = operation.id
            and fence.classroom_id = operation.classroom_id and operation.purge_scope = 'cold_classroom')
        )
    ) or exists (
      select 1 from public.course_blueprint_purge_objects purge_object
      join public.course_blueprint_purge_operations operation on operation.id = purge_object.operation_id
      join public.course_blueprint_purge_fences fence on fence.operation_id = operation.id
        and fence.course_blueprint_id = operation.course_blueprint_id
      where purge_object.managed_storage_object_id = v_object.id and purge_object.status = 'processing'
        and purge_object.lease_expires_at > clock_timestamp()
        and (operation.status = 'deleting_objects' or (operation.status = 'failed' and operation.retryable is true))
    ) or exists (
      select 1 from public.student_purge_objects purge_object
      join public.student_purge_operations operation on operation.id = purge_object.operation_id
      join public.student_purge_fences fence on fence.operation_id = operation.id
        and fence.classroom_id = operation.classroom_id and fence.student_id = operation.student_id
      where purge_object.managed_storage_object_id = v_object.id and purge_object.status = 'processing'
        and purge_object.lease_expires_at > clock_timestamp()
        and (operation.status = 'deleting_objects' or (operation.status = 'failed' and operation.retryable is true))
    )
  ) then return old; end if;
  if v_object.id is null then
    if not v_enforced then return old; end if;
    raise exception using errcode = '55000', message = 'managed_storage_cleanup_authority_required';
  end if;
  if v_object.status <> 'cleanup_processing' then
    raise exception using errcode = '55000', message = 'managed_storage_cleanup_authority_required';
  end if;
  v_referenced := public.managed_storage_object_is_referenced(v_object.id)
    or case v_object.storage_bucket
      when 'assignment-artifacts' then exists (select 1 from public.assignment_submission_artifacts
        where storage_path = v_object.storage_path)
      when 'test-documents' then public.test_document_snapshot_path_is_referenced(v_object.storage_path)
      else false end;
  if v_referenced then raise exception using errcode = '55000', message = 'managed_storage_cleanup_referenced'; end if;
  return old;
end;
$$;

revoke all on function private.removed_academic_capability(uuid,text[]) from public,anon,authenticated,service_role;
revoke all on function private.authorize_removed_academic_cleanup(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.removed_academic_resources(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.removed_academic_objects(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.removed_academic_row_hash(text,uuid) from public,anon,authenticated,service_role;
revoke all on function private.removed_academic_blockers(uuid) from public,anon,authenticated,service_role;
revoke all on function private.removed_academic_fingerprint(uuid) from public,anon,authenticated,service_role;
revoke all on function private.removed_academic_delete_allowed(text,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.guard_final_student_roster_write() from public,anon,authenticated,service_role;
revoke all on function private.guard_student_provider_operation() from public,anon,authenticated,service_role;
revoke all on function private.guard_student_provider_purge_child() from public,anon,authenticated,service_role;
revoke all on function private.guard_removed_academic_parent() from public,anon,authenticated,service_role;
revoke all on function private.guard_removed_academic_reference() from public,anon,authenticated,service_role;
revoke all on function private.removed_academic_receipt(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.retain_removed_academic_roster_timestamp() from public,anon,authenticated,service_role;
revoke all on function public.advance_removed_student_academic_cleanup(uuid,uuid,uuid,uuid,uuid,text,integer,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.advance_removed_student_academic_cleanup(uuid,uuid,uuid,uuid,uuid,text,integer,uuid,uuid)
  to service_role;
comment on column public.student_purge_operations.local_academic_cleanup is
  'Local academic/file evidence only. Overall remains provider_pending; identity, resources, path tombstones and re-add fence are retained.';
commit;
