-- Replay-resistant, aggregate-only operational state for the deployed
-- Pika/Bara credential smoke. These records never contain attendance payloads,
-- participants, occurrence references, or provider responses.

create table public.attendance_integration_smoke_runs (
  id uuid primary key default gen_random_uuid(),
  installation_ref text not null check (installation_ref ~ '^[A-Za-z0-9._~-]{1,128}$'),
  teacher_id uuid not null references public.users(id) on delete restrict,
  classroom_id uuid not null references public.classrooms(id) on delete restrict,
  request_id text not null check (request_id ~ '^[A-Za-z0-9._~-]{16,128}$'),
  status text not null check (status in ('running', 'passed', 'failed')),
  pika_to_bara boolean,
  bara_to_pika boolean,
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,64}$'),
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  unique (installation_ref, request_id)
);

create index attendance_integration_smoke_runs_scope_created
  on public.attendance_integration_smoke_runs (
    installation_ref, teacher_id, classroom_id, created_at desc
  );

create table public.attendance_integration_smoke_nonces (
  installation_ref text not null check (installation_ref ~ '^[A-Za-z0-9._~-]{1,128}$'),
  direction text not null check (direction in ('bara_to_pika')),
  nonce text not null check (nonce ~ '^[A-Za-z0-9._~-]{16,128}$'),
  request_timestamp timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (installation_ref, direction, nonce)
);

create index attendance_integration_smoke_nonces_created
  on public.attendance_integration_smoke_nonces (created_at);

alter table public.attendance_integration_smoke_runs enable row level security;
alter table public.attendance_integration_smoke_nonces enable row level security;
revoke all on table public.attendance_integration_smoke_runs
  from public, anon, authenticated, service_role;
revoke all on table public.attendance_integration_smoke_nonces
  from public, anon, authenticated, service_role;

create function public.begin_attendance_integration_smoke_v1(
  p_installation_ref text,
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent_count integer;
begin
  if p_installation_ref !~ '^[A-Za-z0-9._~-]{1,128}$'
    or p_request_id !~ '^[A-Za-z0-9._~-]{16,128}$' then
    raise exception using errcode = '22023', message = 'attendance_smoke_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_installation_ref || ':' || p_teacher_id::text || ':' || p_classroom_id::text,
    468021357
  ));
  perform 1
  from public.classrooms classroom
  where classroom.id = p_classroom_id
    and classroom.teacher_id = p_teacher_id
    and classroom.archived_at is null
  for share;
  if not found then
    raise exception using errcode = '55000', message = 'attendance_canary_not_active';
  end if;

  if exists (
    select 1 from public.attendance_integration_smoke_runs run
    where run.installation_ref = p_installation_ref and run.request_id = p_request_id
  ) then
    return jsonb_build_object('accepted', false, 'code', 'duplicate_request');
  end if;

  select count(*) into v_recent_count
  from public.attendance_integration_smoke_runs run
  where run.installation_ref = p_installation_ref
    and run.teacher_id = p_teacher_id
    and run.classroom_id = p_classroom_id
    and run.created_at >= clock_timestamp() - interval '15 minutes';
  if v_recent_count >= 5 then
    raise exception using errcode = '55000', message = 'attendance_smoke_rate_limited';
  end if;

  insert into public.attendance_integration_smoke_runs (
    installation_ref, teacher_id, classroom_id, request_id, status
  ) values (
    p_installation_ref, p_teacher_id, p_classroom_id, p_request_id, 'running'
  );
  return jsonb_build_object('accepted', true);
end;
$$;

create function public.complete_attendance_integration_smoke_v1(
  p_installation_ref text,
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_request_id text,
  p_passed boolean,
  p_pika_to_bara boolean,
  p_bara_to_pika boolean,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_error_code is not null and p_error_code !~ '^[a-z0-9_]{1,64}$' then
    raise exception using errcode = '22023', message = 'attendance_smoke_invalid';
  end if;
  update public.attendance_integration_smoke_runs
  set status = case when p_passed then 'passed' else 'failed' end,
      pika_to_bara = p_pika_to_bara,
      bara_to_pika = p_bara_to_pika,
      error_code = p_error_code,
      finished_at = clock_timestamp()
  where installation_ref = p_installation_ref
    and teacher_id = p_teacher_id
    and classroom_id = p_classroom_id
    and request_id = p_request_id
    and status = 'running';
  return found;
end;
$$;

create function public.consume_attendance_integration_smoke_nonce_v1(
  p_installation_ref text,
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_direction text,
  p_nonce text,
  p_request_timestamp timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_installation_ref !~ '^[A-Za-z0-9._~-]{1,128}$'
    or p_direction <> 'bara_to_pika'
    or p_nonce !~ '^[A-Za-z0-9._~-]{16,128}$'
    or abs(extract(epoch from (clock_timestamp() - p_request_timestamp))) > 300 then
    return false;
  end if;
  perform 1
  from public.classrooms classroom
  where classroom.id = p_classroom_id
    and classroom.teacher_id = p_teacher_id
    and classroom.archived_at is null
  for share;
  if not found then return false; end if;

  delete from public.attendance_integration_smoke_nonces nonce
  where nonce.ctid in (
    select expired.ctid
    from public.attendance_integration_smoke_nonces expired
    where expired.created_at < clock_timestamp() - interval '24 hours'
    order by expired.created_at
    limit 100
  );

  insert into public.attendance_integration_smoke_nonces (
    installation_ref, direction, nonce, request_timestamp
  ) values (
    p_installation_ref, p_direction, p_nonce, p_request_timestamp
  ) on conflict do nothing;
  return found;
end;
$$;

revoke all on function public.begin_attendance_integration_smoke_v1(text, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.complete_attendance_integration_smoke_v1(
  text, uuid, uuid, text, boolean, boolean, boolean, text
) from public, anon, authenticated;
revoke all on function public.consume_attendance_integration_smoke_nonce_v1(
  text, uuid, uuid, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.begin_attendance_integration_smoke_v1(text, uuid, uuid, text)
  to service_role;
grant execute on function public.complete_attendance_integration_smoke_v1(
  text, uuid, uuid, text, boolean, boolean, boolean, text
) to service_role;
grant execute on function public.consume_attendance_integration_smoke_nonce_v1(
  text, uuid, uuid, text, text, timestamptz
) to service_role;
