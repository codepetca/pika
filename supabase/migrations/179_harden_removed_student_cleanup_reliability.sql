-- Repair exact post-activation attendance evidence at removal time, keep
-- incomplete eligible removals observable, and let the local finalizer
-- invalidate derived caches without blocking on unrelated attendance receipts.
begin;
set local lock_timeout = '5s';

create or replace function private.enqueue_removed_student_cleanup()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_settings private.student_provider_cleanup_settings;
  v_teacher_id uuid;
  v_scope text;
  v_participant_ref text;
  v_ready boolean;
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

  if v_ready then
    perform private.kick_removed_student_cleanup('removal');
  end if;
  return new;
end;
$$;
revoke all on function private.enqueue_removed_student_cleanup()
  from public,anon,authenticated,service_role;

comment on function private.enqueue_removed_student_cleanup() is
  'Queues exact post-activation removals, repairs missing attendance generation evidence from the active exact mapping, and quarantines incomplete eligible generations for operator visibility.';

-- Daily summaries and feedback candidates are regenerated derivative caches.
-- Invalidating them removes possible target-derived text while preserving every
-- classmate source entry and all shared classroom configuration.
alter function public.student_purge_inventory_resources(uuid,uuid)
  rename to student_purge_inventory_resources_pre_v179;
alter function public.student_purge_inventory_resources_pre_v179(uuid,uuid)
  set schema private;
revoke all on function private.student_purge_inventory_resources_pre_v179(uuid,uuid)
  from public,anon,authenticated,service_role;

create function public.student_purge_inventory_resources(
  p_classroom_id uuid,p_student_id uuid)
returns table(table_name text,row_id uuid,disposition text)
language sql stable set search_path='' as $$
  select resource.table_name,resource.row_id,
    case when resource.table_name in ('log_summaries','developer_feedback_candidates')
      and resource.disposition='collateral_delete' then 'delete'
      else resource.disposition end
  from private.student_purge_inventory_resources_pre_v179(
    p_classroom_id,p_student_id) resource;
$$;
revoke all on function public.student_purge_inventory_resources(uuid,uuid)
  from public,anon,authenticated,service_role;

-- Only canonical override request receipts contain aggregate counts, occurrence
-- reference, and an irreversible request fingerprint. Target-owned override/event
-- rows are separately inventoried. Any legacy or malformed receipt keeps the
-- existing shared-data blocker instead of being treated as aggregate-only.
create function private.attendance_override_request_receipt_known(
  p_classroom_id uuid,p_request_fingerprint text,p_result jsonb)
returns boolean language plpgsql stable set search_path='' as $$
declare
  v_keys text[];
  v_applied numeric;
  v_unchanged numeric;
begin
  if p_request_fingerprint !~ '^[a-f0-9]{32}$'
    or jsonb_typeof(p_result) is distinct from 'object' then
    return false;
  end if;
  select array_agg(key order by key) into v_keys
  from jsonb_object_keys(p_result) key;
  if v_keys is distinct from array[
      'applied_count','occurrence_ref','outcome','unchanged_count']
    or jsonb_typeof(p_result->'outcome') is distinct from 'string'
    or p_result->>'outcome' is distinct from 'applied'
    or jsonb_typeof(p_result->'occurrence_ref') is distinct from 'string'
    or jsonb_typeof(p_result->'applied_count') is distinct from 'number'
    or p_result->>'applied_count' !~ '^[0-9]+$'
    or length(p_result->>'applied_count')>3
    or jsonb_typeof(p_result->'unchanged_count') is distinct from 'number'
    or p_result->>'unchanged_count' !~ '^[0-9]+$'
    or length(p_result->>'unchanged_count')>3 then
    return false;
  end if;
  v_applied:=(p_result->>'applied_count')::numeric;
  v_unchanged:=(p_result->>'unchanged_count')::numeric;
  if v_applied>200 or v_unchanged>200 or v_applied+v_unchanged not between 1 and 200
    or not exists(
      select 1 from public.attendance_occurrence_mappings occurrence
      where occurrence.classroom_id=p_classroom_id
        and occurrence.occurrence_ref=p_result->>'occurrence_ref') then
    return false;
  end if;
  return true;
end;
$$;
revoke all on function private.attendance_override_request_receipt_known(uuid,text,jsonb)
  from public,anon,authenticated,service_role;

create function private.attendance_override_request_receipts_known(
  p_classroom_id uuid)
returns boolean language sql stable set search_path='' as $$
  select not exists(
    select 1 from public.attendance_override_requests request
    where request.classroom_id=p_classroom_id
      and not private.attendance_override_request_receipt_known(
        request.classroom_id,request.request_fingerprint,request.result));
$$;
revoke all on function private.attendance_override_request_receipts_known(uuid)
  from public,anon,authenticated,service_role;

-- The application writes only canonical aggregate receipts. Serialize their
-- creation with student cleanup, and reject every noncanonical payload at the
-- write boundary, so finalization cannot race a late unsafe receipt insert.
create function private.guard_attendance_override_request_cleanup()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform private.try_lock_classroom_membership_change(new.classroom_id);
  if not private.attendance_override_request_receipt_known(
      new.classroom_id,new.request_fingerprint,new.result) then
    raise exception using errcode='22023',
      message='attendance_override_request_receipt_invalid';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_attendance_override_request_cleanup()
  from public,anon,authenticated,service_role;
create trigger guard_attendance_override_request_cleanup
  before insert on public.attendance_override_requests
  for each row execute function private.guard_attendance_override_request_cleanup();

alter function private.removed_academic_blockers(uuid)
  rename to removed_academic_blockers_pre_v179;
revoke all on function private.removed_academic_blockers_pre_v179(uuid)
  from public,anon,authenticated,service_role;

create function private.removed_academic_blockers(p_operation_id uuid)
returns text[] language plpgsql volatile set search_path='' as $$
declare
  v_blockers text[];
  v_classroom_id uuid;
begin
  v_blockers:=private.removed_academic_blockers_pre_v179(p_operation_id);
  select classroom_id into strict v_classroom_id
  from public.student_purge_operations
  where id=p_operation_id;
  if private.attendance_override_request_receipts_known(v_classroom_id) then
    v_blockers:=array_remove(
      v_blockers,'shared_attendance_request_policy_required');
  end if;
  return v_blockers;
end;
$$;
revoke all on function private.removed_academic_blockers(uuid)
  from public,anon,authenticated,service_role;

-- Submitted history remains immutable to ordinary callers. The exact
-- transaction-scoped cleanup capability already proves the row is in the
-- operation ledger, so permit its deletion before the parent document.
create or replace function public.guard_assignment_doc_history_after_submit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.assignment_docs;
  v_doc_id uuid;
begin
  if public.is_classroom_archive_maintenance_mode('restore')
    or public.is_classroom_archive_maintenance_mode('compaction') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if private.removed_academic_delete_allowed(
      'assignment_doc_history',to_jsonb(old)) then
      return old;
    end if;
    if old.trigger = 'submit' and exists (
      select 1
      from public.assignment_docs d
      where d.id = old.assignment_doc_id
    ) then
      return null;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and (old.trigger = 'submit' or new.trigger = 'submit') then
    raise exception using
      errcode = '23514',
      message = 'assignment_submit_history_immutable';
  end if;

  v_doc_id := new.assignment_doc_id;
  select * into v_doc
  from public.assignment_docs
  where id = v_doc_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'assignment_history_document_not_found';
  end if;

  if v_doc.is_submitted and new.trigger <> 'submit' then
    raise exception using
      errcode = '23514',
      message = 'assignment_history_after_submit_forbidden';
  end if;

  if tg_op = 'INSERT' and new.trigger = 'submit' then
    if new.patch is not null
      or new.snapshot is null
      or new.snapshot is distinct from v_doc.content then
      raise exception using
        errcode = '23514',
        message = 'assignment_submit_history_snapshot_invalid';
    end if;
    new.created_at := greatest(
      new.created_at,
      coalesce(v_doc.submitted_at, '-infinity'::timestamptz)
    );
    if not v_doc.is_submitted or exists (
      select 1
      from public.assignment_doc_history h
      where h.assignment_doc_id = v_doc.id
        and h.trigger = 'submit'
        and h.created_at >= coalesce(v_doc.submitted_at, '-infinity'::timestamptz)
        and h.patch is null
        and h.snapshot = v_doc.content
    ) then
      raise exception using
        errcode = '23514',
        message = 'assignment_submit_history_duplicate';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.guard_assignment_doc_history_after_submit() is
  'Preserves submitted history immutability except for an exact transaction-scoped removed-student cleanup ledger deletion.';

commit;
