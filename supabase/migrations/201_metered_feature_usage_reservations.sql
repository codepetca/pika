-- Dormant accounting foundation for paid AI grading and repository review.
-- No route calls these functions, no entitlement is created, and applying this
-- migration does not change current feature access.

begin;

create table public.feature_usage_reservations (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  subject_user_id uuid not null references public.users (id) on delete cascade,
  feature_key text not null check (feature_key = 'grading.ai'),
  operation_kind text not null check (operation_kind in (
    'assignment_ai_grading',
    'test_ai_grading',
    'repository_review'
  )),
  usage_ref text not null check (usage_ref ~ '^[A-Za-z0-9._~:@-]{1,180}$'),
  entitlement_revision bigint not null check (entitlement_revision > 0),
  units integer not null check (units between 1 and 100000),
  status text not null check (status in ('reserved', 'settled', 'released')),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{32}$'),
  reserved_at timestamptz not null,
  expires_at timestamptz not null,
  settled_at timestamptz,
  released_at timestamptz,
  release_reason text check (
    release_reason is null or release_reason in (
      'cancelled', 'expired', 'provider_failed', 'stale', 'superseded'
    )
  ),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (subject_user_id, feature_key, entitlement_revision, usage_ref),
  check (expires_at > reserved_at),
  check (
    (status = 'reserved' and settled_at is null and released_at is null and release_reason is null)
    or (status = 'settled' and settled_at is not null and released_at is null and release_reason is null)
    or (status = 'released' and settled_at is null and released_at is not null and release_reason is not null)
  )
);

create index feature_usage_reservations_subject_bucket_status
  on public.feature_usage_reservations (
    subject_user_id,
    feature_key,
    entitlement_revision,
    status
  );

alter table public.feature_usage_reservations enable row level security;
revoke all on table public.feature_usage_reservations
  from public, anon, authenticated, service_role;
grant select on table public.feature_usage_reservations to service_role;

create function public.reserve_feature_usage_v1(
  p_operation_id uuid,
  p_subject_user_id uuid,
  p_feature_key text,
  p_operation_kind text,
  p_usage_ref text,
  p_units integer,
  p_ttl_seconds integer default 3600
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_entitlement public.effective_feature_entitlements%rowtype;
  v_existing public.feature_usage_reservations%rowtype;
  v_reservation public.feature_usage_reservations%rowtype;
  v_fingerprint text;
  v_used bigint;
begin
  if p_operation_id is null
    or p_subject_user_id is null
    or p_feature_key is null
    or p_feature_key <> 'grading.ai'
    or p_operation_kind is null
    or p_operation_kind not in (
      'assignment_ai_grading', 'test_ai_grading', 'repository_review'
    )
    or p_usage_ref is null
    or p_usage_ref !~ '^[A-Za-z0-9._~:@-]{1,180}$'
    or p_units is null
    or p_units not between 1 and 100000
    or p_ttl_seconds is null
    or p_ttl_seconds not between 60 and 86400
  then
    raise exception using errcode = '22023', message = 'feature_usage_reservation_request_invalid';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'subject_user_id', p_subject_user_id,
    'feature_key', p_feature_key,
    'operation_kind', p_operation_kind,
    'usage_ref', p_usage_ref,
    'units', p_units,
    'ttl_seconds', p_ttl_seconds
  )::text);

  -- Every mutation takes the operation fence before the entitlement bucket.
  perform pg_advisory_xact_lock(
    hashtextextended('feature-usage-operation:' || p_operation_id::text, 20120260921)
  );
  perform public.lock_effective_feature_entitlement_v1(
    p_subject_user_id,
    p_feature_key
  );

  select * into v_existing
  from public.feature_usage_reservations
  where operation_id = p_operation_id;

  if v_existing.id is not null then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = 'feature_usage_operation_conflict';
    end if;
    return jsonb_build_object(
      'reservation', to_jsonb(v_existing),
      'duplicate', true
    );
  end if;

  select * into v_entitlement
  from public.effective_feature_entitlements
  where subject_user_id = p_subject_user_id
    and feature_key = p_feature_key;

  if v_entitlement.subject_user_id is null then
    raise exception using errcode = '55000', message = 'feature_usage_entitlement_unavailable';
  end if;
  if not v_entitlement.enabled then
    raise exception using errcode = '42501', message = 'feature_usage_entitlement_disabled';
  end if;
  if v_now < v_entitlement.starts_at then
    raise exception using errcode = '42501', message = 'feature_usage_entitlement_not_started';
  end if;
  if v_entitlement.expires_at is not null and v_now >= v_entitlement.expires_at then
    raise exception using errcode = '42501', message = 'feature_usage_entitlement_expired';
  end if;

  update public.feature_usage_reservations
  set status = 'released',
      released_at = v_now,
      release_reason = 'expired',
      updated_at = v_now
  where subject_user_id = p_subject_user_id
    and feature_key = p_feature_key
    and entitlement_revision = v_entitlement.revision
    and status = 'reserved'
    and expires_at <= v_now;

  select coalesce(sum(reservation.units), 0)
  into v_used
  from public.feature_usage_reservations as reservation
  where reservation.subject_user_id = p_subject_user_id
    and reservation.feature_key = p_feature_key
    and reservation.entitlement_revision = v_entitlement.revision
    and reservation.status in ('reserved', 'settled');

  if v_entitlement.quota_limit is not null
    and p_units::bigint > v_entitlement.quota_limit::bigint - v_used
  then
    raise exception using errcode = '23514', message = 'feature_usage_quota_exhausted';
  end if;

  if exists (
    select 1
    from public.feature_usage_reservations as reservation
    where reservation.subject_user_id = p_subject_user_id
      and reservation.feature_key = p_feature_key
      and reservation.entitlement_revision = v_entitlement.revision
      and reservation.usage_ref = p_usage_ref
  ) then
    raise exception using errcode = '23505', message = 'feature_usage_reference_conflict';
  end if;

  insert into public.feature_usage_reservations (
    operation_id,
    subject_user_id,
    feature_key,
    operation_kind,
    usage_ref,
    entitlement_revision,
    units,
    status,
    request_fingerprint,
    reserved_at,
    expires_at
  ) values (
    p_operation_id,
    p_subject_user_id,
    p_feature_key,
    p_operation_kind,
    p_usage_ref,
    v_entitlement.revision,
    p_units,
    'reserved',
    v_fingerprint,
    v_now,
    v_now + make_interval(secs => p_ttl_seconds)
  )
  returning * into v_reservation;

  return jsonb_build_object(
    'reservation', to_jsonb(v_reservation),
    'duplicate', false,
    'quota_limit', v_entitlement.quota_limit,
    'used_before', v_used,
    'used_after', v_used + p_units
  );
end;
$function$;

create function public.settle_feature_usage_v1(
  p_operation_id uuid,
  p_subject_user_id uuid,
  p_feature_key text,
  p_expected_units integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_reservation public.feature_usage_reservations%rowtype;
begin
  if p_operation_id is null
    or p_subject_user_id is null
    or p_feature_key is null
    or p_feature_key <> 'grading.ai'
    or p_expected_units is null
    or p_expected_units not between 1 and 100000
  then
    raise exception using errcode = '22023', message = 'feature_usage_settlement_request_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('feature-usage-operation:' || p_operation_id::text, 20120260921)
  );
  perform public.lock_effective_feature_entitlement_v1(
    p_subject_user_id,
    p_feature_key
  );

  select * into v_reservation
  from public.feature_usage_reservations
  where operation_id = p_operation_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'feature_usage_reservation_not_found';
  end if;
  if v_reservation.subject_user_id is distinct from p_subject_user_id
    or v_reservation.feature_key is distinct from p_feature_key
    or v_reservation.units is distinct from p_expected_units
  then
    raise exception using errcode = '42501', message = 'feature_usage_reservation_binding_mismatch';
  end if;
  if v_reservation.status = 'settled' then
    return jsonb_build_object('reservation', to_jsonb(v_reservation), 'duplicate', true);
  end if;
  if v_reservation.status = 'released' then
    raise exception using errcode = '55000', message = 'feature_usage_reservation_released';
  end if;
  if v_reservation.expires_at <= v_now then
    raise exception using errcode = '55000', message = 'feature_usage_reservation_expired';
  end if;

  update public.feature_usage_reservations
  set status = 'settled',
      settled_at = v_now,
      updated_at = v_now
  where id = v_reservation.id
  returning * into v_reservation;

  return jsonb_build_object('reservation', to_jsonb(v_reservation), 'duplicate', false);
end;
$function$;

create function public.release_feature_usage_v1(
  p_operation_id uuid,
  p_subject_user_id uuid,
  p_feature_key text,
  p_expected_units integer,
  p_release_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_reservation public.feature_usage_reservations%rowtype;
begin
  if p_operation_id is null
    or p_subject_user_id is null
    or p_feature_key is null
    or p_feature_key <> 'grading.ai'
    or p_expected_units is null
    or p_expected_units not between 1 and 100000
    or p_release_reason is null
    or p_release_reason not in (
      'cancelled', 'expired', 'provider_failed', 'stale', 'superseded'
    )
  then
    raise exception using errcode = '22023', message = 'feature_usage_release_request_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('feature-usage-operation:' || p_operation_id::text, 20120260921)
  );
  perform public.lock_effective_feature_entitlement_v1(
    p_subject_user_id,
    p_feature_key
  );

  select * into v_reservation
  from public.feature_usage_reservations
  where operation_id = p_operation_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'feature_usage_reservation_not_found';
  end if;
  if v_reservation.subject_user_id is distinct from p_subject_user_id
    or v_reservation.feature_key is distinct from p_feature_key
    or v_reservation.units is distinct from p_expected_units
  then
    raise exception using errcode = '42501', message = 'feature_usage_reservation_binding_mismatch';
  end if;
  if v_reservation.status = 'released' then
    if v_reservation.release_reason is distinct from p_release_reason then
      raise exception using errcode = '23505', message = 'feature_usage_release_conflict';
    end if;
    return jsonb_build_object('reservation', to_jsonb(v_reservation), 'duplicate', true);
  end if;
  if v_reservation.status = 'settled' then
    raise exception using errcode = '55000', message = 'feature_usage_reservation_settled';
  end if;

  update public.feature_usage_reservations
  set status = 'released',
      released_at = v_now,
      release_reason = p_release_reason,
      updated_at = v_now
  where id = v_reservation.id
  returning * into v_reservation;

  return jsonb_build_object('reservation', to_jsonb(v_reservation), 'duplicate', false);
end;
$function$;

revoke all on function public.reserve_feature_usage_v1(
  uuid, uuid, text, text, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.settle_feature_usage_v1(
  uuid, uuid, text, integer
) from public, anon, authenticated;
revoke all on function public.release_feature_usage_v1(
  uuid, uuid, text, integer, text
) from public, anon, authenticated;

grant execute on function public.reserve_feature_usage_v1(
  uuid, uuid, text, text, text, integer, integer
) to service_role;
grant execute on function public.settle_feature_usage_v1(
  uuid, uuid, text, integer
) to service_role;
grant execute on function public.release_feature_usage_v1(
  uuid, uuid, text, integer, text
) to service_role;

comment on table public.feature_usage_reservations is
  'Service-owned idempotent reservations for the grading.ai quota bucket; dormant until paid operation routes are integrated.';
comment on function public.reserve_feature_usage_v1(
  uuid, uuid, text, text, text, integer, integer
) is
  'Reserves bounded grading.ai units atomically against one effective-entitlement revision.';
comment on function public.settle_feature_usage_v1(
  uuid, uuid, text, integer
) is
  'Settles one unexpired feature-usage reservation idempotently after paid work succeeds.';
comment on function public.release_feature_usage_v1(
  uuid, uuid, text, integer, text
) is
  'Releases one unsettled feature-usage reservation idempotently after paid work is abandoned.';

commit;
