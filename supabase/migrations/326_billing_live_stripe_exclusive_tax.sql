-- Freeze optional exclusive Stripe Tax treatment on the live offering version.
-- This migration changes no provider controls, commercial terms, or paid access writers.
begin;

-- Registration still compares the entire immutable version on a replay.
create or replace function private.billing_live_checkout_terms_valid_v1(
  p_plan text,p_currency text,p_interval text,p_amount bigint,p_limit integer,p_features jsonb,p_ai jsonb
) returns boolean language sql immutable set search_path='' as $$
  select coalesce(exists (
    select 1 from (values
      ('plus','pro','usd','month',1900::bigint,5),('plus','pro','usd','year',19900::bigint,5),
      ('plus','pro','cad','month',2700::bigint,5),('plus','pro','cad','year',27900::bigint,5),
      ('pro','max','usd','month',3900::bigint,12),('pro','max','usd','year',39900::bigint,12),
      ('pro','max','cad','month',5500::bigint,12),('pro','max','cad','year',55900::bigint,12)
    ) terms(plan_key,public_plan,currency,billing_interval,amount,classroom_limit)
    where terms.plan_key=p_plan and terms.currency=p_currency and terms.billing_interval=p_interval
      and terms.amount=p_amount and terms.classroom_limit=p_limit and p_ai is null
      and (not (p_features ? 'billing_tax_mode') or p_features->'billing_tax_mode'='"stripe_exclusive"'::jsonb)
      and p_features-'billing_tax_mode'=jsonb_build_object(
        'catalog_key','pika:repolight-2026-10-29:'||terms.public_plan||':'||terms.currency||':'||terms.billing_interval
          ||case when p_features ? 'billing_tax_mode' then ':stripe-exclusive' else '' end,
        'display_name',case terms.public_plan when 'pro' then 'Pro' else 'Max' end,
        'release_tag','repolight-2026-10-29','repolight_analysis',true)
  ),false);
$$;

-- Availability gates new selection, while pinned reads retain the old version.
create or replace function private.stripe_live_checkout_offering_v1(p_version uuid,p_stripe_account text)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('offering_version_id',v.id,'plan_key',o.plan_key,
    'stripe_account',v.stripe_account,'provider_mode','live','stripe_product_id',v.stripe_product_id,
    'stripe_price_id',v.stripe_price_id,'currency',v.currency,'interval',v.interval,
    'unit_amount',v.unit_amount,'classroom_limit',v.classroom_limit,'catalog_key',v.features->>'catalog_key')
    || jsonb_strip_nulls(jsonb_build_object('tax_mode',v.features->'billing_tax_mode'))
  from public.stripe_billing_offering_versions v join public.stripe_billing_offerings o on o.id=v.offering_id
  where v.id=p_version and v.stripe_account=p_stripe_account and v.provider_mode='live'
    and private.billing_live_checkout_terms_valid_v1(o.plan_key,v.currency,v.interval,v.unit_amount,v.classroom_limit,v.features,v.ai_definition);
$$;

-- Reconciliation uses the binding version, which can move on a proven renewal.
create or replace function private.billing_live_reconciliation_binding_v1(p_subscription uuid,p_stripe_account text)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object(
    'subscription_id',binding.id,'subject_user_id',binding.subject_user_id,
    'stripe_account',binding.stripe_account,'stripe_customer_id',binding.stripe_customer_id,
    'stripe_subscription_id',binding.stripe_subscription_id,'offering_id',offering.id,
    'offering_version_id',version.id,'stripe_product_id',version.stripe_product_id,
    'stripe_price_id',version.stripe_price_id,'unit_amount',version.unit_amount,
    'plan_key',offering.plan_key,'currency',version.currency,'interval',version.interval,
    'provider_mode',binding.provider_mode)
    || jsonb_strip_nulls(jsonb_build_object('tax_mode',version.features->'billing_tax_mode'))
  from public.stripe_billing_subscription_bindings binding
  join public.stripe_billing_offering_versions version on version.id=binding.offering_version_id
    and version.stripe_account=binding.stripe_account and version.provider_mode=binding.provider_mode
  join public.stripe_billing_offerings offering on offering.id=version.offering_id
  join public.stripe_billing_customers customer on customer.subject_user_id=binding.subject_user_id
    and customer.stripe_account=binding.stripe_account and customer.provider_mode=binding.provider_mode
    and customer.stripe_customer_id=binding.stripe_customer_id
  where binding.id=p_subscription and binding.provider_mode='live' and binding.stripe_account=p_stripe_account
    and private.stripe_live_checkout_offering_v1(version.id,p_stripe_account) is not null
    and private.billing_live_checkout_origin_matches_v1(binding.id,p_stripe_account,null);
$$;

-- A schedule can change the price without changing its tax treatment.
create or replace function private.billing_live_scheduled_target_valid_v1(p_source uuid,p_target uuid,p_stripe_account text)
returns boolean language sql stable set search_path='' as $$
  select coalesce(source->>'plan_key'='pro' and target->>'plan_key'='plus'
    and source->>'currency'=target->>'currency' and source->>'interval'=target->>'interval'
    and (source->'tax_mode') is not distinct from (target->'tax_mode')
    and (target->>'unit_amount')::bigint<(source->>'unit_amount')::bigint,false)
  from (select private.stripe_live_checkout_offering_v1(p_source,p_stripe_account) as source,
    private.stripe_live_checkout_offering_v1(p_target,p_stripe_account) as target) terms;
$$;

-- Use the exact paid source to select offers, even after its price is retired.
create function public.billing_list_live_scheduled_change_offerings_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_subject uuid;
  v_source uuid;
  v_catalog jsonb;
  v_items jsonb;
  v_now timestamptz;
begin
  if jsonb_typeof(p_request) is distinct from 'object'
    or p_request-'subject_user_id'<>'{}'::jsonb
    or coalesce(p_request->>'subject_user_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode='22023',message='billing_scheduled_change_catalog_request_invalid';
  end if;
  perform private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  if not public.billing_live_scheduled_customer_ready_v1(p_project_ref,p_stripe_account) then
    return '{"items":[]}'::jsonb;
  end if;

  v_subject:=(p_request->>'subject_user_id')::uuid;
  v_now:=clock_timestamp();
  select binding.offering_version_id into v_source
    from public.stripe_billing_subscription_bindings binding
    join public.billing_account_access access on access.subscription_id=binding.id
      and access.subject_user_id=binding.subject_user_id
    where binding.subject_user_id=v_subject and binding.is_current
      and binding.provider_mode='live' and binding.stripe_account=p_stripe_account
      and access.paid_through>v_now+interval '10 minutes'
      and private.billing_live_scheduled_source_valid_v1(binding,access,p_project_ref,p_stripe_account,v_now);
  if not found then return '{"items":[]}'::jsonb; end if;

  v_catalog:=public.billing_list_live_checkout_offerings_v1(p_project_ref,p_stripe_account,
    jsonb_build_object('stripe_account',p_stripe_account));
  select coalesce(jsonb_agg(offer.item order by offer.ordinality),'[]'::jsonb) into v_items
    from jsonb_array_elements(v_catalog->'items') with ordinality as offer(item,ordinality)
    where private.billing_live_scheduled_target_valid_v1(v_source,(offer.item->>'offering_version_id')::uuid,p_stripe_account);
  return jsonb_build_object('items',v_items);
end;
$$;

revoke all on function public.billing_list_live_scheduled_change_offerings_v1(text,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.billing_list_live_scheduled_change_offerings_v1(text,text,jsonb) to service_role;

-- An applied schedule must prove that same continuity from the original Checkout.
create or replace function private.billing_live_checkout_origin_matches_v1(p_subscription uuid,p_stripe_account text,p_attempt uuid)
returns boolean language sql stable set search_path='' as $$
  select exists(
    select 1 from public.stripe_billing_subscription_bindings binding
    join public.stripe_checkout_attempts attempt on attempt.subscription_id=binding.id
      and attempt.subject_user_id=binding.subject_user_id and attempt.stripe_customer_id=binding.stripe_customer_id
    join public.stripe_checkout_audit audit on audit.attempt_id=attempt.id
      and audit.action='bound' and audit.fencing_token=attempt.fencing_token
    where binding.id=p_subscription and binding.provider_mode='live' and binding.stripe_account=p_stripe_account
      and (p_attempt is null or attempt.id=p_attempt)
      and attempt.status='bound' and attempt.stripe_session_id ~ '^cs_live_[A-Za-z0-9]+$'
      and attempt.reserved_plan_revision is not null
      and (attempt.offering_version_id=binding.offering_version_id or exists(
        select 1 from private.billing_scheduled_plan_changes change
        join public.stripe_billing_invoice_effects source on source.subscription_id=binding.id
          and source.stripe_account=binding.stripe_account and source.stripe_invoice_id=change.last_paid_invoice_id
          and source.offering_version_id=change.source_offering_version_id
          and source.period_start=change.paid_period_start and source.period_end=change.effective_at
        join public.stripe_billing_invoice_effects target on target.subscription_id=binding.id
          and target.stripe_account=binding.stripe_account and target.stripe_invoice_id=change.live_settled_invoice_id
          and target.offering_version_id=change.target_offering_version_id
          and target.period_start=change.effective_at and target.period_end=private.billing_scheduled_term_end_v1(
            change.effective_at,change.target_offering_version_id)
          and target.account_plan_revision>source.account_plan_revision
        where change.subscription_id=binding.id and change.subject_user_id=binding.subject_user_id
          and change.state='applied' and change.source_offering_version_id=attempt.offering_version_id
          and change.target_offering_version_id=binding.offering_version_id
          and private.billing_live_scheduled_target_valid_v1(change.source_offering_version_id,
            change.target_offering_version_id,p_stripe_account))));
$$;

-- Cancellation shares the installation operation snapshot.
create or replace function private.billing_live_scheduled_installation_claim_v1(p_id uuid)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_set(claim,'{operation}',claim->'operation'||jsonb_build_object(
    'providerMode','live','lastPaidInvoiceId',change.last_paid_invoice_id)
    || jsonb_strip_nulls(jsonb_build_object('taxMode',source.features->'billing_tax_mode')))
  from private.billing_scheduled_plan_changes change
  join public.stripe_billing_subscription_bindings binding on binding.id=change.subscription_id
    and binding.subject_user_id=change.subject_user_id and binding.provider_mode='live'
  join public.stripe_billing_offering_versions source on source.id=change.source_offering_version_id
  cross join lateral private.billing_scheduled_installation_claim_v1(change.id) as payload(claim)
  where change.id=p_id
    and private.billing_live_scheduled_target_valid_v1(source.id,change.target_offering_version_id,binding.stripe_account);
$$;

-- The scheduled target uses its own immutable version, under the live lease.
create or replace function public.billing_get_live_scheduled_renewal_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  if jsonb_typeof(p_request) is distinct from 'object'
    or p_request-array['subscription_id','lease_token']<>'{}'::jsonb
    or coalesce(p_request->>'subscription_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_request->>'lease_token','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode='22023',message='billing_scheduled_renewal_request_invalid';
  end if;
  return (
    select jsonb_build_object(
      'operation_id',change.id,'provider_schedule_id',change.provider_schedule_id,'effective_at',change.effective_at,'state',change.state,
      'target_binding',jsonb_build_object(
        'subscription_id',binding.id,'subject_user_id',binding.subject_user_id,'stripe_account',binding.stripe_account,
        'stripe_customer_id',binding.stripe_customer_id,'stripe_subscription_id',binding.stripe_subscription_id,
        'offering_id',target.offering_id,'offering_version_id',target.id,'stripe_product_id',target.stripe_product_id,
        'stripe_price_id',target.stripe_price_id,'unit_amount',target.unit_amount,'plan_key',offering.plan_key,
        'currency',target.currency,'interval',target.interval,'provider_mode',target.provider_mode)
        || jsonb_strip_nulls(jsonb_build_object('tax_mode',target.features->'billing_tax_mode')))
    from private.billing_scheduled_plan_changes change
    join public.stripe_billing_subscription_bindings binding on binding.id=change.subscription_id
      and binding.is_current and binding.subject_user_id=change.subject_user_id
      and binding.provider_mode='live' and binding.stripe_account=p_stripe_account
      and binding.offering_version_id=case when change.state='applied' then change.target_offering_version_id
        else change.source_offering_version_id end
    join public.stripe_billing_offering_versions target on target.id=change.target_offering_version_id
      and target.stripe_account=binding.stripe_account and target.provider_mode=binding.provider_mode
    join public.stripe_billing_offerings offering on offering.id=target.offering_id
    join public.billing_account_access access on access.subject_user_id=binding.subject_user_id
      and access.subscription_id=binding.id and access.offering_version_id=binding.offering_version_id
    where binding.id=(p_request->>'subscription_id')::uuid and binding.lease_token=(p_request->>'lease_token')::uuid
      and binding.lease_expires_at>clock_timestamp()
      and private.billing_live_reconciliation_binding_v1(binding.id,p_stripe_account) is not null
      and private.billing_live_scheduled_target_valid_v1(change.source_offering_version_id,
        change.target_offering_version_id,p_stripe_account)
      and ((change.state='scheduled' and access.paid_through=change.effective_at
        and access.paid_period_start=change.paid_period_start and access.last_paid_invoice_id=change.last_paid_invoice_id)
      or (change.state='applied' and access.paid_period_start=change.effective_at
        and access.last_paid_invoice_id=change.live_settled_invoice_id))
  );
end;
$$;

-- Scheduled closeout inherits the target proof. Ordinary closeout reuses the live binding.
create or replace function private.billing_live_renewal_closeout_claim_json_v1(
  p_project_ref text,p_stripe_account text,p_operation uuid
)
returns jsonb language plpgsql set search_path='' as $$
declare
  o public.billing_renewal_closeouts%rowtype;
  b public.stripe_billing_subscription_bindings%rowtype;
  binding jsonb;
  proof jsonb;
begin
  select * into strict o from public.billing_renewal_closeouts where id=p_operation;
  select * into strict b from public.stripe_billing_subscription_bindings where id=o.subscription_id
    and provider_mode='live' and stripe_account=p_stripe_account;
  binding:=private.billing_live_reconciliation_binding_v1(b.id,p_stripe_account);
  if binding is null then return null; end if;
  if o.scheduled_operation_id is null then
    return jsonb_set(private.billing_renewal_closeout_claim_json_v1(o.id),'{binding}',binding);
  end if;
  proof:=public.billing_get_live_scheduled_renewal_v1(p_project_ref,p_stripe_account,
    jsonb_build_object('subscription_id',b.id,'lease_token',b.lease_token));
  if proof->>'state' is distinct from 'scheduled' or proof->>'operation_id' is distinct from o.scheduled_operation_id::text
    or (proof->>'effective_at')::timestamptz is distinct from o.paid_through then return null; end if;
  return jsonb_build_object('status','claimed','operation_id',o.id,'subscription_id',b.id,
    'lease_token',b.lease_token,'fencing_token',b.fencing_token,'lease_expires_at',b.lease_expires_at,
    'subscription_revision',b.revision,'expected_account_plan_revision',o.expected_account_plan_revision,
    'operation_revision',o.revision,'stage',o.stage,'invoice_id',o.invoice_id,'paid_through',o.paid_through,'cutoff',o.cutoff,
    'binding',binding,'scheduled',proof-'state');
end;
$$;

commit;
