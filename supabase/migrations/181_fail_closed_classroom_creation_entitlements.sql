-- Controlled cutover from legacy classroom-creation compatibility to explicit
-- entitlements.
--
-- Applying this migration does not classify or restrict existing accounts and
-- does not enable strict enforcement or alter new-account behavior. Once the
-- separate service-only activation RPC verifies that every current account has
-- an explicit classrooms.create entitlement, that same cutover begins
-- transactionally provisioning future accounts as Free (join-only).

create table private.classroom_creation_entitlement_settings (
  singleton boolean primary key default true check (singleton),
  strict_enforcement_enabled boolean not null default false,
  activated_at timestamptz,
  activation_operation_id uuid unique,
  activated_by text check (
    activated_by is null
    or activated_by ~ '^[A-Za-z0-9._~:@-]{1,100}$'
  ),
  check (
    (not strict_enforcement_enabled
      and activated_at is null
      and activation_operation_id is null
      and activated_by is null)
    or
    (strict_enforcement_enabled
      and activated_at is not null
      and activation_operation_id is not null
      and activated_by is not null)
  )
);

insert into private.classroom_creation_entitlement_settings (singleton)
values (true);

alter table private.classroom_creation_entitlement_settings enable row level security;
revoke all on table private.classroom_creation_entitlement_settings
  from public, anon, authenticated, service_role;

create function public.provision_default_classroom_creation_entitlement_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_strict_enforcement_enabled boolean;
begin
  -- Serialize account creation with strict cutover activation. The row lock is
  -- held through the surrounding user-insert transaction. If a pre-cutover
  -- signup wins, activation observes the missing snapshot and refuses until the
  -- account is classified. If activation wins, the account cannot commit until
  -- its Free snapshot exists.
  select settings.strict_enforcement_enabled
  into v_strict_enforcement_enabled
  from private.classroom_creation_entitlement_settings settings
  where singleton
  for share;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'classroom_creation_cutover_settings_unavailable';
  end if;

  -- Before the controlled cutover, retain the same missing-snapshot
  -- compatibility as existing accounts. Activation both removes that fallback
  -- and starts default-Free provisioning at one transaction boundary.
  if not v_strict_enforcement_enabled then
    return new;
  end if;

  perform public.set_effective_feature_entitlement_v1(
    gen_random_uuid(),
    new.id,
    'classrooms.create',
    'plan',
    false,
    clock_timestamp(),
    null,
    0,
    'system:user-provisioning',
    'default_free_account_provisioning',
    0
  );

  return new;
end;
$$;

create trigger provision_default_classroom_creation_entitlement
after insert on public.users
for each row execute function public.provision_default_classroom_creation_entitlement_v1();

create function public.get_classroom_creation_entitlement_cutover_status_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'strict_enforcement_enabled', coalesce(settings.strict_enforcement_enabled, true),
    'activated_at', settings.activated_at,
    'activation_operation_id', settings.activation_operation_id,
    'activated_by', settings.activated_by,
    'account_count', (select count(*) from public.users),
    'classified_account_count', (
      select count(*)
      from public.users account
      where exists (
        select 1
        from public.effective_feature_entitlements entitlement
        where entitlement.subject_user_id = account.id
          and entitlement.feature_key = 'classrooms.create'
      )
    ),
    'unclassified_account_count', (
      select count(*)
      from public.users account
      where not exists (
        select 1
        from public.effective_feature_entitlements entitlement
        where entitlement.subject_user_id = account.id
          and entitlement.feature_key = 'classrooms.create'
      )
    )
  )
  from private.classroom_creation_entitlement_settings settings
  where settings.singleton;
$$;

create function public.activate_classroom_creation_entitlement_cutover_v1(
  p_operation_id uuid,
  p_actor_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings private.classroom_creation_entitlement_settings%rowtype;
  v_unclassified_count bigint;
begin
  if p_operation_id is null
    or p_actor_ref is null
    or p_actor_ref !~ '^[A-Za-z0-9._~:@-]{1,100}$'
  then
    raise exception using
      errcode = '22023',
      message = 'classroom_creation_cutover_request_invalid';
  end if;

  select * into v_settings
  from private.classroom_creation_entitlement_settings
  where singleton
  for update;

  if v_settings.singleton is null then
    raise exception using
      errcode = '55000',
      message = 'classroom_creation_cutover_settings_unavailable';
  end if;

  if v_settings.strict_enforcement_enabled then
    if v_settings.activation_operation_id = p_operation_id
      and v_settings.activated_by <> p_actor_ref
    then
      raise exception using
        errcode = '23505',
        message = 'classroom_creation_cutover_operation_conflict';
    end if;

    return jsonb_build_object(
      'strict_enforcement_enabled', true,
      'activated_at', v_settings.activated_at,
      'activation_operation_id', v_settings.activation_operation_id,
      'activated_by', v_settings.activated_by,
      'duplicate', v_settings.activation_operation_id = p_operation_id,
      'already_enabled', v_settings.activation_operation_id <> p_operation_id
    );
  end if;

  select count(*) into v_unclassified_count
  from public.users account
  where not exists (
    select 1
    from public.effective_feature_entitlements entitlement
    where entitlement.subject_user_id = account.id
      and entitlement.feature_key = 'classrooms.create'
  );

  if v_unclassified_count <> 0 then
    raise exception using
      errcode = '55000',
      message = 'classroom_creation_cutover_incomplete',
      detail = 'Every account must have an explicit classrooms.create entitlement.';
  end if;

  update private.classroom_creation_entitlement_settings
  set strict_enforcement_enabled = true,
      activated_at = clock_timestamp(),
      activation_operation_id = p_operation_id,
      activated_by = p_actor_ref
  where singleton
  returning * into v_settings;

  return jsonb_build_object(
    'strict_enforcement_enabled', true,
    'activated_at', v_settings.activated_at,
    'activation_operation_id', v_settings.activation_operation_id,
    'activated_by', v_settings.activated_by,
    'duplicate', false,
    'already_enabled', false
  );
end;
$$;

create or replace function public.get_classroom_creation_access_v1(
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
  v_strict_enforcement_enabled boolean;
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

  select coalesce(settings.strict_enforcement_enabled, true)
  into v_strict_enforcement_enabled
  from private.classroom_creation_entitlement_settings settings
  where singleton;

  -- A missing or unreadable singleton is configuration corruption and must not
  -- reopen legacy creation.
  v_strict_enforcement_enabled := coalesce(v_strict_enforcement_enabled, true);

  select count(*)::integer into v_active_count
  from public.classrooms
  where teacher_id = p_subject_user_id
    and archived_at is null;

  if v_entitlement.subject_user_id is null then
    if v_strict_enforcement_enabled or exists (
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

create or replace function public.assert_classroom_creation_allowed_v1(
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
  v_strict_enforcement_enabled boolean;
begin
  if p_subject_user_id is null or p_at is null then
    raise exception using
      errcode = '22023',
      message = 'classroom_creation_access_request_invalid';
  end if;

  -- Keep the established subject-first lock order used by ordinary and
  -- Blueprint creation, then hold the shared cutover lock through the caller's
  -- transaction. A classroom admitted under legacy compatibility must finish
  -- before activation commits.
  perform public.lock_effective_feature_entitlement_v1(
    p_subject_user_id,
    'classrooms.create'
  );

  select settings.strict_enforcement_enabled
  into v_strict_enforcement_enabled
  from private.classroom_creation_entitlement_settings settings
  where singleton
  for share;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'classroom_creation_entitlement_unavailable';
  end if;

  select * into v_entitlement
  from public.effective_feature_entitlements
  where subject_user_id = p_subject_user_id
    and feature_key = 'classrooms.create';

  if v_entitlement.subject_user_id is null then
    if v_strict_enforcement_enabled or exists (
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

revoke all on function public.provision_default_classroom_creation_entitlement_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.get_classroom_creation_entitlement_cutover_status_v1()
  from public, anon, authenticated;
revoke all on function public.activate_classroom_creation_entitlement_cutover_v1(uuid, text)
  from public, anon, authenticated;

grant execute on function public.get_classroom_creation_entitlement_cutover_status_v1()
  to service_role;
grant execute on function public.activate_classroom_creation_entitlement_cutover_v1(uuid, text)
  to service_role;
