-- Rollback-only admission contract. No provider action is issued.
begin;
set local statement_timeout='30s';
set local lock_timeout='3s';
update private.stripe_billing_settings set sandbox_enabled=true where singleton;

do $$
declare
  v_user uuid:=gen_random_uuid();
  v_other uuid:=gen_random_uuid();
  v_op uuid:=gen_random_uuid();
  v_stale uuid:=gen_random_uuid();
  v_binding uuid;
  v_max uuid;
  v_pro uuid;
  v_claim jsonb;
  v_fence jsonb;
  v_quote jsonb;
  v_result jsonb;
  v_before jsonb;
  v_term_end timestamptz:=date_trunc('second',clock_timestamp())+interval '10 days';
  v_term_start timestamptz:=v_term_end-interval '30 days';
begin
  if has_table_privilege('service_role','private.billing_scheduled_plan_changes','insert')
    or has_function_privilege('authenticated','public.billing_reserve_scheduled_plan_change_v1(uuid,uuid,uuid)','execute')
    or has_function_privilege('anon','public.billing_confirm_scheduled_plan_change_v1(uuid,uuid)','execute') then
    raise exception 'Scheduled change authority widened';
  end if;
  insert into public.users(id,email,role) values
    (v_user,'billing-schedule-305@example.invalid','teacher'),
    (v_other,'billing-schedule-305-other@example.invalid','teacher');
  if not exists(select 1 from public.account_plans where subject_user_id=v_user) then
    perform public.set_account_plan_v1(gen_random_uuid(),v_user,'free','test:schedule','fixture',0);
  end if;
  v_max:=(public.billing_register_offering_v1(jsonb_build_object('plan_key','pro','version',9305,
    'stripe_account','acct_schedule305','provider_mode','test','stripe_product_id','prod_schedule305max',
    'stripe_price_id','price_schedule305max','currency','usd','unit_amount',3900,'interval','month','classroom_limit',12,
    'features','{"catalog_key":"pika-schedule-fixture"}'::jsonb,'ai_definition',null,'availability',jsonb_build_object('is_available',true)))->>'offering_version_id')::uuid;
  v_pro:=(public.billing_register_offering_v1(jsonb_build_object('plan_key','plus','version',9305,
    'stripe_account','acct_schedule305','provider_mode','test','stripe_product_id','prod_schedule305pro',
    'stripe_price_id','price_schedule305pro','currency','usd','unit_amount',1900,'interval','month','classroom_limit',5,
    'features','{"catalog_key":"pika-schedule-fixture"}'::jsonb,'ai_definition',null,'availability',jsonb_build_object('is_available',true)))->>'offering_version_id')::uuid;
  v_binding:=(public.billing_bind_customer_v1(jsonb_build_object('subject_user_id',v_user,
    'stripe_account','acct_schedule305','provider_mode','test','stripe_price_id','price_schedule305max',
    'stripe_customer_id','cus_schedule305','stripe_subscription_id','sub_schedule305',
    'offering_version_id',v_max))->>'subscription_id')::uuid;
  v_claim:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_binding,'lease_seconds',120));
  v_result:=public.billing_finish_lifecycle_v1(jsonb_build_object('subscription_id',v_binding,'lease_token',v_claim->'lease_token',
    'fencing_token',v_claim->'fencing_token','expected_subscription_revision',v_claim->'subscription_revision',
    'expected_account_plan_revision',v_claim->'expected_account_plan_revision','outcome','paid',
    'invoice_id','in_schedule305max','period_start',v_term_start,'period_end',v_term_end,
    'provider_status','active','cancel_at_period_end',false,'obligations_cleared',false));
  if v_result->>'status' is distinct from 'applied' then raise exception 'Fixture did not grant Max'; end if;
  select to_jsonb(access) into strict v_before from public.billing_account_access access where subject_user_id=v_user;
  begin
    perform public.billing_reserve_scheduled_plan_change_v1(v_user,v_op,v_pro);
    raise exception 'Dormant gate admitted a quote';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'billing_scheduled_changes_disabled' then raise; end if;
  end;
  update private.stripe_billing_settings set scheduled_plan_changes_enabled=true where singleton;

  perform public.billing_reserve_scheduled_plan_change_v1(v_user,v_stale,v_pro);
  update public.effective_feature_entitlements set revision=revision+1 where subject_user_id=v_user and feature_key='classrooms.create';
  begin
    perform public.billing_confirm_scheduled_plan_change_v1(v_user,v_stale);
    raise exception 'Stale entitlement revision confirmed a change';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'billing_scheduled_change_quote_stale' then raise; end if;
  end;
  update public.effective_feature_entitlements set revision=revision-1 where subject_user_id=v_user and feature_key='classrooms.create';
  update private.billing_scheduled_plan_changes set quote_expires_at=clock_timestamp()-interval '1 second' where id=v_stale;

  v_quote:=public.billing_reserve_scheduled_plan_change_v1(v_user,v_op,v_pro);
  if v_quote->>'state' is distinct from 'quoted' or (v_quote->>'effective_at')::timestamptz is distinct from v_term_end
    or (v_quote->>'due_now')::integer is distinct from 0 or (v_quote->>'recurring_amount')::integer is distinct from 1900
    or (v_quote->>'classroom_limit')::integer is distinct from 5
    or v_quote->>'plan_key' is distinct from 'plus' then raise exception 'Incorrect renewal quote: %',v_quote; end if;
  if public.billing_reserve_scheduled_plan_change_v1(v_user,v_op,v_pro) is distinct from v_quote then
    raise exception 'Quote replay changed the terms';
  end if;
  if public.billing_confirm_scheduled_plan_change_v1(v_other,v_op) is not null then
    raise exception 'A foreign account recovered the quote';
  end if;
  v_result:=public.billing_confirm_scheduled_plan_change_v1(v_user,v_op);
  if v_result->>'state' is distinct from 'confirmed'
    or public.billing_confirm_scheduled_plan_change_v1(v_user,v_op) is distinct from v_result
    or (select to_jsonb(access) from public.billing_account_access access where subject_user_id=v_user) is distinct from v_before
    or (select quota_limit from public.effective_feature_entitlements where subject_user_id=v_user and feature_key='classrooms.create') is distinct from 12 then
    raise exception 'Scheduling changed the paid Max period or was not idempotent';
  end if;
  update private.stripe_billing_settings set scheduled_plan_changes_enabled=false where singleton;
  if public.billing_list_scheduled_installations_v1(1) is distinct from jsonb_build_array(v_op) then
    raise exception 'Admission stop hid confirmed installation';
  end if;
  v_claim:=public.billing_scheduled_installation_v1(v_op,'claim');
  v_fence:=v_claim->'fence';
  if v_claim#>>'{installation,stage}' is distinct from 'confirmed' or v_fence is null
    or public.billing_scheduled_installation_v1(v_op,'claim') is not null
    or public.billing_list_scheduled_installations_v1(1) is distinct from '[]'::jsonb
    or public.billing_scheduled_installation_v1(v_op,'authorize_write',v_fence) is not null then
    raise exception 'Installation lease or write-ahead checkpoint was bypassed';
  end if;
  v_claim:=public.billing_scheduled_installation_v1(v_op,'begin_attach',v_fence);
  if v_claim#>>'{installation,stage}' is distinct from 'attach_requested'
    or (v_claim#>>'{installation,replayUntil}')::timestamptz is distinct from
      (select attach_requested_at+interval '23 hours' from private.billing_scheduled_plan_changes where id=v_op)
    or public.billing_scheduled_installation_v1(v_op,'authorize_write',v_fence) is not null then
    raise exception 'Installation write-ahead window or stale fence was bypassed';
  end if;
  v_claim:=public.billing_scheduled_installation_v1(v_op,'authorize_write',v_claim->'fence');
  v_claim:=public.billing_scheduled_installation_v1(v_op,'record_attach',v_claim->'fence','sub_sched_install305');
  if v_claim#>>'{installation,stage}' is distinct from 'attached'
    or v_claim#>>'{installation,scheduleId}' is distinct from 'sub_sched_install305' then
    raise exception 'Attachment identity was not checkpointed';
  end if;
  v_claim:=public.billing_scheduled_installation_v1(v_op,'begin_configure',v_claim->'fence');
  if v_claim#>>'{installation,stage}' is distinct from 'configure_requested'
    or public.billing_scheduled_installation_v1(v_op,'installed',v_claim->'fence','sub_sched_wrong') is not null then
    raise exception 'Installation admitted a foreign schedule';
  end if;
  v_claim:=public.billing_scheduled_installation_v1(v_op,'authorize_write',v_claim->'fence');
  v_result:=public.billing_scheduled_installation_v1(v_op,'installed',v_claim->'fence','sub_sched_install305');
  if v_result is distinct from 'true'::jsonb
    or (select provider_schedule_id from private.billing_scheduled_plan_changes where id=v_op) is distinct from 'sub_sched_install305'
    or (select lease_token from public.stripe_billing_subscription_bindings where id=v_binding) is not null
    or (select to_jsonb(access) from public.billing_account_access access where subject_user_id=v_user) is distinct from v_before then
    raise exception 'Installation did not release its lease and preserve the exact Max term: %',v_result;
  end if;
end $$;
-- A provider-installed schedule at its boundary. Fixture writes the trusted
-- installed row directly so the database test never calls Stripe.
do $$
declare
  v_user uuid:=gen_random_uuid();
  v_binding uuid;
  v_operation uuid:=gen_random_uuid();
  v_max uuid;
  v_pro uuid;
  v_end timestamptz:=date_trunc('second',clock_timestamp())-interval '1 minute';
  v_start timestamptz:=v_end-interval '1 month';
  v_next_end timestamptz:=v_end+interval '1 month';
  v_claim jsonb;
  v_request jsonb;
  v_result jsonb;
begin
  select id into strict v_max from public.stripe_billing_offering_versions where stripe_price_id='price_schedule305max';
  select id into strict v_pro from public.stripe_billing_offering_versions where stripe_price_id='price_schedule305pro';
  insert into public.users(id,email,role) values(v_user,'billing-schedule-305-boundary@example.invalid','teacher');
  if not exists(select 1 from public.account_plans where subject_user_id=v_user) then
    perform public.set_account_plan_v1(gen_random_uuid(),v_user,'free','test:schedule','fixture',0);
  end if;
  v_binding:=(public.billing_bind_customer_v1(jsonb_build_object('subject_user_id',v_user,
    'stripe_account','acct_schedule305','provider_mode','test','stripe_price_id','price_schedule305max',
    'stripe_customer_id','cus_schedule305boundary','stripe_subscription_id','sub_schedule305boundary',
    'offering_version_id',v_max))->>'subscription_id')::uuid;
  v_claim:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_binding,'lease_seconds',120));
  v_request:=jsonb_build_object('subscription_id',v_binding,'lease_token',v_claim->'lease_token',
    'fencing_token',v_claim->'fencing_token','expected_subscription_revision',v_claim->'subscription_revision',
    'expected_account_plan_revision',v_claim->'expected_account_plan_revision','outcome','paid',
    'invoice_id','in_schedule305old','period_start',v_start,'period_end',v_end,
    'provider_status','active','cancel_at_period_end',false,'obligations_cleared',false);
  if public.billing_finish_lifecycle_v1(v_request)->>'status' is distinct from 'applied' then
    raise exception 'Boundary fixture did not grant Max';
  end if;
  insert into private.billing_scheduled_plan_changes(id,subject_user_id,subscription_id,source_offering_version_id,
    target_offering_version_id,paid_period_start,effective_at,quote_expires_at,last_paid_invoice_id,
    expected_plan_revision,expected_access_revision,expected_entitlement_revision,state,confirmed_at,provider_schedule_id)
    select v_operation,v_user,v_binding,v_max,v_pro,v_start,v_end,v_end-interval '15 minutes',last_paid_invoice_id,
      account_plan_revision,revision,entitlement_revision,'scheduled',v_end-interval '30 minutes','sub_sched_schedule305'
      from public.billing_account_access where subject_user_id=v_user;
  v_result:=public.billing_get_scheduled_renewal_v1(jsonb_build_object('subscription_id',v_binding));
  if v_result->>'state' is distinct from 'scheduled' or v_result->>'operation_id' is distinct from v_operation::text
    or v_result#>>'{target_binding,offering_version_id}' is distinct from v_pro::text
    or v_result->>'provider_schedule_id' is distinct from 'sub_sched_schedule305' then
    raise exception 'Current subscription did not resolve the exact installed target';
  end if;

  v_claim:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_binding,'lease_seconds',120));
  v_request:=v_request||jsonb_build_object('operation_id',v_operation,'target_offering_version_id',v_pro,
    'provider_schedule_id','sub_sched_schedule305','lease_token',v_claim->'lease_token','fencing_token',v_claim->'fencing_token',
    'expected_subscription_revision',v_claim->'subscription_revision','expected_account_plan_revision',v_claim->'expected_account_plan_revision',
    'outcome','renewal_failed','provider_status','past_due','invoice_id','in_schedule305new','period_start',v_end,'period_end',v_next_end);
  if public.billing_finish_scheduled_renewal_v1(v_request||'{"provider_schedule_id":"sub_sched_other"}'::jsonb)->>'status'
    is distinct from 'rejected' then raise exception 'Foreign provider schedule applied'; end if;
  v_result:=public.billing_finish_scheduled_renewal_v1(v_request);
  if v_result->>'status' is distinct from 'applied'
    or not exists(select 1 from public.billing_account_access where subject_user_id=v_user and offering_version_id=v_max
      and paid_through=v_end and access_ends_at=v_end+interval '168 hours' and end_reason='renewal_grace'
      and last_paid_invoice_id='in_schedule305old' and failed_renewal_invoice_id='in_schedule305new')
    or (select offering_version_id from public.stripe_billing_subscription_bindings where id=v_binding) is distinct from v_max
    or (select quota_limit from public.effective_feature_entitlements where subject_user_id=v_user and feature_key='classrooms.create') is distinct from 12
    or exists(select 1 from public.stripe_billing_invoice_effects where subscription_id=v_binding and stripe_invoice_id='in_schedule305new') then
    raise exception 'Failed target renewal did not preserve Max grace: %',v_result;
  end if;
  if public.billing_finish_scheduled_renewal_v1(v_request)->>'status' is distinct from 'lost_claim' then
    raise exception 'Stale worker could reuse the grace write lease';
  end if;

  v_claim:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_binding,'lease_seconds',120));
  v_request:=v_request||jsonb_build_object('lease_token',v_claim->'lease_token','fencing_token',v_claim->'fencing_token',
    'expected_subscription_revision',v_claim->'subscription_revision','expected_account_plan_revision',v_claim->'expected_account_plan_revision',
    'outcome','paid','provider_status','active');
  v_result:=public.billing_finish_scheduled_renewal_v1(v_request);
  if v_result->>'status' is distinct from 'applied'
    or (select offering_version_id from public.stripe_billing_subscription_bindings where id=v_binding) is distinct from v_pro
    or not exists(select 1 from public.billing_account_access where subject_user_id=v_user and offering_version_id=v_pro
      and paid_through=v_next_end and access_ends_at=v_next_end and end_reason='renewal_pending')
    or (select quota_limit from public.effective_feature_entitlements where subject_user_id=v_user and feature_key='classrooms.create') is distinct from 5
    or not exists(select 1 from public.stripe_billing_invoice_effects where subscription_id=v_binding
      and stripe_invoice_id='in_schedule305old' and offering_version_id=v_max)
    or not exists(select 1 from public.stripe_billing_invoice_effects where subscription_id=v_binding
      and stripe_invoice_id='in_schedule305new' and offering_version_id=v_pro)
    or (select state from private.billing_scheduled_plan_changes where id=v_operation) is distinct from 'applied' then
    raise exception 'Verified target payment did not atomically settle Pro: %',v_result;
  end if;
  v_result:=public.billing_get_scheduled_renewal_v1(jsonb_build_object('subscription_id',v_binding));
  if v_result->>'state' is distinct from 'applied'
    or v_result#>>'{target_binding,offering_version_id}' is distinct from v_pro::text then
    raise exception 'Applied schedule lost its observed target during the first target term';
  end if;
end $$;
rollback;
