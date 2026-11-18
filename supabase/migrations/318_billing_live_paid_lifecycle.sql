-- Verified live paid application. Provider observations are validated by the
-- server synchronizer; this writer repeats target, lease, provenance and audit
-- fences. Checkout, catalog and provider mutation switches are not consulted:
-- existing payers continue to reconcile while new sales are stopped.
begin;

create function public.billing_finish_live_lifecycle_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.stripe_billing_subscription_bindings%rowtype; p public.account_plans%rowtype;
  a public.billing_account_access%rowtype; e public.stripe_billing_invoice_effects%rowtype;
  v_outcome text:=p_request->>'outcome'; v_now timestamptz:=clock_timestamp(); v_period_start timestamptz;
  v_period_end timestamptz; v_end timestamptz; v_reason text; v_replayed boolean:=false; v_changed boolean:=false; v_preserve_cutoff boolean:=false;
  v_previous jsonb; v_event uuid; v_revision bigint; v_retry_until timestamptz; v_next_attempt timestamptz;
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
        next_reconcile_at=v_now+interval '1 day',revision=revision+1,updated_at=v_now where id=b.id returning * into b;
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
      if e.subscription_id<>b.id or e.offering_version_id<>b.offering_version_id or e.period_start<>v_period_start or e.period_end<>v_period_end then
        return jsonb_build_object('status','rejected','retry_scheduled',false); end if;
      v_replayed:=true;
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
    v_changed:=a.subject_user_id is null or a.source<>'paid' or a.subscription_id<>b.id or a.paid_through is distinct from v_period_end
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
    -- Live upgrades and scheduled transitions are not part of this writer.
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

revoke all on function public.billing_finish_live_lifecycle_v1(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.billing_finish_live_lifecycle_v1(text,text,jsonb) to service_role;
commit;
