-- Remove unused result variables while retaining all effects and row locks.
-- Applied migrations 214/215 remain immutable. Existing function ACLs,
-- SECURITY DEFINER and empty search_path are preserved by CREATE OR REPLACE.

create or replace function public.billing_start_trial_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(p_request->>'subject_user_id')::uuid; v_op uuid:=(p_request->>'operation_id')::uuid;
  p public.account_plans%rowtype; trial public.billing_trials%rowtype; v_now timestamptz:=clock_timestamp();
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  if v_user is null or v_op is null or not exists(select 1 from public.users where id=v_user and role='teacher') then
    raise exception using errcode='55000',message='billing_trial_ineligible'; end if;
  perform pg_advisory_xact_lock(hashtextextended('stripe-checkout-account:'||v_user::text,21120260926));
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_user::text,20620260924));
  select * into trial from public.billing_trials where subject_user_id=v_user;
  if found then
    if trial.operation_id=v_op then return public.billing_get_access_status_v1(jsonb_build_object('subject_user_id',v_user)); end if;
    raise exception using errcode='55000',message='billing_trial_ineligible';
  end if;
  select * into p from public.account_plans where subject_user_id=v_user for update;
  if not found or p.plan_key<>'free' or (p.management_source<>'legacy' and not coalesce(private.billing_checkout_plan_eligible_v1(v_user),false))
    or exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=v_user and is_current)
    or exists(select 1 from public.stripe_checkout_attempts where subject_user_id=v_user and status not in ('expired','bound')) then
    raise exception using errcode='55000',message='billing_trial_ineligible'; end if;
  insert into public.billing_trials(subject_user_id,operation_id,definition_id,started_at,ends_at)
    values(v_user,v_op,'pro-trial-v1',v_now,v_now+interval '720 hours');
  insert into public.billing_account_access(subject_user_id,source,trial_subject_user_id,starts_at,access_ends_at,end_reason,account_plan_revision)
    values(v_user,'trial',v_user,v_now,v_now+interval '720 hours','trial',p.revision)
    on conflict(subject_user_id) do update set source='trial',trial_subject_user_id=v_user,subscription_id=null,offering_version_id=null,
      starts_at=v_now,access_ends_at=v_now+interval '720 hours',end_reason='trial',paid_period_start=null,paid_through=null,last_paid_invoice_id=null,
      failed_renewal_invoice_id=null,expiry_applied_at=null,account_plan_revision=p.revision,revision=public.billing_account_access.revision+1;
  perform private.billing_write_access_v1(v_user,p.revision,'trial_started');
  insert into public.billing_lifecycle_audit(subject_user_id,operation_id,reason,next_state)
    values(v_user,v_op,'trial_started',public.billing_get_access_status_v1(jsonb_build_object('subject_user_id',v_user)));
  return public.billing_get_access_status_v1(jsonb_build_object('subject_user_id',v_user));
end; $$;

create or replace function public.billing_claim_checkout_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attempt public.stripe_checkout_attempts%rowtype; v_seconds integer := (p_request->>'lease_seconds')::integer;
  v_user uuid;
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
  perform 1 from public.account_plans where subject_user_id=v_user for update;
  if not found or not coalesce(private.billing_checkout_plan_eligible_v1(v_user),false)
    or v_attempt.reserved_plan_revision is null or not coalesce(private.billing_checkout_revision_matches_v1(v_user,v_attempt.reserved_plan_revision),false)
    or exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=v_user and is_current) then
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
    -- Keep the billing lock order: subscription identity/binding, then account plan.
    perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_user::text,20620260924));
    perform 1 from public.account_plans where subject_user_id=v_user for update;
    if not found or not coalesce(private.billing_checkout_plan_eligible_v1(v_user),false)
      or v_attempt.reserved_plan_revision is null or not coalesce(private.billing_checkout_revision_matches_v1(v_user,v_attempt.reserved_plan_revision),false)
      or exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=v_user and is_current) then
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

create or replace function public.billing_save_checkout_progress_v1(p_request jsonb)
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
  -- Retain any verified provider IDs for recovery, but stop further provider work
  -- if the account changed while the preceding network request was in flight.
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_attempt.subject_user_id::text,20620260924));
  perform 1 from public.account_plans where subject_user_id=v_attempt.subject_user_id for update;
  if not found or not coalesce(private.billing_checkout_plan_eligible_v1(v_attempt.subject_user_id),false)
    or v_attempt.reserved_plan_revision is null or not coalesce(private.billing_checkout_revision_matches_v1(v_attempt.subject_user_id,v_attempt.reserved_plan_revision),false)
    or exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=v_attempt.subject_user_id and is_current) then
    update public.stripe_checkout_attempts set status='attention',reason_code='checkout_account_plan_ineligible',
      lease_token=null,lease_expires_at=null where id=v_attempt.id;
    insert into public.stripe_checkout_audit(attempt_id,action,fencing_token,reason_code)
      values(v_attempt.id,'attention',v_attempt.fencing_token,'checkout_account_plan_ineligible');
    return jsonb_build_object('status','lost_claim');
  end if;
  insert into public.stripe_checkout_audit(attempt_id,action,fencing_token) values(v_attempt.id,'progress',v_attempt.fencing_token);
  return jsonb_build_object('status','saved');
end; $$;
