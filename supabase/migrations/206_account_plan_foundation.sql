-- Dormant account-level plan assignments. A plan assignment derives the
-- classrooms.create snapshot in the same transaction; it does not backfill
-- existing users, activate strict enforcement, or introduce billing.

create table public.account_plans (
  subject_user_id uuid primary key references public.users (id) on delete cascade,
  plan_key text not null check (plan_key in ('free', 'basic', 'plus', 'pro')),
  revision bigint not null check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.account_plan_audit (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  -- Retain the change history when an account is deleted.
  subject_user_id uuid not null,
  previous_plan_key text check (
    previous_plan_key is null or previous_plan_key in ('free', 'basic', 'plus', 'pro')
  ),
  new_plan_key text not null check (new_plan_key in ('free', 'basic', 'plus', 'pro')),
  new_classroom_limit integer not null check (new_classroom_limit in (0, 2, 5, 10)),
  plan_revision bigint not null check (plan_revision > 0),
  entitlement_revision bigint not null check (entitlement_revision > 0),
  actor_ref text not null check (actor_ref ~ '^[A-Za-z0-9._~:@-]{1,100}$'),
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9._-]{0,99}$'),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{32}$'),
  created_at timestamptz not null default clock_timestamp()
);

create index account_plan_audit_subject_created
  on public.account_plan_audit (subject_user_id, created_at desc);

alter table public.account_plans enable row level security;
alter table public.account_plan_audit enable row level security;
revoke all on table public.account_plans from public, anon, authenticated, service_role;
revoke all on table public.account_plan_audit from public, anon, authenticated, service_role;
grant select on table public.account_plans to service_role;
grant select on table public.account_plan_audit to service_role;

create function public.set_account_plan_v1(
  p_operation_id uuid,
  p_subject_user_id uuid,
  p_plan_key text,
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
  v_existing public.account_plans%rowtype;
  v_audit public.account_plan_audit%rowtype;
  v_entitlement_revision bigint;
  v_entitlement jsonb;
  v_plan_revision bigint;
  v_limit integer;
  v_fingerprint text;
begin
  if p_operation_id is null
    or p_subject_user_id is null
    or p_plan_key is null
    or p_plan_key not in ('free', 'basic', 'plus', 'pro')
    or p_actor_ref is null
    or p_actor_ref !~ '^[A-Za-z0-9._~:@-]{1,100}$'
    or p_reason_code is null
    or p_reason_code !~ '^[a-z][a-z0-9._-]{0,99}$'
    or (p_expected_revision is not null and p_expected_revision < 0)
  then
    raise exception using errcode = '22023', message = 'account_plan_request_invalid';
  end if;

  if not exists (select 1 from public.users where id = p_subject_user_id) then
    raise exception using errcode = 'P0002', message = 'account_plan_subject_not_found';
  end if;

  -- Lock order: operation ID, subject plan, then the existing entitlement
  -- setter's operation and feature locks. No other plan writer takes these in
  -- reverse order. The entitlement setter detects concurrent direct edits.
  perform pg_advisory_xact_lock(hashtextextended(
    'account-plan-operation:' || p_operation_id::text, 20620260923
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'account-plan-subject:' || p_subject_user_id::text, 20620260924
  ));

  v_fingerprint := md5(jsonb_build_object(
    'subject_user_id', p_subject_user_id,
    'plan_key', p_plan_key,
    'actor_ref', p_actor_ref,
    'reason_code', p_reason_code,
    'expected_revision', p_expected_revision
  )::text);

  select * into v_audit
  from public.account_plan_audit
  where operation_id = p_operation_id;

  if v_audit.id is not null then
    if v_audit.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = 'account_plan_operation_conflict';
    end if;
    return jsonb_build_object(
      'subject_user_id', v_audit.subject_user_id,
      'plan_key', v_audit.new_plan_key,
      'revision', v_audit.plan_revision,
      'classroom_limit', v_audit.new_classroom_limit,
      'entitlement_revision', v_audit.entitlement_revision,
      'duplicate', true
    );
  end if;

  select * into v_existing
  from public.account_plans
  where subject_user_id = p_subject_user_id
  for update;

  if coalesce(v_existing.revision, 0) <> coalesce(p_expected_revision, 0) then
    raise exception using errcode = '40001', message = 'account_plan_revision_conflict';
  end if;

  -- No caller supplies a quota. The plan is the only input to this mapping.
  v_limit := case p_plan_key
    when 'free' then 0
    when 'basic' then 2
    when 'plus' then 5
    when 'pro' then 10
  end;
  v_plan_revision := coalesce(v_existing.revision, 0) + 1;

  select revision into v_entitlement_revision
  from public.effective_feature_entitlements
  where subject_user_id = p_subject_user_id
    and feature_key = 'classrooms.create';

  -- The existing setter handles subject validation, snapshot revision,
  -- idempotency and entitlement audit. Any failure rolls this whole call back.
  v_entitlement := public.set_effective_feature_entitlement_v1(
    p_operation_id,
    p_subject_user_id,
    'classrooms.create',
    'plan',
    v_limit > 0,
    clock_timestamp(),
    null,
    v_limit,
    p_actor_ref,
    p_reason_code,
    coalesce(v_entitlement_revision, 0)
  );

  insert into public.account_plans (subject_user_id, plan_key, revision)
  values (p_subject_user_id, p_plan_key, v_plan_revision)
  on conflict (subject_user_id) do update
    set plan_key = excluded.plan_key,
        revision = excluded.revision,
        updated_at = clock_timestamp();

  insert into public.account_plan_audit (
    operation_id, subject_user_id, previous_plan_key, new_plan_key,
    new_classroom_limit, plan_revision, entitlement_revision, actor_ref, reason_code,
    request_fingerprint
  ) values (
    p_operation_id, p_subject_user_id, v_existing.plan_key, p_plan_key,
    v_limit, v_plan_revision, (v_entitlement ->> 'revision')::bigint,
    p_actor_ref, p_reason_code, v_fingerprint
  );

  return jsonb_build_object(
    'subject_user_id', p_subject_user_id,
    'plan_key', p_plan_key,
    'revision', v_plan_revision,
    'classroom_limit', v_limit,
    'entitlement_revision', (v_entitlement ->> 'revision')::bigint,
    'duplicate', false
  );
end;
$$;

revoke all on function public.set_account_plan_v1(uuid, uuid, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.set_account_plan_v1(uuid, uuid, text, text, text, bigint)
  to service_role;

-- After the separately controlled strict cutover, a new account gets both its
-- Free plan and Free creation snapshot atomically. Before cutover, signup
-- remains unchanged and this function returns without assigning anything.
create or replace function public.provision_default_classroom_creation_entitlement_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_strict_enforcement_enabled boolean;
begin
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

  if not v_strict_enforcement_enabled then
    return new;
  end if;

  perform public.set_account_plan_v1(
    gen_random_uuid(),
    new.id,
    'free',
    'system:user-provisioning',
    'default_free_account_provisioning',
    0
  );
  return new;
end;
$$;
