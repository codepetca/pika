begin;

-- Inspect the same candidates as the recovery handlers without taking their
-- locks or leases. Each handler still rechecks eligibility before acting.
create function private.billing_recovery_due_v1(
  p_paid boolean, p_trial boolean, p_installation boolean, p_cancellation boolean,
  p_scheduled_closeout boolean, p_email boolean
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_secret text := nullif(current_setting('request.headers', true), '')::jsonb->>'x-pika-billing-recovery-secret';
  v_settings private.stripe_billing_settings%rowtype;
  v_now timestamptz := statement_timestamp();
  v_paid text;
  v_trial text;
  v_shared boolean;
begin
  if v_secret is null or char_length(v_secret) not between 32 and 256
    or v_secret !~ '^[A-Za-z0-9_-]+$'
    or not exists (
      select 1 from vault.decrypted_secrets
      where name='pika_billing_recovery_check_sha256'
        and decrypted_secret=encode(extensions.digest(v_secret,'sha256'),'hex')
    ) then
    raise exception using errcode='42501',message='billing_recovery_check_unauthorized';
  end if;

  select * into v_settings from private.stripe_billing_settings where singleton;
  if p_paid and public.billing_live_payment_lifecycle_ready_v1(v_settings.live_project_ref,v_settings.live_stripe_account) then
    v_paid:='idle';
  elsif p_paid then
    v_paid:='unavailable';
  end if;
  if p_trial and public.billing_live_trial_lifecycle_ready_v1(v_settings.live_project_ref,v_settings.live_stripe_account) then
    v_trial:='idle';
  elsif p_trial then
    v_trial:='unavailable';
  end if;

  if v_paid='idle' and exists (
    with reconcile_candidates as not materialized (
      select binding.*
      from public.stripe_billing_subscription_bindings binding
      where binding.provider_mode='live' and binding.stripe_account=v_settings.live_stripe_account and binding.is_current
        and binding.reconcile_state in ('queued','retry') and binding.reconcile_attempt_count<5
        and (binding.lease_expires_at is null or binding.lease_expires_at<=v_now)
        and not private.billing_live_reconciliation_blocked_v1(binding.id)
        and private.billing_live_reconciliation_binding_v1(binding.id,binding.stripe_account) is not null
    )
    -- Checkout recovery, including expired leases and retry times (316).
    select 1 from public.stripe_checkout_attempts attempt
    join public.stripe_billing_offering_versions offering on offering.id=attempt.offering_version_id
    where offering.provider_mode='live' and offering.stripe_account=v_settings.live_stripe_account
      and attempt.status in ('reserved','open','payment_pending') and attempt.next_attempt_at<=v_now
      and (attempt.lease_expires_at is null or attempt.lease_expires_at<=v_now)
    union all
    -- Each reconciliation branch can use its own due-time index (317, 325).
    select 1 from reconcile_candidates binding where binding.next_reconcile_at<=v_now
    union all
    select 1 from public.stripe_billing_event_inbox event
    join reconcile_candidates binding on binding.id=event.subscription_id
      and binding.stripe_account=event.stripe_account and binding.stripe_customer_id=event.stripe_customer_id
      and binding.stripe_subscription_id=event.stripe_subscription_id
    where event.provider_mode='live' and event.stripe_account=v_settings.live_stripe_account
      and event.status in ('received','exception') and event.attempt_count<5 and event.next_attempt_at<=v_now
      and binding.reconcile_state='queued'
    union all
    -- Paid access expiry can apply after the Stripe binding has retired (325).
    select 1 from public.billing_account_access access
    join public.stripe_billing_subscription_bindings binding on binding.id=access.subscription_id
      and binding.subject_user_id=access.subject_user_id and binding.provider_mode='live'
      and binding.stripe_account=v_settings.live_stripe_account
    join public.account_plans plan on plan.subject_user_id=access.subject_user_id
      and plan.revision=access.account_plan_revision and plan.management_source='billing'
    join public.effective_feature_entitlements entitlement on entitlement.subject_user_id=access.subject_user_id
      and entitlement.feature_key='classrooms.create' and entitlement.revision=access.entitlement_revision
    where access.source='paid' and access.end_reason in ('cancellation','renewal_grace')
      and access.expiry_applied_at is null and access.access_ends_at<=v_now
      and not private.billing_live_undo_awaiting_proof_v1(binding.id)
      and private.billing_live_reconciliation_binding_v1(binding.id,binding.stripe_account) is not null
      and private.billing_live_reconciliation_plan_valid_v1(binding.id,v_settings.live_project_ref,binding.stripe_account)
    union all
    -- Renewal closeouts and their retry fences (324).
    select 1 from public.stripe_billing_subscription_bindings binding
    join public.billing_account_access access on access.subscription_id=binding.id
      and access.subject_user_id=binding.subject_user_id
    join public.account_plans plan on plan.subject_user_id=binding.subject_user_id
    join public.effective_feature_entitlements entitlement on entitlement.subject_user_id=binding.subject_user_id
      and entitlement.feature_key='classrooms.create'
    left join public.billing_renewal_closeouts closeout on closeout.subscription_id=binding.id
      and closeout.invoice_id=access.failed_renewal_invoice_id
    left join lateral private.billing_live_closeout_schedule_candidate_v1(binding.id,binding.stripe_account) schedule on true
    where v_settings.live_closeout_enabled and binding.is_current and binding.provider_mode='live'
      and binding.stripe_account=v_settings.live_stripe_account and access.source='paid' and access.end_reason='renewal_grace'
      and access.access_ends_at=access.paid_through+interval '168 hours' and access.failed_renewal_invoice_id is not null
      and access.access_ends_at<=v_now and access.expiry_applied_at is not null
      and plan.management_source='billing' and plan.plan_key='free'
      and access.account_plan_revision=plan.revision and access.entitlement_revision=entitlement.revision
      and (schedule.operation_id is null or p_scheduled_closeout)
      and (binding.lease_expires_at is null or binding.lease_expires_at<=v_now)
      and (closeout.id is null or (
        closeout.status in ('queued','retry') and closeout.next_attempt_at<=v_now
        and closeout.scheduled_operation_id is not distinct from schedule.operation_id
        and closeout.expected_account_plan_revision=plan.revision and closeout.expected_access_revision=access.revision
        and closeout.expected_entitlement_revision=entitlement.revision
      ))
      and private.billing_live_closeout_binding_valid_v1(binding.id,binding.stripe_account)
      and private.billing_live_reconciliation_plan_valid_v1(binding.id,v_settings.live_project_ref,binding.stripe_account)
    union all
    select 1 from private.billing_scheduled_plan_changes change
    join public.stripe_billing_subscription_bindings binding on binding.id=change.subscription_id
      and binding.subject_user_id=change.subject_user_id
    where p_installation and change.state='confirmed' and binding.provider_mode='live'
      and binding.stripe_account=v_settings.live_stripe_account
      and (binding.lease_expires_at is null or binding.lease_expires_at<=v_now)
      and private.billing_live_scheduled_installation_due_v1(change,v_settings.live_scheduled_plan_change_provider_writes_enabled,v_now)
    union all
    select 1 from private.billing_live_scheduled_cancellations cancellation
    join private.billing_scheduled_plan_changes change on change.id=cancellation.schedule_operation_id
      and change.subscription_id=cancellation.subscription_id
    join public.stripe_billing_subscription_bindings binding on binding.id=cancellation.subscription_id
      and binding.subject_user_id=change.subject_user_id
    where p_cancellation and binding.provider_mode='live' and binding.stripe_account=v_settings.live_stripe_account
      and cancellation.next_attempt_at<=v_now and (binding.lease_expires_at is null or binding.lease_expires_at<=v_now)
  ) then
    v_paid:='due';
  end if;

  if v_trial='idle' and exists (
    select 1 from public.billing_account_access access
    join public.account_plans plan on plan.subject_user_id=access.subject_user_id
      and plan.revision=access.account_plan_revision and plan.management_source='trial' and plan.plan_key='plus'
      and plan.billing_offering_version_id is null
    join public.effective_feature_entitlements entitlement on entitlement.subject_user_id=access.subject_user_id
      and entitlement.feature_key='classrooms.create' and entitlement.revision=access.entitlement_revision
      and entitlement.starts_at=access.starts_at and entitlement.expires_at=access.access_ends_at
      and entitlement.source='trial' and entitlement.enabled and entitlement.quota_limit=5
    join public.billing_trials trial on trial.subject_user_id=access.subject_user_id
      and trial.started_at=access.starts_at and trial.ends_at=access.access_ends_at
    where access.source='trial' and access.trial_subject_user_id=access.subject_user_id and access.end_reason='trial'
      and access.expiry_applied_at is null and access.access_ends_at<=v_now
      and private.billing_live_trial_source_matches_v1(access.subject_user_id,v_settings.live_project_ref,v_settings.live_stripe_account)
  ) then
    v_trial:='due';
  end if;

  -- Either endpoint can process these queues. Shared work alone wakes one
  -- healthy lane, and an already-due lane can process it in the same call.
  if v_paid is distinct from 'due' and v_trial is distinct from 'due'
    and (v_paid='idle' or v_trial='idle') then
    v_shared := exists (
      select 1 from private.billing_assignment_release_intents
      where state='pending' and scheduled_for<=v_now and v_settings.classroom_new_work_cutoff_enabled
    ) or (p_email and v_settings.live_email_notices_enabled and exists (
      select 1 from private.billing_live_email_notices notice
      where notice.project_ref=v_settings.live_project_ref and notice.stripe_account=v_settings.live_stripe_account
        and (
          (notice.state='pending' and notice.due_at<=v_now
            and (notice.source='trial' or not private.billing_live_undo_awaiting_proof_v1(notice.source_id)))
          or (notice.state='sending' and notice.sending_started_at<=v_now-interval '5 minutes')
        )
    ));
    if v_shared then
      if v_trial='idle' then v_trial:='due'; else v_paid:='due'; end if;
    end if;
  end if;

  return jsonb_build_object('paid',v_paid,'trial',v_trial);
end;
$$;

-- A pre-parsed invoker wrapper exposes only the guarded result. The private
-- schema stays off the Data API and needs no new USAGE grant.
create function public.billing_recovery_due_v1(
  p_paid boolean, p_trial boolean, p_installation boolean, p_cancellation boolean,
  p_scheduled_closeout boolean, p_email boolean
) returns jsonb language sql stable security invoker set search_path=''
return private.billing_recovery_due_v1(p_paid,p_trial,p_installation,p_cancellation,p_scheduled_closeout,p_email);

revoke all on function private.billing_recovery_due_v1(boolean,boolean,boolean,boolean,boolean,boolean) from public,anon,authenticated,service_role;
revoke all on function public.billing_recovery_due_v1(boolean,boolean,boolean,boolean,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function private.billing_recovery_due_v1(boolean,boolean,boolean,boolean,boolean,boolean) to anon;
grant execute on function public.billing_recovery_due_v1(boolean,boolean,boolean,boolean,boolean,boolean) to anon;

commit;
