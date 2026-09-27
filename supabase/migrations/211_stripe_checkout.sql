-- Local Stripe test-mode checkout only. This migration never enables either gate.
-- A completed Checkout session binds identity; migration 209 still proves payment.
-- Repair the last migration-209 identity-lock correction for databases that
-- applied its earlier local version. Function bodies match immutable 209;
-- CREATE OR REPLACE retains their existing service-only execution grants.
create or replace function public.billing_bind_customer_v1(p_request jsonb)
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

create or replace function public.billing_record_event_v1(p_request jsonb)
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

create table public.stripe_billing_customers (
  subject_user_id uuid primary key references public.users(id) on delete restrict,
  stripe_account text not null check (stripe_account ~ '^acct_[A-Za-z0-9]+$'),
  provider_mode text not null default 'test' check (provider_mode = 'test'),
  stripe_customer_id text not null check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (stripe_account, provider_mode, stripe_customer_id)
);

create table public.stripe_checkout_attempts (
  id uuid primary key,
  subject_user_id uuid not null references public.users(id) on delete restrict,
  offering_version_id uuid not null references public.stripe_billing_offering_versions(id) on delete restrict,
  lookup_key text not null check (length(lookup_key) between 1 and 200),
  request_fingerprint text not null,
  success_url text not null,
  cancel_url text not null,
  status text not null default 'reserved' check (status in ('reserved','open','payment_pending','bound','expired','attention')),
  stripe_customer_id text check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_session_id text unique check (stripe_session_id ~ '^cs_test_[A-Za-z0-9]+$'),
  checkout_url text,
  subscription_id uuid references public.stripe_billing_subscription_bindings(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  -- An hour of safety below Stripe's minimum 24-hour idempotency retention.
  write_deadline timestamptz not null default (clock_timestamp() + interval '23 hours'),
  next_attempt_at timestamptz not null default clock_timestamp(),
  retry_count integer not null default 0 check (retry_count between 0 and 5),
  reason_code text,
  fencing_token bigint not null default 0 check (fencing_token >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  check ((lease_token is null) = (lease_expires_at is null)),
  check (stripe_session_id is null or stripe_customer_id is not null),
  check (status <> 'bound' or subscription_id is not null)
);
-- Attention retains the account reservation: unknown provider writes must not
-- be bypassed by creating another attempt/key after the retry horizon.
create unique index stripe_checkout_one_pending_account on public.stripe_checkout_attempts(subject_user_id)
  where status not in ('expired','bound');
create index stripe_checkout_due on public.stripe_checkout_attempts(next_attempt_at,id)
  where status in ('reserved','open','payment_pending');
create table public.stripe_checkout_audit (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references public.stripe_checkout_attempts(id),
  action text not null,
  fencing_token bigint not null,
  reason_code text,
  created_at timestamptz not null default clock_timestamp()
);

create function private.stripe_checkout_offering_v1(p_version uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('offering_version_id',v.id,'plan_key',o.plan_key,
    'stripe_account',v.stripe_account,'stripe_product_id',v.stripe_product_id,'stripe_price_id',v.stripe_price_id,
    'currency',v.currency,'interval',v.interval,'unit_amount',v.unit_amount,'classroom_limit',v.classroom_limit,
    'catalog_key',v.features->>'catalog_key')
  from public.stripe_billing_offering_versions v join public.stripe_billing_offerings o on o.id=v.offering_id
  where v.id=p_version and v.provider_mode='test';
$$;
create function private.stripe_checkout_attempt_v1(p_attempt uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('attempt_id',a.id,'subject_user_id',a.subject_user_id,
    'offering',private.stripe_checkout_offering_v1(a.offering_version_id),'lookup_key',a.lookup_key,
    'status',a.status,'customer_id',a.stripe_customer_id,'session_id',a.stripe_session_id,
    'checkout_url',a.checkout_url,'success_url',a.success_url,'cancel_url',a.cancel_url,
    'write_deadline',a.write_deadline,'created_at',a.created_at,
    'access_confirmed',exists(select 1 from public.account_plans p
      join public.stripe_billing_subscription_bindings b on b.id=a.subscription_id
      join public.stripe_billing_invoice_effects e on e.subscription_id=b.id and e.account_plan_revision=p.revision
      where p.subject_user_id=a.subject_user_id and p.management_source='billing'
        and p.billing_offering_version_id=a.offering_version_id and b.offering_version_id=a.offering_version_id
        and e.offering_version_id=a.offering_version_id and e.period_end>clock_timestamp()))
  from public.stripe_checkout_attempts a where a.id=p_attempt;
$$;

create function public.billing_get_checkout_offering_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  return (select private.stripe_checkout_offering_v1(v.id)
    from public.stripe_billing_offering_versions v
    join public.stripe_billing_offering_availability a on a.offering_version_id=v.id
    where v.id=(p_request->>'offering_version_id')::uuid and v.stripe_account=p_request->>'stripe_account'
      and v.features->>'catalog_key' is not null and v.ai_definition is null
      and a.is_available and (a.available_from is null or a.available_from <= clock_timestamp())
      and (a.available_until is null or a.available_until > clock_timestamp()));
end; $$;

create function public.billing_list_checkout_offerings_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_items jsonb;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  select coalesce(jsonb_agg(item),'[]'::jsonb) into v_items from (
    select private.stripe_checkout_offering_v1(v.id) as item
    from public.stripe_billing_offering_versions v
    join public.stripe_billing_offering_availability a on a.offering_version_id=v.id
    where v.stripe_account=p_request->>'stripe_account' and v.provider_mode='test'
      and v.features->>'catalog_key' is not null and v.ai_definition is null
      and a.is_available and (a.available_from is null or a.available_from <= clock_timestamp())
      and (a.available_until is null or a.available_until > clock_timestamp())
    order by v.id limit 101
  ) candidates;
  if jsonb_array_length(v_items)>100 then
    raise exception using errcode='55000',message='checkout_catalog_limit_exceeded';
  end if;
  return jsonb_build_object('items',v_items);
end; $$;

create function public.billing_get_checkout_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  return (select private.stripe_checkout_attempt_v1(id) from public.stripe_checkout_attempts
    where id=(p_request->>'attempt_id')::uuid and subject_user_id=(p_request->>'subject_user_id')::uuid);
end; $$;

create function public.billing_reserve_checkout_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attempt public.stripe_checkout_attempts%rowtype; v_user uuid; v_id uuid; v_version uuid;
  v_offering jsonb; v_fingerprint text; v_customer public.stripe_billing_customers%rowtype;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  v_user := (p_request->>'subject_user_id')::uuid; v_id := (p_request->>'attempt_id')::uuid;
  v_version := (p_request->'offering'->>'offering_version_id')::uuid;
  if v_user is null or v_id is null or v_version is null
    or coalesce(length(p_request->>'lookup_key'),0) not between 1 and 200
    or coalesce(p_request->>'success_url','') !~ '^http://(localhost|127[.]0[.]0[.]1|\[::1\])(:[0-9]+)?/billing[?]checkout='
    or coalesce(p_request->>'cancel_url','') !~ '^http://(localhost|127[.]0[.]0[.]1|\[::1\])(:[0-9]+)?/billing[?]checkout='
    or not exists(select 1 from public.users where id=v_user and role='teacher') then
    raise exception using errcode='22023',message='checkout_request_invalid';
  end if;
  -- One account lock orders reservations; finalization takes this before the
  -- migration-209 subscription identity lock, and never reverses that order.
  perform pg_advisory_xact_lock(hashtextextended('stripe-checkout-account:'||v_user::text,21120260926));
  v_fingerprint := md5(jsonb_build_object('subject_user_id',v_user,'offering',p_request->'offering',
    'lookup_key',p_request->>'lookup_key','success_url',p_request->>'success_url','cancel_url',p_request->>'cancel_url')::text);
  select * into v_attempt from public.stripe_checkout_attempts where id=v_id for update;
  if found then
    if v_attempt.subject_user_id<>v_user or v_attempt.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='checkout_operation_conflict';
    end if;
    return private.stripe_checkout_attempt_v1(v_id);
  end if;
  if exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=v_user)
    or exists(select 1 from public.stripe_checkout_attempts where subject_user_id=v_user and status not in ('expired','bound')) then
    raise exception using errcode='23505',message='checkout_account_already_bound_or_pending';
  end if;
  if not exists(select 1 from public.account_plans where subject_user_id=v_user) then
    raise exception using errcode='55000',message='checkout_account_plan_unavailable';
  end if;
  v_offering := public.billing_get_checkout_offering_v1(jsonb_build_object(
    'offering_version_id',v_version,'stripe_account',p_request->'offering'->>'stripe_account'));
  if v_offering is null or v_offering is distinct from p_request->'offering' then
    raise exception using errcode='55000',message='checkout_offering_unavailable_or_changed';
  end if;
  select * into v_customer from public.stripe_billing_customers where subject_user_id=v_user;
  if found and v_customer.stripe_account<>v_offering->>'stripe_account' then
    raise exception using errcode='23505',message='checkout_customer_account_conflict';
  end if;
  insert into public.stripe_checkout_attempts(id,subject_user_id,offering_version_id,lookup_key,
    request_fingerprint,success_url,cancel_url,stripe_customer_id)
  values(v_id,v_user,v_version,p_request->>'lookup_key',v_fingerprint,p_request->>'success_url',
    p_request->>'cancel_url',v_customer.stripe_customer_id);
  insert into public.stripe_checkout_audit(attempt_id,action,fencing_token) values(v_id,'reserved',0);
  return private.stripe_checkout_attempt_v1(v_id);
end; $$;

create function public.billing_list_checkout_work_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_limit integer := (p_request->>'limit')::integer; v_ids jsonb;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  if v_limit is null or v_limit not between 1 and 10 then
    raise exception using errcode='22023',message='checkout_work_limit_invalid';
  end if;
  select coalesce(jsonb_agg(id),'[]'::jsonb) into v_ids from (
    select id from public.stripe_checkout_attempts where status in ('reserved','open','payment_pending')
      and next_attempt_at<=clock_timestamp() and (lease_expires_at is null or lease_expires_at<=clock_timestamp())
    order by next_attempt_at,id limit v_limit
  ) due;
  return jsonb_build_object('attempt_ids',v_ids);
end; $$;

create function public.billing_claim_checkout_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attempt public.stripe_checkout_attempts%rowtype; v_seconds integer := (p_request->>'lease_seconds')::integer;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  if v_seconds is null or v_seconds not between 30 and 300 then
    raise exception using errcode='22023',message='checkout_lease_invalid';
  end if;
  select * into v_attempt from public.stripe_checkout_attempts where id=(p_request->>'attempt_id')::uuid for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if v_attempt.status in ('bound','expired','attention') then return jsonb_build_object('status','terminal'); end if;
  if v_attempt.lease_expires_at>clock_timestamp() or v_attempt.next_attempt_at>clock_timestamp() then
    return jsonb_build_object('status','busy');
  end if;
  update public.stripe_checkout_attempts set lease_token=gen_random_uuid(),
    fencing_token=fencing_token+1,lease_expires_at=clock_timestamp()+make_interval(secs=>v_seconds)
    where id=v_attempt.id returning * into v_attempt;
  return jsonb_build_object('status','claimed','attempt',private.stripe_checkout_attempt_v1(v_attempt.id),
    'lease_token',v_attempt.lease_token,'fencing_token',v_attempt.fencing_token,'lease_expires_at',v_attempt.lease_expires_at);
end; $$;

create function public.billing_save_checkout_progress_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attempt public.stripe_checkout_attempts%rowtype; v_account text; v_customer public.stripe_billing_customers%rowtype;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  select * into v_attempt from public.stripe_checkout_attempts where id=(p_request->>'attempt_id')::uuid for update;
  if not found or v_attempt.lease_token is null or v_attempt.lease_expires_at is null
    or p_request->>'lease_token' is null or coalesce((p_request->>'fencing_token')::bigint,0)<1
    or v_attempt.lease_token is distinct from (p_request->>'lease_token')::uuid
    or v_attempt.fencing_token is distinct from (p_request->>'fencing_token')::bigint
    or v_attempt.lease_expires_at<=clock_timestamp() or v_attempt.status in ('bound','expired','attention') then
    return jsonb_build_object('status','lost_claim');
  end if;
  if p_request ? 'customer_id' then
    if coalesce(p_request->>'customer_id','') !~ '^cus_[A-Za-z0-9]+$'
      or (v_attempt.stripe_customer_id is not null and v_attempt.stripe_customer_id<>p_request->>'customer_id') then
      raise exception using errcode='23505',message='checkout_customer_conflict';
    end if;
    select stripe_account into v_account from public.stripe_billing_offering_versions where id=v_attempt.offering_version_id;
    insert into public.stripe_billing_customers(subject_user_id,stripe_account,stripe_customer_id)
      values(v_attempt.subject_user_id,v_account,p_request->>'customer_id') on conflict(subject_user_id) do nothing;
    select * into v_customer from public.stripe_billing_customers where subject_user_id=v_attempt.subject_user_id;
    if v_customer.stripe_account<>v_account or v_customer.stripe_customer_id<>p_request->>'customer_id' then
      raise exception using errcode='23505',message='checkout_customer_conflict';
    end if;
    update public.stripe_checkout_attempts set stripe_customer_id=p_request->>'customer_id' where id=v_attempt.id;
  end if;
  if p_request ? 'session_id' then
    if coalesce(p_request->>'session_id','') !~ '^cs_test_[A-Za-z0-9]+$'
      or (v_attempt.stripe_session_id is not null and v_attempt.stripe_session_id<>p_request->>'session_id')
      or (p_request->>'checkout_url' is not null and p_request->>'checkout_url' !~ '^https://checkout[.]stripe[.]com/') then
      raise exception using errcode='23505',message='checkout_session_conflict';
    end if;
    update public.stripe_checkout_attempts set stripe_session_id=p_request->>'session_id',
      checkout_url=p_request->>'checkout_url',status='open' where id=v_attempt.id;
  end if;
  insert into public.stripe_checkout_audit(attempt_id,action,fencing_token) values(v_attempt.id,'progress',v_attempt.fencing_token);
  return jsonb_build_object('status','saved');
end; $$;

create function public.billing_finish_checkout_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attempt public.stripe_checkout_attempts%rowtype; v_user uuid; v_version public.stripe_billing_offering_versions%rowtype;
  v_binding public.stripe_billing_subscription_bindings%rowtype; v_outcome text := p_request->>'outcome';
  v_reason text := p_request->>'reason_code'; v_status text; v_retry integer;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  if v_outcome is null or v_outcome not in ('pending','bound','expired','retry','attention')
    or (v_reason is not null and v_reason not in ('provider_unavailable','provider_contract_invalid','write_recovery_expired')) then
    raise exception using errcode='22023',message='checkout_outcome_invalid';
  end if;
  select subject_user_id into v_user from public.stripe_checkout_attempts where id=(p_request->>'attempt_id')::uuid;
  if v_user is null then return jsonb_build_object('status','lost_claim'); end if;
  perform pg_advisory_xact_lock(hashtextextended('stripe-checkout-account:'||v_user::text,21120260926));
  select * into v_attempt from public.stripe_checkout_attempts where id=(p_request->>'attempt_id')::uuid for update;
  if v_attempt.lease_token is null or v_attempt.lease_expires_at is null
    or p_request->>'lease_token' is null or coalesce((p_request->>'fencing_token')::bigint,0)<1
    or v_attempt.lease_token is distinct from (p_request->>'lease_token')::uuid
    or v_attempt.fencing_token is distinct from (p_request->>'fencing_token')::bigint
    or v_attempt.lease_expires_at<=clock_timestamp() or v_attempt.status in ('bound','expired','attention') then
    return jsonb_build_object('status','lost_claim');
  end if;
  if v_outcome in ('bound','expired','pending') and v_attempt.stripe_session_id is null then
    raise exception using errcode='22023',message='checkout_session_required';
  end if;
  if v_outcome='bound' then
    if coalesce(p_request->>'subscription_id','') !~ '^sub_[A-Za-z0-9]+$' then
      raise exception using errcode='22023',message='checkout_subscription_invalid';
    end if;
    select * into v_version from public.stripe_billing_offering_versions where id=v_attempt.offering_version_id;
    -- The exact reservation is the availability proof. Do not call the general
    -- bind RPC: a retired catalog must still honor this already-created attempt.
    perform pg_advisory_xact_lock(hashtextextended(
      'stripe-binding:'||v_version.stripe_account||':test:'||(p_request->>'subscription_id'),20920260926));
    select * into v_binding from public.stripe_billing_subscription_bindings
      where stripe_account=v_version.stripe_account and provider_mode='test'
        and stripe_subscription_id=p_request->>'subscription_id' for update;
    if found then
      if v_binding.subject_user_id<>v_user or v_binding.stripe_customer_id<>v_attempt.stripe_customer_id
        or v_binding.offering_version_id<>v_version.id then
        raise exception using errcode='23505',message='checkout_subscription_conflict';
      end if;
    else
      insert into public.stripe_billing_subscription_bindings(subject_user_id,stripe_account,provider_mode,
        stripe_customer_id,stripe_subscription_id,offering_version_id)
      values(v_user,v_version.stripe_account,'test',v_attempt.stripe_customer_id,p_request->>'subscription_id',v_version.id)
      returning * into v_binding;
    end if;
    -- Match migration 209's lock order: binding before inbox; the same identity
    -- advisory lock excludes webhook-before-binding races.
    update public.stripe_billing_event_inbox set subscription_id=v_binding.id,status='received',
      exception_code=null,next_attempt_at=clock_timestamp()
    where stripe_account=v_version.stripe_account and provider_mode='test' and status='exception'
      and stripe_subscription_id=v_binding.stripe_subscription_id
      and (stripe_customer_id is null or stripe_customer_id=v_binding.stripe_customer_id);
  end if;
  v_retry := case when v_outcome='retry' then least(v_attempt.retry_count+1,5) else 0 end;
  v_status := case v_outcome when 'bound' then 'bound' when 'expired' then 'expired'
    when 'attention' then 'attention' when 'pending' then case when coalesce((p_request->>'payment_pending')::boolean,false) then 'payment_pending' else 'open' end
    when 'retry' then case when v_retry>=5 then 'attention' else v_attempt.status end end;
  update public.stripe_checkout_attempts set status=v_status,subscription_id=coalesce(v_binding.id,subscription_id),
    retry_count=v_retry,reason_code=v_reason,lease_token=null,lease_expires_at=null,
    next_attempt_at=clock_timestamp()+case when v_outcome='retry' then make_interval(secs=>(60*power(2,v_retry-1))::integer) else interval '1 minute' end
    where id=v_attempt.id;
  insert into public.stripe_checkout_audit(attempt_id,action,fencing_token,reason_code)
    values(v_attempt.id,v_status,v_attempt.fencing_token,v_reason);
  return jsonb_build_object('status','finished');
end; $$;

alter table public.stripe_billing_customers enable row level security;
alter table public.stripe_checkout_attempts enable row level security;
alter table public.stripe_checkout_audit enable row level security;
revoke all on table public.stripe_billing_customers,public.stripe_checkout_attempts,public.stripe_checkout_audit from public,anon,authenticated,service_role;
grant select on table public.stripe_billing_customers,public.stripe_checkout_attempts,public.stripe_checkout_audit to service_role;
revoke all on function private.stripe_checkout_offering_v1(uuid),private.stripe_checkout_attempt_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function public.billing_get_checkout_offering_v1(jsonb),public.billing_list_checkout_offerings_v1(jsonb),
  public.billing_get_checkout_v1(jsonb),public.billing_reserve_checkout_v1(jsonb),public.billing_list_checkout_work_v1(jsonb),
  public.billing_claim_checkout_v1(jsonb),public.billing_save_checkout_progress_v1(jsonb),public.billing_finish_checkout_v1(jsonb)
  from public,anon,authenticated;
grant execute on function public.billing_get_checkout_offering_v1(jsonb),public.billing_list_checkout_offerings_v1(jsonb),
  public.billing_get_checkout_v1(jsonb),public.billing_reserve_checkout_v1(jsonb),public.billing_list_checkout_work_v1(jsonb),
  public.billing_claim_checkout_v1(jsonb),public.billing_save_checkout_progress_v1(jsonb),public.billing_finish_checkout_v1(jsonb)
  to service_role;
