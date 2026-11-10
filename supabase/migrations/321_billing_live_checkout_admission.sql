-- Gate new live checkout admission on the live closeout lane and prevent
-- legacy timestamp publication from escaping the durable release boundary.
begin;

create function public.billing_live_checkout_activation_ready_v1(p_project_ref text,p_stripe_account text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(public.billing_live_payment_lifecycle_ready_v1(p_project_ref,p_stripe_account),false)
    and exists(select 1 from private.stripe_billing_settings settings
      where settings.singleton and settings.live_closeout_enabled
        and settings.live_project_ref=p_project_ref and settings.live_stripe_account=p_stripe_account);
$$;

-- Unresolved attempts and current live bindings remain fenced during a pause.
-- A retired binding stays fenced only until its paid access has ended.
create function private.billing_live_legacy_assignment_fenced_v1(p_subject uuid)
returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from private.billing_live_trial_sources source
      join public.account_plans plan on plan.subject_user_id=source.subject_user_id
      where source.subject_user_id=p_subject and plan.management_source='trial')
    or exists(select 1 from public.stripe_checkout_attempts attempt
      join public.stripe_billing_offering_versions version on version.id=attempt.offering_version_id
      where attempt.subject_user_id=p_subject and version.provider_mode='live'
        and attempt.status in ('reserved','open','payment_pending','attention'))
    or exists(select 1 from public.stripe_billing_subscription_bindings binding
      where binding.subject_user_id=p_subject and binding.provider_mode='live' and binding.is_current)
    or exists(select 1 from public.account_plans plan
      join public.billing_account_access access on access.subject_user_id=plan.subject_user_id
      join public.stripe_billing_subscription_bindings binding on binding.id=access.subscription_id
      where plan.subject_user_id=p_subject and plan.management_source='billing' and access.source='paid'
        and access.expiry_applied_at is null
        and binding.subject_user_id=p_subject and binding.provider_mode='live');
$$;

-- The existing 313 triggers call these function bodies; preserve their
-- classroom/settings/plan lock order and the trial behavior.
create or replace function private.guard_billing_live_trial_future_assignment_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_project text; v_owner uuid;
begin
  if new.is_draft or new.released_at is null or new.released_at<=clock_timestamp() then return new; end if;
  select live_project_ref into v_project from private.stripe_billing_settings where singleton for share;
  if v_project is null then return new; end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='40001',message='billing_live_trial_requires_read_committed';
  end if;
  begin
    select teacher_id into v_owner from public.classrooms where id=new.classroom_id for share nowait;
  exception when lock_not_available then
    raise exception using errcode='PT409',message='billing_assignment_publication_busy';
  end;
  if not found then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_owner::text,20620260924));
  if private.billing_live_legacy_assignment_fenced_v1(v_owner) then
    raise exception using errcode='PT403',message='billing_classroom_new_work_unavailable';
  end if;
  return new;
end;
$$;

create or replace function private.guard_billing_live_trial_classroom_transfer_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_project text;
begin
  select live_project_ref into v_project from private.stripe_billing_settings where singleton for share;
  if v_project is null then return new; end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='40001',message='billing_live_trial_requires_read_committed';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||new.teacher_id::text,20620260924));
  if private.billing_live_legacy_assignment_fenced_v1(new.teacher_id) and exists (
    select 1 from public.assignments where classroom_id=new.id and not is_draft and released_at>statement_timestamp()
  ) then
    raise exception using errcode='PT403',message='billing_classroom_new_work_unavailable';
  end if;
  return new;
end;
$$;

-- Defense in depth for every live insert, including future callers. Existing
-- attempts remain readable/recoverable after admission or closeout is paused.
create function private.guard_live_checkout_attempt_admission_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_version public.stripe_billing_offering_versions%rowtype;
  v_settings private.stripe_billing_settings%rowtype;
  v_plan public.account_plans%rowtype;
begin
  select * into v_version from public.stripe_billing_offering_versions where id=new.offering_version_id;
  if not found or v_version.provider_mode<>'live' then return new; end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='40001',message='billing_live_checkout_requires_read_committed';
  end if;
  select * into v_settings from private.stripe_billing_settings where singleton for share;
  if not found or not coalesce(public.billing_live_checkout_activation_ready_v1(v_settings.live_project_ref,v_version.stripe_account),false)
    or not v_settings.live_checkout_admission_enabled or not v_settings.live_checkout_writes_enabled then
    raise exception using errcode='55000',message='billing_live_checkout_activation_unavailable';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('stripe-checkout-account:'||new.subject_user_id::text,21120260926));
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||new.subject_user_id::text,20620260924));
  perform public.lock_effective_feature_entitlement_v1(new.subject_user_id,'classrooms.create');
  select * into v_plan from public.account_plans where subject_user_id=new.subject_user_id for update;
  if not found or not coalesce(private.billing_live_checkout_plan_eligible_v1(new.subject_user_id,
      v_settings.live_project_ref,v_version.stripe_account),false)
    or new.reserved_plan_revision is distinct from v_plan.revision then
    raise exception using errcode='55000',message='checkout_account_plan_ineligible';
  end if;
  if private.billing_has_legacy_future_assignment_v1(new.subject_user_id) then
    raise exception using errcode='55000',message='billing_live_checkout_future_releases';
  end if;
  return new;
end;
$$;
create trigger billing_live_checkout_attempt_admission
  before insert on public.stripe_checkout_attempts for each row execute function private.guard_live_checkout_attempt_admission_v1();

revoke all on function private.billing_live_legacy_assignment_fenced_v1(uuid),
  private.guard_live_checkout_attempt_admission_v1() from public,anon,authenticated,service_role;
revoke all on function public.billing_live_checkout_activation_ready_v1(text,text) from public,anon,authenticated,service_role;
grant execute on function public.billing_live_checkout_activation_ready_v1(text,text) to service_role;
commit;
