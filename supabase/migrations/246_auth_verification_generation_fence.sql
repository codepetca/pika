-- Serialize authentication-code issuance, verification, and password confirmation
-- on the owning user row. A monotonically increasing per-purpose generation makes
-- the sole current issuance explicit and prevents stale codes or handoffs from
-- becoming authoritative again.

begin;

alter table public.verification_codes
  add column verification_generation bigint;

with ranked as (
  select id,
    row_number() over (
      partition by user_id, purpose
      order by created_at, id
    )::bigint as verification_generation
  from public.verification_codes
)
update public.verification_codes as code
set verification_generation = ranked.verification_generation
from ranked
where ranked.id = code.id;

alter table public.verification_codes
  alter column verification_generation set not null,
  add constraint verification_codes_generation_check
    check (verification_generation >= 1);

create unique index verification_codes_user_purpose_generation_unique
  on public.verification_codes (user_id, purpose, verification_generation);

create or replace function public.issue_auth_verification_code_v1(
  p_user_id uuid,
  p_purpose text,
  p_code_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_password_hash text;
  v_generation bigint;
  v_code_id uuid;
begin
  if p_user_id is null
    or p_purpose is null
    or p_purpose not in ('signup', 'reset_password')
    or p_code_hash is null
    or p_code_hash !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'
    or p_expires_at is null
    or p_expires_at <= v_now
    or p_expires_at > v_now + interval '1 hour'
  then
    raise exception using errcode = '22023', message = 'invalid_auth_verification_issuance';
  end if;

  select password_hash into v_password_hash
  from public.users
  where id = p_user_id
  for update;

  -- The request may have waited for the user authority lock. Re-read the
  -- wall clock before accepting its deadline or mutating older generations.
  v_now := clock_timestamp();

  if not found
    or (p_purpose = 'signup' and v_password_hash is not null)
    or (p_purpose = 'reset_password' and v_password_hash is null)
    or p_expires_at <= v_now
    or p_expires_at > v_now + interval '1 hour'
  then
    return jsonb_build_object('ok', false);
  end if;

  select coalesce(max(verification_generation), 0) + 1
  into v_generation
  from public.verification_codes
  where user_id = p_user_id and purpose = p_purpose;

  update public.verification_codes
  set used_at = coalesce(used_at, v_now),
      handoff_consumed_at = case
        when handoff_token_hash is not null then coalesce(handoff_consumed_at, v_now)
        else handoff_consumed_at
      end
  where user_id = p_user_id
    and purpose = p_purpose
    and (
      used_at is null
      or (handoff_token_hash is not null and handoff_consumed_at is null)
    );

  insert into public.verification_codes (
    user_id,
    code_hash,
    purpose,
    expires_at,
    attempts,
    verification_generation
  ) values (
    p_user_id,
    p_code_hash,
    p_purpose,
    p_expires_at,
    0,
    v_generation
  )
  returning id into v_code_id;

  return jsonb_build_object(
    'ok', true,
    'code_id', v_code_id,
    'generation', v_generation
  );
end;
$function$;

create or replace function public.get_latest_auth_verification_code_v1(
  p_user_id uuid,
  p_purpose text
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $function$
declare
  v_code public.verification_codes%rowtype;
begin
  if p_user_id is null
    or p_purpose is null
    or p_purpose not in ('signup', 'reset_password')
  then
    raise exception using errcode = '22023', message = 'invalid_auth_verification_lookup';
  end if;

  select * into v_code
  from public.verification_codes
  where user_id = p_user_id and purpose = p_purpose
  order by verification_generation desc
  limit 1;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_code.id,
    'generation', v_code.verification_generation,
    'code_hash', v_code.code_hash,
    'attempts', v_code.attempts,
    'used_at', v_code.used_at,
    'expires_at', v_code.expires_at
  );
end;
$function$;

create or replace function public.finalize_auth_verification_attempt_v1(
  p_user_id uuid,
  p_purpose text,
  p_candidate_id uuid,
  p_candidate_generation bigint,
  p_code_matched boolean,
  p_handoff_token_hash text,
  p_handoff_expires_at timestamptz,
  p_max_attempts integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_password_hash text;
  v_code public.verification_codes%rowtype;
begin
  if p_user_id is null
    or p_purpose is null
    or p_purpose not in ('signup', 'reset_password')
    or p_candidate_id is null
    or p_candidate_generation is null
    or p_candidate_generation < 0
    or p_code_matched is null
    or p_max_attempts is null
    or p_max_attempts not between 1 and 100
    or (
      p_code_matched and (
        p_handoff_token_hash is null
        or p_handoff_token_hash !~ '^[0-9a-f]{64}$'
        or p_handoff_expires_at is null
        or p_handoff_expires_at <= v_now
        or p_handoff_expires_at > v_now + interval '1 hour'
      )
    )
    or (
      not p_code_matched
      and (p_handoff_token_hash is not null or p_handoff_expires_at is not null)
    )
  then
    raise exception using errcode = '22023', message = 'invalid_auth_verification_finalization';
  end if;

  select password_hash into v_password_hash
  from public.users
  where id = p_user_id
  for update;

  if not found
    or (p_purpose = 'signup' and v_password_hash is not null)
    or (p_purpose = 'reset_password' and v_password_hash is null)
  then
    return jsonb_build_object('ok', false);
  end if;

  select * into v_code
  from public.verification_codes
  where user_id = p_user_id and purpose = p_purpose
  order by verification_generation desc
  limit 1
  for update;

  -- Both authority locks are now held. Expiry and the proposed handoff
  -- deadline must be judged against this fresh clock, not function entry.
  v_now := clock_timestamp();

  if not found
    or v_code.id is distinct from p_candidate_id
    or v_code.verification_generation is distinct from p_candidate_generation
    or v_code.used_at is not null
    or v_code.expires_at <= v_now
    or v_code.attempts >= p_max_attempts
    or (
      p_code_matched and (
        p_handoff_expires_at <= v_now
        or p_handoff_expires_at > v_now + interval '1 hour'
      )
    )
  then
    return jsonb_build_object('ok', false);
  end if;

  if not p_code_matched then
    update public.verification_codes
    set attempts = least(attempts + 1, p_max_attempts)
    where id = v_code.id;
    return jsonb_build_object('ok', false);
  end if;

  update public.verification_codes
  set used_at = v_now,
      handoff_token_hash = p_handoff_token_hash,
      handoff_expires_at = p_handoff_expires_at,
      handoff_consumed_at = null
  where id = v_code.id;

  if p_purpose = 'signup' then
    update public.users
    set email_verified_at = coalesce(email_verified_at, v_now)
    where id = p_user_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'generation', p_candidate_generation
  );
end;
$function$;

create or replace function public.inspect_latest_auth_handoff_v1(
  p_purpose text,
  p_handoff_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  if p_purpose is null
    or p_purpose not in ('signup', 'reset_password')
    or p_handoff_token_hash is null
    or p_handoff_token_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_auth_handoff_lookup';
  end if;

  select jsonb_build_object(
    'user_id', auth_user.id,
    'email', auth_user.email,
    'role', auth_user.role,
    'generation', code.verification_generation,
    'credential_version', auth_user.auth_credential_version,
    'email_verified', auth_user.email_verified_at is not null,
    'password_set', auth_user.password_hash is not null
  )
  into v_result
  from public.verification_codes as code
  join public.users as auth_user on auth_user.id = code.user_id
  where code.purpose = p_purpose
    and code.handoff_token_hash = p_handoff_token_hash
    and code.used_at is not null
    and code.handoff_consumed_at is null
    and code.handoff_expires_at > v_now
    and code.verification_generation = (
      select max(latest.verification_generation)
      from public.verification_codes as latest
      where latest.user_id = code.user_id and latest.purpose = code.purpose
    );

  return v_result;
end;
$function$;

create or replace function public.consume_signup_password_handoff_v1(
  p_user_id uuid,
  p_generation bigint,
  p_handoff_token_hash text,
  p_password_hash text,
  p_expected_credential_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz;
  v_user public.users%rowtype;
  v_handoff_expires_at timestamptz;
  v_credential_version bigint;
begin
  if p_user_id is null
    or p_generation is null
    or p_generation < 1
    or p_handoff_token_hash is null
    or p_handoff_token_hash !~ '^[0-9a-f]{64}$'
    or nullif(p_password_hash, '') is null
    or p_expected_credential_version is null
    or p_expected_credential_version < 1
  then
    raise exception using errcode = '22023', message = 'invalid_signup_password_confirmation';
  end if;

  select * into v_user
  from public.users
  where id = p_user_id
  for update;

  if not found
    or v_user.password_hash is not null
    or v_user.email_verified_at is null
    or v_user.auth_credential_version is distinct from p_expected_credential_version
  then
    return null;
  end if;

  select handoff_expires_at into v_handoff_expires_at
  from public.verification_codes
  where user_id = p_user_id
    and purpose = 'signup'
    and verification_generation = p_generation
    and handoff_token_hash = p_handoff_token_hash
    and used_at is not null
    and handoff_consumed_at is null
    and verification_generation = (
      select max(latest.verification_generation)
      from public.verification_codes as latest
      where latest.user_id = p_user_id and latest.purpose = 'signup'
    )
  for update;

  -- The code row may have been locked independently after the user lock.
  -- Refresh time only after the complete authority set is held.
  v_now := clock_timestamp();

  if not found
    or v_handoff_expires_at is null
    or v_handoff_expires_at <= v_now
  then
    return null;
  end if;

  update public.verification_codes
  set used_at = coalesce(used_at, v_now),
      handoff_consumed_at = case
        when handoff_token_hash is not null then coalesce(handoff_consumed_at, v_now)
        else handoff_consumed_at
      end
  where user_id = p_user_id and purpose = 'signup';

  update public.users
  set password_hash = p_password_hash
  where id = p_user_id
    and password_hash is null
    and auth_credential_version = p_expected_credential_version
  returning auth_credential_version into v_credential_version;

  return v_credential_version;
end;
$function$;

create or replace function public.consume_latest_password_reset_and_revoke_sessions_v1(
  p_user_id uuid,
  p_generation bigint,
  p_handoff_token_hash text,
  p_password_hash text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz;
  v_password_hash text;
  v_handoff_expires_at timestamptz;
  v_new_credential_version bigint;
begin
  if p_user_id is null
    or p_generation is null
    or p_generation < 1
    or p_handoff_token_hash is null
    or p_handoff_token_hash !~ '^[0-9a-f]{64}$'
    or nullif(p_password_hash, '') is null
  then
    raise exception using errcode = '22023', message = 'invalid_password_reset_confirmation';
  end if;

  select password_hash into v_password_hash
  from public.users
  where id = p_user_id
  for update;

  if not found or v_password_hash is null then
    return null;
  end if;

  select handoff_expires_at into v_handoff_expires_at
  from public.verification_codes
  where user_id = p_user_id
    and purpose = 'reset_password'
    and verification_generation = p_generation
    and handoff_token_hash = p_handoff_token_hash
    and used_at is not null
    and handoff_consumed_at is null
    and verification_generation = (
      select max(latest.verification_generation)
      from public.verification_codes as latest
      where latest.user_id = p_user_id and latest.purpose = 'reset_password'
    )
  for update;

  v_now := clock_timestamp();

  if not found
    or v_handoff_expires_at is null
    or v_handoff_expires_at <= v_now
  then
    return null;
  end if;

  update public.verification_codes
  set used_at = coalesce(used_at, v_now),
      handoff_consumed_at = case
        when handoff_token_hash is not null then coalesce(handoff_consumed_at, v_now)
        else handoff_consumed_at
      end
  where user_id = p_user_id and purpose = 'reset_password';

  update public.users
  set password_hash = p_password_hash,
      auth_credential_version = auth_credential_version + 1
  where id = p_user_id
  returning auth_credential_version into v_new_credential_version;

  delete from public.auth_sessions where user_id = p_user_id;
  return v_new_credential_version;
end;
$function$;

-- Retain the old signature for rollout compatibility, but make it use the same
-- latest-generation fence. New application code passes the observed generation
-- explicitly through consume_latest_password_reset_and_revoke_sessions_v1.
create or replace function public.consume_password_reset_and_revoke_sessions(
  p_user_id uuid,
  p_handoff_token_hash text,
  p_password_hash text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_generation bigint;
begin
  perform 1 from public.users where id = p_user_id for update;
  if not found then
    return null;
  end if;

  select verification_generation into v_generation
  from public.verification_codes
  where user_id = p_user_id
    and purpose = 'reset_password'
    and handoff_token_hash = p_handoff_token_hash
    and verification_generation = (
      select max(latest.verification_generation)
      from public.verification_codes as latest
      where latest.user_id = p_user_id and latest.purpose = 'reset_password'
    )
  for update;

  if not found then
    return null;
  end if;

  return public.consume_latest_password_reset_and_revoke_sessions_v1(
    p_user_id,
    v_generation,
    p_handoff_token_hash,
    p_password_hash
  );
end;
$function$;

-- All application access now goes through the fenced functions below. This
-- intentionally fails closed if the application and migration are mismatched.
revoke all on table public.verification_codes from public, anon, authenticated, service_role;

revoke all on function public.issue_auth_verification_code_v1(uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.issue_auth_verification_code_v1(uuid, text, text, timestamptz)
  to service_role;

revoke all on function public.get_latest_auth_verification_code_v1(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_latest_auth_verification_code_v1(uuid, text)
  to service_role;

revoke all on function public.finalize_auth_verification_attempt_v1(
  uuid, text, uuid, bigint, boolean, text, timestamptz, integer
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_auth_verification_attempt_v1(
  uuid, text, uuid, bigint, boolean, text, timestamptz, integer
) to service_role;

revoke all on function public.inspect_latest_auth_handoff_v1(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.inspect_latest_auth_handoff_v1(text, text)
  to service_role;

revoke all on function public.consume_signup_password_handoff_v1(uuid, bigint, text, text, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_signup_password_handoff_v1(uuid, bigint, text, text, bigint)
  to service_role;

revoke all on function public.consume_latest_password_reset_and_revoke_sessions_v1(uuid, bigint, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_latest_password_reset_and_revoke_sessions_v1(uuid, bigint, text, text)
  to service_role;

revoke all on function public.consume_password_reset_and_revoke_sessions(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_password_reset_and_revoke_sessions(uuid, text, text)
  to service_role;

commit;
