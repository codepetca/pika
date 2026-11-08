-- Project only customer-safe billing actions and immutable terms. These reads
-- are advisory; trial and checkout writes still validate under the account locks.
begin;

create function private.billing_trial_eligible_v1(p_subject uuid)
returns boolean language sql stable set search_path='' as $$
  select exists(
    select 1 from public.account_plans plan join public.users teacher on teacher.id=plan.subject_user_id
    where plan.subject_user_id=p_subject and teacher.role='teacher' and plan.plan_key='free'
      and (plan.management_source='legacy' or private.billing_checkout_plan_eligible_v1(p_subject))
      and not exists(select 1 from public.billing_trials where subject_user_id=p_subject)
      and not exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=p_subject and is_current)
      and not exists(select 1 from public.stripe_checkout_attempts
        where subject_user_id=p_subject and status not in ('expired','bound'))
  );
$$;

create function private.billing_customer_options_v1(p_subject uuid, p_at timestamptz)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object(
    'trial_available',private.billing_trial_eligible_v1(p_subject),
    'has_billing_customer',exists(select 1 from public.stripe_billing_customers
      where subject_user_id=p_subject and provider_mode='test'),
    'checkout_available',coalesce(private.billing_checkout_plan_eligible_v1(p_subject),false)
      and exists(select 1 from public.users where id=p_subject and role='teacher')
      and not exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=p_subject and is_current)
      and not exists(select 1 from public.stripe_checkout_attempts where subject_user_id=p_subject and status not in ('expired','bound')),
    'pending_checkout_id',(
      select attempt.id from public.stripe_checkout_attempts attempt
      where attempt.subject_user_id=p_subject
        and (attempt.status not in ('expired','bound') or (
          attempt.status='bound' and exists(
            select 1 from public.stripe_billing_subscription_bindings binding
            where binding.id=attempt.subscription_id and binding.subject_user_id=p_subject and binding.is_current
              and not exists(select 1 from public.stripe_billing_invoice_effects effect where effect.subscription_id=binding.id))))
      order by attempt.created_at desc,attempt.id desc limit 1
    ),
    'paid_terms',(
      select jsonb_build_object('currency',version.currency,'interval',version.interval,'unit_amount',version.unit_amount,
        'upgrade_available',access.end_reason='renewal_pending' and p_at<access.paid_through)
      from public.billing_account_access access
      join public.account_plans plan on plan.subject_user_id=access.subject_user_id and plan.revision=access.account_plan_revision
      join public.effective_feature_entitlements entitlement on entitlement.subject_user_id=plan.subject_user_id
        and entitlement.feature_key='classrooms.create' and entitlement.revision=access.entitlement_revision
      join public.stripe_billing_subscription_bindings binding on binding.id=access.subscription_id
        and binding.subject_user_id=access.subject_user_id and binding.is_current and binding.provider_mode='test'
      join public.stripe_billing_offering_versions version on version.id=access.offering_version_id
        and version.id=binding.offering_version_id and version.id=plan.billing_offering_version_id
        and version.stripe_account=binding.stripe_account and version.provider_mode=binding.provider_mode
      where access.subject_user_id=p_subject and access.source='paid' and plan.management_source='billing'
        and access.expiry_applied_at is null and p_at>=access.starts_at and p_at<access.access_ends_at
    )
  );
$$;

revoke all on function private.billing_trial_eligible_v1(uuid),
  private.billing_customer_options_v1(uuid,timestamptz) from public,anon,authenticated,service_role;

create or replace function public.billing_get_access_status_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(p_request->>'subject_user_id')::uuid; a public.billing_account_access%rowtype;
  p public.account_plans%rowtype; entitlement public.effective_feature_entitlements%rowtype; v_limit integer; v_plan text; v_state text; v_pending boolean; v_expired boolean;
  v_now timestamptz:=clock_timestamp(); customer_options jsonb:='{}'::jsonb;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  select * into p from public.account_plans where subject_user_id=v_user;
  if not found then raise exception using errcode='55000',message='billing_account_unavailable'; end if;
  select * into entitlement from public.effective_feature_entitlements where subject_user_id=v_user and feature_key='classrooms.create';
  select * into a from public.billing_account_access where subject_user_id=v_user;
  if p_request->'include_options'='true'::jsonb then
    customer_options:=jsonb_build_object('customer_options',private.billing_customer_options_v1(v_user,v_now));
  end if;
  if not found or a.account_plan_revision<>p.revision or a.entitlement_revision is distinct from entitlement.revision then
    select quota_limit into v_limit from public.effective_feature_entitlements where subject_user_id=v_user and feature_key='classrooms.create';
    return jsonb_build_object('subject_user_id',v_user,'state',case when p.plan_key='free' then 'free' else 'unmanaged' end,
      'plan_key',p.plan_key,'offering_version_id',p.billing_offering_version_id,'classroom_limit',coalesce(v_limit,0),
      'access_ends_at',entitlement.expires_at,'renewal_at',null,'can_start_paid_work',coalesce(entitlement.enabled and v_now>=entitlement.starts_at
        and (entitlement.expires_at is null or v_now<entitlement.expires_at) and entitlement.quota_limit>0,false),'retryable',false,'revision',p.revision)||customer_options;
  end if;
  v_pending:=a.account_plan_revision<>p.revision or (v_now>=a.access_ends_at and a.end_reason='renewal_pending');
  v_expired:=v_now>=a.access_ends_at and not v_pending;
  if a.source='trial' then
    select d.plan_key,d.classroom_limit into v_plan,v_limit from public.billing_trial_definitions d
      join public.billing_trials trial on trial.definition_id=d.id where trial.subject_user_id=v_user;
  else
    select o.plan_key,v.classroom_limit into v_plan,v_limit from public.stripe_billing_offering_versions v
      join public.stripe_billing_offerings o on o.id=v.offering_id where v.id=a.offering_version_id;
  end if;
  v_state:=case when v_pending then 'synchronization_pending' when v_expired then 'free' when a.source='trial' then 'trial'
    when a.end_reason='renewal_grace' and v_now>=a.paid_through then 'renewal_grace' else 'paid' end;
  return jsonb_build_object('subject_user_id',v_user,'state',v_state,'plan_key',case when v_expired then 'free' else v_plan end,
    'offering_version_id',a.offering_version_id,'classroom_limit',case when v_expired then 0 else v_limit end,
    'access_ends_at',case when a.end_reason='renewal_pending' then null else a.access_ends_at end,
    'renewal_at',case when a.end_reason='renewal_pending' then a.paid_through else null end,
    'can_start_paid_work',v_now>=a.starts_at and not v_pending and not v_expired,'retryable',v_pending,'revision',a.revision)||customer_options;
end; $$;

create or replace function public.billing_start_trial_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(p_request->>'subject_user_id')::uuid; v_op uuid:=(p_request->>'operation_id')::uuid;
  p public.account_plans%rowtype; trial public.billing_trials%rowtype; v_now timestamptz;
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
  if not found or not private.billing_trial_eligible_v1(v_user) then
    raise exception using errcode='55000',message='billing_trial_ineligible'; end if;
  v_now:=clock_timestamp();
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

commit;
