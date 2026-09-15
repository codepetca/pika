-- Server-resolved feature entitlements for controlled classroom creation.
--
-- Compatibility is intentional: a missing classrooms.create row preserves the
-- existing teacher-gated application behavior. A later, separately approved
-- cohort rollout creates managed rows. Free is represented by enabled=false and
-- quota_limit=0; the initial Access grant is enabled=true with quota_limit=1.
-- Plan names and billing records do not participate in authorization here.

create table public.effective_feature_entitlements (
  subject_user_id uuid not null references public.users (id) on delete cascade,
  feature_key text not null
    check (feature_key in ('classrooms.create', 'grading.ai')),
  source text not null
    check (source in ('plan', 'trial', 'manual', 'school')),
  enabled boolean not null,
  starts_at timestamptz not null,
  expires_at timestamptz,
  quota_limit integer check (quota_limit is null or quota_limit >= 0),
  revision bigint not null check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (subject_user_id, feature_key),
  check (expires_at is null or expires_at > starts_at)
);

create table public.effective_feature_entitlement_audit (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  -- Immutable subject snapshot: account deletion removes live state without
  -- erasing the authorization change history.
  subject_user_id uuid not null,
  feature_key text not null
    check (feature_key in ('classrooms.create', 'grading.ai')),
  previous_source text
    check (previous_source is null or previous_source in ('plan', 'trial', 'manual', 'school')),
  previous_enabled boolean,
  previous_starts_at timestamptz,
  previous_expires_at timestamptz,
  previous_quota_limit integer
    check (previous_quota_limit is null or previous_quota_limit >= 0),
  new_source text not null
    check (new_source in ('plan', 'trial', 'manual', 'school')),
  new_enabled boolean not null,
  new_starts_at timestamptz not null,
  new_expires_at timestamptz,
  new_quota_limit integer
    check (new_quota_limit is null or new_quota_limit >= 0),
  entitlement_revision bigint not null check (entitlement_revision > 0),
  actor_ref text not null check (actor_ref ~ '^[A-Za-z0-9._~:@-]{1,100}$'),
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9._-]{0,99}$'),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{32}$'),
  created_at timestamptz not null default clock_timestamp(),
  check (new_expires_at is null or new_expires_at > new_starts_at)
);

create index effective_feature_entitlement_audit_subject_feature_created
  on public.effective_feature_entitlement_audit (
    subject_user_id,
    feature_key,
    created_at desc
  );

alter table public.effective_feature_entitlements enable row level security;
alter table public.effective_feature_entitlement_audit enable row level security;

revoke all on table public.effective_feature_entitlements
  from public, anon, authenticated, service_role;
revoke all on table public.effective_feature_entitlement_audit
  from public, anon, authenticated, service_role;
grant select on table public.effective_feature_entitlements to service_role;
grant select on table public.effective_feature_entitlement_audit to service_role;

create function public.lock_effective_feature_entitlement_v1(
  p_subject_user_id uuid,
  p_feature_key text
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select pg_advisory_xact_lock(
    hashtextextended(p_subject_user_id::text || ':' || p_feature_key, 16620260912)
  );
$$;

create function public.set_effective_feature_entitlement_v1(
  p_operation_id uuid,
  p_subject_user_id uuid,
  p_feature_key text,
  p_source text,
  p_enabled boolean,
  p_starts_at timestamptz,
  p_expires_at timestamptz,
  p_quota_limit integer,
  p_actor_ref text,
  p_reason_code text,
  p_expected_revision bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.effective_feature_entitlements%rowtype;
  v_audit public.effective_feature_entitlement_audit%rowtype;
  v_revision bigint;
  v_fingerprint text;
begin
  if p_operation_id is null
    or p_subject_user_id is null
    or p_feature_key is null
    or p_feature_key not in ('classrooms.create', 'grading.ai')
    or p_source is null
    or p_source not in ('plan', 'trial', 'manual', 'school')
    or p_enabled is null
    or p_starts_at is null
    or (p_expires_at is not null and p_expires_at <= p_starts_at)
    or (p_quota_limit is not null and p_quota_limit < 0)
    or p_actor_ref is null
    or p_actor_ref !~ '^[A-Za-z0-9._~:@-]{1,100}$'
    or p_reason_code is null
    or p_reason_code !~ '^[a-z][a-z0-9._-]{0,99}$'
    or (p_expected_revision is not null and p_expected_revision < 0)
  then
    raise exception using
      errcode = '22023',
      message = 'feature_entitlement_request_invalid';
  end if;

  if not exists (
    select 1 from public.users where id = p_subject_user_id
  ) then
    raise exception using
      errcode = 'P0002',
      message = 'feature_entitlement_subject_not_found';
  end if;

  -- Serialize reuse of an operation ID even when callers disagree about the
  -- subject or feature, then take the stable subject/feature lock.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'feature-entitlement-operation:' || p_operation_id::text,
      16620260913
    )
  );
  perform public.lock_effective_feature_entitlement_v1(
    p_subject_user_id,
    p_feature_key
  );

  v_fingerprint := md5(jsonb_build_object(
    'subject_user_id', p_subject_user_id,
    'feature_key', p_feature_key,
    'source', p_source,
    'enabled', p_enabled,
    'starts_at', p_starts_at,
    'expires_at', p_expires_at,
    'quota_limit', p_quota_limit,
    'actor_ref', p_actor_ref,
    'reason_code', p_reason_code,
    'expected_revision', p_expected_revision
  )::text);

  select * into v_audit
  from public.effective_feature_entitlement_audit
  where operation_id = p_operation_id;

  if v_audit.id is not null then
    if v_audit.request_fingerprint <> v_fingerprint then
      raise exception using
        errcode = '23505',
        message = 'feature_entitlement_operation_conflict';
    end if;
    return jsonb_build_object(
      'subject_user_id', v_audit.subject_user_id,
      'feature_key', v_audit.feature_key,
      'source', v_audit.new_source,
      'enabled', v_audit.new_enabled,
      'starts_at', v_audit.new_starts_at,
      'expires_at', v_audit.new_expires_at,
      'quota_limit', v_audit.new_quota_limit,
      'revision', v_audit.entitlement_revision,
      'duplicate', true
    );
  end if;

  select * into v_existing
  from public.effective_feature_entitlements
  where subject_user_id = p_subject_user_id
    and feature_key = p_feature_key
  for update;

  if coalesce(v_existing.revision, 0) <> coalesce(p_expected_revision, 0) then
    raise exception using
      errcode = '40001',
      message = 'feature_entitlement_revision_conflict';
  end if;

  v_revision := coalesce(v_existing.revision, 0) + 1;

  insert into public.effective_feature_entitlements (
    subject_user_id,
    feature_key,
    source,
    enabled,
    starts_at,
    expires_at,
    quota_limit,
    revision
  ) values (
    p_subject_user_id,
    p_feature_key,
    p_source,
    p_enabled,
    p_starts_at,
    p_expires_at,
    p_quota_limit,
    v_revision
  )
  on conflict (subject_user_id, feature_key) do update
    set source = excluded.source,
        enabled = excluded.enabled,
        starts_at = excluded.starts_at,
        expires_at = excluded.expires_at,
        quota_limit = excluded.quota_limit,
        revision = excluded.revision,
        updated_at = clock_timestamp();

  insert into public.effective_feature_entitlement_audit (
    operation_id,
    subject_user_id,
    feature_key,
    previous_source,
    previous_enabled,
    previous_starts_at,
    previous_expires_at,
    previous_quota_limit,
    new_source,
    new_enabled,
    new_starts_at,
    new_expires_at,
    new_quota_limit,
    entitlement_revision,
    actor_ref,
    reason_code,
    request_fingerprint
  ) values (
    p_operation_id,
    p_subject_user_id,
    p_feature_key,
    v_existing.source,
    v_existing.enabled,
    v_existing.starts_at,
    v_existing.expires_at,
    v_existing.quota_limit,
    p_source,
    p_enabled,
    p_starts_at,
    p_expires_at,
    p_quota_limit,
    v_revision,
    p_actor_ref,
    p_reason_code,
    v_fingerprint
  );

  return jsonb_build_object(
    'subject_user_id', p_subject_user_id,
    'feature_key', p_feature_key,
    'source', p_source,
    'enabled', p_enabled,
    'starts_at', p_starts_at,
    'expires_at', p_expires_at,
    'quota_limit', p_quota_limit,
    'revision', v_revision,
    'duplicate', false
  );
end;
$$;

-- This read is UI guidance only. The write-time trigger below is authoritative.
create function public.get_classroom_creation_access_v1(
  p_subject_user_id uuid,
  p_at timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entitlement public.effective_feature_entitlements%rowtype;
  v_active_count integer;
  v_allowed boolean;
  v_reason text;
begin
  if p_subject_user_id is null or p_at is null then
    raise exception using
      errcode = '22023',
      message = 'classroom_creation_access_request_invalid';
  end if;

  select * into v_entitlement
  from public.effective_feature_entitlements
  where subject_user_id = p_subject_user_id
    and feature_key = 'classrooms.create';

  select count(*)::integer into v_active_count
  from public.classrooms
  where teacher_id = p_subject_user_id
    and archived_at is null;

  if v_entitlement.subject_user_id is null then
    if exists (
      select 1
      from public.effective_feature_entitlement_audit
      where subject_user_id = p_subject_user_id
        and feature_key = 'classrooms.create'
    ) then
      v_allowed := false;
      v_reason := 'unavailable';
    else
      v_allowed := true;
      v_reason := 'legacy';
    end if;
  elsif not v_entitlement.enabled then
    v_allowed := false;
    v_reason := 'disabled';
  elsif p_at < v_entitlement.starts_at then
    v_allowed := false;
    v_reason := 'not_started';
  elsif v_entitlement.expires_at is not null
    and p_at >= v_entitlement.expires_at
  then
    v_allowed := false;
    v_reason := 'expired';
  elsif v_entitlement.quota_limit is not null
    and v_active_count >= v_entitlement.quota_limit
  then
    v_allowed := false;
    v_reason := 'active_limit_reached';
  else
    v_allowed := true;
    v_reason := 'allowed';
  end if;

  return jsonb_build_object(
    'subject_user_id', p_subject_user_id,
    'feature_key', 'classrooms.create',
    'managed', v_entitlement.subject_user_id is not null,
    'allowed', v_allowed,
    'reason', v_reason,
    'source', v_entitlement.source,
    'starts_at', v_entitlement.starts_at,
    'expires_at', v_entitlement.expires_at,
    'quota_limit', v_entitlement.quota_limit,
    'active_count', v_active_count,
    'revision', v_entitlement.revision
  );
end;
$$;

create function public.assert_classroom_creation_allowed_v1(
  p_subject_user_id uuid,
  p_exclude_classroom_id uuid default null,
  p_at timestamptz default clock_timestamp()
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_entitlement public.effective_feature_entitlements%rowtype;
  v_active_count integer;
begin
  if p_subject_user_id is null or p_at is null then
    raise exception using
      errcode = '22023',
      message = 'classroom_creation_access_request_invalid';
  end if;

  perform public.lock_effective_feature_entitlement_v1(
    p_subject_user_id,
    'classrooms.create'
  );

  select * into v_entitlement
  from public.effective_feature_entitlements
  where subject_user_id = p_subject_user_id
    and feature_key = 'classrooms.create';

  -- A missing row is the explicit compatibility boundary. Existing application
  -- role checks remain authoritative until a managed row is assigned.
  if v_entitlement.subject_user_id is null then
    if exists (
      select 1
      from public.effective_feature_entitlement_audit
      where subject_user_id = p_subject_user_id
        and feature_key = 'classrooms.create'
    ) then
      raise exception using
        errcode = '55000',
        message = 'classroom_creation_entitlement_unavailable';
    end if;
    return;
  end if;

  if not v_entitlement.enabled then
    raise exception using
      errcode = '42501',
      message = 'classroom_creation_entitlement_disabled';
  end if;

  if p_at < v_entitlement.starts_at then
    raise exception using
      errcode = '42501',
      message = 'classroom_creation_entitlement_not_started';
  end if;

  if v_entitlement.expires_at is not null
    and p_at >= v_entitlement.expires_at
  then
    raise exception using
      errcode = '42501',
      message = 'classroom_creation_entitlement_expired';
  end if;

  if v_entitlement.quota_limit is null then
    return;
  end if;

  select count(*)::integer into v_active_count
  from public.classrooms
  where teacher_id = p_subject_user_id
    and archived_at is null
    and (p_exclude_classroom_id is null or id <> p_exclude_classroom_id);

  if v_active_count >= v_entitlement.quota_limit then
    raise exception using
      errcode = '23514',
      message = 'classroom_creation_active_limit_reached';
  end if;
end;
$$;

create function public.enforce_classroom_creation_entitlement_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.archived_at is null then
    perform public.assert_classroom_creation_allowed_v1(
      new.teacher_id,
      new.id,
      clock_timestamp()
    );
  elsif tg_op = 'UPDATE'
    and new.archived_at is null
    and (
      old.archived_at is not null
      or new.teacher_id is distinct from old.teacher_id
    )
  then
    perform public.assert_classroom_creation_allowed_v1(
      new.teacher_id,
      new.id,
      clock_timestamp()
    );
  end if;
  return new;
end;
$$;

create trigger enforce_classroom_creation_entitlement
before insert or update of teacher_id, archived_at on public.classrooms
for each row execute function public.enforce_classroom_creation_entitlement_v1();

-- Blueprint materialization catches errors inside its compatibility function.
-- Wrap the public entry point so creation admission happens in the same
-- transaction before that catch boundary. The table trigger remains the final
-- invariant and reuses the same transaction-scoped advisory lock.
alter function public.instantiate_course_blueprint_atomic_v2(
  uuid, uuid, uuid, uuid, text, bigint, jsonb
) rename to instantiate_course_blueprint_atomic_v2_pre_create_entitlement;

create function public.instantiate_course_blueprint_atomic_v2(
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
set search_path = ''
as $$
declare
  v_operation public.course_blueprint_operations%rowtype;
begin
  -- Serialize the preflight with every classroom insert for this account. This
  -- also makes a concurrent retry observe the first transaction's completed
  -- operation before deciding whether new capacity is required.
  perform public.lock_effective_feature_entitlement_v1(
    p_teacher_id,
    'classrooms.create'
  );

  select * into v_operation
  from public.course_blueprint_operations
  where id = p_operation_id;

  if v_operation.id is not null
    and (
      v_operation.teacher_id <> p_teacher_id
      or v_operation.operation_type <> 'instantiate'
      or v_operation.request_sha256 <> p_request_sha256
    )
  then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'operation_type', 'instantiate',
      'error_code', 'idempotency_conflict',
      'error', 'Idempotency key was already used for a different blueprint request',
      'retryable', false
    );
  end if;

  if v_operation.status is distinct from 'completed'
    or v_operation.result is null
  then
    perform public.assert_classroom_creation_allowed_v1(
      p_teacher_id,
      null,
      clock_timestamp()
    );
  end if;

  return public.instantiate_course_blueprint_atomic_v2_pre_create_entitlement(
    p_operation_id,
    p_teacher_id,
    p_blueprint_id,
    p_blueprint_version_id,
    p_request_sha256,
    p_expected_content_revision,
    p_plan
  );
end;
$$;

revoke all on function public.lock_effective_feature_entitlement_v1(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.set_effective_feature_entitlement_v1(
  uuid, uuid, text, text, boolean, timestamptz, timestamptz,
  integer, text, text, bigint
) from public, anon, authenticated;
revoke all on function public.get_classroom_creation_access_v1(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.assert_classroom_creation_allowed_v1(
  uuid, uuid, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.enforce_classroom_creation_entitlement_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.instantiate_course_blueprint_atomic_v2_pre_create_entitlement(
  uuid, uuid, uuid, uuid, text, bigint, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.instantiate_course_blueprint_atomic_v2(
  uuid, uuid, uuid, uuid, text, bigint, jsonb
) from public, anon, authenticated;

grant execute on function public.set_effective_feature_entitlement_v1(
  uuid, uuid, text, text, boolean, timestamptz, timestamptz,
  integer, text, text, bigint
) to service_role;
grant execute on function public.get_classroom_creation_access_v1(uuid, timestamptz)
  to service_role;
grant execute on function public.instantiate_course_blueprint_atomic_v2(
  uuid, uuid, uuid, uuid, text, bigint, jsonb
) to service_role;
