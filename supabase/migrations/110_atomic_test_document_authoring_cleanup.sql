-- Serialize test-document authoring with snapshot sync and durably clean up
-- provisional, removed, superseded, and explicitly deleted link snapshots.

create table if not exists public.test_document_snapshot_storage_cleanup (
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

create index if not exists idx_test_document_snapshot_storage_cleanup_due
  on public.test_document_snapshot_storage_cleanup (next_attempt_at, created_at)
  where status = 'pending';

alter table public.test_document_snapshot_storage_cleanup enable row level security;

create or replace function public.enqueue_test_document_snapshot_storage_cleanup_path(
  p_storage_path text,
  p_delay_seconds integer default 0
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_storage_path is null
    or p_storage_path not like 'link-docs/%/snapshots/%'
    or p_delay_seconds is null
    or p_delay_seconds < 0
    or p_delay_seconds > 86400
  then
    raise exception 'Invalid test document snapshot cleanup path' using errcode = '22023';
  end if;

  insert into public.test_document_snapshot_storage_cleanup as existing_cleanup (
    storage_path,
    status,
    attempt_count,
    next_attempt_at,
    lease_token,
    lease_expires_at,
    last_error,
    updated_at
  ) values (
    p_storage_path,
    'pending',
    0,
    clock_timestamp() + make_interval(secs => p_delay_seconds),
    null,
    null,
    null,
    clock_timestamp()
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

create or replace function public.enqueue_obsolete_test_document_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_archived_at timestamptz;
  v_new_documents jsonb;
begin
  if tg_op = 'DELETE' then
    select classroom.archived_at
      into v_archived_at
    from public.classrooms classroom
    where classroom.id = old.classroom_id;

    -- Cold compaction deletes archived test rows after copying their managed
    -- objects into the immutable archive. Archive cleanup owns those objects.
    if not found or v_archived_at is not null then
      return old;
    end if;
    v_new_documents := '[]'::jsonb;
  else
    v_new_documents := coalesce(new.documents, '[]'::jsonb);
  end if;

  insert into public.test_document_snapshot_storage_cleanup as existing_cleanup (
    storage_path,
    status,
    attempt_count,
    next_attempt_at,
    lease_token,
    lease_expires_at,
    last_error,
    updated_at
  )
  select distinct
    old_document.value ->> 'snapshot_path',
    'pending'::text,
    0,
    clock_timestamp(),
    null::uuid,
    null::timestamptz,
    null::text,
    clock_timestamp()
  from jsonb_array_elements(coalesce(old.documents, '[]'::jsonb)) old_document(value)
  where old_document.value ->> 'snapshot_path' like 'link-docs/%/snapshots/%'
    and not exists (
      select 1
      from jsonb_array_elements(v_new_documents) new_document(value)
      where new_document.value ->> 'snapshot_path'
        = old_document.value ->> 'snapshot_path'
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

drop trigger if exists enqueue_obsolete_test_document_snapshots on public.tests;
create trigger enqueue_obsolete_test_document_snapshots
after update of documents or delete on public.tests
for each row execute function public.enqueue_obsolete_test_document_snapshots();

-- Blueprint documents are portable source definitions. Snapshot paths belong
-- to one classroom/test and must be reacquired after instantiation.
update public.course_blueprint_assessments assessment
set documents = coalesce((
  select jsonb_agg(
    document.value - 'snapshot_path' - 'snapshot_content_type' - 'synced_at'
    order by document.ordinality
  )
  from jsonb_array_elements(assessment.documents)
    with ordinality as document(value, ordinality)
), '[]'::jsonb)
where jsonb_typeof(assessment.documents) = 'array'
  and exists (
    select 1
    from jsonb_array_elements(assessment.documents) document(value)
    where document.value ?| array[
      'snapshot_path',
      'snapshot_content_type',
      'synced_at'
    ]
  );

create or replace function public.test_document_snapshot_path_is_referenced(
  p_storage_path text
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    exists (
      select 1
      from public.tests test
      cross join lateral jsonb_array_elements(
        coalesce(test.documents, '[]'::jsonb)
      ) document(value)
      where document.value ->> 'snapshot_path' = p_storage_path
    )
    or exists (
      select 1
      from public.course_blueprint_assessments assessment
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(assessment.documents) = 'array'
            then assessment.documents
          else '[]'::jsonb
        end
      ) document(value)
      where document.value ->> 'snapshot_path' = p_storage_path
    )
    or exists (
      select 1
      from public.classroom_archive_source_object_cleanup cleanup
      where cleanup.storage_bucket = 'test-documents'
        and cleanup.storage_path = p_storage_path
        and cleanup.status <> 'deleted'
    );
$$;

create or replace function public.claim_test_document_snapshot_storage_cleanup(
  p_lease_token uuid,
  p_limit integer,
  p_lease_seconds integer
)
returns setof public.test_document_snapshot_storage_cleanup
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_lease_token is null
    or p_limit is null or p_limit < 1 or p_limit > 100
    or p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 900
  then
    raise exception 'Invalid test document snapshot cleanup claim' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select cleanup.id
    from public.test_document_snapshot_storage_cleanup cleanup
    where (
      (
        cleanup.status = 'pending'
        and cleanup.next_attempt_at <= clock_timestamp()
      )
      or (
        cleanup.status = 'processing'
        and cleanup.lease_expires_at <= clock_timestamp()
      )
    )
      and not public.test_document_snapshot_path_is_referenced(cleanup.storage_path)
    order by cleanup.next_attempt_at, cleanup.created_at, cleanup.id
    limit p_limit
    for update skip locked
  )
  update public.test_document_snapshot_storage_cleanup cleanup
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

create or replace function public.claim_test_document_snapshot_storage_cleanup_path(
  p_storage_path text,
  p_lease_token uuid,
  p_lease_seconds integer
)
returns setof public.test_document_snapshot_storage_cleanup
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_storage_path is null
    or p_storage_path not like 'link-docs/%/snapshots/%'
    or p_lease_token is null
    or p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 900
  then
    raise exception 'Invalid test document snapshot cleanup path claim' using errcode = '22023';
  end if;

  return query
  update public.test_document_snapshot_storage_cleanup cleanup
  set status = 'processing',
      attempt_count = cleanup.attempt_count + 1,
      lease_token = p_lease_token,
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      last_error = null,
      updated_at = clock_timestamp()
  where cleanup.storage_path = p_storage_path
    and not public.test_document_snapshot_path_is_referenced(cleanup.storage_path)
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

create or replace function public.complete_test_document_snapshot_storage_cleanup(
  p_cleanup_id uuid,
  p_lease_token uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  delete from public.test_document_snapshot_storage_cleanup
  where id = p_cleanup_id
    and status = 'processing'
    and lease_token = p_lease_token
    and lease_expires_at > clock_timestamp()
  returning true;
$$;

create or replace function public.fail_test_document_snapshot_storage_cleanup(
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
  update public.test_document_snapshot_storage_cleanup cleanup
  set status = 'pending',
      next_attempt_at = clock_timestamp()
        + make_interval(
          secs => least(
            3600,
            (power(2::numeric, least(cleanup.attempt_count, 6)) * 60)::integer
          )
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

create or replace function public.update_test_documents_atomic(
  p_teacher_id uuid,
  p_test_id uuid,
  p_expected_status text,
  p_expected_documents jsonb,
  p_documents jsonb,
  p_update_title boolean,
  p_title text,
  p_update_status boolean,
  p_status text,
  p_update_show_results boolean,
  p_show_results boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_archived_at timestamptz;
  v_cleanup_paths jsonb;
  v_owner_id uuid;
  v_test public.tests%rowtype;
begin
  if jsonb_typeof(coalesce(p_expected_documents, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_documents, '[]'::jsonb)) <> 'array'
  then
    raise exception using errcode = '22023', message = 'invalid_documents';
  end if;

  select c.teacher_id, c.archived_at
    into v_owner_id, v_archived_at
  from public.tests t
  join public.classrooms c on c.id = t.classroom_id
  where t.id = p_test_id
  for update of t, c;

  if not found then
    raise exception using errcode = 'P0002', message = 'test_not_found';
  end if;
  if v_owner_id is distinct from p_teacher_id then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if v_archived_at is not null then
    raise exception using errcode = '55000', message = 'classroom_archived';
  end if;

  select t.* into strict v_test
  from public.tests t
  where t.id = p_test_id;

  if v_test.status is distinct from p_expected_status
    or coalesce(v_test.documents, '[]'::jsonb)
      is distinct from coalesce(p_expected_documents, '[]'::jsonb)
  then
    raise exception using errcode = '40001', message = 'document_conflict';
  end if;

  select coalesce(jsonb_agg(path order by path), '[]'::jsonb)
    into v_cleanup_paths
  from (
    select distinct old_document.value ->> 'snapshot_path' as path
    from jsonb_array_elements(coalesce(v_test.documents, '[]'::jsonb))
      old_document(value)
    where old_document.value ->> 'snapshot_path' like 'link-docs/%/snapshots/%'
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb))
          new_document(value)
        where new_document.value ->> 'snapshot_path'
          = old_document.value ->> 'snapshot_path'
      )
  ) obsolete;

  update public.tests
  set documents = coalesce(p_documents, '[]'::jsonb),
      title = case when p_update_title then p_title else title end,
      status = case when p_update_status then p_status else status end,
      show_results = case
        when p_update_show_results then p_show_results
        else show_results
      end
  where id = p_test_id
  returning * into strict v_test;

  return jsonb_build_object(
    'cleanup_paths', v_cleanup_paths,
    'test', to_jsonb(v_test)
  );
end;
$$;

-- Migration 109 remains callable during migration-first rollout. This version
-- adopts provisional cleanup evidence and lets the update trigger queue the
-- superseded snapshot in the same transaction.
create or replace function public.sync_test_document_snapshot_atomic(
  p_teacher_id uuid,
  p_test_id uuid,
  p_document_id text,
  p_expected_url text,
  p_snapshot_path text,
  p_snapshot_content_type text,
  p_synced_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_archived_at timestamptz;
  v_documents jsonb;
  v_document jsonb;
  v_document_index integer;
  v_cleanup_status text;
  v_owner_id uuid;
  v_previous_snapshot_path text;
  v_test public.tests%rowtype;
begin
  select c.teacher_id, c.archived_at
    into v_owner_id, v_archived_at
  from public.tests t
  join public.classrooms c on c.id = t.classroom_id
  where t.id = p_test_id
  for update of t, c;

  if not found then
    raise exception using errcode = 'P0002', message = 'test_not_found';
  end if;
  if v_owner_id is distinct from p_teacher_id then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if v_archived_at is not null then
    raise exception using errcode = '55000', message = 'classroom_archived';
  end if;

  select t.* into strict v_test
  from public.tests t
  where t.id = p_test_id;
  v_documents := coalesce(v_test.documents, '[]'::jsonb);

  select document.value, (document.ordinality - 1)::integer
    into v_document, v_document_index
  from jsonb_array_elements(v_documents) with ordinality
    as document(value, ordinality)
  where document.value ->> 'id' = p_document_id
  limit 1;

  if v_document is null
    or v_document ->> 'source' is distinct from 'link'
    or v_document ->> 'url' is distinct from p_expected_url
  then
    raise exception using errcode = '40001', message = 'document_conflict';
  end if;

  select cleanup.status
    into v_cleanup_status
  from public.test_document_snapshot_storage_cleanup cleanup
  where cleanup.storage_path = p_snapshot_path
  for update;

  if not found then
    raise exception using errcode = '55000', message = 'snapshot_cleanup_evidence_missing';
  end if;
  if v_cleanup_status is distinct from 'pending' then
    raise exception using errcode = '40001', message = 'snapshot_cleanup_in_progress';
  end if;

  v_previous_snapshot_path := nullif(v_document ->> 'snapshot_path', '');
  v_document := (v_document - 'snapshot_path' - 'snapshot_content_type' - 'synced_at')
    || jsonb_build_object(
      'snapshot_path', p_snapshot_path,
      'snapshot_content_type', p_snapshot_content_type,
      'synced_at', p_synced_at
    );
  v_documents := jsonb_set(
    v_documents,
    array[v_document_index::text],
    v_document,
    false
  );

  update public.tests
  set documents = v_documents
  where id = p_test_id
  returning * into strict v_test;

  -- If this transaction later fails, the provisional evidence is restored.
  delete from public.test_document_snapshot_storage_cleanup
  where storage_path = p_snapshot_path
    and status = 'pending';
  if not found then
    raise exception using errcode = '40001', message = 'snapshot_cleanup_in_progress';
  end if;

  return jsonb_build_object(
    'previous_snapshot_path', v_previous_snapshot_path,
    'test', to_jsonb(v_test)
  );
end;
$$;

revoke all on table public.test_document_snapshot_storage_cleanup
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.test_document_snapshot_storage_cleanup
  to service_role;

revoke all on function public.enqueue_obsolete_test_document_snapshots()
  from public, anon, authenticated, service_role;
revoke all on function public.enqueue_test_document_snapshot_storage_cleanup_path(text, integer)
  from public, anon, authenticated;
revoke all on function public.test_document_snapshot_path_is_referenced(text)
  from public, anon, authenticated;
revoke all on function public.claim_test_document_snapshot_storage_cleanup(uuid, integer, integer)
  from public, anon, authenticated;
revoke all on function public.claim_test_document_snapshot_storage_cleanup_path(text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.complete_test_document_snapshot_storage_cleanup(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.fail_test_document_snapshot_storage_cleanup(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.update_test_documents_atomic(
  uuid, uuid, text, jsonb, jsonb, boolean, text, boolean, text, boolean, boolean
) from public, anon, authenticated;
revoke all on function public.sync_test_document_snapshot_atomic(
  uuid, uuid, text, text, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.enqueue_test_document_snapshot_storage_cleanup_path(text, integer)
  to service_role;
grant execute on function public.test_document_snapshot_path_is_referenced(text)
  to service_role;
grant execute on function public.claim_test_document_snapshot_storage_cleanup(uuid, integer, integer)
  to service_role;
grant execute on function public.claim_test_document_snapshot_storage_cleanup_path(text, uuid, integer)
  to service_role;
grant execute on function public.complete_test_document_snapshot_storage_cleanup(uuid, uuid)
  to service_role;
grant execute on function public.fail_test_document_snapshot_storage_cleanup(uuid, uuid, text)
  to service_role;
grant execute on function public.update_test_documents_atomic(
  uuid, uuid, text, jsonb, jsonb, boolean, text, boolean, text, boolean, boolean
) to service_role;
grant execute on function public.sync_test_document_snapshot_atomic(
  uuid, uuid, text, text, text, text, timestamptz
) to service_role;

comment on table public.test_document_snapshot_storage_cleanup is
  'Durable cleanup evidence for unreferenced test link snapshot Storage objects.';
comment on function public.update_test_documents_atomic(
  uuid, uuid, text, jsonb, jsonb, boolean, text, boolean, text, boolean, boolean
) is
  'Atomically updates test documents and optional metadata after ownership, archive, status, and document CAS checks.';
