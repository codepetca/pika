-- Lease acquisition and recovery discovery for already bound live checkouts.
begin;

create index stripe_live_checkout_bound_subscription_idx
  on public.stripe_checkout_attempts(subscription_id)
  where status='bound' and stripe_session_id ~ '^cs_live_[A-Za-z0-9]+$';
create index stripe_checkout_bound_audit_idx
  on public.stripe_checkout_audit(attempt_id,fencing_token) where action='bound';
create index stripe_live_billing_event_binding_due_idx
  on public.stripe_billing_event_inbox(subscription_id,next_attempt_at,id)
  where provider_mode='live' and status in ('received','exception');
create index stripe_billing_invoice_effect_subscription_idx
  on public.stripe_billing_invoice_effects(subscription_id);

-- Project only the immutable paid terms and verify that the exact live checkout
-- and customer created the binding. Retirement does not destroy provenance.
create function private.billing_live_reconciliation_binding_v1(p_subscription uuid,p_stripe_account text)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object(
    'subscription_id',binding.id,'subject_user_id',binding.subject_user_id,
    'stripe_account',binding.stripe_account,'stripe_customer_id',binding.stripe_customer_id,
    'stripe_subscription_id',binding.stripe_subscription_id,'offering_id',offering.id,
    'offering_version_id',version.id,'stripe_product_id',version.stripe_product_id,
    'stripe_price_id',version.stripe_price_id,'unit_amount',version.unit_amount,
    'plan_key',offering.plan_key,'currency',version.currency,'interval',version.interval,
    'provider_mode',binding.provider_mode)
  from public.stripe_billing_subscription_bindings binding
  join public.stripe_billing_offering_versions version on version.id=binding.offering_version_id
    and version.stripe_account=binding.stripe_account and version.provider_mode=binding.provider_mode
  join public.stripe_billing_offerings offering on offering.id=version.offering_id
  join public.stripe_billing_customers customer on customer.subject_user_id=binding.subject_user_id
    and customer.stripe_account=binding.stripe_account and customer.provider_mode=binding.provider_mode
    and customer.stripe_customer_id=binding.stripe_customer_id
  where binding.id=p_subscription and binding.provider_mode='live' and binding.stripe_account=p_stripe_account
    and private.stripe_live_checkout_offering_v1(version.id,p_stripe_account) is not null
    and exists (
      select 1 from public.stripe_checkout_attempts attempt
      join public.stripe_checkout_audit audit on audit.attempt_id=attempt.id
        and audit.action='bound' and audit.fencing_token=attempt.fencing_token
      where attempt.subscription_id=binding.id and attempt.subject_user_id=binding.subject_user_id
        and attempt.offering_version_id=version.id and attempt.stripe_customer_id=binding.stripe_customer_id
        and attempt.status='bound' and attempt.stripe_session_id ~ '^cs_live_[A-Za-z0-9]+$'
        and attempt.reserved_plan_revision is not null);
$$;

-- The live worker never takes over another operation's recovery. Completed
-- history is independent of immutable checkout provenance and paid access.
create function private.billing_live_reconciliation_blocked_v1(p_subscription uuid)
returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from public.billing_upgrade_operations upgrade
      where upgrade.subscription_id=p_subscription and upgrade.status in ('queued','retry','attention'))
    or exists(select 1 from private.billing_scheduled_plan_changes change
      where change.subscription_id=p_subscription and change.state in ('confirmed','scheduled'))
    or exists(select 1 from public.billing_renewal_closeouts closeout
      where closeout.subscription_id=p_subscription and closeout.status in ('queued','retry','attention'));
$$;

-- Call under the binding, account plan and feature fences, with checkout
-- provenance already checked. Once paid, the original reservation revision
-- gives way to the exact invoice effect and current paired entitlement audit.
create function private.billing_live_reconciliation_plan_valid_v1(
  p_subscription uuid,p_project_ref text,p_stripe_account text
)
returns boolean language sql stable set search_path='' as $$
  select exists (
    select 1 from public.stripe_billing_subscription_bindings binding
    where binding.id=p_subscription and binding.provider_mode='live' and binding.stripe_account=p_stripe_account
      and (
        (not exists(select 1 from public.stripe_billing_invoice_effects effect where effect.subscription_id=binding.id)
          and private.billing_live_checkout_plan_eligible_v1(binding.subject_user_id,p_project_ref,p_stripe_account)
          and exists(select 1 from public.stripe_checkout_attempts attempt
            join public.stripe_checkout_audit audit on audit.attempt_id=attempt.id
              and audit.action='bound' and audit.fencing_token=attempt.fencing_token
            where attempt.subscription_id=binding.id and attempt.subject_user_id=binding.subject_user_id
              and attempt.offering_version_id=binding.offering_version_id
              and attempt.stripe_customer_id=binding.stripe_customer_id
              and attempt.status='bound' and attempt.stripe_session_id ~ '^cs_live_[A-Za-z0-9]+$'
              and private.billing_checkout_revision_matches_v1(binding.subject_user_id,attempt.reserved_plan_revision)))
        or exists (
          select 1 from public.billing_account_access access
          join public.account_plans plan on plan.subject_user_id=access.subject_user_id
            and plan.revision=access.account_plan_revision and plan.management_source='billing'
            and plan.billing_offering_version_id=binding.offering_version_id
          join public.stripe_billing_offering_versions version on version.id=binding.offering_version_id
          join public.stripe_billing_offerings offering on offering.id=version.offering_id
          join public.stripe_billing_invoice_effects effect on effect.subscription_id=binding.id
            and effect.stripe_account=binding.stripe_account and effect.offering_version_id=version.id
            and effect.stripe_invoice_id=access.last_paid_invoice_id and effect.period_start=access.paid_period_start
            and effect.period_end=access.paid_through and effect.account_plan_revision<=plan.revision
          join public.effective_feature_entitlements entitlement on entitlement.subject_user_id=access.subject_user_id
            and entitlement.feature_key='classrooms.create' and entitlement.revision=access.entitlement_revision
            and entitlement.source='plan'
          join public.account_plan_audit plan_audit on plan_audit.subject_user_id=plan.subject_user_id
            and plan_audit.plan_revision=plan.revision and plan_audit.new_plan_key=plan.plan_key
            and plan_audit.new_classroom_limit=entitlement.quota_limit
            and plan_audit.entitlement_revision=entitlement.revision and plan_audit.actor_ref='stripe:billing'
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
          where access.subject_user_id=binding.subject_user_id and access.source='paid'
            and access.subscription_id=binding.id and access.offering_version_id=version.id
            and access.starts_at=access.paid_period_start
            and (
              (access.expiry_applied_at is null and plan.plan_key=offering.plan_key
                and entitlement.enabled and entitlement.quota_limit=version.classroom_limit
                and entitlement.starts_at=access.starts_at and entitlement.expires_at=access.access_ends_at)
              or (access.expiry_applied_at>=access.access_ends_at and plan.plan_key='free'
                and not entitlement.enabled and entitlement.quota_limit=0 and entitlement.expires_at is null)
            ))
      ));
$$;

-- The oldest due event of an exact binding is sufficient to trigger a fresh
-- provider read. Other due receipts stay discoverable on subsequent passes.
create function private.billing_live_reconciliation_due_event_v1(
  p_subscription uuid,p_stripe_account text,p_customer text,p_stripe_subscription text,p_now timestamptz
)
returns table(event_inbox_id uuid,due_at timestamptz) language sql stable set search_path='' as $$
  select event.id,event.next_attempt_at
  from public.stripe_billing_event_inbox event
  where event.subscription_id=p_subscription and event.provider_mode='live' and event.stripe_account=p_stripe_account
    and event.stripe_customer_id=p_customer and event.stripe_subscription_id=p_stripe_subscription
    and event.status in ('received','exception') and event.attempt_count<5 and event.next_attempt_at<=p_now
  order by event.next_attempt_at,event.id
  limit 1;
$$;

create function public.billing_list_live_work_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_limit integer; v_now timestamptz;
begin
  if jsonb_typeof(p_request) is distinct from 'object'
    or jsonb_typeof(p_request->'limit') is distinct from 'number'
    or coalesce(p_request->>'limit','') !~ '^[0-9]{1,3}$' then
    raise exception using errcode='22023',message='billing_live_work_request_invalid';
  end if;
  v_limit:=(p_request->>'limit')::integer;
  if v_limit not between 1 and 100
    or exists(select 1 from jsonb_object_keys(p_request) key(name) where key.name<>'limit') then
    raise exception using errcode='22023',message='billing_live_work_request_invalid';
  end if;
  perform private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  v_now:=clock_timestamp();
  return (
    with available as not materialized (
      select binding.* from public.stripe_billing_subscription_bindings binding
      where binding.provider_mode='live' and binding.stripe_account=p_stripe_account and binding.is_current
        and binding.reconcile_state in ('queued','retry') and binding.reconcile_attempt_count<5
        and (binding.lease_expires_at is null or binding.lease_expires_at<=v_now)
        and not private.billing_live_reconciliation_blocked_v1(binding.id)
    ), event_work as (
      select 'event'::text as kind,event.id as event_inbox_id,binding.id as subscription_id,event.next_attempt_at as due_at
      from public.stripe_billing_event_inbox event
      join available binding on binding.id=event.subscription_id
      where event.provider_mode='live' and event.stripe_account=p_stripe_account
        and event.status in ('received','exception') and event.attempt_count<5 and event.next_attempt_at<=v_now
        and (binding.reconcile_state='queued' or binding.next_reconcile_at<=v_now)
        and event.id=(select first_event.event_inbox_id from private.billing_live_reconciliation_due_event_v1(
          binding.id,binding.stripe_account,binding.stripe_customer_id,binding.stripe_subscription_id,v_now) first_event)
        and private.billing_live_reconciliation_binding_v1(binding.id,p_stripe_account) is not null
      order by event.next_attempt_at,binding.id
      limit v_limit
    ), due_work as (
      select 'reconcile'::text as kind,null::uuid as event_inbox_id,binding.id as subscription_id,binding.next_reconcile_at as due_at
      from available binding
      where binding.next_reconcile_at<=v_now
        and private.billing_live_reconciliation_binding_v1(binding.id,p_stripe_account) is not null
      order by binding.next_reconcile_at,binding.id
      limit v_limit
    ), one_per_subscription as (
      select distinct on (subscription_id) * from (
        select * from event_work union all select * from due_work
      ) candidates
      order by subscription_id,due_at,case kind when 'event' then 0 else 1 end
    ), picked as (
      select * from one_per_subscription order by due_at,subscription_id limit v_limit
    )
    select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object(
      'kind',kind,'event_inbox_id',event_inbox_id,'subscription_id',subscription_id,'next_attempt_at',due_at,
      'binding',private.billing_live_reconciliation_binding_v1(subscription_id,p_stripe_account)
    ) order by due_at,subscription_id),'[]'::jsonb))
    from picked
  );
end;
$$;

create function public.billing_claim_live_subscription_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_binding public.stripe_billing_subscription_bindings%rowtype;
  v_plan_revision bigint;
  v_subscription uuid;
  v_provenance jsonb;
  v_lease_seconds integer;
  v_now timestamptz;
begin
  if jsonb_typeof(p_request) is distinct from 'object'
    or jsonb_typeof(p_request->'subscription_id') is distinct from 'string'
    or coalesce(p_request->>'subscription_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(p_request->'lease_seconds') is distinct from 'number'
    or coalesce(p_request->>'lease_seconds','') !~ '^[0-9]{1,3}$' then
    raise exception using errcode='22023',message='billing_live_claim_request_invalid';
  end if;
  v_subscription:=(p_request->>'subscription_id')::uuid;
  v_lease_seconds:=(p_request->>'lease_seconds')::integer;
  if v_lease_seconds not between 30 and 300
    or exists(select 1 from jsonb_object_keys(p_request) key(name) where key.name not in ('subscription_id','lease_seconds')) then
    raise exception using errcode='22023',message='billing_live_claim_request_invalid';
  end if;
  perform private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  select * into v_binding from public.stripe_billing_subscription_bindings binding
  where binding.id=v_subscription and binding.is_current
    and binding.provider_mode='live' and binding.stripe_account=p_stripe_account
  for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  v_provenance:=private.billing_live_reconciliation_binding_v1(v_binding.id,p_stripe_account);
  if v_provenance is null then return jsonb_build_object('status','not_found'); end if;
  v_now:=clock_timestamp();
  if v_binding.lease_expires_at>v_now or v_binding.reconcile_state not in ('queued','retry')
    or v_binding.reconcile_attempt_count>=5
    or private.billing_live_reconciliation_blocked_v1(v_binding.id)
    or (not coalesce(v_binding.next_reconcile_at<=v_now,false)
      and (v_binding.reconcile_state<>'queued'
        or not exists(select 1 from private.billing_live_reconciliation_due_event_v1(
          v_binding.id,v_binding.stripe_account,v_binding.stripe_customer_id,v_binding.stripe_subscription_id,v_now)))) then
    return jsonb_build_object('status','busy');
  end if;

  -- The bound checkout is immutable to its writer after binding. Do not take
  -- its row lock here: checkout finalization takes checkout before binding.
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_binding.subject_user_id::text,20620260924));
  select revision into v_plan_revision from public.account_plans
    where subject_user_id=v_binding.subject_user_id for update;
  perform public.lock_effective_feature_entitlement_v1(v_binding.subject_user_id,'classrooms.create');
  v_now:=clock_timestamp();
  if v_plan_revision is null or not private.billing_live_reconciliation_plan_valid_v1(v_binding.id,p_project_ref,p_stripe_account) then
    update public.stripe_billing_subscription_bindings set reconcile_state='attention',
      reconcile_attention_at=v_now,last_exception_code='subscription_transition_unapproved',
      lease_token=null,lease_expires_at=null,next_reconcile_at=null,revision=revision+1,updated_at=v_now
    where id=v_binding.id returning * into v_binding;
    insert into public.stripe_billing_subscription_audit(subscription_id,outcome,subscription_revision,
      account_plan_revision,offering_version_id,reason_code)
    values(v_binding.id,'exception',v_binding.revision,v_plan_revision,v_binding.offering_version_id,'subscription_transition_unapproved');
    return jsonb_build_object('status','busy');
  end if;

  update public.stripe_billing_subscription_bindings set lease_token=gen_random_uuid(),
    lease_expires_at=v_now+make_interval(secs=>v_lease_seconds),fencing_token=fencing_token+1,
    revision=revision+1,updated_at=v_now where id=v_binding.id returning * into v_binding;
  return jsonb_build_object('status','claimed','subscription_id',v_binding.id,
    'lease_token',v_binding.lease_token,'fencing_token',v_binding.fencing_token,'lease_expires_at',v_binding.lease_expires_at,
    'subscription_revision',v_binding.revision,'expected_account_plan_revision',v_plan_revision,
    'binding',v_provenance,'lifecycle',private.billing_claim_access_facts_v1(v_binding.id));
end;
$$;

revoke all on function private.billing_live_reconciliation_binding_v1(uuid,text),
  private.billing_live_reconciliation_blocked_v1(uuid),
  private.billing_live_reconciliation_plan_valid_v1(uuid,text,text),
  private.billing_live_reconciliation_due_event_v1(uuid,text,text,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.billing_list_live_work_v1(text,text,jsonb),public.billing_claim_live_subscription_v1(text,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.billing_list_live_work_v1(text,text,jsonb),public.billing_claim_live_subscription_v1(text,text,jsonb)
  to service_role;

commit;
