-- Rollback-only proof on an owned disposable replay through 317 or later.
begin;
set local statement_timeout='30s';
set local lock_timeout='3s';

do $$
declare
  v_project text:='abcdefghijklmnopqrst';
  v_account text:='acct_Live317';
  v_owner uuid:=gen_random_uuid();
  v_override uuid:=gen_random_uuid();
  v_unproven uuid:=gen_random_uuid();
  v_sandbox uuid:=gen_random_uuid();
  v_subject uuid;
  v_version uuid;
  v_test_version uuid;
  v_test_offering uuid;
  v_binding uuid;
  v_override_binding uuid;
  v_unproven_binding uuid;
  v_test_binding uuid;
  v_attempt uuid;
  v_customer text;
  v_subscription text;
  v_offering jsonb;
  v_claim jsonb;
  v_reclaim jsonb;
  v_request jsonb;
  v_fence jsonb;
  v_items jsonb;
  v_receipt jsonb;
  v_event uuid;
  v_closeout uuid;
  v_paid_through timestamptz;
  v_before_plan jsonb;
  v_before_entitlement jsonb;
  v_rpc text;
begin
  foreach v_rpc in array array[
    'public.billing_list_live_work_v1(text,text,jsonb)',
    'public.billing_claim_live_subscription_v1(text,text,jsonb)'
  ] loop
    if has_function_privilege('anon',v_rpc,'execute')
      or has_function_privilege('authenticated',v_rpc,'execute')
      or not has_function_privilege('service_role',v_rpc,'execute') then
      raise exception 'Unexpected reconciliation RPC ACL: %',v_rpc;
    end if;
  end loop;
  if has_function_privilege('service_role','private.billing_live_reconciliation_binding_v1(uuid,text)','execute')
    or has_function_privilege('service_role','private.billing_live_reconciliation_blocked_v1(uuid)','execute')
    or has_function_privilege('service_role','private.billing_live_reconciliation_plan_valid_v1(uuid,text,text)','execute')
    or has_function_privilege('service_role','private.billing_live_reconciliation_due_event_v1(uuid,text,text,text,timestamptz)','execute') then
    raise exception 'Live reconciliation internals are exposed';
  end if;
  begin
    perform public.billing_list_live_work_v1(v_project,v_account,'{"limit":2}');
    raise exception 'Disabled live lifecycle listed work';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'billing_live_payment_lifecycle_unavailable' then raise; end if;
  end;

  insert into public.users(id,email,role) values
    (v_owner,'live-reconcile-owner@example.invalid','teacher'),
    (v_override,'live-reconcile-override@example.invalid','teacher'),
    (v_unproven,'live-reconcile-unproven@example.invalid','teacher'),
    (v_sandbox,'live-reconcile-sandbox@example.invalid','teacher');
  foreach v_subject in array array[v_owner,v_override,v_unproven,v_sandbox] loop
    if not exists(select 1 from public.account_plans where subject_user_id=v_subject) then
      perform public.set_account_plan_v1(gen_random_uuid(),v_subject,'free','test:live-reconcile','fixture',0);
    end if;
  end loop;
  update private.stripe_billing_settings set live_project_ref=v_project,live_stripe_account=v_account,
    classroom_new_work_cutoff_enabled=true where singleton;
  update private.stripe_billing_settings set live_payment_lifecycle_enabled=true,
    live_checkout_admission_enabled=true,live_checkout_writes_enabled=true where singleton;
  v_version:=(public.billing_register_live_checkout_offering_v1(v_project,v_account,jsonb_build_object(
    'plan_key','plus','version',1,'stripe_account',v_account,'provider_mode','live',
    'stripe_product_id','prod_Live317','stripe_price_id','price_Live317','currency','usd','interval','month',
    'unit_amount',1900,'classroom_limit',5,'features',jsonb_build_object(
      'catalog_key','pika:repolight-2026-10-29:pro:usd:month','display_name','Pro',
      'release_tag','repolight-2026-10-29','repolight_analysis',true),
    'ai_definition',null,'availability',jsonb_build_object('is_available',true)))->>'offering_version_id')::uuid;
  v_offering:=public.billing_get_live_checkout_offering_v1(v_project,v_account,
    jsonb_build_object('offering_version_id',v_version,'stripe_account',v_account));

  for v_subject,v_customer,v_subscription in select * from (values
    (v_owner,'cus_Owner317','sub_Owner317'),(v_override,'cus_Override317','sub_Override317')
  ) fixture(subject,customer,subscription)
  loop
    v_attempt:=gen_random_uuid();
    perform public.billing_reserve_live_checkout_v1(v_project,v_account,jsonb_build_object(
      'attempt_id',v_attempt,'subject_user_id',v_subject,'offering',v_offering,
      'lookup_key','pika:repolight-2026-10-29:pro:usd:month',
      'success_url','https://pika.codepet.ca/billing?checkout='||v_attempt||'&result=success',
      'cancel_url','https://pika.codepet.ca/billing?checkout='||v_attempt||'&result=cancel'));
    v_claim:=public.billing_claim_live_checkout_v1(v_project,v_account,
      jsonb_build_object('attempt_id',v_attempt,'lease_seconds',120));
    v_fence:=jsonb_build_object('attempt_id',v_attempt,'lease_token',v_claim->>'lease_token',
      'fencing_token',v_claim->'fencing_token');
    if public.billing_save_live_checkout_progress_v1(v_project,v_account,
      v_fence||jsonb_build_object('customer_id',v_customer,'session_id','cs_live_'||substring(v_customer from 5),
        'checkout_url','https://checkout.stripe.com/c/pay/live317'))->>'status' is distinct from 'saved' then
      raise exception 'Fixture live checkout progress failed';
    end if;
    if public.billing_finish_live_checkout_v1(v_project,v_account,
      v_fence||jsonb_build_object('outcome','bound','subscription_id',v_subscription))->>'status' is distinct from 'finished' then
      raise exception 'Fixture live checkout did not bind';
    end if;
  end loop;
  select id into strict v_binding from public.stripe_billing_subscription_bindings where subject_user_id=v_owner;
  select id into strict v_override_binding from public.stripe_billing_subscription_bindings where subject_user_id=v_override;
  update private.stripe_billing_settings set live_checkout_admission_enabled=false,live_checkout_writes_enabled=false where singleton;
  perform public.billing_set_live_checkout_offering_availability_v1(v_project,v_account,
    jsonb_build_object('offering_version_id',v_version,'is_available',false));

  -- An invented binding with no audited Checkout completion cannot enter live work.
  insert into public.stripe_billing_customers(subject_user_id,stripe_account,provider_mode,stripe_customer_id)
    values(v_unproven,v_account,'live','cus_Unproven317');
  insert into public.stripe_billing_subscription_bindings(subject_user_id,stripe_account,provider_mode,
    stripe_customer_id,stripe_subscription_id,offering_version_id,next_reconcile_at)
    values(v_unproven,v_account,'live','cus_Unproven317','sub_Unproven317',v_version,clock_timestamp()-interval '1 day')
    returning id into v_unproven_binding;
  insert into public.stripe_billing_offerings(plan_key) values('basic') returning id into v_test_offering;
  insert into public.stripe_billing_offering_versions(offering_id,version,stripe_account,provider_mode,stripe_product_id,
    stripe_price_id,currency,unit_amount,interval,classroom_limit,features)
    values(v_test_offering,1,'acct_Test317','test','prod_Test317','price_Test317','usd',1200,'month',2,'{}')
    returning id into v_test_version;
  insert into public.stripe_billing_subscription_bindings(subject_user_id,stripe_account,provider_mode,
    stripe_customer_id,stripe_subscription_id,offering_version_id,next_reconcile_at)
    values(v_sandbox,'acct_Test317','test','cus_Test317','sub_Test317',v_test_version,clock_timestamp()-interval '1 day')
    returning id into v_test_binding;
  v_receipt:=jsonb_build_object('stripe_account',v_account,'provider_mode','live','event_id','evt_First317',
    'payload_hash',repeat('a',64),'event_type','invoice.paid','event_created_at',clock_timestamp(),'received_at',clock_timestamp(),
    'payload',jsonb_build_object('object_id','in_First317','customer_id','cus_Owner317','subscription_id','sub_Owner317'));
  v_event:=(public.billing_record_live_event_v1(v_project,v_receipt)->>'event_inbox_id')::uuid;
  perform public.billing_record_live_event_v1(v_project,v_receipt||jsonb_build_object('event_id','evt_Second317'));
  update public.stripe_billing_event_inbox set next_attempt_at=clock_timestamp()-interval '1 hour' where id=v_event;
  -- A receipt with a mismatched identity must be ignored even if its FK points at the binding.
  insert into public.stripe_billing_event_inbox(stripe_account,provider_mode,stripe_event_id,payload_hash,event_type,
    subscription_id,stripe_customer_id,stripe_subscription_id,next_attempt_at)
    values(v_account,'live','evt_WrongCustomer317',repeat('b',64),'invoice.paid',
      v_binding,'cus_Foreign317','sub_Owner317',clock_timestamp()-interval '1 day'),
      ('acct_Test317','live','evt_WrongMode317',repeat('c',64),'invoice.paid',
      v_test_binding,'cus_Test317','sub_Test317',clock_timestamp()-interval '2 days');
  update public.stripe_billing_subscription_bindings set next_reconcile_at=clock_timestamp()-interval '1 minute'
    where id=v_override_binding;

  v_items:=public.billing_list_live_work_v1(v_project,v_account,'{"limit":2}')->'items';
  if jsonb_array_length(v_items)<>2
    or v_items#>>'{0,kind}' is distinct from 'event' or v_items#>>'{0,event_inbox_id}' is distinct from v_event::text
    or v_items#>>'{0,subscription_id}' is distinct from v_binding::text
    or v_items#>>'{0,binding,offering_version_id}' is distinct from v_version::text
    or v_items#>>'{0,binding,provider_mode}' is distinct from 'live'
    or v_items#>>'{1,kind}' is distinct from 'reconcile'
    or v_items#>>'{1,subscription_id}' is distinct from v_override_binding::text then
    raise exception 'Live list did not deduplicate exact events and due bindings before the cap: %',v_items;
  end if;
  v_items:=public.billing_list_work_v1('{"limit":10}')->'items';
  if jsonb_array_length(v_items)<>1 or v_items#>>'{0,subscription_id}' is distinct from v_test_binding::text
    or v_items#>>'{0,kind}' is distinct from 'reconcile' or v_items#>>'{0,binding,provider_mode}' is distinct from 'test' then
    raise exception 'Sandbox list included live work or a live receipt';
  end if;
  begin
    perform public.billing_list_live_work_v1(v_project,'acct_Other317','{"limit":2}');
    raise exception 'Wrong account listed live reconciliation work';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'billing_live_payment_lifecycle_unavailable' then raise; end if;
  end;
  begin
    perform public.billing_list_live_work_v1(v_project,v_account,'{"limit":101}');
    raise exception 'Unbounded live work list accepted';
  exception when invalid_parameter_value then null;
  end;

  v_request:=jsonb_build_object('subscription_id',v_binding,'lease_seconds',60);
  -- Active closeout owns recovery. Terminal history must leave provenance intact.
  v_paid_through:=clock_timestamp()-interval '8 days';
  insert into public.billing_renewal_closeouts(subscription_id,invoice_id,paid_through,cutoff,
    expected_account_plan_revision,expected_access_revision,expected_entitlement_revision)
    values(v_binding,'in_Closeout317',v_paid_through,v_paid_through+interval '168 hours',1,1,1)
    returning id into v_closeout;
  if public.billing_claim_live_subscription_v1(v_project,v_account,v_request) is distinct from '{"status":"busy"}'::jsonb
    or jsonb_array_length(public.billing_list_live_work_v1(v_project,v_account,'{"limit":2}')->'items')<>1
    or private.billing_live_reconciliation_binding_v1(v_binding,v_account) is null then
    raise exception 'Active recovery was claimed or invalidated immutable provenance';
  end if;
  update public.billing_renewal_closeouts set stage='superseded',status='superseded',completed_at=clock_timestamp()
    where id=v_closeout;

  -- A queued binding can claim a genuine due receipt ahead of its ordinary due time.
  update public.stripe_billing_subscription_bindings set next_reconcile_at=clock_timestamp()+interval '1 hour'
    where id=v_binding;
  v_claim:=public.billing_claim_live_subscription_v1(v_project,v_account,v_request);
  if v_claim->>'status' is distinct from 'claimed'
    or v_claim->>'fencing_token' is distinct from '1'
    or v_claim#>>'{binding,stripe_subscription_id}' is distinct from 'sub_Owner317'
    or v_claim#>>'{lifecycle,is_current}' is distinct from 'true'
    or v_claim#>'{lifecycle,paid_through}' is distinct from 'null'::jsonb
    or v_claim->'expected_account_plan_revision' is distinct from
      (select to_jsonb(revision) from public.account_plans where subject_user_id=v_owner)
    or not exists(select 1 from public.stripe_billing_subscription_bindings
      where id=v_binding and lease_token=(v_claim->>'lease_token')::uuid
        and revision=(v_claim->>'subscription_revision')::bigint and lease_expires_at>clock_timestamp()) then
    raise exception 'Live claim did not return exact checkout binding, revision, and lease facts';
  end if;
  if public.billing_claim_live_subscription_v1(v_project,v_account,v_request) is distinct from '{"status":"busy"}'::jsonb
    or jsonb_array_length(public.billing_list_live_work_v1(v_project,v_account,'{"limit":2}')->'items')<>1 then
    raise exception 'Live lease was not exclusive';
  end if;
  update public.stripe_billing_subscription_bindings set lease_expires_at=clock_timestamp()-interval '1 second'
    where id=v_binding;
  v_reclaim:=public.billing_claim_live_subscription_v1(v_project,v_account,v_request);
  if v_reclaim->>'status' is distinct from 'claimed' or v_reclaim->>'fencing_token' is distinct from '2'
    or v_reclaim->>'lease_token' is not distinct from v_claim->>'lease_token'
    or (v_reclaim->>'subscription_revision')::bigint<>(v_claim->>'subscription_revision')::bigint+1 then
    raise exception 'Expired live lease did not advance its fence';
  end if;
  if public.billing_claim_live_subscription_v1(v_project,v_account,v_request||jsonb_build_object('subscription_id',v_test_binding))
      is distinct from '{"status":"not_found"}'::jsonb
    or public.billing_claim_live_subscription_v1(v_project,v_account,v_request||jsonb_build_object('subscription_id',v_unproven_binding))
      is distinct from '{"status":"not_found"}'::jsonb then
    raise exception 'A sandbox or unproven binding obtained a live claim';
  end if;

  perform public.set_effective_feature_entitlement_v1(gen_random_uuid(),v_override,'classrooms.create','manual',
    true,clock_timestamp(),null,2,'test:live-reconcile','preserve_manual_grant',
    (select revision from public.effective_feature_entitlements where subject_user_id=v_override and feature_key='classrooms.create'));
  select to_jsonb(plan) into strict v_before_plan from public.account_plans plan where subject_user_id=v_override;
  select to_jsonb(entitlement) into strict v_before_entitlement from public.effective_feature_entitlements entitlement
    where subject_user_id=v_override and feature_key='classrooms.create';
  v_claim:=public.billing_claim_live_subscription_v1(v_project,v_account,v_request||jsonb_build_object('subscription_id',v_override_binding));
  if v_claim is distinct from '{"status":"busy"}'::jsonb
    or not exists(select 1 from public.stripe_billing_subscription_bindings where id=v_override_binding
      and reconcile_state='attention' and fencing_token=0 and lease_token is null)
    or not exists(select 1 from public.stripe_billing_subscription_audit where subscription_id=v_override_binding
      and outcome='exception' and reason_code='subscription_transition_unapproved')
    or (select to_jsonb(plan) from public.account_plans plan where subject_user_id=v_override) is distinct from v_before_plan
    or (select to_jsonb(entitlement) from public.effective_feature_entitlements entitlement
      where subject_user_id=v_override and feature_key='classrooms.create') is distinct from v_before_entitlement
    or exists(select 1 from public.billing_account_access where subject_user_id in (v_owner,v_override))
    or exists(select 1 from public.stripe_billing_invoice_effects where subscription_id in (v_binding,v_override_binding)) then
    raise exception 'Claim altered a manual grant, or wrote paid access without verified evidence';
  end if;
end;
$$;

rollback;
