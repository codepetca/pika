-- Rollback-only proof on an isolated complete migration replay.
begin;
set local statement_timeout='30s';
set local lock_timeout='3s';

do $$
declare
  v_owner uuid:=gen_random_uuid();
  v_other uuid:=gen_random_uuid();
  v_first uuid:=gen_random_uuid();
  v_second uuid:=gen_random_uuid();
  v_cutoff timestamptz;
  v_offering uuid;
  v_binding uuid;
  v_claim jsonb;
  v_result jsonb;
  v_now timestamptz:=date_trunc('second',clock_timestamp());
begin
  if has_table_privilege('service_role','private.billing_classroom_restrictions','select')
    or has_function_privilege('authenticated','public.restore_billing_classroom_v1(uuid,uuid)','execute')
    or has_function_privilege('anon','public.set_billing_classroom_selection_v1(uuid,uuid,uuid[])','execute') then
    raise exception 'Classroom restriction authority widened';
  end if;
  insert into public.users(id,email,role) values(v_owner,'billing-restriction-309-owner@example.invalid','teacher'),
    (v_other,'billing-restriction-309-other@example.invalid','teacher');
  if not exists(select 1 from public.account_plans where subject_user_id=v_owner) then
    perform public.set_account_plan_v1(gen_random_uuid(),v_owner,'free','test:billing-restrictions','fixture',0);
  end if;
  update private.stripe_billing_settings set sandbox_enabled=true where singleton;
  perform public.billing_start_trial_v1(jsonb_build_object('subject_user_id',v_owner,'operation_id',gen_random_uuid()));
  insert into public.classrooms(id,teacher_id,title,class_code) values
    (v_first,v_owner,'Trial classroom one','CAP30901'),(v_second,v_owner,'Trial classroom two','CAP30902');
  if public.get_classroom_creation_access_v1(v_owner)->>'active_count' is distinct from '2' then
    raise exception 'Trial classroom count changed';
  end if;
  insert into public.assignments(classroom_id,created_by,title,due_at,is_draft,released_at) values
    (v_first,v_owner,'Released activity',v_now+interval '1 day',false,v_now-interval '1 hour'),
    (v_second,v_owner,'Future release',v_now+interval '2 days',false,v_now+interval '1 day');
  update private.stripe_billing_settings set classroom_new_work_cutoff_enabled=true where singleton;
  if private.billing_classroom_last_activity_v1(v_first,v_now) is distinct from v_now-interval '1 hour'
    or private.billing_classroom_last_activity_v1(v_second,v_now) is not null then
    raise exception 'Activity order included unpublished work or missed a release';
  end if;

  v_cutoff:=clock_timestamp();
  update public.billing_trials set started_at=v_cutoff-interval '720 hours',ends_at=v_cutoff where subject_user_id=v_owner;
  update public.billing_account_access set starts_at=v_cutoff-interval '720 hours',access_ends_at=v_cutoff
    where subject_user_id=v_owner;
  update public.effective_feature_entitlements set starts_at=v_cutoff-interval '720 hours',expires_at=v_cutoff
    where subject_user_id=v_owner and feature_key='classrooms.create';
  if public.get_classroom_creation_access_v1(v_owner)->>'active_count' is distinct from '0' then
    raise exception 'Exact cutoff still counted expired classrooms as active';
  end if;
  perform public.billing_apply_due_access_v1('{"limit":25}');
  if (select count(*) from private.billing_classroom_restrictions where subject_user_id=v_owner
      and restricted_at=v_cutoff and restored_at is null)<>2
    or exists(select 1 from public.classrooms where id in (v_first,v_second) and archived_at is not null)
    or public.get_classroom_creation_access_v1(v_owner)->>'active_count' is distinct from '0'
    or private.billing_classroom_can_start_work_v1(v_first) then
    raise exception 'Trial expiry did not preserve classrooms with subscription restrictions';
  end if;
  begin
    perform public.restore_billing_classroom_v1(v_owner,v_first);
    raise exception 'Expired trial restored a classroom';
  exception when insufficient_privilege then null;
  end;

  v_offering:=(public.billing_register_offering_v1(jsonb_build_object('plan_key','plus','version',9309,
    'stripe_account','acct_classroom309','provider_mode','test','stripe_product_id','prod_classroom309',
    'stripe_price_id','price_classroom309','currency','usd','unit_amount',1900,'interval','month','classroom_limit',5,
    'features','{"catalog_key":"pika-classroom-fixture"}'::jsonb,'ai_definition',null,
    'availability',jsonb_build_object('is_available',true)))->>'offering_version_id')::uuid;
  v_binding:=(public.billing_bind_customer_v1(jsonb_build_object('subject_user_id',v_owner,
    'stripe_account','acct_classroom309','provider_mode','test','stripe_price_id','price_classroom309',
    'stripe_customer_id','cus_classroom309','stripe_subscription_id','sub_classroom309',
    'offering_version_id',v_offering))->>'subscription_id')::uuid;
  v_claim:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_binding,'lease_seconds',120));
  v_result:=public.billing_finish_lifecycle_v1(jsonb_build_object('subscription_id',v_binding,'lease_token',v_claim->'lease_token',
    'fencing_token',v_claim->'fencing_token','expected_subscription_revision',v_claim->'subscription_revision',
    'expected_account_plan_revision',v_claim->'expected_account_plan_revision','outcome','paid',
    'invoice_id','in_classroom309','period_start',v_now,'period_end',v_now+interval '1 month',
    'provider_status','active','cancel_at_period_end',false,'obligations_cleared',false));
  if v_result->>'status' is distinct from 'applied' or private.billing_classroom_can_start_work_v1(v_first)
    or public.get_classroom_creation_access_v1(v_owner)->>'active_count' is distinct from '0' then
    raise exception 'Paid conversion did not preserve the explicit restore requirement';
  end if;
  begin
    perform public.restore_billing_classroom_v1(v_other,v_first);
    raise exception 'A different teacher restored the classroom';
  exception when sqlstate 'PT404' then null;
  end;
  insert into public.classrooms(teacher_id,title,class_code)
    select v_owner,'New paid classroom '||n,'CAP3090'||n from generate_series(3,6) n;
  if not public.restore_billing_classroom_v1(v_owner,v_first) then
    raise exception 'Explicit restore did not clear the restriction';
  end if;
  if public.restore_billing_classroom_v1(v_owner,v_first)
    or not private.billing_classroom_can_start_work_v1(v_first)
    or public.get_classroom_creation_access_v1(v_owner)->>'active_count' is distinct from '5' then
    raise exception 'Explicit restore did not consume exactly one paid seat';
  end if;
  begin
    perform public.restore_billing_classroom_v1(v_owner,v_second);
    raise exception 'Restore exceeded the paid classroom limit';
  exception when check_violation then
    if sqlerrm<>'classroom_creation_active_limit_reached' then raise; end if;
  end;
  if not private.billing_classroom_is_restricted_v1(v_owner,v_second) then
    raise exception 'Failed restore changed the existing restriction';
  end if;
end $$;

do $$
declare
  v_case text;
  v_owner uuid;
  v_classroom uuid;
  v_offering uuid;
  v_binding uuid;
  v_claim jsonb;
  v_request jsonb;
  v_result jsonb;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_cutoff timestamptz;
begin
  v_offering:=(public.billing_register_offering_v1(jsonb_build_object('plan_key','plus','version',9310,
    'stripe_account','acct_reentry309','provider_mode','test','stripe_product_id','prod_reentry309',
    'stripe_price_id','price_reentry309','currency','usd','unit_amount',1900,'interval','month','classroom_limit',5,
    'features','{"catalog_key":"pika-reentry-fixture"}'::jsonb,'ai_definition',null,
    'availability',jsonb_build_object('is_available',true)))->>'offering_version_id')::uuid;

  foreach v_case in array array['beforeworker','disabledexpiry','terminalretirement'] loop
    v_owner:=gen_random_uuid();
    v_classroom:=gen_random_uuid();
    update private.stripe_billing_settings set classroom_new_work_cutoff_enabled=true where singleton;
    insert into public.users(id,email,role)
    values(v_owner,'billing-capacity-'||v_case||'@example.invalid','teacher');
    if not exists(select 1 from public.account_plans where subject_user_id=v_owner) then
      perform public.set_account_plan_v1(gen_random_uuid(),v_owner,'free','test:billing-reentry','fixture',0);
    end if;
    perform public.billing_start_trial_v1(jsonb_build_object('subject_user_id',v_owner,'operation_id',gen_random_uuid()));
    insert into public.classrooms(id,teacher_id,title,class_code)
    values(v_classroom,v_owner,'Retained classroom',case v_case
      when 'beforeworker' then 'RE309001' when 'disabledexpiry' then 'RE309002' else 'RE309003' end);

    v_period_start:=date_trunc('second',clock_timestamp());
    v_period_end:=v_period_start+interval '1 month';
    if v_case='terminalretirement' then
      v_period_end:=v_period_start-interval '8 days';
      v_period_start:=v_period_end-interval '1 month';
    else
      v_cutoff:=clock_timestamp();
      update public.billing_trials set started_at=v_cutoff-interval '720 hours',ends_at=v_cutoff where subject_user_id=v_owner;
      update public.billing_account_access set starts_at=v_cutoff-interval '720 hours',access_ends_at=v_cutoff
        where subject_user_id=v_owner;
      update public.effective_feature_entitlements set starts_at=v_cutoff-interval '720 hours',expires_at=v_cutoff
        where subject_user_id=v_owner and feature_key='classrooms.create';
      if v_case='disabledexpiry' then
        update private.stripe_billing_settings set classroom_new_work_cutoff_enabled=false where singleton;
        perform public.billing_apply_due_access_v1('{"limit":25}');
        if private.billing_classroom_is_restricted_v1(v_owner,v_classroom) then raise exception 'Dormant fixture restricted a classroom'; end if;
        update private.stripe_billing_settings set classroom_new_work_cutoff_enabled=true where singleton;
      elsif (select plan_key from public.account_plans where subject_user_id=v_owner) is distinct from 'plus' then
        raise exception 'Fixture applied expiry before payment';
      end if;
    end if;

    v_binding:=(public.billing_bind_customer_v1(jsonb_build_object('subject_user_id',v_owner,
      'stripe_account','acct_reentry309','provider_mode','test','stripe_price_id','price_reentry309',
      'stripe_customer_id','cus_reentry309'||v_case,'stripe_subscription_id','sub_reentry309'||v_case,
      'offering_version_id',v_offering))->>'subscription_id')::uuid;
    v_claim:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_binding,'lease_seconds',120));
    v_request:=jsonb_build_object('subscription_id',v_binding,'lease_token',v_claim->'lease_token',
      'fencing_token',v_claim->'fencing_token','expected_subscription_revision',v_claim->'subscription_revision',
      'expected_account_plan_revision',v_claim->'expected_account_plan_revision','outcome','paid',
      'invoice_id','in_reentry309'||v_case,'period_start',v_period_start,'period_end',v_period_end,
      'provider_status','active','cancel_at_period_end',false,'obligations_cleared',false);
    v_result:=public.billing_finish_lifecycle_v1(v_request);
    if v_result->>'status' is distinct from 'applied' then raise exception 'Fixture payment failed: %',v_case; end if;

    if v_case='terminalretirement' then
      v_cutoff:=v_period_end+interval '168 hours';
      v_claim:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_binding,'lease_seconds',120));
      v_request:=v_request||jsonb_build_object('lease_token',v_claim->'lease_token','fencing_token',v_claim->'fencing_token',
        'expected_subscription_revision',v_claim->'subscription_revision','expected_account_plan_revision',v_claim->'expected_account_plan_revision',
        'outcome','renewal_failed','invoice_id','in_reentry309failed','period_start',v_period_end,
        'period_end',v_period_end+interval '1 month','provider_status','past_due');
      if public.billing_finish_lifecycle_v1(v_request)->>'status' is distinct from 'applied' then
        raise exception 'Fixture could not record failed renewal';
      end if;
      if private.billing_classroom_is_restricted_v1(v_owner,v_classroom) then raise exception 'Grace was closed before terminal verification'; end if;
      v_claim:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_binding,'lease_seconds',120));
      v_request:=v_request||jsonb_build_object('lease_token',v_claim->'lease_token','fencing_token',v_claim->'fencing_token',
        'expected_subscription_revision',v_claim->'subscription_revision','expected_account_plan_revision',v_claim->'expected_account_plan_revision',
        'outcome','canceled','invoice_id',null,'period_start',null,'period_end',null,
        'provider_status','canceled','obligations_cleared',true);
      v_result:=public.billing_finish_lifecycle_v1(v_request);
      if v_result->>'status' is distinct from 'applied'
        or exists(select 1 from public.stripe_billing_subscription_bindings where id=v_binding and is_current)
        or exists(select 1 from public.billing_renewal_closeouts where subscription_id=v_binding) then
        raise exception 'Ordinary terminal fixture did not retire without closeout';
      end if;
    end if;

    if not exists(select 1 from private.billing_classroom_restrictions where subject_user_id=v_owner
      and classroom_id=v_classroom and restricted_at=v_cutoff and restored_at is null)
      or private.billing_classroom_can_start_work_v1(v_classroom)
      or (select archived_at from public.classrooms where id=v_classroom) is not null then
      raise exception 'Cutoff history did not require explicit restoration: %',v_case;
    end if;
    if v_case<>'terminalretirement' and not public.restore_billing_classroom_v1(v_owner,v_classroom) then
      raise exception 'Paid re-entry did not allow explicit restore: %',v_case;
    end if;
  end loop;
end $$;

rollback;
