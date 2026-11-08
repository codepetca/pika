-- Durable intent for a renewal-boundary change. The current purchased version
-- continues to own access until the target invoice is verified and settled.
begin;

alter table private.stripe_billing_settings
  add column scheduled_plan_changes_enabled boolean not null default false;

create table private.billing_scheduled_plan_changes (
  id uuid primary key,
  subject_user_id uuid not null references public.users(id) on delete restrict,
  subscription_id uuid not null references public.stripe_billing_subscription_bindings(id) on delete restrict,
  source_offering_version_id uuid not null references public.stripe_billing_offering_versions(id),
  target_offering_version_id uuid not null references public.stripe_billing_offering_versions(id),
  paid_period_start timestamptz not null,
  effective_at timestamptz not null,
  quote_expires_at timestamptz not null,
  last_paid_invoice_id text not null,
  expected_plan_revision bigint not null check (expected_plan_revision > 0),
  expected_access_revision bigint not null check (expected_access_revision > 0),
  expected_entitlement_revision bigint not null check (expected_entitlement_revision > 0),
  state text not null default 'quoted' check (state in ('quoted','confirmed','scheduled','applied','closed_unpaid','expired')),
  confirmed_at timestamptz,
  provider_schedule_id text unique check (provider_schedule_id ~ '^sub_sched_[A-Za-z0-9]{1,240}$'),
  created_at timestamptz not null default clock_timestamp(),
  check (source_offering_version_id <> target_offering_version_id),
  check (paid_period_start < effective_at and quote_expires_at < effective_at),
  check ((state in ('confirmed','scheduled','applied','closed_unpaid'))=(confirmed_at is not null)),
  check ((state in ('scheduled','applied','closed_unpaid'))=(provider_schedule_id is not null))
);
alter table private.billing_scheduled_plan_changes enable row level security;
revoke all on table private.billing_scheduled_plan_changes from public,anon,authenticated,service_role;
create unique index billing_scheduled_plan_changes_current on private.billing_scheduled_plan_changes(subscription_id)
  where state in ('quoted','confirmed','scheduled');

create function private.billing_scheduled_plan_change_quote_v1(p_change private.billing_scheduled_plan_changes)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object(
    'operation_id',p_change.id,'state',p_change.state,'effective_at',p_change.effective_at,
    'expires_at',p_change.quote_expires_at,'plan_key',offering.plan_key,'currency',target.currency,
    'interval',target.interval,'recurring_amount',target.unit_amount,'classroom_limit',target.classroom_limit,'due_now',0
  )
  from public.stripe_billing_offering_versions target
  join public.stripe_billing_offerings offering on offering.id=target.offering_id
  where target.id=p_change.target_offering_version_id;
$$;

-- The subject and exact target version are selected by the authenticated
-- application. No provider identity or price supplied by the browser is used.
create function public.billing_reserve_scheduled_plan_change_v1(
  p_subject_user_id uuid, p_operation_id uuid, p_target_offering_version_id uuid, p_stripe_account text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_binding public.stripe_billing_subscription_bindings%rowtype;
  v_plan public.account_plans%rowtype;
  v_access public.billing_account_access%rowtype;
  v_change private.billing_scheduled_plan_changes%rowtype;
  v_source public.stripe_billing_offering_versions%rowtype;
  v_target jsonb;
  v_now timestamptz;
  v_entitlement_revision bigint;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  if not exists(select 1 from private.stripe_billing_settings where singleton and scheduled_plan_changes_enabled) then
    raise exception using errcode='55000',message='billing_scheduled_changes_disabled';
  end if;
  if p_subject_user_id is null or p_operation_id is null or p_target_offering_version_id is null
    or not exists(select 1 from public.users where id=p_subject_user_id and role='teacher') then
    raise exception using errcode='22023',message='billing_scheduled_change_request_invalid';
  end if;
  select * into v_binding from public.stripe_billing_subscription_bindings
    where subject_user_id=p_subject_user_id and is_current for update;
  if not found or v_binding.provider_mode<>'test' or v_binding.stripe_account is distinct from p_stripe_account then
    raise exception using errcode='55000',message='billing_scheduled_change_ineligible';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||p_subject_user_id::text,20620260924));
  select * into v_change from private.billing_scheduled_plan_changes where id=p_operation_id;
  if found then
    if v_change.subject_user_id<>p_subject_user_id or v_change.subscription_id<>v_binding.id
      or v_change.target_offering_version_id<>p_target_offering_version_id then
      raise exception using errcode='23505',message='billing_scheduled_change_operation_conflict';
    end if;
    return private.billing_scheduled_plan_change_quote_v1(v_change);
  end if;
  select * into v_plan from public.account_plans where subject_user_id=p_subject_user_id for update;
  select * into v_access from public.billing_account_access where subject_user_id=p_subject_user_id for update;
  perform public.lock_effective_feature_entitlement_v1(p_subject_user_id,'classrooms.create');
  select revision into v_entitlement_revision from public.effective_feature_entitlements
    where subject_user_id=p_subject_user_id and feature_key='classrooms.create';
  v_now:=clock_timestamp();
  if v_plan.management_source is distinct from 'billing'
    or v_plan.billing_offering_version_id is distinct from v_binding.offering_version_id
    or v_access.source is distinct from 'paid' or v_access.subscription_id is distinct from v_binding.id
    or v_access.offering_version_id is distinct from v_binding.offering_version_id
    or v_access.account_plan_revision is distinct from v_plan.revision
    or v_access.entitlement_revision is distinct from v_entitlement_revision or v_entitlement_revision is null
    or v_access.end_reason is distinct from 'renewal_pending' or v_access.expiry_applied_at is not null
    or v_access.failed_renewal_invoice_id is not null or v_access.paid_period_start>v_now
    or v_access.access_ends_at is distinct from v_access.paid_through
    or v_access.paid_through<=v_now+interval '10 minutes'
    or not exists(select 1 from public.stripe_billing_invoice_effects effect
      where effect.subscription_id=v_binding.id and effect.stripe_account=v_binding.stripe_account
        and effect.offering_version_id=v_binding.offering_version_id
        and effect.stripe_invoice_id=v_access.last_paid_invoice_id
        and effect.period_start=v_access.paid_period_start and effect.period_end=v_access.paid_through) then
    raise exception using errcode='55000',message='billing_scheduled_change_ineligible';
  end if;
  if v_binding.lease_expires_at>v_now
    or exists(select 1 from public.billing_upgrade_operations where subscription_id=v_binding.id and status in ('queued','retry','attention'))
    or exists(select 1 from public.billing_renewal_closeouts where subscription_id=v_binding.id and status in ('queued','retry','attention')) then
    raise exception using errcode='55000',message='billing_scheduled_change_busy';
  end if;
  select * into v_source from public.stripe_billing_offering_versions where id=v_binding.offering_version_id;
  v_target:=public.billing_get_checkout_offering_v1(jsonb_build_object(
    'offering_version_id',p_target_offering_version_id,'stripe_account',v_binding.stripe_account));
  -- Only the approved Max-to-Pro change is admitted by this contract. Interval
  -- changes need the corresponding provider renewal and closeout proof.
  if v_plan.plan_key is distinct from 'pro' or v_target->>'plan_key' is distinct from 'plus'
    or v_source.currency is distinct from v_target->>'currency' or v_source.interval is distinct from v_target->>'interval'
    or (v_target->>'unit_amount')::bigint>=v_source.unit_amount then
    raise exception using errcode='55000',message='billing_scheduled_change_ineligible';
  end if;
  update private.billing_scheduled_plan_changes set state='expired'
    where subscription_id=v_binding.id and state='quoted' and quote_expires_at<=v_now;
  if exists(select 1 from private.billing_scheduled_plan_changes where subscription_id=v_binding.id and state in ('quoted','confirmed','scheduled')) then
    raise exception using errcode='55000',message='billing_scheduled_change_busy';
  end if;
  insert into private.billing_scheduled_plan_changes(
    id,subject_user_id,subscription_id,source_offering_version_id,target_offering_version_id,
    paid_period_start,effective_at,quote_expires_at,last_paid_invoice_id,
    expected_plan_revision,expected_access_revision,expected_entitlement_revision
  ) values (
    p_operation_id,p_subject_user_id,v_binding.id,v_binding.offering_version_id,p_target_offering_version_id,
    v_access.paid_period_start,v_access.paid_through,least(v_now+interval '15 minutes',v_access.paid_through-interval '10 minutes'),
    v_access.last_paid_invoice_id,v_plan.revision,v_access.revision,v_entitlement_revision
  ) returning * into v_change;
  return private.billing_scheduled_plan_change_quote_v1(v_change);
end;
$$;

create function public.billing_confirm_scheduled_plan_change_v1(p_subject_user_id uuid,p_operation_id uuid,p_stripe_account text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_change private.billing_scheduled_plan_changes%rowtype;
  v_binding public.stripe_billing_subscription_bindings%rowtype;
  v_access public.billing_account_access%rowtype;
  v_plan_revision bigint;
  v_entitlement_revision bigint;
  v_now timestamptz;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  if not exists(select 1 from private.stripe_billing_settings where singleton and scheduled_plan_changes_enabled) then
    raise exception using errcode='55000',message='billing_scheduled_changes_disabled';
  end if;
  if p_subject_user_id is null or p_operation_id is null
    or not exists(select 1 from public.users where id=p_subject_user_id and role='teacher') then
    raise exception using errcode='22023',message='billing_scheduled_change_request_invalid';
  end if;
  select * into v_change from private.billing_scheduled_plan_changes
    where id=p_operation_id and subject_user_id=p_subject_user_id;
  if not found then return null; end if;
  select * into v_binding from public.stripe_billing_subscription_bindings
    where id=v_change.subscription_id and subject_user_id=p_subject_user_id and is_current for update;
  if not found or v_binding.provider_mode<>'test' or v_binding.stripe_account is distinct from p_stripe_account then
    raise exception using errcode='55000',message='billing_scheduled_change_ineligible';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||p_subject_user_id::text,20620260924));
  select * into v_change from private.billing_scheduled_plan_changes where id=p_operation_id for update;
  if v_change.state in ('confirmed','scheduled','applied') then return private.billing_scheduled_plan_change_quote_v1(v_change); end if;
  select revision into v_plan_revision from public.account_plans where subject_user_id=p_subject_user_id for update;
  select * into v_access from public.billing_account_access where subject_user_id=p_subject_user_id for update;
  perform public.lock_effective_feature_entitlement_v1(p_subject_user_id,'classrooms.create');
  select revision into v_entitlement_revision from public.effective_feature_entitlements
    where subject_user_id=p_subject_user_id and feature_key='classrooms.create';
  v_now:=clock_timestamp();
  if v_change.state<>'quoted' or v_now>=v_change.quote_expires_at
    or v_plan_revision is distinct from v_change.expected_plan_revision
    or v_access.account_plan_revision is distinct from v_plan_revision
    or v_access.revision is distinct from v_change.expected_access_revision
    or v_entitlement_revision is distinct from v_change.expected_entitlement_revision
    or v_access.entitlement_revision is distinct from v_entitlement_revision
    or v_access.subscription_id is distinct from v_binding.id
    or v_access.end_reason is distinct from 'renewal_pending'
    or v_access.paid_through is distinct from v_change.effective_at
    or v_access.last_paid_invoice_id is distinct from v_change.last_paid_invoice_id
    or v_binding.offering_version_id is distinct from v_change.source_offering_version_id
    or public.billing_get_checkout_offering_v1(jsonb_build_object(
      'offering_version_id',v_change.target_offering_version_id,'stripe_account',v_binding.stripe_account)) is null then
    raise exception using errcode='55000',message='billing_scheduled_change_quote_stale';
  end if;
  if v_binding.lease_expires_at>v_now
    or exists(select 1 from public.billing_upgrade_operations where subscription_id=v_binding.id and status in ('queued','retry','attention'))
    or exists(select 1 from public.billing_renewal_closeouts where subscription_id=v_binding.id and status in ('queued','retry','attention')) then
    raise exception using errcode='55000',message='billing_scheduled_change_busy';
  end if;
  update private.billing_scheduled_plan_changes set state='confirmed',confirmed_at=v_now
    where id=p_operation_id returning * into v_change;
  return private.billing_scheduled_plan_change_quote_v1(v_change);
end;
$$;

-- Read the installed target by the existing per-subscription claim identity.
-- The settlement writer rechecks the claim and all matching source facts.
create function public.billing_get_scheduled_renewal_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  return (
    select jsonb_build_object(
      'operation_id',change.id,'provider_schedule_id',change.provider_schedule_id,'effective_at',change.effective_at,'state',change.state,
      'target_binding',jsonb_build_object(
        'subscription_id',binding.id,'subject_user_id',binding.subject_user_id,'stripe_account',binding.stripe_account,
        'stripe_customer_id',binding.stripe_customer_id,'stripe_subscription_id',binding.stripe_subscription_id,
        'offering_id',target.offering_id,'offering_version_id',target.id,'stripe_product_id',target.stripe_product_id,
        'stripe_price_id',target.stripe_price_id,'unit_amount',target.unit_amount,'plan_key',offering.plan_key,
        'currency',target.currency,'interval',target.interval,'provider_mode',target.provider_mode
      )
    )
    from private.billing_scheduled_plan_changes change
    join public.stripe_billing_subscription_bindings binding on binding.id=change.subscription_id
      and binding.is_current and binding.subject_user_id=change.subject_user_id
      and binding.offering_version_id=case when change.state='applied' then change.target_offering_version_id
        else change.source_offering_version_id end
    join public.stripe_billing_offering_versions target on target.id=change.target_offering_version_id
      and target.stripe_account=binding.stripe_account and target.provider_mode=binding.provider_mode
    join public.stripe_billing_offerings offering on offering.id=target.offering_id
    join public.billing_account_access access on access.subject_user_id=binding.subject_user_id
      and access.subscription_id=binding.id and access.offering_version_id=binding.offering_version_id
    where change.subscription_id=(p_request->>'subscription_id')::uuid and (
      (change.state='scheduled' and access.paid_through=change.effective_at
        and access.paid_period_start=change.paid_period_start and access.last_paid_invoice_id=change.last_paid_invoice_id)
      or (change.state='applied' and access.paid_period_start=change.effective_at)
    )
  );
end;
$$;

-- The worker supplies normalized provider evidence only after verifying the
-- installed schedule, exact target line and captured payment or failed invoice.
-- The separate attach/recovery worker must fence schedule installation.
create function private.billing_scheduled_term_end_v1(p_start timestamptz,p_offering_version uuid)
returns timestamptz language sql stable set search_path='' as $$
  select ((p_start at time zone 'UTC')+case version.interval
    when 'month' then interval '1 month' when 'year' then interval '1 year' end) at time zone 'UTC'
  from public.stripe_billing_offering_versions version where version.id=p_offering_version;
$$;

create function public.billing_finish_scheduled_renewal_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_binding public.stripe_billing_subscription_bindings%rowtype;
  v_change private.billing_scheduled_plan_changes%rowtype;
  v_access public.billing_account_access%rowtype;
  v_plan_revision bigint;
  v_entitlement_revision bigint;
  v_now timestamptz;
  v_outcome text:=p_request->>'outcome';
  v_result jsonb;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  if p_request is null or jsonb_typeof(p_request)<>'object'
    or v_outcome is null or v_outcome not in ('paid','renewal_failed','renewal_invoice_pending')
    or coalesce(p_request->>'invoice_id','') !~ '^in_[A-Za-z0-9]{1,255}$'
    or (p_request->>'period_end')::timestamptz is null or not isfinite((p_request->>'period_end')::timestamptz)
    or (p_request->>'period_start')::timestamptz is null or not isfinite((p_request->>'period_start')::timestamptz)
    or (p_request->>'period_end')::timestamptz<=(p_request->>'period_start')::timestamptz then
    raise exception using errcode='22023',message='billing_scheduled_renewal_request_invalid';
  end if;
  select * into v_binding from public.stripe_billing_subscription_bindings
    where id=(p_request->>'subscription_id')::uuid and is_current for update;
  if not found or v_binding.provider_mode<>'test' then
    return jsonb_build_object('status','rejected','retry_scheduled',false);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_binding.subject_user_id::text,20620260924));
  select revision into v_plan_revision from public.account_plans where subject_user_id=v_binding.subject_user_id for update;
  select * into v_access from public.billing_account_access where subject_user_id=v_binding.subject_user_id for update;
  select * into v_change from private.billing_scheduled_plan_changes
    where id=(p_request->>'operation_id')::uuid and subscription_id=v_binding.id
      and subject_user_id=v_binding.subject_user_id and state='scheduled' for update;
  perform public.lock_effective_feature_entitlement_v1(v_binding.subject_user_id,'classrooms.create');
  select revision into v_entitlement_revision from public.effective_feature_entitlements
    where subject_user_id=v_binding.subject_user_id and feature_key='classrooms.create';
  v_now:=clock_timestamp();
  if v_binding.lease_token is null or v_binding.lease_token is distinct from (p_request->>'lease_token')::uuid
    or v_binding.lease_expires_at<=v_now or v_binding.fencing_token is distinct from (p_request->>'fencing_token')::bigint
    or v_binding.revision is distinct from (p_request->>'expected_subscription_revision')::bigint then
    return jsonb_build_object('status','lost_claim','retry_scheduled',true);
  end if;
  if v_plan_revision is distinct from (p_request->>'expected_account_plan_revision')::bigint
    or v_access.account_plan_revision is distinct from v_plan_revision
    or v_entitlement_revision is null or v_access.entitlement_revision is distinct from v_entitlement_revision then
    return jsonb_build_object('status','plan_conflict','retry_scheduled',true);
  end if;
  if v_change.id is null or v_change.provider_schedule_id is distinct from p_request->>'provider_schedule_id'
    or v_change.target_offering_version_id is distinct from (p_request->>'target_offering_version_id')::uuid
    or v_change.source_offering_version_id is distinct from v_binding.offering_version_id
    or v_access.offering_version_id is distinct from v_binding.offering_version_id
    or v_access.source is distinct from 'paid' or v_access.subscription_id is distinct from v_binding.id
    or v_access.end_reason not in ('renewal_pending','renewal_grace')
    or v_access.paid_through is distinct from v_change.effective_at or v_access.paid_period_start is distinct from v_change.paid_period_start
    or v_access.last_paid_invoice_id is distinct from v_change.last_paid_invoice_id
    or p_request->>'invoice_id'=v_change.last_paid_invoice_id
    or (p_request->>'period_start')::timestamptz is distinct from v_change.effective_at or v_now<v_change.effective_at
    or (p_request->>'period_end')::timestamptz is distinct from
      private.billing_scheduled_term_end_v1(v_change.effective_at,v_change.target_offering_version_id)
    or (v_outcome='paid' and (p_request->>'provider_status' is distinct from 'active'
      or exists(select 1 from public.billing_renewal_closeouts where subscription_id=v_binding.id
        and status in ('queued','retry','attention'))
      or (v_access.failed_renewal_invoice_id is not null and v_access.failed_renewal_invoice_id<>p_request->>'invoice_id'))) then
    return jsonb_build_object('status','rejected','retry_scheduled',false);
  end if;
  -- A failed target invoice enters grace without moving the paid version. A
  -- pending target has no entitlement effect. The old writer owns both cases.
  if v_outcome<>'paid' then
    return public.billing_finish_lifecycle_v1(p_request);
  end if;
  -- Adopt the new binding and its first verified cycle in one transaction.
  -- Failed/rejected settlement rolls back the binding update as well.
  begin
    update public.stripe_billing_subscription_bindings set offering_version_id=v_change.target_offering_version_id
      where id=v_binding.id;
    v_result:=public.billing_finish_lifecycle_v1(p_request);
    if v_result->>'status' is distinct from 'applied' then
      raise exception using errcode='P3051',message='billing_scheduled_renewal_not_applied';
    end if;
    update private.billing_scheduled_plan_changes set state='applied' where id=v_change.id;
    return v_result;
  exception when sqlstate 'P3051' then
    return v_result;
  end;
end;
$$;

revoke all on function private.billing_scheduled_plan_change_quote_v1(private.billing_scheduled_plan_changes),
  private.billing_scheduled_term_end_v1(timestamptz,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.billing_reserve_scheduled_plan_change_v1(uuid,uuid,uuid,text),
  public.billing_confirm_scheduled_plan_change_v1(uuid,uuid,text),
  public.billing_get_scheduled_renewal_v1(jsonb),public.billing_finish_scheduled_renewal_v1(jsonb) from public,anon,authenticated;
grant execute on function public.billing_reserve_scheduled_plan_change_v1(uuid,uuid,uuid,text),
  public.billing_confirm_scheduled_plan_change_v1(uuid,uuid,text),
  public.billing_get_scheduled_renewal_v1(jsonb),public.billing_finish_scheduled_renewal_v1(jsonb) to service_role;

commit;
