-- Restore the foundation's invalid-request contract at the lifecycle entrypoint.
-- Migration 214 is already applied and remains immutable. No schema/data/gate
-- changes; CREATE OR REPLACE retains the existing service-only execution ACL.

create or replace function public.billing_finish_lifecycle_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.stripe_billing_subscription_bindings%rowtype; p public.account_plans%rowtype;
  a public.billing_account_access%rowtype; e public.stripe_billing_invoice_effects%rowtype;
  v_outcome text:=p_request->>'outcome'; v_now timestamptz:=clock_timestamp(); v_period_start timestamptz;
  v_period_end timestamptz; v_end timestamptz; v_reason text; v_replayed boolean:=false; v_changed boolean:=false; v_preserve_cutoff boolean:=false;
  v_previous jsonb; v_event uuid; v_revision bigint;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  -- Preserve migration 209's public validation contract before examining a lease
  -- or binding. Malformed requests are invalid parameters, not lost claims.
  if p_request is null or jsonb_typeof(p_request)<>'object'
    or (p_request->>'subscription_id') is null or (p_request->>'lease_token') is null
    or coalesce(p_request->>'fencing_token','') !~ '^[1-9][0-9]*$'
    or coalesce(p_request->>'expected_subscription_revision','') !~ '^[1-9][0-9]*$'
    or coalesce(p_request->>'expected_account_plan_revision','') !~ '^[1-9][0-9]*$'
    or v_outcome is null or v_outcome not in ('paid','renewal_failed','canceled','observed','noop','exception')
    or (v_outcome='exception' and ((p_request->>'reason_code') is null
      or not private.stripe_billing_reason_allowed_v1(p_request->>'reason_code')))
    or ((p_request->>'reason_code') is not null and (p_request->>'reason_code') !~ '^[a-z][a-z0-9._-]{0,99}$') then
    raise exception using errcode='22023',message='stripe_billing_finish_request_invalid'; end if;
  select * into b from public.stripe_billing_subscription_bindings where id=(p_request->>'subscription_id')::uuid for update;
  if not found or not b.is_current then return jsonb_build_object('status','rejected','retry_scheduled',false); end if;
  if b.lease_token is null or b.lease_token is distinct from (p_request->>'lease_token')::uuid
    or b.lease_expires_at<=v_now or b.fencing_token is distinct from (p_request->>'fencing_token')::bigint
    or b.revision is distinct from (p_request->>'expected_subscription_revision')::bigint then
    return jsonb_build_object('status','lost_claim','retry_scheduled',true); end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||b.subject_user_id::text,20620260924));
  select * into p from public.account_plans where subject_user_id=b.subject_user_id for update;
  select * into a from public.billing_account_access where subject_user_id=b.subject_user_id for update;
  if p.revision is distinct from (p_request->>'expected_account_plan_revision')::bigint
    or (a.subject_user_id is not null and (a.account_plan_revision<>p.revision or a.entitlement_revision is distinct from
      (select revision from public.effective_feature_entitlements where subject_user_id=b.subject_user_id and feature_key='classrooms.create'))) then
    return jsonb_build_object('status','plan_conflict','retry_scheduled',true); end if;
  if a.source='paid' and a.subscription_id<>b.id and exists(select 1 from public.stripe_billing_subscription_bindings where id=a.subscription_id and is_current) then
    return jsonb_build_object('status','rejected','retry_scheduled',false); end if;
  v_event:=(p_request->>'event_inbox_id')::uuid;
  if v_event is not null then
    perform 1 from public.stripe_billing_event_inbox where id=v_event and subscription_id=b.id for update;
    if not found then return jsonb_build_object('status','rejected','retry_scheduled',false); end if;
  end if;
  -- Keep foundation retry accounting and privacy-safe exception handling.
  if v_outcome in ('exception','noop') then return private.billing_finish_subscription_foundation_v1(p_request); end if;
  v_previous:=case when a.subject_user_id is null then null else to_jsonb(a) end;
  if v_outcome='paid' then
    v_period_start:=(p_request->>'period_start')::timestamptz; v_period_end:=(p_request->>'period_end')::timestamptz;
    if p_request->>'invoice_id' is null or v_period_start is null or v_period_end is null or v_period_end<=v_period_start
      or (a.subscription_id=b.id and a.paid_through is not null and v_period_end<a.paid_through) then
      return jsonb_build_object('status','rejected','retry_scheduled',false); end if;
    perform pg_advisory_xact_lock(hashtextextended('stripe-invoice:'||b.stripe_account||':'||(p_request->>'invoice_id'),20920260926));
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
      if p_request->>'invoice_id' is null or (p_request->>'period_start')::timestamptz is distinct from a.paid_through
        or coalesce(p_request->>'provider_status','') not in ('active','past_due','unpaid','canceled')
        or (p_request->>'period_end')::timestamptz is null or (p_request->>'period_end')::timestamptz<=a.paid_through
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
  end if;
  select * into a from public.billing_account_access where subject_user_id=b.subject_user_id;
  -- Terminal + cleared observations are required together. Open invoices keep the
  -- binding current even after effective access ends; never create a second payer.
  update public.stripe_billing_subscription_bindings set
    terminal_confirmed_at=case when coalesce(p_request->>'provider_status','')='canceled' then v_now else terminal_confirmed_at end,
    obligations_cleared_at=case when coalesce(p_request->>'provider_status','')='canceled' and coalesce((p_request->>'obligations_cleared')::boolean,false) then v_now else obligations_cleared_at end,
    is_current=not (coalesce(p_request->>'provider_status','')='canceled' and coalesce((p_request->>'obligations_cleared')::boolean,false) and a.access_ends_at<=v_now),
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
