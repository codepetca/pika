-- Serialize assignment draft evidence, history, and submission transitions.

alter table public.assignment_docs
  add column if not exists save_session_id uuid,
  add column if not exists save_sequence bigint;

alter table public.assignment_doc_history
  drop constraint if exists assignment_doc_history_trigger_check;
alter table public.assignment_doc_history
  add constraint assignment_doc_history_trigger_check
  check (trigger in ('autosave', 'blur', 'submit', 'baseline', 'restore'));

alter table public.assignment_docs
  drop constraint if exists assignment_docs_save_sequence_check;
alter table public.assignment_docs
  add constraint assignment_docs_save_sequence_check
  check (save_sequence is null or save_sequence > 0);

create or replace function private.assignment_content_sha256(p_content jsonb)
returns text
language sql
immutable
strict
set search_path = public, extensions, pg_temp
as $$
  select encode(
    extensions.digest(convert_to(p_content::text, 'UTF8'), 'sha256'),
    'hex'
  )
$$;

create table if not exists public.assignment_doc_save_operations (
  id uuid primary key default gen_random_uuid(),
  assignment_doc_id uuid not null,
  save_session_id uuid not null,
  save_sequence bigint not null check (save_sequence > 0),
  metric_session_id uuid not null,
  paste_word_count integer not null check (paste_word_count >= 0),
  keystroke_count bigint not null check (keystroke_count >= 0),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  document_updated_at timestamptz not null,
  completed_at timestamptz not null default clock_timestamp(),
  unique (assignment_doc_id, save_session_id, save_sequence)
);

alter table public.assignment_doc_save_operations
  add column if not exists metric_session_id uuid,
  add column if not exists paste_word_count integer,
  add column if not exists keystroke_count bigint,
  add column if not exists document_updated_at timestamptz;
update public.assignment_doc_save_operations
set metric_session_id = coalesce(metric_session_id, save_session_id),
    paste_word_count = coalesce(paste_word_count, 0),
    keystroke_count = coalesce(keystroke_count, 0),
    document_updated_at = coalesce(document_updated_at, completed_at)
where metric_session_id is null
  or paste_word_count is null
  or keystroke_count is null
  or document_updated_at is null;
alter table public.assignment_doc_save_operations
  alter column metric_session_id set not null,
  alter column paste_word_count set not null,
  alter column keystroke_count set not null,
  alter column document_updated_at set not null;
alter table public.assignment_doc_save_operations
  drop constraint if exists assignment_doc_save_operations_paste_word_count_check;
alter table public.assignment_doc_save_operations
  add constraint assignment_doc_save_operations_paste_word_count_check
  check (paste_word_count >= 0);
alter table public.assignment_doc_save_operations
  drop constraint if exists assignment_doc_save_operations_keystroke_count_check;
alter table public.assignment_doc_save_operations
  add constraint assignment_doc_save_operations_keystroke_count_check
  check (keystroke_count >= 0);

create index if not exists idx_assignment_doc_save_operations_completed
  on public.assignment_doc_save_operations (completed_at);

alter table public.assignment_doc_save_operations enable row level security;

insert into public.assignment_doc_save_operations (
  assignment_doc_id, save_session_id, save_sequence, metric_session_id,
  paste_word_count, keystroke_count, content_sha256, document_updated_at, completed_at
)
select id, save_session_id, save_sequence, save_session_id,
  0, 0, private.assignment_content_sha256(content), updated_at, updated_at
from public.assignment_docs
where save_session_id is not null and save_sequence is not null
on conflict (assignment_doc_id, save_session_id, save_sequence) do nothing;

create or replace function public.cleanup_assignment_doc_save_operations(
  p_completed_before timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if p_completed_before is null or p_completed_before > clock_timestamp() then
    raise exception 'Invalid assignment save operation cleanup cutoff' using errcode = '22023';
  end if;

  with deleted as (
    delete from public.assignment_doc_save_operations
    where completed_at < p_completed_before
    returning 1
  )
  select count(*)::integer into v_deleted from deleted;

  return v_deleted;
end;
$$;

create table if not exists public.assignment_artifact_storage_cleanup (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'processing')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (status = 'pending' and lease_token is null and lease_expires_at is null)
    or (status = 'processing' and lease_token is not null and lease_expires_at is not null)
  )
);

create index if not exists idx_assignment_artifact_storage_cleanup_due
  on public.assignment_artifact_storage_cleanup (next_attempt_at, created_at)
  where status = 'pending';

alter table public.assignment_artifact_storage_cleanup enable row level security;

create or replace function public.update_assignment_docs_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;

-- Keep the migration-first overlap compatible with the previous archive adapter.
-- The old app stages 082 assignment rows without the nullable 099 save fence fields.
create or replace function public.normalize_classroom_archive_restore_row(
  p_operation_id uuid,
  p_table_name text,
  p_row jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_response_revision bigint;
  v_missing_response_revision boolean;
begin
  if p_table_name = 'assignment_docs' then
    if not (p_row ? 'save_session_id') then
      p_row := p_row || jsonb_build_object('save_session_id', null);
    end if;
    if not (p_row ? 'save_sequence') then
      p_row := p_row || jsonb_build_object('save_sequence', null);
    end if;
    return p_row;
  end if;

  if p_table_name = 'test_responses' then
    if not (p_row ? 'revision') or jsonb_typeof(p_row->'revision') = 'null' then
      p_row := p_row || jsonb_build_object('revision', 1);
    end if;
    if not (p_row ? 'ai_suggested_score') then
      p_row := p_row || jsonb_build_object('ai_suggested_score', null);
    end if;
    if not (p_row ? 'ai_suggested_feedback') then
      p_row := p_row || jsonb_build_object('ai_suggested_feedback', null);
    end if;
    return p_row;
  end if;

  if p_table_name = 'test_ai_grading_run_items' then
    v_missing_response_revision := not (p_row ? 'response_revision')
      or jsonb_typeof(p_row->'response_revision') = 'null';
    if v_missing_response_revision then
      select coalesce((staged.row_data->>'revision')::bigint, 1)
      into v_response_revision
      from public.classroom_archive_restore_staging staged
      where staged.operation_id = p_operation_id
        and staged.table_name = 'test_responses'
        and staged.row_id::text = p_row->>'response_id';

      p_row := p_row || jsonb_build_object(
        'response_revision', coalesce(v_response_revision, 1)
      );
    end if;
    if p_row->>'status' in ('queued', 'processing') then
      p_row := p_row || jsonb_build_object(
        'status', 'failed',
        'next_retry_at', null,
        'last_error_code', case
          when v_missing_response_revision then 'revision_baseline_unavailable'
          when p_row->>'last_error_code' is null then 'archive_restore_invalidated'
          else p_row->>'last_error_code'
        end,
        'last_error_message', 'Retry this response in a new AI grading run',
        'completed_at', coalesce(p_row->'updated_at', p_row->'created_at')
      );
    end if;
    if not (p_row ? 'question_grading_snapshot') then
      p_row := p_row || jsonb_build_object('question_grading_snapshot', null);
    end if;
    return p_row;
  end if;

  if p_table_name = 'test_ai_grading_runs'
    and p_row->>'status' in ('queued', 'running')
  then
    p_row := p_row || jsonb_build_object(
      'status', 'failed',
      'processed_count', coalesce((p_row->>'queued_response_count')::integer, 0),
      'failed_count', greatest(
        coalesce((p_row->>'failed_count')::integer, 0),
        coalesce((p_row->>'queued_response_count')::integer, 0)
          - coalesce((p_row->>'completed_count')::integer, 0)
      ),
      'lease_token', null,
      'lease_expires_at', null,
      'completed_at', coalesce(p_row->'updated_at', p_row->'created_at')
    );
    return p_row;
  end if;

  return p_row;
end;
$$;

create or replace function public.guard_assignment_submission_requirement_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment_id uuid;
  v_artifact_id uuid;
  v_doc_id uuid;
begin
  if public.is_classroom_archive_maintenance_mode('restore')
    or public.is_classroom_archive_maintenance_mode('compaction') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' and old.assignment_id <> new.assignment_id then
    raise exception using
      errcode = '23514',
      message = 'assignment_requirement_move_forbidden';
  end if;

  v_assignment_id := case when tg_op = 'DELETE' then old.assignment_id else new.assignment_id end;

  -- Parent assignment cascades are destructive operations, not requirement edits.
  if tg_op = 'DELETE' and not exists (
    select 1 from public.assignments where id = v_assignment_id
  ) then
    return old;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('assignment_submission:' || v_assignment_id::text, 0));

  if tg_op = 'DELETE' then
    for v_artifact_id in
      select artifact.id
      from public.assignment_submission_artifacts artifact
      where artifact.requirement_id = old.id
      order by artifact.id
      for update
    loop
      null;
    end loop;
  end if;

  for v_doc_id in
    select doc.id
    from public.assignment_docs doc
    where doc.assignment_id = v_assignment_id
    order by doc.id
    for update
  loop
    null;
  end loop;

  if exists (
    select 1
    from public.assignment_docs
    where assignment_id = v_assignment_id
      and is_submitted is true
  ) then
    raise exception using
      errcode = '23514',
      message = 'assignment_requirements_submitted_documents_immutable';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists guard_assignment_submission_requirement_mutation
  on public.assignment_submission_requirements;
drop trigger if exists aaa_guard_assignment_submission_requirement_mutation
  on public.assignment_submission_requirements;
create trigger aaa_guard_assignment_submission_requirement_mutation
before insert or update or delete on public.assignment_submission_requirements
for each row
execute function public.guard_assignment_submission_requirement_mutation();

create or replace function public.guard_assignment_submission_artifact_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc_id uuid;
  v_is_submitted boolean;
begin
  if public.is_classroom_archive_maintenance_mode('restore')
    or public.is_classroom_archive_maintenance_mode('compaction') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' and old.assignment_doc_id <> new.assignment_doc_id then
    raise exception using
      errcode = '23514',
      message = 'assignment_artifact_document_change_forbidden';
  end if;

  -- Requirement and document parent cascades are legitimate destructive flows.
  if tg_op = 'DELETE' and not exists (
    select 1
    from public.assignment_submission_requirements
    where id = old.requirement_id
  ) then
    return old;
  end if;

  v_doc_id := case when tg_op = 'DELETE' then old.assignment_doc_id else new.assignment_doc_id end;

  select d.is_submitted
  into v_is_submitted
  from public.assignment_docs d
  where d.id = v_doc_id
  for update;

  if not found then
    if tg_op = 'DELETE' then
      return old;
    end if;
    raise exception using
      errcode = '23503',
      message = 'assignment_artifact_document_not_found';
  end if;

  if v_is_submitted then
    raise exception using
      errcode = '23514',
      message = 'assignment_artifact_submitted_document_immutable';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists guard_assignment_submission_artifact_mutation
  on public.assignment_submission_artifacts;
drop trigger if exists aaa_guard_assignment_submission_artifact_mutation
  on public.assignment_submission_artifacts;
create trigger aaa_guard_assignment_submission_artifact_mutation
before insert or update or delete on public.assignment_submission_artifacts
for each row
execute function public.guard_assignment_submission_artifact_mutation();

create or replace function public.enqueue_deleted_assignment_artifact_storage_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'UPDATE' and old.storage_path is not distinct from new.storage_path)
    or old.storage_path is null or btrim(old.storage_path) = ''
    or public.is_classroom_archive_maintenance_mode('restore')
    or public.is_classroom_archive_maintenance_mode('compaction') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  insert into public.assignment_artifact_storage_cleanup as existing_cleanup (
    storage_path, status, attempt_count, next_attempt_at,
    lease_token, lease_expires_at, last_error, updated_at
  ) values (
    old.storage_path, 'pending', 0, clock_timestamp(),
    null, null, null, clock_timestamp()
  )
  on conflict (storage_path) do update
  set status = 'pending',
      next_attempt_at = clock_timestamp(),
      lease_token = null,
      lease_expires_at = null,
      last_error = null,
      updated_at = clock_timestamp()
  where existing_cleanup.status <> 'processing'
    or existing_cleanup.lease_expires_at <= clock_timestamp();

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists enqueue_deleted_assignment_artifact_storage_cleanup
  on public.assignment_submission_artifacts;
create trigger enqueue_deleted_assignment_artifact_storage_cleanup
after delete or update of storage_path on public.assignment_submission_artifacts
for each row
execute function public.enqueue_deleted_assignment_artifact_storage_cleanup();

drop function if exists public.enqueue_assignment_artifact_storage_cleanup_path(text);
create or replace function public.enqueue_assignment_artifact_storage_cleanup_path(
  p_storage_path text,
  p_delay_seconds integer default 0
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_storage_path is null or btrim(p_storage_path) = ''
    or p_delay_seconds is null or p_delay_seconds < 0 or p_delay_seconds > 86400 then
    raise exception 'Invalid assignment artifact Storage cleanup path' using errcode = '22023';
  end if;

  insert into public.assignment_artifact_storage_cleanup as existing_cleanup (
    storage_path, status, attempt_count, next_attempt_at,
    lease_token, lease_expires_at, last_error, updated_at
  ) values (
    p_storage_path, 'pending', 0,
    clock_timestamp() + make_interval(secs => p_delay_seconds),
    null, null, null, clock_timestamp()
  )
  on conflict (storage_path) do update
  set status = 'pending',
      next_attempt_at = clock_timestamp() + make_interval(secs => p_delay_seconds),
      lease_token = null,
      lease_expires_at = null,
      last_error = null,
      updated_at = clock_timestamp()
  where existing_cleanup.status <> 'processing'
    or existing_cleanup.lease_expires_at <= clock_timestamp();

  return true;
end;
$$;

create or replace function private.validate_assignment_submission_requirements(p_doc public.assignment_docs)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.assignment_submission_requirements r
    left join public.assignment_submission_artifacts a
      on a.requirement_id = r.id
      and a.assignment_doc_id = p_doc.id
      and a.student_id = p_doc.student_id
      and a.type = r.type
    where r.assignment_id = p_doc.assignment_id
      and (
        (
          r.required
          and (
            a.id is null
            or case
              when r.type = 'image' then
                coalesce(nullif(btrim(a.storage_path), ''), nullif(btrim(a.url), '')) is null
              else nullif(btrim(coalesce(a.url, '')), '') is null
            end
            or a.validation_status in ('invalid', 'inaccessible')
          )
        )
        or (
          a.id is not null
          and (
            case
              when r.type = 'image' then
                coalesce(nullif(btrim(a.storage_path), ''), nullif(btrim(a.url), '')) is null
              else nullif(btrim(coalesce(a.url, '')), '') is null
            end
            or a.validation_status in ('invalid', 'inaccessible')
          )
        )
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'assignment_submission_requirements_incomplete';
  end if;
end;
$$;

create or replace function public.validate_assignment_submission_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.validate_assignment_submission_requirements(new);
  return new;
end;
$$;

drop trigger if exists validate_assignment_submission_transition
  on public.assignment_docs;
drop trigger if exists aaa_validate_assignment_submission_transition
  on public.assignment_docs;
create trigger aaa_validate_assignment_submission_transition
before update of is_submitted on public.assignment_docs
for each row
when (new.is_submitted and not old.is_submitted)
execute function public.validate_assignment_submission_transition();

create or replace function public.guard_submitted_assignment_doc_content()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_classroom_archive_maintenance_mode('restore')
    or public.is_classroom_archive_maintenance_mode('compaction') then
    return new;
  end if;

  if old.is_submitted and (
    old.content is distinct from new.content
    or old.assignment_id is distinct from new.assignment_id
    or old.student_id is distinct from new.student_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'assignment_submitted_document_identity_immutable';
  end if;

  if old.is_submitted and new.is_submitted
    and old.submitted_at is distinct from new.submitted_at then
    raise exception using
      errcode = '23514',
      message = 'assignment_submitted_at_immutable';
  end if;

  if new.is_submitted and new.submitted_at is null then
    raise exception using
      errcode = '23514',
      message = 'assignment_submitted_at_required';
  end if;

  return new;
end;
$$;

drop trigger if exists aaa_guard_submitted_assignment_doc_content
  on public.assignment_docs;
create trigger aaa_guard_submitted_assignment_doc_content
before update of content, assignment_id, student_id, submitted_at, is_submitted on public.assignment_docs
for each row
execute function public.guard_submitted_assignment_doc_content();

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
    if old.trigger = 'submit' and exists (
      select 1
      from public.assignment_docs d
      where d.id = old.assignment_doc_id
    ) then
      -- Compatibility: pre-099 cleanup jobs bulk-delete history without filtering.
      -- Silently preserve authoritative submit rows while allowing that job to finish.
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

drop trigger if exists guard_assignment_doc_history_after_submit
  on public.assignment_doc_history;
drop trigger if exists aaa_guard_assignment_doc_history_after_submit
  on public.assignment_doc_history;
create trigger aaa_guard_assignment_doc_history_after_submit
before insert or update or delete on public.assignment_doc_history
for each row
execute function public.guard_assignment_doc_history_after_submit();

create or replace function private.assignment_tiptap_node_text(p_node jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_child jsonb;
  v_text text := '';
begin
  if p_node->>'type' = 'text' then
    return coalesce(p_node->>'text', '');
  end if;

  if jsonb_typeof(p_node->'content') = 'array' then
    for v_child in select value from jsonb_array_elements(p_node->'content')
    loop
      v_text := v_text || private.assignment_tiptap_node_text(v_child);
    end loop;
  end if;
  return v_text;
end;
$$;

create or replace function private.assignment_tiptap_plain_text(p_content jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_node jsonb;
  v_item jsonb;
  v_lines text[] := array[]::text[];
begin
  if jsonb_typeof(p_content->'content') <> 'array' then
    return '';
  end if;

  for v_node in select value from jsonb_array_elements(p_content->'content')
  loop
    if v_node->>'type' in ('paragraph', 'heading', 'codeBlock') then
      v_lines := array_append(v_lines, private.assignment_tiptap_node_text(v_node));
    elsif v_node->>'type' in ('bulletList', 'orderedList')
      and jsonb_typeof(v_node->'content') = 'array' then
      for v_item in select value from jsonb_array_elements(v_node->'content')
      loop
        v_lines := array_append(v_lines, private.assignment_tiptap_node_text(v_item));
      end loop;
    end if;
  end loop;
  return array_to_string(v_lines, E'\n');
end;
$$;

insert into public.assignment_doc_history (
  assignment_doc_id, patch, snapshot, word_count, char_count,
  paste_word_count, keystroke_count, trigger, created_at
)
select
  d.id,
  null,
  d.content,
  case
    when trim(private.assignment_tiptap_plain_text(d.content)) = '' then 0
    else cardinality(regexp_split_to_array(
      trim(private.assignment_tiptap_plain_text(d.content)), E'\\s+'
    ))
  end,
  char_length(private.assignment_tiptap_plain_text(d.content)),
  0,
  0,
  'submit',
  coalesce(d.submitted_at, d.updated_at, d.created_at)
from public.assignment_docs d
where d.is_submitted is true
  and not exists (
    select 1
    from public.assignment_doc_history h
    where h.assignment_doc_id = d.id
      and h.trigger = 'submit'
      and h.created_at >= coalesce(d.submitted_at, '-infinity'::timestamptz)
      and h.patch is null
      and h.snapshot = d.content
  );

create or replace function public.ensure_current_assignment_submit_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plain_text text;
  v_word_count integer;
begin
  if public.is_classroom_archive_maintenance_mode('restore')
    or public.is_classroom_archive_maintenance_mode('compaction') then
    return null;
  end if;

  if new.is_submitted and not exists (
    select 1
    from public.assignment_doc_history h
    where h.assignment_doc_id = new.id
      and h.trigger = 'submit'
      and h.created_at >= coalesce(new.submitted_at, '-infinity'::timestamptz)
      and h.patch is null
      and h.snapshot = new.content
  ) then
    v_plain_text := private.assignment_tiptap_plain_text(new.content);
    v_word_count := case
      when trim(v_plain_text) = '' then 0
      else cardinality(regexp_split_to_array(trim(v_plain_text), E'\\s+'))
    end;

    insert into public.assignment_doc_history (
      assignment_doc_id, patch, snapshot, word_count, char_count,
      paste_word_count, keystroke_count, trigger, created_at
    ) values (
      new.id, null, new.content, v_word_count, char_length(v_plain_text), 0, 0, 'submit',
      coalesce(new.submitted_at, clock_timestamp())
    );
  end if;
  return null;
end;
$$;

drop trigger if exists ensure_current_assignment_submit_history
  on public.assignment_docs;
create constraint trigger ensure_current_assignment_submit_history
after insert or update of is_submitted, submitted_at, content on public.assignment_docs
deferrable initially deferred
for each row
when (new.is_submitted)
execute function public.ensure_current_assignment_submit_history();

-- Run deferred submit-history checks while restore maintenance mode is still active.
create or replace function public.complete_classroom_archive_restore(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_verification jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prior_restore_mode text := current_setting('pika.classroom_archive_restore', true);
  v_prior_source_revision text := current_setting(
    'pika.classroom_archive_source_revision',
    true
  );
  v_result jsonb;
begin
  begin
    v_result := private.complete_classroom_archive_restore(
      p_operation_id,
      p_teacher_id,
      p_verification
    );
    set constraints public.ensure_current_assignment_submit_history immediate;
    set constraints public.ensure_current_assignment_submit_history deferred;
  exception when others then
    perform set_config(
      'pika.classroom_archive_restore',
      coalesce(v_prior_restore_mode, 'off'),
      true
    );
    perform set_config(
      'pika.classroom_archive_source_revision',
      coalesce(v_prior_source_revision, ''),
      true
    );
    raise;
  end;

  perform set_config(
    'pika.classroom_archive_restore',
    coalesce(v_prior_restore_mode, 'off'),
    true
  );
  perform set_config(
    'pika.classroom_archive_source_revision',
    coalesce(v_prior_source_revision, ''),
    true
  );
  return v_result;
end;
$$;

drop function if exists public.save_assignment_doc_atomic(
  uuid, uuid, jsonb, timestamptz, text, integer, integer,
  jsonb, jsonb, integer, integer, jsonb
);
drop function if exists public.save_assignment_doc_atomic(
  uuid, uuid, jsonb, timestamptz, text, integer, integer,
  jsonb, jsonb, integer, integer, uuid, bigint, uuid, bigint, integer, integer
);
drop function if exists public.save_assignment_doc_atomic(
  uuid, uuid, jsonb, timestamptz, text, integer, integer,
  jsonb, jsonb, integer, integer, uuid, bigint, bigint, integer, integer
);

create or replace function public.save_assignment_doc_atomic(
  p_assignment_id uuid,
  p_student_id uuid,
  p_content jsonb,
  p_expected_updated_at timestamptz,
  p_trigger text,
  p_paste_word_count integer,
  p_keystroke_count integer,
  p_patch jsonb,
  p_snapshot jsonb,
  p_word_count integer,
  p_char_count integer,
  p_save_session_id uuid,
  p_save_sequence bigint,
  p_metric_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.assignment_docs;
  v_history public.assignment_doc_history;
  v_last_history public.assignment_doc_history;
  v_prior_operation public.assignment_doc_save_operations;
  v_created boolean := false;
  v_revision_conflict boolean := false;
  v_content_changed boolean;
  v_fence_superseded_save boolean;
  v_effective_paste_word_count integer;
  v_effective_keystroke_count integer;
  v_committed_paste_word_count integer := 0;
  v_committed_keystroke_count bigint := 0;
  v_has_last_history boolean := false;
  v_content_sha256 text;
begin
  if p_assignment_id is null or p_student_id is null or p_content is null
    or p_save_session_id is null or p_save_sequence is null or p_save_sequence <= 0
    or p_metric_session_id is null then
    raise exception 'Invalid assignment document save request' using errcode = '22023';
  end if;
  if p_trigger not in ('autosave', 'blur', 'restore') then
    raise exception 'Invalid assignment document history trigger' using errcode = '22023';
  end if;
  if coalesce(p_paste_word_count, 0) < 0
    or coalesce(p_keystroke_count, 0) < 0
    or coalesce(p_word_count, 0) < 0
    or coalesce(p_char_count, 0) < 0 then
    raise exception 'Invalid assignment document history metrics' using errcode = '22023';
  end if;
  v_content_sha256 := private.assignment_content_sha256(p_content);

  perform pg_advisory_xact_lock(hashtextextended(p_assignment_id::text || ':' || p_student_id::text, 0));

  select * into v_doc
  from public.assignment_docs
  where assignment_id = p_assignment_id and student_id = p_student_id
  for update;

  if not found then
    if p_expected_updated_at is not null then
      return jsonb_build_object(
        'ok', false, 'status', 409, 'error_code', 'assignment_doc_revision_conflict',
        'error', 'This draft changed elsewhere before the save completed. Reload and review the latest version.'
      );
    end if;

    insert into public.assignment_docs (
      assignment_id, student_id, content, repo_url, github_username, is_submitted, submitted_at,
      save_session_id, save_sequence
    ) values (
      p_assignment_id, p_student_id, p_content, null, null, false, null,
      p_save_session_id, p_save_sequence
    ) returning * into v_doc;
    v_created := true;

    insert into public.assignment_doc_history (
      assignment_doc_id, patch, snapshot, word_count, char_count,
      paste_word_count, keystroke_count, trigger, created_at
    ) values (
      v_doc.id, null, p_content, coalesce(p_word_count, 0), coalesce(p_char_count, 0),
      coalesce(p_paste_word_count, 0), coalesce(p_keystroke_count, 0), 'baseline', clock_timestamp()
    ) returning * into v_history;

    insert into public.assignment_doc_save_operations (
      assignment_doc_id, save_session_id, save_sequence, metric_session_id,
      paste_word_count, keystroke_count, content_sha256, document_updated_at
    ) values (
      v_doc.id, p_save_session_id, p_save_sequence, p_metric_session_id,
      coalesce(p_paste_word_count, 0), coalesce(p_keystroke_count, 0),
      v_content_sha256, v_doc.updated_at
    );

    return jsonb_build_object(
      'ok', true, 'created', true, 'doc', to_jsonb(v_doc), 'history_entry', to_jsonb(v_history)
    );
  end if;

  if v_doc.is_submitted then
    return jsonb_build_object(
      'ok', false, 'status', 403, 'error_code', 'assignment_doc_submitted',
      'error', 'Cannot edit a submitted document'
    );
  end if;

  select * into v_prior_operation
  from public.assignment_doc_save_operations operation
  where operation.assignment_doc_id = v_doc.id
    and operation.save_session_id = p_save_session_id
    and operation.save_sequence = p_save_sequence;

  if found then
    if v_prior_operation.content_sha256 <> v_content_sha256
      or v_prior_operation.metric_session_id <> p_metric_session_id
      or v_prior_operation.paste_word_count <> coalesce(p_paste_word_count, 0)
      or v_prior_operation.keystroke_count <> coalesce(p_keystroke_count, 0) then
      return jsonb_build_object(
        'ok', false, 'status', 409, 'error_code', 'assignment_doc_save_superseded',
        'error', 'This save identifier was already used for different content.'
      );
    end if;
    if v_doc.save_session_id = p_save_session_id
      and v_doc.save_sequence = p_save_sequence
      and v_doc.content = p_content then
      return jsonb_build_object(
        'ok', true, 'created', false, 'doc', to_jsonb(v_doc), 'history_entry', null
      );
    end if;
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'assignment_doc_save_replayed',
      'error', 'This save completed, but a newer saved version now exists.'
    );
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'assignment_doc_revision_required',
      'error', 'A saved draft revision is required. Reload and try again.'
    );
  end if;

  if v_doc.save_session_id = p_save_session_id
    and coalesce(v_doc.save_sequence, 0) >= p_save_sequence then
    if v_doc.save_sequence = p_save_sequence and v_doc.content = p_content then
      return jsonb_build_object(
        'ok', true, 'created', false, 'doc', to_jsonb(v_doc), 'history_entry', null
      );
    end if;
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'assignment_doc_save_superseded',
      'error', 'A newer save from this editor already completed.'
    );
  end if;

  v_fence_superseded_save := v_doc.save_session_id = p_save_session_id
    and p_save_sequence > coalesce(v_doc.save_sequence, 0)
    and exists (
      select 1
      from public.assignment_doc_save_operations operation
      where operation.assignment_doc_id = v_doc.id
        and operation.save_session_id = v_doc.save_session_id
        and operation.save_sequence = v_doc.save_sequence
        and operation.document_updated_at = v_doc.updated_at
    );

  if v_doc.updated_at <> p_expected_updated_at then
    if v_fence_superseded_save then
      v_revision_conflict := true;
    else
      return jsonb_build_object(
        'ok', false, 'status', 409, 'error_code', 'assignment_doc_revision_conflict',
        'error', 'This draft changed elsewhere before the save completed. Reload and review the latest version.'
      );
    end if;
  end if;

  v_content_changed := v_doc.content is distinct from p_content;
  select
    coalesce(max(operation.paste_word_count), 0),
    coalesce(max(operation.keystroke_count), 0)
  into v_committed_paste_word_count, v_committed_keystroke_count
  from public.assignment_doc_save_operations operation
  where operation.assignment_doc_id = v_doc.id
    and operation.metric_session_id = p_metric_session_id;
  v_effective_paste_word_count := greatest(
    0,
    coalesce(p_paste_word_count, 0) - v_committed_paste_word_count
  );
  v_effective_keystroke_count := greatest(
    0,
    coalesce(p_keystroke_count, 0) - v_committed_keystroke_count
  )::integer;

  if not v_content_changed
    and v_effective_paste_word_count = 0
    and v_effective_keystroke_count = 0
    and not v_fence_superseded_save then
    insert into public.assignment_doc_save_operations (
      assignment_doc_id, save_session_id, save_sequence, metric_session_id,
      paste_word_count, keystroke_count, content_sha256, document_updated_at
    ) values (
      v_doc.id, p_save_session_id, p_save_sequence, p_metric_session_id,
      coalesce(p_paste_word_count, 0), coalesce(p_keystroke_count, 0),
      v_content_sha256, v_doc.updated_at
    );
    return jsonb_build_object(
      'ok', true, 'created', false, 'doc', to_jsonb(v_doc), 'history_entry', null
    );
  end if;

  if v_content_changed
    or v_effective_paste_word_count > 0
    or v_effective_keystroke_count > 0 then
    select * into v_last_history
    from public.assignment_doc_history
    where assignment_doc_id = v_doc.id
    order by created_at desc, id desc
    limit 1
    for update;
    v_has_last_history := found;
  end if;

  update public.assignment_docs
  set content = p_content,
      save_session_id = p_save_session_id,
      save_sequence = p_save_sequence
  where id = v_doc.id and is_submitted is false
  returning * into v_doc;

  if not found then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'assignment_doc_revision_conflict',
      'error', 'This draft changed elsewhere before the save completed. Reload and review the latest version.'
    );
  end if;

  if v_content_changed
    or v_effective_paste_word_count > 0
    or v_effective_keystroke_count > 0 then
    if not v_has_last_history then
      insert into public.assignment_doc_history (
        assignment_doc_id, patch, snapshot, word_count, char_count,
        paste_word_count, keystroke_count, trigger, created_at
      ) values (
        v_doc.id, null, p_content, coalesce(p_word_count, 0), coalesce(p_char_count, 0),
        v_effective_paste_word_count, v_effective_keystroke_count, 'baseline', clock_timestamp()
      ) returning * into v_history;
    elsif p_trigger <> 'restore'
      and v_last_history.trigger not in ('submit', 'restore')
      and v_last_history.created_at > clock_timestamp() - interval '10 seconds' then
      update public.assignment_doc_history
      set patch = null,
          snapshot = p_content,
          word_count = coalesce(p_word_count, 0),
          char_count = coalesce(p_char_count, 0),
          paste_word_count = coalesce(v_last_history.paste_word_count, 0) + v_effective_paste_word_count,
          keystroke_count = coalesce(v_last_history.keystroke_count, 0) + v_effective_keystroke_count,
          trigger = p_trigger,
          created_at = clock_timestamp()
      where id = v_last_history.id
      returning * into v_history;
    else
      insert into public.assignment_doc_history (
        assignment_doc_id, patch, snapshot, word_count, char_count,
        paste_word_count, keystroke_count, trigger, created_at
      ) values (
        v_doc.id,
        case
          when v_revision_conflict or p_snapshot is not null or p_patch is null or p_patch = '[]'::jsonb
            then null
          else p_patch
        end,
        case
          when v_revision_conflict or p_snapshot is not null or p_patch is null or p_patch = '[]'::jsonb
            then p_content
          else null
        end,
        coalesce(p_word_count, 0), coalesce(p_char_count, 0),
        v_effective_paste_word_count, v_effective_keystroke_count, p_trigger, clock_timestamp()
      ) returning * into v_history;
    end if;
  end if;

  insert into public.assignment_doc_save_operations (
    assignment_doc_id, save_session_id, save_sequence, metric_session_id,
    paste_word_count, keystroke_count, content_sha256, document_updated_at
  ) values (
    v_doc.id, p_save_session_id, p_save_sequence, p_metric_session_id,
    coalesce(p_paste_word_count, 0), coalesce(p_keystroke_count, 0),
    v_content_sha256, v_doc.updated_at
  );

  return jsonb_build_object(
    'ok', true, 'created', v_created, 'doc', to_jsonb(v_doc),
    'history_entry', case when v_history.id is null then null else to_jsonb(v_history) end
  );
end;
$$;

create or replace function public.submit_assignment_doc_atomic(
  p_assignment_id uuid,
  p_student_id uuid,
  p_content jsonb,
  p_expected_updated_at timestamptz,
  p_word_count integer,
  p_char_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.assignment_docs;
  v_history public.assignment_doc_history;
begin
  if p_assignment_id is null or p_student_id is null or p_content is null
    or p_expected_updated_at is null then
    raise exception 'Invalid assignment document submission request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('assignment_submission:' || p_assignment_id::text, 0)
  );

  select * into v_doc
  from public.assignment_docs
  where assignment_id = p_assignment_id and student_id = p_student_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false, 'status', 400, 'error_code', 'assignment_doc_missing',
      'error', 'No work to submit. Please save your work first.'
    );
  end if;

  if v_doc.is_submitted then
    if v_doc.content = p_content then
      select * into v_history
      from public.assignment_doc_history
      where assignment_doc_id = v_doc.id
        and trigger = 'submit'
        and created_at >= coalesce(v_doc.submitted_at, '-infinity'::timestamptz)
        and patch is null
        and snapshot = v_doc.content
      order by created_at desc, id desc
      limit 1;

      if not found then
        insert into public.assignment_doc_history (
          assignment_doc_id, patch, snapshot, word_count, char_count,
          paste_word_count, keystroke_count, trigger, created_at
        ) values (
          v_doc.id, null, v_doc.content, coalesce(p_word_count, 0), coalesce(p_char_count, 0),
          0, 0, 'submit', clock_timestamp()
        ) returning * into v_history;
      end if;

      return jsonb_build_object(
        'ok', true, 'idempotent', true, 'doc', to_jsonb(v_doc),
        'history_entry', to_jsonb(v_history)
      );
    end if;
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'assignment_doc_submitted',
      'error', 'This assignment is already submitted and cannot be changed.'
    );
  end if;

  if v_doc.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'assignment_doc_revision_conflict',
      'error', 'Your saved draft changed before submission. Review it and try again.'
    );
  end if;

  perform private.validate_assignment_submission_requirements(v_doc);

  update public.assignment_docs
  set content = p_content,
      is_submitted = true,
      submitted_at = clock_timestamp()
  where id = v_doc.id and is_submitted is false
  returning * into v_doc;

  insert into public.assignment_doc_history (
    assignment_doc_id, patch, snapshot, word_count, char_count,
    paste_word_count, keystroke_count, trigger, created_at
  ) values (
    v_doc.id, null, p_content, coalesce(p_word_count, 0), coalesce(p_char_count, 0),
    0, 0, 'submit', clock_timestamp()
  ) returning * into v_history;

  return jsonb_build_object(
    'ok', true, 'idempotent', false, 'doc', to_jsonb(v_doc), 'history_entry', to_jsonb(v_history)
  );
end;
$$;

create or replace function public.unsubmit_assignment_doc_atomic(
  p_assignment_id uuid,
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.assignment_docs;
begin
  if p_assignment_id is null or p_student_id is null then
    raise exception 'Invalid assignment document unsubmit request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('assignment_submission:' || p_assignment_id::text, 0)
  );

  select * into v_doc
  from public.assignment_docs
  where assignment_id = p_assignment_id and student_id = p_student_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false, 'status', 404, 'error_code', 'assignment_doc_missing',
      'error', 'Assignment doc not found'
    );
  end if;

  if not v_doc.is_submitted then
    return jsonb_build_object(
      'ok', false, 'status', 400, 'error_code', 'assignment_doc_not_submitted',
      'error', 'Assignment is not submitted'
    );
  end if;

  if (
    v_doc.returned_at is not null
    and (v_doc.submitted_at is null or v_doc.returned_at >= v_doc.submitted_at)
  ) or (
    v_doc.teacher_cleared_at is not null
    and (v_doc.submitted_at is null or v_doc.teacher_cleared_at >= v_doc.submitted_at)
  ) then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'assignment_doc_returned',
      'error', 'Returned submissions cannot be unsubmitted'
    );
  end if;

  update public.assignment_docs
  set is_submitted = false,
      submitted_at = null
  where id = v_doc.id
  returning * into v_doc;

  return jsonb_build_object('ok', true, 'doc', to_jsonb(v_doc));
end;
$$;

create or replace function public.delete_assignment_submission_artifact_atomic(
  p_assignment_id uuid,
  p_student_id uuid,
  p_requirement_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc_id uuid;
  v_is_submitted boolean;
  v_storage_path text;
begin
  if p_assignment_id is null or p_student_id is null or p_requirement_id is null then
    raise exception 'Invalid assignment artifact deletion request' using errcode = '22023';
  end if;

  select artifact.storage_path, doc.id
  into v_storage_path, v_doc_id
  from public.assignment_submission_artifacts artifact
  join public.assignment_docs doc on doc.id = artifact.assignment_doc_id
  where doc.assignment_id = p_assignment_id
    and doc.student_id = p_student_id
    and artifact.requirement_id = p_requirement_id
  for update of artifact;

  if not found then
    return jsonb_build_object(
      'ok', true, 'deleted', false, 'storage_path', null
    );
  end if;

  select is_submitted into v_is_submitted
  from public.assignment_docs
  where id = v_doc_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'assignment_doc_missing',
      'error', 'Assignment doc changed before the artifact could be deleted'
    );
  end if;
  if v_is_submitted then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'assignment_doc_submitted',
      'error', 'Cannot edit a submitted document'
    );
  end if;

  delete from public.assignment_submission_artifacts
  where assignment_doc_id = v_doc_id
    and requirement_id = p_requirement_id
  returning storage_path into v_storage_path;

  return jsonb_build_object(
    'ok', true,
    'deleted', found,
    'storage_path', v_storage_path
  );
end;
$$;

create or replace function public.claim_assignment_artifact_storage_cleanup(
  p_lease_token uuid,
  p_limit integer,
  p_lease_seconds integer
)
returns setof public.assignment_artifact_storage_cleanup
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_lease_token is null or p_limit is null or p_limit < 1 or p_limit > 100
    or p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'Invalid assignment artifact cleanup claim' using errcode = '22023';
  end if;

  -- A committed artifact row adopts its provisional object. Removing that
  -- evidence before claims makes a failed best-effort cancellation harmless.
  delete from public.assignment_artifact_storage_cleanup cleanup
  using public.assignment_submission_artifacts artifact
  where artifact.storage_path = cleanup.storage_path;

  return query
  with candidates as (
    select cleanup.id
    from public.assignment_artifact_storage_cleanup cleanup
    where ((
        cleanup.status = 'pending'
        and cleanup.next_attempt_at <= clock_timestamp()
      ) or (
        cleanup.status = 'processing'
        and cleanup.lease_expires_at <= clock_timestamp()
      ))
      and not exists (
        select 1
        from public.assignment_submission_artifacts artifact
        where artifact.storage_path = cleanup.storage_path
      )
    order by cleanup.next_attempt_at, cleanup.created_at, cleanup.id
    limit p_limit
    for update skip locked
  )
  update public.assignment_artifact_storage_cleanup cleanup
  set status = 'processing',
      attempt_count = cleanup.attempt_count + 1,
      lease_token = p_lease_token,
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      last_error = null,
      updated_at = clock_timestamp()
  from candidates
  where cleanup.id = candidates.id
  returning cleanup.*;
end;
$$;

create or replace function public.claim_assignment_artifact_storage_cleanup_path(
  p_storage_path text,
  p_lease_token uuid,
  p_lease_seconds integer
)
returns setof public.assignment_artifact_storage_cleanup
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_storage_path is null or btrim(p_storage_path) = '' or p_lease_token is null
    or p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'Invalid assignment artifact cleanup path claim' using errcode = '22023';
  end if;

  return query
  update public.assignment_artifact_storage_cleanup cleanup
  set status = 'processing',
      attempt_count = cleanup.attempt_count + 1,
      lease_token = p_lease_token,
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      last_error = null,
      updated_at = clock_timestamp()
  where cleanup.storage_path = p_storage_path
    and (
      cleanup.status = 'pending'
      or (
        cleanup.status = 'processing'
        and cleanup.lease_expires_at <= clock_timestamp()
      )
    )
  returning cleanup.*;
end;
$$;

create or replace function public.complete_assignment_artifact_storage_cleanup(
  p_cleanup_id uuid,
  p_lease_token uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  delete from public.assignment_artifact_storage_cleanup
  where id = p_cleanup_id
    and status = 'processing'
    and lease_token = p_lease_token
    and lease_expires_at > clock_timestamp()
  returning true;
$$;

drop function if exists public.complete_assignment_artifact_storage_cleanup_path(text);

create or replace function public.fail_assignment_artifact_storage_cleanup(
  p_cleanup_id uuid,
  p_lease_token uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.assignment_artifact_storage_cleanup cleanup
  set status = 'pending',
      next_attempt_at = clock_timestamp()
        + make_interval(
          secs => least(3600, (power(2::numeric, least(cleanup.attempt_count, 6)) * 60)::integer)
        ),
      lease_token = null,
      lease_expires_at = null,
      last_error = left(coalesce(p_error, 'Storage cleanup failed'), 1000),
      updated_at = clock_timestamp()
  where cleanup.id = p_cleanup_id
    and cleanup.status = 'processing'
    and cleanup.lease_token = p_lease_token
    and cleanup.lease_expires_at > clock_timestamp();
  return found;
end;
$$;

-- Old app instances call this RPC directly during migration-first rollout.
-- Acquire the same assignment lock as the combined authoring RPC before row DML.
create or replace function public.replace_assignment_submission_requirements_atomic(
  p_assignment_id uuid,
  p_requirements jsonb
)
returns setof public.assignment_submission_requirements
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_requirement jsonb;
  v_requirement_id uuid;
  v_existing_id uuid;
  v_type text;
  v_label text;
  v_instructions text;
  v_required boolean;
  v_position integer;
  v_policy jsonb;
  v_preserved_ids uuid[] := array[]::uuid[];
  v_index integer := 0;
begin
  if p_requirements is null or jsonb_typeof(p_requirements) <> 'array' then
    raise exception 'p_requirements must be a JSON array';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('assignment_submission:' || p_assignment_id::text, 0)
  );

  for v_requirement in select value from jsonb_array_elements(p_requirements)
  loop
    v_type := v_requirement->>'type';
    if v_type not in ('repo_link', 'link', 'image') then
      raise exception 'Invalid assignment submission requirement type: %', coalesce(v_type, '<null>');
    end if;

    begin
      v_requirement_id := nullif(v_requirement->>'id', '')::uuid;
    exception when invalid_text_representation then
      v_requirement_id := null;
    end;

    v_label := nullif(btrim(coalesce(v_requirement->>'label', '')), '');
    if v_label is null then
      v_label := case v_type
        when 'repo_link' then 'Repo link'
        when 'image' then 'Screenshot'
        else 'Public link'
      end;
    end if;

    v_instructions := btrim(coalesce(v_requirement->>'instructions', ''));
    v_required := coalesce((v_requirement->>'required')::boolean, true);
    v_position := coalesce((v_requirement->>'position')::integer, v_index);
    v_policy := case
      when jsonb_typeof(v_requirement->'validation_policy_json') = 'object'
        then v_requirement->'validation_policy_json'
      else '{}'::jsonb
    end;

    v_existing_id := null;
    if v_requirement_id is not null then
      update public.assignment_submission_requirements
      set label = v_label,
          instructions = v_instructions,
          required = v_required,
          position = v_position,
          validation_policy_json = v_policy
      where id = v_requirement_id
        and assignment_id = p_assignment_id
        and type = v_type
      returning id into v_existing_id;
    end if;

    if v_existing_id is null then
      insert into public.assignment_submission_requirements (
        assignment_id, type, label, instructions, required, position, validation_policy_json
      ) values (
        p_assignment_id, v_type, v_label, v_instructions, v_required, v_position, v_policy
      ) returning id into v_existing_id;
    end if;

    v_preserved_ids := array_append(v_preserved_ids, v_existing_id);
    v_index := v_index + 1;
  end loop;

  delete from public.assignment_submission_requirements
  where assignment_id = p_assignment_id
    and not (id = any(v_preserved_ids));

  return query
  select *
  from public.assignment_submission_requirements
  where assignment_id = p_assignment_id
  order by position asc, created_at asc;
end;
$$;

create or replace function public.update_assignment_with_submission_requirements_atomic(
  p_assignment_id uuid,
  p_updates jsonb,
  p_requirements jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.assignments;
  v_requirements jsonb;
  v_artifact_id uuid;
  v_doc_id uuid;
begin
  if p_assignment_id is null
    or p_updates is null
    or jsonb_typeof(p_updates) <> 'object'
    or p_requirements is null
    or jsonb_typeof(p_requirements) <> 'array' then
    raise exception 'Invalid assignment requirement update request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('assignment_submission:' || p_assignment_id::text, 0)
  );

  select * into v_assignment
  from public.assignments
  where id = p_assignment_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false, 'status', 404, 'error_code', 'assignment_not_found',
      'error', 'Assignment not found'
    );
  end if;

  for v_artifact_id in
    select artifact.id
    from public.assignment_submission_artifacts artifact
    join public.assignment_docs doc on doc.id = artifact.assignment_doc_id
    where doc.assignment_id = p_assignment_id
    order by artifact.id
    for update of artifact
  loop
    null;
  end loop;

  for v_doc_id in
    select doc.id
    from public.assignment_docs doc
    where doc.assignment_id = p_assignment_id
    order by doc.id
    for update
  loop
    null;
  end loop;

  if exists (
    select 1 from public.assignment_docs
    where assignment_id = p_assignment_id and is_submitted is true
  ) then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'assignment_requirements_submitted',
      'error', 'Submission requirements cannot be changed after a student submits.'
    );
  end if;

  if p_updates <> '{}'::jsonb then
    update public.assignments
    set title = case when p_updates ? 'title' then p_updates->>'title' else title end,
      instructions_markdown = case
        when p_updates ? 'instructions_markdown' then p_updates->>'instructions_markdown'
        else instructions_markdown
      end,
      description = case
        when p_updates ? 'description' then p_updates->>'description'
        else description
      end,
      rich_instructions = case
        when p_updates ? 'rich_instructions' then p_updates->'rich_instructions'
        else rich_instructions
      end,
      due_at = case
        when p_updates ? 'due_at' then (p_updates->>'due_at')::timestamptz
        else due_at
      end,
      is_draft = case
        when p_updates ? 'is_draft' then (p_updates->>'is_draft')::boolean
        else is_draft
      end,
      released_at = case
        when not (p_updates ? 'released_at') then released_at
        when p_updates->'released_at' = 'null'::jsonb then null
        else (p_updates->>'released_at')::timestamptz
      end
    where id = p_assignment_id
    returning * into v_assignment;
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.position, r.created_at, r.id), '[]'::jsonb)
  into v_requirements
  from public.replace_assignment_submission_requirements_atomic(
    p_assignment_id,
    p_requirements
  ) r;

  return jsonb_build_object(
    'ok', true,
    'assignment', to_jsonb(v_assignment),
    'submission_requirements', v_requirements
  );
end;
$$;

revoke all on function public.guard_assignment_submission_requirement_mutation() from public, anon, authenticated, service_role;
revoke all on function public.guard_assignment_submission_artifact_mutation() from public, anon, authenticated, service_role;
revoke all on function private.validate_assignment_submission_requirements(public.assignment_docs) from public, anon, authenticated, service_role;
revoke all on function public.validate_assignment_submission_transition() from public, anon, authenticated, service_role;
revoke all on function public.guard_assignment_doc_history_after_submit() from public, anon, authenticated, service_role;
revoke all on function public.guard_submitted_assignment_doc_content() from public, anon, authenticated, service_role;
revoke all on function public.enqueue_deleted_assignment_artifact_storage_cleanup() from public, anon, authenticated, service_role;
revoke all on function public.ensure_current_assignment_submit_history() from public, anon, authenticated, service_role;
revoke all on function private.assignment_content_sha256(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.assignment_tiptap_node_text(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.assignment_tiptap_plain_text(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.save_assignment_doc_atomic(uuid, uuid, jsonb, timestamptz, text, integer, integer, jsonb, jsonb, integer, integer, uuid, bigint, uuid) from public, anon, authenticated;
revoke all on function public.submit_assignment_doc_atomic(uuid, uuid, jsonb, timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.unsubmit_assignment_doc_atomic(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_assignment_submission_artifact_atomic(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_assignment_artifact_storage_cleanup(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.claim_assignment_artifact_storage_cleanup_path(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.complete_assignment_artifact_storage_cleanup(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fail_assignment_artifact_storage_cleanup(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.enqueue_assignment_artifact_storage_cleanup_path(text, integer) from public, anon, authenticated;
revoke all on function public.cleanup_assignment_doc_save_operations(timestamptz) from public, anon, authenticated;
revoke all on function public.update_assignment_with_submission_requirements_atomic(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.normalize_classroom_archive_restore_row(uuid, text, jsonb) from public, anon, authenticated;
revoke all on table public.assignment_artifact_storage_cleanup from anon, authenticated;
revoke all on table public.assignment_doc_save_operations from anon, authenticated;
grant select, insert, delete on table public.assignment_artifact_storage_cleanup to service_role;

grant execute on function public.save_assignment_doc_atomic(uuid, uuid, jsonb, timestamptz, text, integer, integer, jsonb, jsonb, integer, integer, uuid, bigint, uuid) to service_role;
grant execute on function public.submit_assignment_doc_atomic(uuid, uuid, jsonb, timestamptz, integer, integer) to service_role;
grant execute on function public.unsubmit_assignment_doc_atomic(uuid, uuid) to service_role;
grant execute on function public.delete_assignment_submission_artifact_atomic(uuid, uuid, uuid) to service_role;
grant execute on function public.claim_assignment_artifact_storage_cleanup(uuid, integer, integer) to service_role;
grant execute on function public.claim_assignment_artifact_storage_cleanup_path(text, uuid, integer) to service_role;
grant execute on function public.complete_assignment_artifact_storage_cleanup(uuid, uuid) to service_role;
grant execute on function public.fail_assignment_artifact_storage_cleanup(uuid, uuid, text) to service_role;
grant execute on function public.enqueue_assignment_artifact_storage_cleanup_path(text, integer) to service_role;
grant execute on function public.cleanup_assignment_doc_save_operations(timestamptz) to service_role;
grant execute on function public.update_assignment_with_submission_requirements_atomic(uuid, jsonb, jsonb) to service_role;
grant execute on function public.normalize_classroom_archive_restore_row(uuid, text, jsonb) to service_role;
grant select, insert, update, delete on table public.assignment_artifact_storage_cleanup to service_role;
grant select, insert, update, delete on table public.assignment_doc_save_operations to service_role;

comment on function public.guard_assignment_submission_requirement_mutation() is
  'Prevents requirement changes from invalidating existing submitted assignment documents.';
comment on function public.guard_assignment_submission_artifact_mutation() is
  'Locks the owning assignment document and rejects artifact mutations after submission.';
comment on function private.validate_assignment_submission_requirements(public.assignment_docs) is
  'Validates structured assignment evidence for a locked assignment document.';
comment on function public.guard_assignment_doc_history_after_submit() is
  'Serializes history writes with submission and preserves authoritative submit entries.';
comment on function public.save_assignment_doc_atomic(uuid, uuid, jsonb, timestamptz, text, integer, integer, jsonb, jsonb, integer, integer, uuid, bigint, uuid) is
  'Atomically saves one assignment draft and its versioned history evidence.';
comment on table public.assignment_doc_save_operations is
  'Compact assignment save idempotency digests retained slightly longer than browser recovery drafts.';
comment on function public.submit_assignment_doc_atomic(uuid, uuid, jsonb, timestamptz, integer, integer) is
  'Atomically submits one assignment document and records its authoritative snapshot.';
comment on function public.unsubmit_assignment_doc_atomic(uuid, uuid) is
  'Atomically unsubmits one assignment document unless teacher return state has already won the row lock.';
comment on function public.delete_assignment_submission_artifact_atomic(uuid, uuid, uuid) is
  'Deletes one unsubmitted assignment artifact and durably queues its Storage object for cleanup.';
comment on function public.claim_assignment_artifact_storage_cleanup(uuid, integer, integer) is
  'Claims due assignment artifact Storage cleanup rows with an expiring lease.';
comment on function public.claim_assignment_artifact_storage_cleanup_path(text, uuid, integer) is
  'Claims one exact assignment artifact Storage path without revoking another worker lease.';
comment on function public.update_assignment_with_submission_requirements_atomic(uuid, jsonb, jsonb) is
  'Atomically updates assignment fields and submission requirements before any student submission.';
comment on function public.normalize_classroom_archive_restore_row(uuid, text, jsonb) is
  'Adapts verified archive rows to the current schema, including pre-099 assignment document save fences.';
