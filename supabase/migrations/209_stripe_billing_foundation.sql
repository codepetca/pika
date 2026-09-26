-- Stripe billing foundation. This is deliberately test-mode only and remains
-- disabled until a separately authorized rollout changes the private setting.
-- It stores normalized provider references, never a raw webhook payload.

create table private.stripe_billing_settings (
  singleton boolean primary key default true check (singleton),
  sandbox_enabled boolean not null default false,
  provider_mode text not null default 'test' check (provider_mode = 'test')
);

insert into private.stripe_billing_settings (singleton) values (true);

alter table private.stripe_billing_settings enable row level security;
revoke all on table private.stripe_billing_settings from public, anon, authenticated, service_role;

create function private.assert_stripe_billing_sandbox_enabled_v1()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
begin
  select sandbox_enabled into v_enabled
  from private.stripe_billing_settings
  where singleton
  for share;

  if not found or not v_enabled then
    raise exception using errcode = '55000', message = 'stripe_billing_sandbox_disabled';
  end if;
end;
$$;

create table public.stripe_billing_offerings (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null unique check (plan_key in ('basic', 'plus', 'pro')),
  created_at timestamptz not null default clock_timestamp()
);

create table public.stripe_billing_offering_versions (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.stripe_billing_offerings (id),
  version integer not null check (version > 0),
  stripe_account text not null check (stripe_account ~ '^acct_[A-Za-z0-9]{1,255}$'),
  provider_mode text not null default 'test' check (provider_mode = 'test'),
  stripe_product_id text not null check (stripe_product_id ~ '^prod_[A-Za-z0-9]{1,255}$'),
  stripe_price_id text not null check (stripe_price_id ~ '^price_[A-Za-z0-9]{1,255}$'),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  unit_amount bigint not null check (unit_amount >= 0),
  interval text not null check (interval in ('month', 'year')),
  classroom_limit integer not null check (classroom_limit >= 0),
  features jsonb not null check (jsonb_typeof(features) = 'object'),
  ai_definition jsonb check (ai_definition is null or jsonb_typeof(ai_definition) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  unique (offering_id, version),
  unique (stripe_account, provider_mode, stripe_price_id)
);

create table public.stripe_billing_offering_availability (
  offering_version_id uuid primary key references public.stripe_billing_offering_versions (id),
  is_available boolean not null default false,
  available_from timestamptz,
  available_until timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  check (available_until is null or available_from is null or available_until > available_from)
);

create table public.stripe_billing_subscription_bindings (
  id uuid primary key default gen_random_uuid(),
  subject_user_id uuid not null references public.users (id) on delete restrict,
  stripe_account text not null check (stripe_account ~ '^acct_[A-Za-z0-9]{1,255}$'),
  provider_mode text not null default 'test' check (provider_mode = 'test'),
  stripe_customer_id text not null check (stripe_customer_id ~ '^cus_[A-Za-z0-9]{1,255}$'),
  stripe_subscription_id text not null check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]{1,255}$'),
  offering_version_id uuid not null references public.stripe_billing_offering_versions (id) on delete restrict,
  revision bigint not null default 1 check (revision > 0),
  fencing_token bigint not null default 0 check (fencing_token >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  next_reconcile_at timestamptz default clock_timestamp(),
  reconcile_state text not null default 'queued' check (reconcile_state in ('queued', 'retry', 'attention')),
  reconcile_attempt_count integer not null default 0 check (reconcile_attempt_count between 0 and 5),
  reconcile_attention_at timestamptz,
  last_provider_status text,
  last_period_start timestamptz,
  last_period_end timestamptz,
  last_exception_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (stripe_account, provider_mode, stripe_customer_id),
  unique (stripe_account, provider_mode, stripe_subscription_id),
  unique (subject_user_id),
  check ((lease_token is null) = (lease_expires_at is null)),
  check (last_period_end is null or last_period_start is null or last_period_end > last_period_start)
);

create table public.stripe_billing_event_inbox (
  id uuid primary key default gen_random_uuid(),
  stripe_account text not null check (stripe_account ~ '^acct_[A-Za-z0-9]{1,255}$'),
  provider_mode text not null default 'test' check (provider_mode = 'test'),
  stripe_event_id text not null check (stripe_event_id ~ '^evt_[A-Za-z0-9]{1,255}$'),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  event_type text not null check (event_type ~ '^[A-Za-z0-9._-]{1,120}$'),
  event_created_at timestamptz,
  subscription_id uuid references public.stripe_billing_subscription_bindings (id) on delete restrict,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_invoice_id text,
  stripe_payment_intent_id text,
  status text not null default 'received' check (status in ('received', 'completed', 'exception', 'attention')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  attention_at timestamptz,
  exception_code text,
  next_attempt_at timestamptz,
  received_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique (stripe_account, provider_mode, stripe_event_id)
);

create index stripe_billing_event_inbox_due on public.stripe_billing_event_inbox (status, next_attempt_at, received_at)
  where status in ('received', 'exception');
create index stripe_billing_subscription_bindings_reconcile_due on public.stripe_billing_subscription_bindings (next_reconcile_at);

create index stripe_billing_event_inbox_recovery_due
  on public.stripe_billing_event_inbox (next_attempt_at, received_at, id)
  where status in ('received', 'exception');
create index stripe_billing_subscription_recovery_due
  on public.stripe_billing_subscription_bindings (next_reconcile_at, id)
  where reconcile_state in ('queued', 'retry');

create table public.stripe_billing_invoice_effects (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.stripe_billing_subscription_bindings (id) on delete restrict,
  stripe_account text not null,
  stripe_invoice_id text not null,
  offering_version_id uuid not null references public.stripe_billing_offering_versions (id),
  account_plan_revision bigint not null check (account_plan_revision > 0),
  period_start timestamptz not null,
  period_end timestamptz not null,
  event_inbox_id uuid references public.stripe_billing_event_inbox (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (stripe_account, stripe_invoice_id),
  check (period_end > period_start)
);

create table public.stripe_billing_subscription_audit (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null,
  event_inbox_id uuid,
  outcome text not null check (outcome in ('paid', 'noop', 'exception', 'failed', 'requeued')),
  actor_ref text check (actor_ref is null or actor_ref ~ '^[A-Za-z0-9._~:@-]{1,100}$'),
  subscription_revision bigint not null check (subscription_revision > 0),
  account_plan_revision bigint,
  offering_version_id uuid,
  reason_code text,
  created_at timestamptz not null default clock_timestamp()
);

-- Catalog terms and provider identities are append-only. Availability is the
-- separate mutable publication surface.
create function public.guard_stripe_billing_immutable_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'stripe_billing_immutable_record';
end;
$$;

create trigger stripe_billing_offering_versions_immutable
  before update or delete on public.stripe_billing_offering_versions
  for each row execute function public.guard_stripe_billing_immutable_v1();
create trigger stripe_billing_offerings_immutable
  before update or delete on public.stripe_billing_offerings
  for each row execute function public.guard_stripe_billing_immutable_v1();

alter table public.account_plans
  add column management_source text not null default 'legacy'
    check (management_source in ('legacy', 'billing')),
  add column billing_offering_version_id uuid references public.stripe_billing_offering_versions (id);
alter table public.account_plan_audit
  drop constraint if exists account_plan_audit_new_classroom_limit_check,
  add constraint account_plan_audit_new_classroom_limit_check check (new_classroom_limit >= 0);

-- The legacy writer remains the manual and Free writer, but cannot overwrite a
-- subscription-managed plan. Billing writes through its fenced finish RPC.
create or replace function public.set_account_plan_v1(
  p_operation_id uuid, p_subject_user_id uuid, p_plan_key text, p_actor_ref text,
  p_reason_code text, p_expected_revision bigint default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.account_plans%rowtype; v_audit public.account_plan_audit%rowtype;
  v_entitlement_revision bigint; v_entitlement jsonb; v_plan_revision bigint;
  v_limit integer; v_fingerprint text;
begin
  if p_operation_id is null or p_subject_user_id is null or p_plan_key is null or p_plan_key not in ('free','basic','plus','pro')
    or p_actor_ref is null or p_actor_ref !~ '^[A-Za-z0-9._~:@-]{1,100}$'
    or p_reason_code is null or p_reason_code !~ '^[a-z][a-z0-9._-]{0,99}$'
    or (p_expected_revision is not null and p_expected_revision < 0) then
    raise exception using errcode = '22023', message = 'account_plan_request_invalid';
  end if;
  if not exists (select 1 from public.users where id = p_subject_user_id) then
    raise exception using errcode = 'P0002', message = 'account_plan_subject_not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-operation:' || p_operation_id::text, 20620260923));
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:' || p_subject_user_id::text, 20620260924));
  v_fingerprint := md5(jsonb_build_object('subject_user_id',p_subject_user_id,'plan_key',p_plan_key,'actor_ref',p_actor_ref,'reason_code',p_reason_code,'expected_revision',p_expected_revision)::text);
  select * into v_audit from public.account_plan_audit where operation_id = p_operation_id;
  if v_audit.id is not null then
    if v_audit.request_fingerprint <> v_fingerprint then raise exception using errcode = '23505', message = 'account_plan_operation_conflict'; end if;
    return jsonb_build_object('subject_user_id',v_audit.subject_user_id,'plan_key',v_audit.new_plan_key,'revision',v_audit.plan_revision,'classroom_limit',v_audit.new_classroom_limit,'entitlement_revision',v_audit.entitlement_revision,'duplicate',true);
  end if;
  select * into v_existing from public.account_plans where subject_user_id = p_subject_user_id for update;
  if v_existing.management_source = 'billing' then raise exception using errcode = '42501', message = 'billing_managed_account_plan'; end if;
  if coalesce(v_existing.revision,0) <> coalesce(p_expected_revision,0) then raise exception using errcode = '40001', message = 'account_plan_revision_conflict'; end if;
  v_limit := case p_plan_key when 'free' then 0 when 'basic' then 2 when 'plus' then 5 when 'pro' then 10 end;
  v_plan_revision := coalesce(v_existing.revision,0) + 1;
  select revision into v_entitlement_revision from public.effective_feature_entitlements where subject_user_id=p_subject_user_id and feature_key='classrooms.create';
  v_entitlement := public.set_effective_feature_entitlement_v1(p_operation_id,p_subject_user_id,'classrooms.create','plan',v_limit>0,clock_timestamp(),null,v_limit,p_actor_ref,p_reason_code,coalesce(v_entitlement_revision,0));
  insert into public.account_plans (subject_user_id,plan_key,revision,management_source,billing_offering_version_id)
  values (p_subject_user_id,p_plan_key,v_plan_revision,'legacy',null)
  on conflict (subject_user_id) do update set plan_key=excluded.plan_key,revision=excluded.revision,management_source='legacy',billing_offering_version_id=null,updated_at=clock_timestamp();
  insert into public.account_plan_audit (operation_id,subject_user_id,previous_plan_key,new_plan_key,new_classroom_limit,plan_revision,entitlement_revision,actor_ref,reason_code,request_fingerprint)
  values (p_operation_id,p_subject_user_id,v_existing.plan_key,p_plan_key,v_limit,v_plan_revision,(v_entitlement->>'revision')::bigint,p_actor_ref,p_reason_code,v_fingerprint);
  return jsonb_build_object('subject_user_id',p_subject_user_id,'plan_key',p_plan_key,'revision',v_plan_revision,'classroom_limit',v_limit,'entitlement_revision',(v_entitlement->>'revision')::bigint,'duplicate',false);
end; $$;

create function public.billing_register_offering_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_offering public.stripe_billing_offerings%rowtype; v_version public.stripe_billing_offering_versions%rowtype; v_created boolean := false;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  if p_request is null or jsonb_typeof(p_request) <> 'object'
    or coalesce(p_request->>'plan_key','') not in ('basic','plus','pro')
    or coalesce((p_request->>'version')::integer,0) < 1
    or coalesce(p_request->>'provider_mode','') <> 'test'
    or coalesce(p_request->>'stripe_account','') !~ '^acct_[A-Za-z0-9]{1,255}$'
    or coalesce(p_request->>'stripe_product_id','') !~ '^prod_[A-Za-z0-9]{1,255}$'
    or coalesce(p_request->>'stripe_price_id','') !~ '^price_[A-Za-z0-9]{1,255}$'
    or coalesce(p_request->>'currency','') !~ '^[a-z]{3}$'
    or coalesce((p_request->>'unit_amount')::bigint,-1) < 0
    or coalesce(p_request->>'interval','') not in ('month','year')
    or coalesce((p_request->>'classroom_limit')::integer,-1) < 0
    or jsonb_typeof(p_request->'features') <> 'object'
    or (p_request ? 'ai_definition' and p_request->'ai_definition' <> 'null'::jsonb and jsonb_typeof(p_request->'ai_definition') <> 'object') then
    raise exception using errcode='22023', message='stripe_billing_offering_request_invalid';
  end if;
  insert into public.stripe_billing_offerings (plan_key) values (p_request->>'plan_key')
  on conflict (plan_key) do nothing returning * into v_offering;
  if v_offering.id is null then
    select * into v_offering from public.stripe_billing_offerings where plan_key=p_request->>'plan_key';
  end if;
  select * into v_version from public.stripe_billing_offering_versions
  where stripe_account=p_request->>'stripe_account' and provider_mode='test' and stripe_price_id=p_request->>'stripe_price_id';
  if found then
    if to_jsonb(v_version) - 'id' - 'created_at' <> jsonb_build_object('offering_id',v_offering.id,'version',(p_request->>'version')::integer,'stripe_account',p_request->>'stripe_account','provider_mode','test','stripe_product_id',p_request->>'stripe_product_id','stripe_price_id',p_request->>'stripe_price_id','currency',p_request->>'currency','unit_amount',(p_request->>'unit_amount')::bigint,'interval',p_request->>'interval','classroom_limit',(p_request->>'classroom_limit')::integer,'features',p_request->'features','ai_definition',p_request->'ai_definition') then
      raise exception using errcode='23505', message='stripe_billing_offering_conflict';
    end if;
  else
    insert into public.stripe_billing_offering_versions (offering_id,version,stripe_account,provider_mode,stripe_product_id,stripe_price_id,currency,unit_amount,interval,classroom_limit,features,ai_definition)
    values (v_offering.id,(p_request->>'version')::integer,p_request->>'stripe_account','test',p_request->>'stripe_product_id',p_request->>'stripe_price_id',p_request->>'currency',(p_request->>'unit_amount')::bigint,p_request->>'interval',(p_request->>'classroom_limit')::integer,p_request->'features',nullif(p_request->'ai_definition','null'::jsonb))
    returning * into v_version;
    insert into public.stripe_billing_offering_availability (offering_version_id,is_available,available_from,available_until)
    values (v_version.id,coalesce((p_request->'availability'->>'is_available')::boolean,false),(p_request->'availability'->>'available_from')::timestamptz,(p_request->'availability'->>'available_until')::timestamptz);
    v_created := true;
  end if;
  return jsonb_build_object('offering_id',v_offering.id,'offering_version_id',v_version.id,'created',v_created);
end; $$;

create function public.billing_bind_customer_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_binding public.stripe_billing_subscription_bindings%rowtype; v_version public.stripe_billing_offering_versions%rowtype; v_created boolean := false;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  if p_request is null or jsonb_typeof(p_request) <> 'object' or coalesce(p_request->>'provider_mode','') <> 'test'
    or (p_request->>'subject_user_id') is null or (p_request->>'offering_version_id') is null
    or coalesce(p_request->>'stripe_account','') !~ '^acct_[A-Za-z0-9]{1,255}$'
    or coalesce(p_request->>'stripe_customer_id','') !~ '^cus_[A-Za-z0-9]{1,255}$'
    or coalesce(p_request->>'stripe_subscription_id','') !~ '^sub_[A-Za-z0-9]{1,255}$'
    or coalesce(p_request->>'stripe_price_id','') !~ '^price_[A-Za-z0-9]{1,255}$' then
    raise exception using errcode='22023', message='stripe_billing_binding_request_invalid';
  end if;
  select * into v_version from public.stripe_billing_offering_versions where id=(p_request->>'offering_version_id')::uuid;
  if not found or v_version.stripe_account <> p_request->>'stripe_account' or v_version.stripe_price_id <> p_request->>'stripe_price_id' then
    raise exception using errcode='22023', message='stripe_billing_binding_offering_mismatch';
  end if;
  -- Serialize identity creation with early webhook intake before either lookup.
  perform pg_advisory_xact_lock(hashtextextended(
    'stripe-binding:' || (p_request->>'stripe_account') || ':test:' || (p_request->>'stripe_subscription_id'),
    20920260926
  ));
  select * into v_binding from public.stripe_billing_subscription_bindings where stripe_account=p_request->>'stripe_account' and provider_mode='test' and stripe_subscription_id=p_request->>'stripe_subscription_id' for update;
  if found then
    if v_binding.subject_user_id <> (p_request->>'subject_user_id')::uuid or v_binding.stripe_customer_id <> p_request->>'stripe_customer_id' or v_binding.offering_version_id <> v_version.id then
      raise exception using errcode='23505', message='stripe_billing_binding_conflict';
    end if;
  else
    if not exists (select 1 from public.account_plans where subject_user_id=(p_request->>'subject_user_id')::uuid) then
      raise exception using errcode='55000', message='stripe_billing_account_plan_unavailable';
    end if;
    if not exists (
      select 1 from public.stripe_billing_offering_availability availability
      where availability.offering_version_id=v_version.id and availability.is_available
        and (availability.available_from is null or availability.available_from <= clock_timestamp())
        and (availability.available_until is null or availability.available_until > clock_timestamp())
    ) then
      raise exception using errcode='55000', message='stripe_billing_offering_unavailable';
    end if;
    insert into public.stripe_billing_subscription_bindings (subject_user_id,stripe_account,provider_mode,stripe_customer_id,stripe_subscription_id,offering_version_id)
    values ((p_request->>'subject_user_id')::uuid,p_request->>'stripe_account','test',p_request->>'stripe_customer_id',p_request->>'stripe_subscription_id',v_version.id) returning * into v_binding;
    v_created := true;
  end if;
  update public.stripe_billing_event_inbox
  set subscription_id=v_binding.id, status='received', exception_code=null, next_attempt_at=clock_timestamp()
  where stripe_account=v_binding.stripe_account and provider_mode='test' and status='exception'
    and stripe_subscription_id=v_binding.stripe_subscription_id
    and (stripe_customer_id is null or stripe_customer_id=v_binding.stripe_customer_id);
  return jsonb_build_object('subscription_id',v_binding.id,'created',v_created);
end; $$;

create function private.stripe_billing_retry_delay_v1(p_attempt_count integer)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case p_attempt_count
    when 1 then interval '1 minute'
    when 2 then interval '2 minutes'
    when 3 then interval '4 minutes'
    when 4 then interval '8 minutes'
    else interval '16 minutes'
  end;
$$;

create function private.stripe_billing_reason_allowed_v1(p_reason text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_reason = any (array[
    'provider_unavailable', 'provider_snapshot_invalid', 'provider_environment_invalid',
    'subscription_not_current', 'subscription_not_active', 'subscription_pending_update',
    'subscription_transition_unapproved', 'subscription_not_bound', 'subscription_item_invalid',
    'changed_price', 'invoice_missing', 'invoice_not_paid', 'invoice_paid_out_of_band',
    'invoice_payment_unapproved', 'invoice_not_bound', 'invoice_line_unverified',
    'financial_terms_unapproved'
  ]);
$$;

create function public.billing_record_event_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.stripe_billing_event_inbox%rowtype;
  v_binding public.stripe_billing_subscription_bindings%rowtype;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  if p_request is null
    or jsonb_typeof(p_request) <> 'object'
    or coalesce(p_request->>'payload_hash', '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_request->>'event_id', '') !~ '^evt_[A-Za-z0-9]{1,255}$'
    or coalesce(p_request->>'stripe_account', '') !~ '^acct_[A-Za-z0-9]{1,255}$'
    or coalesce(p_request->>'event_type', '') = ''
    or p_request->>'event_created_at' is null
    or p_request->>'received_at' is null
    or jsonb_typeof(p_request->'payload') <> 'object'
  then
    raise exception using errcode = '22023', message = 'stripe_billing_event_request_invalid';
  end if;

  -- The same identity lock as binding prevents a receipt from missing a
  -- concurrently created subscription and being stranded after its adoption scan.
  if p_request->'payload'->>'subscription_id' is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      'stripe-binding:' || (p_request->>'stripe_account') || ':test:' || (p_request->'payload'->>'subscription_id'),
      20920260926
    ));
  end if;

  select * into v_binding
  from public.stripe_billing_subscription_bindings
  where stripe_account = p_request->>'stripe_account'
    and provider_mode = 'test'
    and stripe_subscription_id = p_request->'payload'->>'subscription_id'
    and p_request->'payload'->>'customer_id' is not null
    and stripe_customer_id = p_request->'payload'->>'customer_id'
  for update;

  insert into public.stripe_billing_event_inbox (
    stripe_account, provider_mode, stripe_event_id, payload_hash, event_type,
    event_created_at, received_at, subscription_id, stripe_customer_id,
    stripe_subscription_id, stripe_invoice_id, status, exception_code,
    next_attempt_at
  ) values (
    p_request->>'stripe_account', 'test', p_request->>'event_id',
    p_request->>'payload_hash', p_request->>'event_type',
    (p_request->>'event_created_at')::timestamptz,
    (p_request->>'received_at')::timestamptz,
    v_binding.id, p_request->'payload'->>'customer_id',
    p_request->'payload'->>'subscription_id', p_request->'payload'->>'object_id',
    case when v_binding.id is null then 'exception' else 'received' end,
    case when v_binding.id is null then 'unbound_event' end,
    case when v_binding.id is null then null else clock_timestamp() end
  ) on conflict (stripe_account, provider_mode, stripe_event_id) do nothing
  returning * into v_event;

  if v_event.id is null then
    select * into v_event
    from public.stripe_billing_event_inbox
    where stripe_account = p_request->>'stripe_account'
      and provider_mode = 'test'
      and stripe_event_id = p_request->>'event_id';
    if v_event.payload_hash <> p_request->>'payload_hash' then
      raise exception using errcode = '23505', message = 'stripe_billing_event_conflict';
    end if;
    return jsonb_build_object('status', 'duplicate', 'event_inbox_id', v_event.id);
  end if;

  if v_binding.id is not null then
    update public.stripe_billing_event_inbox
    set status = 'attention', attention_at = clock_timestamp(),
        exception_code = 'superseded_by_verified_event', next_attempt_at = null
    where subscription_id = v_binding.id and status = 'exception'
      and id <> v_event.id;
    update public.stripe_billing_subscription_bindings
    set reconcile_state = 'queued', reconcile_attempt_count = 0,
        reconcile_attention_at = null, next_reconcile_at = clock_timestamp(),
        revision = revision + 1, updated_at = clock_timestamp()
    where id = v_binding.id;
  end if;
  return jsonb_build_object('status', 'accepted', 'event_inbox_id', v_event.id);
end;
$$;

create function public.billing_list_work_v1(p_request jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with params as (
    select greatest(1, least(50, coalesce((p_request->>'limit')::integer, 0))) as limit_value
  ), candidates as (
    select 'event'::text as kind, event.id as event_inbox_id,
      event.subscription_id, event.next_attempt_at as due_at
    from public.stripe_billing_event_inbox event
    join public.stripe_billing_subscription_bindings binding on binding.id = event.subscription_id
    where event.status in ('received', 'exception')
      and event.attempt_count < 5
      and event.next_attempt_at <= clock_timestamp()
      and (binding.lease_expires_at is null or binding.lease_expires_at <= clock_timestamp())
      and binding.reconcile_state in ('queued', 'retry')
      and (binding.reconcile_state = 'queued' or binding.next_reconcile_at <= clock_timestamp())
    union all
    select 'reconcile'::text, null::uuid, binding.id, binding.next_reconcile_at
    from public.stripe_billing_subscription_bindings binding
    where binding.reconcile_state in ('queued', 'retry')
      and binding.reconcile_attempt_count < 5
      and binding.next_reconcile_at <= clock_timestamp()
      and (binding.lease_expires_at is null or binding.lease_expires_at <= clock_timestamp())
  ), one_per_subscription as (
    select candidates.*, row_number() over (
      partition by subscription_id
      order by due_at, case kind when 'event' then 0 else 1 end, event_inbox_id nulls last
    ) as item_rank
    from candidates
  ), picked as (
    select * from one_per_subscription
    where item_rank = 1
    order by due_at, subscription_id
    limit (select limit_value from params)
  )
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object(
    'kind', picked.kind,
    'event_inbox_id', picked.event_inbox_id,
    'subscription_id', binding.id,
    'binding', jsonb_build_object(
      'subscription_id', binding.id,
      'subject_user_id', binding.subject_user_id,
      'stripe_account', binding.stripe_account,
      'stripe_customer_id', binding.stripe_customer_id,
      'stripe_subscription_id', binding.stripe_subscription_id,
      'offering_id', offering.id,
      'offering_version_id', version.id,
      'stripe_product_id', version.stripe_product_id,
      'stripe_price_id', version.stripe_price_id,
      'unit_amount', version.unit_amount,
      'plan_key', offering.plan_key,
      'currency', version.currency,
      'interval', version.interval,
      'provider_mode', binding.provider_mode
    ),
    'next_attempt_at', picked.due_at
  ) order by picked.due_at, picked.subscription_id), '[]'::jsonb))
  from picked
  join public.stripe_billing_subscription_bindings binding on binding.id = picked.subscription_id
  join public.stripe_billing_offering_versions version on version.id = binding.offering_version_id
  join public.stripe_billing_offerings offering on offering.id = version.offering_id;
$$;

create function public.billing_claim_subscription_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_binding public.stripe_billing_subscription_bindings%rowtype;
  v_plan public.account_plans%rowtype;
  v_version public.stripe_billing_offering_versions%rowtype;
  v_offering public.stripe_billing_offerings%rowtype;
  v_seconds integer;
  v_token uuid := gen_random_uuid();
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  v_seconds := (p_request->>'lease_seconds')::integer;
  if p_request is null or jsonb_typeof(p_request) <> 'object'
    or (p_request->>'subscription_id') is null
    or v_seconds is null or v_seconds not between 30 and 300 then
    raise exception using errcode = '22023', message = 'stripe_billing_claim_request_invalid';
  end if;
  select * into v_binding
  from public.stripe_billing_subscription_bindings
  where id = (p_request->>'subscription_id')::uuid
  for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_binding.reconcile_state = 'attention'
    or (v_binding.reconcile_state = 'retry' and v_binding.next_reconcile_at > clock_timestamp())
    or (v_binding.lease_expires_at is not null and v_binding.lease_expires_at > clock_timestamp()) then
    return jsonb_build_object('status', 'busy');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:' || v_binding.subject_user_id::text, 20620260924));
  select * into v_plan from public.account_plans where subject_user_id = v_binding.subject_user_id for update;
  if not found then raise exception using errcode = '55000', message = 'stripe_billing_account_plan_unavailable'; end if;
  select * into v_version from public.stripe_billing_offering_versions where id = v_binding.offering_version_id;
  select * into v_offering from public.stripe_billing_offerings where id = v_version.offering_id;
  update public.stripe_billing_subscription_bindings
  set lease_token = v_token, lease_expires_at = clock_timestamp() + make_interval(secs => v_seconds),
      fencing_token = fencing_token + 1, revision = revision + 1, updated_at = clock_timestamp()
  where id = v_binding.id returning * into v_binding;
  return jsonb_build_object(
    'status', 'claimed', 'subscription_id', v_binding.id, 'lease_token', v_token,
    'fencing_token', v_binding.fencing_token, 'lease_expires_at', v_binding.lease_expires_at,
    'subscription_revision', v_binding.revision, 'expected_account_plan_revision', v_plan.revision,
    'binding', jsonb_build_object(
      'subscription_id', v_binding.id, 'subject_user_id', v_binding.subject_user_id,
      'stripe_account', v_binding.stripe_account, 'stripe_customer_id', v_binding.stripe_customer_id,
      'stripe_subscription_id', v_binding.stripe_subscription_id, 'offering_id', v_offering.id,
      'offering_version_id', v_version.id, 'stripe_product_id', v_version.stripe_product_id,
      'stripe_price_id', v_version.stripe_price_id, 'unit_amount', v_version.unit_amount,
      'plan_key', v_offering.plan_key, 'currency', v_version.currency,
      'interval', v_version.interval, 'provider_mode', v_binding.provider_mode
    )
  );
end;
$$;

create function public.billing_finish_subscription_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_binding public.stripe_billing_subscription_bindings%rowtype;
  v_plan public.account_plans%rowtype;
  v_version public.stripe_billing_offering_versions%rowtype;
  v_entitlement_revision bigint;
  v_entitlement jsonb;
  v_event public.stripe_billing_event_inbox%rowtype;
  v_invoice public.stripe_billing_invoice_effects%rowtype;
  v_operation uuid := gen_random_uuid();
  v_outcome text;
  v_reason text;
  v_previous_plan_key text;
  v_binding_attempt integer;
  v_event_attempt integer;
  v_attention boolean;
  v_next_attempt timestamptz;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  v_outcome := p_request->>'outcome';
  v_reason := p_request->>'reason_code';
  if p_request is null or jsonb_typeof(p_request) <> 'object'
    or (p_request->>'subscription_id') is null or (p_request->>'lease_token') is null
    or coalesce(p_request->>'fencing_token', '') !~ '^[1-9][0-9]*$'
    or coalesce(p_request->>'expected_subscription_revision', '') !~ '^[1-9][0-9]*$'
    or coalesce(p_request->>'expected_account_plan_revision', '') !~ '^[1-9][0-9]*$'
    or v_outcome is null or v_outcome not in ('paid', 'noop', 'exception')
    or (v_outcome = 'exception' and (v_reason is null or not private.stripe_billing_reason_allowed_v1(v_reason)))
    or (v_reason is not null and v_reason !~ '^[a-z][a-z0-9._-]{0,99}$') then
    raise exception using errcode = '22023', message = 'stripe_billing_finish_request_invalid';
  end if;

  select * into v_binding from public.stripe_billing_subscription_bindings
  where id = (p_request->>'subscription_id')::uuid for update;
  if not found then return jsonb_build_object('status', 'rejected', 'retry_scheduled', false); end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:' || v_binding.subject_user_id::text, 20620260924));
  select * into v_plan from public.account_plans where subject_user_id = v_binding.subject_user_id for update;
  if not found then return jsonb_build_object('status', 'rejected', 'retry_scheduled', false); end if;
  if v_binding.lease_token is distinct from (p_request->>'lease_token')::uuid
    or v_binding.lease_expires_at <= clock_timestamp()
    or v_binding.fencing_token <> (p_request->>'fencing_token')::bigint
    or v_binding.revision <> (p_request->>'expected_subscription_revision')::bigint then
    return jsonb_build_object('status', 'lost_claim', 'retry_scheduled', true);
  end if;
  if v_plan.revision <> (p_request->>'expected_account_plan_revision')::bigint then
    return jsonb_build_object('status', 'plan_conflict', 'retry_scheduled', true);
  end if;
  if p_request->>'event_inbox_id' is not null then
    select * into v_event from public.stripe_billing_event_inbox
    where id = (p_request->>'event_inbox_id')::uuid and subscription_id = v_binding.id
    for update;
    if not found then return jsonb_build_object('status', 'rejected', 'retry_scheduled', false); end if;
  end if;

  if v_outcome = 'paid' then
    if p_request->>'invoice_id' is null or p_request->>'period_start' is null
      or p_request->>'period_end' is null
      or (p_request->>'period_end')::timestamptz <= (p_request->>'period_start')::timestamptz
      or (v_binding.last_period_end is not null and (p_request->>'period_end')::timestamptz < v_binding.last_period_end) then
      return jsonb_build_object('status', 'rejected', 'retry_scheduled', false);
    end if;
    perform pg_advisory_xact_lock(hashtextextended('stripe-invoice:' || v_binding.stripe_account || ':' || (p_request->>'invoice_id'), 20920260926));
    select * into v_invoice from public.stripe_billing_invoice_effects
    where stripe_account = v_binding.stripe_account and stripe_invoice_id = p_request->>'invoice_id';
    if found then
      if v_invoice.subscription_id <> v_binding.id
        or v_invoice.offering_version_id <> v_binding.offering_version_id
        or v_invoice.period_start <> (p_request->>'period_start')::timestamptz
        or v_invoice.period_end <> (p_request->>'period_end')::timestamptz then
        return jsonb_build_object('status', 'rejected', 'retry_scheduled', false);
      end if;
      if v_plan.management_source <> 'billing'
        or v_plan.billing_offering_version_id <> v_invoice.offering_version_id
        or v_plan.revision <> v_invoice.account_plan_revision
        or not exists (
          select 1
          from public.effective_feature_entitlements entitlement
          join public.stripe_billing_offering_versions version on version.id = v_invoice.offering_version_id
          where entitlement.subject_user_id = v_binding.subject_user_id
            and entitlement.feature_key = 'classrooms.create' and entitlement.source = 'plan'
            and entitlement.enabled = (version.classroom_limit > 0)
            and entitlement.quota_limit = version.classroom_limit
        ) then
        return jsonb_build_object('status', 'plan_conflict', 'retry_scheduled', true);
      end if;
      update public.stripe_billing_event_inbox set status = 'completed', completed_at = clock_timestamp(), next_attempt_at = null where id = v_event.id;
      update public.stripe_billing_subscription_bindings
      set lease_token = null, lease_expires_at = null, reconcile_state = 'queued',
          reconcile_attempt_count = 0, reconcile_attention_at = null,
          next_reconcile_at = clock_timestamp() + interval '1 day',
          revision = revision + 1, updated_at = clock_timestamp()
      where id = v_binding.id;
      return jsonb_build_object('status', 'replayed', 'retry_scheduled', false);
    end if;
    select * into v_version from public.stripe_billing_offering_versions where id = v_binding.offering_version_id;
    select revision into v_entitlement_revision from public.effective_feature_entitlements where subject_user_id = v_binding.subject_user_id and feature_key = 'classrooms.create';
    v_entitlement := public.set_effective_feature_entitlement_v1(v_operation, v_binding.subject_user_id, 'classrooms.create', 'plan', v_version.classroom_limit > 0, clock_timestamp(), null, v_version.classroom_limit, 'stripe:billing', 'stripe_paid', coalesce(v_entitlement_revision, 0));
    v_previous_plan_key := v_plan.plan_key;
    update public.account_plans set plan_key = (select plan_key from public.stripe_billing_offerings where id = v_version.offering_id), revision = revision + 1, management_source = 'billing', billing_offering_version_id = v_version.id, updated_at = clock_timestamp() where subject_user_id = v_binding.subject_user_id returning * into v_plan;
    insert into public.account_plan_audit (operation_id, subject_user_id, previous_plan_key, new_plan_key, new_classroom_limit, plan_revision, entitlement_revision, actor_ref, reason_code, request_fingerprint)
    values (v_operation, v_binding.subject_user_id, v_previous_plan_key, v_plan.plan_key, v_version.classroom_limit, v_plan.revision, (v_entitlement->>'revision')::bigint, 'stripe:billing', 'stripe_paid', md5(jsonb_build_object('subscription_id', v_binding.id, 'invoice_id', p_request->>'invoice_id')::text));
    insert into public.stripe_billing_invoice_effects (subscription_id, stripe_account, stripe_invoice_id, offering_version_id, account_plan_revision, period_start, period_end, event_inbox_id)
    values (v_binding.id, v_binding.stripe_account, p_request->>'invoice_id', v_version.id, v_plan.revision, (p_request->>'period_start')::timestamptz, (p_request->>'period_end')::timestamptz, v_event.id);
  end if;

  if v_outcome = 'exception' then
    v_binding_attempt := v_binding.reconcile_attempt_count + 1;
    v_event_attempt := case when v_event.id is null then null else v_event.attempt_count + 1 end;
    v_attention := v_reason <> 'provider_unavailable'
      or v_binding_attempt >= 5
      or coalesce(v_event_attempt, 0) >= 5;
    v_next_attempt := case when v_attention then null else clock_timestamp() + private.stripe_billing_retry_delay_v1(v_binding_attempt) end;
    update public.stripe_billing_subscription_bindings
    set lease_token = null, lease_expires_at = null, last_provider_status = coalesce(v_reason, 'unknown'),
        last_exception_code = coalesce(v_reason, 'unknown'),
        reconcile_state = case when v_attention then 'attention' else 'retry' end,
        reconcile_attempt_count = v_binding_attempt,
        reconcile_attention_at = case when v_attention then clock_timestamp() else null end,
        next_reconcile_at = v_next_attempt, revision = revision + 1, updated_at = clock_timestamp()
    where id = v_binding.id returning * into v_binding;
    if v_event.id is not null then
      update public.stripe_billing_event_inbox
      set status = case when v_attention then 'attention' else 'exception' end,
          attempt_count = v_event_attempt, exception_code = coalesce(v_reason, 'unknown'),
          attention_at = case when v_attention then clock_timestamp() else null end,
          next_attempt_at = v_next_attempt
      where id = v_event.id;
    end if;
  else
    update public.stripe_billing_subscription_bindings
    set lease_token = null, lease_expires_at = null,
        last_provider_status = case when v_outcome = 'paid' then 'paid' else coalesce(v_reason, 'unknown') end,
        last_period_start = case when v_outcome = 'paid' then (p_request->>'period_start')::timestamptz else last_period_start end,
        last_period_end = case when v_outcome = 'paid' then (p_request->>'period_end')::timestamptz else last_period_end end,
        last_exception_code = null, reconcile_state = 'queued', reconcile_attempt_count = 0,
        reconcile_attention_at = null, next_reconcile_at = clock_timestamp() + interval '1 day',
        revision = revision + 1, updated_at = clock_timestamp()
    where id = v_binding.id returning * into v_binding;
    if v_event.id is not null then
      update public.stripe_billing_event_inbox
      set status = 'completed', exception_code = null, next_attempt_at = null,
          completed_at = clock_timestamp()
      where id = v_event.id;
    end if;
  end if;
  insert into public.stripe_billing_subscription_audit (subscription_id, event_inbox_id, outcome, subscription_revision, account_plan_revision, offering_version_id, reason_code)
  values (v_binding.id, v_event.id, v_outcome, v_binding.revision,
    case when v_outcome = 'paid' then v_plan.revision else null end,
    case when v_outcome = 'paid' then v_binding.offering_version_id else null end, v_reason);
  return jsonb_build_object('status', 'applied', 'retry_scheduled', false);
end;
$$;

create function public.billing_fail_subscription_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_binding public.stripe_billing_subscription_bindings%rowtype;
  v_attempt integer;
  v_attention boolean;
  v_next_attempt timestamptz;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  if p_request is null or jsonb_typeof(p_request) <> 'object'
    or (p_request->>'subscription_id') is null or (p_request->>'lease_token') is null
    or coalesce(p_request->>'fencing_token', '') !~ '^[1-9][0-9]*$'
    or coalesce(p_request->>'expected_subscription_revision', '') !~ '^[1-9][0-9]*$'
    or coalesce(p_request->>'error_code', '') !~ '^[a-z][a-z0-9._-]{0,99}$' then
    raise exception using errcode = '22023', message = 'stripe_billing_fail_request_invalid';
  end if;
  select * into v_binding from public.stripe_billing_subscription_bindings
  where id = (p_request->>'subscription_id')::uuid for update;
  if not found or v_binding.lease_token is distinct from (p_request->>'lease_token')::uuid
    or v_binding.lease_expires_at <= clock_timestamp()
    or v_binding.fencing_token <> (p_request->>'fencing_token')::bigint
    or v_binding.revision <> (p_request->>'expected_subscription_revision')::bigint then
    return jsonb_build_object('status', 'lost_claim');
  end if;
  v_attempt := v_binding.reconcile_attempt_count + 1;
  v_attention := p_request->>'error_code' <> 'provider_unavailable' or v_attempt >= 5;
  v_next_attempt := case when v_attention then null else clock_timestamp() + private.stripe_billing_retry_delay_v1(v_attempt) end;
  update public.stripe_billing_subscription_bindings
  set lease_token = null, lease_expires_at = null,
      last_exception_code = p_request->>'error_code',
      reconcile_state = case when v_attention then 'attention' else 'retry' end,
      reconcile_attempt_count = v_attempt,
      reconcile_attention_at = case when v_attention then clock_timestamp() else null end,
      next_reconcile_at = v_next_attempt, revision = revision + 1, updated_at = clock_timestamp()
  where id = v_binding.id returning * into v_binding;
  insert into public.stripe_billing_subscription_audit (subscription_id, outcome, subscription_revision, reason_code)
  values (v_binding.id, 'failed', v_binding.revision, p_request->>'error_code');
  return jsonb_build_object('status', 'released', 'subscription_revision', v_binding.revision);
end;
$$;

create function public.billing_requeue_subscription_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_binding public.stripe_billing_subscription_bindings%rowtype;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  if p_request is null or jsonb_typeof(p_request) <> 'object'
    or (p_request->>'subscription_id') is null
    or coalesce(p_request->>'actor_ref', '') !~ '^[A-Za-z0-9._~:@-]{1,100}$'
    or coalesce(p_request->>'reason_code', '') !~ '^[a-z][a-z0-9._-]{0,99}$' then
    raise exception using errcode = '22023', message = 'stripe_billing_requeue_request_invalid';
  end if;
  select * into v_binding from public.stripe_billing_subscription_bindings
  where id = (p_request->>'subscription_id')::uuid for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_binding.lease_expires_at is not null and v_binding.lease_expires_at > clock_timestamp() then
    return jsonb_build_object('status', 'busy');
  end if;
  update public.stripe_billing_subscription_bindings
  set lease_token = null, lease_expires_at = null, reconcile_state = 'queued',
      reconcile_attempt_count = 0, reconcile_attention_at = null,
      next_reconcile_at = clock_timestamp(), revision = revision + 1,
      updated_at = clock_timestamp()
  where id = v_binding.id returning * into v_binding;
  update public.stripe_billing_event_inbox
  set status = 'received', attempt_count = 0, attention_at = null,
      exception_code = null, next_attempt_at = clock_timestamp()
  where subscription_id = v_binding.id and status = 'attention';
  insert into public.stripe_billing_subscription_audit (subscription_id, outcome, subscription_revision, reason_code, actor_ref)
  values (v_binding.id, 'requeued', v_binding.revision, p_request->>'reason_code', p_request->>'actor_ref');
  return jsonb_build_object('status', 'requeued');
end;
$$;

alter table public.stripe_billing_offerings enable row level security;
alter table public.stripe_billing_offering_versions enable row level security;
alter table public.stripe_billing_offering_availability enable row level security;
alter table public.stripe_billing_subscription_bindings enable row level security;
alter table public.stripe_billing_event_inbox enable row level security;
alter table public.stripe_billing_invoice_effects enable row level security;
alter table public.stripe_billing_subscription_audit enable row level security;
revoke all on table public.stripe_billing_offerings, public.stripe_billing_offering_versions, public.stripe_billing_offering_availability, public.stripe_billing_subscription_bindings, public.stripe_billing_event_inbox, public.stripe_billing_invoice_effects, public.stripe_billing_subscription_audit from public, anon, authenticated, service_role;
grant select on table public.stripe_billing_offerings, public.stripe_billing_offering_versions, public.stripe_billing_offering_availability, public.stripe_billing_subscription_bindings, public.stripe_billing_event_inbox, public.stripe_billing_invoice_effects, public.stripe_billing_subscription_audit to service_role;
revoke all on function private.assert_stripe_billing_sandbox_enabled_v1() from public, anon, authenticated, service_role;
revoke all on function public.billing_register_offering_v1(jsonb), public.billing_bind_customer_v1(jsonb), public.billing_record_event_v1(jsonb), public.billing_list_work_v1(jsonb), public.billing_claim_subscription_v1(jsonb), public.billing_finish_subscription_v1(jsonb), public.billing_fail_subscription_v1(jsonb) from public, anon, authenticated;
grant execute on function public.billing_register_offering_v1(jsonb), public.billing_bind_customer_v1(jsonb), public.billing_record_event_v1(jsonb), public.billing_list_work_v1(jsonb), public.billing_claim_subscription_v1(jsonb), public.billing_finish_subscription_v1(jsonb), public.billing_fail_subscription_v1(jsonb) to service_role;

revoke all on function private.stripe_billing_retry_delay_v1(integer) from public, anon, authenticated, service_role;
revoke all on function private.stripe_billing_reason_allowed_v1(text) from public, anon, authenticated, service_role;
revoke all on function public.billing_requeue_subscription_v1(jsonb) from public, anon, authenticated;
grant execute on function public.billing_requeue_subscription_v1(jsonb) to service_role;
