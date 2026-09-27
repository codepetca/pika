begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $privileges$
declare v_rpc text; v_table text;
begin
  foreach v_rpc in array array['billing_get_checkout_offering_v1','billing_list_checkout_offerings_v1',
    'billing_get_checkout_v1','billing_reserve_checkout_v1','billing_list_checkout_work_v1',
    'billing_claim_checkout_v1','billing_save_checkout_progress_v1','billing_finish_checkout_v1',
    'billing_bind_customer_v1','billing_record_event_v1'] loop
    if has_function_privilege('anon','public.'||v_rpc||'(jsonb)','execute')
      or has_function_privilege('authenticated','public.'||v_rpc||'(jsonb)','execute')
      or not has_function_privilege('service_role','public.'||v_rpc||'(jsonb)','execute') then
      raise exception 'Checkout RPC privilege failure: %',v_rpc;
    end if;
  end loop;
  foreach v_table in array array['stripe_billing_customers','stripe_checkout_attempts','stripe_checkout_audit'] loop
    if has_table_privilege('anon','public.'||v_table,'select')
      or has_table_privilege('authenticated','public.'||v_table,'select')
      or has_table_privilege('service_role','public.'||v_table,'insert')
      or has_table_privilege('service_role','public.'||v_table,'update')
      or not exists(select 1 from pg_class where oid=('public.'||v_table)::regclass and relrowsecurity) then
      raise exception 'Checkout table privilege failure: %',v_table;
    end if;
  end loop;
end; $privileges$;

-- Upgrading an earlier applied 209 must repair both sides of the identity race.
-- Check the installed definitions before fixtures, including lock-before-lookup
-- ordering and the shared key/seed used by checkout finalization.
do $identity_locks$
declare v_rpc text; v_definition text; v_lock integer; v_lookup integer;
begin
  foreach v_rpc in array array['billing_bind_customer_v1','billing_record_event_v1'] loop
    if to_regprocedure('public.'||v_rpc||'(jsonb)') is null then
      raise exception 'Missing billing identity function: %',v_rpc;
    end if;
    v_definition := pg_get_functiondef(to_regprocedure('public.'||v_rpc||'(jsonb)'));
    v_lock := strpos(v_definition,'pg_advisory_xact_lock(hashtextextended(');
    v_lookup := strpos(v_definition,'select * into v_binding');
    if v_lock=0 or v_lookup=0 or v_lock>=v_lookup
      or strpos(v_definition,'''stripe-binding:''')=0
      or strpos(v_definition,'20920260926')=0
      or strpos(substring(v_definition from v_lookup),'for update;')=0 then
      raise exception 'Billing identity serialization protection missing: %',v_rpc;
    end if;
  end loop;
end; $identity_locks$;

update private.stripe_billing_settings set sandbox_enabled=false where singleton;
set local role service_role;
do $gate$
begin
  begin
    perform public.billing_list_checkout_offerings_v1('{"stripe_account":"acct_b210test"}');
    raise exception 'Disabled checkout accepted a catalog request';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'stripe_billing_sandbox_disabled' then raise; end if;
  end;
end; $gate$;
reset role;
update private.stripe_billing_settings set sandbox_enabled=true where singleton;

insert into public.users(id,email,role) values
  ('f2100000-0000-4000-8000-000000000001','checkout-210@example.invalid','teacher'),
  ('f2100000-0000-4000-8000-000000000002','checkout-other-210@example.invalid','teacher'),
  ('f2100000-0000-4000-8000-000000000003','checkout-student-210@example.invalid','student');

do $checkout$
declare
  v_user uuid := 'f2100000-0000-4000-8000-000000000001';
  v_other uuid := 'f2100000-0000-4000-8000-000000000002';
  v_student uuid := 'f2100000-0000-4000-8000-000000000003';
  v_id uuid := 'f2100000-0000-4000-8000-000000000011';
  v_other_id uuid := 'f2100000-0000-4000-8000-000000000012';
  v_catalog jsonb; v_offering jsonb; v_request jsonb; v_result jsonb; v_claim jsonb; v_old_claim jsonb;
  v_fence jsonb; v_version uuid; v_original_revision bigint; v_event jsonb;
begin
  if not exists(select 1 from public.account_plans where subject_user_id=v_user) then
    perform public.set_account_plan_v1(gen_random_uuid(),v_user,'free','test:checkout210','fixture_free',0);
  end if;
  if not exists(select 1 from public.account_plans where subject_user_id=v_other) then
    perform public.set_account_plan_v1(gen_random_uuid(),v_other,'free','test:checkout210','fixture_free',0);
  end if;
  select revision into v_original_revision from public.account_plans where subject_user_id=v_user;
  v_catalog := public.billing_register_offering_v1(jsonb_build_object('plan_key','plus','version',9210,
    'stripe_account','acct_b210test','provider_mode','test','stripe_product_id','prod_b210test',
    'stripe_price_id','price_b210test','currency','usd','unit_amount',1900,'interval','month','classroom_limit',5,
    'features',jsonb_build_object('catalog_key','pika:launch-2026-09-26:pro:usd:month'),
    'ai_definition',null,'availability',jsonb_build_object('is_available',true)));
  v_version := (v_catalog->>'offering_version_id')::uuid;
  v_offering := public.billing_get_checkout_offering_v1(jsonb_build_object('offering_version_id',v_version,'stripe_account','acct_b210test'));
  if v_offering->>'catalog_key'<>'pika:launch-2026-09-26:pro:usd:month' then raise exception 'Catalog key missing'; end if;
  if jsonb_array_length(public.billing_list_checkout_offerings_v1('{"stripe_account":"acct_b210test"}')->'items')<>1 then
    raise exception 'Catalog list incorrect';
  end if;
  v_request := jsonb_build_object('attempt_id',v_id,'subject_user_id',v_user,'offering',v_offering,
    'lookup_key',v_offering->>'catalog_key','success_url','http://localhost:3000/billing?checkout='||v_id||'&result=success',
    'cancel_url','http://localhost:3000/billing?checkout='||v_id||'&result=cancel');
  v_result := public.billing_reserve_checkout_v1(v_request);
  if v_result->>'status'<>'reserved' or (v_result->>'access_confirmed')::boolean then raise exception 'Reservation granted access'; end if;
  if (v_result->>'write_deadline')::timestamptz>(v_result->>'created_at')::timestamptz+interval '23 hours 1 second' then
    raise exception 'Unsafe provider write horizon';
  end if;
  if public.billing_reserve_checkout_v1(v_request)<>v_result then raise exception 'Reservation replay changed'; end if;
  if public.billing_get_checkout_v1(jsonb_build_object('subject_user_id',v_other,'attempt_id',v_id)) is not null then
    raise exception 'Foreign checkout visible';
  end if;
  begin
    perform public.billing_reserve_checkout_v1(v_request||jsonb_build_object('lookup_key','tampered'));
    raise exception 'Conflicting idempotency accepted';
  exception when unique_violation then
    if sqlerrm<>'checkout_operation_conflict' then raise; end if;
  end;
  begin
    perform public.billing_reserve_checkout_v1(v_request||jsonb_build_object('subject_user_id',v_other));
    raise exception 'Foreign operation collision accepted';
  exception when unique_violation then
    if sqlerrm<>'checkout_operation_conflict' then raise; end if;
  end;
  begin
    perform public.billing_reserve_checkout_v1(v_request||jsonb_build_object('attempt_id',gen_random_uuid(),'subject_user_id',v_student));
    raise exception 'Student checkout accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'checkout_request_invalid' then raise; end if;
  end;
  begin
    perform public.billing_reserve_checkout_v1(v_request||jsonb_build_object('attempt_id',gen_random_uuid()));
    raise exception 'Concurrent account checkout accepted';
  exception when unique_violation then
    if sqlerrm<>'checkout_account_already_bound_or_pending' then raise; end if;
  end;
  v_result := public.billing_save_checkout_progress_v1(jsonb_build_object('attempt_id',v_id,'fencing_token',0,'customer_id','cus_b210test'));
  if v_result->>'status'<>'lost_claim' then raise exception 'Unclaimed progress accepted'; end if;
  v_result := public.billing_finish_checkout_v1(jsonb_build_object('attempt_id',v_id,'fencing_token',0,'outcome','attention'));
  if v_result->>'status'<>'lost_claim' then raise exception 'Unclaimed finish accepted'; end if;
  v_claim := public.billing_claim_checkout_v1(jsonb_build_object('attempt_id',v_id,'lease_seconds',120));
  if v_claim->>'status'<>'claimed' then raise exception 'Claim failed'; end if;
  if public.billing_claim_checkout_v1(jsonb_build_object('attempt_id',v_id,'lease_seconds',120))->>'status'<>'busy' then
    raise exception 'Overlapping claim accepted';
  end if;
  v_old_claim := v_claim;
  update public.stripe_checkout_attempts set lease_expires_at=clock_timestamp()-interval '1 second' where id=v_id;
  v_claim := public.billing_claim_checkout_v1(jsonb_build_object('attempt_id',v_id,'lease_seconds',120));
  if (v_claim->>'fencing_token')::bigint<>(v_old_claim->>'fencing_token')::bigint+1 then raise exception 'Fence did not advance'; end if;
  v_result := public.billing_save_checkout_progress_v1(jsonb_build_object('attempt_id',v_id,
    'lease_token',v_old_claim->>'lease_token','fencing_token',v_old_claim->'fencing_token','customer_id','cus_b210test'));
  if v_result->>'status'<>'lost_claim' then raise exception 'Stale lease saved'; end if;
  v_fence := jsonb_build_object('attempt_id',v_id,'lease_token',v_claim->>'lease_token','fencing_token',v_claim->'fencing_token');
  perform public.billing_save_checkout_progress_v1(v_fence||'{"customer_id":"cus_b210test"}');
  perform public.billing_save_checkout_progress_v1(v_fence||'{"session_id":"cs_test_b210test","checkout_url":"https://checkout.stripe.com/c/pay/b210test"}');
  begin
    perform public.billing_save_checkout_progress_v1(v_fence||'{"customer_id":"cus_other"}');
    raise exception 'Customer identity changed';
  exception when unique_violation then
    if sqlerrm<>'checkout_customer_conflict' then raise; end if;
  end;
  update public.stripe_billing_offering_availability set is_available=false where offering_version_id=v_version;
  if public.billing_get_checkout_offering_v1(jsonb_build_object('offering_version_id',v_version,'stripe_account','acct_b210test')) is not null then
    raise exception 'Retired offering offered for new purchase';
  end if;
  perform public.billing_reserve_checkout_v1(v_request); -- existing reservation survives archival
  v_event := public.billing_record_event_v1(jsonb_build_object('stripe_account','acct_b210test','event_id','evt_b210test',
    'payload_hash',repeat('a',64),'event_type','checkout.session.completed','event_created_at',clock_timestamp(),
    'received_at',clock_timestamp(),'payload',jsonb_build_object('object_id','cs_test_b210test','customer_id','cus_b210test','subscription_id','sub_b210test')));
  perform public.billing_finish_checkout_v1(v_fence||'{"outcome":"bound","subscription_id":"sub_b210test"}');
  if not exists(select 1 from public.stripe_billing_event_inbox where id=(v_event->>'event_inbox_id')::uuid
    and subscription_id is not null and status='received') then raise exception 'Early webhook not adopted'; end if;
  if (public.billing_get_checkout_v1(jsonb_build_object('subject_user_id',v_user,'attempt_id',v_id))->>'access_confirmed')::boolean
    or (select revision from public.account_plans where subject_user_id=v_user)<>v_original_revision then
    raise exception 'Checkout completion granted paid access';
  end if;
  if public.billing_finish_checkout_v1(v_fence||'{"outcome":"expired"}')->>'status'<>'lost_claim' then
    raise exception 'Old completion overwrote bound checkout';
  end if;
  update public.stripe_billing_offering_availability set is_available=true where offering_version_id=v_version;
  begin
    perform public.billing_reserve_checkout_v1(v_request||jsonb_build_object('attempt_id',gen_random_uuid()));
    raise exception 'Bound account purchased again';
  exception when unique_violation then
    if sqlerrm<>'checkout_account_already_bound_or_pending' then raise; end if;
  end;
  perform public.billing_reserve_checkout_v1(v_request||jsonb_build_object('attempt_id',v_other_id,'subject_user_id',v_other));
  v_claim := public.billing_claim_checkout_v1(jsonb_build_object('attempt_id',v_other_id,'lease_seconds',120));
  perform public.billing_finish_checkout_v1(jsonb_build_object('attempt_id',v_other_id,'lease_token',v_claim->>'lease_token',
    'fencing_token',v_claim->'fencing_token','outcome','attention','reason_code','write_recovery_expired'));
  begin
    perform public.billing_reserve_checkout_v1(v_request||jsonb_build_object('attempt_id',gen_random_uuid(),'subject_user_id',v_other));
    raise exception 'Unknown provider write bypassed via new attempt';
  exception when unique_violation then
    if sqlerrm<>'checkout_account_already_bound_or_pending' then raise; end if;
  end;
  if not exists(select 1 from public.stripe_checkout_audit where attempt_id=v_other_id and reason_code='write_recovery_expired') then
    raise exception 'Recovery attention was not audited';
  end if;
end; $checkout$;

-- Migration 212: first purchase is not an implicit transition from legacy paid
-- terms, and eligibility must survive every asynchronous checkout boundary.
do $first_purchase$
declare
  v_case text; v_user uuid; v_attempt uuid; v_request jsonb; v_offering jsonb;
  v_claim jsonb; v_paid_claim jsonb; v_fence jsonb; v_result jsonb; v_revision bigint; v_binding uuid;
  v_customer text; v_session text; v_subscription text;
begin
  foreach v_case in array array['basic','plus','pro','billing_free','replay','resume','save','finalize','post_bind','after_paid_claim'] loop
    v_user := gen_random_uuid(); v_attempt := gen_random_uuid();
    v_customer := 'cus_'||replace(v_user::text,'-','');
    v_session := 'cs_test_'||replace(v_user::text,'-','');
    v_subscription := 'sub_'||replace(v_user::text,'-','');
    insert into public.users(id,email,role) values(v_user,v_user::text||'@example.invalid','teacher');
    if not exists(select 1 from public.account_plans where subject_user_id=v_user) then
      perform public.set_account_plan_v1(gen_random_uuid(),v_user,'free','test:checkout212','fixture_free',0);
    end if;
    select revision into v_revision from public.account_plans where subject_user_id=v_user;
    if v_case in ('basic','plus','pro') then
      perform public.set_account_plan_v1(gen_random_uuid(),v_user,v_case,'test:checkout212','fixture_paid',v_revision);
    elsif v_case='billing_free' then
      update public.account_plans set management_source='billing' where subject_user_id=v_user;
    end if;
    v_offering := public.billing_get_checkout_offering_v1(jsonb_build_object('stripe_account','acct_b210test',
      'offering_version_id',(select id from public.stripe_billing_offering_versions where stripe_account='acct_b210test' and stripe_price_id='price_b210test')));
    v_request := jsonb_build_object('attempt_id',v_attempt,'subject_user_id',v_user,'offering',v_offering,
      'lookup_key',v_offering->>'catalog_key','success_url','http://localhost:3000/billing?checkout='||v_attempt||'&result=success',
      'cancel_url','http://localhost:3000/billing?checkout='||v_attempt||'&result=cancel');
    if v_case in ('basic','plus','pro','billing_free') then
      begin
        perform public.billing_reserve_checkout_v1(v_request);
        raise exception 'Ineligible initial purchase accepted: %',v_case;
      exception when object_not_in_prerequisite_state then
        if sqlerrm<>'checkout_account_plan_ineligible' then raise; end if;
      end;
      if exists(select 1 from public.stripe_checkout_attempts where subject_user_id=v_user)
        or exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=v_user) then
        raise exception 'Rejected account acquired purchase state: %',v_case;
      end if;
      continue;
    end if;
    v_result := public.billing_reserve_checkout_v1(v_request);
    if v_result->>'status'<>'reserved' or not exists(select 1 from public.stripe_checkout_attempts
      where id=v_attempt and reserved_plan_revision=v_revision) then raise exception 'Free eligibility not preserved'; end if;
    if public.billing_reserve_checkout_v1(v_request)<>v_result then raise exception 'Eligible operation replay changed'; end if;
    if v_case in ('save','finalize','post_bind','after_paid_claim') then
      v_claim := public.billing_claim_checkout_v1(jsonb_build_object('attempt_id',v_attempt,'lease_seconds',120));
      v_fence := jsonb_build_object('attempt_id',v_attempt,'lease_token',v_claim->>'lease_token','fencing_token',v_claim->'fencing_token');
    end if;
    if v_case in ('finalize','post_bind','after_paid_claim') then
      perform public.billing_save_checkout_progress_v1(v_fence||jsonb_build_object('customer_id',v_customer));
      perform public.billing_save_checkout_progress_v1(v_fence||jsonb_build_object('session_id',v_session,'checkout_url','https://checkout.stripe.com/c/pay/fixture'));
    end if;
    if v_case in ('post_bind','after_paid_claim') then
      perform public.billing_finish_checkout_v1(v_fence||jsonb_build_object('outcome','bound','subscription_id',v_subscription));
      select subscription_id into v_binding from public.stripe_checkout_attempts where id=v_attempt;
      if v_binding is null then raise exception 'Eligible Free purchase failed to bind'; end if;
    end if;
    if v_case='after_paid_claim' then
      v_paid_claim := public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_binding,'lease_seconds',120));
      if v_paid_claim->>'status'<>'claimed' then raise exception 'Eligible first payment claim rejected'; end if;
    end if;
    perform public.set_account_plan_v1(gen_random_uuid(),v_user,'basic','test:checkout212','plan_changed',v_revision);
    if v_case='replay' then
      if public.billing_reserve_checkout_v1(v_request)->>'status'<>'attention' then raise exception 'Ineligible replay accepted'; end if;
    elsif v_case='resume' then
      if public.billing_claim_checkout_v1(jsonb_build_object('attempt_id',v_attempt,'lease_seconds',120))->>'status'<>'terminal' then
        raise exception 'Changed plan received provider work lease';
      end if;
    elsif v_case='save' then
      if public.billing_save_checkout_progress_v1(v_fence||jsonb_build_object('customer_id',v_customer))->>'status'<>'lost_claim' then
        raise exception 'Changed plan continued to checkout session creation';
      end if;
      if not exists(select 1 from public.stripe_checkout_attempts where id=v_attempt and stripe_customer_id=v_customer) then
        raise exception 'Provider recovery identity was lost';
      end if;
    elsif v_case='finalize' then
      perform public.billing_finish_checkout_v1(v_fence||jsonb_build_object('outcome','bound','subscription_id',v_subscription));
    elsif v_case in ('post_bind','after_paid_claim') then
      if v_case='after_paid_claim' then
        v_result := public.billing_finish_subscription_v1(jsonb_build_object('subscription_id',v_binding,
          'lease_token',v_paid_claim->>'lease_token','fencing_token',v_paid_claim->'fencing_token',
          'expected_subscription_revision',v_paid_claim->'subscription_revision',
          'expected_account_plan_revision',v_paid_claim->'expected_account_plan_revision',
          'outcome','paid','event_inbox_id',null,'invoice_id','in_'||replace(v_user::text,'-',''),
          'period_start',clock_timestamp(),'period_end',clock_timestamp()+interval '1 month','reason_code',null));
        if v_result->>'status'<>'plan_conflict' then raise exception 'Concurrent plan change accepted by paid finish'; end if;
        update public.stripe_billing_subscription_bindings set lease_expires_at=clock_timestamp()-interval '1 second' where id=v_binding;
      end if;
      v_result := public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_binding,'lease_seconds',120));
      if v_result->>'status'<>'busy'
        or not exists(select 1 from public.stripe_billing_subscription_bindings where id=v_binding and reconcile_state='attention') then
        raise exception 'Changed plan received first-payment lease';
      end if;
    end if;
    if v_case not in ('post_bind','after_paid_claim') and (not exists(select 1 from public.stripe_checkout_attempts
      where id=v_attempt and status='attention' and reason_code='checkout_account_plan_ineligible')
      or exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=v_user)) then
      raise exception 'Ineligible checkout not stopped before binding: %',v_case;
    end if;
    if not exists(select 1 from public.account_plans where subject_user_id=v_user and plan_key='basic'
      and management_source='legacy' and revision=v_revision+1)
      or not exists(select 1 from public.effective_feature_entitlements where subject_user_id=v_user
        and feature_key='classrooms.create' and quota_limit=2)
      or exists(select 1 from public.stripe_billing_invoice_effects e join public.stripe_billing_subscription_bindings b
        on b.id=e.subscription_id where b.subject_user_id=v_user) then
      raise exception 'Changed legacy plan/access was overwritten: %',v_case;
    end if;
  end loop;
end; $first_purchase$;

rollback;
