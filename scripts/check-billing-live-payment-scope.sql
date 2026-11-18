-- Owned disposable 314 replay only. No state survives this transaction.
begin;
do $fixture$
declare
  v_project constant text:='abcdefghijklmnopqrst';
  v_account constant text:='acct_Live314';
  v_request jsonb;
  v_first jsonb;
  v_again jsonb;
  v_failed boolean;
begin
  if public.billing_live_payment_lifecycle_ready_v1(v_project,v_account) then
    raise exception 'live payment defaults must be off';
  end if;
  if has_function_privilege('anon','public.billing_record_live_event_v1(text,jsonb)','execute')
    or has_function_privilege('authenticated','public.billing_record_live_event_v1(text,jsonb)','execute')
    or not has_function_privilege('service_role','public.billing_record_live_event_v1(text,jsonb)','execute')
    or has_table_privilege('service_role','private.billing_live_payment_target','select') then
    raise exception 'live payment privilege boundary differs';
  end if;
  -- Independently prove the opposite activation order using a real 313 trial.
  -- The sentinel rolls its entire subtransaction back before the paid-first case.
  begin
    declare v_subject uuid:=gen_random_uuid(); v_operation uuid:=gen_random_uuid();
    begin
      insert into public.users(id,email,role) values(v_subject,'live-payment-prior-trial@example.invalid','teacher');
      if not exists(select 1 from public.account_plans where subject_user_id=v_subject) then
        perform public.set_account_plan_v1(gen_random_uuid(),v_subject,'free','test:live-payment','fixture',0);
      end if;
      update private.stripe_billing_settings set live_project_ref=v_project,live_stripe_account=v_account,
        classroom_new_work_cutoff_enabled=true where singleton;
      update private.stripe_billing_settings set live_trial_lifecycle_enabled=true,live_trial_admission_enabled=true where singleton;
      perform public.billing_start_live_trial_v1(v_project,v_account,
        jsonb_build_object('subject_user_id',v_subject,'operation_id',v_operation));
      if public.billing_attest_live_target_v1(v_project,v_account) then
        raise exception 'trial evidence must invalidate pristine attestation';
      end if;
      update private.stripe_billing_settings set live_payment_lifecycle_enabled=true where singleton;
      if not public.billing_live_payment_lifecycle_ready_v1(v_project,v_account)
        or public.billing_live_payment_lifecycle_ready_v1(v_project,'acct_Foreign314') then
        raise exception 'paid lifecycle did not bind the prior trial target';
      end if;
      raise exception using errcode='P3141',message='rollback_prior_trial_fixture';
    end;
  exception when sqlstate 'P3141' then null;
  end;
  update private.stripe_billing_settings set live_project_ref=v_project,live_stripe_account=v_account,
    classroom_new_work_cutoff_enabled=true where singleton;
  if not public.billing_attest_live_target_v1(v_project,v_account) then
    raise exception 'fixture requires pristine target';
  end if;
  update private.stripe_billing_settings set live_payment_lifecycle_enabled=true where singleton;
  if not public.billing_live_payment_lifecycle_ready_v1(v_project,v_account)
    or public.billing_live_payment_lifecycle_ready_v1(v_project,'acct_Foreign314') then
    raise exception 'live target mismatch';
  end if;
  v_request:=jsonb_build_object('stripe_account',v_account,'provider_mode','live',
    'event_id','evt_Live314','payload_hash',repeat('a',64),'event_type','invoice.paid',
    'event_created_at','2026-11-08T12:00:00.000Z','received_at','2026-11-08T12:00:01.000Z',
    'payload',jsonb_build_object('object_id','in_Live314','customer_id','cus_Live314','subscription_id','sub_Live314'));
  v_failed:=false;
  begin perform public.billing_record_live_event_v1(v_project,'[]'::jsonb);
  exception when invalid_parameter_value then v_failed:=true; end;
  if not v_failed then raise exception 'non-object receipt accepted'; end if;
  v_first:=public.billing_record_live_event_v1(v_project,v_request);
  v_again:=public.billing_record_live_event_v1(v_project,v_request);
  if v_first->>'status'<>'accepted' or v_again->>'status'<>'duplicate'
    or v_first->>'event_inbox_id'<>v_again->>'event_inbox_id'
    or not exists(select 1 from public.stripe_billing_event_inbox where id=(v_first->>'event_inbox_id')::uuid
      and provider_mode='live' and status='exception' and exception_code='unbound_event') then
    raise exception 'event acceptance or deduplication differs';
  end if;
  v_failed:=false;
  begin perform public.billing_record_live_event_v1(v_project,jsonb_set(v_request,'{payload_hash}',to_jsonb(repeat('b',64))));
  exception when unique_violation then v_failed:=true; end;
  if not v_failed then raise exception 'conflicting duplicate accepted'; end if;
  v_failed:=false;
  begin perform public.billing_record_live_event_v1(v_project,jsonb_set(v_request,'{stripe_account}','"acct_Foreign314"'));
  exception when object_not_in_prerequisite_state then v_failed:=true; end;
  if not v_failed then raise exception 'foreign target accepted'; end if;
  v_failed:=false;
  begin perform public.billing_record_live_event_v1(v_project,jsonb_set(v_request,'{payload,subscription_id}','"sub_other_!"'));
  exception when invalid_parameter_value then v_failed:=true; end;
  if not v_failed then raise exception 'invalid receipt accepted'; end if;
  v_again:=public.billing_record_live_event_v1(v_project,
    v_request||jsonb_build_object('event_id','evt_Sub314','event_type','customer.subscription.updated',
      'payload',jsonb_build_object('object_id','sub_Live314','customer_id','cus_Live314','subscription_id','sub_Live314')));
  if not exists(select 1 from public.stripe_billing_event_inbox where id=(v_again->>'event_inbox_id')::uuid
    and stripe_invoice_id is null and stripe_subscription_id='sub_Live314') then
    raise exception 'subscription receipt misidentified as invoice';
  end if;
  if public.billing_attest_live_target_v1(v_project,v_account) then
    raise exception 'pristine attestation must remain false after receipt';
  end if;
  update private.stripe_billing_settings set live_payment_lifecycle_enabled=false where singleton;
  update private.stripe_billing_settings set live_trial_lifecycle_enabled=true where singleton;
  if not public.billing_live_trial_lifecycle_ready_v1(v_project,v_account)
    or public.billing_live_trial_lifecycle_ready_v1(v_project,'acct_Foreign314') then
    raise exception 'trial must use anchored paid target';
  end if;
  update private.stripe_billing_settings set live_trial_lifecycle_enabled=false where singleton;
  v_failed:=false;
  begin update private.stripe_billing_settings set live_stripe_account='acct_Foreign314' where singleton;
  exception when object_not_in_prerequisite_state then v_failed:=true; end;
  if not v_failed then raise exception 'target changed after lifecycle disabled'; end if;
  v_failed:=false;
  begin update private.stripe_billing_settings set classroom_new_work_cutoff_enabled=false where singleton;
  exception when object_not_in_prerequisite_state then v_failed:=true; end;
  if not v_failed then raise exception 'cutoff changed after lifecycle disabled'; end if;
end;
$fixture$;
rollback;
