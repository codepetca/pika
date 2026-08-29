-- Preserve one active provider-backed extraction across the full bounded
-- fetch-plus-provider path and enforce a true rolling three-attempt window.
-- Migration 140 is already applied, so this follow-up changes the live
-- function without rewriting migration history.

alter table public.course_guide_import_rate_limits
  add column attempt_timestamps timestamptz[];

update public.course_guide_import_rate_limits
set attempt_timestamps = array_fill(
  greatest(window_started_at, updated_at),
  array[attempt_count]
);

alter table public.course_guide_import_rate_limits
  alter column attempt_timestamps set not null;

alter table public.course_guide_import_rate_limits
  add constraint course_guide_import_rate_limits_attempt_timestamps_check check (
    cardinality(attempt_timestamps) = attempt_count
    and cardinality(attempt_timestamps) between 1 and 3
  );

create or replace function public.acquire_course_guide_import_extraction_slot(
  p_teacher_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_lease_token uuid := gen_random_uuid();
  v_recent_attempts timestamptz[];
  v_limit public.course_guide_import_rate_limits%rowtype;
begin
  if not exists (
    select 1
    from public.users
    where id = p_teacher_id and role = 'teacher'
  ) then
    raise exception using
      errcode = '42501',
      message = 'course_guide_import_teacher_required';
  end if;

  insert into public.course_guide_import_rate_limits (
    teacher_id,
    window_started_at,
    attempt_count,
    attempt_timestamps,
    active_lease_token,
    active_lease_expires_at,
    updated_at
  ) values (
    p_teacher_id,
    v_now,
    1,
    array[v_now],
    v_lease_token,
    v_now + interval '90 seconds',
    v_now
  )
  on conflict (teacher_id) do nothing
  returning * into v_limit;

  if found then
    return jsonb_build_object(
      'ok', true,
      'lease_token', v_limit.active_lease_token,
      'lease_expires_at', v_limit.active_lease_expires_at
    );
  end if;

  select * into v_limit
  from public.course_guide_import_rate_limits
  where teacher_id = p_teacher_id
  for update;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'course_guide_import_rate_limit_missing';
  end if;

  if v_limit.active_lease_token is not null
    and v_limit.active_lease_expires_at > v_now then
    return jsonb_build_object('ok', false, 'reason', 'active');
  end if;

  v_recent_attempts := array(
    select attempted_at
    from unnest(v_limit.attempt_timestamps) as attempted_at
    where attempted_at > v_now - interval '10 minutes'
    order by attempted_at
  );

  if cardinality(v_recent_attempts) >= 3 then
    update public.course_guide_import_rate_limits
    set window_started_at = v_recent_attempts[1],
        attempt_count = cardinality(v_recent_attempts),
        attempt_timestamps = v_recent_attempts,
        active_lease_token = null,
        active_lease_expires_at = null,
        updated_at = v_now
    where teacher_id = p_teacher_id;

    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  v_recent_attempts := array_append(v_recent_attempts, v_now);

  update public.course_guide_import_rate_limits
  set window_started_at = v_recent_attempts[1],
      attempt_count = cardinality(v_recent_attempts),
      attempt_timestamps = v_recent_attempts,
      active_lease_token = v_lease_token,
      active_lease_expires_at = v_now + interval '90 seconds',
      updated_at = v_now
  where teacher_id = p_teacher_id
  returning * into v_limit;

  return jsonb_build_object(
    'ok', true,
    'lease_token', v_limit.active_lease_token,
    'lease_expires_at', v_limit.active_lease_expires_at
  );
end;
$$;

revoke all on function public.acquire_course_guide_import_extraction_slot(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.acquire_course_guide_import_extraction_slot(uuid)
  to service_role;
