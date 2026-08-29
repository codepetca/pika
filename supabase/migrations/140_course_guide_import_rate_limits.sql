-- Course Guide curriculum extraction calls are provider-backed and must be
-- bounded across every application instance, not only within one server process.

create table public.course_guide_import_rate_limits (
  teacher_id uuid primary key references public.users (id) on delete cascade,
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count between 1 and 3),
  active_lease_token uuid,
  active_lease_expires_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  constraint course_guide_import_rate_limits_active_pair check (
    (active_lease_token is null and active_lease_expires_at is null)
    or (active_lease_token is not null and active_lease_expires_at is not null)
  )
);

alter table public.course_guide_import_rate_limits enable row level security;
revoke all on table public.course_guide_import_rate_limits
  from public, anon, authenticated, service_role;

create function public.acquire_course_guide_import_extraction_slot(p_teacher_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_lease_token uuid := gen_random_uuid();
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

  insert into public.course_guide_import_rate_limits as current_limit (
    teacher_id,
    window_started_at,
    attempt_count,
    active_lease_token,
    active_lease_expires_at,
    updated_at
  ) values (
    p_teacher_id,
    v_now,
    1,
    v_lease_token,
    v_now + interval '60 seconds',
    v_now
  )
  on conflict (teacher_id) do update
  set window_started_at = case
        when current_limit.window_started_at <= v_now - interval '10 minutes' then v_now
        else current_limit.window_started_at
      end,
      attempt_count = case
        when current_limit.window_started_at <= v_now - interval '10 minutes' then 1
        else current_limit.attempt_count + 1
      end,
      active_lease_token = v_lease_token,
      active_lease_expires_at = v_now + interval '60 seconds',
      updated_at = v_now
  where (
      current_limit.active_lease_token is null
      or current_limit.active_lease_expires_at <= v_now
    )
    and (
      current_limit.window_started_at <= v_now - interval '10 minutes'
      or current_limit.attempt_count < 3
    )
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
  where teacher_id = p_teacher_id;

  if v_limit.active_lease_token is not null
    and v_limit.active_lease_expires_at > v_now then
    return jsonb_build_object('ok', false, 'reason', 'active');
  end if;

  return jsonb_build_object('ok', false, 'reason', 'rate_limited');
end;
$$;

create function public.release_course_guide_import_extraction_slot(
  p_teacher_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.course_guide_import_rate_limits
  set active_lease_token = null,
      active_lease_expires_at = null,
      updated_at = clock_timestamp()
  where teacher_id = p_teacher_id
    and active_lease_token = p_lease_token;

  return found;
end;
$$;

revoke all on function public.acquire_course_guide_import_extraction_slot(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.release_course_guide_import_extraction_slot(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.acquire_course_guide_import_extraction_slot(uuid)
  to service_role;
grant execute on function public.release_course_guide_import_extraction_slot(uuid, uuid)
  to service_role;
