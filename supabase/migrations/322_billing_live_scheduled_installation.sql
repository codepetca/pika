-- Scope live scheduled intent and provider installation to the pinned paid target.
-- The sandbox RPCs retain their original settings, contracts, and behavior.
begin;

alter table private.stripe_billing_settings
  add column live_scheduled_plan_change_admission_enabled boolean not null default false,
  add column live_scheduled_plan_change_provider_writes_enabled boolean not null default false,
  add constraint stripe_billing_live_scheduled_plan_change_controls check (
    not (live_scheduled_plan_change_admission_enabled or live_scheduled_plan_change_provider_writes_enabled)
    or (live_payment_lifecycle_enabled and live_closeout_enabled)
  );

-- Pausing either scheduling flag leaves the pinned read/recovery lane available.
create function private.lock_billing_live_scheduled_settings_v1(p_project_ref text,p_stripe_account text)
returns private.stripe_billing_settings language plpgsql set search_path='' as $$
begin
  return private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
end;
$$;

create function private.billing_live_scheduled_source_valid_v1(
  p_binding public.stripe_billing_subscription_bindings,p_access public.billing_account_access,
  p_project_ref text,p_stripe_account text,p_now timestamptz
)
returns boolean language sql stable set search_path='' as $$
  select coalesce(
    p_binding.is_current and p_binding.provider_mode='live' and p_binding.stripe_account=p_stripe_account
    and p_binding.last_provider_status='active' and p_binding.terminal_confirmed_at is null
    and p_binding.reconcile_state in ('queued','retry') and p_binding.reconcile_attempt_count<5
    and exists(select 1 from public.users where id=p_binding.subject_user_id and role='teacher')
    and private.billing_live_reconciliation_binding_v1(p_binding.id,p_stripe_account)->>'plan_key'='pro'
    and private.billing_live_reconciliation_plan_valid_v1(p_binding.id,p_project_ref,p_stripe_account)
    and p_access.subject_user_id=p_binding.subject_user_id and p_access.subscription_id=p_binding.id
    and p_access.offering_version_id=p_binding.offering_version_id and p_access.source='paid'
    and p_access.end_reason='renewal_pending' and p_access.expiry_applied_at is null
    and p_access.failed_renewal_invoice_id is null and p_access.last_paid_invoice_id is not null
    and p_access.paid_period_start<=p_now and p_access.access_ends_at=p_access.paid_through,false);
$$;

create function private.billing_live_scheduled_other_operation_v1(p_subscription uuid)
returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from public.billing_upgrade_operations where subscription_id=p_subscription and status in ('queued','retry','attention'))
    or exists(select 1 from public.billing_renewal_closeouts where subscription_id=p_subscription and status in ('queued','retry','attention'));
$$;

create function private.billing_live_scheduled_target_valid_v1(p_source uuid,p_target uuid,p_stripe_account text)
returns boolean language sql stable set search_path='' as $$
  select coalesce(source->>'plan_key'='pro' and target->>'plan_key'='plus'
    and source->>'currency'=target->>'currency' and source->>'interval'=target->>'interval'
    and (target->>'unit_amount')::bigint<(source->>'unit_amount')::bigint,false)
  from (select private.stripe_live_checkout_offering_v1(p_source,p_stripe_account) as source,
    private.stripe_live_checkout_offering_v1(p_target,p_stripe_account) as target) terms;
$$;

create function private.billing_live_scheduled_admission_v1(
  p_project_ref text,p_stripe_account text,p_request jsonb,p_confirm boolean
)
returns jsonb language plpgsql set search_path='' as $$
declare
  v_settings private.stripe_billing_settings%rowtype;
  v_subject uuid;
  v_id uuid;
  v_target uuid;
  v_binding public.stripe_billing_subscription_bindings%rowtype;
  v_plan public.account_plans%rowtype;
  v_access public.billing_account_access%rowtype;
  v_change private.billing_scheduled_plan_changes%rowtype;
  v_now timestamptz;
begin
  if jsonb_typeof(p_request) is distinct from 'object' then
    raise exception using errcode='22023',message='billing_scheduled_change_request_invalid';
  end if;
  if exists(select 1 from jsonb_object_keys(p_request) k(name)
      where name not in ('subject_user_id','operation_id','target_offering_version_id'))
    or jsonb_typeof(p_request->'subject_user_id') is distinct from 'string'
    or jsonb_typeof(p_request->'operation_id') is distinct from 'string'
    or (p_confirm and p_request ? 'target_offering_version_id')
    or (not p_confirm and jsonb_typeof(p_request->'target_offering_version_id') is distinct from 'string') then
    raise exception using errcode='22023',message='billing_scheduled_change_request_invalid';
  end if;
  v_settings:=private.lock_billing_live_scheduled_settings_v1(p_project_ref,p_stripe_account);
  v_subject:=(p_request->>'subject_user_id')::uuid;
  v_id:=(p_request->>'operation_id')::uuid;
  v_target:=(p_request->>'target_offering_version_id')::uuid;
  if v_subject is null or v_id is null or (not p_confirm and v_target is null)
    or not exists(select 1 from public.users where id=v_subject and role='teacher') then
    raise exception using errcode='22023',message='billing_scheduled_change_request_invalid';
  end if;
  select change.* into v_change from private.billing_scheduled_plan_changes change
    join public.stripe_billing_subscription_bindings binding on binding.id=change.subscription_id
    where change.id=v_id and change.subject_user_id=v_subject and binding.subject_user_id=v_subject
      and binding.stripe_account=p_stripe_account and binding.provider_mode='live';
  if p_confirm and not found then return null; end if;
  if not p_confirm and exists(select 1 from private.billing_scheduled_plan_changes where id=v_id)
    and (v_change.id is null or v_change.target_offering_version_id<>v_target) then
    raise exception using errcode='23505',message='billing_scheduled_change_operation_conflict';
  end if;
  select * into v_binding from public.stripe_billing_subscription_bindings
    where subject_user_id=v_subject and is_current and provider_mode='live' and stripe_account=p_stripe_account
      and (v_change.id is null or id=v_change.subscription_id) for update;
  if not found then
    raise exception using errcode='55000',message='billing_scheduled_change_ineligible';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_subject::text,20620260924));
  select * into v_plan from public.account_plans where subject_user_id=v_subject for update;
  perform public.lock_effective_feature_entitlement_v1(v_subject,'classrooms.create');
  select * into v_access from public.billing_account_access where subject_user_id=v_subject for update;
  select * into v_change from private.billing_scheduled_plan_changes
    where id=v_id and subject_user_id=v_subject and subscription_id=v_binding.id for update;
  if found then
    if not p_confirm and v_change.target_offering_version_id<>v_target then
      raise exception using errcode='23505',message='billing_scheduled_change_operation_conflict';
    end if;
    if not p_confirm or v_change.state in ('confirmed','scheduled','applied') then
      return private.billing_scheduled_plan_change_quote_v1(v_change);
    end if;
    v_target:=v_change.target_offering_version_id;
  elsif p_confirm then return null;
  end if;

  -- A provider pause also prevents making new promises. Existing leases and
  -- already-confirmed replays are independent of the admission switches.
  if not v_settings.live_scheduled_plan_change_admission_enabled
    or not v_settings.live_scheduled_plan_change_provider_writes_enabled then
    raise exception using errcode='55000',message='billing_live_scheduled_change_admission_unavailable';
  end if;
  if not private.billing_live_scheduled_target_valid_v1(v_binding.offering_version_id,v_target,p_stripe_account)
    or public.billing_get_live_checkout_offering_v1(p_project_ref,p_stripe_account,
      jsonb_build_object('offering_version_id',v_target,'stripe_account',p_stripe_account)) is null then
    raise exception using errcode='55000',message='billing_scheduled_change_ineligible';
  end if;
  v_now:=clock_timestamp();
  if not private.billing_live_scheduled_source_valid_v1(v_binding,v_access,p_project_ref,p_stripe_account,v_now)
    or v_access.paid_through<=v_now+interval '10 minutes' then
    raise exception using errcode='55000',message='billing_scheduled_change_ineligible';
  end if;
  if v_binding.lease_expires_at>v_now or private.billing_live_scheduled_other_operation_v1(v_binding.id) then
    raise exception using errcode='55000',message='billing_scheduled_change_busy';
  end if;

  if p_confirm then
    if v_change.state<>'quoted' or v_now>=v_change.quote_expires_at
      or v_change.source_offering_version_id is distinct from v_binding.offering_version_id
      or v_change.paid_period_start is distinct from v_access.paid_period_start
      or v_change.effective_at is distinct from v_access.paid_through
      or v_change.last_paid_invoice_id is distinct from v_access.last_paid_invoice_id
      or v_change.expected_plan_revision is distinct from v_plan.revision
      or v_change.expected_access_revision is distinct from v_access.revision
      or v_change.expected_entitlement_revision is distinct from v_access.entitlement_revision then
      raise exception using errcode='55000',message='billing_scheduled_change_quote_stale';
    end if;
    update private.billing_scheduled_plan_changes set state='confirmed',confirmed_at=v_now
      where id=v_id returning * into v_change;
  else
    update private.billing_scheduled_plan_changes set state='expired'
      where subscription_id=v_binding.id and state='quoted' and quote_expires_at<=v_now;
    if exists(select 1 from private.billing_scheduled_plan_changes
      where subscription_id=v_binding.id and state in ('quoted','confirmed','scheduled')) then
      raise exception using errcode='55000',message='billing_scheduled_change_busy';
    end if;
    insert into private.billing_scheduled_plan_changes(
      id,subject_user_id,subscription_id,source_offering_version_id,target_offering_version_id,
      paid_period_start,effective_at,quote_expires_at,last_paid_invoice_id,
      expected_plan_revision,expected_access_revision,expected_entitlement_revision
    ) values (
      v_id,v_subject,v_binding.id,v_binding.offering_version_id,v_target,
      v_access.paid_period_start,v_access.paid_through,least(v_now+interval '15 minutes',v_access.paid_through-interval '10 minutes'),
      v_access.last_paid_invoice_id,v_plan.revision,v_access.revision,v_access.entitlement_revision
    ) returning * into v_change;
  end if;
  return private.billing_scheduled_plan_change_quote_v1(v_change);
end;
$$;

create function public.billing_reserve_live_scheduled_plan_change_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language sql security definer set search_path='' as $$
  select private.billing_live_scheduled_admission_v1(p_project_ref,p_stripe_account,p_request,false);
$$;

create function public.billing_confirm_live_scheduled_plan_change_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language sql security definer set search_path='' as $$
  select private.billing_live_scheduled_admission_v1(p_project_ref,p_stripe_account,p_request,true);
$$;

create function private.billing_live_scheduled_installation_claim_v1(p_id uuid)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_set(claim,'{operation}',claim->'operation'||jsonb_build_object(
    'providerMode','live','lastPaidInvoiceId',change.last_paid_invoice_id))
  from private.billing_scheduled_plan_changes change
  cross join lateral private.billing_scheduled_installation_claim_v1(change.id) as payload(claim)
  where change.id=p_id;
$$;

-- With writes paused, only possible in-flight mutations and due pristine
-- expiration need a lease. Other confirmed intent stays recoverable on resume.
create function private.billing_live_scheduled_installation_due_v1(
  p_change private.billing_scheduled_plan_changes,p_writes boolean,p_now timestamptz
)
returns boolean language sql immutable set search_path='' as $$
  select p_change.state='confirmed' and p_change.installation_attention_at is null
    and (p_change.installation_retry_at is null or p_change.installation_retry_at<=p_now)
    and (p_writes or p_change.effective_at<=p_now or p_change.configure_requested_at is not null
      or (p_change.attach_requested_at is not null and p_change.attached_schedule_id is null));
$$;

create function public.billing_list_live_scheduled_installations_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_settings private.stripe_billing_settings%rowtype; v_limit integer; v_now timestamptz;
begin
  if jsonb_typeof(p_request) is distinct from 'object' then
    raise exception using errcode='22023',message='billing_scheduled_installation_limit_invalid';
  end if;
  if exists(select 1 from jsonb_object_keys(p_request) k(name) where name<>'limit')
    or jsonb_typeof(p_request->'limit') is distinct from 'number'
    or coalesce(p_request->>'limit','') !~ '^[1-5]$' then
    raise exception using errcode='22023',message='billing_scheduled_installation_limit_invalid';
  end if;
  v_limit:=(p_request->>'limit')::integer;
  v_settings:=private.lock_billing_live_scheduled_settings_v1(p_project_ref,p_stripe_account);
  v_now:=clock_timestamp();
  return (
    select coalesce(jsonb_agg(item.id order by item.due_at,item.id),'[]'::jsonb) from (
      select change.id,coalesce(change.installation_retry_at,change.confirmed_at) as due_at
      from private.billing_scheduled_plan_changes change
      join public.stripe_billing_subscription_bindings binding on binding.id=change.subscription_id
        and binding.subject_user_id=change.subject_user_id
      where change.state='confirmed' and binding.stripe_account=p_stripe_account and binding.provider_mode='live'
        and private.billing_live_scheduled_installation_due_v1(change,v_settings.live_scheduled_plan_change_provider_writes_enabled,v_now)
        and (binding.lease_expires_at is null or binding.lease_expires_at<=v_now)
      order by due_at,change.id limit v_limit
    ) item
  );
end;
$$;

-- All commands share the lock order and the exact source term. Changing a
-- plan or subscription during a Stripe round-trip invalidates its next write.
create function public.billing_live_scheduled_installation_command_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_settings private.stripe_billing_settings%rowtype;
  v_operation_id uuid;
  v_action text;
  v_fence jsonb;
  v_schedule_id text;
  v_change private.billing_scheduled_plan_changes%rowtype;
  v_binding public.stripe_billing_subscription_bindings%rowtype;
  v_access public.billing_account_access%rowtype;
  v_plan public.account_plans%rowtype;
  v_now timestamptz;
  v_current boolean;
  v_finish boolean;
begin
  if jsonb_typeof(p_request) is distinct from 'object' then
    raise exception using errcode='22023',message='billing_scheduled_installation_request_invalid';
  end if;
  if exists(select 1 from jsonb_object_keys(p_request) k(name)
    where name not in ('operation_id','action','fence','schedule_id'))
    or jsonb_typeof(p_request->'operation_id') is distinct from 'string'
    or jsonb_typeof(p_request->'action') is distinct from 'string'
    or (p_request ? 'schedule_id' and jsonb_typeof(p_request->'schedule_id') not in ('string','null')) then
    raise exception using errcode='22023',message='billing_scheduled_installation_request_invalid';
  end if;
  v_settings:=private.lock_billing_live_scheduled_settings_v1(p_project_ref,p_stripe_account);
  v_operation_id:=(p_request->>'operation_id')::uuid;
  v_action:=p_request->>'action';
  v_fence:=nullif(p_request->'fence','null'::jsonb);
  v_schedule_id:=p_request->>'schedule_id';
  v_finish:=v_action in ('installed','retry','attention','expired','deferred');
  if v_operation_id is null or v_action is null or v_action not in (
    'claim','begin_attach','record_attach','begin_configure','authorize_write','installed','retry','attention','expired','deferred'
  ) or (v_action in ('record_attach','installed') and coalesce(v_schedule_id,'') !~ '^sub_sched_[A-Za-z0-9]{1,240}$')
    or (v_action not in ('record_attach','installed') and v_schedule_id is not null)
    or (v_action='claim' and v_fence is not null)
    or (v_action<>'claim' and jsonb_typeof(v_fence) is distinct from 'object') then
    raise exception using errcode='22023',message='billing_scheduled_installation_request_invalid';
  end if;
  select change.* into v_change from private.billing_scheduled_plan_changes change
    join public.stripe_billing_subscription_bindings binding on binding.id=change.subscription_id
      and binding.subject_user_id=change.subject_user_id
    where change.id=v_operation_id and binding.stripe_account=p_stripe_account and binding.provider_mode='live';
  if not found then return null; end if;
  select * into v_binding from public.stripe_billing_subscription_bindings where id=v_change.subscription_id
    and subject_user_id=v_change.subject_user_id and stripe_account=p_stripe_account and provider_mode='live' for update;
  if not found then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_change.subject_user_id::text,20620260924));
  select * into v_plan from public.account_plans where subject_user_id=v_change.subject_user_id for update;
  perform public.lock_effective_feature_entitlement_v1(v_change.subject_user_id,'classrooms.create');
  select * into v_access from public.billing_account_access where subject_user_id=v_change.subject_user_id for update;
  select * into v_change from private.billing_scheduled_plan_changes where id=v_operation_id and subscription_id=v_binding.id for update;
  v_now:=clock_timestamp();
  if not found or v_change.state<>'confirmed' or v_change.installation_attention_at is not null then return null; end if;
  v_current:=private.billing_live_scheduled_source_valid_v1(v_binding,v_access,p_project_ref,p_stripe_account,v_now)
    and private.billing_live_scheduled_target_valid_v1(v_change.source_offering_version_id,v_change.target_offering_version_id,p_stripe_account)
    and v_binding.offering_version_id=v_change.source_offering_version_id
    and v_plan.revision=v_change.expected_plan_revision
    and v_access.revision=v_change.expected_access_revision
    and v_access.entitlement_revision=v_change.expected_entitlement_revision
    and v_access.paid_period_start=v_change.paid_period_start
    and v_access.paid_through=v_change.effective_at
    and v_access.last_paid_invoice_id=v_change.last_paid_invoice_id
    and not private.billing_live_scheduled_other_operation_v1(v_binding.id);
  if v_action='claim' then
    if v_binding.lease_expires_at>v_now or not private.billing_live_scheduled_installation_due_v1(
      v_change,v_settings.live_scheduled_plan_change_provider_writes_enabled,v_now) then return null; end if;
    if v_current is not true or (v_change.attached_schedule_id is not null
      and v_change.configure_requested_at is null and v_now>=v_change.effective_at) then
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
    return private.billing_live_scheduled_installation_claim_v1(v_change.id);
  end if;
  if v_binding.lease_token is null or v_binding.lease_expires_at<=v_now
    or v_fence->>'operationId' is distinct from v_change.id::text or v_fence->>'subscriptionId' is distinct from v_binding.id::text
    or v_fence->>'leaseToken' is distinct from v_binding.lease_token::text or v_fence->>'fencingToken' is distinct from v_binding.fencing_token::text
    or v_fence->>'subscriptionRevision' is distinct from v_binding.revision::text
    or v_fence->>'operationRevision' is distinct from v_change.installation_revision::text then return null; end if;

  if v_finish then
    if (v_action='deferred' and v_settings.live_scheduled_plan_change_provider_writes_enabled)
      or (v_action='installed' and (v_current is not true or v_change.configure_requested_at is null
      or v_change.attached_schedule_id is distinct from v_schedule_id))
      or (v_action='expired' and (v_change.attach_requested_at is not null or v_now<v_change.effective_at)) then return null; end if;
    update private.billing_scheduled_plan_changes set
      state=case when v_action='installed' then 'scheduled' when v_action='expired' then 'expired' else state end,
      confirmed_at=case when v_action='expired' then null else confirmed_at end,
      provider_schedule_id=case when v_action='installed' then v_schedule_id else provider_schedule_id end,
      installation_attempts=installation_attempts+case when v_action='retry' then 1 else 0 end,
      installation_retry_at=case when v_action='retry' and installation_attempts<5
        then v_now+make_interval(secs=>30*(2^installation_attempts)::integer)
        when v_action='deferred' then v_now+interval '30 seconds' end,
      installation_attention_at=case when v_action='attention' or (v_action='retry' and installation_attempts>=5) then v_now end,
      installation_revision=installation_revision+1 where id=v_change.id;
    update public.stripe_billing_subscription_bindings set lease_token=null,lease_expires_at=null,revision=revision+1,updated_at=v_now
      where id=v_binding.id;
    return 'true'::jsonb;
  end if;

  if v_current is not true
    or (v_action in ('begin_attach','begin_configure','authorize_write')
      and not v_settings.live_scheduled_plan_change_provider_writes_enabled) then return null; end if;
  case v_action
    when 'begin_attach' then
      if v_change.attach_requested_at is not null or v_now+interval '5 seconds'>=v_change.effective_at then return null; end if;
      update private.billing_scheduled_plan_changes set attach_requested_at=v_now where id=v_change.id;
    when 'record_attach' then
      if v_change.attach_requested_at is null or v_change.attached_schedule_id is not null then return null; end if;
      update private.billing_scheduled_plan_changes set attached_schedule_id=v_schedule_id where id=v_change.id;
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
  return private.billing_live_scheduled_installation_claim_v1(v_change.id);
end;
$$;

revoke all on function private.lock_billing_live_scheduled_settings_v1(text,text),
  private.billing_live_scheduled_source_valid_v1(public.stripe_billing_subscription_bindings,public.billing_account_access,text,text,timestamptz),
  private.billing_live_scheduled_other_operation_v1(uuid),private.billing_live_scheduled_target_valid_v1(uuid,uuid,text),
  private.billing_live_scheduled_admission_v1(text,text,jsonb,boolean),private.billing_live_scheduled_installation_claim_v1(uuid),
  private.billing_live_scheduled_installation_due_v1(private.billing_scheduled_plan_changes,boolean,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.billing_reserve_live_scheduled_plan_change_v1(text,text,jsonb),
  public.billing_confirm_live_scheduled_plan_change_v1(text,text,jsonb),public.billing_list_live_scheduled_installations_v1(text,text,jsonb),
  public.billing_live_scheduled_installation_command_v1(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.billing_reserve_live_scheduled_plan_change_v1(text,text,jsonb),
  public.billing_confirm_live_scheduled_plan_change_v1(text,text,jsonb),public.billing_list_live_scheduled_installations_v1(text,text,jsonb),
  public.billing_live_scheduled_installation_command_v1(text,text,jsonb) to service_role;

commit;
