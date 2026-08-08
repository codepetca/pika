-- Durable permanent deletion for teacher-owned Pika-managed Course Blueprints.
--
-- This operation is intentionally separate from Classroom purge. It consumes
-- the migration-117 managed-object authority, deletes only exact Blueprint-
-- owned test documents, preserves linked Classrooms and users, and starts
-- disabled. Applying this migration does not enable Blueprint deletion.

create table public.course_blueprint_purge_settings (
  singleton boolean primary key default true check (singleton),
  rollout_mode text not null default 'disabled'
    check (rollout_mode in ('disabled', 'canary', 'enabled')),
  canary_teacher_id uuid references public.users (id) on delete restrict,
  canary_blueprint_id uuid,
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (rollout_mode = 'canary' and canary_teacher_id is not null
      and canary_blueprint_id is not null)
    or (rollout_mode <> 'canary' and canary_teacher_id is null
      and canary_blueprint_id is null)
  )
);

insert into public.course_blueprint_purge_settings (singleton) values (true);
alter table public.course_blueprint_purge_settings enable row level security;
revoke all on table public.course_blueprint_purge_settings
  from public, anon, authenticated, service_role;
grant select on table public.course_blueprint_purge_settings to service_role;

create table public.course_blueprint_purge_operations (
  id uuid primary key,
  course_blueprint_id uuid not null,
  teacher_id uuid not null references public.users (id) on delete restrict,
  course_blueprint_title text,
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  inventory_sha256 text not null check (inventory_sha256 ~ '^[a-f0-9]{64}$'),
  finalization_sha256 text not null check (finalization_sha256 ~ '^[a-f0-9]{64}$'),
  source_revision bigint not null check (source_revision > 0),
  status text not null check (status in (
    'inventorying', 'deleting_objects', 'finalizing', 'completed', 'failed'
  )),
  retryable boolean,
  impact_summary jsonb not null default '{}'::jsonb,
  resource_counts jsonb not null default '{}'::jsonb,
  storage_object_count integer not null default 0 check (storage_object_count >= 0),
  error_code text,
  attempt_count integer not null default 1 check (attempt_count > 0),
  started_at timestamptz not null default clock_timestamp(),
  inventory_completed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  check ((status = 'completed') = (completed_at is not null))
);

create unique index course_blueprint_purge_one_active
  on public.course_blueprint_purge_operations (course_blueprint_id)
  where status <> 'completed';
create index course_blueprint_purge_teacher_started
  on public.course_blueprint_purge_operations (teacher_id, started_at desc);

create table public.course_blueprint_purge_fences (
  course_blueprint_id uuid primary key,
  operation_id uuid not null unique
    references public.course_blueprint_purge_operations (id) on delete cascade,
  installed_at timestamptz not null default clock_timestamp()
);

create table public.course_blueprint_purge_objects (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null
    references public.course_blueprint_purge_operations (id) on delete cascade,
  managed_storage_object_id uuid not null,
  storage_bucket text not null check (storage_bucket = 'test-documents'),
  storage_path text,
  storage_path_sha256 text not null check (storage_path_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('pending', 'processing', 'failed', 'deleted')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  deleted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (operation_id, managed_storage_object_id),
  unique (storage_bucket, storage_path_sha256),
  check (
    (status = 'processing' and lease_token is not null and lease_expires_at is not null)
    or (status <> 'processing' and lease_token is null and lease_expires_at is null)
  ),
  check ((status = 'deleted') = (deleted_at is not null)),
  check (storage_path is not null or status = 'deleted')
);

create index course_blueprint_purge_objects_due
  on public.course_blueprint_purge_objects (operation_id, next_attempt_at, created_at)
  where status in ('pending', 'processing', 'failed');

alter table public.course_blueprint_purge_operations enable row level security;
alter table public.course_blueprint_purge_fences enable row level security;
alter table public.course_blueprint_purge_objects enable row level security;
revoke all on table public.course_blueprint_purge_operations,
  public.course_blueprint_purge_fences,
  public.course_blueprint_purge_objects
  from public, anon, authenticated, service_role;
grant select on table public.course_blueprint_purge_operations,
  public.course_blueprint_purge_objects to service_role;

-- Copy intents identify the source Blueprint before any provider-side copy is
-- attempted. Every unclosed intent is a durable purge fence; expires_at is
-- liveness/diagnostic metadata and never deletion authority.
alter table public.managed_storage_provisional_owners
  add column source_course_blueprint_id uuid
    references public.course_blueprints (id) on delete set null,
  add column copy_closed_at timestamptz,
  add column copy_close_reason text
    check (copy_close_reason in ('adopted', 'aborted', 'recovered')),
  add constraint managed_storage_blueprint_copy_close_shape check (
    (copy_closed_at is null and copy_close_reason is null)
    or (copy_closed_at is not null and copy_close_reason is not null)
  );
create index managed_storage_provisional_source_blueprint
  on public.managed_storage_provisional_owners
    (source_course_blueprint_id, adopted_at, copy_closed_at)
  where source_course_blueprint_id is not null;

-- Application code may have completed a Blueprint instantiation through the
-- migration-117 compatibility owner before this source-aware fence existed.
-- Bind and close only owners whose durable completed operation proves the
-- exact source Blueprint and teacher.
update public.managed_storage_provisional_owners owner
set source_course_blueprint_id = operation.source_blueprint_id,
    copy_closed_at = coalesce(owner.adopted_at, clock_timestamp()),
    copy_close_reason = 'adopted'
from public.course_blueprint_operations operation
where owner.owner_kind = 'classroom_copy'
  and owner.operation_id = operation.id
  and owner.created_by_user_id = operation.teacher_id
  and owner.adopted_at is not null
  and owner.source_course_blueprint_id is null
  and operation.source_blueprint_id is not null
  and operation.status = 'completed'
  and exists (
    select 1 from public.course_blueprints blueprint
    where blueprint.id = operation.source_blueprint_id
      and blueprint.teacher_id = operation.teacher_id
  );

create or replace function public.course_blueprint_purge_lock(p_blueprint_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_blueprint_id is null then
    raise exception using errcode = '22023', message = 'course_blueprint_purge_owner_required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    jsonb_build_array('course_blueprint_purge', p_blueprint_id)::text, 0
  ));
end;
$$;

-- Finalization validates only the graph that deletion owns. Linked Classrooms
-- are intentionally excluded: they are preserved and may continue to change
-- after the teacher confirms deletion.
create or replace function public.course_blueprint_purge_membership_sha256(
  p_blueprint_id uuid
)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select encode(extensions.digest(
    convert_to(coalesce(string_agg(member, ',' order by member), ''), 'UTF8'),
    'sha256'), 'hex')
  from (
    select 'blueprint:' || blueprint.id || ':' || blueprint.content_revision member
    from public.course_blueprints blueprint where blueprint.id = p_blueprint_id
    union all select 'assignment:' || id from public.course_blueprint_assignments where course_blueprint_id = p_blueprint_id
    union all select 'assessment:' || id from public.course_blueprint_assessments where course_blueprint_id = p_blueprint_id
    union all select 'lesson:' || id from public.course_blueprint_lesson_templates where course_blueprint_id = p_blueprint_id
    union all select 'material:' || id from public.course_blueprint_materials where course_blueprint_id = p_blueprint_id
    union all select 'survey:' || id from public.course_blueprint_surveys where course_blueprint_id = p_blueprint_id
    union all select 'version:' || id from public.course_blueprint_versions where course_blueprint_id = p_blueprint_id
    union all select 'proposal:' || id from public.course_blueprint_change_proposals where course_blueprint_id = p_blueprint_id
    union all select 'session:' || id from public.course_blueprint_editing_sessions where course_blueprint_id = p_blueprint_id
    union all
    select 'object:' || object.id || ':' || object.storage_bucket || ':'
      || public.managed_storage_identity_sha256(object.storage_bucket, object.storage_path)
      || ':' || object.status
    from public.managed_storage_objects object
    where object.course_blueprint_id = p_blueprint_id
  ) purge_members;
$$;

create or replace function public.begin_course_blueprint_purge(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_course_blueprint_id uuid,
  p_request_sha256 text,
  p_impact_summary jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_operation public.course_blueprint_purge_operations;
  v_blueprint public.course_blueprints;
  v_inventory jsonb;
  v_conflict text;
  v_file_count integer;
  v_finalization_digest text;
begin
  if p_operation_id is null or p_teacher_id is null
    or p_course_blueprint_id is null
    or p_request_sha256 !~ '^[a-f0-9]{64}$'
    or p_impact_summary is null
    or jsonb_typeof(p_impact_summary) <> 'object'
    or not coalesce(p_impact_summary->>'source_revision' ~ '^[1-9][0-9]{0,17}$', false)
    or not coalesce(p_impact_summary->>'inventory_sha256' ~ '^[a-f0-9]{64}$', false)
  then
    raise exception using errcode = '22023',
      message = 'invalid_course_blueprint_purge_request';
  end if;

  if not public.lock_managed_storage_protocol() then
    return jsonb_build_object(
      'ok', false, 'status', 503,
      'error_code', 'managed_storage_enforcement_required',
      'error', 'Managed storage ownership enforcement is not enabled'
    );
  end if;
  perform 1 from public.course_blueprint_purge_settings
  where singleton for share;

  select * into v_operation from public.course_blueprint_purge_operations
  where id = p_operation_id;
  if found and v_operation.status = 'completed' then
    if v_operation.teacher_id <> p_teacher_id
      or v_operation.course_blueprint_id <> p_course_blueprint_id
      or v_operation.request_sha256 <> p_request_sha256
    then
      return jsonb_build_object(
        'ok', false, 'status', 409, 'error_code', 'idempotency_conflict',
        'error', 'Idempotency key was already used for a different deletion request'
      );
    end if;
    return jsonb_build_object(
      'ok', true, 'status', 200, 'operation_id', p_operation_id,
      'operation_status', 'completed', 'replayed', true
    );
  end if;

  perform public.course_blueprint_purge_lock(p_course_blueprint_id);
  select * into v_blueprint from public.course_blueprints blueprint
  where blueprint.id = p_course_blueprint_id
    and blueprint.teacher_id = p_teacher_id
  for update;
  if not found then
    return jsonb_build_object(
      'ok', false, 'status', 404,
      'error_code', 'course_blueprint_not_found',
      'error', 'Course Blueprint not found'
    );
  end if;
  if v_blueprint.authority_mode <> 'pika' then
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error_code', 'course_blueprint_repository_managed',
      'error', 'Switch to Pika as Editor before deleting this Course Blueprint'
    );
  end if;
  if not public.course_blueprint_purge_enabled(
    p_teacher_id, p_course_blueprint_id
  ) then
    return jsonb_build_object(
      'ok', false, 'status', 503,
      'error_code', 'course_blueprint_purge_disabled',
      'error', 'Permanent Course Blueprint deletion is not enabled'
    );
  end if;

  select * into v_operation from public.course_blueprint_purge_operations
  where id = p_operation_id for update;
  if found then
    if v_operation.teacher_id <> p_teacher_id
      or v_operation.course_blueprint_id <> p_course_blueprint_id
      or v_operation.request_sha256 <> p_request_sha256
    then
      return jsonb_build_object(
        'ok', false, 'status', 409, 'error_code', 'idempotency_conflict',
        'error', 'Idempotency key was already used for a different deletion request'
      );
    end if;
    if v_operation.status = 'failed' and v_operation.retryable is true then
      update public.course_blueprint_purge_operations
      set status = 'deleting_objects', retryable = null, error_code = null,
          attempt_count = attempt_count + 1, updated_at = clock_timestamp()
      where id = p_operation_id returning * into v_operation;
    end if;
    return jsonb_build_object(
      'ok', true, 'status', 202, 'operation_id', p_operation_id,
      'operation_status', v_operation.status, 'replayed', true
    );
  end if;

  -- Serialize the linked-Classroom lineage included in the confirmation
  -- digest. Its mutation triggers take the same Blueprint advisory lock, so a
  -- committed proposal/version change is visible before inventory is sealed.
  perform 1 from public.classrooms classroom
  where classroom.source_blueprint_id = p_course_blueprint_id
  order by classroom.id for update;
  perform 1 from public.managed_storage_objects object
  where object.course_blueprint_id = p_course_blueprint_id
  order by object.id for update;
  v_inventory := public.get_course_blueprint_purge_inventory(
    p_teacher_id, p_course_blueprint_id
  );
  if (v_inventory->>'source_revision')::bigint
      <> (p_impact_summary->>'source_revision')::bigint
    or v_inventory->>'inventory_sha256'
      <> p_impact_summary->>'inventory_sha256'
  then
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error_code', 'course_blueprint_purge_inventory_changed',
      'error', 'Course Blueprint data changed after the deletion impact was confirmed'
    );
  end if;
  v_finalization_digest := public.course_blueprint_purge_membership_sha256(
    p_course_blueprint_id
  );
  if (v_inventory->>'missing_file_count')::integer <> 0 then
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error_code', 'course_blueprint_purge_file_unverified',
      'error', 'One or more managed files could not be verified'
    );
  end if;
  v_conflict := public.course_blueprint_purge_conflict(p_course_blueprint_id);
  if v_conflict is not null then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', v_conflict,
      'error', 'Finish the active Course Blueprint operation before deleting permanently'
    );
  end if;
  if exists (
    select 1 from public.course_blueprint_purge_fences
    where course_blueprint_id = p_course_blueprint_id
  ) then
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error_code', 'course_blueprint_purge_active',
      'error', 'Permanent deletion is already active for this Course Blueprint'
    );
  end if;

  insert into public.course_blueprint_purge_operations (
    id, course_blueprint_id, teacher_id, course_blueprint_title,
    request_sha256, inventory_sha256, finalization_sha256,
    source_revision, status,
    impact_summary, resource_counts, storage_object_count
  ) values (
    p_operation_id, p_course_blueprint_id, p_teacher_id, v_blueprint.title,
    p_request_sha256, v_inventory->>'inventory_sha256',
    v_finalization_digest,
    (v_inventory->>'source_revision')::bigint, 'inventorying',
    p_impact_summary, v_inventory->'resource_counts',
    (v_inventory->>'managed_file_count')::integer
  );
  insert into public.course_blueprint_purge_fences (
    course_blueprint_id, operation_id
  ) values (p_course_blueprint_id, p_operation_id);
  insert into public.course_blueprint_purge_objects (
    operation_id, managed_storage_object_id, storage_bucket, storage_path,
    storage_path_sha256, status
  )
  select p_operation_id, object.id, object.storage_bucket, object.storage_path,
    public.managed_storage_identity_sha256(
      object.storage_bucket, object.storage_path
    ), 'pending'
  from public.managed_storage_objects object
  where object.course_blueprint_id = p_course_blueprint_id
  order by object.id;
  get diagnostics v_file_count = row_count;

  update public.course_blueprint_purge_operations
  set status = 'deleting_objects', storage_object_count = v_file_count,
      inventory_completed_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = p_operation_id;
  return jsonb_build_object(
    'ok', true, 'status', 202, 'operation_id', p_operation_id,
    'operation_status', 'deleting_objects',
    'source_revision', v_blueprint.content_revision,
    'resource_counts', v_inventory->'resource_counts',
    'storage_object_count', v_file_count, 'replayed', false
  );
exception when unique_violation then
  return jsonb_build_object(
    'ok', false, 'status', 409,
    'error_code', 'course_blueprint_purge_active',
    'error', 'Permanent deletion is already active for this Course Blueprint'
  );
end;
$$;

create or replace function public.claim_course_blueprint_purge_object(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 60
)
returns setof public.course_blueprint_purge_objects
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_operation public.course_blueprint_purge_operations;
  v_object_id uuid;
begin
  if p_lease_token is null or p_lease_seconds not between 15 and 300 then
    raise exception using errcode = '22023',
      message = 'invalid_course_blueprint_purge_lease';
  end if;
  if not public.lock_managed_storage_protocol() then
    raise exception using errcode = '55000',
      message = 'managed_storage_enforcement_required';
  end if;
  perform 1 from public.course_blueprint_purge_settings
  where singleton for share;
  select * into v_operation from public.course_blueprint_purge_operations
  where id = p_operation_id and teacher_id = p_teacher_id;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'course_blueprint_purge_operation_not_found';
  end if;
  if not public.course_blueprint_purge_enabled(
    p_teacher_id, v_operation.course_blueprint_id
  ) then
    raise exception using errcode = '55000',
      message = 'course_blueprint_purge_disabled';
  end if;

  perform public.course_blueprint_purge_lock(v_operation.course_blueprint_id);
  perform 1 from public.course_blueprints blueprint
  where blueprint.id = v_operation.course_blueprint_id
    and blueprint.teacher_id = p_teacher_id for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'course_blueprint_purge_blueprint_not_found';
  end if;
  perform 1 from public.course_blueprint_purge_operations operation
  where operation.id = p_operation_id
    and operation.teacher_id = p_teacher_id
    and (operation.status = 'deleting_objects'
      or (operation.status = 'failed' and operation.retryable is true))
    and exists (
      select 1 from public.course_blueprint_purge_fences fence
      where fence.operation_id = operation.id
        and fence.course_blueprint_id = operation.course_blueprint_id
    ) for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'course_blueprint_purge_operation_not_found';
  end if;

  if exists (
    select 1 from storage.objects stored
    join public.course_blueprint_purge_objects purge_object
      on purge_object.operation_id = p_operation_id
     and purge_object.status = 'deleted'
     and purge_object.storage_bucket = stored.bucket_id
     and purge_object.storage_path_sha256 =
       public.managed_storage_identity_sha256(stored.bucket_id, stored.name)
  ) then
    update public.course_blueprint_purge_operations
    set status = 'failed',
        error_code = 'course_blueprint_purge_storage_reappeared',
        retryable = false, updated_at = clock_timestamp()
    where id = p_operation_id;
    return;
  end if;

  select purge_object.id into v_object_id
  from public.course_blueprint_purge_objects purge_object
  join public.managed_storage_objects object
    on object.id = purge_object.managed_storage_object_id
  where purge_object.operation_id = p_operation_id
    and object.course_blueprint_id = v_operation.course_blueprint_id
    and purge_object.storage_path is not null
    and purge_object.next_attempt_at <= clock_timestamp()
    and (purge_object.status in ('pending', 'failed')
      or (purge_object.status = 'processing'
        and purge_object.lease_expires_at <= clock_timestamp()))
  order by purge_object.next_attempt_at, purge_object.created_at,
    purge_object.id
  for update of purge_object skip locked limit 1;
  if not found then return; end if;

  update public.course_blueprint_purge_operations
  set status = 'deleting_objects', error_code = null, retryable = null,
      updated_at = clock_timestamp()
  where id = p_operation_id;
  return query
  update public.course_blueprint_purge_objects purge_object
  set status = 'processing',
      attempt_count = purge_object.attempt_count + 1,
      lease_token = p_lease_token,
      lease_expires_at = clock_timestamp()
        + make_interval(secs => p_lease_seconds),
      last_error_code = null, updated_at = clock_timestamp()
  where purge_object.id = v_object_id
  returning purge_object.*;
end;
$$;

create or replace function public.complete_course_blueprint_purge_object(
  p_object_id uuid,
  p_teacher_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_object public.course_blueprint_purge_objects;
  v_blueprint_id uuid;
begin
  select operation.course_blueprint_id
  into v_blueprint_id
  from public.course_blueprint_purge_objects purge_object
  join public.course_blueprint_purge_operations operation
    on operation.id = purge_object.operation_id
  where purge_object.id = p_object_id
    and operation.teacher_id = p_teacher_id
    and purge_object.status = 'processing'
    and purge_object.lease_token = p_lease_token;
  if not found then return false; end if;

  perform public.course_blueprint_purge_lock(v_blueprint_id);
  select purge_object.* into v_object
  from public.course_blueprint_purge_objects purge_object
  join public.course_blueprint_purge_operations operation
    on operation.id = purge_object.operation_id
  where purge_object.id = p_object_id
    and operation.teacher_id = p_teacher_id
    and operation.course_blueprint_id = v_blueprint_id
    and purge_object.status = 'processing'
    and purge_object.lease_token = p_lease_token
    and purge_object.lease_expires_at > clock_timestamp()
  for update of purge_object;
  if not found then return false; end if;
  perform public.managed_storage_exact_lock(
    v_object.storage_bucket, v_object.storage_path
  );
  if exists (
    select 1 from storage.objects stored
    where stored.bucket_id = v_object.storage_bucket
      and stored.name = v_object.storage_path
  ) then
    raise exception using errcode = '55000',
      message = 'course_blueprint_purge_storage_object_still_present';
  end if;
  update public.course_blueprint_purge_objects
  set status = 'deleted', storage_path = null,
      lease_token = null, lease_expires_at = null,
      last_error_code = null, deleted_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = p_object_id;
  return true;
end;
$$;

create or replace function public.fail_course_blueprint_purge_object(
  p_object_id uuid,
  p_teacher_id uuid,
  p_lease_token uuid,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation_id uuid;
begin
  update public.course_blueprint_purge_objects purge_object
  set status = 'failed', lease_token = null, lease_expires_at = null,
      last_error_code = left(coalesce(nullif(btrim(p_error_code), ''),
        'storage_delete_failed'), 120),
      next_attempt_at = clock_timestamp() + make_interval(
        secs => least(3600, greatest(5,
          (2 ^ least(purge_object.attempt_count, 10))::integer))
      ), updated_at = clock_timestamp()
  from public.course_blueprint_purge_operations operation
  where purge_object.id = p_object_id
    and operation.id = purge_object.operation_id
    and operation.teacher_id = p_teacher_id
    and purge_object.status = 'processing'
    and purge_object.lease_token = p_lease_token
  returning purge_object.operation_id into v_operation_id;
  if v_operation_id is not null then
    update public.course_blueprint_purge_operations
    set status = 'failed', error_code = 'storage_delete_failed',
        retryable = true, updated_at = clock_timestamp()
    where id = v_operation_id;
    return true;
  end if;
  return false;
end;
$$;

create or replace function public.guard_course_blueprint_purge_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_blueprint_id uuid;
begin
  if current_setting('pika.course_blueprint_purge_finalize', true) = 'on'
  then return case when tg_op = 'DELETE' then old else new end; end if;

  -- Every teacher-initiated root deletion must use the durable operation.
  -- Preserve the pre-existing user-account cascade only when its parent user
  -- has already disappeared in that same transaction.
  if tg_table_name = 'course_blueprints' then
    if tg_op = 'DELETE' and exists (
      select 1 from public.users
      where id = nullif(v_old->>'teacher_id', '')::uuid
    ) then
      raise exception using errcode = '55000',
        message = 'course_blueprint_purge_required';
    end if;
  end if;

  for v_blueprint_id in
    select distinct candidate
    from unnest(array[
      case when tg_table_name = 'course_blueprints'
        then nullif(v_old->>'id', '')::uuid
        else nullif(v_old->>'course_blueprint_id', '')::uuid end,
      case when tg_table_name = 'course_blueprints'
        then nullif(v_new->>'id', '')::uuid
        else nullif(v_new->>'course_blueprint_id', '')::uuid end,
      nullif(v_old->>'source_blueprint_id', '')::uuid,
      nullif(v_new->>'source_blueprint_id', '')::uuid,
      nullif(v_old->>'result_blueprint_id', '')::uuid,
      nullif(v_new->>'result_blueprint_id', '')::uuid
    ]) candidate
    where candidate is not null
  loop
    perform public.guard_course_blueprint_purge_lifecycle(v_blueprint_id);
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger course_blueprints_purge_fence
before insert or update or delete on public.course_blueprints
for each row execute function public.guard_course_blueprint_purge_write();
create trigger course_blueprint_assignments_purge_fence
before insert or update or delete on public.course_blueprint_assignments
for each row execute function public.guard_course_blueprint_purge_write();
create trigger course_blueprint_assessments_purge_fence
before insert or update or delete on public.course_blueprint_assessments
for each row execute function public.guard_course_blueprint_purge_write();
create trigger course_blueprint_lessons_purge_fence
before insert or update or delete on public.course_blueprint_lesson_templates
for each row execute function public.guard_course_blueprint_purge_write();
create trigger course_blueprint_materials_purge_fence
before insert or update or delete on public.course_blueprint_materials
for each row execute function public.guard_course_blueprint_purge_write();
create trigger course_blueprint_surveys_purge_fence
before insert or update or delete on public.course_blueprint_surveys
for each row execute function public.guard_course_blueprint_purge_write();
create trigger course_blueprint_versions_purge_fence
before insert or update or delete on public.course_blueprint_versions
for each row execute function public.guard_course_blueprint_purge_write();
create trigger course_blueprint_proposals_purge_fence
before insert or update or delete on public.course_blueprint_change_proposals
for each row execute function public.guard_course_blueprint_purge_write();
create trigger course_blueprint_sessions_purge_fence
before insert or update or delete on public.course_blueprint_editing_sessions
for each row execute function public.guard_course_blueprint_purge_write();
create trigger course_blueprint_operations_purge_fence
before insert or update or delete on public.course_blueprint_operations
for each row execute function public.guard_course_blueprint_purge_write();

-- Classroom lineage and copied artifacts remain usable after Blueprint
-- deletion, but their Version references must not change underneath the
-- finalizer. Resolve those references back to the owning Blueprint and use
-- the same lifecycle fence as Blueprint-native writes.
create or replace function public.guard_course_blueprint_version_lineage_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_blueprint_id uuid;
begin
  if current_setting('pika.course_blueprint_purge_finalize', true) = 'on'
  then return case when tg_op = 'DELETE' then old else new end; end if;

  for v_blueprint_id in
    select distinct candidate from (
      select nullif(v_old->>'source_blueprint_id', '')::uuid candidate
      union all select nullif(v_new->>'source_blueprint_id', '')::uuid
      union all
      select version.course_blueprint_id
      from public.course_blueprint_versions version
      where version.id in (
        nullif(v_old->>'source_blueprint_version_id', '')::uuid,
        nullif(v_new->>'source_blueprint_version_id', '')::uuid
      )
    ) candidates where candidate is not null
  loop
    perform public.guard_course_blueprint_purge_lifecycle(v_blueprint_id);
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger classrooms_blueprint_purge_lineage_fence
before insert or update of source_blueprint_id, source_blueprint_version_id or delete
on public.classrooms for each row
execute function public.guard_course_blueprint_version_lineage_write();
create trigger assignments_blueprint_purge_lineage_fence
before insert or update of source_blueprint_version_id or delete
on public.assignments for each row
execute function public.guard_course_blueprint_version_lineage_write();
create trigger tests_blueprint_purge_lineage_fence
before insert or update of source_blueprint_version_id or delete
on public.tests for each row
execute function public.guard_course_blueprint_version_lineage_write();
create trigger test_questions_blueprint_purge_lineage_fence
before insert or update of source_blueprint_version_id or delete
on public.test_questions for each row
execute function public.guard_course_blueprint_version_lineage_write();
create trigger requirements_blueprint_purge_lineage_fence
before insert or update of source_blueprint_version_id or delete
on public.assignment_submission_requirements for each row
execute function public.guard_course_blueprint_version_lineage_write();
create trigger lesson_plans_blueprint_purge_lineage_fence
before insert or update of source_blueprint_version_id or delete
on public.lesson_plans for each row
execute function public.guard_course_blueprint_version_lineage_write();
create trigger materials_blueprint_purge_lineage_fence
before insert or update of source_blueprint_version_id or delete
on public.classwork_materials for each row
execute function public.guard_course_blueprint_version_lineage_write();
create trigger surveys_blueprint_purge_lineage_fence
before insert or update of source_blueprint_version_id or delete
on public.surveys for each row
execute function public.guard_course_blueprint_version_lineage_write();
create trigger survey_questions_blueprint_purge_lineage_fence
before insert or update of source_blueprint_version_id or delete
on public.survey_questions for each row
execute function public.guard_course_blueprint_version_lineage_write();

create or replace function public.prevent_blueprint_version_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and (
    current_setting('pika.course_blueprint_purge_finalize', true) = 'on'
    or not exists (
      select 1 from public.course_blueprints
      where id = old.course_blueprint_id
    )
    or not exists (
      select 1 from public.users
      where id = old.created_by
    )
  ) then return old; end if;
  raise exception 'Blueprint Versions are immutable' using errcode = '55000';
end;
$$;

create or replace function public.reject_blueprint_managed_storage_change_during_purge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_blueprint_id uuid;
begin
  if current_setting('pika.course_blueprint_purge_finalize', true) = 'on'
  then return case when tg_op = 'DELETE' then old else new end; end if;

  if tg_op <> 'DELETE' and new.storage_path is not null and exists (
    select 1 from public.course_blueprint_purge_objects purge_object
    where purge_object.storage_bucket = new.storage_bucket
      and purge_object.storage_path_sha256 =
        public.managed_storage_identity_sha256(new.storage_bucket, new.storage_path)
  ) then
    raise exception using errcode = '55000', message = 'course_blueprint_purge_path_reserved';
  end if;

  for v_blueprint_id in
    select distinct candidate from unnest(array[
      case when tg_op <> 'INSERT' then old.course_blueprint_id end,
      case when tg_op <> 'DELETE' then new.course_blueprint_id end
    ]) candidate where candidate is not null
  loop
    perform public.guard_course_blueprint_purge_lifecycle(v_blueprint_id);
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger managed_storage_blueprint_purge_fence
before insert or update or delete on public.managed_storage_objects
for each row execute function public.reject_blueprint_managed_storage_change_during_purge();

create or replace function public.reject_blueprint_provisional_change_during_purge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_blueprint_id uuid;
begin
  if current_setting('pika.course_blueprint_purge_finalize', true) = 'on'
  then return case when tg_op = 'DELETE' then old else new end; end if;
  for v_blueprint_id in
    select distinct candidate from unnest(array[
      case when tg_op <> 'INSERT' then old.source_course_blueprint_id end,
      case when tg_op <> 'DELETE' then new.source_course_blueprint_id end
    ]) candidate where candidate is not null
  loop
    perform public.guard_course_blueprint_purge_lifecycle(v_blueprint_id);
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger managed_storage_provisional_blueprint_purge_fence
before insert or update or delete on public.managed_storage_provisional_owners
for each row execute function public.reject_blueprint_provisional_change_during_purge();

create or replace function public.begin_managed_storage_blueprint_copy_owner(
  p_owner_id uuid,
  p_operation_id uuid,
  p_created_by_user_id uuid,
  p_source_course_blueprint_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_started boolean;
begin
  if p_source_course_blueprint_id is null or not exists (
    select 1 from public.course_blueprints blueprint
    where blueprint.id = p_source_course_blueprint_id
      and blueprint.teacher_id = p_created_by_user_id
  ) then
    raise exception using errcode = '55000', message = 'managed_storage_blueprint_copy_source_invalid';
  end if;
  perform public.guard_course_blueprint_purge_lifecycle(p_source_course_blueprint_id);
  v_started := public.begin_managed_storage_provisional_owner(
    p_owner_id, 'classroom_copy', p_operation_id, p_created_by_user_id,
    null, null
  );
  if not v_started then return false; end if;
  update public.managed_storage_provisional_owners
  set source_course_blueprint_id = p_source_course_blueprint_id,
      copy_closed_at = null,
      copy_close_reason = null
  where id = p_owner_id
    and operation_id = p_operation_id
    and created_by_user_id = p_created_by_user_id
    and (source_course_blueprint_id is null
      or source_course_blueprint_id = p_source_course_blueprint_id);
  return found;
end;
$$;

create or replace function public.heartbeat_managed_storage_blueprint_copy_owner(
  p_owner_id uuid,
  p_operation_id uuid,
  p_created_by_user_id uuid,
  p_source_course_blueprint_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.guard_course_blueprint_purge_lifecycle(
    p_source_course_blueprint_id
  );
  update public.managed_storage_provisional_owners owner
  set expires_at = clock_timestamp() + interval '1 hour'
  where owner.id = p_owner_id
    and owner.operation_id = p_operation_id
    and owner.created_by_user_id = p_created_by_user_id
    and owner.source_course_blueprint_id = p_source_course_blueprint_id
    and owner.adopted_at is null
    and owner.copy_closed_at is null;
  return found;
end;
$$;

create or replace function public.settle_managed_storage_blueprint_copy_owner(
  p_owner_id uuid,
  p_operation_id uuid,
  p_created_by_user_id uuid,
  p_source_course_blueprint_id uuid,
  p_outcome text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner public.managed_storage_provisional_owners;
begin
  if p_source_course_blueprint_id is null
    or p_outcome not in ('adopted', 'aborted')
  then
    raise exception using errcode = '22023',
      message = 'managed_storage_blueprint_copy_outcome_invalid';
  end if;
  select * into v_owner
  from public.managed_storage_provisional_owners owner
  where owner.id = p_owner_id
    and owner.operation_id = p_operation_id
    and owner.created_by_user_id = p_created_by_user_id
    and owner.source_course_blueprint_id
      is not distinct from p_source_course_blueprint_id
  for update;
  if not found then return false; end if;
  if v_owner.copy_closed_at is not null then
    return v_owner.copy_close_reason = p_outcome
      or (v_owner.copy_close_reason = 'adopted' and p_outcome = 'aborted');
  end if;

  -- A lost atomic-operation response can make the caller request "aborted"
  -- after every object was actually adopted. Treat the durable ownership rows
  -- as authority and close the intent as adopted.
  if v_owner.adopted_at is not null and not exists (
    select 1 from public.managed_storage_objects object
    where object.provisional_owner_id = p_owner_id
  ) then
    p_outcome := 'adopted';
  elsif p_outcome = 'adopted' then
    return false;
  elsif exists (
    select 1 from public.managed_storage_objects object
    where object.provisional_owner_id = p_owner_id
      and object.status not in (
        'cleanup_pending', 'cleanup_processing', 'deleted'
      )
  ) then
    return false;
  end if;

  update public.managed_storage_provisional_owners
  set copy_closed_at = clock_timestamp(), copy_close_reason = p_outcome
  where id = p_owner_id;
  return true;
end;
$$;

-- Operator-only hard-crash recovery. This never infers safety from lease age:
-- the caller must attest that the worker is gone and compare-and-swap the
-- exact expired snapshot. Running operations and live provisional files keep
-- the intent fail-closed.
create or replace function public.recover_managed_storage_blueprint_copy_owner(
  p_owner_id uuid,
  p_operation_id uuid,
  p_created_by_user_id uuid,
  p_source_course_blueprint_id uuid,
  p_expected_expires_at timestamptz,
  p_confirm_no_live_worker boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner public.managed_storage_provisional_owners;
begin
  if p_owner_id is null
    or p_operation_id is null
    or p_created_by_user_id is null
    or p_source_course_blueprint_id is null
    or p_expected_expires_at is null
    or p_confirm_no_live_worker is distinct from true
  then
    raise exception using errcode = '22023',
      message = 'managed_storage_blueprint_copy_recovery_confirmation_required';
  end if;

  select * into v_owner
  from public.managed_storage_provisional_owners owner
  where owner.id = p_owner_id
    and owner.operation_id = p_operation_id
    and owner.created_by_user_id = p_created_by_user_id
    and owner.source_course_blueprint_id = p_source_course_blueprint_id
  for update;
  if not found then return false; end if;
  if v_owner.copy_closed_at is not null then
    return v_owner.copy_close_reason = 'recovered';
  end if;
  if v_owner.adopted_at is not null
    or v_owner.expires_at is distinct from p_expected_expires_at
    or v_owner.expires_at > clock_timestamp() - interval '24 hours'
  then return false; end if;

  if exists (
    select 1 from public.course_blueprint_operations operation
    where operation.id = p_operation_id
      and operation.teacher_id = p_created_by_user_id
      and operation.status = 'running'
  ) or exists (
    select 1 from public.managed_storage_objects object
    where object.provisional_owner_id = p_owner_id
      and object.status not in ('cleanup_pending', 'deleted')
  ) then return false; end if;

  update public.managed_storage_provisional_owners
  set copy_closed_at = clock_timestamp(), copy_close_reason = 'recovered'
  where id = p_owner_id and copy_closed_at is null;
  return found;
end;
$$;

create or replace function public.reject_blueprint_purged_storage_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.bucket_id = 'test-documents' and exists (
    select 1 from public.course_blueprint_purge_objects purge_object
    where purge_object.storage_bucket = new.bucket_id
      and purge_object.storage_path_sha256 =
        public.managed_storage_identity_sha256(new.bucket_id, new.name)
  ) then
    raise exception using errcode = '55000', message = 'course_blueprint_purge_path_reserved';
  end if;
  return new;
end;
$$;

create trigger storage_blueprint_purge_path_reservation
before insert or update on storage.objects
for each row execute function public.reject_blueprint_purged_storage_write();

-- Extend the existing managed-delete authority with a live Blueprint purge
-- lease. All compatibility and generic-cleanup behavior remains unchanged.
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
  where object.storage_bucket = old.bucket_id and object.storage_path = old.name
  for update;
  perform public.managed_storage_exact_lock(old.bucket_id, old.name);
  if v_object.id is not null and (
    exists (
      select 1 from public.classroom_purge_objects purge_object
      join public.classroom_purge_operations operation
        on operation.id = purge_object.operation_id
      join public.classroom_purge_fences fence
        on fence.operation_id = operation.id
       and fence.classroom_id = operation.classroom_id
      where purge_object.managed_storage_object_id = v_object.id
        and purge_object.status = 'processing'
        and purge_object.lease_expires_at > clock_timestamp()
        and operation.status in ('deleting_objects', 'failed')
    ) or exists (
      select 1 from public.course_blueprint_purge_objects purge_object
      join public.course_blueprint_purge_operations operation
        on operation.id = purge_object.operation_id
      join public.course_blueprint_purge_fences fence
        on fence.operation_id = operation.id
       and fence.course_blueprint_id = operation.course_blueprint_id
      where purge_object.managed_storage_object_id = v_object.id
        and purge_object.status = 'processing'
        and purge_object.lease_expires_at > clock_timestamp()
        and (operation.status = 'deleting_objects'
          or (operation.status = 'failed' and operation.retryable is true))
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

create or replace function public.guard_course_blueprint_purge_lifecycle(p_blueprint_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_blueprint_id is null
    or current_setting('pika.course_blueprint_purge_finalize', true) = 'on'
  then return; end if;
  if not pg_try_advisory_xact_lock(hashtextextended(
    jsonb_build_array('course_blueprint_purge', p_blueprint_id)::text, 0
  )) then
    raise exception using errcode = '40001', message = 'course_blueprint_purge_lock_busy';
  end if;
  if exists (
    select 1 from public.course_blueprint_purge_fences
    where course_blueprint_id = p_blueprint_id
  ) then
    raise exception using errcode = '55000', message = 'course_blueprint_purge_in_progress';
  end if;
end;
$$;

create or replace function public.course_blueprint_purge_enabled(
  p_teacher_id uuid,
  p_blueprint_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.course_blueprint_purge_settings settings
    join public.course_blueprints blueprint
      on blueprint.id = p_blueprint_id and blueprint.teacher_id = p_teacher_id
    where settings.singleton
      and (
        settings.rollout_mode = 'enabled'
        or (settings.rollout_mode = 'canary'
          and settings.canary_teacher_id = p_teacher_id
          and settings.canary_blueprint_id = p_blueprint_id)
      )
  )
$$;

create or replace function public.course_blueprint_purge_conflict(
  p_blueprint_id uuid
)
returns text
language plpgsql
security definer
volatile
set search_path = public
as $$
begin
  if exists (
    select 1 from public.course_blueprint_operations operation
    where operation.status = 'running'
      and (operation.source_blueprint_id = p_blueprint_id
        or operation.result_blueprint_id = p_blueprint_id)
  ) then return 'course_blueprint_operation_active'; end if;

  if exists (
    select 1 from public.course_blueprint_editing_sessions session
    where session.course_blueprint_id = p_blueprint_id
      and session.status = 'ready'
      and session.expires_at > clock_timestamp()
  ) then return 'course_blueprint_editing_session_active'; end if;

  if exists (
    select 1 from public.managed_storage_provisional_owners provisional
    where (provisional.source_course_blueprint_id = p_blueprint_id
        or provisional.target_course_blueprint_id = p_blueprint_id)
      and provisional.adopted_at is null
      and provisional.copy_closed_at is null
  ) then return 'course_blueprint_copy_active'; end if;

  if exists (
    select 1 from public.managed_storage_objects object
    where object.course_blueprint_id = p_blueprint_id
      and (
        (object.status = 'cleanup_processing'
          and object.lease_expires_at > clock_timestamp())
        or (object.status in ('reserved', 'verified')
          and object.reservation_expires_at > clock_timestamp())
      )
  ) then return 'course_blueprint_storage_operation_active'; end if;

  return null;
end;
$$;

create or replace function public.get_course_blueprint_purge_inventory(
  p_teacher_id uuid,
  p_blueprint_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_blueprint public.course_blueprints;
  v_mode text;
  v_allowed boolean;
  v_conflict text;
  v_file_count integer;
  v_file_bytes bigint;
  v_missing integer;
  v_digest text;
  v_counts jsonb;
  v_row_count integer;
  v_linked integer;
begin
  select * into v_blueprint from public.course_blueprints
  where id = p_blueprint_id and teacher_id = p_teacher_id;
  if not found then
    return jsonb_build_object(
      'ok', false, 'status', 404, 'error_code', 'course_blueprint_not_found',
      'error', 'Course Blueprint not found'
    );
  end if;

  select mode into v_mode from public.managed_storage_settings where singleton;
  v_allowed := public.course_blueprint_purge_enabled(p_teacher_id, p_blueprint_id);
  v_conflict := public.course_blueprint_purge_conflict(p_blueprint_id);

  select count(*), coalesce(sum(byte_size), 0), count(*) filter (
      where status <> 'ready'
        or not exists (
          select 1 from storage.objects stored
          where stored.bucket_id = object.storage_bucket
            and stored.name = object.storage_path
        )
    )
  into v_file_count, v_file_bytes, v_missing
  from public.managed_storage_objects object
  where object.course_blueprint_id = p_blueprint_id;

  -- The confirmation digest covers graph membership, linked Classrooms, and
  -- exact managed-object identities. This catches equal-count replacements,
  -- not merely file-count drift.
  select encode(extensions.digest(
    convert_to(coalesce(string_agg(member, ',' order by member), ''), 'UTF8'),
    'sha256'), 'hex') into v_digest
  from (
    select 'blueprint:' || blueprint.id || ':' || blueprint.content_revision member
    from public.course_blueprints blueprint where blueprint.id = p_blueprint_id
    union all select 'assignment:' || id from public.course_blueprint_assignments where course_blueprint_id = p_blueprint_id
    union all select 'assessment:' || id from public.course_blueprint_assessments where course_blueprint_id = p_blueprint_id
    union all select 'lesson:' || id from public.course_blueprint_lesson_templates where course_blueprint_id = p_blueprint_id
    union all select 'material:' || id from public.course_blueprint_materials where course_blueprint_id = p_blueprint_id
    union all select 'survey:' || id from public.course_blueprint_surveys where course_blueprint_id = p_blueprint_id
    union all select 'version:' || id from public.course_blueprint_versions where course_blueprint_id = p_blueprint_id
    union all select 'proposal:' || id from public.course_blueprint_change_proposals where course_blueprint_id = p_blueprint_id
    union all select 'session:' || id from public.course_blueprint_editing_sessions where course_blueprint_id = p_blueprint_id
    union all
    select 'classroom:' || classroom.id || ':'
      || coalesce(classroom.source_blueprint_version_id::text, 'none') || ':'
      || classroom.blueprint_source_revision::text || ':'
      || encode(extensions.digest(convert_to(
        coalesce(classroom.source_blueprint_origin, 'null'::jsonb)::text,
        'UTF8'
      ), 'sha256'), 'hex')
    from public.classrooms classroom
    where classroom.source_blueprint_id = p_blueprint_id
    union all
    select 'object:' || object.id || ':' || object.storage_bucket || ':'
      || public.managed_storage_identity_sha256(object.storage_bucket, object.storage_path)
      || ':' || object.status
    from public.managed_storage_objects object
    where object.course_blueprint_id = p_blueprint_id
  ) inventory_members;

  select count(*) into v_linked from public.classrooms
  where source_blueprint_id = p_blueprint_id;

  v_counts := jsonb_build_object(
    'course_blueprints', 1,
    'course_blueprint_assignments', (select count(*) from public.course_blueprint_assignments where course_blueprint_id = p_blueprint_id),
    'course_blueprint_assessments', (select count(*) from public.course_blueprint_assessments where course_blueprint_id = p_blueprint_id),
    'course_blueprint_lesson_templates', (select count(*) from public.course_blueprint_lesson_templates where course_blueprint_id = p_blueprint_id),
    'course_blueprint_materials', (select count(*) from public.course_blueprint_materials where course_blueprint_id = p_blueprint_id),
    'course_blueprint_surveys', (select count(*) from public.course_blueprint_surveys where course_blueprint_id = p_blueprint_id),
    'course_blueprint_versions', (select count(*) from public.course_blueprint_versions where course_blueprint_id = p_blueprint_id),
    'course_blueprint_change_proposals', (select count(*) from public.course_blueprint_change_proposals where course_blueprint_id = p_blueprint_id),
    'course_blueprint_editing_sessions', (select count(*) from public.course_blueprint_editing_sessions where course_blueprint_id = p_blueprint_id),
    'managed_storage_json_references', (
      select count(*) from public.managed_storage_json_references reference
      join public.managed_storage_objects object on object.id = reference.managed_object_id
      where object.course_blueprint_id = p_blueprint_id
    ),
    'managed_storage_objects', v_file_count
  );
  select coalesce(sum(value::integer), 0) into v_row_count
  from jsonb_each_text(v_counts);

  return jsonb_build_object(
    'ok', true,
    'status', 200,
    'course_blueprint_id', p_blueprint_id,
    'course_blueprint_title', v_blueprint.title,
    'source_revision', v_blueprint.content_revision,
    'authority_mode', v_blueprint.authority_mode,
    'planned_site_published', v_blueprint.planned_site_published,
    'planned_site_slug', v_blueprint.planned_site_slug,
    'inventory_sha256', v_digest,
    'relational_row_count', v_row_count,
    'linked_classroom_count', v_linked,
    'managed_file_count', v_file_count,
    'managed_file_bytes', v_file_bytes,
    'missing_file_count', v_missing,
    'resource_counts', v_counts,
    'storage_counts', case when v_file_count = 0 then '{}'::jsonb
      else jsonb_build_object('test-documents', v_file_count) end,
    'conflicting_operation', v_conflict,
    'deletion_available', v_mode = 'enforced' and v_allowed
      and v_conflict is null and v_missing = 0
      and v_blueprint.authority_mode = 'pika',
    'unavailable_reason', case
      when v_blueprint.authority_mode <> 'pika'
        then 'Switch to Pika as Editor before deleting this Course Blueprint.'
      when v_mode <> 'enforced'
        then 'Managed file ownership enforcement is not enabled.'
      when not v_allowed
        then 'Permanent Course Blueprint deletion is not enabled.'
      when v_conflict is not null
        then 'Finish the active Course Blueprint operation before deleting permanently.'
      when v_missing > 0
        then 'One or more managed files could not be verified.'
      else null
    end
  );
end;
$$;

create or replace function public.finalize_course_blueprint_purge(
  p_operation_id uuid,
  p_teacher_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_operation public.course_blueprint_purge_operations;
  v_blueprint public.course_blueprints;
  v_current_digest text;
  v_error_code text;
  v_retryable boolean;
begin
  if not public.lock_managed_storage_protocol() then
    return jsonb_build_object(
      'ok', false, 'status', 503,
      'error_code', 'managed_storage_enforcement_required',
      'error', 'Managed storage ownership enforcement is not enabled'
    );
  end if;
  perform 1 from public.course_blueprint_purge_settings
  where singleton for share;
  select * into v_operation from public.course_blueprint_purge_operations
  where id = p_operation_id and teacher_id = p_teacher_id;
  if not found then
    return jsonb_build_object(
      'ok', false, 'status', 404, 'error_code', 'purge_not_found',
      'error', 'Permanent deletion not found'
    );
  end if;
  if v_operation.status = 'completed' then
    return jsonb_build_object(
      'ok', true, 'status', 200, 'operation_id', p_operation_id,
      'operation_status', 'completed', 'replayed', true
    );
  end if;
  if not public.course_blueprint_purge_enabled(
    p_teacher_id, v_operation.course_blueprint_id
  ) then
    return jsonb_build_object(
      'ok', false, 'status', 503,
      'error_code', 'course_blueprint_purge_disabled',
      'error', 'Permanent Course Blueprint deletion is not enabled'
    );
  end if;

  perform public.course_blueprint_purge_lock(v_operation.course_blueprint_id);
  select * into v_blueprint from public.course_blueprints blueprint
  where blueprint.id = v_operation.course_blueprint_id
    and blueprint.teacher_id = p_teacher_id for update;
  if not found or v_blueprint.authority_mode <> 'pika' then
    update public.course_blueprint_purge_operations
    set status = 'failed',
        error_code = 'course_blueprint_purge_owner_or_authority_drift',
        retryable = false, updated_at = clock_timestamp()
    where id = p_operation_id;
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error_code', 'course_blueprint_purge_owner_or_authority_drift',
      'error', 'Course Blueprint ownership or editor authority changed during deletion',
      'retryable', false
    );
  end if;
  if v_blueprint.content_revision <> v_operation.source_revision then
    update public.course_blueprint_purge_operations
    set status = 'failed',
        error_code = 'course_blueprint_changed_during_purge',
        retryable = false, updated_at = clock_timestamp()
    where id = p_operation_id;
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error_code', 'course_blueprint_changed_during_purge',
      'error', 'Course Blueprint data changed while deletion was in progress',
      'retryable', false
    );
  end if;
  select * into v_operation from public.course_blueprint_purge_operations
  where id = p_operation_id and teacher_id = p_teacher_id for update;
  if not exists (
    select 1 from public.course_blueprint_purge_fences fence
    where fence.operation_id = p_operation_id
      and fence.course_blueprint_id = v_operation.course_blueprint_id
  ) then
    update public.course_blueprint_purge_operations
    set status = 'failed',
        error_code = 'course_blueprint_purge_fence_missing',
        retryable = false, updated_at = clock_timestamp()
    where id = p_operation_id;
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error_code', 'course_blueprint_purge_fence_missing',
      'error', 'Permanent deletion stopped because its safety fence is missing',
      'retryable', false
    );
  end if;
  if exists (
    select 1 from storage.objects stored
    join public.course_blueprint_purge_objects purge_object
      on purge_object.operation_id = p_operation_id
     and purge_object.status = 'deleted'
     and purge_object.storage_bucket = stored.bucket_id
     and purge_object.storage_path_sha256 =
       public.managed_storage_identity_sha256(stored.bucket_id, stored.name)
  ) then
    update public.course_blueprint_purge_operations
    set status = 'failed',
        error_code = 'course_blueprint_purge_storage_reappeared',
        retryable = false, updated_at = clock_timestamp()
    where id = p_operation_id;
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error_code', 'course_blueprint_purge_storage_reappeared',
      'error', 'A Course Blueprint file reappeared after verified deletion',
      'retryable', false
    );
  end if;
  if exists (
    select 1 from public.course_blueprint_purge_objects
    where operation_id = p_operation_id and status <> 'deleted'
  ) then
    return jsonb_build_object(
      'ok', true, 'status', 202, 'operation_id', p_operation_id,
      'operation_status', v_operation.status,
      'retryable', v_operation.retryable,
      'waiting_for_storage', true, 'replayed', false
    );
  end if;

  v_current_digest := public.course_blueprint_purge_membership_sha256(
    v_operation.course_blueprint_id
  );
  if v_current_digest <> v_operation.finalization_sha256 then
    update public.course_blueprint_purge_operations
    set status = 'failed',
        error_code = 'course_blueprint_purge_membership_drift',
        retryable = false, updated_at = clock_timestamp()
    where id = p_operation_id;
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error_code', 'course_blueprint_purge_membership_drift',
      'error', 'Course Blueprint deletion membership changed while deletion was in progress',
      'retryable', false
    );
  end if;

  begin
    update public.course_blueprint_purge_operations
    set status = 'finalizing', updated_at = clock_timestamp()
    where id = p_operation_id;
    perform set_config('pika.course_blueprint_purge_finalize', 'on', true);

    if exists (
      select 1 from public.managed_storage_objects object
      left join public.course_blueprint_purge_objects purge_object
        on purge_object.operation_id = p_operation_id
       and purge_object.managed_storage_object_id = object.id
       and purge_object.status = 'deleted'
      where object.course_blueprint_id = v_operation.course_blueprint_id
        and purge_object.id is null
    ) then
      raise exception using errcode = '40001',
        message = 'course_blueprint_purge_storage_owner_drift';
    end if;

    -- Keep every Classroom and its independent file copies. Only sever the
    -- reusable-source lineage so later Classroom edits remain self-contained.
    update public.classrooms
    set source_blueprint_id = null,
        source_blueprint_version_id = null,
        source_blueprint_origin =
          (coalesce(source_blueprint_origin, '{}'::jsonb) - array[
            'blueprint_id', 'blueprint_title', 'blueprint_version_id',
            'blueprint_version_number', 'blueprint_content_revision'
          ]) || jsonb_build_object('blueprint_deleted', true)
    where source_blueprint_id = v_operation.course_blueprint_id;

    update public.assignments set source_blueprint_version_id = null
    where source_blueprint_version_id in (
      select id from public.course_blueprint_versions
      where course_blueprint_id = v_operation.course_blueprint_id
    );
    update public.tests set source_blueprint_version_id = null
    where source_blueprint_version_id in (
      select id from public.course_blueprint_versions
      where course_blueprint_id = v_operation.course_blueprint_id
    );
    update public.test_questions set source_blueprint_version_id = null
    where source_blueprint_version_id in (
      select id from public.course_blueprint_versions
      where course_blueprint_id = v_operation.course_blueprint_id
    );
    update public.assignment_submission_requirements
    set source_blueprint_version_id = null
    where source_blueprint_version_id in (
      select id from public.course_blueprint_versions
      where course_blueprint_id = v_operation.course_blueprint_id
    );
    update public.lesson_plans set source_blueprint_version_id = null
    where source_blueprint_version_id in (
      select id from public.course_blueprint_versions
      where course_blueprint_id = v_operation.course_blueprint_id
    );
    update public.classwork_materials set source_blueprint_version_id = null
    where source_blueprint_version_id in (
      select id from public.course_blueprint_versions
      where course_blueprint_id = v_operation.course_blueprint_id
    );
    update public.surveys set source_blueprint_version_id = null
    where source_blueprint_version_id in (
      select id from public.course_blueprint_versions
      where course_blueprint_id = v_operation.course_blueprint_id
    );
    update public.survey_questions set source_blueprint_version_id = null
    where source_blueprint_version_id in (
      select id from public.course_blueprint_versions
      where course_blueprint_id = v_operation.course_blueprint_id
    );

    -- Preserve operation audit rows while removing identifiers and titles for
    -- the deleted reusable source.
    update public.course_blueprint_operations
    set source_blueprint_id = case
          when source_blueprint_id = v_operation.course_blueprint_id
          then null else source_blueprint_id end,
        result_blueprint_id = case
          when result_blueprint_id = v_operation.course_blueprint_id
          then null else result_blueprint_id end,
        result = case when result is null then null else
          (result - array[
            'source_blueprint_id', 'result_blueprint_id', 'blueprint_id',
            'blueprint_title', 'blueprint_version_id'
          ]) || jsonb_build_object('course_blueprint_deleted', true)
        end,
        updated_at = clock_timestamp()
    where source_blueprint_id = v_operation.course_blueprint_id
       or result_blueprint_id = v_operation.course_blueprint_id;

    delete from public.managed_storage_json_references reference
    using public.course_blueprint_purge_objects purge_object
    where purge_object.operation_id = p_operation_id
      and purge_object.managed_storage_object_id = reference.managed_object_id;
    delete from public.test_document_snapshot_storage_cleanup cleanup
    using public.course_blueprint_purge_objects purge_object
    where purge_object.operation_id = p_operation_id
      and purge_object.managed_storage_object_id = cleanup.managed_object_id;

    -- Delete the Blueprint graph explicitly. FK cascades remain a last-resort
    -- integrity net, not the deletion contract.
    delete from public.course_blueprint_change_proposals
    where course_blueprint_id = v_operation.course_blueprint_id;
    delete from public.course_blueprint_editing_sessions
    where course_blueprint_id = v_operation.course_blueprint_id;
    delete from public.course_blueprint_assignments
    where course_blueprint_id = v_operation.course_blueprint_id;
    delete from public.course_blueprint_assessments
    where course_blueprint_id = v_operation.course_blueprint_id;
    delete from public.course_blueprint_lesson_templates
    where course_blueprint_id = v_operation.course_blueprint_id;
    delete from public.course_blueprint_materials
    where course_blueprint_id = v_operation.course_blueprint_id;
    delete from public.course_blueprint_surveys
    where course_blueprint_id = v_operation.course_blueprint_id;
    delete from public.course_blueprint_versions
    where course_blueprint_id = v_operation.course_blueprint_id;

    delete from public.managed_storage_objects object
    using public.course_blueprint_purge_objects purge_object
    where purge_object.operation_id = p_operation_id
      and purge_object.managed_storage_object_id = object.id
      and purge_object.status = 'deleted';
    if exists (
      select 1 from public.managed_storage_objects object
      where object.course_blueprint_id = v_operation.course_blueprint_id
    ) then
      raise exception using errcode = '40001',
        message = 'course_blueprint_purge_storage_owner_drift';
    end if;

    delete from public.managed_storage_provisional_owners
    where target_course_blueprint_id = v_operation.course_blueprint_id
      and adopted_at is not null;
    update public.managed_storage_provisional_owners
    set source_course_blueprint_id = null
    where source_course_blueprint_id = v_operation.course_blueprint_id;

    delete from public.course_blueprints
    where id = v_operation.course_blueprint_id
      and teacher_id = p_teacher_id;
    if not found then
      raise exception using errcode = '40001',
        message = 'course_blueprint_purge_root_drift';
    end if;

    update public.course_blueprint_purge_operations
    set status = 'completed', course_blueprint_title = null,
        impact_summary = jsonb_build_object(
          'relational_rows_deleted',
          (select coalesce(sum(value::text::integer), 0)
            from jsonb_each(resource_counts)),
          'managed_files_deleted', storage_object_count,
          'linked_classrooms_preserved',
          coalesce((impact_summary->>'linked_classroom_count')::integer, 0)
        ), retryable = false, error_code = null,
        completed_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = p_operation_id;
    delete from public.course_blueprint_purge_fences
    where operation_id = p_operation_id;
    return jsonb_build_object(
      'ok', true, 'status', 200, 'operation_id', p_operation_id,
      'operation_status', 'completed', 'replayed', false
    );
  exception when others then
    v_error_code := case
      when sqlerrm like 'course_blueprint_purge_%'
        then left(sqlerrm, 120)
      when sqlstate like '23%'
        then 'course_blueprint_purge_constraint_drift'
      else 'database_finalize_failed' end;
    v_retryable := not (
      sqlerrm like 'course_blueprint_purge_%_drift'
      or sqlstate like '23%'
      or sqlstate = '55000'
    );
    update public.course_blueprint_purge_operations
    set status = 'failed', error_code = v_error_code,
        retryable = v_retryable, updated_at = clock_timestamp()
    where id = p_operation_id;
    return jsonb_build_object(
      'ok', false, 'status', 500, 'error_code', v_error_code,
      'error', 'Permanent deletion paused before database finalization',
      'retryable', v_retryable
    );
  end;
end;
$$;

revoke all on function public.course_blueprint_purge_lock(uuid)
  from public, anon, authenticated;
revoke all on function public.course_blueprint_purge_membership_sha256(uuid)
  from public, anon, authenticated;
revoke all on function public.guard_course_blueprint_purge_lifecycle(uuid)
  from public, anon, authenticated;
revoke all on function public.course_blueprint_purge_enabled(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.course_blueprint_purge_conflict(uuid)
  from public, anon, authenticated;
revoke all on function public.get_course_blueprint_purge_inventory(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.begin_managed_storage_blueprint_copy_owner(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.heartbeat_managed_storage_blueprint_copy_owner(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.settle_managed_storage_blueprint_copy_owner(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.recover_managed_storage_blueprint_copy_owner(uuid, uuid, uuid, uuid, timestamptz, boolean)
  from public, anon, authenticated;
revoke all on function public.begin_course_blueprint_purge(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.claim_course_blueprint_purge_object(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.complete_course_blueprint_purge_object(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.fail_course_blueprint_purge_object(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.finalize_course_blueprint_purge(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.course_blueprint_purge_enabled(uuid, uuid)
  to service_role;
grant execute on function public.get_course_blueprint_purge_inventory(uuid, uuid)
  to service_role;
grant execute on function public.begin_managed_storage_blueprint_copy_owner(uuid, uuid, uuid, uuid)
  to service_role;
grant execute on function public.heartbeat_managed_storage_blueprint_copy_owner(uuid, uuid, uuid, uuid)
  to service_role;
grant execute on function public.settle_managed_storage_blueprint_copy_owner(uuid, uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.recover_managed_storage_blueprint_copy_owner(uuid, uuid, uuid, uuid, timestamptz, boolean)
  to service_role;
grant execute on function public.begin_course_blueprint_purge(uuid, uuid, uuid, text, jsonb)
  to service_role;
grant execute on function public.claim_course_blueprint_purge_object(uuid, uuid, uuid, integer)
  to service_role;
grant execute on function public.complete_course_blueprint_purge_object(uuid, uuid, uuid)
  to service_role;
grant execute on function public.fail_course_blueprint_purge_object(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.finalize_course_blueprint_purge(uuid, uuid)
  to service_role;

comment on table public.course_blueprint_purge_operations is
  'Durable, retry-safe permanent deletion ledger for teacher-owned Course Blueprints.';
comment on function public.recover_managed_storage_blueprint_copy_owner(uuid, uuid, uuid, uuid, timestamptz, boolean) is
  'Manual service-role recovery for a confirmed-dead Blueprint copy worker; exact stale snapshot matching prevents lease expiry from becoming deletion authority.';
comment on table public.course_blueprint_purge_objects is
  'Exact managed test-document work queue. Raw paths are erased after provider deletion.';
comment on table public.course_blueprint_purge_settings is
  'Independent rollout gate. Migration application never enables Blueprint deletion.';
