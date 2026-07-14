-- Verified, export-only classroom archives. This migration does not delete hot classroom data.

create table if not exists public.classroom_archive_resource_contract (
  table_name text primary key,
  primary_key_columns text[] not null,
  parent_table text,
  parent_column text,
  actor_columns text[] not null default array[]::text[],
  restore_after text[] not null,
  export_position integer not null unique,
  check (cardinality(primary_key_columns) = 1),
  check (
    (table_name = 'classrooms' and parent_table is null and parent_column is null)
    or
    (table_name <> 'classrooms' and parent_table is not null and parent_column is not null)
  )
);

insert into public.classroom_archive_resource_contract (
  table_name,
  primary_key_columns,
  parent_table,
  parent_column,
  restore_after,
  export_position
)
values
  ('classrooms', array['id'], null, null, array[]::text[], 0),
  ('announcements', array['id'], 'classrooms', 'classroom_id', array['classrooms'], 1),
  ('assessment_drafts', array['id'], 'classrooms', 'classroom_id', array['classrooms'], 2),
  ('assignments', array['id'], 'classrooms', 'classroom_id', array['classrooms'], 3),
  ('class_days', array['id'], 'classrooms', 'classroom_id', array['classrooms'], 4),
  ('classroom_enrollments', array['id'], 'classrooms', 'classroom_id', array['classrooms'], 5),
  ('classroom_resources', array['id'], 'classrooms', 'classroom_id', array['classrooms'], 6),
  ('classroom_roster', array['id'], 'classrooms', 'classroom_id', array['classrooms'], 7),
  ('classwork_materials', array['id'], 'classrooms', 'classroom_id', array['classrooms'], 8),
  ('entries', array['id'], 'classrooms', 'classroom_id', array['classrooms'], 9),
  ('gradebook_settings', array['classroom_id'], 'classrooms', 'classroom_id', array['classrooms'], 10),
  ('lesson_plans', array['id'], 'classrooms', 'classroom_id', array['classrooms'], 11),
  ('log_summaries', array['id'], 'classrooms', 'classroom_id', array['classrooms'], 12),
  ('quizzes', array['id'], 'classrooms', 'classroom_id', array['classrooms'], 13),
  ('report_cards', array['id'], 'classrooms', 'classroom_id', array['classrooms'], 14),
  ('surveys', array['id'], 'classrooms', 'classroom_id', array['classrooms'], 15),
  ('tests', array['id'], 'classrooms', 'classroom_id', array['classrooms'], 16),
  ('announcement_reads', array['id'], 'announcements', 'announcement_id', array['announcements'], 17),
  ('assignment_ai_grading_runs', array['id'], 'assignments', 'assignment_id', array['assignments'], 18),
  ('assignment_docs', array['id'], 'assignments', 'assignment_id', array['assignments'], 19),
  ('assignment_feedback_entries', array['id'], 'assignments', 'assignment_id', array['assignments'], 20),
  ('assignment_repo_review_runs', array['id'], 'assignments', 'assignment_id', array['assignments'], 21),
  ('assignment_repo_targets', array['id'], 'assignments', 'assignment_id', array['assignments'], 22),
  ('assignment_submission_requirements', array['id'], 'assignments', 'assignment_id', array['assignments'], 23),
  ('quiz_questions', array['id'], 'quizzes', 'quiz_id', array['quizzes'], 24),
  ('quiz_student_scores', array['id'], 'quizzes', 'quiz_id', array['quizzes'], 25),
  ('report_card_rows', array['id'], 'report_cards', 'report_card_id', array['report_cards'], 26),
  ('survey_questions', array['id'], 'surveys', 'survey_id', array['surveys'], 27),
  ('test_ai_grading_runs', array['id'], 'tests', 'test_id', array['tests'], 28),
  ('test_attempts', array['id'], 'tests', 'test_id', array['tests'], 29),
  ('test_focus_events', array['id'], 'tests', 'test_id', array['tests'], 30),
  ('test_questions', array['id'], 'tests', 'test_id', array['tests'], 31),
  ('test_student_availability', array['id'], 'tests', 'test_id', array['tests'], 32),
  ('assignment_ai_grading_run_items', array['id'], 'assignment_ai_grading_runs', 'run_id', array['assignment_ai_grading_runs', 'assignment_docs', 'assignments'], 33),
  ('assignment_doc_history', array['id'], 'assignment_docs', 'assignment_doc_id', array['assignment_docs'], 34),
  ('assignment_repo_review_results', array['id'], 'assignment_repo_review_runs', 'run_id', array['assignment_repo_review_runs', 'assignments'], 35),
  ('assignment_submission_artifacts', array['id'], 'assignment_docs', 'assignment_doc_id', array['assignment_docs', 'assignment_submission_requirements'], 36),
  ('quiz_responses', array['id'], 'quizzes', 'quiz_id', array['quizzes', 'quiz_questions'], 37),
  ('survey_responses', array['id'], 'surveys', 'survey_id', array['surveys', 'survey_questions'], 38),
  ('test_attempt_history', array['id'], 'test_attempts', 'test_attempt_id', array['test_attempts'], 39),
  ('test_responses', array['id'], 'tests', 'test_id', array['tests', 'test_questions'], 40),
  ('test_ai_grading_run_items', array['id'], 'test_ai_grading_runs', 'run_id', array['test_ai_grading_runs', 'test_questions', 'test_responses', 'tests'], 41)
on conflict (table_name) do update
set
  primary_key_columns = excluded.primary_key_columns,
  parent_table = excluded.parent_table,
  parent_column = excluded.parent_column,
  restore_after = excluded.restore_after,
  export_position = excluded.export_position;

update public.classroom_archive_resource_contract
set actor_columns = case table_name
  when 'announcement_reads' then array['user_id']
  when 'announcements' then array['created_by']
  when 'assessment_drafts' then array['created_by', 'updated_by']
  when 'assignment_ai_grading_run_items' then array['student_id']
  when 'assignment_ai_grading_runs' then array['triggered_by']
  when 'assignment_docs' then array['student_id']
  when 'assignment_feedback_entries' then array['created_by', 'student_id']
  when 'assignment_repo_review_results' then array['student_id']
  when 'assignment_repo_review_runs' then array['triggered_by']
  when 'assignment_repo_targets' then array['student_id']
  when 'assignment_submission_artifacts' then array['student_id']
  when 'assignments' then array['created_by']
  when 'classroom_enrollments' then array['student_id']
  when 'classroom_resources' then array['updated_by']
  when 'classrooms' then array['teacher_id']
  when 'classwork_materials' then array['created_by']
  when 'entries' then array['student_id']
  when 'quiz_responses' then array['student_id']
  when 'quiz_student_scores' then array['student_id']
  when 'quizzes' then array['created_by']
  when 'report_card_rows' then array['student_id']
  when 'report_cards' then array['created_by']
  when 'survey_responses' then array['student_id']
  when 'surveys' then array['created_by']
  when 'test_ai_grading_run_items' then array['student_id']
  when 'test_ai_grading_runs' then array['triggered_by']
  when 'test_attempts' then array['closed_for_grading_by', 'returned_by', 'student_id']
  when 'test_focus_events' then array['student_id']
  when 'test_responses' then array['graded_by', 'student_id']
  when 'test_student_availability' then array['student_id', 'updated_by']
  when 'tests' then array['created_by']
  else array[]::text[]
end;

create table if not exists public.classroom_archive_revisions (
  classroom_id uuid primary key,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

insert into public.classroom_archive_revisions (classroom_id)
select id from public.classrooms
on conflict (classroom_id) do nothing;

create or replace function public.resolve_classroom_archive_resource_classroom_id(
  p_table_name text,
  p_row_id uuid
)
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  v_parent_table text;
  v_parent_column text;
  v_primary_key_column text;
  v_parent_id uuid;
begin
  if p_row_id is null then
    return null;
  end if;
  if p_table_name = 'classrooms' then
    return p_row_id;
  end if;

  select parent_table, parent_column, primary_key_columns[1]
  into v_parent_table, v_parent_column, v_primary_key_column
  from public.classroom_archive_resource_contract
  where table_name = p_table_name;

  if v_parent_table is null or v_parent_column is null then
    raise exception 'Unknown classroom archive resource: %', p_table_name
      using errcode = '22023';
  end if;

  execute format(
    'select %I from public.%I where %I = $1',
    v_parent_column,
    p_table_name,
    v_primary_key_column
  )
  into v_parent_id
  using p_row_id;

  return public.resolve_classroom_archive_resource_classroom_id(
    v_parent_table,
    v_parent_id
  );
end;
$$;

create or replace function public.bump_classroom_archive_revision_from_classroom()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.classroom_archive_revisions (classroom_id)
    values (new.id)
    on conflict (classroom_id) do nothing;
    return new;
  end if;

  if tg_op = 'DELETE' then
    delete from public.classroom_archive_revisions
    where classroom_id = old.id;
    return old;
  end if;

  update public.classroom_archive_revisions
  set revision = revision + 1, updated_at = now()
  where classroom_id = old.id;
  return new;
end;
$$;

drop trigger if exists classroom_archive_revision_from_classroom on public.classrooms;
create trigger classroom_archive_revision_from_classroom
  after insert or update or delete on public.classrooms
  for each row
  execute function public.bump_classroom_archive_revision_from_classroom();

create or replace function public.bump_classroom_archive_revision_from_resource()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_parent_table text := tg_argv[0];
  v_parent_column text := tg_argv[1];
  v_old_parent_id uuid;
  v_new_parent_id uuid;
  v_old_classroom_id uuid;
  v_new_classroom_id uuid;
begin
  if tg_op <> 'INSERT' then
    v_old_parent_id := nullif(to_jsonb(old)->>v_parent_column, '')::uuid;
    v_old_classroom_id := public.resolve_classroom_archive_resource_classroom_id(
      v_parent_table,
      v_old_parent_id
    );
  end if;
  if tg_op <> 'DELETE' then
    v_new_parent_id := nullif(to_jsonb(new)->>v_parent_column, '')::uuid;
    v_new_classroom_id := public.resolve_classroom_archive_resource_classroom_id(
      v_parent_table,
      v_new_parent_id
    );
  end if;

  update public.classroom_archive_revisions
  set revision = revision + 1, updated_at = now()
  where classroom_id = v_old_classroom_id;

  if v_new_classroom_id is distinct from v_old_classroom_id then
    update public.classroom_archive_revisions
    set revision = revision + 1, updated_at = now()
    where classroom_id = v_new_classroom_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  v_resource record;
begin
  for v_resource in
    select table_name, primary_key_columns[1] as primary_key_column, parent_table, parent_column
    from public.classroom_archive_resource_contract
    where table_name <> 'classrooms'
    order by export_position
  loop
    execute format('drop trigger if exists %I on public.%I',
      'car_' || v_resource.table_name,
      v_resource.table_name
    );
    execute format(
      'create trigger %I before insert or update or delete on public.%I for each row execute function public.bump_classroom_archive_revision_from_resource(%L, %L)',
      'car_' || v_resource.table_name,
      v_resource.table_name,
      v_resource.parent_table,
      v_resource.parent_column
    );
  end loop;
end;
$$;

create table if not exists public.classroom_archive_operations (
  id uuid primary key,
  teacher_id uuid not null,
  classroom_id uuid not null,
  operation_type text not null default 'export'
    check (operation_type in ('export', 'restore', 'compact', 'cleanup', 'gradex_extract', 'purge')),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('snapshot_ready', 'completed', 'failed')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  source_revision bigint not null check (source_revision > 0),
  source_schema_migration text not null,
  source_app_commit text not null,
  retention jsonb not null,
  resource_counts jsonb not null default '{}'::jsonb,
  storage_object_counts jsonb not null default '{}'::jsonb,
  archive_id uuid,
  storage_bucket text,
  storage_path text,
  artifact_sha256 text,
  content_sha256 text,
  compressed_byte_size bigint,
  uncompressed_byte_size bigint,
  verification jsonb,
  error_code text,
  retryable boolean,
  snapshot_created_at timestamptz not null,
  snapshot_expires_at timestamptz not null,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_classroom_archive_operations_classroom_created
  on public.classroom_archive_operations (classroom_id, snapshot_created_at desc);
create index if not exists idx_classroom_archive_operations_status_expiry
  on public.classroom_archive_operations (status, snapshot_expires_at);

create table if not exists public.classroom_archive_object_upload_cleanup (
  operation_id uuid not null references public.classroom_archive_operations (id) on delete cascade,
  storage_bucket text not null check (storage_bucket in (
    'classroom-archives', 'assignment-artifacts', 'submission-images', 'test-documents'
  )),
  storage_path text not null check (
    storage_path <> '' and storage_path not like '/%' and strpos(storage_path, E'\\') = 0
  ),
  expected_sha256 text not null check (expected_sha256 ~ '^[a-f0-9]{64}$'),
  expected_byte_size bigint not null check (expected_byte_size >= 0),
  status text not null default 'staged'
    check (status in ('staged', 'pending', 'processing', 'failed', 'deleted')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  deleted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (operation_id, storage_bucket, storage_path),
  check (
    (status = 'processing' and lease_token is not null and lease_expires_at is not null)
    or (status <> 'processing' and lease_token is null and lease_expires_at is null)
  ),
  check ((status = 'deleted') = (deleted_at is not null))
);

create index idx_classroom_archive_object_upload_cleanup_due
  on public.classroom_archive_object_upload_cleanup (status, next_attempt_at);

create table if not exists public.classroom_archive_snapshot_resources (
  operation_id uuid not null references public.classroom_archive_operations (id) on delete cascade,
  table_name text not null references public.classroom_archive_resource_contract (table_name),
  row_id uuid not null,
  primary key (operation_id, table_name, row_id)
);

create index if not exists idx_classroom_archive_snapshot_resources_operation_table
  on public.classroom_archive_snapshot_resources (operation_id, table_name, row_id);

create table if not exists public.classroom_archive_snapshot_actors (
  operation_id uuid not null references public.classroom_archive_operations (id) on delete cascade,
  actor_id uuid not null,
  snapshot jsonb not null,
  primary key (operation_id, actor_id)
);

create table if not exists public.classroom_archives (
  id uuid primary key,
  operation_id uuid not null unique references public.classroom_archive_operations (id),
  classroom_id uuid not null,
  teacher_id uuid not null,
  format text not null check (format = 'pika.classroom-archive'),
  format_version integer not null check (format_version = 1),
  source_revision bigint not null,
  source_schema_migration text not null,
  source_app_commit text not null,
  storage_bucket text not null check (storage_bucket = 'classroom-archives'),
  storage_path text not null unique,
  artifact_sha256 text not null check (artifact_sha256 ~ '^[a-f0-9]{64}$'),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  compressed_byte_size bigint not null check (compressed_byte_size > 0),
  uncompressed_byte_size bigint not null check (uncompressed_byte_size > 0),
  resource_counts jsonb not null,
  storage_object_counts jsonb not null,
  verification jsonb not null,
  retention jsonb not null,
  created_at timestamptz not null,
  verified_at timestamptz not null,
  check (verified_at >= created_at)
);

create index if not exists idx_classroom_archives_classroom_created
  on public.classroom_archives (classroom_id, created_at desc);

alter table public.classroom_archive_resource_contract enable row level security;
alter table public.classroom_archive_revisions enable row level security;
alter table public.classroom_archive_operations enable row level security;
alter table public.classroom_archive_snapshot_resources enable row level security;
alter table public.classroom_archive_snapshot_actors enable row level security;
alter table public.classroom_archive_object_upload_cleanup enable row level security;
alter table public.classroom_archives enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'classroom-archives',
  'classroom-archives',
  false,
  52428800,
  array['application/gzip']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 52428800,
  allowed_mime_types = array['application/gzip'];

create or replace function public.begin_classroom_archive_export(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_request_sha256 text,
  p_source_schema_migration text,
  p_source_app_commit text,
  p_retention jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_operation public.classroom_archive_operations;
  v_resource record;
  v_actor_column text;
  v_teacher_id uuid;
  v_archived_at timestamptz;
  v_revision bigint;
  v_counts jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_request_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid classroom archive request hash'
      using errcode = '22023';
  end if;
  if p_source_schema_migration !~ '^\d{3}(?:_[a-z0-9_]+)?$'
    or p_source_app_commit !~ '^[a-f0-9]{7,40}$'
  then
    raise exception 'Invalid classroom archive source version'
      using errcode = '22023';
  end if;
  if p_retention is null
    or jsonb_typeof(p_retention) <> 'object'
    or coalesce(p_retention->>'mode', '') not in ('teacher_managed', 'scheduled')
    or p_retention - 'mode' - 'delete_after' <> '{}'::jsonb
    or (
      p_retention->>'mode' = 'teacher_managed'
      and p_retention->'delete_after' is distinct from 'null'::jsonb
    )
    or (
      p_retention->>'mode' = 'scheduled'
      and (
        jsonb_typeof(p_retention->'delete_after') is distinct from 'string'
        or (p_retention->>'delete_after')::timestamptz <= v_now
      )
    )
  then
    raise exception 'Invalid classroom archive retention policy'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));

  select *
  into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
  for update;

  if found then
    if v_operation.teacher_id <> p_teacher_id
      or v_operation.classroom_id <> p_classroom_id
      or v_operation.operation_type <> 'export'
      or v_operation.request_sha256 <> p_request_sha256
    then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'operation_id', p_operation_id,
        'error_code', 'idempotency_conflict',
        'error', 'Idempotency key was already used for a different archive request',
        'retryable', false
      );
    end if;

    if v_operation.status = 'completed' then
      return jsonb_build_object(
        'ok', true,
        'status', 200,
        'operation_id', p_operation_id,
        'archive_id', v_operation.archive_id,
        'operation_status', 'completed',
        'replayed', true,
        'snapshot_created_at', v_operation.snapshot_created_at,
        'snapshot_expires_at', v_operation.snapshot_expires_at,
        'source_revision', v_operation.source_revision,
        'resource_counts', v_operation.resource_counts,
        'storage_bucket', v_operation.storage_bucket,
        'storage_path', v_operation.storage_path,
        'artifact_sha256', v_operation.artifact_sha256,
        'content_sha256', v_operation.content_sha256,
        'compressed_byte_size', v_operation.compressed_byte_size,
        'uncompressed_byte_size', v_operation.uncompressed_byte_size,
        'storage_object_counts', v_operation.storage_object_counts,
        'verification', v_operation.verification
      );
    end if;

    if v_operation.status = 'failed' and v_operation.retryable is false then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'operation_id', p_operation_id,
        'error_code', v_operation.error_code,
        'error', 'Archive operation failed and requires a new idempotency key',
        'retryable', false
      );
    end if;

    if v_operation.snapshot_expires_at > v_now
      and exists (
        select 1
        from public.classroom_archive_snapshot_resources
        where operation_id = p_operation_id
      )
    then
      update public.classroom_archive_operations
      set
        status = 'snapshot_ready',
        attempt_count = case
          when status = 'failed' then attempt_count + 1
          else attempt_count
        end,
        error_code = null,
        retryable = null,
        updated_at = v_now
      where id = p_operation_id
      returning * into v_operation;

      return jsonb_build_object(
        'ok', true,
        'status', 202,
        'operation_id', p_operation_id,
        'archive_id', p_operation_id,
        'operation_status', 'snapshot_ready',
        'replayed', true,
        'snapshot_created_at', v_operation.snapshot_created_at,
        'snapshot_expires_at', v_operation.snapshot_expires_at,
        'source_revision', v_operation.source_revision,
        'resource_counts', v_operation.resource_counts
      );
    end if;
  end if;

  select classroom.teacher_id, classroom.archived_at, revision.revision
  into v_teacher_id, v_archived_at, v_revision
  from public.classrooms classroom
  join public.classroom_archive_revisions revision
    on revision.classroom_id = classroom.id
  where classroom.id = p_classroom_id
  for share of revision;

  if v_teacher_id is null then
    return jsonb_build_object(
      'ok', false,
      'status', 404,
      'operation_id', p_operation_id,
      'error_code', 'classroom_not_found',
      'error', 'Classroom not found',
      'retryable', false
    );
  end if;
  if v_teacher_id <> p_teacher_id then
    return jsonb_build_object(
      'ok', false,
      'status', 403,
      'operation_id', p_operation_id,
      'error_code', 'classroom_forbidden',
      'error', 'Forbidden',
      'retryable', false
    );
  end if;
  if v_archived_at is null then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'classroom_not_archived',
      'error', 'Classroom must be archived before export',
      'retryable', false
    );
  end if;

  if v_operation.id is null then
    insert into public.classroom_archive_operations (
      id,
      teacher_id,
      classroom_id,
      operation_type,
      request_sha256,
      status,
      source_revision,
      source_schema_migration,
      source_app_commit,
      retention,
      archive_id,
      snapshot_created_at,
      snapshot_expires_at
    )
    values (
      p_operation_id,
      p_teacher_id,
      p_classroom_id,
      'export',
      p_request_sha256,
      'snapshot_ready',
      v_revision,
      p_source_schema_migration,
      p_source_app_commit,
      p_retention,
      p_operation_id,
      v_now,
      v_now + interval '24 hours'
    )
    on conflict (id) do nothing;

    select *
    into v_operation
    from public.classroom_archive_operations
    where id = p_operation_id
    for update;

    if v_operation.teacher_id <> p_teacher_id
      or v_operation.classroom_id <> p_classroom_id
      or v_operation.operation_type <> 'export'
      or v_operation.request_sha256 <> p_request_sha256
    then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'operation_id', p_operation_id,
        'error_code', 'idempotency_conflict',
        'error', 'Idempotency key was already used for a different archive request',
        'retryable', false
      );
    end if;
  else
    delete from public.classroom_archive_snapshot_resources
    where operation_id = p_operation_id;
    delete from public.classroom_archive_snapshot_actors
    where operation_id = p_operation_id;

    update public.classroom_archive_operations
    set
      status = 'snapshot_ready',
      attempt_count = attempt_count + 1,
      source_revision = v_revision,
      source_schema_migration = p_source_schema_migration,
      source_app_commit = p_source_app_commit,
      retention = p_retention,
      resource_counts = '{}'::jsonb,
      storage_object_counts = '{}'::jsonb,
      storage_bucket = null,
      storage_path = null,
      artifact_sha256 = null,
      content_sha256 = null,
      compressed_byte_size = null,
      uncompressed_byte_size = null,
      verification = null,
      error_code = null,
      retryable = null,
      snapshot_created_at = v_now,
      snapshot_expires_at = v_now + interval '24 hours',
      completed_at = null,
      updated_at = v_now
    where id = p_operation_id
    returning * into v_operation;
  end if;

  insert into public.classroom_archive_snapshot_resources (
    operation_id,
    table_name,
    row_id
  )
  values (p_operation_id, 'classrooms', p_classroom_id);

  for v_resource in
    select table_name, primary_key_columns[1] as primary_key_column, parent_table, parent_column
    from public.classroom_archive_resource_contract
    where table_name <> 'classrooms'
    order by export_position
  loop
    execute format(
      'insert into public.classroom_archive_snapshot_resources (operation_id, table_name, row_id)
       select $1, $2, child.%I
       from public.%I child
       join public.classroom_archive_snapshot_resources parent
         on parent.operation_id = $1
        and parent.table_name = $3
        and child.%I = parent.row_id
       on conflict do nothing',
      v_resource.primary_key_column,
      v_resource.table_name,
      v_resource.parent_column
    )
    using p_operation_id, v_resource.table_name, v_resource.parent_table;
  end loop;

  create temporary table if not exists classroom_archive_actor_ids (
    actor_id uuid primary key
  ) on commit drop;
  truncate table classroom_archive_actor_ids;

  insert into classroom_archive_actor_ids (actor_id)
  values (p_teacher_id)
  on conflict do nothing;

  for v_resource in
    select table_name, primary_key_columns[1] as primary_key_column, actor_columns
    from public.classroom_archive_resource_contract
    where cardinality(actor_columns) > 0
    order by export_position
  loop
    foreach v_actor_column in array v_resource.actor_columns
    loop
      execute format(
        'insert into classroom_archive_actor_ids (actor_id)
         select distinct actor.id
         from public.classroom_archive_snapshot_resources snapshot
         join public.%I source on source.%I = snapshot.row_id
         join public.users actor on actor.id = source.%I
         where snapshot.operation_id = $1
           and snapshot.table_name = $2
         on conflict do nothing',
        v_resource.table_name,
        v_resource.primary_key_column,
        v_actor_column
      )
      using p_operation_id, v_resource.table_name;
    end loop;
  end loop;

  insert into public.classroom_archive_snapshot_actors (
    operation_id,
    actor_id,
    snapshot
  )
  select
    p_operation_id,
    actor.id,
    jsonb_build_object(
      'id', actor.id,
      'email', actor.email,
      'role', actor.role,
      'profile', case
        when profile.id is null then null
        else jsonb_build_object(
          'id', profile.id,
          'user_id', profile.user_id,
          'student_number', profile.student_number,
          'first_name', profile.first_name,
          'last_name', profile.last_name,
          'created_at', profile.created_at
        )
      end
    )
  from classroom_archive_actor_ids selected_actor
  join public.users actor on actor.id = selected_actor.actor_id
  left join public.student_profiles profile on profile.user_id = actor.id
  order by actor.id;

  select jsonb_object_agg(
    contract.table_name,
    coalesce(resource_count.row_count, 0)
    order by contract.export_position
  )
  into v_counts
  from public.classroom_archive_resource_contract contract
  left join (
    select table_name, count(*)::integer as row_count
    from public.classroom_archive_snapshot_resources
    where operation_id = p_operation_id
    group by table_name
  ) resource_count on resource_count.table_name = contract.table_name;

  update public.classroom_archive_operations
  set resource_counts = v_counts, updated_at = clock_timestamp()
  where id = p_operation_id
  returning * into v_operation;

  return jsonb_build_object(
    'ok', true,
    'status', 202,
    'operation_id', p_operation_id,
    'archive_id', p_operation_id,
    'operation_status', 'snapshot_ready',
    'replayed', false,
    'snapshot_created_at', v_operation.snapshot_created_at,
    'snapshot_expires_at', v_operation.snapshot_expires_at,
    'source_revision', v_operation.source_revision,
    'resource_counts', v_operation.resource_counts
  );
end;
$$;

create or replace function public.stage_classroom_archive_object_upload(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_expected_sha256 text,
  p_expected_byte_size bigint
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_operation public.classroom_archive_operations;
  v_upload public.classroom_archive_object_upload_cleanup;
begin
  if p_storage_bucket is null
    or p_storage_bucket not in (
      'classroom-archives', 'assignment-artifacts', 'submission-images', 'test-documents'
    )
    or p_storage_path is null
    or p_storage_path = ''
    or p_storage_path like '/%'
    or strpos(p_storage_path, E'\\') > 0
    or exists (
      select 1 from regexp_split_to_table(p_storage_path, '/') path_segment(value)
      where path_segment.value in ('', '.', '..')
    )
    or p_expected_sha256 is null
    or p_expected_sha256 !~ '^[a-f0-9]{64}$'
    or p_expected_byte_size is null
    or p_expected_byte_size < 0
  then
    raise exception 'Invalid classroom archive object upload intent'
      using errcode = '22023';
  end if;

  select * into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
    and teacher_id = p_teacher_id
    and operation_type = 'export'
  for update;
  if v_operation.id is null
    or v_operation.status <> 'snapshot_ready'
    or v_operation.snapshot_expires_at <= now()
    or p_storage_bucket <> 'classroom-archives'
    or p_storage_path <> format(
      '%s/%s/%s/classroom-v1.tar.gz',
      v_operation.teacher_id,
      v_operation.classroom_id,
      v_operation.archive_id
    )
  then
    return false;
  end if;
  if p_storage_bucket <> 'classroom-archives' then return false; end if;

  insert into public.classroom_archive_object_upload_cleanup (
    operation_id, storage_bucket, storage_path, expected_sha256, expected_byte_size
  ) values (
    p_operation_id, p_storage_bucket, p_storage_path, p_expected_sha256, p_expected_byte_size
  )
  on conflict (operation_id, storage_bucket, storage_path) do nothing;

  select * into v_upload
  from public.classroom_archive_object_upload_cleanup
  where operation_id = p_operation_id
    and storage_bucket = p_storage_bucket
    and storage_path = p_storage_path;
  return v_upload.expected_sha256 = p_expected_sha256
    and v_upload.expected_byte_size = p_expected_byte_size
    and v_upload.status = 'staged';
end;
$$;

create or replace function public.complete_classroom_archive_export(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_artifact_sha256 text,
  p_content_sha256 text,
  p_compressed_byte_size bigint,
  p_uncompressed_byte_size bigint,
  p_resource_counts jsonb,
  p_storage_object_counts jsonb,
  p_verification jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_operation public.classroom_archive_operations;
  v_current_revision bigint;
  v_resource record;
  v_expected_count integer;
  v_current_count integer;
  v_verified_at timestamptz := clock_timestamp();
begin
  select *
  into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
  for update;

  if v_operation.id is null or v_operation.teacher_id <> p_teacher_id then
    return jsonb_build_object(
      'ok', false,
      'status', 404,
      'operation_id', p_operation_id,
      'error_code', 'archive_operation_not_found',
      'error', 'Archive operation not found',
      'retryable', false
    );
  end if;
  if v_operation.status = 'completed' then
    return jsonb_build_object(
      'ok', true,
      'status', 200,
      'operation_id', p_operation_id,
      'archive_id', v_operation.archive_id,
      'operation_status', 'completed',
      'replayed', true,
      'storage_bucket', v_operation.storage_bucket,
      'storage_path', v_operation.storage_path,
      'artifact_sha256', v_operation.artifact_sha256,
      'content_sha256', v_operation.content_sha256,
      'compressed_byte_size', v_operation.compressed_byte_size,
      'uncompressed_byte_size', v_operation.uncompressed_byte_size,
      'resource_counts', v_operation.resource_counts,
      'storage_object_counts', v_operation.storage_object_counts,
      'verification', v_operation.verification
    );
  end if;
  if v_operation.status <> 'snapshot_ready' then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', coalesce(v_operation.error_code, 'archive_snapshot_not_ready'),
      'error', 'Archive snapshot is not ready',
      'retryable', coalesce(v_operation.retryable, false)
    );
  end if;
  if v_operation.snapshot_expires_at <= v_verified_at then
    update public.classroom_archive_operations
    set status = 'failed', error_code = 'archive_snapshot_expired', retryable = false, updated_at = v_verified_at
    where id = p_operation_id;
    delete from public.classroom_archive_snapshot_resources where operation_id = p_operation_id;
    delete from public.classroom_archive_snapshot_actors where operation_id = p_operation_id;
    update public.classroom_archive_object_upload_cleanup
    set status = 'pending', next_attempt_at = v_verified_at, updated_at = v_verified_at
    where operation_id = p_operation_id and status = 'staged';
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'archive_snapshot_expired',
      'error', 'Archive snapshot expired before verification',
      'retryable', false
    );
  end if;
  if p_storage_bucket <> 'classroom-archives'
    or p_storage_path <> format(
      '%s/%s/%s/classroom-v1.tar.gz',
      v_operation.teacher_id,
      v_operation.classroom_id,
      v_operation.archive_id
    )
    or p_artifact_sha256 !~ '^[a-f0-9]{64}$'
    or p_content_sha256 !~ '^[a-f0-9]{64}$'
    or p_compressed_byte_size <= 0
    or p_compressed_byte_size > 52428800
    or p_uncompressed_byte_size <= 0
  then
    raise exception 'Invalid classroom archive artifact metadata'
      using errcode = '22023';
  end if;
  if p_resource_counts <> v_operation.resource_counts then
    raise exception 'Classroom archive resource counts do not match the snapshot'
      using errcode = '22023';
  end if;
  if coalesce((p_verification->>'read_back_verified')::boolean, false) is not true
    or coalesce((p_verification->>'artifact_checksum_verified')::boolean, false) is not true
    or coalesce((p_verification->>'manifest_verified')::boolean, false) is not true
    or coalesce((p_verification->>'resource_checksums_verified')::boolean, false) is not true
    or coalesce((p_verification->>'resource_counts_verified')::boolean, false) is not true
    or coalesce((p_verification->>'storage_objects_verified')::boolean, false) is not true
    or coalesce((p_verification->>'actor_snapshots_verified')::boolean, false) is not true
  then
    raise exception 'Classroom archive verification evidence is incomplete'
      using errcode = '22023';
  end if;

  select revision
  into v_current_revision
  from public.classroom_archive_revisions
  where classroom_id = v_operation.classroom_id
  for share;

  if v_current_revision is null or v_current_revision <> v_operation.source_revision then
    update public.classroom_archive_operations
    set status = 'failed', error_code = 'classroom_changed_during_export', retryable = false, updated_at = v_verified_at
    where id = p_operation_id;
    delete from public.classroom_archive_snapshot_resources where operation_id = p_operation_id;
    delete from public.classroom_archive_snapshot_actors where operation_id = p_operation_id;
    update public.classroom_archive_object_upload_cleanup
    set status = 'pending', next_attempt_at = v_verified_at, updated_at = v_verified_at
    where operation_id = p_operation_id and status = 'staged';
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'classroom_changed_during_export',
      'error', 'Classroom data changed during archive export',
      'retryable', false
    );
  end if;

  for v_resource in
    select table_name, primary_key_columns[1] as primary_key_column
    from public.classroom_archive_resource_contract
    order by export_position
  loop
    v_expected_count := coalesce((v_operation.resource_counts->>v_resource.table_name)::integer, 0);
    execute format(
      'select count(*)::integer
       from public.classroom_archive_snapshot_resources snapshot
       join public.%I source on source.%I = snapshot.row_id
       where snapshot.operation_id = $1
         and snapshot.table_name = $2',
      v_resource.table_name,
      v_resource.primary_key_column
    )
    into v_current_count
    using p_operation_id, v_resource.table_name;

    if v_current_count <> v_expected_count then
      raise exception 'Classroom archive source count changed for %', v_resource.table_name
        using errcode = '40001';
    end if;
  end loop;

  insert into public.classroom_archives (
    id,
    operation_id,
    classroom_id,
    teacher_id,
    format,
    format_version,
    source_revision,
    source_schema_migration,
    source_app_commit,
    storage_bucket,
    storage_path,
    artifact_sha256,
    content_sha256,
    compressed_byte_size,
    uncompressed_byte_size,
    resource_counts,
    storage_object_counts,
    verification,
    retention,
    created_at,
    verified_at
  )
  values (
    v_operation.archive_id,
    p_operation_id,
    v_operation.classroom_id,
    v_operation.teacher_id,
    'pika.classroom-archive',
    1,
    v_operation.source_revision,
    v_operation.source_schema_migration,
    v_operation.source_app_commit,
    p_storage_bucket,
    p_storage_path,
    p_artifact_sha256,
    p_content_sha256,
    p_compressed_byte_size,
    p_uncompressed_byte_size,
    p_resource_counts,
    p_storage_object_counts,
    p_verification,
    v_operation.retention,
    v_operation.snapshot_created_at,
    v_verified_at
  )
  on conflict (id) do nothing;

  if not exists (
    select 1 from public.classroom_archive_object_upload_cleanup upload
    where upload.operation_id = p_operation_id
      and upload.storage_bucket = p_storage_bucket
      and upload.storage_path = p_storage_path
      and upload.expected_sha256 = p_artifact_sha256
      and upload.expected_byte_size = p_compressed_byte_size
      and upload.status = 'staged'
  ) then
    raise exception 'Classroom archive upload intent is missing during finalization'
      using errcode = '40001';
  end if;

  update public.classroom_archive_operations
  set
    status = 'completed',
    storage_bucket = p_storage_bucket,
    storage_path = p_storage_path,
    artifact_sha256 = p_artifact_sha256,
    content_sha256 = p_content_sha256,
    compressed_byte_size = p_compressed_byte_size,
    uncompressed_byte_size = p_uncompressed_byte_size,
    resource_counts = p_resource_counts,
    storage_object_counts = p_storage_object_counts,
    verification = p_verification,
    error_code = null,
    retryable = null,
    completed_at = v_verified_at,
    updated_at = v_verified_at
  where id = p_operation_id;

  delete from public.classroom_archive_snapshot_resources where operation_id = p_operation_id;
  delete from public.classroom_archive_snapshot_actors where operation_id = p_operation_id;
  delete from public.classroom_archive_object_upload_cleanup where operation_id = p_operation_id;

  return jsonb_build_object(
    'ok', true,
    'status', 201,
    'operation_id', p_operation_id,
    'archive_id', v_operation.archive_id,
    'operation_status', 'completed',
    'replayed', false,
    'storage_bucket', p_storage_bucket,
    'storage_path', p_storage_path,
    'artifact_sha256', p_artifact_sha256,
    'content_sha256', p_content_sha256,
    'compressed_byte_size', p_compressed_byte_size,
    'uncompressed_byte_size', p_uncompressed_byte_size,
    'resource_counts', p_resource_counts,
    'storage_object_counts', p_storage_object_counts,
    'verification', p_verification
  );
end;
$$;

create or replace function public.fail_classroom_archive_export(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_error_code text,
  p_retryable boolean
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_updated boolean;
begin
  if p_error_code !~ '^[a-z0-9_]{3,80}$' then
    raise exception 'Invalid classroom archive error code'
      using errcode = '22023';
  end if;

  update public.classroom_archive_operations
  set
    status = 'failed',
    error_code = p_error_code,
    retryable = p_retryable,
    updated_at = clock_timestamp()
  where id = p_operation_id
    and teacher_id = p_teacher_id
    and status <> 'completed'
    and (status <> 'failed' or retryable is true);
  v_updated := found;

  if v_updated and not p_retryable then
    delete from public.classroom_archive_snapshot_resources where operation_id = p_operation_id;
    delete from public.classroom_archive_snapshot_actors where operation_id = p_operation_id;
    update public.classroom_archive_object_upload_cleanup
    set status = 'pending', next_attempt_at = clock_timestamp(), updated_at = clock_timestamp()
    where operation_id = p_operation_id and status = 'staged';
  end if;
  return v_updated;
end;
$$;

create or replace function public.cleanup_expired_classroom_archive_snapshots()
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_operation_ids uuid[];
begin
  with expired as (
    update public.classroom_archive_operations
    set
      status = 'failed',
      error_code = 'archive_snapshot_expired',
      retryable = false,
      updated_at = clock_timestamp()
    where (
        status = 'snapshot_ready'
        or (status = 'failed' and retryable is true)
      )
      and snapshot_expires_at <= now()
    returning id
  )
  select coalesce(array_agg(id), array[]::uuid[])
  into v_operation_ids
  from expired;

  delete from public.classroom_archive_snapshot_resources
  where operation_id = any(v_operation_ids);
  delete from public.classroom_archive_snapshot_actors
  where operation_id = any(v_operation_ids);
  update public.classroom_archive_object_upload_cleanup
  set status = 'pending', next_attempt_at = clock_timestamp(), updated_at = clock_timestamp()
  where operation_id = any(v_operation_ids) and status = 'staged';

  return coalesce(array_length(v_operation_ids, 1), 0);
end;
$$;

create or replace function public.reject_classroom_archive_metadata_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Verified classroom archive metadata is immutable'
    using errcode = '55000';
end;
$$;

drop trigger if exists classroom_archives_immutable on public.classroom_archives;
create trigger classroom_archives_immutable
  before update on public.classroom_archives
  for each row
  execute function public.reject_classroom_archive_metadata_update();

revoke all on table public.classroom_archive_resource_contract from public, anon, authenticated;
revoke all on table public.classroom_archive_revisions from public, anon, authenticated;
revoke all on table public.classroom_archive_operations from public, anon, authenticated;
revoke all on table public.classroom_archive_snapshot_resources from public, anon, authenticated;
revoke all on table public.classroom_archive_snapshot_actors from public, anon, authenticated;
revoke all on table public.classroom_archive_object_upload_cleanup from public, anon, authenticated;
revoke all on table public.classroom_archives from public, anon, authenticated;

grant select on table public.classroom_archive_resource_contract to service_role;
grant select on table public.classroom_archive_revisions to service_role;
grant select on table public.classroom_archive_operations to service_role;
grant select on table public.classroom_archive_snapshot_resources to service_role;
grant select on table public.classroom_archive_snapshot_actors to service_role;
grant select, insert, update, delete on table public.classroom_archive_object_upload_cleanup to service_role;
grant select on table public.classroom_archives to service_role;

revoke all on function public.resolve_classroom_archive_resource_classroom_id(text, uuid) from public, anon, authenticated;
revoke all on function public.bump_classroom_archive_revision_from_classroom() from public, anon, authenticated;
revoke all on function public.bump_classroom_archive_revision_from_resource() from public, anon, authenticated;
revoke all on function public.begin_classroom_archive_export(uuid, uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.stage_classroom_archive_object_upload(uuid, uuid, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.complete_classroom_archive_export(uuid, uuid, text, text, text, text, bigint, bigint, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.fail_classroom_archive_export(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.cleanup_expired_classroom_archive_snapshots() from public, anon, authenticated;
revoke all on function public.reject_classroom_archive_metadata_update() from public, anon, authenticated;

grant execute on function public.begin_classroom_archive_export(uuid, uuid, uuid, text, text, text, jsonb) to service_role;
grant execute on function public.stage_classroom_archive_object_upload(uuid, uuid, text, text, text, bigint) to service_role;
grant execute on function public.complete_classroom_archive_export(uuid, uuid, text, text, text, text, bigint, bigint, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.fail_classroom_archive_export(uuid, uuid, text, boolean) to service_role;
grant execute on function public.cleanup_expired_classroom_archive_snapshots() to service_role;

comment on table public.classroom_archive_operations is
  'Durable idempotency, snapshot, verification, and recovery ledger for classroom lifecycle operations.';
comment on table public.classroom_archive_snapshot_resources is
  'Short-lived row-id membership snapshot; full classroom rows are never duplicated here.';
comment on table public.classroom_archives is
  'Immutable metadata for read-back-verified private classroom archive objects.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'gradex-analytics-extracts',
  'gradex-analytics-extracts',
  false,
  52428800,
  array['application/gzip']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 52428800,
  allowed_mime_types = array['application/gzip'];
