-- Materialize the expiry of a verified live paid term and admit RepoLight
-- against the same immutable evidence before the exclusive access cutoff.
begin;

create function public.billing_apply_due_live_paid_access_v1(
  p_project_ref text,p_stripe_account text,p_request jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_candidate record;
  v_binding public.stripe_billing_subscription_bindings%rowtype;
  v_access public.billing_account_access%rowtype;
  v_plan public.account_plans%rowtype;
  v_limit integer;
  v_revision bigint;
  v_count integer:=0;
begin
  if jsonb_typeof(p_request) is distinct from 'object' then
    raise exception using errcode='22023',message='billing_limit_invalid';
  end if;
  if exists(select 1 from jsonb_object_keys(p_request) as key(name) where key.name<>'limit')
    or coalesce(p_request->>'limit','') !~ '^[1-9][0-9]{0,2}$' then
    raise exception using errcode='22023',message='billing_limit_invalid';
  end if;
  v_limit:=(p_request->>'limit')::integer;
  if v_limit>100 then raise exception using errcode='22023',message='billing_limit_invalid'; end if;
  perform private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);

  for v_candidate in
    select access.subject_user_id,access.subscription_id
    from public.billing_account_access access
    join public.stripe_billing_subscription_bindings binding on binding.id=access.subscription_id
      and binding.subject_user_id=access.subject_user_id
      and binding.provider_mode='live' and binding.stripe_account=p_stripe_account
    join public.account_plans plan on plan.subject_user_id=access.subject_user_id
      and plan.revision=access.account_plan_revision and plan.management_source='billing'
    join public.effective_feature_entitlements entitlement on entitlement.subject_user_id=access.subject_user_id
      and entitlement.feature_key='classrooms.create' and entitlement.revision=access.entitlement_revision
    where access.source='paid' and access.end_reason in ('cancellation','renewal_grace')
      and access.expiry_applied_at is null and access.access_ends_at<=clock_timestamp()
      and private.billing_live_reconciliation_binding_v1(binding.id,p_stripe_account) is not null
      and private.billing_live_reconciliation_plan_valid_v1(binding.id,p_project_ref,p_stripe_account)
    order by access.access_ends_at,access.subject_user_id limit v_limit
  loop
    -- A financially retired binding can still own the expired local term.
    select * into v_binding from public.stripe_billing_subscription_bindings
      where id=v_candidate.subscription_id and subject_user_id=v_candidate.subject_user_id
        and provider_mode='live' and stripe_account=p_stripe_account for update skip locked;
    if not found or not pg_try_advisory_xact_lock(hashtextextended(
      'account-plan-subject:'||v_candidate.subject_user_id::text,20620260924)) then continue; end if;
    select * into v_plan from public.account_plans where subject_user_id=v_candidate.subject_user_id for update;
    select * into v_access from public.billing_account_access
      where subject_user_id=v_candidate.subject_user_id for update;
    perform public.lock_effective_feature_entitlement_v1(v_candidate.subject_user_id,'classrooms.create');
    if v_access.source is distinct from 'paid' or v_access.subscription_id is distinct from v_binding.id
      or v_access.end_reason not in ('cancellation','renewal_grace') or v_access.expiry_applied_at is not null
      or v_access.access_ends_at>clock_timestamp()
      or private.billing_live_reconciliation_binding_v1(v_binding.id,p_stripe_account) is null
      or not private.billing_live_reconciliation_plan_valid_v1(v_binding.id,p_project_ref,p_stripe_account) then
      continue;
    end if;
    v_revision:=private.billing_write_access_v1(v_candidate.subject_user_id,v_plan.revision,'subscription_expired');
    insert into public.billing_lifecycle_audit(subject_user_id,subscription_id,operation_id,reason,next_state)
      values(v_candidate.subject_user_id,v_binding.id,gen_random_uuid(),'subscription_expired',
        jsonb_build_object('state','free','classroom_limit',0,'access_ends_at',v_access.access_ends_at,'revision',v_revision));
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('processed',v_count);
end;
$$;

revoke all on function public.billing_apply_due_live_paid_access_v1(text,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.billing_apply_due_live_paid_access_v1(text,text,jsonb) to service_role;

create or replace function public.get_repolight_analysis_access_v1(p_subject_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  settings private.repolight_settings;
  plan public.account_plans;
  entitlement public.effective_feature_entitlements;
  access public.billing_account_access;
  trial public.billing_trials;
  definition public.billing_trial_definitions;
  binding public.stripe_billing_subscription_bindings;
  version public.stripe_billing_offering_versions;
  offering_plan text;
  live_project_ref text;
  now_at timestamptz;
  decision text := 'account_unavailable';
  source_kind text;
  ends_at timestamptz;
begin
  perform private.lock_repolight_analysis_access_v1(p_subject_user_id);
  select * into settings from private.repolight_settings where singleton;
  select * into plan from public.account_plans where subject_user_id=p_subject_user_id;
  select * into entitlement from public.effective_feature_entitlements
    where subject_user_id=p_subject_user_id and feature_key='classrooms.create';
  select * into access from public.billing_account_access where subject_user_id=p_subject_user_id;
  source_kind := case plan.management_source when 'legacy' then 'legacy' when 'trial' then 'trial' when 'billing' then 'offering' end;
  ends_at := case when plan.management_source='legacy' then entitlement.expires_at else access.access_ends_at end;
  -- Read time only after waiting for the authoritative writers. No client clock
  -- and no expiry job are necessary to stop new work at the exclusive deadline.
  now_at := clock_timestamp();
  if settings.singleton is null then decision := 'access_unavailable';
  elsif plan.subject_user_id is null then null;
  elsif plan.plan_key not in ('plus','pro') then decision := 'plan_not_included';
  elsif entitlement.subject_user_id is null or not entitlement.enabled then decision := 'entitlement_inconsistent';
  elsif now_at < entitlement.starts_at then decision := 'not_started';
  elsif plan.management_source='legacy' and entitlement.expires_at is not null and now_at >= entitlement.expires_at then decision := 'expired';
  elsif plan.management_source='legacy' then
    source_kind := 'legacy'; ends_at := entitlement.expires_at;
    if not settings.legacy_plan_access_enabled then decision := 'legacy_access_disabled';
    elsif entitlement.source <> 'plan' or plan.billing_offering_version_id is not null
      or access.subject_user_id is not null
      or not exists(select 1 from public.account_plan_audit audit
        where audit.subject_user_id=p_subject_user_id and audit.plan_revision=plan.revision
          and audit.new_plan_key=plan.plan_key and audit.entitlement_revision=entitlement.revision
          and audit.new_classroom_limit=entitlement.quota_limit)
      then decision := 'entitlement_inconsistent';
    else decision := 'eligible'; end if;
  elsif plan.management_source in ('billing','trial') then
    source_kind := case when plan.management_source='trial' then 'trial' else 'offering' end;
    ends_at := access.access_ends_at;
    if plan.management_source='billing' then
      select * into binding from public.stripe_billing_subscription_bindings where id=access.subscription_id;
    end if;
    -- Trial and paid access independently require the exact pinned live lane.
    if not settings.billing_access_enabled or not exists (
      select 1 from private.stripe_billing_settings billing where billing.singleton
      and ((billing.sandbox_enabled and billing.provider_mode='test') or (
        plan.management_source='trial' and billing.live_trial_lifecycle_enabled
        and not billing.sandbox_enabled and billing.classroom_new_work_cutoff_enabled
        and private.billing_live_trial_source_matches_v1(p_subject_user_id,billing.live_project_ref,billing.live_stripe_account)
      ) or (
        plan.management_source='billing' and binding.provider_mode='live'
        and public.billing_live_payment_lifecycle_ready_v1(billing.live_project_ref,binding.stripe_account)
      ))
    ) then decision := 'billing_access_disabled';
    elsif access.subject_user_id is null or access.account_plan_revision <> plan.revision
      or access.entitlement_revision is distinct from entitlement.revision
      or entitlement.starts_at is distinct from access.starts_at
      or entitlement.expires_at is distinct from access.access_ends_at
      then decision := 'entitlement_inconsistent';
    elsif now_at < access.starts_at then decision := 'not_started';
    elsif now_at >= access.access_ends_at then
      decision := case when access.end_reason='renewal_pending' then 'synchronization_pending' else 'expired' end;
    elsif plan.management_source='trial' then
      select * into trial from public.billing_trials where subject_user_id=p_subject_user_id;
      select * into definition from public.billing_trial_definitions where id=trial.definition_id;
      if access.source <> 'trial' or entitlement.source <> 'trial' or plan.plan_key <> 'plus'
        or plan.billing_offering_version_id is not null or access.offering_version_id is not null
        or trial.subject_user_id is null or trial.converted_to_paid_at is not null
        or definition.plan_key is distinct from 'plus' or definition.classroom_limit is distinct from entitlement.quota_limit
        or trial.started_at is distinct from access.starts_at or trial.ends_at is distinct from access.access_ends_at
        or access.trial_subject_user_id is distinct from p_subject_user_id
        then decision := 'entitlement_inconsistent';
      else decision := 'eligible'; end if;
    else
      select billing.live_project_ref into live_project_ref from private.stripe_billing_settings billing where singleton;
      select * into version from public.stripe_billing_offering_versions where id=access.offering_version_id;
      select plan_key into offering_plan from public.stripe_billing_offerings where id=version.offering_id;
      if access.source <> 'paid' or entitlement.source <> 'plan'
        or binding.id is null or not binding.is_current or binding.subject_user_id is distinct from p_subject_user_id
        or binding.offering_version_id is distinct from access.offering_version_id
        or plan.billing_offering_version_id is distinct from access.offering_version_id
        or version.id is null or offering_plan is distinct from plan.plan_key
        or version.classroom_limit is distinct from entitlement.quota_limit
        or version.provider_mode is distinct from binding.provider_mode
        or binding.stripe_account is distinct from version.stripe_account
        or (binding.provider_mode='live' and (
          not public.billing_live_payment_lifecycle_ready_v1(live_project_ref,binding.stripe_account)
          or private.billing_live_reconciliation_binding_v1(binding.id,binding.stripe_account) is null
          or not private.billing_live_reconciliation_plan_valid_v1(binding.id,live_project_ref,binding.stripe_account)
        ))
        or (binding.provider_mode='test' and not exists(
          -- A verified prorated upgrade preserves the original paid invoice and
          -- writes an immutable transition receipt. Follow that exact period's
          -- receipt chain; a current tier label cannot substitute for evidence.
          with recursive paid_versions(offering_version_id,revision,depth) as (
            select effect.offering_version_id,effect.account_plan_revision,0
            from public.stripe_billing_invoice_effects effect
            where effect.subscription_id=binding.id and effect.stripe_account=version.stripe_account
              and effect.stripe_invoice_id=access.last_paid_invoice_id
              and effect.period_start=access.paid_period_start and effect.period_end=access.paid_through
              and effect.account_plan_revision<=plan.revision
            union all
            select receipt.target_offering_version_id,receipt.account_plan_revision,prior.depth+1
            from paid_versions prior join public.billing_upgrade_receipts receipt
              on receipt.source_offering_version_id=prior.offering_version_id
            where receipt.subscription_id=binding.id and receipt.stripe_account=version.stripe_account
              and receipt.paid_period_start=access.paid_period_start and receipt.paid_through=access.paid_through
              and receipt.account_plan_revision>prior.revision and receipt.account_plan_revision<=plan.revision
              and prior.depth<16
          ) select 1 from paid_versions where offering_version_id=version.id))
        then decision := 'entitlement_inconsistent';
      else decision := 'eligible'; end if;
    end if;
  else decision := 'entitlement_inconsistent';
  end if;
  return jsonb_build_object('enforced',coalesce(settings.plan_enforcement_enabled,true),'allowed',decision='eligible',
    'reason',decision,'source',source_kind,'access_ends_at',ends_at,'plan_revision',plan.revision);
end $$;

create or replace function private.repolight_provision_gate_hint_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if jsonb_build_array(to_jsonb(new)->'managed_provisioning_enabled',to_jsonb(new)->'billing_access_enabled',to_jsonb(new)->'legacy_plan_access_enabled',
  to_jsonb(new)->'sandbox_enabled',to_jsonb(new)->'provider_mode',to_jsonb(new)->'live_trial_lifecycle_enabled',
  to_jsonb(new)->'live_payment_lifecycle_enabled',
  to_jsonb(new)->'live_project_ref',to_jsonb(new)->'live_stripe_account') is distinct from
 jsonb_build_array(to_jsonb(old)->'managed_provisioning_enabled',to_jsonb(old)->'billing_access_enabled',to_jsonb(old)->'legacy_plan_access_enabled',
  to_jsonb(old)->'sandbox_enabled',to_jsonb(old)->'provider_mode',to_jsonb(old)->'live_trial_lifecycle_enabled',
  to_jsonb(old)->'live_payment_lifecycle_enabled',
  to_jsonb(old)->'live_project_ref',to_jsonb(old)->'live_stripe_account') then
  update private.repolight_provision_control set epoch=epoch+1 where singleton;
 end if;
 return new;
end $$;
revoke all on function private.repolight_provision_gate_hint_v1() from public,anon,authenticated,service_role;
drop trigger repolight_provision_billing_gate_hint on private.stripe_billing_settings;
create trigger repolight_provision_billing_gate_hint
  after update of sandbox_enabled,provider_mode,live_trial_lifecycle_enabled,live_payment_lifecycle_enabled,live_project_ref,live_stripe_account
  on private.stripe_billing_settings for each row execute function private.repolight_provision_gate_hint_v1();

-- Trial-only users keep their existing status. The paid lane can expose
-- verified access and an owned checkout without enabling trial admission.
create or replace function public.billing_get_live_access_status_v1(
  p_project_ref text,p_stripe_account text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_settings private.stripe_billing_settings%rowtype;
  v_subject uuid;
  v_plan public.account_plans%rowtype;
  v_access public.billing_account_access%rowtype;
  v_binding public.stripe_billing_subscription_bindings%rowtype;
  v_offering jsonb;
  v_result jsonb;
  v_options jsonb;
  v_pending uuid;
  v_state text;
  v_now timestamptz;
  v_paid boolean;
  v_can_start boolean;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode='22023',message='billing_live_trial_status_invalid';
  end if;
  v_subject:=(p_payload->>'subject_user_id')::uuid;
  if v_subject is null or exists(select 1 from jsonb_object_keys(p_payload) as key(name)
      where key.name not in ('subject_user_id','include_options'))
    or (p_payload ? 'include_options' and jsonb_typeof(p_payload->'include_options') is distinct from 'boolean') then
    raise exception using errcode='22023',message='billing_live_trial_status_invalid';
  end if;
  if public.billing_live_payment_lifecycle_ready_v1(p_project_ref,p_stripe_account) then
    v_settings:=private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  else
    v_settings:=private.lock_billing_live_trial_settings_v1(p_project_ref,p_stripe_account);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_subject::text,20620260924));
  if not exists(select 1 from public.users where id=v_subject and role='teacher') then
    raise exception using errcode='55000',message='billing_account_unavailable';
  end if;
  perform public.lock_effective_feature_entitlement_v1(v_subject,'classrooms.create');
  if not v_settings.live_payment_lifecycle_enabled then
    return private.billing_live_trial_status_v1(v_subject,v_settings,p_payload->'include_options'='true'::jsonb);
  end if;

  v_result:=private.billing_live_trial_status_v1(v_subject,v_settings,false);
  if not v_settings.live_trial_lifecycle_enabled and v_result->>'state'='trial' then
    v_result:=v_result||jsonb_build_object('state','synchronization_pending','plan_key','free',
      'classroom_limit',0,'can_start_paid_work',false,'retryable',true);
  end if;
  select * into v_plan from public.account_plans where subject_user_id=v_subject;
  select * into v_access from public.billing_account_access where subject_user_id=v_subject;
  if v_plan.management_source='billing' and v_access.source='paid' then
    select * into v_binding from public.stripe_billing_subscription_bindings where id=v_access.subscription_id;
    if private.billing_live_reconciliation_binding_v1(v_binding.id,p_stripe_account) is not null
      and private.billing_live_reconciliation_plan_valid_v1(v_binding.id,p_project_ref,p_stripe_account) then
      v_now:=clock_timestamp();
      v_offering:=private.stripe_live_checkout_offering_v1(v_access.offering_version_id,p_stripe_account);
      v_state:=case
        when v_now>=v_access.access_ends_at and v_access.end_reason='renewal_pending' then 'synchronization_pending'
        when v_now>=v_access.access_ends_at then 'free'
        when v_now<v_access.starts_at or not v_binding.is_current then 'synchronization_pending'
        when v_access.end_reason='renewal_grace' and v_now>=v_access.paid_through then 'renewal_grace'
        else 'paid' end;
      v_can_start:=v_state in ('paid','renewal_grace');
      v_paid:=v_state<>'free';
      v_result:=jsonb_build_object('subject_user_id',v_subject,'state',v_state,
        'plan_key',case when v_paid then v_offering->>'plan_key' else 'free' end,
        'offering_version_id',case when v_paid then v_access.offering_version_id end,
        'classroom_limit',case when v_can_start then (v_offering->>'classroom_limit')::integer else 0 end,
        'access_ends_at',case when v_access.end_reason<>'renewal_pending' then v_access.access_ends_at end,
        'renewal_at',case when v_access.end_reason='renewal_pending' then v_access.paid_through end,
        'can_start_paid_work',v_can_start,'retryable',v_state='synchronization_pending','revision',v_access.revision);
    end if;
  end if;
  if p_payload->'include_options'='true'::jsonb then
    select attempt.id into v_pending from public.stripe_checkout_attempts attempt
    join public.stripe_billing_offering_versions version on version.id=attempt.offering_version_id
    where attempt.subject_user_id=v_subject and attempt.status not in ('expired','bound')
      and version.provider_mode='live' and version.stripe_account=p_stripe_account;
    v_options:=jsonb_build_object(
      'trial_available',v_settings.live_trial_lifecycle_enabled and v_settings.live_trial_admission_enabled
        and private.billing_live_trial_eligible_v1(v_subject)
        and not private.billing_has_legacy_future_assignment_v1(v_subject),
      'checkout_available',v_settings.live_checkout_admission_enabled and v_settings.live_checkout_writes_enabled
        and private.billing_live_checkout_plan_eligible_v1(v_subject,p_project_ref,p_stripe_account)
        and v_pending is null and not exists(select 1 from public.stripe_billing_subscription_bindings binding
          where binding.subject_user_id=v_subject and binding.is_current),
      'has_billing_customer',exists(select 1 from public.stripe_billing_customers customer
        where customer.subject_user_id=v_subject and customer.provider_mode='live' and customer.stripe_account=p_stripe_account),
      'pending_checkout_id',v_pending,
      'paid_terms',case when v_paid then jsonb_build_object('currency',v_offering->>'currency',
        'interval',v_offering->>'interval','unit_amount',v_offering->'unit_amount','upgrade_available',false) end);
    return v_result||jsonb_build_object('customer_options',v_options);
  end if;
  return v_result;
end;
$$;

commit;
