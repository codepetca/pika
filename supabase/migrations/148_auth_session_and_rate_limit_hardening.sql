-- Replace long-lived stateless application authority with revocable, opaque
-- server-side sessions and add concurrency-safe authentication throttles.

create table public.auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  auth_source text not null,
  workos_user_id text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint auth_sessions_token_hash_check
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint auth_sessions_auth_source_check
    check (auth_source in ('password', 'workos')),
  constraint auth_sessions_workos_binding_check
    check (
      (auth_source = 'password' and workos_user_id is null)
      or (auth_source = 'workos' and workos_user_id is not null)
    ),
  constraint auth_sessions_expiry_check
    check (expires_at > created_at)
);

create index auth_sessions_user_id_idx
  on public.auth_sessions (user_id);
create index auth_sessions_expires_at_idx
  on public.auth_sessions (expires_at);

alter table public.auth_sessions enable row level security;
revoke all on table public.auth_sessions from public, anon, authenticated;
grant select, insert, delete on table public.auth_sessions to service_role;

create table public.auth_rate_limits (
  scope text not null,
  key_hash text not null,
  attempt_timestamps timestamptz[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash),
  constraint auth_rate_limits_scope_check
    check (scope ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint auth_rate_limits_key_hash_check
    check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint auth_rate_limits_attempt_count_check
    check (cardinality(attempt_timestamps) between 0 and 100)
);

create index auth_rate_limits_updated_at_idx
  on public.auth_rate_limits (updated_at);

alter table public.auth_rate_limits enable row level security;
revoke all on table public.auth_rate_limits from public, anon, authenticated;

create function public.consume_auth_rate_limit(
  p_scope text,
  p_key_hash text,
  p_max_attempts integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_recent_attempts timestamptz[];
  v_limit public.auth_rate_limits%rowtype;
  v_retry_after_seconds integer;
begin
  if p_scope !~ '^[a-z][a-z0-9_]{0,63}$'
    or p_key_hash !~ '^[0-9a-f]{64}$'
    or p_max_attempts not between 1 and 100
    or p_window_seconds not between 1 and 86400 then
    raise exception using
      errcode = '22023',
      message = 'invalid_auth_rate_limit_input';
  end if;

  -- Authentication traffic provides a reliable, low-volume opportunity to
  -- remove limiter metadata after its longest supported window has elapsed.
  delete from public.auth_rate_limits
  where updated_at < v_now - interval '1 day';

  insert into public.auth_rate_limits (
    scope,
    key_hash,
    attempt_timestamps,
    updated_at
  ) values (
    p_scope,
    p_key_hash,
    array[]::timestamptz[],
    v_now
  )
  on conflict (scope, key_hash) do nothing;

  select * into v_limit
  from public.auth_rate_limits
  where scope = p_scope and key_hash = p_key_hash
  for update;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'auth_rate_limit_missing';
  end if;

  v_recent_attempts := array(
    select attempted_at
    from unnest(v_limit.attempt_timestamps) as attempted_at
    where attempted_at > v_now - make_interval(secs => p_window_seconds)
    order by attempted_at
  );

  if cardinality(v_recent_attempts) >= p_max_attempts then
    v_retry_after_seconds := greatest(
      1,
      ceil(extract(epoch from (
        v_recent_attempts[1]
        + make_interval(secs => p_window_seconds)
        - v_now
      )))::integer
    );

    update public.auth_rate_limits
    set attempt_timestamps = v_recent_attempts,
        updated_at = v_now
    where scope = p_scope and key_hash = p_key_hash;

    return jsonb_build_object(
      'ok', false,
      'retry_after_seconds', v_retry_after_seconds
    );
  end if;

  v_recent_attempts := array_append(v_recent_attempts, v_now);
  update public.auth_rate_limits
  set attempt_timestamps = v_recent_attempts,
      updated_at = v_now
  where scope = p_scope and key_hash = p_key_hash;

  return jsonb_build_object('ok', true);
end;
$$;

create function public.clear_auth_rate_limit(
  p_scope text,
  p_key_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_scope !~ '^[a-z][a-z0-9_]{0,63}$'
    or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'invalid_auth_rate_limit_input';
  end if;

  delete from public.auth_rate_limits
  where scope = p_scope and key_hash = p_key_hash;
  return true;
end;
$$;

create function public.consume_password_reset_and_revoke_sessions(
  p_user_id uuid,
  p_handoff_token_hash text,
  p_password_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_code_id uuid;
begin
  update public.verification_codes
  set handoff_consumed_at = v_now
  where user_id = p_user_id
    and purpose = 'reset_password'
    and handoff_token_hash = p_handoff_token_hash
    and handoff_consumed_at is null
    and handoff_expires_at > v_now
  returning id into v_code_id;

  if v_code_id is null then
    return false;
  end if;

  update public.users
  set password_hash = p_password_hash
  where id = p_user_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'password_reset_user_missing';
  end if;

  delete from public.auth_sessions where user_id = p_user_id;
  return true;
end;
$$;

revoke all on function public.consume_auth_rate_limit(text, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_auth_rate_limit(text, text, integer, integer)
  to service_role;

revoke all on function public.clear_auth_rate_limit(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.clear_auth_rate_limit(text, text)
  to service_role;

revoke all on function public.consume_password_reset_and_revoke_sessions(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_password_reset_and_revoke_sessions(uuid, text, text)
  to service_role;
