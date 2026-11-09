-- Live checkout persistence only. Binding never grants a paid entitlement.
-- The 215/217 checkout transition and revision fences are retained; live work
-- adds the pinned target, immutable offering scope and independent write gate.
begin;

alter table public.stripe_billing_customers
  drop constraint stripe_billing_customers_provider_mode_check,
  add constraint stripe_billing_customers_provider_mode_check check (provider_mode in ('test','live'));
alter table public.stripe_billing_subscription_bindings
  drop constraint stripe_billing_subscription_bindings_provider_mode_check,
  add constraint stripe_billing_subscription_bindings_provider_mode_check check (provider_mode in ('test','live'));
alter table public.stripe_checkout_attempts
  drop constraint stripe_checkout_attempts_stripe_session_id_check,
  add constraint stripe_checkout_attempts_stripe_session_id_check check (stripe_session_id ~ '^cs_(test|live)_[A-Za-z0-9]+$');

-- Every sandbox claim/writer already calls this share-locked boundary. Keep
-- the exclusion explicit after widening the shared persistence constraints.
create or replace function private.assert_stripe_billing_sandbox_enabled_v1()
returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from private.stripe_billing_settings where singleton
    and sandbox_enabled and provider_mode='test'
    and live_project_ref is null and live_stripe_account is null
    and not live_payment_lifecycle_enabled and not live_trial_lifecycle_enabled for share;
  if not found then
    raise exception using errcode='55000',message='stripe_billing_sandbox_disabled';
  end if;
end;
$$;

-- Keep the shared Free/trial/reentry policy, but never infer live provenance
-- from a trial plan label or a customer with the same provider identifier.
create function private.billing_live_checkout_plan_eligible_v1(p_subject uuid,p_project_ref text,p_stripe_account text)
returns boolean language sql stable set search_path='' as $$
  select coalesce(private.billing_checkout_plan_eligible_v1(p_subject),false)
    and exists(select 1 from public.users where id=p_subject and role='teacher')
    and not exists(select 1 from public.stripe_billing_customers where subject_user_id=p_subject
      and (provider_mode<>'live' or stripe_account<>p_stripe_account))
    and not exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=p_subject
      and (provider_mode<>'live' or stripe_account<>p_stripe_account))
    -- A direct school/manual (or unmatched plan) feature grant must never be
    -- replaced by checkout conversion. Match both immutable audit revisions.
    and exists(select 1 from public.account_plans plan
      join public.account_plan_audit plan_audit on plan_audit.subject_user_id=plan.subject_user_id
        and plan_audit.plan_revision=plan.revision and plan_audit.new_plan_key=plan.plan_key
      join public.effective_feature_entitlements entitlement on entitlement.subject_user_id=plan.subject_user_id
        and entitlement.feature_key='classrooms.create' and entitlement.revision=plan_audit.entitlement_revision
        and entitlement.quota_limit=plan_audit.new_classroom_limit
        and entitlement.source=case when plan.management_source='trial' then 'trial' else 'plan' end
      join public.effective_feature_entitlement_audit entitlement_audit
        on entitlement_audit.operation_id=plan_audit.operation_id
        and entitlement_audit.subject_user_id=entitlement.subject_user_id
        and entitlement_audit.feature_key=entitlement.feature_key
        and entitlement_audit.entitlement_revision=entitlement.revision
        and entitlement_audit.new_source=entitlement.source
        and entitlement_audit.new_enabled=entitlement.enabled
        and entitlement_audit.new_starts_at=entitlement.starts_at
        and entitlement_audit.new_expires_at is not distinct from entitlement.expires_at
        and entitlement_audit.new_quota_limit is not distinct from entitlement.quota_limit
      where plan.subject_user_id=p_subject)
    and exists(select 1 from public.account_plans plan where subject_user_id=p_subject and (
      (plan.management_source='legacy' and not exists(select 1 from public.billing_account_access where subject_user_id=p_subject))
      or (plan.management_source='trial'
        and private.billing_live_trial_source_matches_v1(p_subject,p_project_ref,p_stripe_account)
        and exists(select 1 from public.billing_account_access access
          join public.billing_trials trial on trial.subject_user_id=access.subject_user_id
          where access.subject_user_id=p_subject and access.trial_subject_user_id=p_subject
            and access.source='trial' and access.end_reason='trial'
            and access.account_plan_revision=plan.revision
            and access.starts_at=trial.started_at and access.access_ends_at=trial.ends_at))
      or (plan.management_source='billing' and exists(select 1 from public.billing_account_access access
        join public.stripe_billing_subscription_bindings binding on binding.id=access.subscription_id
        where access.subject_user_id=p_subject and access.source='paid'
          and access.account_plan_revision=plan.revision and binding.subject_user_id=p_subject
          and binding.provider_mode='live' and binding.stripe_account=p_stripe_account))
    ));
$$;


create function private.stripe_live_checkout_attempt_v1(p_attempt uuid,p_stripe_account text)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('attempt_id',a.id,'subject_user_id',a.subject_user_id,
    'offering',private.stripe_live_checkout_offering_v1(a.offering_version_id,p_stripe_account),'lookup_key',a.lookup_key,
    'status',a.status,'customer_id',a.stripe_customer_id,'session_id',a.stripe_session_id,
    'checkout_url',a.checkout_url,'success_url',a.success_url,'cancel_url',a.cancel_url,
    'write_deadline',a.write_deadline,'created_at',a.created_at,
    'access_confirmed',a.status='bound' and exists(
      select 1 from public.billing_account_access access
      join public.account_plans p on p.subject_user_id=access.subject_user_id
      join public.stripe_billing_subscription_bindings b on b.id=access.subscription_id
      join public.effective_feature_entitlements ent on ent.subject_user_id=p.subject_user_id and ent.feature_key='classrooms.create'
      where access.subject_user_id=a.subject_user_id and access.source='paid'
        and access.subscription_id=a.subscription_id and b.is_current
        and b.provider_mode='live' and b.stripe_account=p_stripe_account
        and b.subject_user_id=a.subject_user_id and b.offering_version_id=a.offering_version_id
        and access.offering_version_id=a.offering_version_id and p.billing_offering_version_id=a.offering_version_id
        and p.management_source='billing' and p.revision=access.account_plan_revision
        and ent.revision=access.entitlement_revision and ent.enabled
        and access.starts_at<=clock_timestamp() and access.access_ends_at>clock_timestamp()
        and (ent.starts_at is null or ent.starts_at<=clock_timestamp())
        and (ent.expires_at is null or ent.expires_at>clock_timestamp())))
  from public.stripe_checkout_attempts a where a.id=p_attempt and a.offering_version_id in (select id from public.stripe_billing_offering_versions where provider_mode='live' and stripe_account=p_stripe_account);
$$;

create function public.billing_reserve_live_checkout_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attempt public.stripe_checkout_attempts%rowtype; v_user uuid; v_id uuid; v_version uuid;
  v_offering jsonb; v_fingerprint text; v_customer public.stripe_billing_customers%rowtype; v_plan public.account_plans%rowtype; v_settings private.stripe_billing_settings%rowtype;
begin
  if jsonb_typeof(p_request) is distinct from 'object' then
    raise exception using errcode='22023',message='checkout_request_invalid';
  end if;
  if exists(select 1 from jsonb_object_keys(p_request) k(name) where name not in ('attempt_id','subject_user_id','offering','lookup_key','success_url','cancel_url')) then
    raise exception using errcode='22023',message='checkout_request_invalid';
  end if;
  v_settings:=private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  v_user := (p_request->>'subject_user_id')::uuid; v_id := (p_request->>'attempt_id')::uuid;
  v_version := (p_request->'offering'->>'offering_version_id')::uuid;
  if v_user is null or v_id is null or v_version is null
    or coalesce(length(p_request->>'lookup_key'),0) not between 1 and 200
    or p_request->>'success_url' is distinct from 'https://pika.codepet.ca/billing?checkout='||v_id::text||'&result=success'
    or p_request->>'cancel_url' is distinct from 'https://pika.codepet.ca/billing?checkout='||v_id::text||'&result=cancel'
    or not exists(select 1 from public.users where id=v_user and role='teacher') then
    raise exception using errcode='22023',message='checkout_request_invalid';
  end if;
  if exists(select 1 from public.stripe_checkout_attempts attempt where attempt.id=v_id
    and (attempt.subject_user_id<>v_user or not exists(
      select 1 from public.stripe_billing_offering_versions version where version.id=attempt.offering_version_id
        and version.provider_mode='live' and version.stripe_account=p_stripe_account))) then
    raise exception using errcode='23505',message='checkout_operation_conflict';
  end if;
  -- One account lock orders reservations; finalization takes this before the
  -- migration-209 subscription identity lock, and never reverses that order.
  perform pg_advisory_xact_lock(hashtextextended('stripe-checkout-account:'||v_user::text,21120260926));
  v_fingerprint := md5(jsonb_build_object('subject_user_id',v_user,'offering',p_request->'offering',
    'lookup_key',p_request->>'lookup_key','success_url',p_request->>'success_url','cancel_url',p_request->>'cancel_url')::text);
  select * into v_attempt from public.stripe_checkout_attempts where id=v_id for update;
  if found then
    if v_attempt.subject_user_id<>v_user or v_attempt.request_fingerprint<>v_fingerprint
      or not exists(select 1 from public.stripe_billing_offering_versions where id=v_attempt.offering_version_id
        and provider_mode='live' and stripe_account=p_stripe_account) then
      raise exception using errcode='23505',message='checkout_operation_conflict';
    end if;
    if v_attempt.status not in ('bound','expired','attention') then
      perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_user::text,20620260924));
      perform public.lock_effective_feature_entitlement_v1(v_user,'classrooms.create');
      select * into v_plan from public.account_plans where subject_user_id=v_user for update;
      if not found or not coalesce(private.billing_live_checkout_plan_eligible_v1(v_user,p_project_ref,p_stripe_account),false)
        or v_attempt.reserved_plan_revision is null or not coalesce(private.billing_checkout_revision_matches_v1(v_user,v_attempt.reserved_plan_revision),false)
        or exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=v_user and is_current) then
        update public.stripe_checkout_attempts set status='attention',reason_code='checkout_account_plan_ineligible',
          lease_token=null,lease_expires_at=null where id=v_id;
        insert into public.stripe_checkout_audit(attempt_id,action,fencing_token,reason_code)
          values(v_id,'attention',v_attempt.fencing_token,'checkout_account_plan_ineligible');
      end if;
    end if;
    return private.stripe_live_checkout_attempt_v1(v_id,p_stripe_account);
  end if;
  if not v_settings.live_checkout_admission_enabled or not v_settings.live_checkout_writes_enabled then
    raise exception using errcode='55000',message='billing_live_checkout_admission_unavailable';
  end if;
  if exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=v_user and is_current)
    or exists(select 1 from public.stripe_checkout_attempts where subject_user_id=v_user and status not in ('expired','bound')) then
    raise exception using errcode='23505',message='checkout_account_already_bound_or_pending';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_user::text,20620260924));
  perform public.lock_effective_feature_entitlement_v1(v_user,'classrooms.create');
  select * into v_plan from public.account_plans where subject_user_id=v_user for update;
  if not found or not coalesce(private.billing_live_checkout_plan_eligible_v1(v_user,p_project_ref,p_stripe_account),false) then
    raise exception using errcode='55000',message='checkout_account_plan_ineligible';
  end if;
  v_offering := public.billing_get_live_checkout_offering_v1(p_project_ref,p_stripe_account,jsonb_build_object(
    'offering_version_id',v_version,'stripe_account',p_request->'offering'->>'stripe_account'));
  if v_offering is null or v_offering is distinct from p_request->'offering'
    or p_request->>'lookup_key' is distinct from v_offering->>'catalog_key' then
    raise exception using errcode='55000',message='checkout_offering_unavailable_or_changed';
  end if;
  select * into v_customer from public.stripe_billing_customers where subject_user_id=v_user;
  if found and (v_customer.stripe_account<>p_stripe_account or v_customer.provider_mode<>'live') then
    raise exception using errcode='23505',message='checkout_customer_account_conflict';
  end if;
  insert into public.stripe_checkout_attempts(id,subject_user_id,offering_version_id,lookup_key,
    request_fingerprint,success_url,cancel_url,stripe_customer_id,reserved_plan_revision)
  values(v_id,v_user,v_version,p_request->>'lookup_key',v_fingerprint,p_request->>'success_url',
    p_request->>'cancel_url',v_customer.stripe_customer_id,v_plan.revision);
  insert into public.stripe_checkout_audit(attempt_id,action,fencing_token) values(v_id,'reserved',0);
  return private.stripe_live_checkout_attempt_v1(v_id,p_stripe_account);
end; $$;

create function public.billing_get_live_checkout_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(p_request) is distinct from 'object' then
    raise exception using errcode='22023',message='checkout_request_invalid';
  end if;
  if exists(select 1 from jsonb_object_keys(p_request) k(name) where name not in ('subject_user_id','attempt_id')) then
    raise exception using errcode='22023',message='checkout_request_invalid';
  end if;
  perform private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  return (select private.stripe_live_checkout_attempt_v1(id,p_stripe_account) from public.stripe_checkout_attempts
    where id=(p_request->>'attempt_id')::uuid and offering_version_id in (select id from public.stripe_billing_offering_versions where provider_mode='live' and stripe_account=p_stripe_account) and subject_user_id=(p_request->>'subject_user_id')::uuid);
end; $$;

create function public.billing_list_live_checkout_work_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_limit integer := (p_request->>'limit')::integer; v_ids jsonb;
begin
  if jsonb_typeof(p_request) is distinct from 'object' then
    raise exception using errcode='22023',message='checkout_request_invalid';
  end if;
  if exists(select 1 from jsonb_object_keys(p_request) k(name) where name not in ('limit')) then
    raise exception using errcode='22023',message='checkout_request_invalid';
  end if;
  perform private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  if v_limit is null or v_limit not between 1 and 10 then
    raise exception using errcode='22023',message='checkout_work_limit_invalid';
  end if;
  select coalesce(jsonb_agg(id),'[]'::jsonb) into v_ids from (
    select id from public.stripe_checkout_attempts where offering_version_id in (select id from public.stripe_billing_offering_versions where provider_mode='live' and stripe_account=p_stripe_account) and status in ('reserved','open','payment_pending')
      and next_attempt_at<=clock_timestamp() and (lease_expires_at is null or lease_expires_at<=clock_timestamp())
    order by next_attempt_at,id limit v_limit
  ) due;
  return jsonb_build_object('attempt_ids',v_ids);
end; $$;

create function public.billing_claim_live_checkout_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attempt public.stripe_checkout_attempts%rowtype; v_seconds integer := (p_request->>'lease_seconds')::integer;
  v_user uuid;
begin
  if jsonb_typeof(p_request) is distinct from 'object' then
    raise exception using errcode='22023',message='checkout_request_invalid';
  end if;
  if exists(select 1 from jsonb_object_keys(p_request) k(name) where name not in ('attempt_id','lease_seconds')) then
    raise exception using errcode='22023',message='checkout_request_invalid';
  end if;
  perform private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  if v_seconds is null or v_seconds not between 30 and 300 then
    raise exception using errcode='22023',message='checkout_lease_invalid';
  end if;
  select subject_user_id into v_user from public.stripe_checkout_attempts where id=(p_request->>'attempt_id')::uuid and offering_version_id in (select id from public.stripe_billing_offering_versions where provider_mode='live' and stripe_account=p_stripe_account);
  if v_user is null then return jsonb_build_object('status','not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended('stripe-checkout-account:'||v_user::text,21120260926));
  select * into v_attempt from public.stripe_checkout_attempts where id=(p_request->>'attempt_id')::uuid and offering_version_id in (select id from public.stripe_billing_offering_versions where provider_mode='live' and stripe_account=p_stripe_account) for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if v_attempt.status in ('bound','expired','attention') then return jsonb_build_object('status','terminal'); end if;
  if v_attempt.lease_expires_at>clock_timestamp() or v_attempt.next_attempt_at>clock_timestamp() then
    return jsonb_build_object('status','busy');
  end if;
  -- No provider work is issued on a resumed checkout whose initial Free plan changed.
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_user::text,20620260924));
  perform public.lock_effective_feature_entitlement_v1(v_user,'classrooms.create');
  perform 1 from public.account_plans where subject_user_id=v_user for update;
  if not found or not coalesce(private.billing_live_checkout_plan_eligible_v1(v_user,p_project_ref,p_stripe_account),false)
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
  return jsonb_build_object('status','claimed','attempt',private.stripe_live_checkout_attempt_v1(v_attempt.id,p_stripe_account),
    'lease_token',v_attempt.lease_token,'fencing_token',v_attempt.fencing_token,'lease_expires_at',v_attempt.lease_expires_at);
end; $$;

create function public.billing_save_live_checkout_progress_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attempt public.stripe_checkout_attempts%rowtype; v_account text; v_customer public.stripe_billing_customers%rowtype;
begin
  if jsonb_typeof(p_request) is distinct from 'object' then
    raise exception using errcode='22023',message='checkout_request_invalid';
  end if;
  if exists(select 1 from jsonb_object_keys(p_request) k(name) where name not in ('attempt_id','lease_token','fencing_token','customer_id','session_id','checkout_url')) then
    raise exception using errcode='22023',message='checkout_request_invalid';
  end if;
  perform private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  select * into v_attempt from public.stripe_checkout_attempts where id=(p_request->>'attempt_id')::uuid and offering_version_id in (select id from public.stripe_billing_offering_versions where provider_mode='live' and stripe_account=p_stripe_account) for update;
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
    insert into public.stripe_billing_customers(subject_user_id,stripe_account,provider_mode,stripe_customer_id)
      values(v_attempt.subject_user_id,v_account,'live',p_request->>'customer_id') on conflict(subject_user_id) do nothing;
    select * into v_customer from public.stripe_billing_customers where subject_user_id=v_attempt.subject_user_id;
    if v_customer.provider_mode<>'live' or v_customer.stripe_account<>v_account or v_customer.stripe_customer_id<>p_request->>'customer_id' then
      raise exception using errcode='23505',message='checkout_customer_conflict';
    end if;
    update public.stripe_checkout_attempts set stripe_customer_id=p_request->>'customer_id' where id=v_attempt.id;
  end if;
  if p_request ? 'session_id' then
    if coalesce(p_request->>'session_id','') !~ '^cs_live_[A-Za-z0-9]+$'
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
  perform public.lock_effective_feature_entitlement_v1(v_attempt.subject_user_id,'classrooms.create');
  perform 1 from public.account_plans where subject_user_id=v_attempt.subject_user_id for update;
  if not found or not coalesce(private.billing_live_checkout_plan_eligible_v1(v_attempt.subject_user_id,p_project_ref,p_stripe_account),false)
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

create function public.billing_finish_live_checkout_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attempt public.stripe_checkout_attempts%rowtype; v_user uuid; v_version public.stripe_billing_offering_versions%rowtype;
  v_binding public.stripe_billing_subscription_bindings%rowtype; v_outcome text := p_request->>'outcome';
  v_reason text := p_request->>'reason_code'; v_status text; v_retry integer;
begin
  if jsonb_typeof(p_request) is distinct from 'object' then
    raise exception using errcode='22023',message='checkout_request_invalid';
  end if;
  if exists(select 1 from jsonb_object_keys(p_request) k(name) where name not in ('attempt_id','lease_token','fencing_token','outcome','subscription_id','payment_pending','reason_code')) then
    raise exception using errcode='22023',message='checkout_request_invalid';
  end if;
  perform private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  if v_outcome is null or v_outcome not in ('pending','bound','expired','retry','attention','paused')
    or (v_reason is not null and v_reason not in ('provider_unavailable','provider_contract_invalid','write_recovery_expired','provider_writes_paused')) then
    raise exception using errcode='22023',message='checkout_outcome_invalid';
  end if;
  select subject_user_id into v_user from public.stripe_checkout_attempts where id=(p_request->>'attempt_id')::uuid and offering_version_id in (select id from public.stripe_billing_offering_versions where provider_mode='live' and stripe_account=p_stripe_account);
  if v_user is null then return jsonb_build_object('status','lost_claim'); end if;
  perform pg_advisory_xact_lock(hashtextextended('stripe-checkout-account:'||v_user::text,21120260926));
  select * into v_attempt from public.stripe_checkout_attempts where id=(p_request->>'attempt_id')::uuid and offering_version_id in (select id from public.stripe_billing_offering_versions where provider_mode='live' and stripe_account=p_stripe_account) for update;
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
      'stripe-binding:'||v_version.stripe_account||':live:'||(p_request->>'subscription_id'),20920260926));
    select * into v_binding from public.stripe_billing_subscription_bindings
      where stripe_account=v_version.stripe_account and provider_mode='live'
        and stripe_subscription_id=p_request->>'subscription_id' for update;
    -- Keep the billing lock order: subscription identity/binding, then account plan.
    perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_user::text,20620260924));
    perform public.lock_effective_feature_entitlement_v1(v_user,'classrooms.create');
    perform 1 from public.account_plans where subject_user_id=v_user for update;
    if not found or not coalesce(private.billing_live_checkout_plan_eligible_v1(v_user,p_project_ref,p_stripe_account),false)
      or v_attempt.reserved_plan_revision is null or not coalesce(private.billing_checkout_revision_matches_v1(v_user,v_attempt.reserved_plan_revision),false)
      or exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=v_user and is_current) then
      update public.stripe_checkout_attempts set status='attention',reason_code='checkout_account_plan_ineligible',
        lease_token=null,lease_expires_at=null where id=v_attempt.id;
      insert into public.stripe_checkout_audit(attempt_id,action,fencing_token,reason_code)
        values(v_attempt.id,'attention',v_attempt.fencing_token,'checkout_account_plan_ineligible');
      return jsonb_build_object('status','finished');
    end if;
    if v_attempt.lease_expires_at<=clock_timestamp() then
      return jsonb_build_object('status','lost_claim');
    end if;
    if v_binding.id is not null then
      if not v_binding.is_current or v_binding.subject_user_id<>v_user or v_binding.stripe_customer_id<>v_attempt.stripe_customer_id
        or v_binding.offering_version_id<>v_version.id then
        raise exception using errcode='23505',message='checkout_subscription_conflict';
      end if;
    else
      insert into public.stripe_billing_subscription_bindings(subject_user_id,stripe_account,provider_mode,
        stripe_customer_id,stripe_subscription_id,offering_version_id)
      values(v_user,v_version.stripe_account,'live',v_attempt.stripe_customer_id,p_request->>'subscription_id',v_version.id)
      returning * into v_binding;
    end if;
    -- Match migration 209's lock order: binding before inbox; the same identity
    -- advisory lock excludes webhook-before-binding races.
    update public.stripe_billing_event_inbox set subscription_id=v_binding.id,status='received',
      exception_code=null,next_attempt_at=clock_timestamp()
    where stripe_account=v_version.stripe_account and provider_mode='live' and status='exception'
      and stripe_subscription_id=v_binding.stripe_subscription_id
      and stripe_customer_id=v_binding.stripe_customer_id;
  end if;
  v_retry := case when v_outcome='paused' then v_attempt.retry_count when v_outcome='retry' then least(v_attempt.retry_count+1,5) else 0 end;
  v_status := case v_outcome when 'bound' then 'bound' when 'expired' then 'expired'
    when 'paused' then v_attempt.status when 'attention' then 'attention' when 'pending' then case when coalesce((p_request->>'payment_pending')::boolean,false) then 'payment_pending' else 'open' end
    when 'retry' then case when v_retry>=5 then 'attention' else v_attempt.status end end;
  update public.stripe_checkout_attempts set status=v_status,subscription_id=coalesce(v_binding.id,subscription_id),
    retry_count=v_retry,reason_code=case when v_outcome='paused' then reason_code else v_reason end,lease_token=null,lease_expires_at=null,
    next_attempt_at=clock_timestamp()+case when v_outcome='retry' then make_interval(secs=>(60*power(2,v_retry-1))::integer) else interval '1 minute' end
    where id=v_attempt.id;
  insert into public.stripe_checkout_audit(attempt_id,action,fencing_token,reason_code)
    values(v_attempt.id,v_status,v_attempt.fencing_token,v_reason);
  return jsonb_build_object('status','finished');
end; $$;

-- Called immediately before each external create. An affirmative result is
-- permission for that imminent call, not a durable lease on operator switches.
create function public.billing_authorize_live_checkout_write_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_settings private.stripe_billing_settings%rowtype; v_attempt public.stripe_checkout_attempts%rowtype;
begin
  if jsonb_typeof(p_request) is distinct from 'object' then
    raise exception using errcode='22023',message='checkout_fence_invalid';
  end if;
  if not (p_request ?& array['attempt_id','lease_token','fencing_token'])
    or exists(select 1 from jsonb_object_keys(p_request) as k(name)
      where k.name not in ('attempt_id','lease_token','fencing_token')) then
    raise exception using errcode='22023',message='checkout_fence_invalid';
  end if;
  v_settings:=private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  if not v_settings.live_checkout_writes_enabled then return false; end if;
  select attempt.* into v_attempt from public.stripe_checkout_attempts attempt
    join public.stripe_billing_offering_versions version on version.id=attempt.offering_version_id
      and version.provider_mode='live' and version.stripe_account=p_stripe_account
    where attempt.id=(p_request->>'attempt_id')::uuid for update of attempt;
  if not found or v_attempt.status not in ('reserved','open','payment_pending')
    or v_attempt.lease_token is null or v_attempt.lease_expires_at is null
    or v_attempt.lease_token is distinct from (p_request->>'lease_token')::uuid
    or v_attempt.fencing_token is distinct from (p_request->>'fencing_token')::bigint then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_attempt.subject_user_id::text,20620260924));
  perform public.lock_effective_feature_entitlement_v1(v_attempt.subject_user_id,'classrooms.create');
  perform 1 from public.account_plans where subject_user_id=v_attempt.subject_user_id for update;
  return found and v_attempt.write_deadline>clock_timestamp()
    and v_attempt.lease_expires_at>clock_timestamp()+interval '10 seconds'
    and coalesce(private.billing_live_checkout_plan_eligible_v1(v_attempt.subject_user_id,p_project_ref,p_stripe_account),false)
    and coalesce(private.billing_checkout_revision_matches_v1(v_attempt.subject_user_id,v_attempt.reserved_plan_revision),false)
    and not exists(select 1 from public.stripe_billing_subscription_bindings
      where subject_user_id=v_attempt.subject_user_id and is_current);
end;
$$;


revoke all on function private.billing_live_checkout_plan_eligible_v1(uuid,text,text),
  private.stripe_live_checkout_attempt_v1(uuid,text),
  public.billing_reserve_live_checkout_v1(text,text,jsonb),
  public.billing_get_live_checkout_v1(text,text,jsonb),
  public.billing_list_live_checkout_work_v1(text,text,jsonb),
  public.billing_claim_live_checkout_v1(text,text,jsonb),
  public.billing_save_live_checkout_progress_v1(text,text,jsonb),
  public.billing_finish_live_checkout_v1(text,text,jsonb),
  public.billing_authorize_live_checkout_write_v1(text,text,jsonb) from public,anon,authenticated,service_role;

grant execute on function public.billing_reserve_live_checkout_v1(text,text,jsonb),
  public.billing_get_live_checkout_v1(text,text,jsonb),
  public.billing_list_live_checkout_work_v1(text,text,jsonb),
  public.billing_claim_live_checkout_v1(text,text,jsonb),
  public.billing_save_live_checkout_progress_v1(text,text,jsonb),
  public.billing_finish_live_checkout_v1(text,text,jsonb),
  public.billing_authorize_live_checkout_write_v1(text,text,jsonb) to service_role;

-- Preserve the sandbox response, prioritization, limits, and original access
-- gate behavior. Live rows must not enter either candidate arm before limiting.
create or replace function public.billing_claim_subscription_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_seconds integer;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  -- Match the original integer parser before deciding whether to delegate
  -- validation. Text with whitespace or a plus sign is still a valid lease.
  v_seconds:=(p_request->>'lease_seconds')::integer;
  if p_request is null or jsonb_typeof(p_request)<>'object' or p_request->>'subscription_id' is null
    or v_seconds is null or v_seconds not between 30 and 300 then
    return private.billing_claim_subscription_before_upgrade_v1(p_request); end if;
  perform 1 from public.stripe_billing_subscription_bindings binding
    join public.stripe_billing_offering_versions version on version.id=binding.offering_version_id
      and version.provider_mode='test' and version.stripe_account=binding.stripe_account
    where binding.id=(p_request->>'subscription_id')::uuid and binding.provider_mode='test' for update of binding;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if exists(select 1 from public.billing_upgrade_operations where subscription_id=(p_request->>'subscription_id')::uuid
    and status in ('queued','retry','attention'))
    or private.billing_scheduled_closeout_due_v1((p_request->>'subscription_id')::uuid) then
    return jsonb_build_object('status','busy');
  end if;
  return private.billing_claim_subscription_before_upgrade_v1(p_request);
end; $$;

create or replace function public.billing_list_work_v1(p_request jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with params as (
    select greatest(1, least(50, coalesce((p_request->>'limit')::integer, 0))) as limit_value
  ), sandbox_bindings as not materialized (
    select binding.* from public.stripe_billing_subscription_bindings binding
    join public.stripe_billing_offering_versions version on version.id=binding.offering_version_id
      and version.provider_mode='test' and version.stripe_account=binding.stripe_account
    where binding.provider_mode='test' and binding.is_current
  ), candidates as (
    select 'event'::text as kind, event.id as event_inbox_id,
      event.subscription_id, event.next_attempt_at as due_at
    from public.stripe_billing_event_inbox event
    join sandbox_bindings binding on binding.id = event.subscription_id
    where event.provider_mode='test' and event.stripe_account=binding.stripe_account
      and event.status in ('received', 'exception')
      and event.attempt_count < 5
      and event.next_attempt_at <= clock_timestamp()
      and (binding.lease_expires_at is null or binding.lease_expires_at <= clock_timestamp())
      and binding.reconcile_state in ('queued', 'retry')
      and (binding.reconcile_state = 'queued' or binding.next_reconcile_at <= clock_timestamp())
      and not exists(select 1 from public.billing_upgrade_operations upgrade
        where upgrade.subscription_id=binding.id and upgrade.status in ('queued','retry','attention'))
      and not private.billing_scheduled_closeout_due_v1(binding.id)
      and not exists(select 1 from public.billing_renewal_closeouts closeout
        where closeout.subscription_id=binding.id and closeout.status in ('queued','retry','attention'))
    union all
    select 'reconcile'::text, null::uuid, binding.id, binding.next_reconcile_at
    from sandbox_bindings binding
    where binding.reconcile_state in ('queued', 'retry')
      and binding.reconcile_attempt_count < 5
      and binding.next_reconcile_at <= clock_timestamp()
      and (binding.lease_expires_at is null or binding.lease_expires_at <= clock_timestamp())
      and not exists(select 1 from public.billing_upgrade_operations upgrade
        where upgrade.subscription_id=binding.id and upgrade.status in ('queued','retry','attention'))
      and not private.billing_scheduled_closeout_due_v1(binding.id)
      and not exists(select 1 from public.billing_renewal_closeouts closeout
        where closeout.subscription_id=binding.id and closeout.status in ('queued','retry','attention'))
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

commit;
