-- Independent-review hardening for permanent hot archived classroom deletion.
-- Close storage-reference races, fence operational cleanup workers, and keep
-- interrupted archive/Gradex upload evidence available until purge completion.

create or replace function public.classroom_purge_conflict(p_classroom_id uuid)
returns text
language plpgsql
stable
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.classroom_archive_operations operation
    where operation.classroom_id = p_classroom_id
      and (
        (
          operation.status = 'snapshot_ready'
          and operation.snapshot_expires_at > clock_timestamp()
        )
        or (
          operation.status = 'failed'
          and operation.retryable is true
          and operation.snapshot_expires_at > clock_timestamp()
        )
      )
  ) then
    return 'classroom_archive_operation_active';
  end if;

  if exists (
    select 1
    from public.classroom_archive_object_upload_cleanup cleanup
    join public.classroom_archive_operations operation
      on operation.id = cleanup.operation_id
    where operation.classroom_id = p_classroom_id
      and cleanup.status = 'processing'
      and cleanup.lease_expires_at > clock_timestamp()
  ) or exists (
    select 1
    from public.classroom_gradex_extract_cleanup cleanup
    join public.classroom_archive_operations operation
      on operation.id = cleanup.operation_id
    where operation.classroom_id = p_classroom_id
      and cleanup.status = 'processing'
      and cleanup.lease_expires_at > clock_timestamp()
  ) then
    return 'classroom_storage_cleanup_active';
  end if;

  if exists (
    select 1
    from public.assignment_ai_grading_runs run
    join public.assignments assignment on assignment.id = run.assignment_id
    where assignment.classroom_id = p_classroom_id
      and run.status in ('queued', 'running')
  ) or exists (
    select 1
    from public.assignment_repo_review_runs run
    join public.assignments assignment on assignment.id = run.assignment_id
    where assignment.classroom_id = p_classroom_id
      and run.status in ('queued', 'running')
  ) or exists (
    select 1
    from public.test_ai_grading_runs run
    join public.tests test on test.id = run.test_id
    where test.classroom_id = p_classroom_id
      and run.status in ('queued', 'running')
  ) then
    return 'classroom_grading_operation_active';
  end if;

  if exists (
    select 1
    from public.course_blueprint_operations operation
    where operation.status = 'running'
      and (
        operation.source_classroom_id = p_classroom_id
        or operation.result_classroom_id = p_classroom_id
      )
  ) or exists (
    select 1
    from public.course_blueprint_change_proposals proposal
    where proposal.status in ('ready', 'needs_review', 'conflicted')
      and (
        proposal.source_classroom_id = p_classroom_id
        or proposal.target_classroom_id = p_classroom_id
      )
  ) or exists (
    select 1
    from public.course_blueprint_editing_sessions session
    where session.status = 'ready'
      and session.expires_at > clock_timestamp()
      and session.classroom_id = p_classroom_id
  ) then
    return 'classroom_blueprint_operation_active';
  end if;

  return null;
end;
$$;

create or replace function public.classroom_purge_storage_path_has_external_operation_reference(
  p_operation_id uuid,
  p_storage_bucket text,
  p_storage_path text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_classroom_id uuid;
begin
  select classroom_id into v_classroom_id
  from public.classroom_purge_operations
  where id = p_operation_id;

  if v_classroom_id is null then
    return true;
  end if;

  return exists (
    select 1
    from public.classroom_archives archive
    where archive.storage_bucket = p_storage_bucket
      and archive.storage_path = p_storage_path
      and archive.classroom_id <> v_classroom_id
  ) or exists (
    select 1
    from public.classroom_gradex_extracts extract
    where extract.storage_bucket = p_storage_bucket
      and extract.storage_path = p_storage_path
      and extract.classroom_id <> v_classroom_id
  ) or exists (
    select 1
    from public.classroom_archive_operations operation
    where operation.storage_bucket = p_storage_bucket
      and operation.storage_path = p_storage_path
      and operation.classroom_id <> v_classroom_id
  ) or exists (
    select 1
    from public.classroom_archive_object_upload_cleanup cleanup
    join public.classroom_archive_operations operation
      on operation.id = cleanup.operation_id
    where cleanup.storage_bucket = p_storage_bucket
      and cleanup.storage_path = p_storage_path
      and operation.classroom_id <> v_classroom_id
  ) or exists (
    select 1
    from public.classroom_gradex_extract_cleanup cleanup
    join public.classroom_archive_operations operation
      on operation.id = cleanup.operation_id
    where cleanup.storage_bucket = p_storage_bucket
      and cleanup.storage_path = p_storage_path
      and operation.classroom_id <> v_classroom_id
  );
end;
$$;

create or replace function public.reconcile_classroom_purge_object_sharing(
  p_operation_id uuid,
  p_teacher_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.classroom_purge_operations;
  v_object public.classroom_purge_objects;
  v_counts jsonb;
begin
  select * into v_operation
  from public.classroom_purge_operations
  where id = p_operation_id
  for update;

  if not found or v_operation.teacher_id <> p_teacher_id then
    return jsonb_build_object(
      'ok', false, 'status', 404, 'error_code', 'purge_not_found',
      'error', 'Permanent deletion not found'
    );
  end if;
  if v_operation.inventory_completed_at is not null then
    return jsonb_build_object(
      'ok', true, 'status', 202, 'operation_id', p_operation_id,
      'operation_status', v_operation.status, 'replayed', true
    );
  end if;

  -- All managed-reference writers take the matching shared transaction lock.
  -- This exclusive barrier waits for earlier writers and blocks later writers
  -- until every staged path has been rechecked against committed references.
  perform pg_advisory_xact_lock(
    hashtextextended('pika-classroom-purge-storage-references', 0)
  );

  for v_object in
    select *
    from public.classroom_purge_objects
    where operation_id = p_operation_id
    order by id
    for update
  loop
    if v_object.storage_path is null then
      continue;
    end if;
    if v_object.disposition = 'preserve_shared'
      or public.classroom_purge_storage_path_is_shared(
        p_operation_id,
        v_object.storage_bucket,
        v_object.storage_path
      )
      or public.classroom_purge_storage_path_has_external_operation_reference(
        p_operation_id,
        v_object.storage_bucket,
        v_object.storage_path
      )
    then
      update public.classroom_purge_objects
      set
        disposition = 'preserve_shared',
        status = 'preserved',
        storage_path = null,
        lease_token = null,
        lease_expires_at = null,
        last_error_code = null,
        updated_at = clock_timestamp()
      where id = v_object.id
        and status not in ('processing', 'deleted');
    end if;
  end loop;

  select coalesce(jsonb_object_agg(status, object_count), '{}'::jsonb)
  into v_counts
  from (
    select status, count(*)::integer object_count
    from public.classroom_purge_objects
    where operation_id = p_operation_id
    group by status
  ) counts;

  update public.classroom_purge_operations
  set
    storage_object_counts = v_counts,
    updated_at = clock_timestamp()
  where id = p_operation_id;

  return jsonb_build_object(
    'ok', true, 'status', 202, 'operation_id', p_operation_id,
    'operation_status', v_operation.status, 'replayed', false
  );
end;
$$;

create or replace function public.claim_classroom_purge_object(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 60
)
returns setof public.classroom_purge_objects
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate public.classroom_purge_objects;
begin
  if p_lease_seconds < 15 or p_lease_seconds > 300 then
    raise exception 'Invalid classroom purge lease' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.classroom_purge_operations
    where id = p_operation_id
      and teacher_id = p_teacher_id
      and status in ('deleting_objects', 'failed')
  ) then
    raise exception 'Classroom purge operation not found' using errcode = 'P0002';
  end if;

  select * into v_candidate
  from public.classroom_purge_objects object
  where object.operation_id = p_operation_id
    and object.disposition = 'delete'
    and object.next_attempt_at <= clock_timestamp()
    and (
      object.status in ('pending', 'failed')
      or (
        object.status = 'processing'
        and object.lease_expires_at <= clock_timestamp()
      )
    )
  order by object.next_attempt_at, object.created_at, object.id
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;
  if v_candidate.storage_path is null then
    raise exception 'Classroom purge object path was redacted before deletion'
      using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('pika-classroom-purge-storage-references', 0)
  );
  if public.classroom_purge_storage_path_is_shared(
    p_operation_id,
    v_candidate.storage_bucket,
    v_candidate.storage_path
  ) or public.classroom_purge_storage_path_has_external_operation_reference(
    p_operation_id,
    v_candidate.storage_bucket,
    v_candidate.storage_path
  ) then
    update public.classroom_purge_objects
    set
      disposition = 'preserve_shared',
      status = 'preserved',
      storage_path = null,
      lease_token = null,
      lease_expires_at = null,
      last_error_code = null,
      updated_at = clock_timestamp()
    where id = v_candidate.id;
    return;
  end if;

  return query
  update public.classroom_purge_objects object
  set
    status = 'processing',
    attempt_count = object.attempt_count + 1,
    lease_token = p_lease_token,
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    last_error_code = null,
    updated_at = clock_timestamp()
  where object.id = v_candidate.id
  returning object.*;
end;
$$;

create or replace function public.reject_classroom_cleanup_change_during_purge()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_operation_id uuid;
  v_classroom_id uuid;
begin
  if current_setting('pika.classroom_purge_finalize', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_operation_id := case
    when tg_op = 'DELETE' then old.operation_id
    else new.operation_id
  end;
  select classroom_id into v_classroom_id
  from public.classroom_archive_operations
  where id = v_operation_id;
  if v_classroom_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  perform public.classroom_purge_lock(v_classroom_id);
  if exists (
    select 1
    from public.classroom_purge_fences
    where classroom_id = v_classroom_id
  ) then
    raise exception 'Classroom permanent deletion owns this storage cleanup'
      using errcode = '55000';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists classroom_purge_fence_archive_upload_cleanup
  on public.classroom_archive_object_upload_cleanup;
create trigger classroom_purge_fence_archive_upload_cleanup
before insert or update or delete on public.classroom_archive_object_upload_cleanup
for each row execute function public.reject_classroom_cleanup_change_during_purge();

drop trigger if exists classroom_purge_fence_gradex_cleanup
  on public.classroom_gradex_extract_cleanup;
create trigger classroom_purge_fence_gradex_cleanup
before insert or update or delete on public.classroom_gradex_extract_cleanup
for each row execute function public.reject_classroom_cleanup_change_during_purge();

update public.classroom_purge_objects
set storage_path = null, updated_at = clock_timestamp()
where disposition = 'preserve_shared'
  and status = 'preserved'
  and storage_path is not null;

revoke all on function public.classroom_purge_storage_path_has_external_operation_reference(
  uuid, text, text
) from public, anon, authenticated;
revoke all on function public.reconcile_classroom_purge_object_sharing(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.reject_classroom_cleanup_change_during_purge()
  from public, anon, authenticated;

grant execute on function public.reconcile_classroom_purge_object_sharing(uuid, uuid)
  to service_role;

comment on function public.reconcile_classroom_purge_object_sharing(uuid, uuid) is
  'Exclusive pre-seal barrier that converts newly shared managed paths to redacted preservation.';
comment on function public.reject_classroom_cleanup_change_during_purge() is
  'Hands interrupted archive and Gradex cleanup rows to the active classroom purge.';

-- Consolidated local-only hardening step.

-- Keep managed-file reservations live until relational purge finalization and
-- make archive/Gradex operational writers participate in the same barrier.

do $$
begin
  if exists (
    select 1
    from public.classroom_purge_objects object
    join public.classroom_purge_operations operation
      on operation.id = object.operation_id
    where object.disposition = 'delete'
      and object.status = 'deleted'
      and object.storage_path is null
      and operation.status <> 'completed'
  ) then
    raise exception
      'Cannot install purge reservation lifetime guard with unredactable active deleted objects'
      using errcode = '55000';
  end if;
end;
$$;

create or replace function public.complete_classroom_purge_object(
  p_object_id uuid,
  p_teacher_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.classroom_purge_objects object
  set
    status = 'deleted',
    -- Retain the path only while the purge is active so every reference writer
    -- remains fenced after Storage deletion and before relational finalization.
    storage_path = object.storage_path,
    lease_token = null,
    lease_expires_at = null,
    deleted_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where object.id = p_object_id
    and object.status = 'processing'
    and object.lease_token = p_lease_token
    and object.storage_path is not null
    and exists (
      select 1 from public.classroom_purge_operations operation
      where operation.id = object.operation_id
        and operation.teacher_id = p_teacher_id
        and operation.status in ('deleting_objects', 'failed')
    );
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.redact_classroom_purge_paths_on_completion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    update public.classroom_purge_objects
    set
      storage_path = null,
      updated_at = clock_timestamp()
    where operation_id = new.id
      and storage_path is not null;
  end if;
  return new;
end;
$$;

drop trigger if exists classroom_purge_redact_paths_on_completion
  on public.classroom_purge_operations;
create trigger classroom_purge_redact_paths_on_completion
before update of status on public.classroom_purge_operations
for each row execute function public.redact_classroom_purge_paths_on_completion();

revoke all on function public.redact_classroom_purge_paths_on_completion()
  from public, anon, authenticated;

comment on function public.complete_classroom_purge_object(uuid, uuid, uuid) is
  'Marks a leased managed object deleted while retaining its path reservation until atomic purge finalization.';
comment on function public.redact_classroom_purge_paths_on_completion() is
  'Atomically redacts managed paths from the purge ledger at the operation completion linearization point.';

-- Consolidated local-only hardening step.

-- Match managed paths as decoded JSON values rather than raw serialized JSON.
-- This closes reservation and sharing gaps for valid paths containing quotes,
-- control characters, percent escapes, or other URL-encoded characters.

create or replace function public.classroom_purge_percent_decode(p_value text)
returns text
language plpgsql
immutable
strict
security definer
set search_path = pg_catalog
as $$
declare
  v_bytes bytea := ''::bytea;
  v_character text;
  v_hex text;
  v_index integer := 1;
begin
  while v_index <= char_length(p_value) loop
    v_character := substr(p_value, v_index, 1);
    if v_character = '%'
      and v_index + 2 <= char_length(p_value)
      and substr(p_value, v_index + 1, 2) ~ '^[0-9A-Fa-f]{2}$'
    then
      v_hex := substr(p_value, v_index + 1, 2);
      v_bytes := v_bytes || decode(v_hex, 'hex');
      v_index := v_index + 3;
    else
      v_bytes := v_bytes || convert_to(v_character, 'UTF8');
      v_index := v_index + 1;
    end if;
  end loop;
  return convert_from(v_bytes, 'UTF8');
exception
  when others then
    -- Invalid or non-UTF-8 percent sequences are not canonical managed URLs.
    return null;
end;
$$;

create or replace function public.classroom_purge_jsonb_text_values(p_payload jsonb)
returns setof text
language sql
immutable
strict
security definer
set search_path = pg_catalog
as $$
  select value #>> '{}'
  from jsonb_path_query(
    p_payload,
    'strict $.** ? (@.type() == "string")'::jsonpath
  ) value;
$$;

create or replace function public.classroom_purge_storage_path_is_shared(
  p_operation_id uuid,
  p_storage_bucket text,
  p_storage_path text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_resource record;
  v_shared boolean;
begin
  if p_storage_bucket = 'assignment-artifacts' and exists (
    select 1
    from public.assignment_submission_artifacts artifact
    where artifact.storage_path = p_storage_path
      and not exists (
        select 1
        from public.classroom_purge_resources snapshot
        where snapshot.operation_id = p_operation_id
          and snapshot.table_name = 'assignment_submission_artifacts'
          and snapshot.row_id = artifact.id
      )
  ) then
    return true;
  end if;

  for v_resource in
    select table_name, primary_key_columns[1] as primary_key_column
    from public.classroom_archive_resource_contract
  loop
    execute format(
      'select exists (
         select 1
         from public.%I source
         where public.classroom_purge_jsonb_references_storage_path(
             to_jsonb(source),
             $1
           )
           and not exists (
             select 1
             from public.classroom_purge_resources snapshot
             where snapshot.operation_id = $2
               and snapshot.table_name = $3
               and snapshot.row_id = source.%I
           )
       )',
      v_resource.table_name,
      v_resource.primary_key_column
    )
    into v_shared
    using p_storage_path, p_operation_id, v_resource.table_name;
    if v_shared then return true; end if;
  end loop;

  select exists (
    select 1 from public.course_blueprints row
    where public.classroom_purge_jsonb_references_storage_path(to_jsonb(row), p_storage_path)
  ) or exists (
    select 1 from public.course_blueprint_versions row
    where public.classroom_purge_jsonb_references_storage_path(to_jsonb(row), p_storage_path)
  ) or exists (
    select 1 from public.course_blueprint_assignments row
    where public.classroom_purge_jsonb_references_storage_path(to_jsonb(row), p_storage_path)
  ) or exists (
    select 1 from public.course_blueprint_assessments row
    where public.classroom_purge_jsonb_references_storage_path(to_jsonb(row), p_storage_path)
  ) or exists (
    select 1 from public.course_blueprint_lesson_templates row
    where public.classroom_purge_jsonb_references_storage_path(to_jsonb(row), p_storage_path)
  ) or exists (
    select 1 from public.course_blueprint_materials row
    where public.classroom_purge_jsonb_references_storage_path(to_jsonb(row), p_storage_path)
  ) or exists (
    select 1 from public.course_blueprint_surveys row
    where public.classroom_purge_jsonb_references_storage_path(to_jsonb(row), p_storage_path)
  ) or exists (
    select 1 from public.course_blueprint_change_proposals row
    where public.classroom_purge_jsonb_references_storage_path(to_jsonb(row), p_storage_path)
  ) or exists (
    select 1 from public.course_blueprint_editing_sessions row
    where public.classroom_purge_jsonb_references_storage_path(to_jsonb(row), p_storage_path)
  )
  into v_shared;

  return coalesce(v_shared, false);
end;
$$;

revoke all on function public.classroom_purge_percent_decode(text)
  from public, anon, authenticated;
revoke all on function public.classroom_purge_jsonb_text_values(jsonb)
  from public, anon, authenticated;

comment on function public.classroom_purge_percent_decode(text) is
  'Decodes canonical URL percent escapes for fail-safe managed-path matching.';
comment on function public.classroom_purge_jsonb_text_values(jsonb) is
  'Returns decoded JSON string scalar values without relying on serialized JSON representation.';

-- Consolidated local-only hardening step.

-- Prevent unrelated malformed percent escapes from poisoning managed-path
-- matching. Compare canonical encoded paths without decoding the surrounding
-- field, and decode only individual URL candidates as a compatibility fallback.

create or replace function public.classroom_purge_percent_encode_path(p_value text)
returns text
language plpgsql
immutable
strict
security definer
set search_path = pg_catalog
as $$
declare
  v_byte integer;
  v_bytes bytea := convert_to(p_value, 'UTF8');
  v_index integer;
  v_result text := '';
begin
  if octet_length(v_bytes) = 0 then
    return v_result;
  end if;

  for v_index in 0..octet_length(v_bytes) - 1 loop
    v_byte := get_byte(v_bytes, v_index);
    if
      (v_byte between 48 and 57)
      or (v_byte between 65 and 90)
      or (v_byte between 97 and 122)
      or v_byte in (33, 39, 40, 41, 42, 45, 46, 47, 95, 126)
    then
      v_result := v_result || chr(v_byte);
    else
      v_result := v_result || '%' || upper(lpad(to_hex(v_byte), 2, '0'));
    end if;
  end loop;
  return v_result;
end;
$$;

create or replace function public.classroom_purge_normalize_percent_escapes(p_value text)
returns text
language plpgsql
immutable
strict
security definer
set search_path = pg_catalog
as $$
declare
  v_character text;
  v_hex text;
  v_index integer := 1;
  v_result text := '';
begin
  while v_index <= char_length(p_value) loop
    v_character := substr(p_value, v_index, 1);
    if v_character = '%'
      and v_index + 2 <= char_length(p_value)
      and substr(p_value, v_index + 1, 2) ~ '^[0-9A-Fa-f]{2}$'
    then
      v_hex := substr(p_value, v_index + 1, 2);
      v_result := v_result || '%' || upper(v_hex);
      v_index := v_index + 3;
    else
      v_result := v_result || v_character;
      v_index := v_index + 1;
    end if;
  end loop;
  return v_result;
end;
$$;

revoke all on function public.classroom_purge_percent_encode_path(text)
  from public, anon, authenticated;
revoke all on function public.classroom_purge_normalize_percent_escapes(text)
  from public, anon, authenticated;

comment on function public.classroom_purge_percent_encode_path(text) is
  'Encodes a managed path like segment-wise encodeURIComponent while retaining path separators.';
comment on function public.classroom_purge_normalize_percent_escapes(text) is
  'Normalizes percent-escape hex case without decoding or rejecting unrelated field content.';
-- Align the database matcher with the application inventory's WHATWG special
-- URL behavior: schemes are case-insensitive, backslashes are path separators,
-- and literal or percent-encoded dot segments are resolved before comparison.
-- query or fragment escapes cannot poison managed-path decoding because only
-- the storage-key URL portion reaches the segment decoder.

create or replace function public.classroom_purge_url_candidates(p_value text)
returns setof text
language sql
immutable
strict
security definer
set search_path = pg_catalog
as $$
  select split_part(
    split_part(matched[1], '#', 1),
    '?',
    1
  )
  from regexp_matches(p_value, '(https?://[^[:space:]]+)', 'gi') matched;
$$;

create or replace function public.classroom_purge_normalize_special_url_path(
  p_candidate text
)
returns text
language plpgsql
immutable
strict
security definer
set search_path = public, pg_catalog
as $$
declare
  v_candidate text;
  v_decoded_segment text;
  v_final_segment text;
  v_normalized text;
  v_raw_path text;
  v_raw_segment text;
  v_segments text[] := array[]::text[];
begin
  v_candidate := replace(
    split_part(split_part(p_candidate, '#', 1), '?', 1),
    E'\\',
    '/'
  );
  v_raw_path := regexp_replace(
    v_candidate,
    '^[Hh][Tt][Tt][Pp][Ss]?://[^/]*',
    ''
  );
  if v_raw_path = v_candidate then
    return null;
  end if;

  foreach v_raw_segment in array string_to_array(v_raw_path, '/') loop
    if v_raw_segment = '' then
      if cardinality(v_segments) = 0 then
        continue;
      end if;
      return null;
    end if;

    v_decoded_segment := public.classroom_purge_percent_decode(v_raw_segment);
    if v_decoded_segment is null then
      return null;
    elsif v_decoded_segment = '.' then
      continue;
    elsif v_decoded_segment = '..' then
      if cardinality(v_segments) > 0 then
        v_segments := v_segments[1:cardinality(v_segments) - 1];
        if v_segments is null then
          v_segments := array[]::text[];
        end if;
      end if;
    else
      v_segments := array_append(v_segments, v_decoded_segment);
    end if;
  end loop;

  v_normalized := array_to_string(v_segments, '/');
  foreach v_final_segment in array string_to_array(v_normalized, '/') loop
    if v_final_segment in ('', '.', '..') then
      return null;
    end if;
  end loop;
  return v_normalized;
end;
$$;

create or replace function public.classroom_purge_jsonb_references_storage_path(
  p_payload jsonb,
  p_storage_path text
)
returns boolean
language sql
immutable
strict
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.classroom_purge_jsonb_text_values(p_payload) candidate(value)
    where strpos(candidate.value, p_storage_path) > 0
      or strpos(
        public.classroom_purge_normalize_percent_escapes(candidate.value),
        public.classroom_purge_percent_encode_path(p_storage_path)
      ) > 0
      or exists (
        select 1
        from public.classroom_purge_url_candidates(candidate.value) url(value)
        where strpos(
          coalesce(
            public.classroom_purge_normalize_special_url_path(url.value),
            ''
          ),
          p_storage_path
        ) > 0
      )
  );
$$;

revoke all on function public.classroom_purge_url_candidates(text)
  from public, anon, authenticated;
revoke all on function public.classroom_purge_normalize_special_url_path(text)
  from public, anon, authenticated;
revoke all on function public.classroom_purge_jsonb_references_storage_path(jsonb, text)
  from public, anon, authenticated;

comment on function public.classroom_purge_url_candidates(text) is
  'Extracts case-insensitive special-URL candidates without query or fragment data.';
comment on function public.classroom_purge_normalize_special_url_path(text) is
  'Normalizes special-URL backslashes, percent escapes, and dot segments to the application inventory pathname contract.';
comment on function public.classroom_purge_jsonb_references_storage_path(jsonb, text) is
  'Matches raw, canonical encoded, or WHATWG-normalized managed path references without metadata poisoning.';

create or replace function public.reject_reserved_classroom_purge_storage_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('pika.classroom_purge_finalize', true) = 'on' then
    return new;
  end if;

  perform pg_advisory_xact_lock_shared(
    hashtextextended('pika-classroom-purge-storage-references', 0)
  );

  if exists (
    select 1
    from public.classroom_purge_objects object
    join public.classroom_purge_operations operation
      on operation.id = object.operation_id
    where object.disposition = 'delete'
      and object.status in ('pending', 'processing', 'failed', 'deleted')
      and operation.status <> 'completed'
      and object.storage_path is not null
      and public.classroom_purge_jsonb_references_storage_path(
        to_jsonb(new),
        object.storage_path
      )
  ) then
    raise exception 'A managed file referenced by this content is being permanently deleted'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

do $$
declare
  v_table text;
begin
  for v_table in
    select table_name
    from public.classroom_archive_resource_contract
    union
    select unnest(array[
      'course_blueprints',
      'course_blueprint_assignments',
      'course_blueprint_assessments',
      'course_blueprint_lesson_templates',
      'course_blueprint_materials',
      'course_blueprint_surveys',
      'course_blueprint_versions',
      'course_blueprint_change_proposals',
      'course_blueprint_editing_sessions',
      'course_blueprint_operations',
      'classroom_archives',
      'classroom_gradex_extracts',
      'classroom_archive_operations',
      'classroom_archive_object_upload_cleanup',
      'classroom_gradex_extract_cleanup'
    ])
  loop
    execute format(
      'drop trigger if exists %I on public.%I',
      'classroom_purge_storage_reservation_' || v_table,
      v_table
    );
    execute format(
      'drop trigger if exists %I on public.%I',
      'classroom_purge_00_storage_reservation_' || v_table,
      v_table
    );
    execute format(
      'create trigger %I
       before insert or update on public.%I
       for each row execute function public.reject_reserved_classroom_purge_storage_reference()',
      'classroom_purge_00_storage_reservation_' || v_table,
      v_table
    );
  end loop;
end;
$$;

revoke all on function public.reject_reserved_classroom_purge_storage_reference()
  from public, anon, authenticated;

comment on function public.reject_reserved_classroom_purge_storage_reference() is
  'Serializes classroom, Blueprint, archive, and Gradex path writers and rejects reserved managed paths.';
