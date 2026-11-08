-- Write-ahead installation checkpoints for the sandbox scheduled change worker.
begin;

alter table private.billing_scheduled_plan_changes
  add column installation_revision bigint not null default 1 check (installation_revision > 0),
  add column attach_requested_at timestamptz,
  add column attached_schedule_id text unique check (attached_schedule_id ~ '^sub_sched_[A-Za-z0-9]{1,240}$'),
  add column configure_requested_at timestamptz,
  add column installation_retry_at timestamptz,
  add column installation_attempts integer not null default 0 check (installation_attempts between 0 and 6),
  add column installation_attention_at timestamptz,
  add check (attached_schedule_id is null or attach_requested_at is not null),
  add check (configure_requested_at is null or attached_schedule_id is not null),
  add check (attached_schedule_id is null or provider_schedule_id is null or attached_schedule_id=provider_schedule_id);

create function private.billing_scheduled_installation_claim_v1(p_id uuid)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object(
    'fence',jsonb_build_object(
      'operationId',change.id,'subscriptionId',binding.id,'leaseToken',binding.lease_token,
      'fencingToken',binding.fencing_token,'subscriptionRevision',binding.revision,'operationRevision',change.installation_revision
    ),
    'operation',jsonb_build_object(
      'operationId',change.id,'stripeAccount',binding.stripe_account,'stripeCustomerId',binding.stripe_customer_id,
      'stripeSubscriptionId',binding.stripe_subscription_id,'paidPeriodStart',change.paid_period_start,'effectiveAt',change.effective_at,
      'source',jsonb_build_object('priceId',source.stripe_price_id,'productId',source.stripe_product_id,
        'currency',source.currency,'interval',source.interval,'unitAmount',source.unit_amount),
      'target',jsonb_build_object('priceId',target.stripe_price_id,'productId',target.stripe_product_id,
        'currency',target.currency,'interval',target.interval,'unitAmount',target.unit_amount)
    ),
    'installation',jsonb_strip_nulls(jsonb_build_object(
      'stage',case when change.configure_requested_at is not null then 'configure_requested'
        when change.attached_schedule_id is not null then 'attached'
        when change.attach_requested_at is not null then 'attach_requested' else 'confirmed' end,
      'scheduleId',change.attached_schedule_id,
      'replayUntil',coalesce(change.configure_requested_at,
        case when change.attached_schedule_id is null then change.attach_requested_at end)+interval '23 hours'
    ))
  )
  from private.billing_scheduled_plan_changes change
  join public.stripe_billing_subscription_bindings binding on binding.id=change.subscription_id
  join public.stripe_billing_offering_versions source on source.id=change.source_offering_version_id
  join public.stripe_billing_offering_versions target on target.id=change.target_offering_version_id
  where change.id=p_id;
$$;

create function public.billing_list_scheduled_installations_v1(p_limit integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  if p_limit is null or p_limit not between 1 and 5 then
    raise exception using errcode='22023',message='billing_scheduled_installation_limit_invalid';
  end if;
  return (
    select coalesce(jsonb_agg(item.id order by item.due_at,item.id),'[]'::jsonb) from (
      select change.id,coalesce(change.installation_retry_at,change.confirmed_at) as due_at
      from private.billing_scheduled_plan_changes change
      join public.stripe_billing_subscription_bindings binding on binding.id=change.subscription_id
      where change.state='confirmed' and change.installation_attention_at is null
        and (change.installation_retry_at is null or change.installation_retry_at<=clock_timestamp())
        and (binding.lease_expires_at is null or binding.lease_expires_at<=clock_timestamp())
      order by due_at,change.id limit p_limit
    ) item
  );
end;
$$;

-- All commands share the lock order and the exact source term. Changing a
-- plan or subscription during a Stripe round-trip invalidates its next write.
create function public.billing_scheduled_installation_v1(
  p_operation_id uuid,p_action text,p_fence jsonb default null,p_schedule_id text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_change private.billing_scheduled_plan_changes%rowtype;
  v_binding public.stripe_billing_subscription_bindings%rowtype;
  v_access public.billing_account_access%rowtype;
  v_plan public.account_plans%rowtype;
  v_entitlement_revision bigint;
  v_now timestamptz;
  v_current boolean;
  v_finish boolean:=p_action in ('installed','retry','attention','expired');
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  if p_operation_id is null or p_action is null or p_action not in (
    'claim','begin_attach','record_attach','begin_configure','authorize_write','installed','retry','attention','expired'
  ) or (p_action in ('record_attach','installed') and coalesce(p_schedule_id,'') !~ '^sub_sched_[A-Za-z0-9]{1,240}$')
    or (p_action not in ('record_attach','installed') and p_schedule_id is not null)
    or (p_action='claim' and p_fence is not null)
    or (p_action<>'claim' and jsonb_typeof(p_fence) is distinct from 'object') then
    raise exception using errcode='22023',message='billing_scheduled_installation_request_invalid';
  end if;
  select * into v_change from private.billing_scheduled_plan_changes where id=p_operation_id;
  if not found then return null; end if;
  select * into v_binding from public.stripe_billing_subscription_bindings where id=v_change.subscription_id for update;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_change.subject_user_id::text,20620260924));
  select * into v_plan from public.account_plans where subject_user_id=v_change.subject_user_id for update;
  select * into v_access from public.billing_account_access where subject_user_id=v_change.subject_user_id for update;
  select * into v_change from private.billing_scheduled_plan_changes where id=p_operation_id for update;
  perform public.lock_effective_feature_entitlement_v1(v_change.subject_user_id,'classrooms.create');
  select revision into v_entitlement_revision from public.effective_feature_entitlements
    where subject_user_id=v_change.subject_user_id and feature_key='classrooms.create';
  v_now:=clock_timestamp();
  if v_change.state<>'confirmed' or v_change.installation_attention_at is not null then return null; end if;
  v_current:=v_binding.is_current and v_binding.provider_mode='test'
    and v_binding.subject_user_id=v_change.subject_user_id
    and v_binding.offering_version_id=v_change.source_offering_version_id
    and v_plan.management_source is not distinct from 'billing'
    and v_plan.plan_key is not distinct from 'pro'
    and v_plan.billing_offering_version_id is not distinct from v_change.source_offering_version_id
    and v_plan.revision is not distinct from v_change.expected_plan_revision
    and v_access.account_plan_revision is not distinct from v_change.expected_plan_revision
    and v_access.revision is not distinct from v_change.expected_access_revision
    and v_access.entitlement_revision is not distinct from v_change.expected_entitlement_revision
    and v_entitlement_revision is not distinct from v_change.expected_entitlement_revision
    and v_access.source is not distinct from 'paid' and v_access.end_reason is not distinct from 'renewal_pending'
    and v_access.subscription_id is not distinct from v_binding.id
    and v_access.offering_version_id is not distinct from v_change.source_offering_version_id
    and v_access.paid_period_start is not distinct from v_change.paid_period_start
    and v_access.paid_through is not distinct from v_change.effective_at
    and v_access.access_ends_at is not distinct from v_change.effective_at
    and v_access.last_paid_invoice_id is not distinct from v_change.last_paid_invoice_id
    and v_access.failed_renewal_invoice_id is null and v_access.expiry_applied_at is null
    and not exists(select 1 from public.billing_upgrade_operations where subscription_id=v_binding.id and status in ('queued','retry','attention'))
    and not exists(select 1 from public.billing_renewal_closeouts where subscription_id=v_binding.id and status in ('queued','retry','attention'));
  if p_action='claim' then
    if v_binding.lease_expires_at>v_now or v_change.installation_retry_at>v_now then return null; end if;
    if v_current is not true then
      -- A changed source can release pristine intent. Any possible write keeps
      -- its identity for an operator to inspect and resolve.
      update private.billing_scheduled_plan_changes set installation_revision=installation_revision+1,
        state=case when attach_requested_at is null then 'expired' else state end,
        confirmed_at=case when attach_requested_at is null then null else confirmed_at end,
        installation_attention_at=case when attach_requested_at is not null then v_now end
        where id=v_change.id;
      return null;
    end if;
    update public.stripe_billing_subscription_bindings set lease_token=gen_random_uuid(),lease_expires_at=v_now+interval '120 seconds',
      fencing_token=fencing_token+1,revision=revision+1,updated_at=v_now where id=v_binding.id;
    update private.billing_scheduled_plan_changes set installation_revision=installation_revision+1 where id=v_change.id;
    return private.billing_scheduled_installation_claim_v1(v_change.id);
  end if;
  if v_binding.lease_token is null or v_binding.lease_expires_at<=v_now
    or p_fence->>'operationId' is distinct from v_change.id::text or p_fence->>'subscriptionId' is distinct from v_binding.id::text
    or p_fence->>'leaseToken' is distinct from v_binding.lease_token::text or p_fence->>'fencingToken' is distinct from v_binding.fencing_token::text
    or p_fence->>'subscriptionRevision' is distinct from v_binding.revision::text
    or p_fence->>'operationRevision' is distinct from v_change.installation_revision::text then return null; end if;

  if v_finish then
    if (p_action='installed' and (v_current is not true or v_change.configure_requested_at is null
      or v_change.attached_schedule_id is distinct from p_schedule_id))
      or (p_action='expired' and (v_change.attach_requested_at is not null or v_now<v_change.effective_at)) then return null; end if;
    update private.billing_scheduled_plan_changes set
      state=case when p_action='installed' then 'scheduled' when p_action='expired' then 'expired' else state end,
      confirmed_at=case when p_action='expired' then null else confirmed_at end,
      provider_schedule_id=case when p_action='installed' then p_schedule_id else provider_schedule_id end,
      installation_attempts=installation_attempts+case when p_action='retry' then 1 else 0 end,
      installation_retry_at=case when p_action='retry' and installation_attempts<5
        then v_now+make_interval(secs=>30*(2^installation_attempts)::integer) end,
      installation_attention_at=case when p_action='attention' or (p_action='retry' and installation_attempts>=5) then v_now end,
      installation_revision=installation_revision+1 where id=v_change.id;
    update public.stripe_billing_subscription_bindings set lease_token=null,lease_expires_at=null,revision=revision+1,updated_at=v_now
      where id=v_binding.id;
    return 'true'::jsonb;
  end if;

  if v_current is not true then return null; end if;
  case p_action
    when 'begin_attach' then
      if v_change.attach_requested_at is not null or v_now+interval '5 seconds'>=v_change.effective_at then return null; end if;
      update private.billing_scheduled_plan_changes set attach_requested_at=v_now where id=v_change.id;
    when 'record_attach' then
      if v_change.attach_requested_at is null or v_change.attached_schedule_id is not null then return null; end if;
      update private.billing_scheduled_plan_changes set attached_schedule_id=p_schedule_id where id=v_change.id;
    when 'begin_configure' then
      if v_change.attached_schedule_id is null or v_change.configure_requested_at is not null
        or v_now+interval '5 seconds'>=v_change.effective_at then return null; end if;
      update private.billing_scheduled_plan_changes set configure_requested_at=v_now where id=v_change.id;
    when 'authorize_write' then
      if v_change.attach_requested_at is null
        or (v_change.attached_schedule_id is not null and v_change.configure_requested_at is null)
        or v_now+interval '5 seconds'>=least(v_change.effective_at,
          coalesce(v_change.configure_requested_at,v_change.attach_requested_at)+interval '23 hours')
        or v_binding.lease_expires_at<=v_now+interval '15 seconds' then return null; end if;
  end case;
  update private.billing_scheduled_plan_changes set installation_revision=installation_revision+1 where id=v_change.id;
  return private.billing_scheduled_installation_claim_v1(v_change.id);
end;
$$;

revoke all on function private.billing_scheduled_installation_claim_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function public.billing_list_scheduled_installations_v1(integer),
  public.billing_scheduled_installation_v1(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.billing_list_scheduled_installations_v1(integer),
  public.billing_scheduled_installation_v1(uuid,text,jsonb,text) to service_role;

commit;
