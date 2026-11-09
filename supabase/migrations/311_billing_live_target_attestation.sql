-- Record an optional live target identity without enabling live billing.
begin;

alter table private.stripe_billing_settings
  add column live_project_ref text,
  add column live_stripe_account text,
  add constraint stripe_billing_live_target_excludes_sandbox check (
    (live_project_ref is null and live_stripe_account is null)
    or (
      live_project_ref is not null and live_project_ref ~ '^[a-z0-9]{20}$'
      and live_stripe_account is not null and live_stripe_account ~ '^acct_[A-Za-z0-9]{1,255}$'
      and not sandbox_enabled
    )
  );

-- This is a point-in-time preflight, never a lease or a writer gate. Sandbox
-- offerings, attempts and subscriptions share an offering root. Some receipts,
-- trials and lifecycle history have no offering, so check those roots too.
create function public.billing_attest_live_target_v1(p_project_ref text, p_stripe_account text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.stripe_billing_settings settings
    where settings.singleton
      and not settings.sandbox_enabled
      and settings.live_project_ref = p_project_ref
      and settings.live_stripe_account = p_stripe_account
  )
  and not exists (select 1 from public.stripe_billing_offerings)
  and not exists (select 1 from public.stripe_billing_customers)
  and not exists (select 1 from public.stripe_billing_event_inbox)
  and not exists (select 1 from public.stripe_billing_subscription_audit)
  and not exists (select 1 from public.billing_trials)
  and not exists (select 1 from public.billing_account_access)
  and not exists (select 1 from public.billing_lifecycle_audit)
  and not exists (select 1 from private.billing_classroom_restrictions)
  and not exists (
    select 1 from public.account_plans plan where plan.management_source <> 'legacy'
  );
$$;

revoke all on function public.billing_attest_live_target_v1(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.billing_attest_live_target_v1(text, text) to service_role;

commit;
