-- Rollback-only contract for migration 302. Run on an isolated test database.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
update private.stripe_billing_settings set sandbox_enabled=true where singleton;

do $$
declare v_user uuid; v_binding uuid; v_offering jsonb; v_claim jsonb; v_request jsonb; v_result jsonb;
  v_prior_access jsonb; v_prior_grant jsonb; v_prior_plan jsonb; v_work jsonb; v_event uuid;
  v_paid_through timestamptz; v_next_end timestamptz; v_now timestamptz; v_case integer;
  v_previous_invoice text; v_pending_invoice text; v_customer text; v_subscription text;
begin
  v_offering:=public.billing_register_offering_v1(jsonb_build_object('plan_key','plus','version',9302,
    'stripe_account','acct_pending302','provider_mode','test','stripe_product_id','prod_pending302',
    'stripe_price_id','price_pending302','currency','usd','unit_amount',1900,'interval','month','classroom_limit',5,
    'features','{}'::jsonb,'ai_definition',null,'availability',jsonb_build_object('is_available',true)));

  -- An original invoice.created, no webhook at all, and a missed retry deadline.
  foreach v_case in array array[1,2,3] loop
    v_user:=gen_random_uuid();
    v_event:=null;
    v_now:=clock_timestamp();
    v_paid_through:=v_now-case when v_case=3 then interval '74 hours' else interval '1 minute' end;
    v_next_end:=v_paid_through+interval '1 month';
    v_previous_invoice:='in_pending302previous'||v_case;
    v_pending_invoice:='in_pending302next'||v_case;
    v_customer:='cus_pending302'||v_case;
    v_subscription:='sub_pending302'||v_case;
    insert into public.users(id,email,role) values(v_user,'billing-pending302-'||v_case||'@example.invalid','teacher');
    if not exists(select 1 from public.account_plans where subject_user_id=v_user) then
      perform public.set_account_plan_v1(gen_random_uuid(),v_user,'free','test:lifecycle','fixture',0);
    end if;
    v_binding:=(public.billing_bind_customer_v1(jsonb_build_object('subject_user_id',v_user,
      'stripe_account','acct_pending302','provider_mode','test','stripe_price_id','price_pending302',
      'stripe_customer_id',v_customer,'stripe_subscription_id',v_subscription,
      'offering_version_id',v_offering->>'offering_version_id'))->>'subscription_id')::uuid;
    v_claim:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_binding,'lease_seconds',120));
    v_request:=jsonb_build_object('subscription_id',v_binding,'lease_token',v_claim->>'lease_token',
      'fencing_token',v_claim->'fencing_token','expected_subscription_revision',v_claim->'subscription_revision',
      'expected_account_plan_revision',v_claim->'expected_account_plan_revision','outcome','paid',
      'invoice_id',v_previous_invoice,'period_start',v_paid_through-interval '1 month','period_end',v_paid_through,
      'provider_status','active','cancel_at_period_end',false,'obligations_cleared',false);
    if public.billing_finish_lifecycle_v1(v_request)->>'status'<>'applied' then raise exception 'Failed to seed verified paid term'; end if;
    select to_jsonb(a) into v_prior_access from public.billing_account_access a where subject_user_id=v_user;
    select to_jsonb(p) into v_prior_plan from public.account_plans p where subject_user_id=v_user;
    select to_jsonb(e) into v_prior_grant from public.effective_feature_entitlements e
      where subject_user_id=v_user and feature_key='classrooms.create';

    if v_case=1 then
      v_event:=(public.billing_record_event_v1(jsonb_build_object('stripe_account','acct_pending302',
        'event_id','evt_pending302created','payload_hash',repeat('a',64),'event_type','invoice.created',
        'event_created_at',v_now,'received_at',v_now,'payload',jsonb_build_object('customer_id',v_customer,
          'subscription_id',v_subscription,'object_id',v_pending_invoice)))->>'event_inbox_id')::uuid;
    end if;
    v_claim:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_binding,'lease_seconds',120));
    v_request:=v_request||jsonb_build_object('lease_token',v_claim->>'lease_token','fencing_token',v_claim->'fencing_token',
      'expected_subscription_revision',v_claim->'subscription_revision','expected_account_plan_revision',v_claim->'expected_account_plan_revision',
      'outcome','renewal_invoice_pending','invoice_id',v_pending_invoice,'period_start',v_paid_through,'period_end',v_next_end,'event_inbox_id',v_event);
    v_result:=public.billing_finish_lifecycle_v1(v_request);
    if v_result is distinct from (case when v_case=3 then '{"status":"attention","retry_scheduled":false}'::jsonb
      else '{"status":"deferred","retry_scheduled":true}'::jsonb end) then
      raise exception 'Pending renewal did not finish as expected: %',v_result;
    end if;
    if (select to_jsonb(a) from public.billing_account_access a where subject_user_id=v_user) is distinct from v_prior_access
      or (select to_jsonb(p) from public.account_plans p where subject_user_id=v_user) is distinct from v_prior_plan
      or (select to_jsonb(e) from public.effective_feature_entitlements e where subject_user_id=v_user and feature_key='classrooms.create') is distinct from v_prior_grant
      or exists(select 1 from public.stripe_billing_invoice_effects where subscription_id=v_binding and stripe_invoice_id=v_pending_invoice)
      or public.billing_get_access_status_v1(jsonb_build_object('subject_user_id',v_user))->>'can_start_paid_work' is distinct from 'false' then
      raise exception 'Pending renewal changed prior access, granted work, or created an invoice effect';
    end if;
    if not exists(select 1 from public.stripe_billing_subscription_bindings where id=v_binding and lease_token is null
      and last_exception_code='renewal_invoice_pending' and reconcile_attempt_count=0
      and (case when v_case=3 then reconcile_state='attention' and reconcile_attention_at is not null and next_reconcile_at is null
        else reconcile_state='retry' and next_reconcile_at>v_now and next_reconcile_at<=v_paid_through+interval '73 hours' end)) then
      raise exception 'Pending renewal did not preserve a bounded durable retry or attention state';
    end if;
    if v_case=3 then continue; end if;
    if v_event is not null and not exists(select 1 from public.stripe_billing_event_inbox event
      join public.stripe_billing_subscription_bindings b on b.id=event.subscription_id
      where event.id=v_event and event.status='exception' and event.exception_code='renewal_invoice_pending'
        and event.next_attempt_at=b.next_reconcile_at and event.attempt_count=0) then
      raise exception 'Original event lost the durable retry';
    end if;

    -- Make only these transaction-local retries due. No paid event is recorded.
    update public.stripe_billing_subscription_bindings set next_reconcile_at=v_now where id=v_binding;
    update public.stripe_billing_event_inbox set next_attempt_at=v_now where id=v_event;
    v_work:=public.billing_list_work_v1('{"limit":50}');
    if not exists(select 1 from jsonb_array_elements(v_work->'items') item
      where item->>'subscription_id'=v_binding::text and item->>'event_inbox_id' is not distinct from v_event::text
        and item->>'kind'=case when v_event is null then 'reconcile' else 'event' end) then
      raise exception 'Due renewal disappeared without a paid webhook';
    end if;
    v_claim:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_binding,'lease_seconds',120));
    v_request:=v_request||jsonb_build_object('lease_token',v_claim->>'lease_token','fencing_token',v_claim->'fencing_token',
      'expected_subscription_revision',v_claim->'subscription_revision','expected_account_plan_revision',v_claim->'expected_account_plan_revision',
      'outcome','paid');
    v_result:=public.billing_finish_lifecycle_v1(v_request);
    if v_result->>'status'<>'applied'
      or not exists(select 1 from public.billing_account_access where subject_user_id=v_user
        and paid_through=v_next_end and last_paid_invoice_id=v_pending_invoice)
      or not exists(select 1 from public.stripe_billing_invoice_effects where subscription_id=v_binding and stripe_invoice_id=v_pending_invoice)
      or public.billing_get_access_status_v1(jsonb_build_object('subject_user_id',v_user))->>'can_start_paid_work' is distinct from 'true' then
      raise exception 'Verified renewal did not extend paid access';
    end if;
    if v_event is not null and not exists(select 1 from public.stripe_billing_event_inbox
      where id=v_event and status='completed' and next_attempt_at is null) then
      raise exception 'Verified renewal did not complete the original receipt';
    end if;
  end loop;
end $$;
rollback;
