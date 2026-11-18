-- Rollback-only SQL proof on an owned disposable replay through 318.
-- Provider money/term normalization is separately tested by synchronize.
begin;
set local statement_timeout='30s';
set local lock_timeout='3s';
create function pg_temp.finish_live_318(p_subscription uuid,p_observation jsonb)
returns jsonb language plpgsql as $$
declare claim jsonb; request jsonb; result jsonb;
begin
  update public.stripe_billing_subscription_bindings set next_reconcile_at=clock_timestamp()-interval '1 second'
    where id=p_subscription;
  claim:=public.billing_claim_live_subscription_v1('abcdefghijklmnopqrst','acct_Live318',
    jsonb_build_object('subscription_id',p_subscription,'lease_seconds',120));
  if claim->>'status'<>'claimed' then raise exception 'Fixture could not claim: %',claim->>'status'; end if;
  request:=jsonb_build_object('subscription_id',p_subscription,'lease_token',claim->>'lease_token',
    'fencing_token',(claim->>'fencing_token')::bigint,'expected_subscription_revision',(claim->>'subscription_revision')::bigint,
    'expected_account_plan_revision',(claim->>'expected_account_plan_revision')::bigint,
    'event_inbox_id',null,'invoice_id',null,'period_start',null,'period_end',null,'reason_code',null,
    'provider_status','active','cancel_at_period_end',false,'obligations_cleared',false)||p_observation;
  result:=public.billing_finish_live_lifecycle_v1('abcdefghijklmnopqrst','acct_Live318',request);
  return jsonb_build_object('result',result,'request',request);
end;
$$;
do $$
declare
  project text:='abcdefghijklmnopqrst'; account text:='acct_Live318';
  owner_id uuid:=gen_random_uuid(); trial_owner uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid();
  attempt_id uuid; version_id uuid; max_version_id uuid; binding_id uuid; trial_binding uuid; subject_id uuid;
  offering jsonb; pro_offering jsonb; max_offering jsonb; request jsonb; claim jsonb; fence jsonb; result jsonb; paid jsonb; replay jsonb;
  snapshot jsonb; plan_revision bigint; old_end timestamptz; period_start timestamptz;
  event_id uuid; failed boolean; i integer; label text;
  live_access_ready boolean:=to_regprocedure('public.billing_apply_due_live_paid_access_v1(text,text,jsonb)') is not null;
begin
  if has_function_privilege('anon','public.billing_finish_live_lifecycle_v1(text,text,jsonb)','execute')
    or has_function_privilege('authenticated','public.billing_finish_live_lifecycle_v1(text,text,jsonb)','execute')
    or not has_function_privilege('service_role','public.billing_finish_live_lifecycle_v1(text,text,jsonb)','execute') then
    raise exception 'Live lifecycle ACL differs';
  end if;
  insert into public.users(id,email,role) values(owner_id,'paid-live-318@example.invalid','teacher'),
    (trial_owner,'trial-paid-live-318@example.invalid','teacher'),(other_id,'other-paid-live-318@example.invalid','teacher');
  foreach subject_id in array array[owner_id,trial_owner,other_id] loop
    if not exists(select 1 from public.account_plans where subject_user_id=subject_id) then
      perform public.set_account_plan_v1(gen_random_uuid(),subject_id,'free','test:live-paid','fixture',0);
    end if;
  end loop;
  update private.stripe_billing_settings set live_project_ref=project,live_stripe_account=account,
    classroom_new_work_cutoff_enabled=true where singleton;
  update private.stripe_billing_settings set live_payment_lifecycle_enabled=true,
    live_checkout_admission_enabled=true,live_checkout_writes_enabled=true where singleton;
  update private.stripe_billing_settings set live_trial_lifecycle_enabled=true,live_trial_admission_enabled=true where singleton;
  if to_regprocedure('public.billing_live_checkout_activation_ready_v1(text,text)') is not null then
    execute 'update private.stripe_billing_settings set live_closeout_enabled=true where singleton';
  end if;
  perform public.billing_start_live_trial_v1(project,account,jsonb_build_object('subject_user_id',trial_owner,'operation_id',gen_random_uuid()));
  result:=public.billing_register_live_checkout_offering_v1(project,account,jsonb_build_object(
    'plan_key','plus','version',1,'stripe_account',account,'provider_mode','live',
    'stripe_product_id','prod_Live318','stripe_price_id','price_Live318','currency','usd','interval','month',
    'unit_amount',1900,'classroom_limit',5,'features',jsonb_build_object(
      'catalog_key','pika:repolight-2026-10-29:pro:usd:month','display_name','Pro','release_tag','repolight-2026-10-29','repolight_analysis',true),
    'ai_definition',null,'availability',jsonb_build_object('is_available',true)));
  version_id:=(result->>'offering_version_id')::uuid;
  pro_offering:=public.billing_get_live_checkout_offering_v1(project,account,jsonb_build_object('offering_version_id',version_id,'stripe_account',account));
  result:=public.billing_register_live_checkout_offering_v1(project,account,jsonb_build_object(
    'plan_key','pro','version',1,'stripe_account',account,'provider_mode','live',
    'stripe_product_id','prod_Max318','stripe_price_id','price_Max318','currency','usd','interval','month',
    'unit_amount',3900,'classroom_limit',12,'features',jsonb_build_object(
      'catalog_key','pika:repolight-2026-10-29:max:usd:month','display_name','Max','release_tag','repolight-2026-10-29','repolight_analysis',true),
    'ai_definition',null,'availability',jsonb_build_object('is_available',true)));
  max_version_id:=(result->>'offering_version_id')::uuid;
  max_offering:=public.billing_get_live_checkout_offering_v1(project,account,jsonb_build_object('offering_version_id',max_version_id,'stripe_account',account));
  foreach subject_id in array array[owner_id,trial_owner] loop
    offering:=case when subject_id=owner_id then pro_offering else max_offering end;
    attempt_id:=gen_random_uuid(); label:=case when subject_id=owner_id then 'Owner318' else 'Trial318' end;
    request:=jsonb_build_object('attempt_id',attempt_id,'subject_user_id',subject_id,'offering',offering,
      'lookup_key',offering->>'catalog_key','success_url','https://pika.codepet.ca/billing?checkout='||attempt_id||'&result=success',
      'cancel_url','https://pika.codepet.ca/billing?checkout='||attempt_id||'&result=cancel');
    perform public.billing_reserve_live_checkout_v1(project,account,request);
    claim:=public.billing_claim_live_checkout_v1(project,account,jsonb_build_object('attempt_id',attempt_id,'lease_seconds',120));
    fence:=jsonb_build_object('attempt_id',attempt_id,'lease_token',claim->>'lease_token','fencing_token',(claim->>'fencing_token')::bigint);
    perform public.billing_save_live_checkout_progress_v1(project,account,fence||jsonb_build_object(
      'customer_id','cus_'||label,'session_id','cs_live_'||label,'checkout_url','https://checkout.stripe.com/c/pay/'||label));
    perform public.billing_finish_live_checkout_v1(project,account,fence||jsonb_build_object('outcome','bound','subscription_id','sub_'||label));
  end loop;
  select id into binding_id from public.stripe_billing_subscription_bindings where subject_user_id=owner_id;
  select id into trial_binding from public.stripe_billing_subscription_bindings where subject_user_id=trial_owner;
  if to_regprocedure('public.billing_live_checkout_activation_ready_v1(text,text)') is not null then
    execute 'update private.stripe_billing_settings set live_closeout_enabled=false where singleton';
  end if;
  -- Closing checkout gates does not disable reconciliation of an existing payer.
  update private.stripe_billing_settings set live_checkout_admission_enabled=false,live_checkout_writes_enabled=false where singleton;
  old_end:=clock_timestamp()+interval '29 days'; period_start:=old_end-interval '30 days';
  paid:=jsonb_build_object('outcome','paid','invoice_id','in_Owner318','period_start',period_start,'period_end',old_end);
  result:=pg_temp.finish_live_318(binding_id,paid);
  if result#>>'{result,status}'<>'applied'
    or not exists(select 1 from public.billing_account_access where subject_user_id=owner_id
      and source='paid' and subscription_id=binding_id and paid_through=old_end and access_ends_at=old_end and end_reason='renewal_pending')
    or not exists(select 1 from public.account_plans where subject_user_id=owner_id and management_source='billing' and plan_key='plus')
    or (select count(*) from public.stripe_billing_invoice_effects where subscription_id=binding_id)<>1 then
    raise exception 'Verified first paid effect differs';
  end if;
  select revision into plan_revision from public.account_plans where subject_user_id=owner_id;
  if public.billing_finish_live_lifecycle_v1(project,account,result->'request')->>'status'<>'lost_claim' then
    raise exception 'Consumed lease could finish twice';
  end if;
  replay:=pg_temp.finish_live_318(binding_id,paid);
  if replay#>>'{result,status}'<>'replayed' or (select revision from public.account_plans where subject_user_id=owner_id)<>plan_revision
    or (select count(*) from public.stripe_billing_invoice_effects where subscription_id=binding_id)<>1 then
    raise exception 'Paid replay changed entitlement or duplicated receipt';
  end if;
  if live_access_ready then
    update private.repolight_settings set plan_enforcement_enabled=true,billing_access_enabled=true where singleton;
    if public.get_repolight_analysis_access_v1(owner_id)->'allowed' is distinct from 'true'::jsonb
      or not (public.billing_get_live_access_status_v1(project,account,
        jsonb_build_object('subject_user_id',owner_id,'include_options',true)) @> '{"state":"paid","plan_key":"plus","classroom_limit":5}') then
      raise exception 'Verified live Pro access is unavailable';
    end if;
    begin
      -- Pay a separate Max term ending in a few seconds. Roll this scenario
      -- back before the historical failed-renewal fixture below.
      declare cutoff timestamptz:=clock_timestamp()+interval '3 seconds';
      begin
        result:=pg_temp.finish_live_318(trial_binding,jsonb_build_object('outcome','paid','invoice_id','in_MaxCutoff319',
          'period_start',cutoff-interval '30 days','period_end',cutoff,'cancel_at_period_end',true));
        if result#>>'{result,status}'<>'applied'
          or public.get_repolight_analysis_access_v1(trial_owner)->'allowed' is distinct from 'true'::jsonb
          or not (public.billing_get_live_access_status_v1(project,account,
            jsonb_build_object('subject_user_id',trial_owner)) @> '{"state":"paid","plan_key":"pro","classroom_limit":12}') then
          raise exception 'Verified live Max access is unavailable';
        end if;
        perform pg_sleep(greatest(0,extract(epoch from cutoff-clock_timestamp()))+0.05);
        if public.get_repolight_analysis_access_v1(trial_owner)->'allowed' is distinct from 'false'::jsonb
          or public.billing_get_live_access_status_v1(project,account,jsonb_build_object('subject_user_id',trial_owner))->>'state'<>'free'
          or not exists(select 1 from public.account_plans where subject_user_id=trial_owner and plan_key='pro') then
          raise exception 'Live paid cutoff must deny new work before expiry materialization';
        end if;
        perform pg_temp.finish_live_318(trial_binding,jsonb_build_object('outcome','canceled','provider_status','canceled','obligations_cleared',true));
        if exists(select 1 from public.stripe_billing_subscription_bindings where id=trial_binding and is_current) then
          raise exception 'Expired Max term retained its current billing binding';
        end if;
        result:=public.billing_apply_due_live_paid_access_v1(project,account,'{"limit":25}');
        if result->'processed' is distinct from '1'::jsonb
          or not exists(select 1 from public.account_plans where subject_user_id=trial_owner and plan_key='free') then
          raise exception 'Retired live binding expiry did not materialize exactly once';
        end if;
        if public.billing_apply_due_live_paid_access_v1(project,account,'{"limit":25}')->'processed' is distinct from '0'::jsonb then
          raise exception 'Paid expiry replay changed the retired term';
        end if;
        raise exception using errcode='P3191',message='rollback_max_cutoff_scenario';
      end;
    exception when sqlstate 'P3191' then null;
    end;
  end if;
  -- Customer cancellation and undo retain the already-purchased term.
  perform pg_temp.finish_live_318(binding_id,jsonb_build_object('outcome','canceled','cancel_at_period_end',true));
  if not exists(select 1 from public.billing_account_access where subject_user_id=owner_id and end_reason='cancellation' and access_ends_at=old_end) then
    raise exception 'Cancellation changed paid term';
  end if;
  perform pg_temp.finish_live_318(binding_id,paid);
  if not exists(select 1 from public.billing_account_access where subject_user_id=owner_id and end_reason='renewal_pending' and access_ends_at=old_end) then
    raise exception 'Verified undo did not resume paid term';
  end if;
  select to_jsonb(access) into snapshot from public.billing_account_access access where subject_user_id=owner_id;
  result:=pg_temp.finish_live_318(binding_id,jsonb_build_object('outcome','renewal_invoice_pending','invoice_id','in_Renewal318',
    'period_start',old_end,'period_end',old_end+interval '30 days'));
  if result#>>'{result,status}'<>'deferred' or (select to_jsonb(access) from public.billing_account_access access where subject_user_id=owner_id) is distinct from snapshot
    or (select reconcile_attempt_count from public.stripe_billing_subscription_bindings where id=binding_id)<>0 then
    raise exception 'Pending renewal burned retries or changed access';
  end if;
  perform pg_temp.finish_live_318(binding_id,jsonb_build_object('outcome','renewal_failed','invoice_id','in_Renewal318',
    'period_start',old_end,'period_end',old_end+interval '30 days','provider_status','past_due'));
  if not exists(select 1 from public.billing_account_access where subject_user_id=owner_id
    and access_ends_at=old_end+interval '168 hours' and end_reason='renewal_grace' and failed_renewal_invoice_id='in_Renewal318') then
    raise exception 'Failed renewal did not preserve exact grace';
  end if;
  perform pg_temp.finish_live_318(binding_id,paid);
  if not exists(select 1 from public.billing_account_access where subject_user_id=owner_id
    and access_ends_at=old_end+interval '168 hours' and end_reason='renewal_grace' and failed_renewal_invoice_id='in_Renewal318') then
    raise exception 'Old paid receipt cleared grace';
  end if;
  -- Recovery uses a different exact invoice and clears failure facts once.
  result:=pg_temp.finish_live_318(binding_id,jsonb_build_object('outcome','paid','invoice_id','in_Renewal318',
    'period_start',old_end,'period_end',old_end+interval '30 days'));
  if result#>>'{result,status}'<>'applied' or not exists(select 1 from public.billing_account_access where subject_user_id=owner_id
    and last_paid_invoice_id='in_Renewal318' and paid_through=old_end+interval '30 days'
    and access_ends_at=paid_through and end_reason='renewal_pending' and failed_renewal_invoice_id is null) then
    raise exception 'Verified recovery did not replace grace';
  end if;
  -- Trial conversion with a historically paid term proves elapsed grace replay.
  old_end:=clock_timestamp()-interval '169 hours'; period_start:=old_end-interval '30 days';
  paid:=jsonb_build_object('outcome','paid','invoice_id','in_Trial318','period_start',period_start,'period_end',old_end);
  perform pg_temp.finish_live_318(trial_binding,paid);
  if not exists(select 1 from public.billing_trials where subject_user_id=trial_owner and converted_to_paid_at is not null) then
    raise exception 'Paid trial conversion was not recorded';
  end if;
  perform pg_temp.finish_live_318(trial_binding,jsonb_build_object('outcome','renewal_failed','invoice_id','in_TrialFailed318',
    'period_start',old_end,'period_end',old_end+interval '30 days','provider_status','past_due'));
  select revision into plan_revision from public.account_plans where subject_user_id=trial_owner;
  if not exists(select 1 from public.account_plans where subject_user_id=trial_owner and plan_key='free')
    or not exists(select 1 from public.billing_account_access where subject_user_id=trial_owner
      and access_ends_at=old_end+interval '168 hours' and expiry_applied_at is not null) then
    raise exception 'Elapsed grace did not apply expiry';
  end if;
  perform pg_temp.finish_live_318(trial_binding,paid);
  if (select revision from public.account_plans where subject_user_id=trial_owner)<>plan_revision
    or not exists(select 1 from public.billing_account_access where subject_user_id=trial_owner
      and end_reason='renewal_grace' and access_ends_at=old_end+interval '168 hours'
      and failed_renewal_invoice_id='in_TrialFailed318' and expiry_applied_at is not null) then
    raise exception 'Old receipt reactivated elapsed grace';
  end if;
  perform pg_temp.finish_live_318(trial_binding,jsonb_build_object('outcome','canceled','provider_status','canceled','obligations_cleared',true));
  if not exists(select 1 from public.stripe_billing_subscription_bindings where id=trial_binding
    and not is_current and terminal_confirmed_at is not null and obligations_cleared_at is not null) then
    raise exception 'Verified terminal closure did not retire expired payer';
  end if;
  -- Privacy-safe transport errors use a bounded retry budget and retain access.
  select to_jsonb(access) into snapshot from public.billing_account_access access where subject_user_id=owner_id;
  for i in 1..5 loop
    result:=pg_temp.finish_live_318(binding_id,'{"outcome":"exception","reason_code":"provider_unavailable"}');
    if result#>>'{result,status}'<>'applied' then raise exception 'Live retry could not finish'; end if;
  end loop;
  if not exists(select 1 from public.stripe_billing_subscription_bindings where id=binding_id
      and reconcile_state='attention' and reconcile_attempt_count=5 and next_reconcile_at is null)
    or (select to_jsonb(access) from public.billing_account_access access where subject_user_id=owner_id) is distinct from snapshot then
    raise exception 'Retry budget or access preservation differs';
  end if;
end;
$$;
rollback;
