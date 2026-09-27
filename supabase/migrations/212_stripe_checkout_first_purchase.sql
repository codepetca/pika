-- First-purchase checkout supports an unchanged legacy Free assignment only.
-- Existing pending attempts have no proven reservation revision; leave it NULL so
-- resumption requires attention rather than inventing historical eligibility.
-- Signatures/ACLs stay unchanged. No gates, existing plans or entitlements change.
alter table public.stripe_checkout_attempts
  add column reserved_plan_revision bigint check (reserved_plan_revision > 0);

create or replace function public.billing_reserve_checkout_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attempt public.stripe_checkout_attempts%rowtype; v_user uuid; v_id uuid; v_version uuid;
  v_offering jsonb; v_fingerprint text; v_customer public.stripe_billing_customers%rowtype; v_plan public.account_plans%rowtype;
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
    if v_attempt.status not in ('bound','expired','attention') then
      perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_user::text,20620260924));
      select * into v_plan from public.account_plans where subject_user_id=v_user for update;
      if not found or v_plan.plan_key<>'free' or v_plan.management_source<>'legacy'
        or v_attempt.reserved_plan_revision is null or v_plan.revision<>v_attempt.reserved_plan_revision
        or exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=v_user) then
        update public.stripe_checkout_attempts set status='attention',reason_code='checkout_account_plan_ineligible',
          lease_token=null,lease_expires_at=null where id=v_id;
        insert into public.stripe_checkout_audit(attempt_id,action,fencing_token,reason_code)
          values(v_id,'attention',v_attempt.fencing_token,'checkout_account_plan_ineligible');
      end if;
    end if;
    return private.stripe_checkout_attempt_v1(v_id);
  end if;
  if exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=v_user)
    or exists(select 1 from public.stripe_checkout_attempts where subject_user_id=v_user and status not in ('expired','bound')) then
    raise exception using errcode='23505',message='checkout_account_already_bound_or_pending';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_user::text,20620260924));
  select * into v_plan from public.account_plans where subject_user_id=v_user for update;
  if not found or v_plan.plan_key<>'free' or v_plan.management_source<>'legacy' then
    raise exception using errcode='55000',message='checkout_account_plan_ineligible';
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
    request_fingerprint,success_url,cancel_url,stripe_customer_id,reserved_plan_revision)
  values(v_id,v_user,v_version,p_request->>'lookup_key',v_fingerprint,p_request->>'success_url',
    p_request->>'cancel_url',v_customer.stripe_customer_id,v_plan.revision);
  insert into public.stripe_checkout_audit(attempt_id,action,fencing_token) values(v_id,'reserved',0);
  return private.stripe_checkout_attempt_v1(v_id);
end; $$;

create or replace function public.billing_claim_checkout_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attempt public.stripe_checkout_attempts%rowtype; v_seconds integer := (p_request->>'lease_seconds')::integer;
  v_plan public.account_plans%rowtype; v_user uuid;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  if v_seconds is null or v_seconds not between 30 and 300 then
    raise exception using errcode='22023',message='checkout_lease_invalid';
  end if;
  select subject_user_id into v_user from public.stripe_checkout_attempts where id=(p_request->>'attempt_id')::uuid;
  if v_user is null then return jsonb_build_object('status','not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended('stripe-checkout-account:'||v_user::text,21120260926));
  select * into v_attempt from public.stripe_checkout_attempts where id=(p_request->>'attempt_id')::uuid for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if v_attempt.status in ('bound','expired','attention') then return jsonb_build_object('status','terminal'); end if;
  if v_attempt.lease_expires_at>clock_timestamp() or v_attempt.next_attempt_at>clock_timestamp() then
    return jsonb_build_object('status','busy');
  end if;
  -- No provider work is issued on a resumed checkout whose initial Free plan changed.
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_user::text,20620260924));
  select * into v_plan from public.account_plans where subject_user_id=v_user for update;
  if not found or v_plan.plan_key<>'free' or v_plan.management_source<>'legacy'
    or v_attempt.reserved_plan_revision is null or v_plan.revision<>v_attempt.reserved_plan_revision
    or exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=v_user) then
    update public.stripe_checkout_attempts set status='attention',reason_code='checkout_account_plan_ineligible',
      lease_token=null,lease_expires_at=null where id=v_attempt.id;
    insert into public.stripe_checkout_audit(attempt_id,action,fencing_token,reason_code)
      values(v_attempt.id,'attention',v_attempt.fencing_token,'checkout_account_plan_ineligible');
    return jsonb_build_object('status','terminal');
  end if;
  update public.stripe_checkout_attempts set lease_token=gen_random_uuid(),
    fencing_token=fencing_token+1,lease_expires_at=clock_timestamp()+make_interval(secs=>v_seconds)
    where id=v_attempt.id returning * into v_attempt;
  return jsonb_build_object('status','claimed','attempt',private.stripe_checkout_attempt_v1(v_attempt.id),
    'lease_token',v_attempt.lease_token,'fencing_token',v_attempt.fencing_token,'lease_expires_at',v_attempt.lease_expires_at);
end; $$;

create or replace function public.billing_finish_checkout_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attempt public.stripe_checkout_attempts%rowtype; v_user uuid; v_version public.stripe_billing_offering_versions%rowtype;
  v_binding public.stripe_billing_subscription_bindings%rowtype; v_outcome text := p_request->>'outcome';
  v_plan public.account_plans%rowtype; v_reason text := p_request->>'reason_code'; v_status text; v_retry integer;
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
    -- Keep the billing lock order: subscription identity/binding, then account plan.
    perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_user::text,20620260924));
    select * into v_plan from public.account_plans where subject_user_id=v_user for update;
    if not found or v_plan.plan_key<>'free' or v_plan.management_source<>'legacy'
      or v_attempt.reserved_plan_revision is null or v_plan.revision<>v_attempt.reserved_plan_revision
      or exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=v_user) then
      update public.stripe_checkout_attempts set status='attention',reason_code='checkout_account_plan_ineligible',
        lease_token=null,lease_expires_at=null where id=v_attempt.id;
      insert into public.stripe_checkout_audit(attempt_id,action,fencing_token,reason_code)
        values(v_attempt.id,'attention',v_attempt.fencing_token,'checkout_account_plan_ineligible');
      return jsonb_build_object('status','finished');
    end if;
    if v_binding.id is not null then
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

create or replace function public.billing_claim_subscription_v1(p_request jsonb)
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
  -- Only the first paid effect of a checkout-backed binding uses this gate.
  -- Never lock the attempt here: checkout finalization locks attempt before binding.
  -- A change after this claim is also rejected by finish's account-plan revision fence.
  if exists(select 1 from public.stripe_checkout_attempts where subscription_id=v_binding.id)
    and not exists(select 1 from public.stripe_billing_invoice_effects where subscription_id=v_binding.id)
    and (v_plan.plan_key<>'free' or v_plan.management_source<>'legacy'
      or not exists(select 1 from public.stripe_checkout_attempts a where a.subscription_id=v_binding.id
        and a.status='bound' and a.reserved_plan_revision=v_plan.revision)) then
    update public.stripe_billing_subscription_bindings set reconcile_state='attention',
      reconcile_attention_at=clock_timestamp(),last_exception_code='subscription_transition_unapproved',
      lease_token=null,lease_expires_at=null,next_reconcile_at=null,revision=revision+1,updated_at=clock_timestamp()
      where id=v_binding.id returning * into v_binding;
    insert into public.stripe_billing_subscription_audit(subscription_id,outcome,subscription_revision,
      account_plan_revision,offering_version_id,reason_code)
      values(v_binding.id,'exception',v_binding.revision,v_plan.revision,v_binding.offering_version_id,'subscription_transition_unapproved');
    return jsonb_build_object('status','busy');
  end if;
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

create or replace function public.billing_save_checkout_progress_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attempt public.stripe_checkout_attempts%rowtype; v_account text; v_customer public.stripe_billing_customers%rowtype; v_plan public.account_plans%rowtype;
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
  -- Retain any verified provider IDs for recovery, but stop further provider work
  -- if the account changed while the preceding network request was in flight.
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_attempt.subject_user_id::text,20620260924));
  select * into v_plan from public.account_plans where subject_user_id=v_attempt.subject_user_id for update;
  if not found or v_plan.plan_key<>'free' or v_plan.management_source<>'legacy'
    or v_attempt.reserved_plan_revision is null or v_plan.revision<>v_attempt.reserved_plan_revision
    or exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=v_attempt.subject_user_id) then
    update public.stripe_checkout_attempts set status='attention',reason_code='checkout_account_plan_ineligible',
      lease_token=null,lease_expires_at=null where id=v_attempt.id;
    insert into public.stripe_checkout_audit(attempt_id,action,fencing_token,reason_code)
      values(v_attempt.id,'attention',v_attempt.fencing_token,'checkout_account_plan_ineligible');
    return jsonb_build_object('status','lost_claim');
  end if;
  insert into public.stripe_checkout_audit(attempt_id,action,fencing_token) values(v_attempt.id,'progress',v_attempt.fencing_token);
  return jsonb_build_object('status','saved');
end; $$;
