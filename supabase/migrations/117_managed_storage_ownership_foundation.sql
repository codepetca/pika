-- -----------------------------------------------------------------------------
-- Managed-storage ownership stage 1: compatibility schema and producer protocol
-- -----------------------------------------------------------------------------
-- Managed-storage compatibility foundation.
--
-- This migration intentionally does not enable ownership enforcement, cleanup
-- workers, or classroom deletion. It is compatible with the migration-116 app
-- while ownership-aware producers roll out.

-- Migration 115 is deployed production history, but permanent classroom purge
-- is not a capability of this foundation. Keep its audit tables while removing
-- every callable purge entry point.
revoke all on function public.begin_hot_archived_classroom_purge(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.classroom_purge_conflict(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.stage_classroom_purge_objects(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.seal_classroom_purge_inventory(uuid, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_classroom_purge_object(uuid, uuid, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_classroom_purge_object(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.fail_classroom_purge_object(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.finalize_hot_archived_classroom_purge(uuid, uuid)
  from public, anon, authenticated, service_role;

create table public.managed_storage_settings (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'compatibility'
    check (mode in ('compatibility', 'enforced')),
  protocol_version integer not null default 1 check (protocol_version > 0),
  readiness_generation bigint not null default 0 check (readiness_generation >= 0),
  readiness_digest text check (
    readiness_digest is null or readiness_digest ~ '^[a-f0-9]{64}$'
  ),
  readiness_verified_at timestamptz,
  activated_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (mode = 'compatibility' and activated_at is null)
    or (mode = 'enforced' and activated_at is not null
      and readiness_digest is not null and readiness_verified_at is not null)
  )
);

insert into public.managed_storage_settings (singleton) values (true);

alter table public.managed_storage_settings enable row level security;
revoke all on table public.managed_storage_settings
  from public, anon, authenticated, service_role;
grant select on table public.managed_storage_settings to service_role;

comment on table public.managed_storage_settings is
  'Database-serialized managed-file writer protocol. Migration application never enables enforcement.';

create table public.managed_storage_provisional_owners (
  id uuid primary key default gen_random_uuid(),
  owner_kind text not null check (owner_kind in (
    'classroom_copy', 'course_blueprint_copy', 'restore_copy'
  )),
  target_classroom_id uuid,
  target_course_blueprint_id uuid references public.course_blueprints (id) on delete restrict,
  operation_id uuid,
  created_by_user_id uuid not null references public.users (id) on delete restrict,
  expires_at timestamptz not null,
  adopted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check (num_nonnulls(target_classroom_id, target_course_blueprint_id) <= 1),
  check (operation_id is not null),
  check (
    (owner_kind in ('classroom_copy', 'restore_copy') and target_course_blueprint_id is null)
    or (owner_kind = 'course_blueprint_copy' and target_classroom_id is null)
  )
);

alter table public.managed_storage_provisional_owners enable row level security;
revoke all on table public.managed_storage_provisional_owners
  from public, anon, authenticated;
grant select on table public.managed_storage_provisional_owners to service_role;

create table public.managed_storage_objects (
  id uuid primary key default gen_random_uuid(),
  storage_bucket text not null check (storage_bucket in (
    'assignment-artifacts',
    'submission-images',
    'test-documents',
    'classroom-archives',
    'gradex-analytics-extracts'
  )),
  storage_path text not null check (
    storage_path <> ''
    and storage_path not like '/%'
    and strpos(storage_path, E'\\') = 0
    and not ('.' = any(string_to_array(storage_path, '/')))
    and not ('..' = any(string_to_array(storage_path, '/')))
  ),
  classroom_id uuid,
  course_blueprint_id uuid references public.course_blueprints (id) on delete restrict,
  provisional_owner_id uuid references public.managed_storage_provisional_owners (id) on delete restrict,
  purpose text not null check (purpose in (
    'student_assignment_artifact',
    'student_inline_image',
    'teacher_test_material',
    'test_execution_snapshot',
    'legacy_classroom_file',
    'classroom_archive',
    'gradex_extract'
  )),
  status text not null default 'reserved' check (status in (
    'reserved', 'verified', 'ready', 'cleanup_pending', 'cleanup_processing', 'deleted'
  )),
  created_by_user_id uuid references public.users (id) on delete set null,
  data_subject_user_id uuid references public.users (id) on delete set null,
  resource_type text,
  resource_id uuid,
  content_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  content_sha256 text check (
    content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  reservation_expires_at timestamptz,
  verified_at timestamptz,
  ready_at timestamptz,
  cleanup_reason_code text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  deleted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (storage_bucket, storage_path),
  unique (id, storage_bucket, storage_path),
  check (num_nonnulls(classroom_id, course_blueprint_id, provisional_owner_id) = 1),
  check (
    (status = 'reserved' and verified_at is null and ready_at is null)
    or (status = 'verified' and verified_at is not null and ready_at is null)
    or (status = 'ready' and verified_at is not null and ready_at is not null)
    or status in ('cleanup_pending', 'cleanup_processing', 'deleted')
  ),
  check (
    (status = 'cleanup_processing' and lease_token is not null and lease_expires_at is not null)
    or (status <> 'cleanup_processing' and lease_token is null and lease_expires_at is null)
  ),
  check ((status = 'deleted') = (deleted_at is not null)),
  check (
    (storage_bucket = 'classroom-archives' and purpose = 'classroom_archive')
    or (storage_bucket = 'gradex-analytics-extracts' and purpose = 'gradex_extract')
    or (storage_bucket in ('assignment-artifacts', 'submission-images', 'test-documents')
      and purpose not in ('classroom_archive', 'gradex_extract'))
  ),
  check (
    course_blueprint_id is null
    or (storage_bucket = 'test-documents' and purpose = 'teacher_test_material')
  )
);

create index managed_storage_objects_classroom
  on public.managed_storage_objects (classroom_id, status, created_at)
  where classroom_id is not null;
create index managed_storage_objects_blueprint
  on public.managed_storage_objects (course_blueprint_id, status, created_at)
  where course_blueprint_id is not null;
create index managed_storage_objects_provisional
  on public.managed_storage_objects (provisional_owner_id, status, created_at)
  where provisional_owner_id is not null;
create index managed_storage_objects_cleanup_due
  on public.managed_storage_objects (next_attempt_at, created_at)
  where status in ('cleanup_pending', 'cleanup_processing')
    or status in ('reserved', 'verified');

alter table public.managed_storage_objects enable row level security;
revoke all on table public.managed_storage_objects from public, anon, authenticated;
grant select on table public.managed_storage_objects to service_role;

comment on table public.managed_storage_objects is
  'Sole lifecycle authority for persistent Pika-managed Storage objects. Raw paths are compatibility evidence only.';

create or replace function public.managed_storage_exact_lock(
  p_storage_bucket text,
  p_storage_path text
)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended(
    jsonb_build_array(p_storage_bucket, p_storage_path)::text,
    0
  ))
$$;

create or replace function public.lock_managed_storage_protocol()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enforced boolean;
begin
  select mode = 'enforced' into strict v_enforced
  from public.managed_storage_settings
  where singleton
  for share;
  return v_enforced;
end;
$$;

create or replace function public.guard_managed_storage_owner()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_scope_count integer;
  v_provisional public.managed_storage_provisional_owners;
begin
  if new.classroom_id is not null then
    select
      (exists (select 1 from public.classrooms where id = new.classroom_id))::integer
      + (exists (select 1 from public.classroom_cold_tombstones
          where classroom_id = new.classroom_id))::integer
    into v_scope_count;
    if v_scope_count <> 1 then
      raise exception using errcode = '23503', message = 'managed_storage_classroom_owner_invalid';
    end if;
  elsif new.provisional_owner_id is not null then
    select * into v_provisional
    from public.managed_storage_provisional_owners
    where id = new.provisional_owner_id
    for key share;
    if not found or v_provisional.adopted_at is not null
      or v_provisional.expires_at <= clock_timestamp()
    then
      raise exception using errcode = '23503', message = 'managed_storage_provisional_owner_invalid';
    end if;
  end if;
  return new;
end;
$$;

create trigger managed_storage_owner_guard
before insert or update of classroom_id, course_blueprint_id, provisional_owner_id
on public.managed_storage_objects
for each row execute function public.guard_managed_storage_owner();

create or replace function public.guard_managed_storage_identity_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.storage_bucket is distinct from old.storage_bucket
    or new.storage_path is distinct from old.storage_path
    or new.purpose is distinct from old.purpose
  then
    raise exception using errcode = '55000', message = 'managed_storage_identity_immutable';
  end if;
  if (new.classroom_id is distinct from old.classroom_id
      or new.course_blueprint_id is distinct from old.course_blueprint_id
      or new.provisional_owner_id is distinct from old.provisional_owner_id)
    and current_setting('pika.managed_storage_owner_adoption', true) is distinct from 'on'
  then
    raise exception using errcode = '55000', message = 'managed_storage_owner_immutable';
  end if;
  return new;
end;
$$;

create trigger managed_storage_identity_immutable_guard
before update of storage_bucket, storage_path, classroom_id,
  course_blueprint_id, provisional_owner_id, purpose
on public.managed_storage_objects
for each row execute function public.guard_managed_storage_identity_immutable();

-- Relational and operational references carry the lifecycle identity. Existing
-- raw bucket/path columns remain as rollout and integrity evidence.
alter table public.assignment_submission_artifacts
  add column managed_object_id uuid
    references public.managed_storage_objects (id) on delete restrict;
alter table public.assignment_artifact_storage_cleanup
  add column managed_object_id uuid
    references public.managed_storage_objects (id) on delete restrict;
alter table public.test_document_snapshot_storage_cleanup
  add column managed_object_id uuid
    references public.managed_storage_objects (id) on delete restrict;
alter table public.classroom_archive_operations
  add column managed_object_id uuid
    references public.managed_storage_objects (id) on delete restrict;
alter table public.classroom_archives
  add column managed_object_id uuid
    references public.managed_storage_objects (id) on delete restrict;
alter table public.classroom_archive_object_upload_cleanup
  add column managed_object_id uuid
    references public.managed_storage_objects (id) on delete restrict;
alter table public.classroom_archive_restore_expected_objects
  add column managed_object_id uuid
    references public.managed_storage_objects (id) on delete restrict;
alter table public.classroom_archive_source_object_cleanup
  add column managed_object_id uuid
    references public.managed_storage_objects (id) on delete restrict;
alter table public.classroom_gradex_extracts
  add column managed_object_id uuid
    references public.managed_storage_objects (id) on delete restrict;
alter table public.classroom_gradex_extract_cleanup
  add column managed_object_id uuid
    references public.managed_storage_objects (id) on delete restrict;

create or replace function public.bind_compatible_managed_storage_ledger_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_object public.managed_storage_objects;
  v_bucket text;
  v_path text;
  v_classroom_id uuid;
begin
  perform public.lock_managed_storage_protocol();
  v_bucket := case
    when tg_table_name = 'assignment_artifact_storage_cleanup' then 'assignment-artifacts'
    when tg_table_name = 'test_document_snapshot_storage_cleanup' then 'test-documents'
    else nullif(v_new->>'storage_bucket', '')
  end;
  v_path := nullif(v_new->>'storage_path', '');
  if new.managed_object_id is null then
    select * into v_object from public.managed_storage_objects object
    where object.storage_bucket = v_bucket and object.storage_path = v_path
    for key share;
    if not found then return new; end if;
    new.managed_object_id := v_object.id;
  else
    select * into v_object from public.managed_storage_objects
    where id = new.managed_object_id for key share;
  end if;
  if not found or v_object.storage_bucket is distinct from v_bucket
    or v_object.storage_path is distinct from v_path
  then
    raise exception using errcode = '55000', message = 'managed_storage_ledger_identity_mismatch';
  end if;
  if tg_table_name in (
    'classroom_archive_object_upload_cleanup',
    'classroom_archive_restore_expected_objects',
    'classroom_archive_source_object_cleanup',
    'classroom_gradex_extract_cleanup'
  ) then
    if tg_table_name = 'classroom_archive_source_object_cleanup' then
      v_classroom_id := nullif(v_new->>'classroom_id', '')::uuid;
    else
      select operation.classroom_id into v_classroom_id
      from public.classroom_archive_operations operation
      where operation.id = nullif(v_new->>'operation_id', '')::uuid;
    end if;
    if v_classroom_id is null
      or v_object.classroom_id is distinct from v_classroom_id
    then
      raise exception using errcode = '55000', message = 'managed_storage_ledger_owner_mismatch';
    end if;
  end if;
  return new;
end;
$$;

create trigger assignment_artifact_cleanup_managed_guard
before insert or update of storage_path, managed_object_id
on public.assignment_artifact_storage_cleanup
for each row execute function public.bind_compatible_managed_storage_ledger_reference();
create trigger test_document_cleanup_managed_guard
before insert or update of storage_path, managed_object_id
on public.test_document_snapshot_storage_cleanup
for each row execute function public.bind_compatible_managed_storage_ledger_reference();
create trigger archive_upload_cleanup_managed_guard
before insert or update of storage_bucket, storage_path, managed_object_id
on public.classroom_archive_object_upload_cleanup
for each row execute function public.bind_compatible_managed_storage_ledger_reference();
create trigger archive_restore_expected_managed_guard
before insert or update of storage_bucket, storage_path, managed_object_id
on public.classroom_archive_restore_expected_objects
for each row execute function public.bind_compatible_managed_storage_ledger_reference();
create trigger archive_source_cleanup_managed_guard
before insert or update of storage_bucket, storage_path, managed_object_id
on public.classroom_archive_source_object_cleanup
for each row execute function public.bind_compatible_managed_storage_ledger_reference();
create trigger gradex_cleanup_managed_guard
before insert or update of storage_bucket, storage_path, managed_object_id
on public.classroom_gradex_extract_cleanup
for each row execute function public.bind_compatible_managed_storage_ledger_reference();

create or replace function public.bind_compatible_archive_operation_managed_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_object public.managed_storage_objects;
begin
  perform public.lock_managed_storage_protocol();
  if new.storage_path is null then return new; end if;
  if new.managed_object_id is null then
    select * into v_object from public.managed_storage_objects object
    where object.storage_bucket = new.storage_bucket
      and object.storage_path = new.storage_path
    for key share;
    if not found then return new; end if;
    new.managed_object_id := v_object.id;
  else
    select * into v_object from public.managed_storage_objects
    where id = new.managed_object_id for key share;
  end if;
  if not found or v_object.classroom_id is distinct from new.classroom_id
    or v_object.storage_bucket is distinct from new.storage_bucket
    or v_object.storage_path is distinct from new.storage_path
  then
    raise exception using errcode = '55000', message = 'archive_operation_managed_owner_mismatch';
  end if;
  return new;
end;
$$;

create trigger archive_operation_managed_owner_guard
before insert or update of storage_bucket, storage_path, managed_object_id
on public.classroom_archive_operations
for each row execute function public.bind_compatible_archive_operation_managed_owner();

create index assignment_submission_artifacts_managed_object
  on public.assignment_submission_artifacts (managed_object_id)
  where managed_object_id is not null;
create index classroom_archive_operations_managed_object
  on public.classroom_archive_operations (managed_object_id)
  where managed_object_id is not null;
create index classroom_archive_source_cleanup_managed_object
  on public.classroom_archive_source_object_cleanup (managed_object_id)
  where managed_object_id is not null;

-- Embedded JSON references are mirrored in a relational registry with real
-- host FKs. The JSON keeps the managed UUID beside the raw URL/path.
create table public.managed_storage_json_references (
  id uuid primary key default gen_random_uuid(),
  managed_object_id uuid not null
    references public.managed_storage_objects (id) on delete restrict,
  storage_bucket text not null,
  storage_path text not null,
  assignment_doc_id uuid references public.assignment_docs (id) on delete cascade,
  assignment_doc_history_id uuid references public.assignment_doc_history (id) on delete cascade,
  test_id uuid references public.tests (id) on delete cascade,
  course_blueprint_assessment_id uuid
    references public.course_blueprint_assessments (id) on delete cascade,
  course_blueprint_version_id uuid
    references public.course_blueprint_versions (id) on delete cascade,
  course_blueprint_change_proposal_id uuid
    references public.course_blueprint_change_proposals (id) on delete cascade,
  reference_role text not null check (reference_role in (
    'content', 'history_snapshot', 'history_patch', 'teacher_document',
    'execution_snapshot', 'blueprint_document', 'immutable_version', 'proposal'
  )),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  check (num_nonnulls(
    assignment_doc_id,
    assignment_doc_history_id,
    test_id,
    course_blueprint_assessment_id,
    course_blueprint_version_id,
    course_blueprint_change_proposal_id
  ) = 1),
  constraint managed_storage_json_reference_identity_fkey
    foreign key (managed_object_id, storage_bucket, storage_path)
    references public.managed_storage_objects (id, storage_bucket, storage_path)
    on delete restrict
);

create unique index managed_storage_json_reference_host_object
  on public.managed_storage_json_references (
    coalesce(assignment_doc_id, assignment_doc_history_id, test_id,
      course_blueprint_assessment_id, course_blueprint_version_id,
      course_blueprint_change_proposal_id),
    reference_role,
    managed_object_id
  );
create index managed_storage_json_reference_object
  on public.managed_storage_json_references (managed_object_id);

alter table public.managed_storage_json_references enable row level security;
revoke all on table public.managed_storage_json_references
  from public, anon, authenticated;
grant select on table public.managed_storage_json_references to service_role;

create or replace function public.begin_managed_storage_upload(
  p_object_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_classroom_id uuid,
  p_course_blueprint_id uuid,
  p_provisional_owner_id uuid,
  p_purpose text,
  p_created_by_user_id uuid,
  p_data_subject_user_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_content_type text,
  p_byte_size bigint
)
returns public.managed_storage_objects
language plpgsql
security definer
set search_path = public
as $$
declare
  v_object public.managed_storage_objects;
begin
  perform public.lock_managed_storage_protocol();
  if p_object_id is null or p_created_by_user_id is null
    or num_nonnulls(p_classroom_id, p_course_blueprint_id, p_provisional_owner_id) <> 1
  then
    raise exception using errcode = '22023', message = 'managed_storage_owner_required';
  end if;
  select * into v_object from public.managed_storage_objects
  where id = p_object_id for update;
  if found and (
    v_object.storage_bucket is distinct from p_storage_bucket
    or v_object.storage_path is distinct from p_storage_path
  ) then
    raise exception using errcode = '23505', message = 'managed_storage_reservation_conflict';
  elsif not found then
    select * into v_object from public.managed_storage_objects
    where storage_bucket = p_storage_bucket and storage_path = p_storage_path
    for update;
    if found and v_object.id is distinct from p_object_id then
      raise exception using errcode = '23505', message = 'managed_storage_reservation_conflict';
    end if;
  end if;
  perform public.managed_storage_exact_lock(p_storage_bucket, p_storage_path);

  insert into public.managed_storage_objects (
    id, storage_bucket, storage_path, classroom_id, course_blueprint_id,
    provisional_owner_id, purpose, created_by_user_id, data_subject_user_id,
    resource_type, resource_id, content_type, byte_size, reservation_expires_at
  ) values (
    p_object_id, p_storage_bucket, p_storage_path, p_classroom_id,
    p_course_blueprint_id, p_provisional_owner_id, p_purpose,
    p_created_by_user_id, p_data_subject_user_id, nullif(btrim(p_resource_type), ''),
    p_resource_id, nullif(btrim(p_content_type), ''), p_byte_size,
    clock_timestamp() + interval '1 hour'
  )
  on conflict (id) do update set updated_at = clock_timestamp()
  where managed_storage_objects.storage_bucket = excluded.storage_bucket
    and managed_storage_objects.storage_path = excluded.storage_path
    and managed_storage_objects.classroom_id is not distinct from excluded.classroom_id
    and managed_storage_objects.course_blueprint_id is not distinct from excluded.course_blueprint_id
    and managed_storage_objects.provisional_owner_id is not distinct from excluded.provisional_owner_id
    and managed_storage_objects.purpose = excluded.purpose
    and managed_storage_objects.status in ('reserved', 'verified', 'ready')
  returning * into v_object;

  if v_object.id is null then
    raise exception using errcode = '23505', message = 'managed_storage_reservation_conflict';
  end if;

  return v_object;
end;
$$;

create or replace function public.begin_managed_storage_provisional_owner(
  p_owner_id uuid,
  p_owner_kind text,
  p_operation_id uuid,
  p_created_by_user_id uuid,
  p_target_classroom_id uuid default null,
  p_target_course_blueprint_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.lock_managed_storage_protocol();
  if p_owner_id is null or p_operation_id is null or p_created_by_user_id is null then
    raise exception using errcode = '22023', message = 'managed_storage_provisional_owner_required';
  end if;
  insert into public.managed_storage_provisional_owners (
    id, owner_kind, target_classroom_id, target_course_blueprint_id,
    operation_id, created_by_user_id, expires_at
  ) values (
    p_owner_id, p_owner_kind, p_target_classroom_id,
    p_target_course_blueprint_id, p_operation_id, p_created_by_user_id,
    clock_timestamp() + interval '1 hour'
  ) on conflict (id) do nothing;
  return exists (
    select 1 from public.managed_storage_provisional_owners owner
    where owner.id = p_owner_id and owner.owner_kind = p_owner_kind
      and owner.operation_id = p_operation_id
      and owner.created_by_user_id = p_created_by_user_id
      and owner.adopted_at is null and owner.expires_at > clock_timestamp()
  );
end;
$$;

create or replace function public.verify_managed_storage_upload(
  p_object_id uuid,
  p_content_sha256 text default null
)
returns public.managed_storage_objects
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_object public.managed_storage_objects;
begin
  perform public.lock_managed_storage_protocol();
  select * into v_object from public.managed_storage_objects
  where id = p_object_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'managed_storage_object_not_found';
  end if;
  perform public.managed_storage_exact_lock(v_object.storage_bucket, v_object.storage_path);
  if v_object.status in ('verified', 'ready') then return v_object; end if;
  if v_object.status <> 'reserved' then
    raise exception using errcode = '55000', message = 'managed_storage_object_not_verifiable';
  end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = v_object.storage_bucket
      and object.name = v_object.storage_path
  ) then
    raise exception using errcode = '55000', message = 'managed_storage_upload_missing';
  end if;
  update public.managed_storage_objects
  set status = 'verified', verified_at = clock_timestamp(),
      content_sha256 = coalesce(p_content_sha256, content_sha256),
      updated_at = clock_timestamp()
  where id = p_object_id returning * into v_object;
  return v_object;
end;
$$;

create or replace function public.managed_storage_mark_ready(p_object_id uuid)
returns public.managed_storage_objects
language plpgsql
security definer
set search_path = public
as $$
declare
  v_object public.managed_storage_objects;
begin
  select * into v_object from public.managed_storage_objects
  where id = p_object_id for update;
  if not found or v_object.status not in ('verified', 'ready') then
    raise exception using errcode = '55000', message = 'managed_storage_object_not_attachable';
  end if;
  if v_object.status = 'verified' then
    update public.managed_storage_objects
    set status = 'ready', ready_at = clock_timestamp(),
        reservation_expires_at = null, updated_at = clock_timestamp()
    where id = p_object_id returning * into v_object;
  end if;
  return v_object;
end;
$$;

revoke all on function public.begin_managed_storage_upload(
  uuid, text, text, uuid, uuid, uuid, text, uuid, uuid, text, uuid, text, bigint
) from public, anon, authenticated;
revoke all on function public.verify_managed_storage_upload(uuid, text)
  from public, anon, authenticated;
revoke all on function public.managed_storage_mark_ready(uuid)
  from public, anon, authenticated;
grant execute on function public.begin_managed_storage_upload(
  uuid, text, text, uuid, uuid, uuid, text, uuid, uuid, text, uuid, text, bigint
) to service_role;
grant execute on function public.verify_managed_storage_upload(uuid, text)
  to service_role;

create or replace function public.bind_classroom_archive_restore_managed_object(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_managed_object_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.classroom_archive_operations;
  v_object public.managed_storage_objects;
begin
  perform public.lock_managed_storage_protocol();
  select * into v_operation from public.classroom_archive_operations
  where id = p_operation_id and teacher_id = p_teacher_id
    and operation_type = 'restore'
  for update;
  if not found then return false; end if;
  select * into v_object from public.managed_storage_objects
  where id = p_managed_object_id for key share;
  if not found or v_object.classroom_id is distinct from v_operation.classroom_id
    or v_object.storage_bucket not in (
      'assignment-artifacts', 'submission-images', 'test-documents'
    )
  then return false; end if;
  if not exists (
    select 1 from public.classroom_archive_restore_expected_objects expected
    where expected.operation_id = p_operation_id
      and expected.storage_bucket = v_object.storage_bucket
      and expected.storage_path = v_object.storage_path
  ) then return false; end if;
  update public.classroom_archive_restore_expected_objects
  set managed_object_id = v_object.id
  where operation_id = p_operation_id
    and storage_bucket = v_object.storage_bucket
    and storage_path = v_object.storage_path;
  update public.classroom_archive_object_upload_cleanup
  set managed_object_id = v_object.id
  where operation_id = p_operation_id
    and storage_bucket = v_object.storage_bucket
    and storage_path = v_object.storage_path;
  return true;
end;
$$;

revoke all on function public.bind_classroom_archive_restore_managed_object(
  uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.bind_classroom_archive_restore_managed_object(
  uuid, uuid, uuid
) to service_role;

create or replace function public.bind_managed_storage_operation_ledgers(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_managed_object_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.classroom_archive_operations;
  v_object public.managed_storage_objects;
begin
  perform public.lock_managed_storage_protocol();
  select * into v_operation from public.classroom_archive_operations
  where id = p_operation_id and teacher_id = p_teacher_id
    and operation_type in ('export', 'gradex_extract')
  for update;
  if not found then return false; end if;
  select * into v_object from public.managed_storage_objects
  where id = p_managed_object_id for key share;
  if not found or v_object.classroom_id is distinct from v_operation.classroom_id
    or v_object.resource_type is distinct from 'classroom_archive_operation'
    or v_object.resource_id is distinct from p_operation_id
    or (v_operation.operation_type = 'export' and (
      v_object.storage_bucket <> 'classroom-archives'
      or v_object.purpose <> 'classroom_archive'
    ))
    or (v_operation.operation_type = 'gradex_extract' and (
      v_object.storage_bucket <> 'gradex-analytics-extracts'
      or v_object.purpose <> 'gradex_extract'
    ))
  then return false; end if;
  update public.classroom_archive_operations
  set managed_object_id = v_object.id,
      storage_bucket = v_object.storage_bucket,
      storage_path = v_object.storage_path,
      updated_at = clock_timestamp()
  where id = p_operation_id;
  update public.classroom_archive_object_upload_cleanup
  set managed_object_id = v_object.id
  where operation_id = p_operation_id
    and storage_bucket = v_object.storage_bucket
    and storage_path = v_object.storage_path;
  update public.classroom_gradex_extract_cleanup
  set managed_object_id = v_object.id
  where operation_id = p_operation_id
    and storage_bucket = v_object.storage_bucket
    and storage_path = v_object.storage_path;
  return true;
end;
$$;

revoke all on function public.bind_managed_storage_operation_ledgers(
  uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.bind_managed_storage_operation_ledgers(
  uuid, uuid, uuid
) to service_role;
revoke all on function public.begin_managed_storage_provisional_owner(
  uuid, text, uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.begin_managed_storage_provisional_owner(
  uuid, text, uuid, uuid, uuid, uuid
) to service_role;

comment on function public.managed_storage_mark_ready(uuid) is
  'Internal-only transition. It must be called inside the transaction that persists and validates a live reference.';

-- No enforcement is enabled by this migration.

-- -----------------------------------------------------------------------------
-- Managed-storage ownership stage 2: deterministic backfill and readiness
-- -----------------------------------------------------------------------------
-- Deterministic managed-storage backfill and fail-closed readiness evidence.
-- This migration records only stable codes and hashes; raw Storage paths and
-- URLs are deliberately excluded from operational findings.

create table public.managed_storage_readiness_runs (
  id uuid primary key default gen_random_uuid(),
  generation bigint not null unique check (generation > 0),
  protocol_version integer not null check (protocol_version > 0),
  status text not null check (status in ('running', 'blocked', 'ready')),
  finding_count integer not null default 0 check (finding_count >= 0),
  object_count integer not null default 0 check (object_count >= 0),
  reference_count integer not null default 0 check (reference_count >= 0),
  inventory_digest text check (
    inventory_digest is null or inventory_digest ~ '^[a-f0-9]{64}$'
  ),
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  check ((status = 'running') = (completed_at is null))
);

create table public.managed_storage_readiness_findings (
  id bigint generated always as identity primary key,
  run_id uuid not null
    references public.managed_storage_readiness_runs (id) on delete cascade,
  finding_code text not null check (finding_code in (
    'raw_reference_missing_identity',
    'reference_identity_mismatch',
    'embedded_reference_missing_registry',
    'embedded_reference_owner_mismatch',
    'embedded_reference_resource_mismatch',
    'operational_cleanup_inflight',
    'storage_object_ownerless',
    'managed_object_missing_storage',
    'managed_object_ownerless',
    'managed_object_unsettled',
    'provisional_owner_expired'
  )),
  bucket text,
  identity_sha256 text not null check (identity_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_count integer not null default 1 check (evidence_count > 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (run_id, finding_code, identity_sha256)
);

alter table public.managed_storage_readiness_runs enable row level security;
alter table public.managed_storage_readiness_findings enable row level security;
revoke all on table public.managed_storage_readiness_runs,
  public.managed_storage_readiness_findings
  from public, anon, authenticated;
grant select on table public.managed_storage_readiness_runs,
  public.managed_storage_readiness_findings to service_role;

create or replace function public.managed_storage_identity_sha256(
  p_storage_bucket text,
  p_storage_path text
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(extensions.digest(
    convert_to(jsonb_build_array(p_storage_bucket, p_storage_path)::text, 'UTF8'),
    'sha256'
  ), 'hex')
$$;

create or replace function public.managed_storage_entity_sha256(
  p_entity_type text,
  p_entity_id uuid
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(extensions.digest(
    convert_to(jsonb_build_array(p_entity_type, p_entity_id)::text, 'UTF8'),
    'sha256'
  ), 'hex')
$$;

create or replace function public.managed_storage_payload_path_occurrences(
  p_payload jsonb,
  p_storage_path text
)
returns integer
language sql
immutable
strict
set search_path = ''
as $$
  select case when length(p_storage_path) = 0 then 0 else
    (length(p_payload::text) - length(replace(p_payload::text, p_storage_path, '')))
      / length(p_storage_path)
  end
$$;

create or replace function public.managed_storage_public_url_identity(p_value text)
returns table (storage_bucket text, storage_path text)
language sql
immutable
strict
set search_path = ''
as $$
  select match[1], match[2]
  from regexp_match(
    p_value,
    '/storage/v1/object/public/(assignment-artifacts|submission-images|test-documents)/([^?#]+)'
  ) match
  where match[2] <> ''
$$;

create or replace function public.managed_storage_payload_raw_references(p_payload jsonb)
returns table (
  managed_object_id uuid,
  storage_bucket text,
  storage_path text
)
language plpgsql
immutable
set search_path = public
as $$
declare
  v_node jsonb;
  v_pair record;
  v_id uuid;
  v_id_value jsonb;
  v_ids uuid[];
  v_text text;
begin
  if p_payload is null then return; end if;
  for v_node in
    with recursive walk(value) as (
      select p_payload
      union all
      select child.value
      from walk
      cross join lateral (
        select element.value
        from jsonb_array_elements(
          case when jsonb_typeof(walk.value) = 'array' then walk.value else '[]'::jsonb end
        ) element
        union all
        select member.value
        from jsonb_each(
          case when jsonb_typeof(walk.value) = 'object' then walk.value else '{}'::jsonb end
        ) member
      ) child
    )
    select value from walk where jsonb_typeof(value) = 'object'
  loop
    v_ids := array[]::uuid[];
    for v_id_value in
      select value from jsonb_array_elements(
        case when jsonb_typeof(v_node->'managed_object_ids') = 'array'
          then v_node->'managed_object_ids' else '[]'::jsonb end
      )
    loop
      begin
        v_ids := array_append(v_ids, (v_id_value #>> '{}')::uuid);
      exception when invalid_text_representation then
        raise exception using errcode = '22023', message = 'managed_storage_embedded_identity_invalid';
      end;
    end loop;
    begin
      v_id := nullif(v_node->>'managed_object_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'managed_storage_embedded_identity_invalid';
    end;
    if v_id is not null then v_ids := array_append(v_ids, v_id); end if;

    for v_text in
      select value from jsonb_each_text(v_node)
      where key in ('url', 'src', 'public_url')
    loop
      for v_pair in select * from public.managed_storage_public_url_identity(v_text)
      loop
        if coalesce(array_length(v_ids, 1), 0) = 0 then
          managed_object_id := null;
          storage_bucket := v_pair.storage_bucket;
          storage_path := v_pair.storage_path;
          return next;
        else
          foreach managed_object_id in array v_ids loop
            storage_bucket := v_pair.storage_bucket;
            storage_path := v_pair.storage_path;
            return next;
          end loop;
        end if;
      end loop;
    end loop;

    if v_node->>'storage_bucket' in (
      'assignment-artifacts', 'submission-images', 'test-documents'
    ) and nullif(v_node->>'storage_path', '') is not null then
      if coalesce(array_length(v_ids, 1), 0) = 0 then
        managed_object_id := null;
        storage_bucket := v_node->>'storage_bucket';
        storage_path := v_node->>'storage_path';
        return next;
      else
        foreach managed_object_id in array v_ids loop
          storage_bucket := v_node->>'storage_bucket';
          storage_path := v_node->>'storage_path';
          return next;
        end loop;
      end if;
    end if;

    if nullif(v_node->>'snapshot_path', '') is not null then
      begin
        v_id := nullif(v_node->>'snapshot_managed_object_id', '')::uuid;
      exception when invalid_text_representation then
        raise exception using errcode = '22023', message = 'managed_storage_embedded_identity_invalid';
      end;
      managed_object_id := v_id;
      storage_bucket := 'test-documents';
      storage_path := v_node->>'snapshot_path';
      return next;
    end if;
  end loop;
end;
$$;

create or replace function public.managed_storage_payload_has_exact_reference(
  p_payload jsonb,
  p_object_id uuid,
  p_storage_bucket text,
  p_storage_path text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select exists (
    select 1
    from public.managed_storage_payload_raw_references(p_payload) reference
    where reference.managed_object_id = p_object_id
      and reference.storage_bucket = p_storage_bucket
      and reference.storage_path = p_storage_path
  )
$$;

create or replace function public.managed_storage_legacy_object_id(
  p_storage_bucket text,
  p_storage_path text
)
returns uuid
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_hex text;
begin
  v_hex := encode(extensions.digest(convert_to(
    concat('pika.managed-storage-legacy:v1:',
      jsonb_build_array(p_storage_bucket, p_storage_path)::text),
    'UTF8'
  ), 'sha256'), 'hex');
  return (
    substr(v_hex, 1, 8) || '-' || substr(v_hex, 9, 4) || '-' ||
    '5' || substr(v_hex, 14, 3) || '-' ||
    '8' || substr(v_hex, 18, 3) || '-' || substr(v_hex, 21, 12)
  )::uuid;
end;
$$;

create or replace function public.register_legacy_managed_storage_object(
  p_object_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_classroom_id uuid,
  p_course_blueprint_id uuid,
  p_purpose text,
  p_created_by_user_id uuid,
  p_data_subject_user_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_content_type text,
  p_byte_size bigint,
  p_content_sha256 text default null
)
returns public.managed_storage_objects
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_object public.managed_storage_objects;
begin
  perform public.lock_managed_storage_protocol();
  if p_object_id is null
    or p_object_id is distinct from public.managed_storage_legacy_object_id(
      p_storage_bucket, p_storage_path
    )
    or num_nonnulls(p_classroom_id, p_course_blueprint_id) <> 1
  then
    raise exception using errcode = '22023', message = 'legacy_managed_owner_required';
  end if;
  select * into v_object from public.managed_storage_objects
  where id = p_object_id for update;
  if found and (
    v_object.storage_bucket is distinct from p_storage_bucket
    or v_object.storage_path is distinct from p_storage_path
  ) then
    raise exception using errcode = '23505', message = 'legacy_managed_storage_ambiguous';
  elsif not found then
    select * into v_object from public.managed_storage_objects
    where storage_bucket = p_storage_bucket and storage_path = p_storage_path
    for update;
    if found and v_object.id is distinct from p_object_id then
      raise exception using errcode = '23505', message = 'legacy_managed_storage_ambiguous';
    end if;
  end if;
  perform public.managed_storage_exact_lock(p_storage_bucket, p_storage_path);
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = p_storage_bucket and object.name = p_storage_path
  ) then
    raise exception using errcode = '55000', message = 'legacy_managed_storage_object_missing';
  end if;

  insert into public.managed_storage_objects (
    id, storage_bucket, storage_path, classroom_id, course_blueprint_id,
    purpose, status, created_by_user_id, data_subject_user_id, resource_type,
    resource_id, content_type, byte_size, content_sha256,
    reservation_expires_at, verified_at, ready_at
  ) values (
    p_object_id, p_storage_bucket, p_storage_path, p_classroom_id,
    p_course_blueprint_id, p_purpose, 'ready', p_created_by_user_id,
    p_data_subject_user_id, nullif(btrim(p_resource_type), ''), p_resource_id,
    nullif(btrim(p_content_type), ''), p_byte_size, p_content_sha256,
    null, clock_timestamp(), clock_timestamp()
  )
  on conflict (id) do update set updated_at = clock_timestamp()
  where managed_storage_objects.storage_bucket = excluded.storage_bucket
    and managed_storage_objects.storage_path = excluded.storage_path
    and managed_storage_objects.classroom_id is not distinct from excluded.classroom_id
    and managed_storage_objects.course_blueprint_id is not distinct from excluded.course_blueprint_id
    and managed_storage_objects.provisional_owner_id is null
    and managed_storage_objects.purpose = excluded.purpose
    and managed_storage_objects.created_by_user_id
      is not distinct from excluded.created_by_user_id
    and managed_storage_objects.data_subject_user_id
      is not distinct from excluded.data_subject_user_id
    and managed_storage_objects.resource_type
      is not distinct from excluded.resource_type
    and managed_storage_objects.resource_id
      is not distinct from excluded.resource_id
    and managed_storage_objects.content_type
      is not distinct from excluded.content_type
    and managed_storage_objects.byte_size
      is not distinct from excluded.byte_size
    and managed_storage_objects.content_sha256
      is not distinct from excluded.content_sha256
    and managed_storage_objects.status = 'ready'
  returning * into v_object;

  if v_object.id is null then
    raise exception using errcode = '23505', message = 'legacy_managed_storage_ambiguous';
  end if;
  return v_object;
end;
$$;

create or replace function public.managed_storage_object_is_referenced(p_object_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    exists (select 1 from public.assignment_submission_artifacts where managed_object_id = p_object_id)
    or exists (select 1 from public.managed_storage_json_references where managed_object_id = p_object_id)
    or exists (select 1 from public.classroom_archive_operations where managed_object_id = p_object_id)
    or exists (select 1 from public.classroom_archives where managed_object_id = p_object_id)
    or exists (select 1 from public.classroom_archive_object_upload_cleanup where managed_object_id = p_object_id and status <> 'deleted')
    or exists (select 1 from public.classroom_archive_restore_expected_objects where managed_object_id = p_object_id)
    or exists (select 1 from public.classroom_archive_source_object_cleanup where managed_object_id = p_object_id and status <> 'deleted')
    or exists (select 1 from public.classroom_gradex_extracts where managed_object_id = p_object_id)
    or exists (select 1 from public.classroom_gradex_extract_cleanup where managed_object_id = p_object_id and status <> 'deleted')
    or exists (select 1 from public.assignment_artifact_storage_cleanup where managed_object_id = p_object_id)
    or exists (select 1 from public.test_document_snapshot_storage_cleanup where managed_object_id = p_object_id)
$$;

create or replace function public.reconcile_managed_storage_relational_references()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_rows integer;
begin
  perform public.lock_managed_storage_protocol();
  update public.assignment_submission_artifacts reference
  set managed_object_id = object.id from public.managed_storage_objects object
  where reference.managed_object_id is null
    and object.storage_bucket = 'assignment-artifacts'
    and object.storage_path = reference.storage_path;
  get diagnostics v_rows = row_count; v_count := v_count + v_rows;
  update public.classroom_archive_operations reference set managed_object_id = object.id
  from public.managed_storage_objects object where reference.managed_object_id is null
    and reference.storage_path is not null
    and object.storage_bucket = reference.storage_bucket and object.storage_path = reference.storage_path;
  get diagnostics v_rows = row_count; v_count := v_count + v_rows;
  update public.classroom_archives reference set managed_object_id = object.id
  from public.managed_storage_objects object where reference.managed_object_id is null
    and object.storage_bucket = reference.storage_bucket and object.storage_path = reference.storage_path;
  get diagnostics v_rows = row_count; v_count := v_count + v_rows;
  update public.classroom_archive_object_upload_cleanup reference set managed_object_id = object.id
  from public.managed_storage_objects object where reference.managed_object_id is null
    and object.storage_bucket = reference.storage_bucket and object.storage_path = reference.storage_path;
  get diagnostics v_rows = row_count; v_count := v_count + v_rows;
  update public.classroom_archive_restore_expected_objects reference set managed_object_id = object.id
  from public.managed_storage_objects object where reference.managed_object_id is null
    and object.storage_bucket = reference.storage_bucket and object.storage_path = reference.storage_path;
  get diagnostics v_rows = row_count; v_count := v_count + v_rows;
  update public.classroom_archive_source_object_cleanup reference set managed_object_id = object.id
  from public.managed_storage_objects object where reference.managed_object_id is null
    and object.storage_bucket = reference.storage_bucket and object.storage_path = reference.storage_path;
  get diagnostics v_rows = row_count; v_count := v_count + v_rows;
  update public.classroom_gradex_extracts reference set managed_object_id = object.id
  from public.managed_storage_objects object where reference.managed_object_id is null
    and object.storage_bucket = reference.storage_bucket and object.storage_path = reference.storage_path;
  get diagnostics v_rows = row_count; v_count := v_count + v_rows;
  update public.classroom_gradex_extract_cleanup reference set managed_object_id = object.id
  from public.managed_storage_objects object where reference.managed_object_id is null
    and object.storage_bucket = reference.storage_bucket and object.storage_path = reference.storage_path;
  get diagnostics v_rows = row_count; v_count := v_count + v_rows;
  update public.assignment_artifact_storage_cleanup reference set managed_object_id = object.id
  from public.managed_storage_objects object where reference.managed_object_id is null
    and object.storage_bucket = 'assignment-artifacts' and object.storage_path = reference.storage_path;
  get diagnostics v_rows = row_count; v_count := v_count + v_rows;
  update public.test_document_snapshot_storage_cleanup reference set managed_object_id = object.id
  from public.managed_storage_objects object where reference.managed_object_id is null
    and object.storage_bucket = 'test-documents' and object.storage_path = reference.storage_path;
  get diagnostics v_rows = row_count; v_count := v_count + v_rows;
  return v_count;
end;
$$;

create or replace function public.refresh_managed_storage_readiness()
returns public.managed_storage_readiness_runs
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_run public.managed_storage_readiness_runs;
  v_generation bigint;
  v_digest text;
  v_findings integer;
  v_object_count integer;
  v_reference_count integer;
begin
  -- A readiness run invalidates prior evidence and is serialized with writers.
  update public.managed_storage_settings
  set readiness_generation = readiness_generation + 1,
      readiness_digest = case when mode = 'enforced' then readiness_digest end,
      readiness_verified_at = case
        when mode = 'enforced' then readiness_verified_at
      end,
      activated_at = case when mode = 'enforced' then activated_at else null end,
      updated_at = clock_timestamp()
  where singleton
  returning readiness_generation into strict v_generation;

  insert into public.managed_storage_readiness_runs (
    generation, protocol_version, status
  )
  select v_generation, protocol_version, 'running'
  from public.managed_storage_settings where singleton
  returning * into v_run;

  -- Raw relational and operational references without managed identity.
  insert into public.managed_storage_readiness_findings (
    run_id, finding_code, bucket, identity_sha256, evidence_count
  )
  select v_run.id, 'raw_reference_missing_identity', source.bucket,
    public.managed_storage_identity_sha256(source.bucket, source.path),
    count(*)::integer
  from (
    select 'assignment-artifacts'::text bucket, storage_path path
    from public.assignment_submission_artifacts
    where storage_path is not null and managed_object_id is null
    union all
    select storage_bucket, storage_path from public.classroom_archives
    where managed_object_id is null
    union all
    select storage_bucket, storage_path from public.classroom_archive_operations
    where storage_path is not null and managed_object_id is null
    union all
    select storage_bucket, storage_path from public.classroom_gradex_extracts
    where managed_object_id is null
    union all
    select storage_bucket, storage_path from public.classroom_archive_object_upload_cleanup
    where status <> 'deleted' and managed_object_id is null
    union all
    select storage_bucket, storage_path from public.classroom_archive_restore_expected_objects
    where managed_object_id is null
    union all
    select storage_bucket, storage_path from public.classroom_archive_source_object_cleanup
    where status <> 'deleted' and managed_object_id is null
    union all
    select storage_bucket, storage_path from public.classroom_gradex_extract_cleanup
    where status <> 'deleted' and managed_object_id is null
    union all
    select 'assignment-artifacts', storage_path from public.assignment_artifact_storage_cleanup
    where managed_object_id is null
    union all
    select 'test-documents', storage_path from public.test_document_snapshot_storage_cleanup
    where managed_object_id is null
  ) source
  group by source.bucket, source.path
  on conflict (run_id, finding_code, identity_sha256)
  do update set evidence_count = excluded.evidence_count;

  -- Activation must not overtake a cleanup worker claimed under compatibility.
  -- Every claim mutates a ledger under the protocol lock and advances the writer
  -- revision; this also blocks on a claim already active when readiness begins.
  insert into public.managed_storage_readiness_findings (
    run_id, finding_code, bucket, identity_sha256, evidence_count
  )
  select v_run.id, 'operational_cleanup_inflight', source.bucket,
    public.managed_storage_identity_sha256(source.bucket, source.path),
    count(*)::integer
  from (
    select 'assignment-artifacts'::text bucket, storage_path path
      from public.assignment_artifact_storage_cleanup where status = 'processing'
    union all
    select 'test-documents', storage_path
      from public.test_document_snapshot_storage_cleanup where status = 'processing'
    union all
    select storage_bucket, storage_path
      from public.classroom_archive_object_upload_cleanup where status = 'processing'
    union all
    select storage_bucket, storage_path
      from public.classroom_archive_source_object_cleanup where status = 'processing'
    union all
    select storage_bucket, storage_path
      from public.classroom_gradex_extract_cleanup where status = 'processing'
  ) source
  group by source.bucket, source.path
  on conflict (run_id, finding_code, identity_sha256)
  do update set evidence_count = excluded.evidence_count;

  -- A raw path and managed UUID must describe the same exact object.
  insert into public.managed_storage_readiness_findings (
    run_id, finding_code, bucket, identity_sha256, evidence_count
  )
  select v_run.id, 'reference_identity_mismatch', reference.bucket,
    public.managed_storage_identity_sha256(reference.bucket, reference.path),
    count(*)::integer
  from (
    select artifact.managed_object_id, 'assignment-artifacts'::text bucket,
      artifact.storage_path path, assignment.classroom_id expected_classroom_id
    from public.assignment_submission_artifacts artifact
    join public.assignment_docs document on document.id = artifact.assignment_doc_id
    join public.assignments assignment on assignment.id = document.assignment_id
    where artifact.storage_path is not null and artifact.managed_object_id is not null
    union all
    select managed_object_id, storage_bucket, storage_path, classroom_id
    from public.classroom_archives
    where managed_object_id is not null
    union all
    select managed_object_id, storage_bucket, storage_path, classroom_id
      from public.classroom_archive_operations
      where managed_object_id is not null and storage_path is not null
    union all
    select managed_object_id, storage_bucket, storage_path, classroom_id
      from public.classroom_gradex_extracts where managed_object_id is not null
    union all
    select cleanup.managed_object_id, cleanup.storage_bucket, cleanup.storage_path,
      operation.classroom_id
      from public.classroom_archive_object_upload_cleanup cleanup
      join public.classroom_archive_operations operation on operation.id = cleanup.operation_id
      where cleanup.managed_object_id is not null and cleanup.status <> 'deleted'
    union all
    select expected.managed_object_id, expected.storage_bucket, expected.storage_path,
      operation.classroom_id
      from public.classroom_archive_restore_expected_objects expected
      join public.classroom_archive_operations operation on operation.id = expected.operation_id
      where expected.managed_object_id is not null
    union all
    select managed_object_id, storage_bucket, storage_path, classroom_id
      from public.classroom_archive_source_object_cleanup
      where managed_object_id is not null and status <> 'deleted'
    union all
    select cleanup.managed_object_id, cleanup.storage_bucket, cleanup.storage_path,
      operation.classroom_id
      from public.classroom_gradex_extract_cleanup cleanup
      join public.classroom_archive_operations operation on operation.id = cleanup.operation_id
      where cleanup.managed_object_id is not null and cleanup.status <> 'deleted'
    union all
    select managed_object_id, 'assignment-artifacts', storage_path, null::uuid
      from public.assignment_artifact_storage_cleanup
      where managed_object_id is not null
    union all
    select managed_object_id, 'test-documents', storage_path, null::uuid
      from public.test_document_snapshot_storage_cleanup
      where managed_object_id is not null
  ) reference
  left join public.managed_storage_objects object on object.id = reference.managed_object_id
  where object.id is null or object.storage_bucket <> reference.bucket
    or object.storage_path <> reference.path or object.status <> 'ready'
    or (reference.expected_classroom_id is not null
      and object.classroom_id is distinct from reference.expected_classroom_id)
  group by reference.bucket, reference.path
  on conflict (run_id, finding_code, identity_sha256)
  do update set evidence_count = excluded.evidence_count;

  -- Storage inventory must be fully registered.
  insert into public.managed_storage_readiness_findings (
    run_id, finding_code, bucket, identity_sha256
  )
  select v_run.id, 'storage_object_ownerless', storage_object.bucket_id,
    public.managed_storage_identity_sha256(storage_object.bucket_id, storage_object.name)
  from storage.objects storage_object
  left join public.managed_storage_objects object
    on object.storage_bucket = storage_object.bucket_id
   and object.storage_path = storage_object.name
  where storage_object.bucket_id in (
    'assignment-artifacts', 'submission-images', 'test-documents',
    'classroom-archives', 'gradex-analytics-extracts'
  ) and object.id is null;

  insert into public.managed_storage_readiness_findings (
    run_id, finding_code, bucket, identity_sha256
  )
  select v_run.id, 'managed_object_missing_storage', object.storage_bucket,
    public.managed_storage_identity_sha256(object.storage_bucket, object.storage_path)
  from public.managed_storage_objects object
  left join storage.objects storage_object
    on storage_object.bucket_id = object.storage_bucket
   and storage_object.name = object.storage_path
  where object.status in ('verified', 'ready') and storage_object.id is null;

  insert into public.managed_storage_readiness_findings (
    run_id, finding_code, bucket, identity_sha256
  )
  select v_run.id, 'managed_object_ownerless', object.storage_bucket,
    public.managed_storage_identity_sha256(object.storage_bucket, object.storage_path)
  from public.managed_storage_objects object
  where object.status = 'ready'
    and not public.managed_storage_object_is_referenced(object.id);

  insert into public.managed_storage_readiness_findings (
    run_id, finding_code, bucket, identity_sha256
  )
  select v_run.id, 'managed_object_unsettled', object.storage_bucket,
    public.managed_storage_identity_sha256(object.storage_bucket, object.storage_path)
  from public.managed_storage_objects object
  where object.status in ('reserved', 'verified');

  insert into public.managed_storage_readiness_findings (
    run_id, finding_code, bucket, identity_sha256
  )
  select v_run.id, 'provisional_owner_expired', object.storage_bucket,
    public.managed_storage_identity_sha256(object.storage_bucket, object.storage_path)
  from public.managed_storage_objects object
  join public.managed_storage_provisional_owners owner
    on owner.id = object.provisional_owner_id
  where owner.adopted_at is null and owner.expires_at <= clock_timestamp();

  -- Fail closed when a managed bucket appears in embedded JSON but the host has
  -- no registry entry. This deliberately over-blocks uncertain legacy shapes.
  insert into public.managed_storage_readiness_findings (
    run_id, finding_code, identity_sha256
  )
  select v_run.id, 'embedded_reference_missing_registry',
    public.managed_storage_entity_sha256(host.host_type, host.host_id)
  from (
    select 'assignment_doc'::text host_type, id host_id, content payload
      from public.assignment_docs
    union all select 'assignment_doc_history', id, coalesce(snapshot, patch)
      from public.assignment_doc_history
    union all select 'test', id, documents from public.tests
    union all select 'course_blueprint_assessment', id, documents
      from public.course_blueprint_assessments
    union all select 'course_blueprint_version', id, snapshot_json
      from public.course_blueprint_versions
    union all select 'course_blueprint_change_proposal', id, operations_json
      from public.course_blueprint_change_proposals
  ) host
  where exists (
    select 1
    from (
      select distinct storage_bucket, storage_path
      from public.managed_storage_payload_raw_references(host.payload)
    ) raw_reference
    where not exists (
      select 1
      from public.managed_storage_json_references reference
      where reference.storage_bucket = raw_reference.storage_bucket
        and reference.storage_path = raw_reference.storage_path
        and (
          reference.assignment_doc_id = case when host.host_type = 'assignment_doc' then host.host_id end
          or reference.assignment_doc_history_id = case when host.host_type = 'assignment_doc_history' then host.host_id end
          or reference.test_id = case when host.host_type = 'test' then host.host_id end
          or reference.course_blueprint_assessment_id = case when host.host_type = 'course_blueprint_assessment' then host.host_id end
          or reference.course_blueprint_version_id = case when host.host_type = 'course_blueprint_version' then host.host_id end
          or reference.course_blueprint_change_proposal_id = case when host.host_type = 'course_blueprint_change_proposal' then host.host_id end
        )
    )
  );

  insert into public.managed_storage_readiness_findings (
    run_id, finding_code, identity_sha256
  )
  select distinct v_run.id, 'embedded_reference_owner_mismatch',
    public.managed_storage_entity_sha256(host.host_type, host.host_id)
  from (
    select 'assignment_doc'::text host_type, document.id host_id,
      assignment.classroom_id, null::uuid course_blueprint_id
      from public.assignment_docs document
      join public.assignments assignment on assignment.id = document.assignment_id
    union all
    select 'assignment_doc_history', history.id, assignment.classroom_id, null::uuid
      from public.assignment_doc_history history
      join public.assignment_docs document on document.id = history.assignment_doc_id
      join public.assignments assignment on assignment.id = document.assignment_id
    union all
    select 'test', id, classroom_id, null::uuid from public.tests
    union all
    select 'course_blueprint_assessment', id, null::uuid, course_blueprint_id
      from public.course_blueprint_assessments
    union all
    select 'course_blueprint_version', id, null::uuid, course_blueprint_id
      from public.course_blueprint_versions
    union all
    select 'course_blueprint_change_proposal', id, null::uuid, course_blueprint_id
      from public.course_blueprint_change_proposals
  ) host
  join public.managed_storage_json_references reference on (
    reference.assignment_doc_id = case when host.host_type = 'assignment_doc' then host.host_id end
    or reference.assignment_doc_history_id = case when host.host_type = 'assignment_doc_history' then host.host_id end
    or reference.test_id = case when host.host_type = 'test' then host.host_id end
    or reference.course_blueprint_assessment_id = case when host.host_type = 'course_blueprint_assessment' then host.host_id end
    or reference.course_blueprint_version_id = case when host.host_type = 'course_blueprint_version' then host.host_id end
    or reference.course_blueprint_change_proposal_id = case when host.host_type = 'course_blueprint_change_proposal' then host.host_id end
  )
  join public.managed_storage_objects object on object.id = reference.managed_object_id
  where (host.classroom_id is not null
      and object.classroom_id is distinct from host.classroom_id)
    or (host.course_blueprint_id is not null
      and object.course_blueprint_id is distinct from host.course_blueprint_id)
  on conflict (run_id, finding_code, identity_sha256) do nothing;

  insert into public.managed_storage_readiness_findings (
    run_id, finding_code, identity_sha256
  )
  select distinct v_run.id, 'embedded_reference_resource_mismatch',
    public.managed_storage_entity_sha256(host.host_type, host.host_id)
  from (
    select 'assignment_doc'::text host_type, document.id host_id,
      document.id assignment_doc_id, document.student_id data_subject_user_id
    from public.assignment_docs document
    union all
    select 'assignment_doc_history', history.id, document.id, document.student_id
    from public.assignment_doc_history history
    join public.assignment_docs document on document.id = history.assignment_doc_id
  ) host
  join public.managed_storage_json_references reference on (
    reference.assignment_doc_id = case when host.host_type = 'assignment_doc' then host.host_id end
    or reference.assignment_doc_history_id = case
      when host.host_type = 'assignment_doc_history' then host.host_id end
  )
  join public.managed_storage_objects object on object.id = reference.managed_object_id
  where object.storage_bucket = 'submission-images' and (
    object.resource_type is distinct from 'assignment_doc'
    or object.resource_id is distinct from host.assignment_doc_id
    or object.data_subject_user_id is distinct from host.data_subject_user_id
  )
  on conflict (run_id, finding_code, identity_sha256) do nothing;

  select count(*) into v_findings
  from public.managed_storage_readiness_findings where run_id = v_run.id;
  select count(*) into v_object_count from public.managed_storage_objects;
  select count(*) into v_reference_count from public.managed_storage_json_references;
  select encode(extensions.digest(convert_to(coalesce(string_agg(line, E'\n' order by line), ''), 'UTF8'), 'sha256'), 'hex')
  into v_digest
  from (
    select jsonb_build_array(
      storage_bucket, storage_path, classroom_id, course_blueprint_id,
      provisional_owner_id, purpose, status
    )::text line
    from public.managed_storage_objects
    union all
    select jsonb_build_array('finding', finding_code, identity_sha256, evidence_count)::text
    from public.managed_storage_readiness_findings where run_id = v_run.id
  ) evidence;

  update public.managed_storage_readiness_runs
  set status = case when v_findings = 0 then 'ready' else 'blocked' end,
      finding_count = v_findings,
      object_count = v_object_count,
      reference_count = v_reference_count,
      inventory_digest = v_digest,
      completed_at = clock_timestamp()
  where id = v_run.id returning * into v_run;

  if v_run.status = 'ready' then
    update public.managed_storage_settings
    set readiness_digest = v_digest,
        readiness_verified_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where singleton and readiness_generation = v_generation;
  end if;
  return v_run;
end;
$$;

revoke all on function public.register_legacy_managed_storage_object(
  uuid, text, text, uuid, uuid, text, uuid, uuid, text, uuid, text, bigint, text
) from public, anon, authenticated;
grant execute on function public.register_legacy_managed_storage_object(
  uuid, text, text, uuid, uuid, text, uuid, uuid, text, uuid, text, bigint, text
) to service_role;
revoke all on function public.refresh_managed_storage_readiness()
  from public, anon, authenticated;
grant execute on function public.refresh_managed_storage_readiness()
  to service_role;
revoke all on function public.reconcile_managed_storage_relational_references()
  from public, anon, authenticated;
grant execute on function public.reconcile_managed_storage_relational_references()
  to service_role;
revoke all on function public.managed_storage_identity_sha256(text, text),
  public.managed_storage_entity_sha256(text, uuid),
  public.managed_storage_payload_path_occurrences(jsonb, text),
  public.managed_storage_public_url_identity(text),
  public.managed_storage_payload_raw_references(jsonb),
  public.managed_storage_payload_has_exact_reference(jsonb, uuid, text, text),
  public.managed_storage_legacy_object_id(text, text)
  from public, anon, authenticated;
grant execute on function public.managed_storage_legacy_object_id(text, text)
  to service_role;

-- -----------------------------------------------------------------------------
-- Managed-storage ownership stage 3: enforcement activation and generic cleanup
-- -----------------------------------------------------------------------------
-- Managed-storage enforcement activation and generic cleanup protocol.
--
-- Applying this migration still leaves enforcement in compatibility mode and
-- creates no scheduled worker. Activation is an explicit, evidence-bound RPC.

create sequence public.managed_storage_writer_revision_seq;

alter table public.managed_storage_settings
  add column readiness_writer_revision bigint,
  add constraint managed_storage_readiness_writer_revision_check check (
    readiness_writer_revision is null or readiness_writer_revision > 0
  );
alter table public.managed_storage_readiness_runs
  add column writer_revision bigint,
  add constraint managed_storage_run_writer_revision_check check (
    writer_revision is null or writer_revision > 0
  );

update public.managed_storage_settings
set protocol_version = 2, updated_at = clock_timestamp()
where singleton;

create or replace function public.managed_storage_blueprint_protocol_ready()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select protocol_version >= 2 from public.managed_storage_settings where singleton
$$;

revoke all on function public.managed_storage_blueprint_protocol_ready()
  from public, anon, authenticated;
grant execute on function public.managed_storage_blueprint_protocol_ready()
  to service_role;

revoke all on sequence public.managed_storage_writer_revision_seq
  from public, anon, authenticated, service_role;

-- Lock order begins here for every managed Storage or reference writer:
-- settings row (shared) -> lifecycle owner -> operation/reference -> managed
-- object UUID -> exact bucket/path advisory lock.
create or replace function public.lock_managed_storage_protocol()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enforced boolean;
begin
  select mode = 'enforced' into strict v_enforced
  from public.managed_storage_settings
  where singleton
  for share;
  perform nextval('public.managed_storage_writer_revision_seq');
  return v_enforced;
end;
$$;

-- Internal only. Managed writer RPCs execute as the owning role and may call
-- this helper, but callers must not advance the revision or hold its lock.
revoke all on function public.lock_managed_storage_protocol()
  from public, anon, authenticated, service_role;

create or replace function public.capture_managed_storage_readiness_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revision bigint;
begin
  if new.status <> 'ready' or old.status = 'ready' then return new; end if;
  select last_value into v_revision from public.managed_storage_writer_revision_seq;
  update public.managed_storage_readiness_runs
  set writer_revision = v_revision where id = new.id;
  update public.managed_storage_settings
  set readiness_writer_revision = v_revision, updated_at = clock_timestamp()
  where singleton and readiness_generation = new.generation;
  return new;
end;
$$;

create trigger capture_managed_storage_readiness_revision
after update of status on public.managed_storage_readiness_runs
for each row execute function public.capture_managed_storage_readiness_revision();

create or replace function public.managed_storage_payload_ids(p_payload jsonb)
returns table (managed_object_id uuid)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value jsonb;
  v_text text;
begin
  if p_payload is null then return; end if;
  for v_value in
    select value from jsonb_path_query(p_payload, 'lax $.**.managed_object_id') value
    union all
    select value from jsonb_path_query(p_payload, 'lax $.**.snapshot_managed_object_id') value
    union all
    select value from jsonb_path_query(p_payload, 'lax $.**.managed_object_ids[*]') value
  loop
    v_text := v_value #>> '{}';
    begin
      managed_object_id := v_text::uuid;
      return next;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'managed_storage_embedded_identity_invalid';
    end;
  end loop;
end;
$$;

create or replace function public.managed_storage_payload_path_occurrences(
  p_payload jsonb,
  p_storage_path text
)
returns integer
language sql
immutable
strict
set search_path = ''
as $$
  select case when length(p_storage_path) = 0 then 0 else
    (length(p_payload::text) - length(replace(p_payload::text, p_storage_path, '')))
      / length(p_storage_path)
  end
$$;

create or replace function public.sync_managed_storage_json_host()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_host_type text := tg_table_name;
  v_reference_role text;
  v_classroom_id uuid;
  v_blueprint_id uuid;
  v_assignment_doc_id uuid;
  v_data_subject_user_id uuid;
  v_object public.managed_storage_objects;
  v_object_id uuid;
  v_previous_object_id uuid;
  v_previous_object_ids uuid[] := array[]::uuid[];
  v_enforced boolean;
  v_evidence_sha256 text;
  v_identity_count integer := 0;
  v_raw_reference_count integer := 0;
  v_storage_present boolean;
begin
  v_enforced := public.lock_managed_storage_protocol();
  case tg_table_name
    when 'assignment_docs' then
      v_payload := new.content;
      v_reference_role := 'content';
      v_assignment_doc_id := new.id;
      v_data_subject_user_id := new.student_id;
      select assignment.classroom_id into v_classroom_id
      from public.assignments assignment where assignment.id = new.assignment_id;
      select coalesce(array_agg(managed_object_id), array[]::uuid[])
        into v_previous_object_ids
        from public.managed_storage_json_references where assignment_doc_id = new.id;
      delete from public.managed_storage_json_references where assignment_doc_id = new.id;
    when 'assignment_doc_history' then
      v_payload := coalesce(new.snapshot, new.patch);
      v_reference_role := case when new.snapshot is null then 'history_patch' else 'history_snapshot' end;
      select assignment.classroom_id into v_classroom_id
      from public.assignment_docs document
      join public.assignments assignment on assignment.id = document.assignment_id
      where document.id = new.assignment_doc_id;
      select document.student_id into v_data_subject_user_id
      from public.assignment_docs document where document.id = new.assignment_doc_id;
      v_assignment_doc_id := new.assignment_doc_id;
      select coalesce(array_agg(managed_object_id), array[]::uuid[])
        into v_previous_object_ids
        from public.managed_storage_json_references where assignment_doc_history_id = new.id;
      delete from public.managed_storage_json_references where assignment_doc_history_id = new.id;
    when 'tests' then
      v_payload := new.documents;
      v_reference_role := 'teacher_document';
      v_classroom_id := new.classroom_id;
      select coalesce(array_agg(managed_object_id), array[]::uuid[])
        into v_previous_object_ids
        from public.managed_storage_json_references where test_id = new.id;
      delete from public.managed_storage_json_references where test_id = new.id;
    when 'course_blueprint_assessments' then
      v_payload := new.documents;
      v_reference_role := 'blueprint_document';
      v_blueprint_id := new.course_blueprint_id;
      select coalesce(array_agg(managed_object_id), array[]::uuid[])
        into v_previous_object_ids
        from public.managed_storage_json_references
        where course_blueprint_assessment_id = new.id;
      delete from public.managed_storage_json_references where course_blueprint_assessment_id = new.id;
    when 'course_blueprint_versions' then
      v_payload := new.snapshot_json;
      v_reference_role := 'immutable_version';
      v_blueprint_id := new.course_blueprint_id;
      select coalesce(array_agg(managed_object_id), array[]::uuid[])
        into v_previous_object_ids
        from public.managed_storage_json_references where course_blueprint_version_id = new.id;
      delete from public.managed_storage_json_references where course_blueprint_version_id = new.id;
    when 'course_blueprint_change_proposals' then
      v_payload := new.operations_json;
      v_reference_role := 'proposal';
      v_blueprint_id := new.course_blueprint_id;
      select coalesce(array_agg(managed_object_id), array[]::uuid[])
        into v_previous_object_ids
        from public.managed_storage_json_references
        where course_blueprint_change_proposal_id = new.id;
      delete from public.managed_storage_json_references where course_blueprint_change_proposal_id = new.id;
    else
      raise exception using errcode = '55000', message = 'managed_storage_json_host_unsupported';
  end case;

  v_evidence_sha256 := encode(extensions.digest(convert_to(coalesce(v_payload, 'null'::jsonb)::text, 'UTF8'), 'sha256'), 'hex');
  for v_object_id in select distinct managed_object_id
    from public.managed_storage_payload_ids(v_payload)
    order by managed_object_id
  loop
    select * into v_object from public.managed_storage_objects
    where id = v_object_id for update;
    if not found then
      raise exception using errcode = '55000', message = 'managed_storage_embedded_owner_mismatch';
    end if;
    perform public.managed_storage_exact_lock(
      v_object.storage_bucket, v_object.storage_path
    );
    v_storage_present := exists (
      select 1 from storage.objects object
      where object.bucket_id = v_object.storage_bucket
        and object.name = v_object.storage_path
    );
    if (
        v_object.status not in ('verified', 'ready')
        and not (
          not v_enforced
          and v_object.status = 'cleanup_processing'
          and v_storage_present
        )
      )
      or not public.managed_storage_payload_has_exact_reference(
        v_payload, v_object.id, v_object.storage_bucket, v_object.storage_path
      )
    then
      raise exception using errcode = '55000', message = 'managed_storage_embedded_owner_mismatch';
    end if;
    if v_object.provisional_owner_id is not null then
      perform 1
      from public.managed_storage_provisional_owners owner
      where owner.id = v_object.provisional_owner_id
        and owner.operation_id::text = current_setting(
          'pika.managed_storage_blueprint_operation_id', true
        )
        and owner.created_by_user_id::text = current_setting(
          'pika.managed_storage_blueprint_teacher_id', true
        )
        and (
          (v_classroom_id is not null and owner.owner_kind in ('classroom_copy', 'restore_copy'))
          or (v_blueprint_id is not null and owner.owner_kind = 'course_blueprint_copy')
        )
      for update;
      if not found then
        raise exception using errcode = '55000', message = 'managed_storage_provisional_adoption_mismatch';
      end if;
      perform set_config('pika.managed_storage_owner_adoption', 'on', true);
      update public.managed_storage_objects
      set classroom_id = v_classroom_id,
          course_blueprint_id = v_blueprint_id,
          provisional_owner_id = null,
          updated_at = clock_timestamp()
      where id = v_object_id;
      update public.managed_storage_provisional_owners
      set adopted_at = coalesce(adopted_at, clock_timestamp())
      where id = v_object.provisional_owner_id;
      select * into v_object from public.managed_storage_objects
      where id = v_object_id for update;
    elsif (v_classroom_id is not null and v_object.classroom_id is distinct from v_classroom_id)
      or (v_blueprint_id is not null and v_object.course_blueprint_id is distinct from v_blueprint_id)
    then
      raise exception using errcode = '55000', message = 'managed_storage_embedded_owner_mismatch';
    end if;
    if v_object.storage_bucket = 'submission-images' and (
      v_assignment_doc_id is null
      or v_object.resource_type is distinct from 'assignment_doc'
      or v_object.resource_id is distinct from v_assignment_doc_id
      or v_object.data_subject_user_id is distinct from v_data_subject_user_id
    ) then
      raise exception using errcode = '55000', message = 'managed_storage_embedded_resource_mismatch';
    end if;
    if v_object.status = 'verified' then
      perform public.managed_storage_mark_ready(v_object.id);
    end if;
    v_identity_count := v_identity_count + 1;
    insert into public.managed_storage_json_references (
      managed_object_id, storage_bucket, storage_path,
      assignment_doc_id, assignment_doc_history_id, test_id,
      course_blueprint_assessment_id, course_blueprint_version_id,
      course_blueprint_change_proposal_id, reference_role, evidence_sha256
    ) values (
      v_object.id, v_object.storage_bucket, v_object.storage_path,
      case when tg_table_name = 'assignment_docs' then new.id end,
      case when tg_table_name = 'assignment_doc_history' then new.id end,
      case when tg_table_name = 'tests' then new.id end,
      case when tg_table_name = 'course_blueprint_assessments' then new.id end,
      case when tg_table_name = 'course_blueprint_versions' then new.id end,
      case when tg_table_name = 'course_blueprint_change_proposals' then new.id end,
      v_reference_role, v_evidence_sha256
    ) on conflict do nothing;
  end loop;

  for v_object_id in
    select object.id from public.managed_storage_objects object
    where not v_enforced
      and object.provisional_owner_id is null
      and exists (
        select 1
        from public.managed_storage_payload_raw_references(v_payload) reference
        where reference.managed_object_id is null
          and reference.storage_bucket = object.storage_bucket
          and reference.storage_path = object.storage_path
      )
      and (
        (v_classroom_id is not null and object.classroom_id = v_classroom_id)
        or (v_blueprint_id is not null and object.course_blueprint_id = v_blueprint_id)
      )
      and (
        object.storage_bucket <> 'submission-images'
        or (
          v_assignment_doc_id is not null
          and object.resource_type = 'assignment_doc'
          and object.resource_id = v_assignment_doc_id
          and object.data_subject_user_id = v_data_subject_user_id
        )
      )
      and not exists (
        select 1 from public.managed_storage_payload_ids(v_payload) payload_id
        where payload_id.managed_object_id = object.id
      )
    order by object.id
    for update
  loop
    select * into v_object from public.managed_storage_objects where id = v_object_id;
    perform public.managed_storage_exact_lock(
      v_object.storage_bucket, v_object.storage_path
    );
    v_storage_present := exists (
      select 1 from storage.objects object
      where object.bucket_id = v_object.storage_bucket
        and object.name = v_object.storage_path
    );
    if v_object.status not in ('verified', 'ready')
      and not (
        v_object.status = 'cleanup_processing'
        and v_storage_present
      )
    then
      raise exception using errcode = '55000', message = 'managed_storage_embedded_owner_mismatch';
    end if;
    if v_object.status = 'verified' then
      perform public.managed_storage_mark_ready(v_object.id);
    end if;
    v_identity_count := v_identity_count + 1;
    insert into public.managed_storage_json_references (
      managed_object_id, storage_bucket, storage_path,
      assignment_doc_id, assignment_doc_history_id, test_id,
      course_blueprint_assessment_id, course_blueprint_version_id,
      course_blueprint_change_proposal_id, reference_role, evidence_sha256
    ) values (
      v_object.id, v_object.storage_bucket, v_object.storage_path,
      case when tg_table_name = 'assignment_docs' then new.id end,
      case when tg_table_name = 'assignment_doc_history' then new.id end,
      case when tg_table_name = 'tests' then new.id end,
      case when tg_table_name = 'course_blueprint_assessments' then new.id end,
      case when tg_table_name = 'course_blueprint_versions' then new.id end,
      case when tg_table_name = 'course_blueprint_change_proposals' then new.id end,
      v_reference_role, v_evidence_sha256
    ) on conflict do nothing;
  end loop;

  select count(*)::integer into v_raw_reference_count
  from (
    select distinct storage_bucket, storage_path
    from public.managed_storage_payload_raw_references(v_payload)
  ) reference;
  if v_enforced
    and v_raw_reference_count > v_identity_count
  then
    raise exception using errcode = '55000', message = 'managed_storage_embedded_identity_required';
  end if;
  foreach v_previous_object_id in array v_previous_object_ids loop
    perform public.queue_managed_storage_cleanup(
      v_previous_object_id, 'embedded_reference_removed'
    );
  end loop;
  return new;
end;
$$;

create trigger assignment_docs_managed_storage_sync
after insert or update of content on public.assignment_docs
for each row execute function public.sync_managed_storage_json_host();
create trigger assignment_doc_history_managed_storage_sync
after insert or update of snapshot, patch on public.assignment_doc_history
for each row execute function public.sync_managed_storage_json_host();
create trigger tests_managed_storage_sync
after insert or update of documents on public.tests
for each row execute function public.sync_managed_storage_json_host();
create trigger course_blueprint_assessments_managed_storage_sync
after insert or update of documents on public.course_blueprint_assessments
for each row execute function public.sync_managed_storage_json_host();
create trigger course_blueprint_versions_managed_storage_sync
after insert or update of snapshot_json on public.course_blueprint_versions
for each row execute function public.sync_managed_storage_json_host();
create trigger course_blueprint_proposals_managed_storage_sync
after insert or update of operations_json on public.course_blueprint_change_proposals
for each row execute function public.sync_managed_storage_json_host();

create or replace function public.remove_managed_storage_json_host()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_object_id uuid;
  v_object_ids uuid[] := array[]::uuid[];
begin
  perform public.lock_managed_storage_protocol();
  case tg_table_name
    when 'assignment_docs' then
      select coalesce(array_agg(managed_object_id), array[]::uuid[])
        into v_object_ids from public.managed_storage_json_references
        where assignment_doc_id = old.id;
      delete from public.managed_storage_json_references where assignment_doc_id = old.id;
    when 'assignment_doc_history' then
      select coalesce(array_agg(managed_object_id), array[]::uuid[])
        into v_object_ids from public.managed_storage_json_references
        where assignment_doc_history_id = old.id;
      delete from public.managed_storage_json_references
        where assignment_doc_history_id = old.id;
    when 'tests' then
      select coalesce(array_agg(managed_object_id), array[]::uuid[])
        into v_object_ids from public.managed_storage_json_references
        where test_id = old.id;
      delete from public.managed_storage_json_references where test_id = old.id;
    when 'course_blueprint_assessments' then
      select coalesce(array_agg(managed_object_id), array[]::uuid[])
        into v_object_ids from public.managed_storage_json_references
        where course_blueprint_assessment_id = old.id;
      delete from public.managed_storage_json_references
        where course_blueprint_assessment_id = old.id;
    when 'course_blueprint_versions' then
      select coalesce(array_agg(managed_object_id), array[]::uuid[])
        into v_object_ids from public.managed_storage_json_references
        where course_blueprint_version_id = old.id;
      delete from public.managed_storage_json_references
        where course_blueprint_version_id = old.id;
    when 'course_blueprint_change_proposals' then
      select coalesce(array_agg(managed_object_id), array[]::uuid[])
        into v_object_ids from public.managed_storage_json_references
        where course_blueprint_change_proposal_id = old.id;
      delete from public.managed_storage_json_references
        where course_blueprint_change_proposal_id = old.id;
    else
      raise exception using errcode = '55000', message = 'managed_storage_json_host_unsupported';
  end case;
  foreach v_object_id in array v_object_ids loop
    perform public.queue_managed_storage_cleanup(v_object_id, 'embedded_host_deleted');
  end loop;
  return old;
end;
$$;

create trigger assignment_docs_managed_storage_remove
before delete on public.assignment_docs
for each row execute function public.remove_managed_storage_json_host();
create trigger assignment_doc_history_managed_storage_remove
before delete on public.assignment_doc_history
for each row execute function public.remove_managed_storage_json_host();
create trigger tests_managed_storage_remove
before delete on public.tests
for each row execute function public.remove_managed_storage_json_host();
create trigger course_blueprint_assessments_managed_storage_remove
before delete on public.course_blueprint_assessments
for each row execute function public.remove_managed_storage_json_host();
create trigger course_blueprint_versions_managed_storage_remove
before delete on public.course_blueprint_versions
for each row execute function public.remove_managed_storage_json_host();
create trigger course_blueprint_proposals_managed_storage_remove
before delete on public.course_blueprint_change_proposals
for each row execute function public.remove_managed_storage_json_host();

create or replace function public.reconcile_managed_storage_json_references()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host record;
  v_object public.managed_storage_objects;
  v_object_id uuid;
  v_raw_count integer;
  v_matched_count integer;
  v_inserted integer := 0;
  v_rows integer;
  v_evidence_sha256 text;
begin
  perform public.lock_managed_storage_protocol();
  delete from public.managed_storage_json_references;
  for v_host in
    select 'assignment_docs'::text host_type, document.id host_id,
      document.content payload, 'content'::text reference_role,
      assignment.classroom_id, null::uuid blueprint_id,
      document.id assignment_doc_id, document.student_id data_subject_user_id
      from public.assignment_docs document
      join public.assignments assignment on assignment.id = document.assignment_id
    union all
    select 'assignment_doc_history', history.id, coalesce(history.snapshot, history.patch),
      case when history.snapshot is null then 'history_patch' else 'history_snapshot' end,
      assignment.classroom_id, null::uuid, document.id, document.student_id
      from public.assignment_doc_history history
      join public.assignment_docs document on document.id = history.assignment_doc_id
      join public.assignments assignment on assignment.id = document.assignment_id
    union all
    select 'tests', id, documents, 'teacher_document', classroom_id, null::uuid,
      null::uuid, null::uuid
      from public.tests
    union all
    select 'course_blueprint_assessments', id, documents, 'blueprint_document',
      null::uuid, course_blueprint_id, null::uuid, null::uuid
      from public.course_blueprint_assessments
    union all
    select 'course_blueprint_versions', id, snapshot_json, 'immutable_version',
      null::uuid, course_blueprint_id, null::uuid, null::uuid
      from public.course_blueprint_versions
    union all
    select 'course_blueprint_change_proposals', id, operations_json, 'proposal',
      null::uuid, course_blueprint_id, null::uuid, null::uuid
      from public.course_blueprint_change_proposals
  loop
    v_matched_count := 0;
    select count(*)::integer into v_raw_count
    from (
      select distinct storage_bucket, storage_path
      from public.managed_storage_payload_raw_references(v_host.payload)
    ) reference;
    v_evidence_sha256 := encode(extensions.digest(
      convert_to(coalesce(v_host.payload, 'null'::jsonb)::text, 'UTF8'), 'sha256'
    ), 'hex');
    for v_object_id in select distinct managed_object_id
      from public.managed_storage_payload_ids(v_host.payload)
    loop
      select * into v_object from public.managed_storage_objects
      where id = v_object_id for update;
      if not found or v_object.status not in ('verified', 'ready')
        or v_object.provisional_owner_id is not null
        or not public.managed_storage_payload_has_exact_reference(
          v_host.payload, v_object.id, v_object.storage_bucket, v_object.storage_path
        )
        or (v_host.classroom_id is not null
          and v_object.classroom_id is distinct from v_host.classroom_id)
        or (v_host.blueprint_id is not null
          and v_object.course_blueprint_id is distinct from v_host.blueprint_id)
        or (v_object.storage_bucket = 'submission-images' and (
          v_host.assignment_doc_id is null
          or v_object.resource_type is distinct from 'assignment_doc'
          or v_object.resource_id is distinct from v_host.assignment_doc_id
          or v_object.data_subject_user_id is distinct from v_host.data_subject_user_id
        ))
      then
        raise exception using errcode = '55000', message = 'managed_storage_embedded_owner_mismatch';
      end if;
      if v_object.status = 'verified' then
        perform public.managed_storage_mark_ready(v_object.id);
      end if;
      v_matched_count := v_matched_count + 1;
      insert into public.managed_storage_json_references (
        managed_object_id, storage_bucket, storage_path,
        assignment_doc_id, assignment_doc_history_id, test_id,
        course_blueprint_assessment_id, course_blueprint_version_id,
        course_blueprint_change_proposal_id, reference_role, evidence_sha256
      ) values (
        v_object.id, v_object.storage_bucket, v_object.storage_path,
        case when v_host.host_type = 'assignment_docs' then v_host.host_id end,
        case when v_host.host_type = 'assignment_doc_history' then v_host.host_id end,
        case when v_host.host_type = 'tests' then v_host.host_id end,
        case when v_host.host_type = 'course_blueprint_assessments' then v_host.host_id end,
        case when v_host.host_type = 'course_blueprint_versions' then v_host.host_id end,
        case when v_host.host_type = 'course_blueprint_change_proposals' then v_host.host_id end,
        v_host.reference_role, v_evidence_sha256
      );
      get diagnostics v_rows = row_count;
      v_inserted := v_inserted + v_rows;
    end loop;
    for v_object_id in
      select object.id from public.managed_storage_objects object
      where object.status in ('verified', 'ready')
        and object.provisional_owner_id is null
        and exists (
          select 1
          from public.managed_storage_payload_raw_references(v_host.payload) reference
          where reference.managed_object_id is null
            and reference.storage_bucket = object.storage_bucket
            and reference.storage_path = object.storage_path
        )
        and (
          (v_host.classroom_id is not null and object.classroom_id = v_host.classroom_id)
          or (v_host.blueprint_id is not null
            and object.course_blueprint_id = v_host.blueprint_id)
        )
        and (
          object.storage_bucket <> 'submission-images'
          or (
            v_host.assignment_doc_id is not null
            and object.resource_type = 'assignment_doc'
            and object.resource_id = v_host.assignment_doc_id
            and object.data_subject_user_id = v_host.data_subject_user_id
          )
        )
        and not exists (
          select 1 from public.managed_storage_payload_ids(v_host.payload) payload_id
          where payload_id.managed_object_id = object.id
        )
      for update
    loop
      select * into v_object from public.managed_storage_objects where id = v_object_id;
      if v_object.status = 'verified' then
        perform public.managed_storage_mark_ready(v_object.id);
      end if;
      v_matched_count := v_matched_count + 1;
      insert into public.managed_storage_json_references (
        managed_object_id, storage_bucket, storage_path,
        assignment_doc_id, assignment_doc_history_id, test_id,
        course_blueprint_assessment_id, course_blueprint_version_id,
        course_blueprint_change_proposal_id, reference_role, evidence_sha256
      ) values (
        v_object.id, v_object.storage_bucket, v_object.storage_path,
        case when v_host.host_type = 'assignment_docs' then v_host.host_id end,
        case when v_host.host_type = 'assignment_doc_history' then v_host.host_id end,
        case when v_host.host_type = 'tests' then v_host.host_id end,
        case when v_host.host_type = 'course_blueprint_assessments' then v_host.host_id end,
        case when v_host.host_type = 'course_blueprint_versions' then v_host.host_id end,
        case when v_host.host_type = 'course_blueprint_change_proposals' then v_host.host_id end,
        v_host.reference_role, v_evidence_sha256
      ) on conflict do nothing;
      get diagnostics v_rows = row_count;
      v_inserted := v_inserted + v_rows;
    end loop;
    if v_raw_count > v_matched_count then
      raise exception using errcode = '55000', message = 'managed_storage_embedded_identity_required';
    end if;
  end loop;
  return v_inserted;
end;
$$;

revoke all on function public.reconcile_managed_storage_json_references()
  from public, anon, authenticated;
grant execute on function public.reconcile_managed_storage_json_references()
  to service_role;
revoke all on function public.managed_storage_payload_ids(jsonb),
  public.managed_storage_payload_path_occurrences(jsonb, text)
  from public, anon, authenticated;

alter function public.create_course_blueprint_atomic_v2(
  uuid, uuid, text, text, uuid, bigint, jsonb
) rename to create_course_blueprint_atomic_v2_pre_managed_storage;

create or replace function public.create_course_blueprint_atomic_v2(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_operation_type text,
  p_request_sha256 text,
  p_source_classroom_id uuid,
  p_expected_source_revision bigint,
  p_plan jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.lock_managed_storage_protocol();
  perform set_config('pika.managed_storage_blueprint_operation_id', p_operation_id::text, true);
  perform set_config('pika.managed_storage_blueprint_teacher_id', p_teacher_id::text, true);
  return public.create_course_blueprint_atomic_v2_pre_managed_storage(
    p_operation_id, p_teacher_id, p_operation_type, p_request_sha256,
    p_source_classroom_id, p_expected_source_revision, p_plan
  );
end;
$$;

alter function public.instantiate_course_blueprint_atomic_v2(
  uuid, uuid, uuid, uuid, text, bigint, jsonb
) rename to instantiate_course_blueprint_atomic_v2_pre_managed_storage;

create or replace function public.instantiate_course_blueprint_atomic_v2(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_blueprint_id uuid,
  p_blueprint_version_id uuid,
  p_request_sha256 text,
  p_expected_content_revision bigint,
  p_plan jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.lock_managed_storage_protocol();
  perform set_config('pika.managed_storage_blueprint_operation_id', p_operation_id::text, true);
  perform set_config('pika.managed_storage_blueprint_teacher_id', p_teacher_id::text, true);
  return public.instantiate_course_blueprint_atomic_v2_pre_managed_storage(
    p_operation_id, p_teacher_id, p_blueprint_id, p_blueprint_version_id,
    p_request_sha256, p_expected_content_revision, p_plan
  );
end;
$$;

revoke all on function public.create_course_blueprint_atomic_v2_pre_managed_storage(
  uuid, uuid, text, text, uuid, bigint, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_course_blueprint_atomic_v2(
  uuid, uuid, text, text, uuid, bigint, jsonb
) from public, anon, authenticated;
grant execute on function public.create_course_blueprint_atomic_v2(
  uuid, uuid, text, text, uuid, bigint, jsonb
) to service_role;
revoke all on function public.instantiate_course_blueprint_atomic_v2_pre_managed_storage(
  uuid, uuid, uuid, uuid, text, bigint, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.instantiate_course_blueprint_atomic_v2(
  uuid, uuid, uuid, uuid, text, bigint, jsonb
) from public, anon, authenticated;
grant execute on function public.instantiate_course_blueprint_atomic_v2(
  uuid, uuid, uuid, uuid, text, bigint, jsonb
) to service_role;

create or replace function public.sync_test_document_snapshot_managed_atomic(
  p_teacher_id uuid,
  p_test_id uuid,
  p_document_id text,
  p_expected_url text,
  p_snapshot_path text,
  p_snapshot_content_type text,
  p_synced_at timestamptz,
  p_managed_object_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_test public.tests;
  v_document jsonb;
  v_document_index integer;
  v_previous_snapshot_path text;
  v_previous_managed_object_id text;
  v_object public.managed_storage_objects;
  v_teacher_id uuid;
  v_archived_at timestamptz;
begin
  perform public.lock_managed_storage_protocol();
  select classroom.teacher_id, classroom.archived_at
  into v_teacher_id, v_archived_at
  from public.tests test
  join public.classrooms classroom on classroom.id = test.classroom_id
  where test.id = p_test_id
  for update of test, classroom;
  if not found then raise exception using errcode = 'P0002', message = 'test_not_found'; end if;
  if v_teacher_id is distinct from p_teacher_id then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if v_archived_at is not null then
    raise exception using errcode = '55000', message = 'classroom_archived';
  end if;
  select * into strict v_test from public.tests where id = p_test_id;
  select document.value, (document.ordinality - 1)::integer
  into v_document, v_document_index
  from jsonb_array_elements(coalesce(v_test.documents, '[]'::jsonb))
    with ordinality document(value, ordinality)
  where document.value->>'id' = p_document_id limit 1;
  if v_document is null or v_document->>'source' is distinct from 'link'
    or v_document->>'url' is distinct from p_expected_url
  then
    raise exception using errcode = '40001', message = 'document_conflict';
  end if;
  select * into v_object from public.managed_storage_objects
  where id = p_managed_object_id for update;
  if not found or v_object.status <> 'verified'
    or v_object.classroom_id is distinct from v_test.classroom_id
    or v_object.storage_bucket <> 'test-documents'
    or v_object.storage_path is distinct from p_snapshot_path
    or v_object.purpose <> 'test_execution_snapshot'
    or v_object.resource_type is distinct from 'test'
    or v_object.resource_id is distinct from p_test_id
  then
    raise exception using errcode = '55000', message = 'test_snapshot_managed_owner_mismatch';
  end if;
  v_previous_snapshot_path := v_document->>'snapshot_path';
  v_previous_managed_object_id := v_document->>'snapshot_managed_object_id';
  v_document := v_document || jsonb_build_object(
    'snapshot_path', p_snapshot_path,
    'snapshot_managed_object_id', p_managed_object_id,
    'snapshot_content_type', p_snapshot_content_type,
    'synced_at', p_synced_at
  );
  update public.tests
  set documents = jsonb_set(
    coalesce(documents, '[]'::jsonb),
    array[v_document_index::text],
    v_document,
    false
  )
  where id = p_test_id returning * into strict v_test;
  return jsonb_build_object(
    'previous_snapshot_path', v_previous_snapshot_path,
    'previous_snapshot_managed_object_id', v_previous_managed_object_id,
    'test', to_jsonb(v_test)
  );
end;
$$;

revoke all on function public.sync_test_document_snapshot_managed_atomic(
  uuid, uuid, text, text, text, text, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.sync_test_document_snapshot_managed_atomic(
  uuid, uuid, text, text, text, text, timestamptz, uuid
) to service_role;

create or replace function public.validate_assignment_artifact_managed_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enforced boolean;
  v_object public.managed_storage_objects;
  v_classroom_id uuid;
  v_storage_present boolean;
begin
  v_enforced := public.lock_managed_storage_protocol();
  if new.storage_path is null then
    if new.managed_object_id is not null then
      raise exception using errcode = '55000', message = 'assignment_artifact_managed_identity_without_path';
    end if;
    return new;
  end if;
  if new.managed_object_id is null then
    if v_enforced then
      raise exception using errcode = '55000', message = 'assignment_artifact_managed_identity_required';
    end if;
    select * into v_object from public.managed_storage_objects
    where storage_bucket = 'assignment-artifacts'
      and storage_path = new.storage_path
    for update;
    if not found then return new; end if;
    new.managed_object_id := v_object.id;
  else
    select * into v_object from public.managed_storage_objects
    where id = new.managed_object_id for update;
    if not found then
      raise exception using errcode = '55000', message = 'assignment_artifact_managed_owner_mismatch';
    end if;
  end if;
  select assignment.classroom_id into v_classroom_id
  from public.assignment_docs document
  join public.assignments assignment on assignment.id = document.assignment_id
  where document.id = new.assignment_doc_id and document.student_id = new.student_id;
  perform public.managed_storage_exact_lock(
    v_object.storage_bucket, v_object.storage_path
  );
  v_storage_present := exists (
    select 1 from storage.objects object
    where object.bucket_id = v_object.storage_bucket
      and object.name = v_object.storage_path
  );
  if (
      v_object.status not in ('verified', 'ready')
      and not (
        not v_enforced
        and v_object.status = 'cleanup_processing'
        and v_storage_present
      )
    )
    or v_object.storage_bucket <> 'assignment-artifacts'
    or v_object.storage_path <> new.storage_path
    or v_object.classroom_id is distinct from v_classroom_id
    or v_object.purpose <> 'student_assignment_artifact'
    or v_object.data_subject_user_id is distinct from new.student_id
    or v_object.resource_type is distinct from 'assignment_doc'
    or v_object.resource_id is distinct from new.assignment_doc_id
  then
    raise exception using errcode = '55000', message = 'assignment_artifact_managed_owner_mismatch';
  end if;
  if v_object.status = 'verified' then
    perform public.managed_storage_mark_ready(v_object.id);
  end if;
  return new;
end;
$$;

create trigger assignment_artifact_managed_owner_guard
before insert or update of storage_path, managed_object_id
on public.assignment_submission_artifacts
for each row execute function public.validate_assignment_artifact_managed_owner();

create or replace function public.guard_archive_operation_managed_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enforced boolean;
  v_object public.managed_storage_objects;
begin
  v_enforced := public.lock_managed_storage_protocol();
  if new.storage_path is null then
    if new.managed_object_id is not null then
      raise exception using errcode = '55000', message = 'archive_operation_managed_path_required';
    end if;
    return new;
  end if;
  if new.managed_object_id is null and v_enforced then
    select * into v_object from public.managed_storage_objects object
    where object.storage_bucket = new.storage_bucket
      and object.storage_path = new.storage_path
    for key share;
    if not found then
      raise exception using errcode = '55000', message = 'archive_operation_managed_identity_required';
    end if;
    new.managed_object_id := v_object.id;
  end if;
  if new.managed_object_id is null then return new; end if;
  select * into v_object from public.managed_storage_objects
  where id = new.managed_object_id for key share;
  if not found or v_object.classroom_id is distinct from new.classroom_id
    or v_object.storage_bucket is distinct from new.storage_bucket
    or v_object.storage_path is distinct from new.storage_path
  then
    raise exception using errcode = '55000', message = 'archive_operation_managed_owner_mismatch';
  end if;
  return new;
end;
$$;

drop trigger archive_operation_managed_owner_guard
on public.classroom_archive_operations;
create trigger archive_operation_managed_owner_guard
before insert or update of storage_bucket, storage_path, managed_object_id
on public.classroom_archive_operations
for each row execute function public.guard_archive_operation_managed_owner();

create or replace function public.prepare_immutable_operational_managed_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enforced boolean;
  v_object public.managed_storage_objects;
  v_operation public.classroom_archive_operations;
  v_purpose text;
begin
  v_enforced := public.lock_managed_storage_protocol();
  v_purpose := case tg_table_name
    when 'classroom_archives' then 'classroom_archive'
    when 'classroom_gradex_extracts' then 'gradex_extract'
  end;
  select * into v_operation from public.classroom_archive_operations
  where id = new.operation_id for update;
  if not found then
    raise exception using errcode = '55000', message = 'operational_managed_identity_required';
  end if;
  if v_operation.managed_object_id is null then
    if new.managed_object_id is not null then
      raise exception using errcode = '55000', message = 'operational_managed_owner_mismatch';
    end if;
    if v_enforced then
      raise exception using errcode = '55000', message = 'operational_managed_identity_required';
    end if;
    return new;
  end if;
  select * into v_object from public.managed_storage_objects
  where id = v_operation.managed_object_id for update;
  if not found or v_object.status not in ('verified', 'ready')
    or v_object.classroom_id is distinct from new.classroom_id
    or v_object.storage_bucket is distinct from new.storage_bucket
    or v_object.storage_path is distinct from new.storage_path
    or v_object.purpose is distinct from v_purpose
    or v_object.resource_type is distinct from 'classroom_archive_operation'
    or v_object.resource_id is distinct from new.operation_id
  then
    raise exception using errcode = '55000', message = 'operational_managed_owner_mismatch';
  end if;
  new.managed_object_id := v_object.id;
  if v_object.status = 'verified' then
    perform public.managed_storage_mark_ready(v_object.id);
  end if;
  return new;
end;
$$;

create trigger classroom_archives_prepare_managed_owner
before insert on public.classroom_archives
for each row execute function public.prepare_immutable_operational_managed_owner();
create trigger classroom_gradex_extracts_prepare_managed_owner
before insert on public.classroom_gradex_extracts
for each row execute function public.prepare_immutable_operational_managed_owner();

create or replace function public.guard_managed_storage_ledger_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_enforced boolean;
  v_object public.managed_storage_objects;
  v_bucket text;
  v_path text;
  v_classroom_id uuid;
begin
  v_enforced := public.lock_managed_storage_protocol();
  v_bucket := case
    when tg_table_name = 'assignment_artifact_storage_cleanup' then 'assignment-artifacts'
    when tg_table_name = 'test_document_snapshot_storage_cleanup' then 'test-documents'
    else nullif(v_new->>'storage_bucket', '')
  end;
  v_path := nullif(v_new->>'storage_path', '');
  if new.managed_object_id is null then
    select * into v_object from public.managed_storage_objects object
    where object.storage_bucket = v_bucket and object.storage_path = v_path
    for key share;
    if found then
      new.managed_object_id := v_object.id;
    elsif v_enforced then
      raise exception using errcode = '55000', message = 'managed_storage_ledger_identity_required';
    else
      return new;
    end if;
  end if;
  select * into v_object from public.managed_storage_objects
  where id = new.managed_object_id for key share;
  if not found or v_object.storage_bucket is distinct from v_bucket
    or v_object.storage_path is distinct from v_path
  then
    raise exception using errcode = '55000', message = 'managed_storage_ledger_identity_mismatch';
  end if;
  if tg_table_name in (
    'classroom_archive_object_upload_cleanup',
    'classroom_archive_restore_expected_objects',
    'classroom_archive_source_object_cleanup',
    'classroom_gradex_extract_cleanup'
  ) then
    if tg_table_name = 'classroom_archive_source_object_cleanup' then
      v_classroom_id := nullif(v_new->>'classroom_id', '')::uuid;
    else
      select operation.classroom_id into v_classroom_id
      from public.classroom_archive_operations operation
      where operation.id = nullif(v_new->>'operation_id', '')::uuid;
    end if;
    if v_classroom_id is null
      or v_object.classroom_id is distinct from v_classroom_id
    then
      raise exception using errcode = '55000', message = 'managed_storage_ledger_owner_mismatch';
    end if;
  end if;
  return new;
end;
$$;

drop trigger assignment_artifact_cleanup_managed_guard
on public.assignment_artifact_storage_cleanup;
create trigger assignment_artifact_cleanup_managed_guard
before insert or update of storage_path, managed_object_id
on public.assignment_artifact_storage_cleanup
for each row execute function public.guard_managed_storage_ledger_reference();
drop trigger test_document_cleanup_managed_guard
on public.test_document_snapshot_storage_cleanup;
create trigger test_document_cleanup_managed_guard
before insert or update of storage_path, managed_object_id
on public.test_document_snapshot_storage_cleanup
for each row execute function public.guard_managed_storage_ledger_reference();
drop trigger archive_upload_cleanup_managed_guard
on public.classroom_archive_object_upload_cleanup;
create trigger archive_upload_cleanup_managed_guard
before insert or update of storage_bucket, storage_path, managed_object_id
on public.classroom_archive_object_upload_cleanup
for each row execute function public.guard_managed_storage_ledger_reference();
drop trigger archive_restore_expected_managed_guard
on public.classroom_archive_restore_expected_objects;
create trigger archive_restore_expected_managed_guard
before insert or update of storage_bucket, storage_path, managed_object_id
on public.classroom_archive_restore_expected_objects
for each row execute function public.guard_managed_storage_ledger_reference();
drop trigger archive_source_cleanup_managed_guard
on public.classroom_archive_source_object_cleanup;
create trigger archive_source_cleanup_managed_guard
before insert or update of storage_bucket, storage_path, managed_object_id
on public.classroom_archive_source_object_cleanup
for each row execute function public.guard_managed_storage_ledger_reference();
drop trigger gradex_cleanup_managed_guard
on public.classroom_gradex_extract_cleanup;
create trigger gradex_cleanup_managed_guard
before insert or update of storage_bucket, storage_path, managed_object_id
on public.classroom_gradex_extract_cleanup
for each row execute function public.guard_managed_storage_ledger_reference();

create or replace function public.enforce_managed_storage_object_write()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_enforced boolean;
  v_object public.managed_storage_objects;
begin
  if new.bucket_id not in (
    'assignment-artifacts', 'submission-images', 'test-documents',
    'classroom-archives', 'gradex-analytics-extracts'
  ) then return new; end if;
  v_enforced := public.lock_managed_storage_protocol();
  select * into v_object from public.managed_storage_objects
  where storage_bucket = new.bucket_id and storage_path = new.name
  for update;
  perform public.managed_storage_exact_lock(new.bucket_id, new.name);
  if not v_enforced then
    if v_object.id is not null
      and v_object.status in ('cleanup_pending', 'cleanup_processing', 'deleted')
    then
      raise exception using errcode = '55000', message = 'managed_storage_cleanup_in_progress';
    end if;
    return new;
  end if;
  if v_object.id is null
    or v_object.status not in ('reserved', 'verified', 'ready')
  then
    raise exception using errcode = '55000', message = 'managed_storage_reservation_required';
  end if;
  if tg_op = 'UPDATE' and (old.bucket_id, old.name) is distinct from (new.bucket_id, new.name) then
    raise exception using errcode = '55000', message = 'managed_storage_identity_immutable';
  end if;
  return new;
end;
$$;

create trigger enforce_managed_storage_object_write
before insert or update on storage.objects
for each row execute function public.enforce_managed_storage_object_write();

create or replace function public.enforce_managed_storage_object_delete()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_enforced boolean;
  v_object public.managed_storage_objects;
  v_referenced boolean;
begin
  if old.bucket_id not in (
    'assignment-artifacts', 'submission-images', 'test-documents',
    'classroom-archives', 'gradex-analytics-extracts'
  ) then return old; end if;
  v_enforced := public.lock_managed_storage_protocol();
  select * into v_object from public.managed_storage_objects object
  where object.storage_bucket = old.bucket_id
    and object.storage_path = old.name
  for update;
  perform public.managed_storage_exact_lock(old.bucket_id, old.name);
  if v_object.id is null then
    if not v_enforced then return old; end if;
    raise exception using errcode = '55000', message = 'managed_storage_cleanup_authority_required';
  end if;
  if v_object.status <> 'cleanup_processing' then
    raise exception using errcode = '55000', message = 'managed_storage_cleanup_authority_required';
  end if;
  v_referenced := public.managed_storage_object_is_referenced(v_object.id)
    or case v_object.storage_bucket
      when 'assignment-artifacts' then exists (
        select 1 from public.assignment_submission_artifacts reference
        where reference.storage_path = v_object.storage_path
      )
      when 'test-documents' then
        public.test_document_snapshot_path_is_referenced(v_object.storage_path)
      else false
    end;
  if v_referenced then
    raise exception using errcode = '55000', message = 'managed_storage_cleanup_referenced';
  end if;
  return old;
end;
$$;

create trigger enforce_managed_storage_object_delete
before delete on storage.objects
for each row execute function public.enforce_managed_storage_object_delete();

create or replace function public.queue_managed_storage_cleanup(
  p_object_id uuid,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_object public.managed_storage_objects;
begin
  perform public.lock_managed_storage_protocol();
  select * into v_object from public.managed_storage_objects
  where id = p_object_id for update;
  if not found then return false; end if;
  if v_object.status = 'deleted' then return false; end if;
  if v_object.status = 'cleanup_processing'
    and v_object.lease_expires_at > clock_timestamp()
  then return false; end if;
  perform public.managed_storage_exact_lock(v_object.storage_bucket, v_object.storage_path);
  if public.managed_storage_object_is_referenced(v_object.id) then return false; end if;
  update public.managed_storage_objects
  set status = 'cleanup_pending', cleanup_reason_code = coalesce(nullif(btrim(p_error_code), ''), 'unattached'),
      next_attempt_at = clock_timestamp(), lease_token = null,
      lease_expires_at = null, updated_at = clock_timestamp()
  where id = v_object.id;
  return true;
end;
$$;

create or replace function public.claim_managed_storage_cleanup(
  p_lease_token uuid,
  p_limit integer default 10,
  p_lease_seconds integer default 120
)
returns setof public.managed_storage_objects
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_object public.managed_storage_objects;
begin
  if p_lease_token is null or p_limit not between 1 and 25
    or p_lease_seconds not between 15 and 300
  then
    raise exception using errcode = '22023', message = 'managed_storage_cleanup_claim_invalid';
  end if;
  if not public.lock_managed_storage_protocol() then
    raise exception using errcode = '55000', message = 'managed_storage_cleanup_requires_enforcement';
  end if;
  update public.managed_storage_objects
  set status = 'cleanup_pending', cleanup_reason_code = coalesce(cleanup_reason_code, 'reservation_expired'),
      next_attempt_at = clock_timestamp(), updated_at = clock_timestamp()
  where status in ('reserved', 'verified')
    and reservation_expires_at <= clock_timestamp()
    and not public.managed_storage_object_is_referenced(id);

  for v_id in
    select id from public.managed_storage_objects
    where (status = 'cleanup_pending' and next_attempt_at <= clock_timestamp())
      or (status = 'cleanup_processing' and lease_expires_at <= clock_timestamp())
    order by next_attempt_at, created_at
    for update skip locked limit p_limit
  loop
    select * into v_object from public.managed_storage_objects where id = v_id for update;
    if public.managed_storage_object_is_referenced(v_id) then continue; end if;
    perform public.managed_storage_exact_lock(v_object.storage_bucket, v_object.storage_path);
    update public.managed_storage_objects
    set status = 'cleanup_processing', lease_token = p_lease_token,
        lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
        attempt_count = attempt_count + 1, updated_at = clock_timestamp()
    where id = v_id returning * into v_object;
    return next v_object;
  end loop;
end;
$$;

create or replace function public.complete_managed_storage_cleanup(
  p_object_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_object public.managed_storage_objects;
begin
  perform public.lock_managed_storage_protocol();
  select * into v_object from public.managed_storage_objects
  where id = p_object_id for update;
  if not found then return true; end if;
  if v_object.status = 'deleted' then return true; end if;
  if v_object.status <> 'cleanup_processing' or v_object.lease_token <> p_lease_token then
    return false;
  end if;
  perform public.managed_storage_exact_lock(v_object.storage_bucket, v_object.storage_path);
  if public.managed_storage_object_is_referenced(v_object.id) then
    raise exception using errcode = '55000', message = 'managed_storage_cleanup_referenced';
  end if;
  if exists (select 1 from storage.objects object
    where object.bucket_id = v_object.storage_bucket and object.name = v_object.storage_path)
  then
    raise exception using errcode = '55000', message = 'managed_storage_cleanup_not_absent';
  end if;
  update public.managed_storage_objects
  set status = 'deleted', deleted_at = clock_timestamp(),
      lease_token = null, lease_expires_at = null,
      reservation_expires_at = null, updated_at = clock_timestamp()
  where id = v_object.id;
  return true;
end;
$$;

create or replace function public.fail_managed_storage_cleanup(
  p_object_id uuid,
  p_lease_token uuid,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.lock_managed_storage_protocol();
  update public.managed_storage_objects
  set status = 'cleanup_pending', lease_token = null, lease_expires_at = null,
      last_error_code = coalesce(nullif(btrim(p_error_code), ''), 'cleanup_failed'),
      next_attempt_at = clock_timestamp()
        + least(interval '6 hours', make_interval(secs => (30 * power(2, least(attempt_count, 10)))::integer)),
      updated_at = clock_timestamp()
  where id = p_object_id and status = 'cleanup_processing'
    and lease_token = p_lease_token;
  return found;
end;
$$;

create or replace function public.sync_operational_managed_cleanup_lease()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := to_jsonb(old);
  v_object public.managed_storage_objects;
  v_object_id uuid;
  v_bucket text;
  v_path text;
  v_error_code text;
  v_enforced boolean;
  v_referenced boolean;
begin
  v_enforced := public.lock_managed_storage_protocol();
  begin
    v_object_id := nullif(v_new->>'managed_object_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'managed_storage_cleanup_identity_invalid';
  end;
  if v_object_id is null then
    if not v_enforced then return new; end if;
    raise exception using errcode = '55000', message = 'managed_storage_cleanup_identity_required';
  end if;
  v_bucket := coalesce(
    nullif(v_new->>'storage_bucket', ''),
    case tg_table_name
      when 'assignment_artifact_storage_cleanup' then 'assignment-artifacts'
      when 'test_document_snapshot_storage_cleanup' then 'test-documents'
    end
  );
  v_path := nullif(v_new->>'storage_path', '');
  select * into strict v_object from public.managed_storage_objects
  where id = v_object_id and storage_bucket = v_bucket and storage_path = v_path
  for update;
  perform public.managed_storage_exact_lock(v_bucket, v_path);

  if v_new->>'status' = 'processing' then
    if v_object.status = 'deleted' then return new; end if;
    v_referenced := public.managed_storage_object_is_referenced(v_object.id)
      or case tg_table_name
        when 'assignment_artifact_storage_cleanup' then exists (
          select 1 from public.assignment_submission_artifacts reference
          where reference.storage_path = v_path
        )
        when 'test_document_snapshot_storage_cleanup' then
          public.test_document_snapshot_path_is_referenced(v_path)
        else false
      end;
    if v_referenced then
      raise exception using errcode = '55000', message = 'managed_storage_cleanup_referenced';
    end if;
    if v_object.status = 'cleanup_processing'
      and v_object.lease_token is distinct from nullif(v_new->>'lease_token', '')::uuid
      and v_object.lease_expires_at > clock_timestamp()
    then
      raise exception using errcode = '55000', message = 'managed_storage_cleanup_competing_claim';
    end if;
    update public.managed_storage_objects
    set status = 'cleanup_processing',
        lease_token = nullif(v_new->>'lease_token', '')::uuid,
        lease_expires_at = nullif(v_new->>'lease_expires_at', '')::timestamptz,
        attempt_count = attempt_count + case
          when v_old->>'status' <> 'processing' then 1
          when nullif(v_old->>'lease_token', '')::uuid is distinct from
            nullif(v_new->>'lease_token', '')::uuid then 1
          else 0
        end,
        updated_at = clock_timestamp()
    where id = v_object.id;
  elsif v_old->>'status' = 'processing' and v_new->>'status' in ('pending', 'failed') then
    v_error_code := coalesce(
      nullif(v_new->>'last_error_code', ''),
      nullif(v_new->>'last_error', ''),
      'operational_cleanup_failed'
    );
    update public.managed_storage_objects
    set status = 'cleanup_pending', lease_token = null, lease_expires_at = null,
        last_error_code = left(v_error_code, 80),
        next_attempt_at = coalesce(
          nullif(v_new->>'next_attempt_at', '')::timestamptz,
          clock_timestamp()
        ),
        updated_at = clock_timestamp()
    where id = v_object.id and status = 'cleanup_processing'
      and lease_token = nullif(v_old->>'lease_token', '')::uuid;
  elsif v_old->>'status' = 'processing' and v_new->>'status' = 'deleted' then
    if exists (
      select 1 from storage.objects object
      where object.bucket_id = v_bucket and object.name = v_path
    ) then
      raise exception using errcode = '55000', message = 'managed_storage_cleanup_not_absent';
    end if;
    update public.managed_storage_objects
    set status = 'deleted', deleted_at = clock_timestamp(),
        lease_token = null, lease_expires_at = null,
        reservation_expires_at = null, updated_at = clock_timestamp()
    where id = v_object.id and (
      status = 'deleted'
      or (status = 'cleanup_processing'
        and lease_token = nullif(v_old->>'lease_token', '')::uuid)
    );
    if not found then
      raise exception using errcode = '55000', message = 'managed_storage_cleanup_lease_lost';
    end if;
  end if;
  return new;
exception when no_data_found then
  raise exception using errcode = '55000', message = 'managed_storage_cleanup_identity_mismatch';
end;
$$;

create trigger assignment_artifact_managed_cleanup_lease
before update of status, lease_token, lease_expires_at
on public.assignment_artifact_storage_cleanup
for each row execute function public.sync_operational_managed_cleanup_lease();
create trigger test_document_managed_cleanup_lease
before update of status, lease_token, lease_expires_at
on public.test_document_snapshot_storage_cleanup
for each row execute function public.sync_operational_managed_cleanup_lease();
create trigger archive_upload_managed_cleanup_lease
before update of status, lease_token, lease_expires_at
on public.classroom_archive_object_upload_cleanup
for each row execute function public.sync_operational_managed_cleanup_lease();
create trigger archive_source_managed_cleanup_lease
before update of status, lease_token, lease_expires_at
on public.classroom_archive_source_object_cleanup
for each row execute function public.sync_operational_managed_cleanup_lease();
create trigger gradex_managed_cleanup_lease
before update of status, lease_token, lease_expires_at
on public.classroom_gradex_extract_cleanup
for each row execute function public.sync_operational_managed_cleanup_lease();

create or replace function public.complete_deleted_operational_managed_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_object public.managed_storage_objects;
  v_object_id uuid;
  v_bucket text;
  v_path text;
  v_enforced boolean;
  v_referenced boolean;
  v_storage_present boolean;
begin
  if v_old->>'status' <> 'processing' then return old; end if;
  v_enforced := public.lock_managed_storage_protocol();
  v_object_id := nullif(v_old->>'managed_object_id', '')::uuid;
  if v_object_id is null then
    if not v_enforced then return old; end if;
    raise exception using errcode = '55000', message = 'managed_storage_cleanup_identity_required';
  end if;
  v_bucket := case tg_table_name
    when 'assignment_artifact_storage_cleanup' then 'assignment-artifacts'
    when 'test_document_snapshot_storage_cleanup' then 'test-documents'
  end;
  v_path := v_old->>'storage_path';
  select * into v_object from public.managed_storage_objects object
  where object.id = v_object_id
    and object.storage_bucket = v_bucket
    and object.storage_path = v_path
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'managed_storage_cleanup_identity_mismatch';
  end if;
  perform public.managed_storage_exact_lock(v_bucket, v_path);
  v_referenced := public.managed_storage_object_is_referenced(v_object_id)
    or case tg_table_name
      when 'assignment_artifact_storage_cleanup' then exists (
        select 1 from public.assignment_submission_artifacts reference
        where reference.storage_path = v_path
      )
      when 'test_document_snapshot_storage_cleanup' then
        public.test_document_snapshot_path_is_referenced(v_path)
      else false
    end;
  v_storage_present := exists (
    select 1 from storage.objects object
    where object.bucket_id = v_bucket and object.name = v_path
  );
  if v_storage_present and v_referenced then
    update public.managed_storage_objects
    set status = 'ready', verified_at = coalesce(verified_at, clock_timestamp()),
        ready_at = coalesce(ready_at, clock_timestamp()),
        cleanup_reason_code = null, next_attempt_at = clock_timestamp(),
        lease_token = null, lease_expires_at = null, last_error_code = null,
        reservation_expires_at = null, deleted_at = null,
        updated_at = clock_timestamp()
    where id = v_object_id and storage_bucket = v_bucket and storage_path = v_path
      and status = 'cleanup_processing'
      and lease_token = nullif(v_old->>'lease_token', '')::uuid;
    if not found then
      raise exception using errcode = '55000', message = 'managed_storage_cleanup_lease_lost';
    end if;
    return old;
  elsif v_storage_present then
    raise exception using errcode = '55000', message = 'managed_storage_cleanup_not_absent';
  elsif v_referenced then
    raise exception using errcode = '55000', message = 'managed_storage_cleanup_referenced_missing';
  end if;
  update public.managed_storage_objects
  set status = 'deleted', deleted_at = coalesce(deleted_at, clock_timestamp()),
      lease_token = null, lease_expires_at = null,
      reservation_expires_at = null, updated_at = clock_timestamp()
  where id = v_object_id and storage_bucket = v_bucket and storage_path = v_path
    and (
      status = 'deleted'
      or (status = 'cleanup_processing'
        and lease_token = nullif(v_old->>'lease_token', '')::uuid)
    );
  if not found then
    raise exception using errcode = '55000', message = 'managed_storage_cleanup_lease_lost';
  end if;
  return old;
end;
$$;

create trigger assignment_artifact_managed_cleanup_complete
before delete on public.assignment_artifact_storage_cleanup
for each row execute function public.complete_deleted_operational_managed_cleanup();
create trigger test_document_managed_cleanup_complete
before delete on public.test_document_snapshot_storage_cleanup
for each row execute function public.complete_deleted_operational_managed_cleanup();

create or replace function public.activate_managed_storage_enforcement(
  p_generation bigint,
  p_inventory_digest text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.managed_storage_settings;
  v_writer_revision bigint;
begin
  select * into strict v_settings from public.managed_storage_settings
  where singleton for update;
  select last_value into v_writer_revision from public.managed_storage_writer_revision_seq;
  if v_settings.readiness_generation is distinct from p_generation
    or v_settings.readiness_digest is distinct from p_inventory_digest
    or v_settings.readiness_verified_at is null
    or v_settings.readiness_writer_revision is distinct from v_writer_revision
    or not exists (
      select 1 from public.managed_storage_readiness_runs run
      where run.generation = p_generation and run.status = 'ready'
        and run.inventory_digest = p_inventory_digest
        and run.writer_revision = v_writer_revision
    )
  then
    raise exception using errcode = '55000', message = 'managed_storage_readiness_stale';
  end if;
  update public.managed_storage_settings
  set mode = 'enforced', activated_at = clock_timestamp(), updated_at = clock_timestamp()
  where singleton;
  return true;
end;
$$;

create or replace function public.pause_managed_storage_enforcement()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.managed_storage_settings
  set mode = 'compatibility', activated_at = null, readiness_digest = null,
      readiness_verified_at = null, readiness_writer_revision = null,
      readiness_generation = readiness_generation + 1,
      updated_at = clock_timestamp()
  where singleton;
  return true;
end;
$$;

revoke all on function public.queue_managed_storage_cleanup(uuid, text)
  from public, anon, authenticated;
revoke all on function public.claim_managed_storage_cleanup(uuid, integer, integer)
  from public, anon, authenticated;
revoke all on function public.complete_managed_storage_cleanup(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.fail_managed_storage_cleanup(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.activate_managed_storage_enforcement(bigint, text)
  from public, anon, authenticated;
revoke all on function public.pause_managed_storage_enforcement()
  from public, anon, authenticated;
grant execute on function public.queue_managed_storage_cleanup(uuid, text)
  to service_role;
grant execute on function public.claim_managed_storage_cleanup(uuid, integer, integer)
  to service_role;
grant execute on function public.complete_managed_storage_cleanup(uuid, uuid)
  to service_role;
grant execute on function public.fail_managed_storage_cleanup(uuid, uuid, text)
  to service_role;
grant execute on function public.activate_managed_storage_enforcement(bigint, text)
  to service_role;
grant execute on function public.pause_managed_storage_enforcement()
  to service_role;

-- Cleanup ledgers record work; they are not live references. Durable content
-- and operational metadata are the references that keep an object ready.
create or replace function public.managed_storage_object_is_referenced(p_object_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    exists (select 1 from public.assignment_submission_artifacts where managed_object_id = p_object_id)
    or exists (select 1 from public.managed_storage_json_references where managed_object_id = p_object_id)
    or exists (select 1 from public.classroom_archives where managed_object_id = p_object_id)
    or exists (
      select 1 from public.classroom_archive_restore_expected_objects expected
      join public.classroom_archive_operations operation on operation.id = expected.operation_id
      where expected.managed_object_id = p_object_id
        and operation.status = 'snapshot_ready'
        and operation.snapshot_expires_at > clock_timestamp()
    )
    or exists (select 1 from public.classroom_gradex_extracts where managed_object_id = p_object_id)
$$;

create or replace function public.queue_compacted_managed_storage_objects()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_object_id uuid;
begin
  if new.operation_type <> 'compact' or new.status <> 'completed'
    or old.status = 'completed'
  then return new; end if;
  for v_object_id in
    select distinct managed_object_id
    from public.classroom_archive_source_object_cleanup
    where operation_id = new.id and managed_object_id is not null
  loop
    perform public.queue_managed_storage_cleanup(
      v_object_id, 'classroom_archive_compaction_source_removed'
    );
  end loop;
  return new;
end;
$$;

create trigger queue_compacted_managed_storage_objects
after update of status on public.classroom_archive_operations
for each row execute function public.queue_compacted_managed_storage_objects();

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
    or public.is_classroom_archive_maintenance_mode('compaction')
  then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  insert into public.assignment_artifact_storage_cleanup as existing_cleanup (
    storage_path, managed_object_id, status, attempt_count, next_attempt_at,
    lease_token, lease_expires_at, last_error, updated_at
  ) values (
    old.storage_path, old.managed_object_id, 'pending', 0, clock_timestamp(),
    null, null, null, clock_timestamp()
  )
  on conflict (storage_path) do update
  set managed_object_id = coalesce(existing_cleanup.managed_object_id, excluded.managed_object_id),
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

create or replace function public.enqueue_obsolete_test_document_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_archived_at timestamptz;
  v_new_documents jsonb;
  v_document jsonb;
  v_object_id uuid;
begin
  if tg_op = 'DELETE' then
    select archived_at into v_archived_at from public.classrooms where id = old.classroom_id;
    if not found or v_archived_at is not null then return old; end if;
    v_new_documents := '[]'::jsonb;
  else
    v_new_documents := coalesce(new.documents, '[]'::jsonb);
  end if;
  for v_document in
    select value from jsonb_array_elements(coalesce(old.documents, '[]'::jsonb))
  loop
    if nullif(v_document->>'snapshot_path', '') is null
      or exists (
        select 1 from jsonb_array_elements(v_new_documents) current_document(value)
        where current_document.value->>'snapshot_path' = v_document->>'snapshot_path'
      )
    then continue; end if;
    begin
      v_object_id := nullif(v_document->>'snapshot_managed_object_id', '')::uuid;
    exception when invalid_text_representation then
      v_object_id := null;
    end;
    insert into public.test_document_snapshot_storage_cleanup as existing_cleanup (
      storage_path, managed_object_id, status, attempt_count, next_attempt_at,
      lease_token, lease_expires_at, last_error, updated_at
    ) values (
      v_document->>'snapshot_path', v_object_id, 'pending', 0, clock_timestamp(),
      null, null, null, clock_timestamp()
    ) on conflict (storage_path) do update
    set managed_object_id = coalesce(existing_cleanup.managed_object_id, excluded.managed_object_id),
        status = 'pending', next_attempt_at = clock_timestamp(),
        lease_token = null, lease_expires_at = null, last_error = null,
        updated_at = clock_timestamp()
    where existing_cleanup.status <> 'processing'
      or existing_cleanup.lease_expires_at <= clock_timestamp();
    if v_object_id is not null then
      perform public.queue_managed_storage_cleanup(
        v_object_id, 'test_snapshot_reference_removed'
      );
    end if;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Migration 096's reservation fence predates the compactor's rollback-only
-- delete/restore rehearsal. The rehearsal must be able to reinsert the exact
-- staged source row, while every real writer remains fenced.
create or replace function public.reject_reserved_assignment_artifact_path()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  if public.is_classroom_archive_maintenance_mode('compaction')
    and public.is_classroom_archive_maintenance_mode('restore')
  then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  for v_path in
    select distinct candidate.path
    from (values
      (case when tg_op <> 'INSERT' then old.storage_path end),
      (case when tg_op <> 'DELETE' then new.storage_path end)
    ) as candidate(path)
    where candidate.path is not null
    order by candidate.path
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(jsonb_build_array('assignment-artifacts', v_path)::text, 0)
    );
  end loop;
  if tg_op <> 'DELETE'
    and new.storage_path is not null
    and exists (
      select 1
      from public.classroom_archive_source_object_reservations reservation
      where reservation.storage_bucket = 'assignment-artifacts'
        and reservation.storage_path_sha256 =
          public.classroom_archive_source_object_path_sha256(
            'assignment-artifacts', new.storage_path
          )
    )
  then
    raise exception 'Assignment artifact storage path is reserved by a classroom archive'
      using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Deliberately absent: scheduler registration, purge gates, purge workers,
-- classroom deletion routes, and deletion UX.
