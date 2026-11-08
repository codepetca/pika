-- Additive RepoLight benefit for every validated Pro/Max offering; no billing gates,
-- purchased version records, prices, trials or provider settings are changed.
begin;

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
    -- Current billing is test-only. This flag does not promote the billing
    -- foundation to live mode or allow stale sandbox fixtures when it is off.
    if not settings.billing_access_enabled or not exists(select 1 from private.stripe_billing_settings
      where singleton and sandbox_enabled and provider_mode='test') then decision := 'billing_access_disabled';
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
      select * into binding from public.stripe_billing_subscription_bindings where id=access.subscription_id;
      select * into version from public.stripe_billing_offering_versions where id=access.offering_version_id;
      select plan_key into offering_plan from public.stripe_billing_offerings where id=version.offering_id;
      if access.source <> 'paid' or entitlement.source <> 'plan'
        or binding.id is null or not binding.is_current or binding.subject_user_id is distinct from p_subject_user_id
        or binding.offering_version_id is distinct from access.offering_version_id
        or plan.billing_offering_version_id is distinct from access.offering_version_id
        or version.id is null or offering_plan is distinct from plan.plan_key
        or version.classroom_limit is distinct from entitlement.quota_limit
        or version.provider_mode <> 'test' or binding.provider_mode <> 'test'
        or binding.stripe_account is distinct from version.stripe_account
        or not exists(
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
          ) select 1 from paid_versions where offering_version_id=version.id)
        then decision := 'entitlement_inconsistent';
      else decision := 'eligible'; end if;
    end if;
  else decision := 'entitlement_inconsistent';
  end if;
  return jsonb_build_object('enforced',coalesce(settings.plan_enforcement_enabled,true),'allowed',decision='eligible',
    'reason',decision,'source',source_kind,'access_ends_at',ends_at,'plan_revision',plan.revision);
end $$;

commit;
