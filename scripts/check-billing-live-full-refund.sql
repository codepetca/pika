-- Rollback-only proof on an owned disposable replay through migration 328.
begin;
set local statement_timeout='30s';
set local lock_timeout='3s';

create function pg_temp.claim_refund_fixture(p_project text,p_account text,p_subscription uuid)
returns jsonb language plpgsql as $$
declare
  claim jsonb;
begin
  update public.stripe_billing_subscription_bindings
    set next_reconcile_at=clock_timestamp()-interval '1 second' where id=p_subscription;
  claim:=public.billing_claim_live_subscription_v1(p_project,p_account,
    jsonb_build_object('subscription_id',p_subscription,'lease_seconds',120));
  if claim->>'status' is distinct from 'claimed' then
    raise exception 'Could not claim live refund fixture subscription: %',claim;
  end if;
  return jsonb_build_object(
    'subscription_id',p_subscription,'lease_token',claim->'lease_token','fencing_token',claim->'fencing_token',
    'expected_subscription_revision',claim->'subscription_revision',
    'expected_account_plan_revision',claim->'expected_account_plan_revision');
end;
$$;

do $$
declare
  project constant text:='abcdefghijklmnopqrst';
  account constant text:='acct_Refund328';
  stripe_customer constant text:='cus_Refund328';
  stripe_subscription constant text:='sub_Refund328';
  stripe_invoice constant text:='in_Refund328';
  stripe_price constant text:='price_Refund328';
  refund_rpc constant text:='public.billing_apply_live_full_refund_v1(text,text,jsonb)';
  teacher uuid:=gen_random_uuid();
  learner uuid:=gen_random_uuid();
  late_learner uuid:=gen_random_uuid();
  classroom uuid:=gen_random_uuid();
  published_assignment uuid:=gen_random_uuid();
  draft_assignment uuid:=gen_random_uuid();
  fixture_test uuid:=gen_random_uuid();
  question_id uuid:=gen_random_uuid();
  test_attempt uuid;
  attempt uuid:=gen_random_uuid();
  operation uuid:=gen_random_uuid();
  offering_id uuid;
  target_offering_id uuid;
  schedule_operation uuid:=gen_random_uuid();
  cancel_operation uuid:=gen_random_uuid();
  subscription uuid;
  offering jsonb;
  checkout_claim jsonb;
  checkout_fence jsonb;
  paid_observation jsonb;
  delayed_paid_observation jsonb;
  request jsonb;
  invalid_evidence jsonb;
  result jsonb;
  access_before jsonb;
  binding_before jsonb;
  invoice_before jsonb;
  original_effect_id uuid;
  applied_at timestamptz;
  cutoff timestamptz;
  refund_access_revision bigint;
  v_period_start timestamptz:=date_trunc('second',clock_timestamp())-interval '2 days';
  v_paid_through timestamptz:=v_period_start+interval '1 month';
  assignment_due timestamptz:=clock_timestamp()+interval '1 day';
  draft_revision bigint;
  answers jsonb;
  retained_work constant jsonb:='{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Retained learner work"}]}]}';
  api_role text;
begin
  foreach api_role in array array['anon','authenticated','service_role'] loop
    if has_function_privilege(api_role,refund_rpc,'execute') is distinct from (api_role='service_role')
      or has_table_privilege(api_role,'private.billing_live_full_refunds',
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
      raise exception 'Unexpected refund authority for %',api_role;
    end if;
  end loop;
  if not exists(select 1 from pg_catalog.pg_class where oid='private.billing_live_full_refunds'::regclass and relrowsecurity)
    or exists(select 1 from private.billing_live_full_refunds) then
    raise exception 'Refund ledger must start empty with row-level security enabled';
  end if;

  insert into public.users(id,email,role) values
    (teacher,'billing-refund-328-owner@example.invalid','teacher'),
    (learner,'billing-refund-328-learner@example.invalid','student'),
    (late_learner,'billing-refund-328-late@example.invalid','student');
  if not exists(select 1 from public.account_plans where subject_user_id=teacher) then
    perform public.set_account_plan_v1(gen_random_uuid(),teacher,'free','test:refund328','fixture',0);
  end if;

  update private.stripe_billing_settings set live_project_ref=project,live_stripe_account=account,
    classroom_new_work_cutoff_enabled=true where singleton;
  update private.stripe_billing_settings set live_payment_lifecycle_enabled=true,live_closeout_enabled=true,
    live_checkout_admission_enabled=true,live_checkout_writes_enabled=true where singleton;

  result:=public.billing_register_live_checkout_offering_v1(project,account,jsonb_build_object(
    'plan_key','pro','version',328001,'stripe_account',account,'provider_mode','live',
    'stripe_product_id','prod_Refund328','stripe_price_id',stripe_price,
    'currency','cad','unit_amount',5500,'interval','month','classroom_limit',12,
    'features','{"catalog_key":"pika:repolight-2026-10-29:max:cad:month:stripe-exclusive",
      "display_name":"Max","release_tag":"repolight-2026-10-29","repolight_analysis":true,
      "billing_tax_mode":"stripe_exclusive"}'::jsonb,'ai_definition',null));
  offering_id:=(result->>'offering_version_id')::uuid;
  perform public.billing_set_live_checkout_offering_availability_v1(project,account,
    jsonb_build_object('offering_version_id',offering_id,'is_available',true));
  offering:=public.billing_get_live_checkout_offering_v1(project,account,
    jsonb_build_object('offering_version_id',offering_id,'stripe_account',account));

  perform public.billing_reserve_live_checkout_v1(project,account,jsonb_build_object(
    'attempt_id',attempt,'subject_user_id',teacher,'offering',offering,'lookup_key',offering->>'catalog_key',
    'success_url','https://pika.codepet.ca/billing?checkout='||attempt||'&result=success',
    'cancel_url','https://pika.codepet.ca/billing?checkout='||attempt||'&result=cancel'));
  checkout_claim:=public.billing_claim_live_checkout_v1(project,account,
    jsonb_build_object('attempt_id',attempt,'lease_seconds',120));
  checkout_fence:=jsonb_build_object('attempt_id',attempt,'lease_token',checkout_claim->'lease_token',
    'fencing_token',checkout_claim->'fencing_token');
  perform public.billing_save_live_checkout_progress_v1(project,account,checkout_fence||jsonb_build_object(
    'customer_id',stripe_customer,'session_id','cs_live_Refund328'));
  perform public.billing_finish_live_checkout_v1(project,account,
    checkout_fence||jsonb_build_object('outcome','bound','subscription_id',stripe_subscription));
  select id into strict subscription from public.stripe_billing_subscription_bindings
    where subject_user_id=teacher and stripe_subscription_id=stripe_subscription;

  paid_observation:=jsonb_build_object('outcome','paid','invoice_id',stripe_invoice,
    'period_start',v_period_start,'period_end',v_paid_through,'provider_status','active',
    'cancel_at_period_end',false,'obligations_cleared',false);
  result:=public.billing_finish_live_lifecycle_v1(project,account,
    pg_temp.claim_refund_fixture(project,account,subscription)||paid_observation);
  if result->>'status' is distinct from 'applied' then raise exception 'First paid invoice did not apply: %',result; end if;
  result:=public.billing_get_live_access_status_v1(project,account,jsonb_build_object('subject_user_id',teacher));
  if result->>'state' is distinct from 'paid' or result->>'classroom_limit' is distinct from '12'
    or result->>'can_start_paid_work' is distinct from 'true' then
    raise exception 'First paid invoice did not activate Max: %',result;
  end if;
  select effect.id,to_jsonb(effect) into strict original_effect_id,invoice_before
    from public.stripe_billing_invoice_effects effect where effect.subscription_id=subscription and effect.stripe_invoice_id=stripe_invoice;

  insert into public.classrooms(id,teacher_id,title,class_code) values(classroom,teacher,'Refund fixture','RFD32801');
  insert into public.classroom_enrollments(classroom_id,student_id) values(classroom,learner),(classroom,late_learner);
  insert into public.assignments(id,classroom_id,created_by,title,due_at) values
    (published_assignment,classroom,teacher,'Existing assignment',assignment_due),
    (draft_assignment,classroom,teacher,'Unreleased assignment',assignment_due);
  result:=public.release_assignment_for_owner_v1(teacher,published_assignment,clock_timestamp(),false);
  if result#>>'{assignment,is_draft}' is distinct from 'false' then raise exception 'Paid assignment publication failed'; end if;

  insert into public.tests(id,classroom_id,title,status,points_possible,created_by)
    values(fixture_test,classroom,'Existing Test','draft',1,teacher);
  insert into public.test_questions(id,test_id,question_type,question_text,options,correct_option,points,position)
    values(question_id,fixture_test,'multiple_choice','Question','["A","B"]',1,1,0);
  update public.tests set status='active' where id=fixture_test;
  result:=public.start_test_attempt_revision_atomic(fixture_test,learner);
  test_attempt:=(result#>>'{attempt,id}')::uuid;
  if result->>'created' is distinct from 'true' or test_attempt is null then raise exception 'Paid Test Start failed'; end if;

  request:=jsonb_build_object('apply',true,'operation_id',operation,
    'stripe_subscription_id',stripe_subscription,'stripe_customer_id',stripe_customer,'invoice_id',stripe_invoice,
    'charge_id','ch_Refund328','refund_ids',jsonb_build_array('re_Refund328B','re_Refund328A'),
    'currency','cad','gross_amount',6215,'base_amount',5500,'price_id',stripe_price,
    'paid_period_start',v_period_start,'paid_through',v_paid_through);

  -- Advance a real renewal inside a subtransaction, then restore the first term.
  begin
    result:=public.billing_finish_live_lifecycle_v1(project,account,
      pg_temp.claim_refund_fixture(project,account,subscription)||paid_observation||jsonb_build_object(
        'invoice_id','in_Refund328Renewal','period_start',v_paid_through,'period_end',v_paid_through+interval '1 month'));
    if result->>'status' is distinct from 'applied' then raise exception 'Could not construct a newer paid invoice: %',result; end if;
    if public.billing_apply_live_full_refund_v1(project,account,request)->>'status' is distinct from 'not_current_term'
      or not exists(select 1 from public.billing_account_access
        where subject_user_id=teacher and last_paid_invoice_id='in_Refund328Renewal') then
      raise exception 'Refund of an earlier paid invoice changed the newer term';
    end if;
    raise exception using errcode='P3280',message='Restore first-term fixture';
  exception when sqlstate 'P3280' then null;
  end;

  delayed_paid_observation:=pg_temp.claim_refund_fixture(project,account,subscription)||paid_observation;

  result:=public.billing_register_live_checkout_offering_v1(project,account,jsonb_build_object(
    'plan_key','plus','version',328002,'stripe_account',account,'provider_mode','live',
    'stripe_product_id','prod_Refund328Pro','stripe_price_id','price_Refund328Pro',
    'currency','cad','unit_amount',2700,'interval','month','classroom_limit',5,
    'features','{"catalog_key":"pika:repolight-2026-10-29:pro:cad:month:stripe-exclusive",
      "display_name":"Pro","release_tag":"repolight-2026-10-29","repolight_analysis":true,
      "billing_tax_mode":"stripe_exclusive"}'::jsonb,'ai_definition',null));
  target_offering_id:=(result->>'offering_version_id')::uuid;
  insert into private.billing_scheduled_plan_changes(id,subject_user_id,subscription_id,
    source_offering_version_id,target_offering_version_id,paid_period_start,effective_at,quote_expires_at,
    last_paid_invoice_id,expected_plan_revision,expected_access_revision,expected_entitlement_revision,
    state,confirmed_at,provider_schedule_id)
  select schedule_operation,teacher,subscription,offering_id,target_offering_id,v_period_start,
    v_paid_through,v_paid_through-interval '1 day',stripe_invoice,account_plan_revision,revision,entitlement_revision,
    'scheduled',clock_timestamp(),'sub_sched_Refund328'
  from public.billing_account_access where subject_user_id=teacher;
  insert into private.billing_live_scheduled_cancellations(id,schedule_operation_id,subscription_id,state,
    requested_action,action_requested_at,next_attempt_at)
  values(cancel_operation,schedule_operation,subscription,'cancel_pending','cancel',
    clock_timestamp(),clock_timestamp());
  select to_jsonb(access) into strict access_before from public.billing_account_access access where subject_user_id=teacher;
  select to_jsonb(binding) into strict binding_before from public.stripe_billing_subscription_bindings binding where id=subscription;

  foreach invalid_evidence in array array[
    '{"invoice_id":"in_Wrong328"}'::jsonb,'{"stripe_customer_id":"cus_Wrong328"}','{"stripe_subscription_id":"sub_Wrong328"}',
    '{"price_id":"price_Wrong328"}','{"currency":"usd"}','{"gross_amount":2600}'
  ] loop
    if public.billing_apply_live_full_refund_v1(project,account,request||invalid_evidence)->>'status'
      is distinct from 'not_current_term' then raise exception 'Wrong refund evidence was accepted: %',invalid_evidence; end if;
  end loop;
  begin
    perform public.billing_apply_live_full_refund_v1(project,'acct_Wrong328',request);
    raise exception 'Refund accepted on a foreign Stripe account';
  exception when sqlstate '55000' then
    if sqlerrm<>'billing_live_payment_lifecycle_unavailable' then raise; end if;
  end;
  begin
    perform public.billing_apply_live_full_refund_v1(project,account,request||'{"refund_ids":["re_Refund328A","re_Refund328A"]}');
    raise exception 'Refund accepted duplicate provider refund IDs';
  exception when invalid_parameter_value then
    if sqlerrm<>'billing_full_refund_ids_invalid' then raise; end if;
  end;

  set local role service_role;
  result:=public.billing_apply_live_full_refund_v1(project,account,request||'{"apply":false}');
  reset role;
  if result is distinct from '{"status":"verified"}'::jsonb
    or (select to_jsonb(access) from public.billing_account_access access where subject_user_id=teacher) is distinct from access_before
    or (select to_jsonb(binding) from public.stripe_billing_subscription_bindings binding where id=subscription) is distinct from binding_before
    or exists(select 1 from private.billing_live_full_refunds)
    or exists(select 1 from public.billing_lifecycle_audit where operation_id=operation)
    or exists(select 1 from private.billing_classroom_restrictions where subject_user_id=teacher) then
    raise exception 'Dry run or rejected evidence changed live state';
  end if;

  applied_at:=clock_timestamp();
  set local role service_role;
  result:=public.billing_apply_live_full_refund_v1(project,account,request);
  reset role;
  cutoff:=(result->>'access_ended_at')::timestamptz;
  if result->>'status' is distinct from 'applied' or cutoff is null
    or cutoff<applied_at or cutoff>clock_timestamp() or cutoff>=v_paid_through then
    raise exception 'Verified refund did not apply an immediate cutoff: %',result;
  end if;
  select access.revision into strict refund_access_revision
    from public.billing_account_access access
    join public.account_plans plan on plan.subject_user_id=access.subject_user_id and plan.revision=access.account_plan_revision
    join public.effective_feature_entitlements entitlement on entitlement.subject_user_id=access.subject_user_id
      and entitlement.feature_key='classrooms.create' and entitlement.revision=access.entitlement_revision
    where access.subject_user_id=teacher and access.subscription_id=subscription and access.offering_version_id=offering_id
      and access.end_reason='refund' and access.access_ends_at=cutoff and access.expiry_applied_at>=cutoff
      and access.last_paid_invoice_id=stripe_invoice and access.paid_period_start=v_period_start and access.paid_through=v_paid_through
      and plan.plan_key='free' and plan.management_source='billing' and not entitlement.enabled and entitlement.quota_limit=0;
  if not exists(select 1 from public.stripe_billing_subscription_bindings where id=subscription and not is_current
      and terminal_confirmed_at is not null and obligations_cleared_at is not null
      and lease_token is null and lease_expires_at is null and next_reconcile_at is null)
    or (select to_jsonb(effect) from public.stripe_billing_invoice_effects effect where effect.id=original_effect_id)
      is distinct from invoice_before
    or not exists(select 1 from private.billing_live_full_refunds where invoice_effect_id=original_effect_id
      and operation_id=operation and stripe_charge_id='ch_Refund328' and stripe_refund_ids=array['re_Refund328A','re_Refund328B']
      and currency='cad' and gross_amount=6215 and access_ended_at=cutoff)
    or not exists(select 1 from public.billing_lifecycle_audit where operation_id=operation and reason='subscription_refunded'
      and subject_user_id=teacher and subscription_id=subscription) then
    raise exception 'Refund lost terminal custody, paid receipt, or reversal audit';
  end if;

  result:=public.billing_get_live_access_status_v1(project,account,jsonb_build_object('subject_user_id',teacher));
  if result->>'state' is distinct from 'free' or result->>'can_start_paid_work' is distinct from 'false'
    or (result->>'access_ends_at')::timestamptz is distinct from cutoff then
    raise exception 'Customer status did not report the refund cutoff: %',result;
  end if;
  if not exists(select 1 from private.billing_classroom_restrictions
      where subject_user_id=teacher and classroom_id=classroom and restricted_at=cutoff and restored_at is null)
    or not exists(select 1 from public.classrooms where id=classroom and archived_at is null)
    or (select count(*) from public.classroom_enrollments where classroom_id=classroom)<>2 then
    raise exception 'Refund did not preserve the classroom separately from its billing restriction';
  end if;

  begin
    perform public.release_assignment_for_owner_v1(teacher,draft_assignment,clock_timestamp(),false);
    raise exception 'Refunded teacher could publish an assignment';
  exception when sqlstate 'PT403' then
    if sqlerrm<>'billing_classroom_new_work_unavailable' then raise; end if;
  end;
  begin
    perform public.start_test_attempt_revision_atomic(fixture_test,late_learner);
    raise exception 'New Test Start succeeded after refund';
  exception when sqlstate 'PT403' then
    if sqlerrm<>'billing_classroom_new_work_unavailable' then raise; end if;
  end;
  if not exists(select 1 from public.assignments where id=draft_assignment and is_draft)
    or exists(select 1 from public.test_attempts attempt where attempt.test_id=fixture_test and student_id=late_learner) then
    raise exception 'Refund admission rejection left partial student or publication work';
  end if;

  result:=public.start_test_attempt_revision_atomic(fixture_test,learner);
  if result->>'created' is distinct from 'false' or (result#>>'{attempt,id}')::uuid is distinct from test_attempt then
    raise exception 'Refund blocked or replaced a pre-cutoff attempt';
  end if;
  draft_revision:=(result#>>'{attempt,draft_revision}')::bigint;
  answers:=jsonb_build_object(question_id::text,jsonb_build_object('question_type','multiple_choice','selected_option',1));
  result:=public.save_test_attempt_revision_atomic(fixture_test,learner,answers,draft_revision);
  result:=public.submit_test_attempt_revision_atomic(fixture_test,learner,answers,
    (result#>>'{attempt,draft_revision}')::bigint,clock_timestamp());
  if (result->>'attempt_id')::uuid is distinct from test_attempt
    or not exists(select 1 from public.test_attempts where id=test_attempt and is_submitted) then
    raise exception 'Refund blocked saving or submitting a pre-cutoff attempt';
  end if;

  result:=public.open_assignment_doc_for_member_v1(learner,published_assignment,clock_timestamp(),null);
  if result#>>'{doc,student_id}' is distinct from learner::text then raise exception 'Refund hid a published assignment'; end if;
  result:=public.submit_assignment_doc_for_member_v1(learner,published_assignment,retained_work,
    (result#>>'{doc,updated_at}')::timestamptz,3,21,'{}'::uuid[],false,null);
  if result#>>'{doc,is_submitted}' is distinct from 'true' then raise exception 'Refund blocked submitting published work'; end if;

  if not exists(select 1 from private.billing_scheduled_plan_changes where id=schedule_operation
      and state='canceled' and provider_schedule_id='sub_sched_Refund328')
    or not exists(select 1 from private.billing_live_scheduled_cancellations where id=cancel_operation
      and state='abandoned' and next_attempt_at is null)
    or public.billing_list_live_scheduled_cancellations_v1(project,account,'{"limit":5}') is distinct from '[]'::jsonb then
    raise exception 'Refund left a canceled subscription in the scheduled mutation queue';
  end if;

  result:=public.billing_finish_live_lifecycle_v1(project,account,delayed_paid_observation);
  if result->>'status' is distinct from 'rejected' then raise exception 'A delayed paid claim survived refund retirement: %',result; end if;
  result:=public.billing_apply_live_full_refund_v1(project,account,
    request||jsonb_build_object('refund_ids',jsonb_build_array('re_Refund328A','re_Refund328B')));
  if result->>'status' is distinct from 'replayed' or (result->>'access_ended_at')::timestamptz is distinct from cutoff
    or (select revision from public.billing_account_access where subject_user_id=teacher) is distinct from refund_access_revision
    or (select count(*) from public.billing_lifecycle_audit where subscription_id=subscription and reason='subscription_refunded')<>1
    or (select count(*) from private.billing_live_full_refunds)<>1 then
    raise exception 'Refund replay changed the cutoff, revision, or durable history';
  end if;
  begin
    perform public.billing_apply_live_full_refund_v1(project,account,request||'{"charge_id":"ch_Wrong328"}');
    raise exception 'Refund replay accepted conflicting charge evidence';
  exception when unique_violation then
    if sqlerrm<>'billing_full_refund_evidence_conflict' then raise; end if;
  end;
end;
$$;

rollback;
