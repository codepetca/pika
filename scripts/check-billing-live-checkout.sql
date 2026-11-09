-- Rollback-only proof on an owned disposable replay through 316.
begin;
set local statement_timeout='30s';
set local lock_timeout='3s';
do $$
declare
  v_project text:='abcdefghijklmnopqrst'; v_account text:='acct_Live316';
  v_subject uuid:=gen_random_uuid(); v_other uuid:=gen_random_uuid(); v_trial uuid:=gen_random_uuid();
  v_id uuid:=gen_random_uuid(); v_other_id uuid:=gen_random_uuid(); v_trial_id uuid:=gen_random_uuid();
  v_version uuid; v_offering jsonb; v_request jsonb; v_claim jsonb; v_fence jsonb; v_result jsonb;
  v_plan jsonb; v_entitlement jsonb; v_revision bigint; v_rpc text; v_failed boolean;
  v_event jsonb; v_good uuid; v_wrong uuid; v_missing uuid; v_cutoff timestamptz;
begin
  foreach v_rpc in array array[
    'public.billing_reserve_live_checkout_v1(text,text,jsonb)',
    'public.billing_get_live_checkout_v1(text,text,jsonb)',
    'public.billing_list_live_checkout_work_v1(text,text,jsonb)',
    'public.billing_claim_live_checkout_v1(text,text,jsonb)',
    'public.billing_save_live_checkout_progress_v1(text,text,jsonb)',
    'public.billing_finish_live_checkout_v1(text,text,jsonb)',
    'public.billing_authorize_live_checkout_write_v1(text,text,jsonb)'
  ] loop
    if has_function_privilege('anon',v_rpc,'execute') or has_function_privilege('authenticated',v_rpc,'execute')
      or not has_function_privilege('service_role',v_rpc,'execute') then raise exception 'Unexpected ACL: %',v_rpc; end if;
  end loop;
  if has_function_privilege('service_role','private.billing_live_checkout_plan_eligible_v1(uuid,text,text)','execute')
    or has_function_privilege('service_role','private.stripe_live_checkout_attempt_v1(uuid,text)','execute') then
    raise exception 'Private checkout helpers exposed';
  end if;
  insert into public.users(id,email,role) values
    (v_subject,'live-checkout-owner@example.invalid','teacher'),
    (v_other,'live-checkout-other@example.invalid','teacher'),
    (v_trial,'live-checkout-trial@example.invalid','teacher');
  foreach v_id in array array[v_subject,v_other,v_trial] loop
    if not exists(select 1 from public.account_plans where subject_user_id=v_id) then
      perform public.set_account_plan_v1(gen_random_uuid(),v_id,'free','test:live-checkout','fixture',0);
    end if;
  end loop;
  v_id:=gen_random_uuid();
  -- A synthetic mixed database also needs the mode filter. Roll it back
  -- before pinning the actual test target below.
  begin
    declare v_mixed_offering uuid; v_mixed_version uuid; v_mixed_binding uuid;
    begin
      update private.stripe_billing_settings set sandbox_enabled=true where singleton;
      insert into public.stripe_billing_offerings(plan_key) values('plus') returning id into v_mixed_offering;
      insert into public.stripe_billing_offering_versions(offering_id,version,stripe_account,provider_mode,
        stripe_product_id,stripe_price_id,currency,unit_amount,interval,classroom_limit,features)
      values(v_mixed_offering,1,v_account,'live','prod_Mixed316','price_Mixed316','usd',1900,'month',5,'{}')
      returning id into v_mixed_version;
      insert into public.stripe_billing_subscription_bindings(subject_user_id,stripe_account,provider_mode,
        stripe_customer_id,stripe_subscription_id,offering_version_id)
      values(v_subject,v_account,'live','cus_Mixed316','sub_Mixed316',v_mixed_version) returning id into v_mixed_binding;
      v_result:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_mixed_binding,'lease_seconds',' +120 '));
      if v_result is distinct from '{"status":"not_found"}'::jsonb
        or exists(select 1 from public.stripe_billing_subscription_bindings where id=v_mixed_binding and lease_token is not null) then
        raise exception 'Legacy lease text bypassed sandbox mode filtering';
      end if;
      raise exception using errcode='P3161',message='rollback_mixed_mode_fixture';
    end;
  exception when sqlstate 'P3161' then null;
  end;
  update private.stripe_billing_settings set live_project_ref=v_project,live_stripe_account=v_account,
    classroom_new_work_cutoff_enabled=true where singleton;
  update private.stripe_billing_settings set live_payment_lifecycle_enabled=true where singleton;
  update private.stripe_billing_settings set live_trial_lifecycle_enabled=true,live_trial_admission_enabled=true where singleton;
  perform public.billing_start_live_trial_v1(v_project,v_account,
    jsonb_build_object('subject_user_id',v_trial,'operation_id',gen_random_uuid()));
  v_result:=public.billing_register_live_checkout_offering_v1(v_project,v_account,jsonb_build_object(
    'plan_key','plus','version',1,'stripe_account',v_account,'provider_mode','live',
    'stripe_product_id','prod_Live316','stripe_price_id','price_Live316','currency','usd','interval','month',
    'unit_amount',1900,'classroom_limit',5,'features',jsonb_build_object(
      'catalog_key','pika:repolight-2026-10-29:pro:usd:month','display_name','Pro',
      'release_tag','repolight-2026-10-29','repolight_analysis',true),
    'ai_definition',null,'availability',jsonb_build_object('is_available',true)));
  v_version:=(v_result->>'offering_version_id')::uuid;
  v_offering:=public.billing_get_live_checkout_offering_v1(v_project,v_account,
    jsonb_build_object('offering_version_id',v_version,'stripe_account',v_account));
  v_request:=jsonb_build_object('attempt_id',v_id,'subject_user_id',v_subject,'offering',v_offering,
    'lookup_key','pika:repolight-2026-10-29:pro:usd:month',
    'success_url','https://pika.codepet.ca/billing?checkout='||v_id||'&result=success',
    'cancel_url','https://pika.codepet.ca/billing?checkout='||v_id||'&result=cancel');
  v_failed:=false;
  begin perform public.billing_reserve_live_checkout_v1(v_project,v_account,v_request);
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'billing_live_checkout_admission_unavailable' then raise; end if; v_failed:=true;
  end;
  if not v_failed then raise exception 'Closed admission accepted reservation'; end if;
  update private.stripe_billing_settings set live_checkout_admission_enabled=true,live_checkout_writes_enabled=true where singleton;
  v_failed:=false;
  begin perform public.billing_reserve_live_checkout_v1(v_project,v_account,v_request||jsonb_build_object('success_url','https://example.invalid/'));
  exception when invalid_parameter_value then v_failed:=true; end;
  if not v_failed then raise exception 'Foreign return URL accepted'; end if;
  select to_jsonb(plan) into v_plan from public.account_plans plan where subject_user_id=v_subject;
  select to_jsonb(entitlement) into v_entitlement from public.effective_feature_entitlements entitlement
    where subject_user_id=v_subject and feature_key='classrooms.create';
  v_result:=public.billing_reserve_live_checkout_v1(v_project,v_account,v_request);
  if v_result->>'status'<>'reserved' or v_result#>>'{offering,provider_mode}'<>'live'
    or v_result->>'access_confirmed'<>'false' then raise exception 'Reservation contract differs'; end if;
  v_claim:=public.billing_claim_live_checkout_v1(v_project,v_account,jsonb_build_object('attempt_id',v_id,'lease_seconds',120));
  if v_claim->>'status'<>'claimed' then raise exception 'Checkout claim failed'; end if;
  v_fence:=jsonb_build_object('attempt_id',v_id,'lease_token',v_claim->>'lease_token','fencing_token',(v_claim->>'fencing_token')::bigint);
  if not public.billing_authorize_live_checkout_write_v1(v_project,v_account,v_fence)
    or public.billing_authorize_live_checkout_write_v1(v_project,v_account,v_fence||jsonb_build_object('lease_token',gen_random_uuid())) then
    raise exception 'Write fence differs';
  end if;
  update private.stripe_billing_settings set live_checkout_admission_enabled=false,live_checkout_writes_enabled=false where singleton;
  if public.billing_authorize_live_checkout_write_v1(v_project,v_account,v_fence) then raise exception 'Closed write gate authorized create'; end if;
  if public.billing_reserve_live_checkout_v1(v_project,v_account,v_request)->>'attempt_id'<>v_id::text then
    raise exception 'Closed admission lost idempotent reservation';
  end if;
  -- In-flight provider evidence survives a switch closing before save.
  if public.billing_save_live_checkout_progress_v1(v_project,v_account,v_fence||'{"customer_id":"cus_Live316"}')->>'status'<>'saved' then
    raise exception 'In-flight customer evidence lost';
  end if;
  update public.stripe_checkout_attempts set retry_count=2,reason_code='provider_unavailable' where id=v_id;
  perform public.billing_finish_live_checkout_v1(v_project,v_account,v_fence||'{"outcome":"paused","reason_code":"provider_writes_paused"}');
  if not exists(select 1 from public.stripe_checkout_attempts where id=v_id and retry_count=2
    and stripe_customer_id='cus_Live316' and reason_code='provider_unavailable' and lease_token is null and status='reserved') then
    raise exception 'Pause lost evidence or burned retries';
  end if;
  if public.billing_finish_live_checkout_v1(v_project,v_account,v_fence||'{"outcome":"retry"}')->>'status'<>'lost_claim' then
    raise exception 'Stale finish accepted';
  end if;
  update public.stripe_checkout_attempts set next_attempt_at=clock_timestamp()-interval '1 second' where id=v_id;
  v_claim:=public.billing_claim_live_checkout_v1(v_project,v_account,jsonb_build_object('attempt_id',v_id,'lease_seconds',120));
  v_fence:=jsonb_build_object('attempt_id',v_id,'lease_token',v_claim->>'lease_token','fencing_token',(v_claim->>'fencing_token')::bigint);
  if v_claim->>'status'<>'claimed' then raise exception 'Write pause stopped recovery claim'; end if;
  v_failed:=false;
  begin perform public.billing_save_live_checkout_progress_v1(v_project,v_account,v_fence||'{"session_id":"cs_test_Wrong316"}');
  exception when unique_violation then v_failed:=true; end;
  if not v_failed then raise exception 'Sandbox session crossed live boundary'; end if;
  perform public.billing_save_live_checkout_progress_v1(v_project,v_account,
    v_fence||'{"session_id":"cs_live_Live316","checkout_url":"https://checkout.stripe.com/c/pay/live316"}');
  perform public.billing_set_live_checkout_offering_availability_v1(v_project,v_account,
    jsonb_build_object('offering_version_id',v_version,'is_available',false));
  if public.billing_get_live_checkout_v1(v_project,v_account,jsonb_build_object('attempt_id',v_id,'subject_user_id',v_other)) is not null then
    raise exception 'Foreign owner read checkout';
  end if;
  v_event:=jsonb_build_object('stripe_account',v_account,'provider_mode','live','event_id','evt_Live316',
    'payload_hash',repeat('a',64),'event_type','invoice.paid','event_created_at',clock_timestamp(),'received_at',clock_timestamp(),
    'payload',jsonb_build_object('object_id','in_Live316','customer_id','cus_Live316','subscription_id','sub_Live316'));
  v_good:=(public.billing_record_live_event_v1(v_project,v_event)->>'event_inbox_id')::uuid;
  v_wrong:=(public.billing_record_live_event_v1(v_project,v_event||jsonb_build_object('event_id','evt_Wrong316',
    'payload',jsonb_build_object('object_id','in_Wrong316','customer_id','cus_Wrong316','subscription_id','sub_Live316')))->>'event_inbox_id')::uuid;
  v_missing:=(public.billing_record_live_event_v1(v_project,v_event||jsonb_build_object('event_id','evt_Missing316',
    'payload',jsonb_build_object('object_id','in_Missing316','customer_id',null,'subscription_id','sub_Live316')))->>'event_inbox_id')::uuid;
  if public.billing_finish_live_checkout_v1(v_project,v_account,v_fence||'{"outcome":"bound","subscription_id":"sub_Live316"}')->>'status'<>'finished' then
    raise exception 'Retired offering could not settle known session';
  end if;
  if not exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=v_subject
      and provider_mode='live' and stripe_account=v_account and stripe_subscription_id='sub_Live316')
    or not exists(select 1 from public.stripe_billing_event_inbox where id=v_good and subscription_id is not null and status='received')
    or exists(select 1 from public.stripe_billing_event_inbox where id in (v_wrong,v_missing) and subscription_id is not null)
    or public.billing_get_live_checkout_v1(v_project,v_account,jsonb_build_object('attempt_id',v_id,'subject_user_id',v_subject))->>'access_confirmed'<>'false'
    or exists(select 1 from public.billing_account_access where subject_user_id=v_subject)
    or (select to_jsonb(plan) from public.account_plans plan where subject_user_id=v_subject) is distinct from v_plan
    or (select to_jsonb(entitlement) from public.effective_feature_entitlements entitlement where subject_user_id=v_subject and feature_key='classrooms.create') is distinct from v_entitlement then
    raise exception 'Binding crossed receipt scope or changed paid access';
  end if;
  if public.billing_list_work_v1('{"limit":1}')->'items' is distinct from '[]'::jsonb then
    raise exception 'Sandbox work list returned a live binding or receipt';
  end if;
  v_failed:=false;
  begin perform public.billing_claim_checkout_v1(jsonb_build_object('attempt_id',v_id,'lease_seconds',120));
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'stripe_billing_sandbox_disabled' then raise; end if; v_failed:=true;
  end;
  if not v_failed then raise exception 'Sandbox claim entered live checkout'; end if;
  -- Trial expiry is the sole approved one-revision change during checkout.
  update private.stripe_billing_settings set live_checkout_admission_enabled=true,live_checkout_writes_enabled=true where singleton;
  perform public.billing_set_live_checkout_offering_availability_v1(v_project,v_account,
    jsonb_build_object('offering_version_id',v_version,'is_available',true));
  v_request:=v_request||jsonb_build_object('attempt_id',v_trial_id,'subject_user_id',v_trial,
    'success_url','https://pika.codepet.ca/billing?checkout='||v_trial_id||'&result=success',
    'cancel_url','https://pika.codepet.ca/billing?checkout='||v_trial_id||'&result=cancel');
  perform public.billing_reserve_live_checkout_v1(v_project,v_account,v_request);
  v_cutoff:=statement_timestamp()-interval '1 second';
  update public.billing_trials set started_at=v_cutoff-interval '720 hours',ends_at=v_cutoff where subject_user_id=v_trial;
  update public.billing_account_access set starts_at=v_cutoff-interval '720 hours',access_ends_at=v_cutoff where subject_user_id=v_trial;
  update public.effective_feature_entitlements set starts_at=v_cutoff-interval '720 hours',expires_at=v_cutoff
    where subject_user_id=v_trial and feature_key='classrooms.create';
  perform public.billing_apply_due_live_trial_access_v1(v_project,v_account,'{"limit":10}');
  v_claim:=public.billing_claim_live_checkout_v1(v_project,v_account,jsonb_build_object('attempt_id',v_trial_id,'lease_seconds',120));
  if v_claim->>'status'<>'claimed' then raise exception 'Trial expiry lost retained checkout revision'; end if;
  v_fence:=jsonb_build_object('attempt_id',v_trial_id,'lease_token',v_claim->>'lease_token','fencing_token',(v_claim->>'fencing_token')::bigint);
  update public.stripe_checkout_attempts set write_deadline=clock_timestamp()-interval '1 second' where id=v_trial_id;
  if public.billing_authorize_live_checkout_write_v1(v_project,v_account,v_fence) then raise exception 'Expired write deadline authorized create'; end if;
  -- Independent grants, including a plan-labelled revision, remain untouched.
  foreach v_rpc in array array['manual','school','plan'] loop
    select revision into v_revision from public.effective_feature_entitlements where subject_user_id=v_other and feature_key='classrooms.create';
    perform public.set_effective_feature_entitlement_v1(gen_random_uuid(),v_other,'classrooms.create',v_rpc,true,
      clock_timestamp(),null,2,'test:live-checkout','independent_grant',v_revision);
    select to_jsonb(entitlement) into v_entitlement from public.effective_feature_entitlements entitlement
      where subject_user_id=v_other and feature_key='classrooms.create';
    v_request:=v_request||jsonb_build_object('attempt_id',v_other_id,'subject_user_id',v_other,
      'success_url','https://pika.codepet.ca/billing?checkout='||v_other_id||'&result=success',
      'cancel_url','https://pika.codepet.ca/billing?checkout='||v_other_id||'&result=cancel');
    v_failed:=false;
    begin perform public.billing_reserve_live_checkout_v1(v_project,v_account,v_request);
    exception when object_not_in_prerequisite_state then
      if sqlerrm<>'checkout_account_plan_ineligible' then raise; end if; v_failed:=true;
    end;
    if not v_failed or (select to_jsonb(entitlement) from public.effective_feature_entitlements entitlement
      where subject_user_id=v_other and feature_key='classrooms.create') is distinct from v_entitlement then
      raise exception 'Independent % grant was not preserved',v_rpc;
    end if;
  end loop;
end;
$$;
rollback;
