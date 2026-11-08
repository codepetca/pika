-- Rollback-only proof on an owned disposable replay through 321.
begin;
set local statement_timeout='30s';
set local lock_timeout='3s';
do $$
declare
  v_project text:='abcdefghijklmnopqrst'; v_account text:='acct_Admission321';
  v_owner uuid:=gen_random_uuid(); v_other uuid:=gen_random_uuid(); v_trial uuid:=gen_random_uuid();
  v_classroom uuid:=gen_random_uuid(); v_other_classroom uuid:=gen_random_uuid(); v_trial_classroom uuid:=gen_random_uuid();
  v_assignment uuid:=gen_random_uuid(); v_other_assignment uuid:=gen_random_uuid(); v_trial_draft uuid:=gen_random_uuid();
  v_attempt uuid:=gen_random_uuid(); v_binding uuid; v_version uuid; v_offering jsonb; v_request jsonb;
  v_before jsonb; v_failed boolean; v_result jsonb; v_user uuid;
begin
  if has_function_privilege('anon','public.billing_live_checkout_activation_ready_v1(text,text)','execute')
    or has_function_privilege('authenticated','public.billing_live_checkout_activation_ready_v1(text,text)','execute')
    or not has_function_privilege('service_role','public.billing_live_checkout_activation_ready_v1(text,text)','execute') then
    raise exception 'Activation readiness ACL differs';
  end if;
  insert into public.users(id,email,role) values
    (v_owner,'checkout-admission-owner@example.invalid','teacher'),
    (v_other,'checkout-admission-other@example.invalid','teacher'),
    (v_trial,'checkout-admission-trial@example.invalid','teacher');
  foreach v_user in array array[v_owner,v_other,v_trial] loop
    perform public.set_account_plan_v1(gen_random_uuid(),v_user,'plus','test:admission321','fixture',
      coalesce((select revision from public.account_plans where subject_user_id=v_user),0));
  end loop;
  insert into public.classrooms(id,teacher_id,title,class_code) values
    (v_classroom,v_owner,'Owner retained','ADM32101'),
    (v_other_classroom,v_other,'Other retained','ADM32102'),
    (v_trial_classroom,v_trial,'Trial retained','ADM32103');
  insert into public.assignments(id,classroom_id,created_by,title,due_at,is_draft,released_at) values
    (v_assignment,v_classroom,v_owner,'Old schedule',clock_timestamp()+interval '4 days',false,clock_timestamp()+interval '2 days'),
    (v_other_assignment,v_other_classroom,v_other,'Transfer schedule',clock_timestamp()+interval '4 days',false,clock_timestamp()+interval '2 days'),
    (v_trial_draft,v_trial_classroom,v_trial,'Durable schedule',clock_timestamp()+interval '4 days',true,null);
  foreach v_user in array array[v_owner,v_other,v_trial] loop
    perform public.set_account_plan_v1(gen_random_uuid(),v_user,'free','test:admission321','fixture',
      (select revision from public.account_plans where subject_user_id=v_user));
  end loop;
  update private.stripe_billing_settings set live_project_ref=v_project,live_stripe_account=v_account,
    classroom_new_work_cutoff_enabled=true where singleton;
  update private.stripe_billing_settings set live_payment_lifecycle_enabled=true,
    live_checkout_admission_enabled=true,live_checkout_writes_enabled=true where singleton;
  if public.billing_live_checkout_activation_ready_v1(v_project,v_account)
    or not public.billing_live_payment_lifecycle_ready_v1(v_project,v_account) then
    raise exception 'Disabled closeout did not hold admission independently of recovery';
  end if;
  v_version:=(public.billing_register_live_checkout_offering_v1(v_project,v_account,jsonb_build_object(
    'plan_key','plus','version',321001,'stripe_account',v_account,'provider_mode','live',
    'stripe_product_id','prod_Admission321','stripe_price_id','price_Admission321','currency','usd','interval','month',
    'unit_amount',1900,'classroom_limit',5,'features',jsonb_build_object(
      'catalog_key','pika:repolight-2026-10-29:pro:usd:month','display_name','Pro',
      'release_tag','repolight-2026-10-29','repolight_analysis',true),
    'ai_definition',null,'availability',jsonb_build_object('is_available',true)))->>'offering_version_id')::uuid;
  v_offering:=public.billing_get_live_checkout_offering_v1(v_project,v_account,jsonb_build_object('offering_version_id',v_version,'stripe_account',v_account));
  v_request:=jsonb_build_object('attempt_id',v_attempt,'subject_user_id',v_owner,'offering',v_offering,
    'lookup_key',v_offering->>'catalog_key','success_url','https://pika.codepet.ca/billing?checkout='||v_attempt||'&result=success',
    'cancel_url','https://pika.codepet.ca/billing?checkout='||v_attempt||'&result=cancel');
  v_failed:=false;
  begin perform public.billing_reserve_live_checkout_v1(v_project,v_account,v_request);
  exception when sqlstate '55000' then
    if sqlerrm<>'billing_live_checkout_activation_unavailable' then raise; end if; v_failed:=true;
  end;
  if not v_failed then raise exception 'New checkout accepted without closeout'; end if;
  update private.stripe_billing_settings set live_closeout_enabled=true where singleton;
  if not public.billing_live_checkout_activation_ready_v1(v_project,v_account)
    or public.billing_live_checkout_activation_ready_v1(v_project,'acct_Other321') then raise exception 'Readiness did not bind exact target'; end if;
  select to_jsonb(a) into v_before from public.assignments a where id=v_assignment;
  v_failed:=false;
  begin perform public.billing_reserve_live_checkout_v1(v_project,v_account,v_request);
  exception when sqlstate '55000' then
    if sqlerrm<>'billing_live_checkout_future_releases' then raise; end if; v_failed:=true;
  end;
  if not v_failed or (select to_jsonb(a) from public.assignments a where id=v_assignment) is distinct from v_before
    or exists(select 1 from public.stripe_checkout_attempts where id=v_attempt) then
    raise exception 'Existing legacy release was not preserved';
  end if;
  update public.assignments set is_draft=true,released_at=null where id=v_assignment;
  v_result:=public.billing_reserve_live_checkout_v1(v_project,v_account,v_request);
  if v_result->>'status'<>'reserved' or not private.billing_live_legacy_assignment_fenced_v1(v_owner) then
    raise exception 'Eligible checkout was not fenced';
  end if;
  v_failed:=false;
  begin update public.assignments set is_draft=false,released_at=clock_timestamp()+interval '1 day' where id=v_assignment;
  exception when sqlstate 'PT403' then v_failed:=true; end;
  if not v_failed then raise exception 'Pending checkout allowed legacy future publication'; end if;
  v_failed:=false;
  begin update public.classrooms set teacher_id=v_owner where id=v_other_classroom;
  exception when sqlstate 'PT403' then v_failed:=true; end;
  if not v_failed then raise exception 'Pending checkout accepted transferred legacy publication'; end if;
  -- Pausing admission and closeout does not erase or prevent reading a reservation.
  update private.stripe_billing_settings set live_checkout_admission_enabled=false,live_checkout_writes_enabled=false,live_closeout_enabled=false where singleton;
  if public.billing_live_checkout_activation_ready_v1(v_project,v_account)
    or public.billing_get_live_checkout_v1(v_project,v_account,jsonb_build_object('attempt_id',v_attempt,'subject_user_id',v_owner))->>'attempt_id'<>v_attempt::text then
    raise exception 'Paused admission broke existing checkout recovery';
  end if;
  -- Bound-but-unpaid evidence continues to fence legacy publication.
  insert into public.stripe_billing_subscription_bindings(subject_user_id,stripe_account,provider_mode,stripe_customer_id,stripe_subscription_id,offering_version_id)
    values(v_owner,v_account,'live','cus_Admission321','sub_Admission321',v_version) returning id into v_binding;
  update public.stripe_checkout_attempts set status='bound',subscription_id=v_binding where id=v_attempt;
  if not private.billing_live_legacy_assignment_fenced_v1(v_owner) then raise exception 'Bound unpaid checkout lost fence'; end if;
  v_failed:=false;
  begin update public.assignments set is_draft=false,released_at=clock_timestamp()+interval '1 day' where id=v_assignment;
  exception when sqlstate 'PT403' then v_failed:=true; end;
  if not v_failed then raise exception 'Bound unpaid checkout allowed legacy schedule'; end if;
  -- Even if attempt/binding are no longer current, a paid-owned plan remains fenced.
  update public.stripe_checkout_attempts set status='expired' where id=v_attempt;
  update public.stripe_billing_subscription_bindings set is_current=false where id=v_binding;
  insert into public.billing_account_access(subject_user_id,source,subscription_id,offering_version_id,starts_at,
    paid_period_start,paid_through,last_paid_invoice_id,access_ends_at,end_reason,account_plan_revision)
  values(v_owner,'paid',v_binding,v_version,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 day',
    'in_Admission321',clock_timestamp()+interval '1 day','cancellation',
    (select revision from public.account_plans where subject_user_id=v_owner));
  update public.account_plans set management_source='billing',billing_offering_version_id=v_version where subject_user_id=v_owner;
  if not private.billing_live_legacy_assignment_fenced_v1(v_owner) then raise exception 'Paid-owned history lost fence'; end if;
  v_failed:=false;
  begin update public.assignments set is_draft=false,released_at=clock_timestamp()+interval '1 day' where id=v_assignment;
  exception when sqlstate 'PT403' then v_failed:=true; end;
  if not v_failed then raise exception 'Paid-owned plan allowed legacy schedule'; end if;
  -- A live trial still uses the 312 durable draft schedule path.
  update private.stripe_billing_settings set live_trial_lifecycle_enabled=true,live_trial_admission_enabled=true where singleton;
  perform public.billing_start_live_trial_v1(v_project,v_account,jsonb_build_object('subject_user_id',v_trial,'operation_id',gen_random_uuid()));
  v_result:=public.schedule_assignment_for_billing_v1(v_trial,v_trial_draft,clock_timestamp()+interval '1 day',null);
  if v_result#>>'{release_schedule,state}'<>'pending'
    or not exists(select 1 from public.assignments where id=v_trial_draft and is_draft and released_at is null) then
    raise exception 'Durable assignment scheduling was blocked';
  end if;
end;
$$;
rollback;
