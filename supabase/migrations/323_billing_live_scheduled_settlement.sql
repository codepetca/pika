-- Carry live Checkout provenance through a verified renewal-boundary downgrade.
-- Keep the ordinary writer's existing wire contract and share its financial
-- effects with the separately scoped scheduled entry point.
begin;

alter table private.billing_scheduled_plan_changes
  add column live_settled_invoice_id text check (live_settled_invoice_id ~ '^in_[A-Za-z0-9]{1,255}$'),
  add check (live_settled_invoice_id is null or state='applied');

-- Only a completed same-binding change with its adjacent paid receipts can
-- bridge the original Checkout offering to the current subscription offering.
create function private.billing_live_checkout_origin_matches_v1(p_subscription uuid,p_stripe_account text,p_attempt uuid)
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
          and private.stripe_live_checkout_offering_v1(change.source_offering_version_id,p_stripe_account) is not null)));
$$;

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

create or replace function private.stripe_live_checkout_attempt_v1(p_attempt uuid,p_stripe_account text)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('attempt_id',a.id,'subject_user_id',a.subject_user_id,
    'offering',private.stripe_live_checkout_offering_v1(a.offering_version_id,p_stripe_account),'lookup_key',a.lookup_key,
    'status',a.status,'customer_id',a.stripe_customer_id,'session_id',a.stripe_session_id,
    'checkout_url',a.checkout_url,'success_url',a.success_url,'cancel_url',a.cancel_url,
    'write_deadline',a.write_deadline,'created_at',a.created_at,
    'access_confirmed',a.status='bound' and exists(
      select 1 from public.billing_account_access access
      join public.account_plans p on p.subject_user_id=access.subject_user_id
      join public.stripe_billing_subscription_bindings b on b.id=access.subscription_id
      join public.effective_feature_entitlements ent on ent.subject_user_id=p.subject_user_id and ent.feature_key='classrooms.create'
      where access.subject_user_id=a.subject_user_id and access.source='paid'
        and access.subscription_id=a.subscription_id and b.is_current
        and b.provider_mode='live' and b.stripe_account=p_stripe_account
        and b.subject_user_id=a.subject_user_id
        and (b.offering_version_id=a.offering_version_id
          or private.billing_live_checkout_origin_matches_v1(b.id,p_stripe_account,a.id))
        and access.offering_version_id=b.offering_version_id and p.billing_offering_version_id=b.offering_version_id
        and p.management_source='billing' and p.revision=access.account_plan_revision
        and ent.revision=access.entitlement_revision and ent.enabled
        and access.starts_at<=clock_timestamp() and access.access_ends_at>clock_timestamp()
        and (ent.starts_at is null or ent.starts_at<=clock_timestamp())
        and (ent.expires_at is null or ent.expires_at>clock_timestamp())))
  from public.stripe_checkout_attempts a where a.id=p_attempt and a.offering_version_id in (select id from public.stripe_billing_offering_versions where provider_mode='live' and stripe_account=p_stripe_account);
$$;

create or replace function private.billing_live_reconciliation_blocked_v1(p_subscription uuid)
returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from public.billing_upgrade_operations upgrade
      where upgrade.subscription_id=p_subscription and upgrade.status in ('queued','retry','attention'))
    or exists(select 1 from private.billing_scheduled_plan_changes change
      where change.subscription_id=p_subscription and change.state='confirmed')
    or exists(select 1 from public.billing_renewal_closeouts closeout
      where closeout.subscription_id=p_subscription and closeout.status in ('queued','retry','attention'))
    or exists(select 1 from public.stripe_billing_subscription_bindings binding
      join public.billing_account_access access on access.subscription_id=binding.id and access.subject_user_id=binding.subject_user_id
      join private.stripe_billing_settings settings on settings.singleton and settings.live_closeout_enabled
        and settings.live_payment_lifecycle_enabled and settings.live_stripe_account=binding.stripe_account
      where binding.id=p_subscription and binding.is_current and binding.provider_mode='live'
        and access.source='paid' and access.end_reason='renewal_grace' and access.failed_renewal_invoice_id is not null
        and access.access_ends_at=access.paid_through+interval '168 hours' and access.access_ends_at<=clock_timestamp()
        and private.billing_live_closeout_binding_valid_v1(binding.id,binding.stripe_account));
$$;


create function private.billing_finish_live_lifecycle_core_v1(
  p_project_ref text,p_stripe_account text,p_request jsonb,p_schedule jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.stripe_billing_subscription_bindings%rowtype; p public.account_plans%rowtype;
  a public.billing_account_access%rowtype; e public.stripe_billing_invoice_effects%rowtype;
  v_outcome text:=p_request->>'outcome'; v_now timestamptz:=clock_timestamp(); v_period_start timestamptz;
  v_period_end timestamptz; v_end timestamptz; v_reason text; v_replayed boolean:=false; v_changed boolean:=false; v_preserve_cutoff boolean:=false;
  v_previous jsonb; v_event uuid; v_revision bigint; v_retry_until timestamptz; v_next_attempt timestamptz;
  v_change private.billing_scheduled_plan_changes%rowtype;
  v_binding_attempt integer; v_event_attempt integer; v_attention boolean;
begin
  perform private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  -- Preserve migration 209's public validation contract before examining a lease
  -- or binding. Malformed requests are invalid parameters, not lost claims.
  if p_request is null or jsonb_typeof(p_request)<>'object'
    or (p_request->>'subscription_id') is null or (p_request->>'lease_token') is null
    or coalesce(p_request->>'fencing_token','') !~ '^[1-9][0-9]*$'
    or coalesce(p_request->>'expected_subscription_revision','') !~ '^[1-9][0-9]*$'
    or coalesce(p_request->>'expected_account_plan_revision','') !~ '^[1-9][0-9]*$'
    or v_outcome is null or v_outcome not in ('paid','renewal_failed','renewal_invoice_pending','canceled','observed','noop','exception')
    or (v_outcome='exception' and ((p_request->>'reason_code') is null
      or not private.stripe_billing_reason_allowed_v1(p_request->>'reason_code')))
    or ((p_request->>'reason_code') is not null and (p_request->>'reason_code') !~ '^[a-z][a-z0-9._-]{0,99}$') then
    raise exception using errcode='22023',message='stripe_billing_finish_request_invalid'; end if;
  if exists(select 1 from jsonb_object_keys(p_request) k(name) where name not in (
    'subscription_id','lease_token','fencing_token','expected_subscription_revision','expected_account_plan_revision',
    'outcome','event_inbox_id','invoice_id','period_start','period_end','reason_code','provider_status',
    'cancel_at_period_end','obligations_cleared'))
    or (p_request ? 'provider_status' and coalesce(p_request->>'provider_status','') not in
      ('active','past_due','unpaid','canceled','incomplete','incomplete_expired','trialing','paused'))
    or (p_request ? 'cancel_at_period_end' and jsonb_typeof(p_request->'cancel_at_period_end') is distinct from 'boolean')
    or (p_request ? 'obligations_cleared' and jsonb_typeof(p_request->'obligations_cleared') is distinct from 'boolean') then
    raise exception using errcode='22023',message='stripe_billing_finish_request_invalid';
  end if;
  select * into b from public.stripe_billing_subscription_bindings
    where id=(p_request->>'subscription_id')::uuid and stripe_account=p_stripe_account and provider_mode='live' for update;
  v_now:=clock_timestamp();
  if not found or not b.is_current then return jsonb_build_object('status','rejected','retry_scheduled',false); end if;
  if b.lease_token is null or b.lease_token is distinct from (p_request->>'lease_token')::uuid
    or b.lease_expires_at<=v_now or b.fencing_token is distinct from (p_request->>'fencing_token')::bigint
    or b.revision is distinct from (p_request->>'expected_subscription_revision')::bigint then
    return jsonb_build_object('status','lost_claim','retry_scheduled',true); end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||b.subject_user_id::text,20620260924));
  select * into p from public.account_plans where subject_user_id=b.subject_user_id for update;
  perform public.lock_effective_feature_entitlement_v1(b.subject_user_id,'classrooms.create');
  select * into a from public.billing_account_access where subject_user_id=b.subject_user_id for update;
  if p.revision is distinct from (p_request->>'expected_account_plan_revision')::bigint
    or (a.subject_user_id is not null and (a.account_plan_revision<>p.revision or a.entitlement_revision is distinct from
      (select revision from public.effective_feature_entitlements where subject_user_id=b.subject_user_id and feature_key='classrooms.create'))) then
    return jsonb_build_object('status','plan_conflict','retry_scheduled',true); end if;
  if a.source='paid' and a.subscription_id<>b.id and exists(select 1 from public.stripe_billing_subscription_bindings where id=a.subscription_id and is_current) then
    return jsonb_build_object('status','rejected','retry_scheduled',false); end if;
  if private.billing_live_reconciliation_binding_v1(b.id,p_stripe_account) is null then
    return jsonb_build_object('status','rejected','retry_scheduled',false);
  end if;
  if not coalesce(private.billing_live_reconciliation_plan_valid_v1(b.id,p_project_ref,p_stripe_account),false) then
    return jsonb_build_object('status','plan_conflict','retry_scheduled',true);
  end if;
  if p_schedule is not null then
    select * into v_change from private.billing_scheduled_plan_changes
      where id=(p_schedule->>'operation_id')::uuid and subscription_id=b.id
        and subject_user_id=b.subject_user_id and state='scheduled' for update;
    v_period_start:=(p_request->>'period_start')::timestamptz;
    v_period_end:=(p_request->>'period_end')::timestamptz;
    if v_change.id is null
      or v_outcome not in ('paid','renewal_failed','renewal_invoice_pending')
      or v_change.provider_schedule_id is distinct from p_schedule->>'provider_schedule_id'
      or v_change.target_offering_version_id is distinct from (p_schedule->>'target_offering_version_id')::uuid
      or v_change.source_offering_version_id is distinct from b.offering_version_id
      or not private.billing_live_scheduled_target_valid_v1(b.offering_version_id,v_change.target_offering_version_id,p_stripe_account)
      or a.source is distinct from 'paid' or a.subscription_id is distinct from b.id
      or a.offering_version_id is distinct from v_change.source_offering_version_id
      or a.paid_period_start is distinct from v_change.paid_period_start
      or a.paid_through is distinct from v_change.effective_at
      or a.last_paid_invoice_id is distinct from v_change.last_paid_invoice_id
      or a.end_reason not in ('renewal_pending','renewal_grace')
      or (a.end_reason='renewal_grace' and a.failed_renewal_invoice_id is distinct from p_request->>'invoice_id')
      or coalesce(p_request->>'invoice_id','') !~ '^in_[A-Za-z0-9]{1,255}$'
      or p_request->>'invoice_id'=a.last_paid_invoice_id
      or v_period_start is distinct from v_change.effective_at or v_change.effective_at>clock_timestamp()
      or v_period_end is distinct from private.billing_scheduled_term_end_v1(v_change.effective_at,v_change.target_offering_version_id)
      or exists(select 1 from public.billing_renewal_closeouts closeout where closeout.subscription_id=b.id
        and closeout.status in ('queued','retry','attention')) then
      return jsonb_build_object('status','rejected','retry_scheduled',false);
    end if;
  elsif v_outcome not in ('exception','noop') and exists(
    select 1 from private.billing_scheduled_plan_changes change where change.subscription_id=b.id and change.state='scheduled'
  ) then
    -- Only the scheduled path may interpret financial effects while this
    -- change owns the subscription. The current purchase remains untouched.
    return jsonb_build_object('status','rejected','retry_scheduled',false);
  end if;
  v_event:=(p_request->>'event_inbox_id')::uuid;
  if v_event is not null then
    perform 1 from public.stripe_billing_event_inbox where id=v_event and subscription_id=b.id
      and stripe_account=p_stripe_account and provider_mode='live'
      and stripe_subscription_id=b.stripe_subscription_id and stripe_customer_id=b.stripe_customer_id for update;
    if not found then return jsonb_build_object('status','rejected','retry_scheduled',false); end if;
  end if;
  -- Time is authoritative only after every settings, binding, plan, feature
  -- and event wait. No expired claim can change paid access or consume a retry.
  v_now:=clock_timestamp();
  if b.lease_expires_at is null or b.lease_expires_at<=v_now then
    return jsonb_build_object('status','lost_claim','retry_scheduled',true);
  end if;
  -- Match the 209 retry budget without invoking its sandbox-only writer.
  if v_outcome in ('exception','noop') then
    if v_outcome='exception' then
      v_binding_attempt:=least(b.reconcile_attempt_count+1,5);
      select least(attempt_count+1,5) into v_event_attempt from public.stripe_billing_event_inbox where id=v_event;
      v_reason:=p_request->>'reason_code';
      v_attention:=v_reason<>'provider_unavailable' or v_binding_attempt>=5 or coalesce(v_event_attempt,0)>=5;
      v_next_attempt:=case when v_attention then null else v_now+private.stripe_billing_retry_delay_v1(v_binding_attempt) end;
      update public.stripe_billing_subscription_bindings set lease_token=null,lease_expires_at=null,
        last_provider_status=v_reason,last_exception_code=v_reason,
        reconcile_state=case when v_attention then 'attention' else 'retry' end,
        reconcile_attempt_count=v_binding_attempt,reconcile_attention_at=case when v_attention then v_now end,
        next_reconcile_at=v_next_attempt,revision=revision+1,updated_at=v_now where id=b.id returning * into b;
      if v_event is not null then
        update public.stripe_billing_event_inbox set status=case when v_attention then 'attention' else 'exception' end,
          attempt_count=v_event_attempt,exception_code=v_reason,attention_at=case when v_attention then v_now end,
          next_attempt_at=v_next_attempt where id=v_event;
      end if;
    else
      update public.stripe_billing_subscription_bindings set lease_token=null,lease_expires_at=null,
        last_exception_code=null,reconcile_state='queued',reconcile_attempt_count=0,reconcile_attention_at=null,
        next_reconcile_at=least(v_now+interval '1 day',coalesce((
          select greatest(change.effective_at,v_now+interval '1 minute')
          from private.billing_scheduled_plan_changes change where change.subscription_id=b.id and change.state='scheduled'
        ),'infinity'::timestamptz)),revision=revision+1,updated_at=v_now where id=b.id returning * into b;
      if v_event is not null then
        update public.stripe_billing_event_inbox set status='completed',exception_code=null,
          next_attempt_at=null,completed_at=v_now where id=v_event;
      end if;
    end if;
    insert into public.stripe_billing_subscription_audit(subscription_id,event_inbox_id,outcome,subscription_revision,reason_code)
      values(b.id,v_event,v_outcome,b.revision,p_request->>'reason_code');
    return jsonb_build_object('status','applied','retry_scheduled',false);
  end if;
  if jsonb_typeof(p_request->'cancel_at_period_end') is distinct from 'boolean'
    or jsonb_typeof(p_request->'obligations_cleared') is distinct from 'boolean'
    or coalesce(p_request->>'provider_status','') not in ('active','past_due','unpaid','canceled') then
    return jsonb_build_object('status','rejected','retry_scheduled',false);
  end if;
  if v_outcome='renewal_invoice_pending' then
    v_period_start:=(p_request->>'period_start')::timestamptz;
    v_period_end:=(p_request->>'period_end')::timestamptz;
    v_now:=clock_timestamp();
    if b.lease_expires_at<=v_now then return jsonb_build_object('status','lost_claim','retry_scheduled',true); end if;
    if a.source is distinct from 'paid' or a.subscription_id is distinct from b.id
      or a.offering_version_id is distinct from b.offering_version_id or a.end_reason is distinct from 'renewal_pending'
      or a.expiry_applied_at is not null or a.access_ends_at is distinct from a.paid_through
      or p.management_source is distinct from 'billing' or p.billing_offering_version_id is distinct from b.offering_version_id
      or coalesce(p_request->>'invoice_id','') !~ '^in_[A-Za-z0-9]{1,255}$'
      or p_request->>'invoice_id'=a.last_paid_invoice_id or v_period_start is distinct from a.paid_through
      or v_period_end is null or not isfinite(v_period_end) or v_period_end<=v_period_start
      or p_request->>'provider_status' is distinct from 'active'
      or p_request->'cancel_at_period_end' is distinct from 'false'::jsonb
      or p_request->'obligations_cleared' is distinct from 'false'::jsonb then
      return jsonb_build_object('status','rejected','retry_scheduled',false);
    end if;
    -- Stripe typically waits an hour to attempt collection and can defer invoice
    -- finalization for up to 72 hours. Expected waiting does not consume the
    -- transport retry budget or change the existing paid-through/access cutoff.
    v_retry_until:=a.paid_through+interval '73 hours';
    if v_now<v_retry_until then v_next_attempt:=least(v_now+interval '15 minutes',v_retry_until); end if;
    update public.stripe_billing_subscription_bindings set
      lease_token=null,lease_expires_at=null,last_provider_status='active',last_exception_code=v_outcome,
      reconcile_state=case when v_next_attempt is null then 'attention' else 'retry' end,reconcile_attempt_count=0,
      reconcile_attention_at=case when v_next_attempt is null then v_now end,next_reconcile_at=v_next_attempt,
      revision=revision+1,updated_at=v_now where id=b.id;
    if v_event is not null then
      update public.stripe_billing_event_inbox set
        status=case when v_next_attempt is null then 'attention' else 'exception' end,attempt_count=0,exception_code=v_outcome,
        attention_at=case when v_next_attempt is null then v_now end,next_attempt_at=v_next_attempt
        where id=v_event and status in ('received','exception');
    end if;
    return jsonb_build_object('status',case when v_next_attempt is null then 'attention' else 'deferred' end,
      'retry_scheduled',v_next_attempt is not null);
  end if;
  v_previous:=case when a.subject_user_id is null then null else to_jsonb(a) end;
  if v_outcome='paid' then
    v_period_start:=(p_request->>'period_start')::timestamptz; v_period_end:=(p_request->>'period_end')::timestamptz;
    if coalesce(p_request->>'invoice_id','') !~ '^in_[A-Za-z0-9]{1,255}$'
      or p_request->>'provider_status' not in ('active','canceled')
      or v_period_start is null or not isfinite(v_period_start) or v_period_end is null or not isfinite(v_period_end) or v_period_end<=v_period_start
      or (a.subscription_id=b.id and a.paid_through is not null and v_period_end<a.paid_through) then
      return jsonb_build_object('status','rejected','retry_scheduled',false); end if;
    perform pg_advisory_xact_lock(hashtextextended('stripe-invoice:'||b.stripe_account||':'||(p_request->>'invoice_id'),20920260926));
    v_now:=clock_timestamp();
    if b.lease_expires_at<=v_now then return jsonb_build_object('status','lost_claim','retry_scheduled',true); end if;
    select * into e from public.stripe_billing_invoice_effects where stripe_account=b.stripe_account and stripe_invoice_id=p_request->>'invoice_id';
    if found then
      if v_change.id is not null or e.subscription_id<>b.id or e.offering_version_id<>b.offering_version_id or e.period_start<>v_period_start or e.period_end<>v_period_end then
        return jsonb_build_object('status','rejected','retry_scheduled',false); end if;
      v_replayed:=true;
    end if;
    if v_change.id is not null then
      -- Move the binding only after source validation and the invoice lock.
      -- The source receipt and Checkout attempt retain their original terms.
      update public.stripe_billing_subscription_bindings set offering_version_id=v_change.target_offering_version_id where id=b.id;
      b.offering_version_id:=v_change.target_offering_version_id;
    end if;
    -- Re-reading the original paid invoice is not a successful renewal. Preserve
    -- its recorded grace (including an elapsed cutoff) and failed invoice identity.
    -- An elapsed cancellation also cannot be undone by replaying its old payment.
    v_preserve_cutoff:=coalesce(a.source='paid' and a.subscription_id=b.id and a.paid_through=v_period_end
      and (a.end_reason='renewal_grace' or (a.end_reason='cancellation' and a.access_ends_at<=v_now)),false);
    if v_preserve_cutoff and a.last_paid_invoice_id is distinct from (p_request->>'invoice_id') then
      return jsonb_build_object('status','rejected','retry_scheduled',false); end if;
    v_reason:=case when v_preserve_cutoff then a.end_reason
      when coalesce((p_request->>'cancel_at_period_end')::boolean,false) or coalesce(p_request->>'provider_status','')='canceled' then 'cancellation' else 'renewal_pending' end;
    v_end:=case when v_preserve_cutoff then a.access_ends_at else v_period_end end;
    v_changed:=v_change.id is not null or a.subject_user_id is null or a.source<>'paid' or a.subscription_id<>b.id or a.paid_through is distinct from v_period_end
      or a.end_reason<>v_reason or (a.expiry_applied_at is not null and not v_preserve_cutoff);
    insert into public.billing_account_access(subject_user_id,source,subscription_id,offering_version_id,starts_at,
      paid_period_start,paid_through,last_paid_invoice_id,access_ends_at,end_reason,failed_renewal_invoice_id,account_plan_revision,last_provider_verified_at)
      values(b.subject_user_id,'paid',b.id,b.offering_version_id,v_period_start,v_period_start,v_period_end,p_request->>'invoice_id',v_end,v_reason,
        case when v_preserve_cutoff then a.failed_renewal_invoice_id else null end,p.revision,v_now)
    on conflict(subject_user_id) do update set source='paid',subscription_id=b.id,offering_version_id=b.offering_version_id,
      trial_subject_user_id=null,starts_at=v_period_start,paid_period_start=v_period_start,paid_through=v_period_end,
      last_paid_invoice_id=p_request->>'invoice_id',access_ends_at=v_end,end_reason=v_reason,
      failed_renewal_invoice_id=case when v_preserve_cutoff then a.failed_renewal_invoice_id else null end,
      last_provider_verified_at=v_now,revision=public.billing_account_access.revision+case when v_changed then 1 else 0 end,updated_at=v_now;
    update public.billing_trials set converted_to_paid_at=coalesce(converted_to_paid_at,v_now) where subject_user_id=b.subject_user_id;
    if v_changed then v_revision:=private.billing_write_access_v1(b.subject_user_id,p.revision,'stripe_paid'); else v_revision:=p.revision; end if;
    if not v_replayed then
      insert into public.stripe_billing_invoice_effects(subscription_id,stripe_account,stripe_invoice_id,offering_version_id,account_plan_revision,period_start,period_end,event_inbox_id)
        values(b.id,b.stripe_account,p_request->>'invoice_id',b.offering_version_id,v_revision,v_period_start,v_period_end,v_event);
    end if;
    update public.stripe_billing_subscription_bindings set last_period_start=v_period_start,last_period_end=v_period_end where id=b.id;
    if v_change.id is not null then
      -- Keep the schedule visible through the account-plan audit so the
      -- classroom-capacity trigger can use the saved classroom selection.
      update private.billing_scheduled_plan_changes set state='applied',live_settled_invoice_id=p_request->>'invoice_id'
        where id=v_change.id;
    end if;
  elsif v_outcome in ('renewal_failed','canceled') then
    if a.source is distinct from 'paid' or a.subscription_id is distinct from b.id or a.paid_through is null then
      return jsonb_build_object('status','rejected','retry_scheduled',false); end if;
    if v_outcome='renewal_failed' then
      if coalesce(p_request->>'invoice_id','') !~ '^in_[A-Za-z0-9]{1,255}$'
        or p_request->>'invoice_id'=a.last_paid_invoice_id
        or (p_request->>'period_start')::timestamptz is distinct from a.paid_through
        or coalesce(p_request->>'provider_status','') not in ('active','past_due','unpaid','canceled')
        or (p_request->>'period_end')::timestamptz is null or not isfinite((p_request->>'period_end')::timestamptz)
        or (p_request->>'period_end')::timestamptz<=a.paid_through
        or (a.end_reason='renewal_grace' and a.failed_renewal_invoice_id is distinct from (p_request->>'invoice_id')) then
        return jsonb_build_object('status','rejected','retry_scheduled',false); end if;
      v_end:=a.paid_through+interval '168 hours'; v_reason:='renewal_grace';
    else
      -- Provider cancellation after exhausted retries does not revoke the promised
      -- complimentary grace. Preserve its exact cutoff even after local expiry.
      v_end:=case when a.end_reason='renewal_grace' then a.access_ends_at else a.paid_through end;
      v_reason:=case when a.end_reason='renewal_grace' then 'renewal_grace' else 'cancellation' end;
    end if;
    v_changed:=a.access_ends_at<>v_end or a.end_reason<>v_reason;
    update public.billing_account_access set access_ends_at=v_end,end_reason=v_reason,
      failed_renewal_invoice_id=case when v_outcome='renewal_failed' then p_request->>'invoice_id' else failed_renewal_invoice_id end,
      last_provider_verified_at=v_now,revision=revision+case when v_changed then 1 else 0 end,updated_at=v_now where subject_user_id=b.subject_user_id;
    if v_changed then perform private.billing_write_access_v1(b.subject_user_id,p.revision,
      case when v_outcome='renewal_failed' then 'renewal_failed' else 'subscription_canceled' end); end if;
  elsif v_outcome='observed' then
    -- An observation without a verified invoice cannot resume a purchased term.
    return jsonb_build_object('status','rejected','retry_scheduled',false);
  end if;
  select * into a from public.billing_account_access where subject_user_id=b.subject_user_id;
  -- Terminal + cleared observations are required together. Open invoices keep the
  -- binding current even after effective access ends; never create a second payer.
  update public.stripe_billing_subscription_bindings set
    terminal_confirmed_at=case when coalesce(p_request->>'provider_status','')='canceled' then v_now else terminal_confirmed_at end,
    obligations_cleared_at=case when coalesce(p_request->>'provider_status','')='canceled' and coalesce((p_request->>'obligations_cleared')::boolean,false) then v_now else obligations_cleared_at end,
    is_current=not coalesce((p_request->>'provider_status'='canceled' and (p_request->>'obligations_cleared')::boolean and a.access_ends_at<=v_now),false),
    last_provider_status=coalesce(p_request->>'provider_status',last_provider_status),
    lease_token=null,lease_expires_at=null,reconcile_state='queued',reconcile_attempt_count=0,reconcile_attention_at=null,last_exception_code=null,
    next_reconcile_at=least(v_now+interval '1 day',greatest(a.access_ends_at,v_now+interval '1 minute')),
    revision=revision+1,updated_at=v_now where id=b.id;
  if v_event is not null then update public.stripe_billing_event_inbox set status='completed',completed_at=v_now,next_attempt_at=null,exception_code=null where id=v_event; end if;
  if v_changed then
    insert into public.billing_lifecycle_audit(subject_user_id,subscription_id,operation_id,reason,previous_state,next_state)
      values(b.subject_user_id,b.id,gen_random_uuid(),v_outcome,v_previous,to_jsonb(a));
  end if;
  return jsonb_build_object('status',case when v_replayed and not v_changed then 'replayed' else 'applied' end,'retry_scheduled',false);
end; $$;

create or replace function public.billing_finish_live_lifecycle_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language sql security definer set search_path='' as $$
  select private.billing_finish_live_lifecycle_core_v1(p_project_ref,p_stripe_account,p_request,null);
$$;

create function public.billing_finish_live_scheduled_renewal_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if jsonb_typeof(p_request) is distinct from 'object'
    or coalesce(p_request->>'operation_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_request->>'target_offering_version_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_request->>'provider_schedule_id','') !~ '^sub_sched_[A-Za-z0-9]{1,240}$' then
    raise exception using errcode='22023',message='billing_scheduled_renewal_request_invalid';
  end if;
  return private.billing_finish_live_lifecycle_core_v1(p_project_ref,p_stripe_account,
    p_request-array['operation_id','provider_schedule_id','target_offering_version_id'],
    jsonb_build_object('operation_id',p_request->'operation_id','provider_schedule_id',p_request->'provider_schedule_id',
      'target_offering_version_id',p_request->'target_offering_version_id'));
end;
$$;

-- Read an installed or first settled phase only for a fresh, exact live lease.
create function public.billing_get_live_scheduled_renewal_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
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
        'currency',target.currency,'interval',target.interval,'provider_mode',target.provider_mode))
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
      and ((change.state='scheduled' and access.paid_through=change.effective_at
        and access.paid_period_start=change.paid_period_start and access.last_paid_invoice_id=change.last_paid_invoice_id)
      or (change.state='applied' and access.paid_period_start=change.effective_at
        and access.last_paid_invoice_id=change.live_settled_invoice_id))
  );
end;
$$;

revoke all on function private.billing_live_checkout_origin_matches_v1(uuid,text,uuid),
  private.billing_finish_live_lifecycle_core_v1(text,text,jsonb,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.billing_finish_live_scheduled_renewal_v1(text,text,jsonb),
  public.billing_get_live_scheduled_renewal_v1(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.billing_finish_live_scheduled_renewal_v1(text,text,jsonb),
  public.billing_get_live_scheduled_renewal_v1(text,text,jsonb) to service_role;
commit;
