-- Preserve expiration audit evidence while allowing fenced Assignment cleanup,
-- and renew live reservations immediately before provider work. Still default-off.
begin;

alter table public.feature_usage_reservations
  drop constraint feature_usage_reservations_release_reason_check;
alter table public.feature_usage_reservations
  add constraint feature_usage_reservations_release_reason_check check (
    release_reason is null or release_reason in (
      'cancelled', 'expired', 'provider_failed', 'stale', 'superseded', 'internal_failure'
    )
  );

create or replace function public.release_feature_usage_v1(
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
  v_now timestamptz;
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
      'cancelled', 'expired', 'provider_failed', 'stale', 'superseded', 'internal_failure'
    )
  then
    raise exception using errcode = '22023', message = 'feature_usage_release_request_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('feature-usage-operation:' || p_operation_id::text, 20120260921)
  );
  perform public.lock_effective_feature_entitlement_v1(p_subject_user_id, p_feature_key);
  v_now := clock_timestamp();

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
    if v_reservation.release_reason is distinct from p_release_reason
      and not (
        v_reservation.release_reason = 'expired'
        and v_reservation.operation_kind = 'assignment_ai_grading'
      )
    then
      raise exception using errcode = '23505', message = 'feature_usage_release_conflict';
    end if;
    -- An expiry is already a terminal release. Do not overwrite its evidence.
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

create or replace function public.reserve_assignment_ai_grading_item_usage_with_lease_v1(
  p_item_id uuid,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_locked record;
  v_result jsonb;
  v_now timestamptz;
  v_reservation public.feature_usage_reservations%rowtype;
begin
  select * into v_locked
  from private.lock_metered_assignment_ai_grading_item_v1(p_item_id, p_lease_token, true, true);

  v_result := public.reserve_feature_usage_v1(
    p_operation_id => p_item_id,
    p_subject_user_id => v_locked.triggered_by,
    p_feature_key => 'grading.ai',
    p_operation_kind => 'assignment_ai_grading',
    p_usage_ref => v_locked.usage_ref,
    p_units => 1,
    p_ttl_seconds => 86400
  );

  -- The generic reserve holds operation -> entitlement -> reservation locks and
  -- expires stale rows first. Renew only a still-live row under those same locks.
  v_now := clock_timestamp();
  update public.feature_usage_reservations
  set expires_at = v_now + interval '24 hours', updated_at = v_now
  where operation_id = p_item_id
    and status = 'reserved'
    and expires_at > v_now
  returning * into v_reservation;

  if found then
    v_result := jsonb_set(v_result, '{reservation}', to_jsonb(v_reservation));
  end if;
  return v_result;
end;
$function$;

revoke all on function public.release_feature_usage_v1(uuid, uuid, text, integer, text)
  from public, anon, authenticated;
revoke all on function public.reserve_assignment_ai_grading_item_usage_with_lease_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.release_feature_usage_v1(uuid, uuid, text, integer, text)
  to service_role;
grant execute on function public.reserve_assignment_ai_grading_item_usage_with_lease_v1(uuid, uuid)
  to service_role;

comment on function public.reserve_assignment_ai_grading_item_usage_with_lease_v1(uuid, uuid) is
  'Lease/resource-fenced admission and bounded 24-hour renewal of live Assignment usage; never resurrects released reservations.';
commit;
