-- Durable, resumable deletion of one student's data from one teacher-owned hot
-- Classroom. This scope deliberately preserves the user and every other
-- Classroom. Rollout starts disabled. Pal/remote-Gradex targets fail closed.

-- Stable joined-student lineage is operational derived state, not part of the
-- immutable Classroom archive format. Keeping it outside classroom_roster
-- avoids silently changing the v2 archive/restore row contract.
create table public.classroom_roster_student_bindings (
  roster_id uuid primary key references public.classroom_roster (id) on delete cascade,
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  unique (roster_id, classroom_id, student_id)
);

create index classroom_roster_student_bindings_classroom_student
  on public.classroom_roster_student_bindings (classroom_id, student_id);

insert into public.classroom_roster_student_bindings (roster_id, classroom_id, student_id)
select roster.id, roster.classroom_id, enrollment.student_id
from public.classroom_roster roster
join public.classroom_enrollments enrollment on enrollment.classroom_id = roster.classroom_id
join public.users student on student.id = enrollment.student_id and student.role = 'student'
where lower(btrim(student.email)) = lower(btrim(roster.email))
on conflict (roster_id) do nothing;

create table public.student_purge_settings (
  singleton boolean primary key default true check (singleton),
  rollout_mode text not null default 'disabled'
    check (rollout_mode in ('disabled', 'canary', 'enabled')),
  canary_teacher_id uuid references public.users (id) on delete restrict,
  canary_classroom_id uuid,
  canary_student_id uuid references public.users (id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (rollout_mode = 'canary' and canary_teacher_id is not null
      and canary_classroom_id is not null and canary_student_id is not null)
    or (rollout_mode <> 'canary' and canary_teacher_id is null
      and canary_classroom_id is null and canary_student_id is null)
  )
);

insert into public.student_purge_settings (singleton) values (true);

create table public.student_purge_operations (
  id uuid primary key,
  teacher_id uuid not null references public.users (id) on delete restrict,
  classroom_id uuid not null,
  student_id uuid references public.users (id) on delete set null,
  student_email text,
  student_binding_sha256 text not null check (student_binding_sha256 ~ '^[a-f0-9]{64}$'),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'inventorying'
    check (status in ('inventorying', 'deleting_objects', 'finalizing', 'completed', 'failed')),
  source_revision bigint not null check (source_revision > 0),
  impact_summary jsonb not null default '{}'::jsonb,
  resource_counts jsonb not null default '{}'::jsonb,
  storage_object_counts jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 1 check (attempt_count > 0),
  error_code text,
  retryable boolean,
  started_at timestamptz not null default clock_timestamp(),
  inventory_completed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  check ((status = 'completed') = (completed_at is not null)),
  check (status <> 'completed' or (student_id is null and student_email is null))
);

create unique index student_purge_one_active_per_classroom_student
  on public.student_purge_operations (classroom_id, student_id)
  where student_id is not null and status <> 'completed';
create index student_purge_operations_teacher_started
  on public.student_purge_operations (teacher_id, started_at desc);
create index student_purge_operations_worker
  on public.student_purge_operations (status, updated_at)
  where status in ('deleting_objects', 'finalizing', 'failed');

create table public.student_purge_resources (
  operation_id uuid not null references public.student_purge_operations (id) on delete cascade,
  table_name text not null,
  row_id uuid not null,
  disposition text not null check (disposition in ('delete', 'collateral_delete', 'redact')),
  primary key (operation_id, table_name, row_id)
);

create table public.student_purge_objects (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.student_purge_operations (id) on delete cascade,
  managed_storage_object_id uuid
    references public.managed_storage_objects (id) on delete set null,
  storage_bucket text not null check (storage_bucket in (
    'assignment-artifacts', 'submission-images', 'test-documents',
    'classroom-archives', 'gradex-analytics-extracts'
  )),
  storage_path text,
  storage_path_sha256 text not null check (storage_path_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'failed', 'deleted')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  deleted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (operation_id, managed_storage_object_id),
  unique (operation_id, storage_bucket, storage_path_sha256),
  check (storage_path is null or (
    storage_path <> '' and storage_path not like '/%' and strpos(storage_path, E'\\') = 0
    and not ('..' = any(string_to_array(storage_path, '/')))
  )),
  check (
    (status = 'processing' and lease_token is not null and lease_expires_at is not null)
    or (status <> 'processing' and lease_token is null and lease_expires_at is null)
  ),
  check ((status = 'deleted') = (deleted_at is not null))
);

create index student_purge_objects_due on public.student_purge_objects
  (next_attempt_at, created_at) where status in ('pending', 'processing', 'failed');
create index student_purge_objects_path_reservation on public.student_purge_objects
  (storage_bucket, storage_path_sha256);

create table public.student_purge_fences (
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete restrict,
  operation_id uuid not null unique references public.student_purge_operations (id) on delete cascade,
  teacher_id uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key (classroom_id, student_id)
);

alter table public.classroom_roster_student_bindings enable row level security;
alter table public.student_purge_settings enable row level security;
alter table public.student_purge_operations enable row level security;
alter table public.student_purge_resources enable row level security;
alter table public.student_purge_objects enable row level security;
alter table public.student_purge_fences enable row level security;

revoke all on table public.classroom_roster_student_bindings from public, anon, authenticated, service_role;
revoke all on table public.student_purge_settings from public, anon, authenticated, service_role;
revoke all on table public.student_purge_operations from public, anon, authenticated, service_role;
revoke all on table public.student_purge_resources from public, anon, authenticated, service_role;
revoke all on table public.student_purge_objects from public, anon, authenticated, service_role;
revoke all on table public.student_purge_fences from public, anon, authenticated, service_role;
grant select on table public.classroom_roster_student_bindings to service_role;
grant select on table public.student_purge_settings to service_role;
grant select on table public.student_purge_operations to service_role;
grant select on table public.student_purge_resources to service_role;
grant select on table public.student_purge_objects to service_role;
grant select on table public.student_purge_fences to service_role;

create or replace function public.student_purge_lock(p_classroom_id uuid, p_student_id uuid)
returns void language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('pika-student-purge-subject:' || p_student_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('pika-classroom-operation:' || p_classroom_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('pika-student-purge:' || p_classroom_id::text || ':' || p_student_id::text, 0));
end;
$$;

create or replace function public.student_purge_rollout_allows(
  p_teacher_id uuid, p_classroom_id uuid, p_student_id uuid
)
returns boolean language sql stable set search_path = public as $$
  select coalesce((
    select rollout_mode = 'enabled'
      or (rollout_mode = 'canary' and canary_teacher_id = p_teacher_id
        and canary_classroom_id = p_classroom_id and canary_student_id = p_student_id)
    from public.student_purge_settings where singleton
  ), false)
$$;

create or replace function public.student_purge_inventory_resources(
  p_classroom_id uuid, p_student_id uuid
)
returns table(table_name text, row_id uuid, disposition text)
language sql stable set search_path = public as $$
  select 'announcement_reads', read.id, 'delete'
  from public.announcement_reads read
  join public.announcements announcement on announcement.id = read.announcement_id
  where announcement.classroom_id = p_classroom_id and read.user_id = p_student_id
  union all select 'assignment_ai_grading_run_items', item.id, 'delete'
  from public.assignment_ai_grading_run_items item
  join public.assignments assignment on assignment.id = item.assignment_id
  where assignment.classroom_id = p_classroom_id and item.student_id = p_student_id
  union all select 'assignment_ai_grading_runs', run.id, 'redact'
  from public.assignment_ai_grading_runs run
  join public.assignments assignment on assignment.id = run.assignment_id
  where assignment.classroom_id = p_classroom_id and (
    run.requested_student_ids_json ? p_student_id::text
    or exists (select 1 from public.assignment_ai_grading_run_items item
      where item.run_id = run.id and item.student_id = p_student_id)
  )
  union all select 'assignment_doc_history', history.id, 'delete'
  from public.assignment_doc_history history
  join public.assignment_docs doc on doc.id = history.assignment_doc_id
  join public.assignments assignment on assignment.id = doc.assignment_id
  where assignment.classroom_id = p_classroom_id and doc.student_id = p_student_id
  union all select 'assignment_doc_save_operations', save.id, 'delete'
  from public.assignment_doc_save_operations save
  join public.assignment_docs doc on doc.id = save.assignment_doc_id
  join public.assignments assignment on assignment.id = doc.assignment_id
  where assignment.classroom_id = p_classroom_id and doc.student_id = p_student_id
  union all select 'assignment_submission_artifacts', artifact.id, 'delete'
  from public.assignment_submission_artifacts artifact
  join public.assignment_docs doc on doc.id = artifact.assignment_doc_id
  join public.assignments assignment on assignment.id = doc.assignment_id
  where assignment.classroom_id = p_classroom_id and artifact.student_id = p_student_id
  union all select 'assignment_docs', doc.id, 'delete'
  from public.assignment_docs doc join public.assignments assignment on assignment.id = doc.assignment_id
  where assignment.classroom_id = p_classroom_id and doc.student_id = p_student_id
  union all select 'assignment_feedback_entries', feedback.id, 'delete'
  from public.assignment_feedback_entries feedback
  join public.assignments assignment on assignment.id = feedback.assignment_id
  where assignment.classroom_id = p_classroom_id and feedback.student_id = p_student_id
  union all select 'assignment_repo_review_results', result.id, 'delete'
  from public.assignment_repo_review_results result
  join public.assignments assignment on assignment.id = result.assignment_id
  where assignment.classroom_id = p_classroom_id and result.student_id = p_student_id
  union all select 'assignment_repo_targets', target.id, 'delete'
  from public.assignment_repo_targets target
  join public.assignments assignment on assignment.id = target.assignment_id
  where assignment.classroom_id = p_classroom_id and target.student_id = p_student_id
  union all select 'classroom_enrollments', enrollment.id, 'delete'
  from public.classroom_enrollments enrollment
  where enrollment.classroom_id = p_classroom_id and enrollment.student_id = p_student_id
  union all select 'classroom_roster', roster.id, 'delete'
  from public.classroom_roster roster
  join public.classroom_roster_student_bindings binding on binding.roster_id = roster.id
  where binding.classroom_id = p_classroom_id and binding.student_id = p_student_id
  union all select 'entries', entry.id, 'delete'
  from public.entries entry where entry.classroom_id = p_classroom_id and entry.student_id = p_student_id
  union all select 'report_card_rows', row.id, 'delete'
  from public.report_card_rows row join public.report_cards card on card.id = row.report_card_id
  where card.classroom_id = p_classroom_id and row.student_id = p_student_id
  union all select 'survey_responses', response.id, 'delete'
  from public.survey_responses response join public.surveys survey on survey.id = response.survey_id
  where survey.classroom_id = p_classroom_id and response.student_id = p_student_id
  union all select 'test_ai_grading_run_items', item.id, 'delete'
  from public.test_ai_grading_run_items item join public.tests test on test.id = item.test_id
  where test.classroom_id = p_classroom_id and item.student_id = p_student_id
  union all select 'test_ai_grading_runs', run.id, 'redact'
  from public.test_ai_grading_runs run join public.tests test on test.id = run.test_id
  where test.classroom_id = p_classroom_id and (
    run.requested_student_ids_json ? p_student_id::text
    or exists (select 1 from public.test_ai_grading_run_items item
      where item.run_id = run.id and item.student_id = p_student_id)
  )
  union all select 'test_attempt_history', history.id, 'delete'
  from public.test_attempt_history history
  join public.test_attempts attempt on attempt.id = history.test_attempt_id
  join public.tests test on test.id = attempt.test_id
  where test.classroom_id = p_classroom_id and attempt.student_id = p_student_id
  union all select 'test_attempts', attempt.id, 'delete'
  from public.test_attempts attempt join public.tests test on test.id = attempt.test_id
  where test.classroom_id = p_classroom_id and attempt.student_id = p_student_id
  union all select 'test_focus_events', event.id, 'delete'
  from public.test_focus_events event join public.tests test on test.id = event.test_id
  where test.classroom_id = p_classroom_id and event.student_id = p_student_id
  union all select 'test_responses', response.id, 'delete'
  from public.test_responses response join public.tests test on test.id = response.test_id
  where test.classroom_id = p_classroom_id and response.student_id = p_student_id
  union all select 'test_student_availability', availability.id, 'delete'
  from public.test_student_availability availability join public.tests test on test.id = availability.test_id
  where test.classroom_id = p_classroom_id and availability.student_id = p_student_id
  union all select 'log_summaries', summary.id, 'collateral_delete'
  from public.log_summaries summary
  where summary.classroom_id = p_classroom_id and exists (
    select 1 from public.entries entry where entry.classroom_id = p_classroom_id
      and entry.student_id = p_student_id and entry.date = summary.date
  )
  union all select 'developer_feedback_candidates', candidate.id, 'collateral_delete'
  from public.developer_feedback_candidates candidate
  where candidate.source_type = 'daily_log' and exists (
    select 1 from public.entries entry where entry.classroom_id = p_classroom_id
      and entry.student_id = p_student_id
      and (p_classroom_id::text || ':' || entry.date::text) = any(candidate.source_keys)
  )
$$;

create or replace function public.student_purge_conflict(
  p_classroom_id uuid, p_student_id uuid
)
returns text language plpgsql stable set search_path = public as $$
declare v_classroom_conflict text;
begin
  if exists (select 1 from public.classroom_cold_tombstones where classroom_id = p_classroom_id) then
    return 'student_purge_cold_classroom_unsupported';
  end if;
  if exists (select 1 from public.classroom_purge_fences where classroom_id = p_classroom_id)
    or exists (select 1 from public.cold_classroom_purge_fences where classroom_id = p_classroom_id)
    or exists (select 1 from public.student_purge_fences where classroom_id = p_classroom_id)
  then return 'classroom_purge_operation_active'; end if;
  v_classroom_conflict := public.classroom_purge_conflict(p_classroom_id);
  if v_classroom_conflict is not null then return v_classroom_conflict; end if;
  if exists (
    select 1 from public.classroom_archive_operations
    where classroom_id = p_classroom_id and status not in ('completed', 'failed')
  ) then return 'classroom_archive_operation_active'; end if;
  if exists (
    select 1 from public.assignment_ai_grading_run_items item
    join public.assignments assignment on assignment.id = item.assignment_id
    join public.assignment_ai_grading_runs run on run.id = item.run_id
    where assignment.classroom_id = p_classroom_id and item.student_id = p_student_id
      and (run.status in ('queued', 'running') or item.status in ('queued', 'processing'))
  ) or exists (
    select 1 from public.test_ai_grading_run_items item
    join public.tests test on test.id = item.test_id
    join public.test_ai_grading_runs run on run.id = item.run_id
    where test.classroom_id = p_classroom_id and item.student_id = p_student_id
      and (run.status in ('queued', 'running') or item.status in ('queued', 'processing'))
  ) or exists (
    select 1 from public.assignment_repo_review_runs run
    join public.assignments assignment on assignment.id = run.assignment_id
    where assignment.classroom_id = p_classroom_id and run.status in ('queued', 'running')
  ) then return 'student_grading_operation_active'; end if;
  if exists (select 1 from public.pal_event_outbox where student_id = p_student_id)
    or exists (select 1 from public.pal_daily_log_week_configurations where student_id = p_student_id)
  then return 'student_purge_external_erasure_required'; end if;
  if exists (
    select 1 from public.assignment_ai_grading_runs run
    join public.assignments assignment on assignment.id = run.assignment_id
    where assignment.classroom_id = p_classroom_id and run.gradex_run_id is not null
      and (run.requested_student_ids_json ? p_student_id::text or exists (
        select 1 from public.assignment_ai_grading_run_items item
        where item.run_id = run.id and item.student_id = p_student_id
      ))
  ) then return 'student_purge_gradex_erasure_required'; end if;
  if exists (
    select 1 from public.classroom_retired_assessment_record_actors actor
    join public.classroom_retired_assessment_records record on record.id = actor.record_id
    where record.classroom_id = p_classroom_id and actor.actor_id = p_student_id
  ) then return 'student_purge_retired_assessment_unsupported'; end if;
  if exists (
    select 1 from public.managed_storage_objects object
    left join public.managed_storage_provisional_owners provisional on provisional.id = object.provisional_owner_id
    where (object.classroom_id = p_classroom_id or provisional.target_classroom_id = p_classroom_id)
      and object.purpose in ('student_assignment_artifact', 'student_inline_image')
      and object.created_by_user_id = p_student_id and object.data_subject_user_id is null
  ) then return 'student_purge_storage_subject_ownership_incomplete'; end if;
  if exists (
    select 1 from public.managed_storage_objects
    where classroom_id = p_classroom_id and data_subject_user_id = p_student_id
      and status in ('cleanup_pending', 'cleanup_processing')
  ) then return 'managed_storage_cleanup_active'; end if;
  return null;
end;
$$;

create or replace function public.get_student_purge_inventory(
  p_teacher_id uuid, p_classroom_id uuid, p_student_id uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_title text;
  v_email text;
  v_conflict text;
  v_resource_counts jsonb;
  v_storage_counts jsonb;
  v_relational_hash text;
  v_storage_hash text;
  v_file_count integer;
  v_file_bytes bigint;
  v_archive_count integer;
  v_gradex_count integer;
  v_source_revision bigint;
  v_rollout boolean;
  v_enforced boolean;
begin
  select classroom.title into v_title from public.classrooms classroom
  where classroom.id = p_classroom_id and classroom.teacher_id = p_teacher_id;
  if not found then return jsonb_build_object('ok', false, 'status', 404,
    'error_code', 'classroom_not_found', 'error', 'Classroom not found'); end if;
  select student.email into v_email from public.users student
  join public.classroom_enrollments enrollment on enrollment.student_id = student.id
  where student.id = p_student_id and student.role = 'student'
    and enrollment.classroom_id = p_classroom_id;
  if not found then return jsonb_build_object('ok', false, 'status', 404,
    'error_code', 'student_not_in_classroom', 'error', 'Joined student not found in classroom'); end if;

  select coalesce(jsonb_object_agg(table_name, resource_count), '{}'::jsonb)
  into v_resource_counts from (
    select table_name, count(*)::integer resource_count
    from public.student_purge_inventory_resources(p_classroom_id, p_student_id)
    group by table_name order by table_name
  ) counts;
  select encode(extensions.digest(convert_to(coalesce(string_agg(table_name || ':' || row_id::text || ':' || disposition,
    E'\n' order by table_name, row_id, disposition), ''), 'UTF8'), 'sha256'), 'hex')
  into v_relational_hash from public.student_purge_inventory_resources(p_classroom_id, p_student_id);

  with objects as (
    select object.* from public.managed_storage_objects object
    left join public.managed_storage_provisional_owners provisional
      on provisional.id = object.provisional_owner_id
    where (object.classroom_id = p_classroom_id or provisional.target_classroom_id = p_classroom_id)
      and (object.data_subject_user_id = p_student_id
        or object.purpose in ('classroom_archive', 'gradex_extract'))
  )
  select count(*)::integer, coalesce(sum(byte_size), 0)::bigint,
    count(*) filter (where purpose = 'classroom_archive')::integer,
    count(*) filter (where purpose = 'gradex_extract')::integer,
    coalesce(jsonb_object_agg(purpose, purpose_count) filter (where purpose is not null), '{}'::jsonb),
    encode(extensions.digest(convert_to(coalesce(string_agg(id::text || ':' || storage_bucket || ':' || storage_path,
      E'\n' order by id), ''), 'UTF8'), 'sha256'), 'hex')
  into v_file_count, v_file_bytes, v_archive_count, v_gradex_count, v_storage_counts, v_storage_hash
  from (select objects.*, count(*) over (partition by purpose)::integer purpose_count from objects) listed;

  v_source_revision := 1 + coalesce((select count(*) from public.student_purge_inventory_resources(
    p_classroom_id, p_student_id)), 0) + coalesce(v_file_count, 0);
  v_conflict := public.student_purge_conflict(p_classroom_id, p_student_id);
  v_rollout := public.student_purge_rollout_allows(p_teacher_id, p_classroom_id, p_student_id);
  select mode = 'enforced' into v_enforced from public.managed_storage_settings where singleton;
  return jsonb_build_object(
    'ok', true, 'status', 200, 'classroom_id', p_classroom_id,
    'classroom_title', v_title, 'student_id', p_student_id, 'student_email', v_email,
    'source_revision', v_source_revision, 'storage_inventory_sha256', v_storage_hash,
    'relational_inventory_sha256', v_relational_hash,
    'managed_file_count', coalesce(v_file_count, 0), 'managed_file_bytes', coalesce(v_file_bytes, 0),
    'archive_count', coalesce(v_archive_count, 0), 'gradex_extract_count', coalesce(v_gradex_count, 0),
    'resource_counts', v_resource_counts, 'storage_counts', coalesce(v_storage_counts, '{}'::jsonb),
    'conflicting_operation', v_conflict,
    'deletion_available', v_rollout and coalesce(v_enforced, false) and v_conflict is null,
    'unavailable_reason', case
      when not v_rollout then 'Individual-student purge is disabled'
      when not coalesce(v_enforced, false) then 'Managed storage ownership is not enforced'
      when v_conflict is not null then v_conflict else null end
  );
end;
$$;

create or replace function public.begin_student_purge(
  p_operation_id uuid, p_teacher_id uuid, p_classroom_id uuid, p_student_id uuid,
  p_confirmation text, p_expected_source_revision bigint,
  p_expected_storage_inventory_sha256 text, p_expected_relational_inventory_sha256 text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_existing public.student_purge_operations;
  v_inventory jsonb;
  v_request_sha text;
  v_student_binding_sha text;
  v_resource record;
begin
  perform public.student_purge_lock(p_classroom_id, p_student_id);
  v_student_binding_sha := encode(extensions.digest(convert_to(
    p_operation_id::text || ':' || p_student_id::text, 'UTF8'), 'sha256'), 'hex');
  v_request_sha := encode(extensions.digest(convert_to(concat_ws(':', p_teacher_id, p_classroom_id, p_student_id,
    p_expected_source_revision, p_expected_storage_inventory_sha256,
    p_expected_relational_inventory_sha256), 'UTF8'), 'sha256'), 'hex');
  select * into v_existing from public.student_purge_operations where id = p_operation_id for update;
  if found then
    if v_existing.teacher_id <> p_teacher_id or v_existing.classroom_id <> p_classroom_id
      or v_existing.student_binding_sha256 <> v_student_binding_sha
      or (v_existing.student_id is not null and v_existing.student_id <> p_student_id)
      or v_existing.request_sha256 <> v_request_sha
    then return jsonb_build_object('ok', false, 'status', 409, 'error_code', 'idempotency_conflict',
      'error', 'Idempotency key was already used for a different deletion'); end if;
    return jsonb_build_object('ok', true, 'status', case when v_existing.status = 'completed' then 200 else 202 end,
      'operation_id', p_operation_id, 'operation_status', v_existing.status, 'replayed', true);
  end if;
  v_inventory := public.get_student_purge_inventory(p_teacher_id, p_classroom_id, p_student_id);
  if not coalesce((v_inventory->>'ok')::boolean, false) then return v_inventory; end if;
  if p_confirmation is distinct from v_inventory->>'student_email' then
    return jsonb_build_object('ok', false, 'status', 400, 'error_code', 'confirmation_mismatch',
      'error', 'Type the student email exactly to confirm');
  end if;
  if not coalesce((v_inventory->>'deletion_available')::boolean, false) then
    return jsonb_build_object('ok', false, 'status', 409, 'error_code', 'student_purge_unavailable',
      'error', v_inventory->>'unavailable_reason');
  end if;
  if (v_inventory->>'source_revision')::bigint <> p_expected_source_revision
    or v_inventory->>'storage_inventory_sha256' <> p_expected_storage_inventory_sha256
    or v_inventory->>'relational_inventory_sha256' <> p_expected_relational_inventory_sha256
  then return jsonb_build_object('ok', false, 'status', 409, 'error_code', 'student_purge_inventory_changed',
    'error', 'Student data changed; review the updated impact before trying again', 'retryable', true); end if;

  insert into public.student_purge_operations (
    id, teacher_id, classroom_id, student_id, student_email, student_binding_sha256, request_sha256,
    source_revision, impact_summary, resource_counts
  ) values (
    p_operation_id, p_teacher_id, p_classroom_id, p_student_id, v_inventory->>'student_email',
    v_student_binding_sha, v_request_sha, p_expected_source_revision, v_inventory, v_inventory->'resource_counts'
  );
  insert into public.student_purge_fences (classroom_id, student_id, operation_id, teacher_id)
  values (p_classroom_id, p_student_id, p_operation_id, p_teacher_id);
  for v_resource in select * from public.student_purge_inventory_resources(p_classroom_id, p_student_id)
  loop
    insert into public.student_purge_resources (operation_id, table_name, row_id, disposition)
    values (p_operation_id, v_resource.table_name, v_resource.row_id, v_resource.disposition);
  end loop;
  insert into public.student_purge_objects (
    operation_id, managed_storage_object_id, storage_bucket, storage_path,
    storage_path_sha256, status, deleted_at
  )
  select p_operation_id, object.id, object.storage_bucket, object.storage_path,
    public.managed_storage_identity_sha256(object.storage_bucket, object.storage_path),
    case when object.status = 'deleted' then 'deleted' else 'pending' end,
    case when object.status = 'deleted' then clock_timestamp() else null end
  from public.managed_storage_objects object
  left join public.managed_storage_provisional_owners provisional
    on provisional.id = object.provisional_owner_id
  where (object.classroom_id = p_classroom_id or provisional.target_classroom_id = p_classroom_id)
    and (object.data_subject_user_id = p_student_id
      or object.purpose in ('classroom_archive', 'gradex_extract'));
  update public.student_purge_operations
  set status = case when exists (select 1 from public.student_purge_objects
      where operation_id = p_operation_id and status <> 'deleted')
    then 'deleting_objects' else 'finalizing' end,
    inventory_completed_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = p_operation_id;
  return jsonb_build_object('ok', true, 'status', 202, 'operation_id', p_operation_id,
    'operation_status', (select status from public.student_purge_operations where id = p_operation_id));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'status', 409, 'error_code', 'student_purge_operation_active',
    'error', 'A deletion is already active for this student or classroom');
end;
$$;

create or replace function public.claim_student_purge_object(
  p_operation_id uuid, p_teacher_id uuid, p_lease_seconds integer default 60
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_operation public.student_purge_operations; v_object public.student_purge_objects; v_token uuid;
begin
  select * into v_operation from public.student_purge_operations
  where id = p_operation_id and teacher_id = p_teacher_id for update;
  if not found then return jsonb_build_object('ok', false, 'status', 404,
    'error_code', 'student_purge_not_found', 'error', 'Student data deletion not found'); end if;
  if v_operation.status = 'completed' then return jsonb_build_object('ok', true, 'status', 200,
    'operation_id', p_operation_id, 'operation_status', 'completed'); end if;
  if v_operation.status = 'failed' and v_operation.retryable is false then
    return jsonb_build_object('ok', false, 'status', 409, 'error_code', v_operation.error_code,
      'error', 'Student data deletion stopped safely', 'retryable', false); end if;
  update public.student_purge_objects set status = 'failed', lease_token = null,
    lease_expires_at = null, next_attempt_at = clock_timestamp(), updated_at = clock_timestamp()
  where operation_id = p_operation_id and status = 'processing' and lease_expires_at <= clock_timestamp();
  select * into v_object from public.student_purge_objects
  where operation_id = p_operation_id and status in ('pending', 'failed')
    and next_attempt_at <= clock_timestamp() order by created_at, id for update skip locked limit 1;
  if not found then
    if exists (select 1 from public.student_purge_objects
      where operation_id = p_operation_id and status <> 'deleted')
    then return jsonb_build_object('ok', true, 'status', 202, 'operation_id', p_operation_id,
      'operation_status', v_operation.status, 'waiting_for_storage', true);
    end if;
    update public.student_purge_operations set status = 'finalizing', retryable = true,
      error_code = null, updated_at = clock_timestamp() where id = p_operation_id;
    return jsonb_build_object('ok', true, 'status', 202, 'operation_id', p_operation_id,
      'operation_status', 'finalizing');
  end if;
  v_token := gen_random_uuid();
  update public.student_purge_objects set status = 'processing', attempt_count = attempt_count + 1,
    lease_token = v_token, lease_expires_at = clock_timestamp() + make_interval(secs => greatest(15, least(p_lease_seconds, 300))),
    last_error_code = null, updated_at = clock_timestamp() where id = v_object.id;
  update public.student_purge_operations set status = 'deleting_objects', attempt_count = attempt_count + 1,
    retryable = true, error_code = null, updated_at = clock_timestamp() where id = p_operation_id;
  return jsonb_build_object('ok', true, 'status', 202, 'operation_id', p_operation_id,
    'operation_status', 'deleting_objects', 'object', jsonb_build_object(
      'id', v_object.id, 'operation_id', p_operation_id, 'storage_bucket', v_object.storage_bucket,
      'storage_path', v_object.storage_path, 'lease_token', v_token));
end;
$$;

create or replace function public.complete_student_purge_object(
  p_operation_id uuid, p_teacher_id uuid, p_object_id uuid, p_lease_token uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_classroom_id uuid; v_student_id uuid; v_bucket text; v_path text;
begin
  select operation.classroom_id, operation.student_id, object.storage_bucket, object.storage_path
  into v_classroom_id, v_student_id, v_bucket, v_path
  from public.student_purge_objects object
  join public.student_purge_operations operation on operation.id = object.operation_id
  where object.id = p_object_id and object.operation_id = p_operation_id
    and operation.teacher_id = p_teacher_id and object.status = 'processing'
    and object.lease_token = p_lease_token;
  if not found then return jsonb_build_object('ok', false, 'status', 409,
    'error_code', 'student_purge_object_lease_lost', 'error', 'Storage deletion lease expired', 'retryable', true); end if;
  perform public.student_purge_lock(v_classroom_id, v_student_id);
  perform public.managed_storage_exact_lock(v_bucket, v_path);
  if exists (select 1 from storage.objects stored where stored.bucket_id = v_bucket and stored.name = v_path) then
    raise exception using errcode = '55000', message = 'student_purge_storage_object_still_present';
  end if;
  update public.student_purge_objects object set status = 'deleted', deleted_at = clock_timestamp(),
    storage_path = null, lease_token = null, lease_expires_at = null,
    last_error_code = null, updated_at = clock_timestamp()
  from public.student_purge_operations operation
  where object.id = p_object_id and object.operation_id = p_operation_id
    and operation.id = object.operation_id and operation.teacher_id = p_teacher_id
    and object.status = 'processing' and object.lease_token = p_lease_token
    and object.lease_expires_at > clock_timestamp();
  if not found then return jsonb_build_object('ok', false, 'status', 409,
    'error_code', 'student_purge_object_lease_lost', 'error', 'Storage deletion lease expired', 'retryable', true); end if;
  return jsonb_build_object('ok', true, 'status', 202, 'operation_id', p_operation_id);
end;
$$;

create or replace function public.fail_student_purge_object(
  p_operation_id uuid, p_teacher_id uuid, p_object_id uuid, p_lease_token uuid, p_error_code text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_attempt integer;
begin
  update public.student_purge_objects object set status = 'failed', lease_token = null,
    lease_expires_at = null, last_error_code = left(coalesce(p_error_code, 'storage_delete_failed'), 200),
    next_attempt_at = clock_timestamp() + make_interval(secs => least(300, (2 ^ least(attempt_count, 8))::integer)),
    updated_at = clock_timestamp()
  from public.student_purge_operations operation
  where object.id = p_object_id and object.operation_id = p_operation_id
    and operation.id = object.operation_id and operation.teacher_id = p_teacher_id
    and object.status = 'processing' and object.lease_token = p_lease_token
  returning object.attempt_count into v_attempt;
  if not found then return jsonb_build_object('ok', false, 'status', 409,
    'error_code', 'student_purge_object_lease_lost', 'error', 'Storage deletion lease expired', 'retryable', true); end if;
  update public.student_purge_operations set status = 'failed', retryable = v_attempt < 12,
    error_code = 'student_purge_storage_delete_failed', updated_at = clock_timestamp()
  where id = p_operation_id;
  return jsonb_build_object('ok', true, 'status', 202, 'operation_id', p_operation_id,
    'operation_status', 'failed', 'retryable', v_attempt < 12);
end;
$$;

create or replace function public.finalize_student_purge(p_operation_id uuid, p_teacher_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_operation public.student_purge_operations;
  v_resource record;
  v_expected integer;
  v_actual integer;
  v_error text;
begin
  select * into v_operation from public.student_purge_operations
  where id = p_operation_id and teacher_id = p_teacher_id;
  if not found then return jsonb_build_object('ok', false, 'status', 404,
    'error_code', 'student_purge_not_found', 'error', 'Student data deletion not found'); end if;
  if v_operation.status = 'completed' then return jsonb_build_object('ok', true, 'status', 200,
    'operation_id', p_operation_id, 'operation_status', 'completed', 'replayed', true); end if;
  perform public.student_purge_lock(v_operation.classroom_id, v_operation.student_id);
  select * into v_operation from public.student_purge_operations
  where id = p_operation_id and teacher_id = p_teacher_id for update;
  if exists (select 1 from public.student_purge_objects
    where operation_id = p_operation_id and status <> 'deleted')
  then return jsonb_build_object('ok', true, 'status', 202, 'operation_id', p_operation_id,
    'operation_status', v_operation.status, 'waiting_for_storage', true); end if;
  if exists (
    select 1 from public.managed_storage_objects object
    left join public.managed_storage_provisional_owners provisional on provisional.id = object.provisional_owner_id
    left join public.student_purge_objects staged on staged.operation_id = p_operation_id
      and staged.managed_storage_object_id = object.id and staged.status = 'deleted'
    where (object.classroom_id = v_operation.classroom_id
      or provisional.target_classroom_id = v_operation.classroom_id)
      and (object.data_subject_user_id = v_operation.student_id
        or object.purpose in ('classroom_archive', 'gradex_extract')) and staged.id is null
  ) then
    update public.student_purge_operations set status = 'failed',
      error_code = 'student_purge_storage_owner_drift', retryable = false,
      updated_at = clock_timestamp() where id = p_operation_id;
    return jsonb_build_object('ok', false, 'status', 409,
      'error_code', 'student_purge_storage_owner_drift',
      'error', 'Managed storage ownership changed; deletion stopped safely', 'retryable', false);
  end if;
  begin
    update public.student_purge_operations set status = 'finalizing', updated_at = clock_timestamp()
    where id = p_operation_id;
    perform set_config('pika.student_purge_finalize', 'on', true);

    -- Shared grading runs survive, but every target identifier and aggregate
    -- contribution is removed after their exact item rows are deleted below.
    for v_resource in
      select table_name, row_id, disposition from public.student_purge_resources
      where operation_id = p_operation_id and disposition in ('delete', 'collateral_delete')
      order by case table_name
        when 'assignment_doc_history' then 10 when 'assignment_doc_save_operations' then 11
        when 'assignment_submission_artifacts' then 12 when 'assignment_ai_grading_run_items' then 13
        when 'test_ai_grading_run_items' then 14 when 'test_attempt_history' then 15
        when 'announcement_reads' then 20 when 'assignment_feedback_entries' then 21
        when 'assignment_repo_review_results' then 22 when 'assignment_repo_targets' then 23
        when 'test_focus_events' then 24 when 'test_responses' then 25
        when 'test_student_availability' then 26 when 'survey_responses' then 27
        when 'report_card_rows' then 28 when 'assignment_docs' then 30
        when 'test_attempts' then 31 when 'entries' then 32
        when 'classroom_enrollments' then 40 when 'classroom_roster' then 41
        when 'log_summaries' then 50 when 'developer_feedback_candidates' then 51 else 100 end,
        table_name, row_id
    loop
      execute format('delete from public.%I where id = $1', v_resource.table_name)
      using v_resource.row_id;
      get diagnostics v_actual = row_count;
      if v_actual <> 1 then raise exception using errcode = '40001',
        message = 'student_purge_membership_drift_' || v_resource.table_name; end if;
    end loop;

    update public.assignment_ai_grading_runs run set
      requested_student_ids_json = coalesce((select jsonb_agg(value) from jsonb_array_elements(run.requested_student_ids_json)
        where value #>> '{}' <> v_operation.student_id::text), '[]'::jsonb),
      error_samples_json = replace(coalesce(run.error_samples_json, '[]'::jsonb)::text,
        v_operation.student_id::text, '[purged-student]')::jsonb,
      selection_hash = encode(extensions.digest(convert_to(
        'student-purge:' || p_operation_id::text || ':' || run.id::text, 'UTF8'), 'sha256'), 'hex'),
      requested_count = (select count(*) from jsonb_array_elements(run.requested_student_ids_json)
        where value #>> '{}' <> v_operation.student_id::text),
      gradable_count = (select count(*) from public.assignment_ai_grading_run_items item where item.run_id = run.id),
      processed_count = (select count(*) from public.assignment_ai_grading_run_items item
        where item.run_id = run.id and item.status in ('completed', 'skipped', 'failed')),
      completed_count = (select count(*) from public.assignment_ai_grading_run_items item
        where item.run_id = run.id and item.status = 'completed'),
      skipped_missing_count = (select count(*) from public.assignment_ai_grading_run_items item
        where item.run_id = run.id and item.skip_reason = 'missing_doc'),
      skipped_empty_count = (select count(*) from public.assignment_ai_grading_run_items item
        where item.run_id = run.id and item.skip_reason = 'empty_doc'),
      failed_count = (select count(*) from public.assignment_ai_grading_run_items item
        where item.run_id = run.id and item.status = 'failed'), updated_at = clock_timestamp()
    where run.id in (select row_id from public.student_purge_resources
      where operation_id = p_operation_id and table_name = 'assignment_ai_grading_runs');

    update public.test_ai_grading_runs run set
      requested_student_ids_json = coalesce((select jsonb_agg(value) from jsonb_array_elements(run.requested_student_ids_json)
        where value #>> '{}' <> v_operation.student_id::text), '[]'::jsonb),
      error_samples_json = replace(coalesce(run.error_samples_json, '[]'::jsonb)::text,
        v_operation.student_id::text, '[purged-student]')::jsonb,
      selection_hash = encode(extensions.digest(convert_to(
        'student-purge:' || p_operation_id::text || ':' || run.id::text, 'UTF8'), 'sha256'), 'hex'),
      requested_count = (select count(*) from jsonb_array_elements(run.requested_student_ids_json)
        where value #>> '{}' <> v_operation.student_id::text),
      eligible_student_count = (select count(distinct item.student_id) from public.test_ai_grading_run_items item where item.run_id = run.id),
      queued_response_count = (select count(*) from public.test_ai_grading_run_items item where item.run_id = run.id),
      processed_count = (select count(*) from public.test_ai_grading_run_items item where item.run_id = run.id and item.status in ('completed', 'failed')),
      completed_count = (select count(*) from public.test_ai_grading_run_items item where item.run_id = run.id and item.status = 'completed'),
      failed_count = (select count(*) from public.test_ai_grading_run_items item where item.run_id = run.id and item.status = 'failed'),
      skipped_unanswered_count = 0, skipped_already_graded_count = 0, updated_at = clock_timestamp()
    where run.id in (select row_id from public.student_purge_resources
      where operation_id = p_operation_id and table_name = 'test_ai_grading_runs');

    -- Retained archive and Gradex copies are immutable and can contain the
    -- student, so delete their exact managed objects and all Classroom ledgers.
    delete from public.classroom_archive_restore_staging staging
    using public.classroom_archive_operations operation
    where staging.operation_id = operation.id and operation.classroom_id = v_operation.classroom_id;
    delete from public.classroom_archive_restore_expected_objects expected
    using public.classroom_archive_operations operation
    where expected.operation_id = operation.id and operation.classroom_id = v_operation.classroom_id;
    delete from public.classroom_archive_object_upload_cleanup cleanup
    using public.classroom_archive_operations operation
    where cleanup.operation_id = operation.id and operation.classroom_id = v_operation.classroom_id;
    delete from public.classroom_archive_snapshot_resources snapshot
    using public.classroom_archive_operations operation
    where snapshot.operation_id = operation.id and operation.classroom_id = v_operation.classroom_id;
    delete from public.classroom_archive_snapshot_actors snapshot
    using public.classroom_archive_operations operation
    where snapshot.operation_id = operation.id and operation.classroom_id = v_operation.classroom_id;
    delete from public.classroom_gradex_extract_cleanup cleanup
    using public.classroom_archive_operations operation
    where cleanup.operation_id = operation.id and operation.classroom_id = v_operation.classroom_id;
    delete from public.classroom_gradex_extracts where classroom_id = v_operation.classroom_id;
    delete from public.classroom_archive_source_object_cleanup where classroom_id = v_operation.classroom_id;
    delete from public.classroom_archive_source_object_reservations reservation
    using public.classroom_archive_operations operation
    where reservation.operation_id = operation.id and operation.classroom_id = v_operation.classroom_id;
    delete from public.classroom_archives where classroom_id = v_operation.classroom_id;
    delete from public.classroom_archive_operations where classroom_id = v_operation.classroom_id;

    delete from public.assignment_artifact_storage_cleanup cleanup
    where cleanup.managed_object_id in (select managed_storage_object_id from public.student_purge_objects
      where operation_id = p_operation_id);
    delete from public.test_document_snapshot_storage_cleanup cleanup
    where cleanup.managed_object_id in (select managed_storage_object_id from public.student_purge_objects
      where operation_id = p_operation_id);
    delete from public.managed_storage_objects object using public.student_purge_objects staged
    where staged.operation_id = p_operation_id and staged.managed_storage_object_id = object.id;

    update public.student_purge_operations set status = 'completed', student_id = null,
      student_email = null, impact_summary = jsonb_build_object(
        'relational_rows_deleted', (select count(*) from public.student_purge_resources
          where operation_id = p_operation_id and disposition <> 'redact'),
        'shared_rows_redacted', (select count(*) from public.student_purge_resources
          where operation_id = p_operation_id and disposition = 'redact'),
        'managed_files_deleted', (select count(*) from public.student_purge_objects where operation_id = p_operation_id)
      ), retryable = false, error_code = null, completed_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = p_operation_id;
    delete from public.student_purge_resources where operation_id = p_operation_id;
    delete from public.student_purge_fences where operation_id = p_operation_id;
    return jsonb_build_object('ok', true, 'status', 200, 'operation_id', p_operation_id,
      'operation_status', 'completed');
  exception when others then
    v_error := case when sqlstate = '40001' then left(sqlerrm, 160)
      when sqlstate like '23%' then 'student_purge_constraint_drift' else 'student_purge_finalize_failed' end;
    update public.student_purge_operations set status = 'failed', error_code = v_error,
      retryable = sqlstate not in ('40001', '23503', '23505'), updated_at = clock_timestamp()
    where id = p_operation_id;
    return jsonb_build_object('ok', false, 'status', 500, 'error_code', v_error,
      'error', 'Student data deletion paused before database finalization',
      'retryable', sqlstate not in ('40001', '23503', '23505'));
  end;
end;
$$;

-- Enrollment is authoritative. Once a roster row is bound, later display-email
-- edits cannot retarget its joined-student identity.
create or replace function public.bind_classroom_roster_student()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.classroom_id is distinct from old.classroom_id
    and exists (select 1 from public.classroom_roster_student_bindings where roster_id = old.id)
  then raise exception using errcode = '55000', message = 'roster_student_binding_classroom_immutable'; end if;
  insert into public.classroom_roster_student_bindings (roster_id, classroom_id, student_id)
  select new.id, new.classroom_id, enrollment.student_id
  from public.classroom_enrollments enrollment
  join public.users student on student.id = enrollment.student_id and student.role = 'student'
  where enrollment.classroom_id = new.classroom_id
    and lower(btrim(student.email)) = lower(btrim(new.email))
  order by enrollment.created_at, enrollment.id
  limit 1
  on conflict (roster_id) do nothing;
  return new;
end;
$$;
create trigger bind_classroom_roster_student
  after insert or update of classroom_id, email on public.classroom_roster
  for each row execute function public.bind_classroom_roster_student();

create or replace function public.bind_roster_after_enrollment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.classroom_roster_student_bindings (roster_id, classroom_id, student_id)
  select roster.id, new.classroom_id, new.student_id
  from public.classroom_roster roster
  join public.users student on student.id = new.student_id and student.role = 'student'
  where roster.classroom_id = new.classroom_id
    and lower(btrim(roster.email)) = lower(btrim(student.email))
  on conflict (roster_id) do nothing;
  return new;
end;
$$;
create trigger bind_roster_after_enrollment
  after insert on public.classroom_enrollments for each row execute function public.bind_roster_after_enrollment();

-- Mutual exclusion with whole-Classroom deletion. Both directions are enforced
-- by trigger as well as startup checks so neither operation can win a race.
create or replace function public.reject_conflicting_purge_fence()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('pika-classroom-operation:' || new.classroom_id::text, 0));
  if tg_table_name = 'student_purge_fences' then
    if exists (select 1 from public.classroom_purge_fences where classroom_id = new.classroom_id)
      or exists (select 1 from public.cold_classroom_purge_fences where classroom_id = new.classroom_id)
    then raise exception using errcode = '55000', message = 'classroom_purge_operation_active'; end if;
  elsif exists (select 1 from public.student_purge_fences where classroom_id = new.classroom_id) then
    raise exception using errcode = '55000', message = 'student_purge_operation_active';
  end if;
  return new;
end;
$$;
create trigger student_purge_fence_conflict before insert on public.student_purge_fences
  for each row execute function public.reject_conflicting_purge_fence();
create trigger hot_purge_student_fence_conflict before insert on public.classroom_purge_fences
  for each row execute function public.reject_conflicting_purge_fence();
create trigger cold_purge_student_fence_conflict before insert on public.cold_classroom_purge_fences
  for each row execute function public.reject_conflicting_purge_fence();

-- Pair-specific writer fence for direct student/Classroom resources and
-- managed-file ownership. Finalization opts in only inside its transaction.
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

do $$ declare v_table text; begin
  foreach v_table in array array[
    'entries','classroom_enrollments','classroom_roster','managed_storage_objects',
    'assignment_docs','assignment_feedback_entries','assignment_repo_review_results',
    'assignment_repo_targets','assignment_submission_artifacts','assignment_ai_grading_run_items',
    'test_attempts','test_responses','test_focus_events','test_student_availability',
    'test_ai_grading_run_items','survey_responses','announcement_reads','report_card_rows',
    'pal_event_outbox','pal_daily_log_week_configurations'
  ] loop
    execute format('create trigger student_purge_guard_%I before insert or update or delete on public.%I
      for each row execute function public.reject_student_resource_change_during_purge()', v_table, v_table);
  end loop;
end $$;

create or replace function public.reject_archive_operation_during_student_purge()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('pika.student_purge_finalize', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and old.classroom_id::text > new.classroom_id::text then
    perform pg_advisory_xact_lock(hashtextextended('pika-classroom-operation:' || new.classroom_id::text, 0));
    perform pg_advisory_xact_lock(hashtextextended('pika-classroom-operation:' || old.classroom_id::text, 0));
  else
    perform pg_advisory_xact_lock(hashtextextended('pika-classroom-operation:'
      || case when tg_op = 'INSERT' then new.classroom_id::text else old.classroom_id::text end, 0));
    if tg_op = 'UPDATE' and new.classroom_id is distinct from old.classroom_id then
      perform pg_advisory_xact_lock(hashtextextended('pika-classroom-operation:' || new.classroom_id::text, 0));
    end if;
  end if;
  if exists (select 1 from public.student_purge_fences
    where classroom_id = case when tg_op = 'INSERT' then new.classroom_id else old.classroom_id end)
    or (tg_op = 'UPDATE' and exists (select 1 from public.student_purge_fences where classroom_id = new.classroom_id))
  then
    raise exception using errcode = '55000', message = 'student_purge_active';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger classroom_archive_operation_student_purge_guard
  before insert or update or delete on public.classroom_archive_operations
  for each row execute function public.reject_archive_operation_during_student_purge();

-- Retain every purged bucket/path digest permanently. This closes the delayed
-- upload race after the managed row and active fence have been removed.
create or replace function public.reject_student_purged_storage_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.bucket_id in ('assignment-artifacts','submission-images','test-documents',
      'classroom-archives','gradex-analytics-extracts') and exists (
    select 1 from public.student_purge_objects purge_object
    where purge_object.storage_bucket = new.bucket_id
      and purge_object.storage_path_sha256 =
        public.managed_storage_identity_sha256(new.bucket_id, new.name)
  ) then
    raise exception using errcode = '55000', message = 'student_purge_path_reserved';
  end if;
  return new;
end;
$$;
create trigger storage_student_purge_path_reservation
  before insert or update on storage.objects
  for each row execute function public.reject_student_purged_storage_write();

create or replace function public.reject_student_indirect_change_during_purge()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb;
  v_rows jsonb[] := case when tg_op = 'INSERT' then array[to_jsonb(new)]
    when tg_op = 'DELETE' then array[to_jsonb(old)] else array[to_jsonb(old), to_jsonb(new)] end;
  v_classroom_id uuid;
  v_student_id uuid;
begin
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

do $$ declare v_table text; begin
  foreach v_table in array array[
    'assignment_doc_history','assignment_doc_save_operations','test_attempt_history',
    'assignment_ai_grading_runs','test_ai_grading_runs','log_summaries','developer_feedback_candidates'
  ] loop
    execute format('create trigger student_purge_indirect_guard_%I before insert or update or delete on public.%I
      for each row execute function public.reject_student_indirect_change_during_purge()', v_table, v_table);
  end loop;
end $$;

-- Extend storage delete authority with an exact live student-purge lease.
create or replace function public.enforce_managed_storage_object_delete()
returns trigger language plpgsql security definer set search_path = public, storage as $$
declare v_enforced boolean; v_object public.managed_storage_objects; v_referenced boolean;
begin
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

-- Lightweight health probe used by the existing cleanup cron/monitoring path.
create or replace function public.get_student_purge_health_snapshot(
  p_stuck_minutes integer default 30, p_failed_minutes integer default 15
)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'captured_at', clock_timestamp(),
    'active_count', count(*) filter (where status in ('inventorying','deleting_objects','finalizing')),
    'stuck_count', count(*) filter (where status in ('inventorying','deleting_objects','finalizing')
      and updated_at < clock_timestamp() - make_interval(mins => greatest(p_stuck_minutes, 1))),
    'failed_count', count(*) filter (where status = 'failed'
      and updated_at < clock_timestamp() - make_interval(mins => greatest(p_failed_minutes, 1))),
    'orphan_fence_count', (select count(*) from public.student_purge_fences fence
      left join public.student_purge_operations operation on operation.id = fence.operation_id
      where operation.id is null or operation.status = 'completed'),
    'processing_lease_drift_count', (select count(*) from public.student_purge_objects
      where (status = 'processing') <> (lease_token is not null and lease_expires_at is not null))
  ) from public.student_purge_operations
$$;

revoke all on function public.student_purge_lock(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.student_purge_rollout_allows(uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.student_purge_inventory_resources(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.student_purge_conflict(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_student_purge_inventory(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.begin_student_purge(uuid,uuid,uuid,uuid,text,bigint,text,text) from public, anon, authenticated;
revoke all on function public.claim_student_purge_object(uuid,uuid,integer) from public, anon, authenticated;
revoke all on function public.complete_student_purge_object(uuid,uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.fail_student_purge_object(uuid,uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.finalize_student_purge(uuid,uuid) from public, anon, authenticated;
revoke all on function public.get_student_purge_health_snapshot(integer,integer) from public, anon, authenticated;
revoke all on function public.bind_classroom_roster_student() from public, anon, authenticated, service_role;
revoke all on function public.bind_roster_after_enrollment() from public, anon, authenticated, service_role;
revoke all on function public.reject_conflicting_purge_fence() from public, anon, authenticated, service_role;
revoke all on function public.reject_student_resource_change_during_purge() from public, anon, authenticated, service_role;
revoke all on function public.reject_archive_operation_during_student_purge() from public, anon, authenticated, service_role;
revoke all on function public.reject_student_purged_storage_write() from public, anon, authenticated, service_role;
revoke all on function public.reject_student_indirect_change_during_purge() from public, anon, authenticated, service_role;
grant execute on function public.get_student_purge_inventory(uuid,uuid,uuid) to service_role;
grant execute on function public.begin_student_purge(uuid,uuid,uuid,uuid,text,bigint,text,text) to service_role;
grant execute on function public.claim_student_purge_object(uuid,uuid,integer) to service_role;
grant execute on function public.complete_student_purge_object(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.fail_student_purge_object(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function public.finalize_student_purge(uuid,uuid) to service_role;
grant execute on function public.get_student_purge_health_snapshot(integer,integer) to service_role;

comment on table public.student_purge_settings is
  'Disabled-by-default rollout gate for hot-Classroom individual-student purge.';
comment on table public.student_purge_resources is
  'Exact relational deletion/redaction snapshot; never inferred from cascades at finalization.';
comment on table public.student_purge_objects is
  'Exact managed-object deletion ledger with durable leases and retries.';
