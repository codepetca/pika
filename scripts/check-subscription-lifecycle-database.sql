begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$ declare fn text; begin
  foreach fn in array array['billing_start_trial_v1','billing_get_access_status_v1','billing_apply_due_access_v1','billing_finish_lifecycle_v1'] loop
    if has_function_privilege('anon','public.'||fn||'(jsonb)','execute')
      or has_function_privilege('authenticated','public.'||fn||'(jsonb)','execute')
      or not has_function_privilege('service_role','public.'||fn||'(jsonb)','execute') then raise exception 'Lifecycle RPC ACL drift: %',fn; end if;
  end loop;
  if has_function_privilege('service_role','private.billing_write_access_v1(uuid,bigint,text)','execute')
    or has_function_privilege('service_role','private.billing_finish_subscription_foundation_v1(jsonb)','execute')
    or has_table_privilege('service_role','public.billing_trials','insert')
    or has_table_privilege('authenticated','public.billing_account_access','select') then raise exception 'Lifecycle private boundary exposed'; end if;
end $$;
update private.stripe_billing_settings set sandbox_enabled=true where singleton;
insert into public.users(id,email,role) values
 ('f2140000-0000-4000-8000-000000000001','lifecycle-trial@example.invalid','teacher'),
 ('f2140000-0000-4000-8000-000000000002','lifecycle-paid@example.invalid','teacher'),
 ('f2140000-0000-4000-8000-000000000003','lifecycle-student@example.invalid','student');
do $$ declare u uuid; begin
  foreach u in array array['f2140000-0000-4000-8000-000000000001'::uuid,'f2140000-0000-4000-8000-000000000002'::uuid,'f2140000-0000-4000-8000-000000000003'::uuid] loop
    if not exists(select 1 from public.account_plans where subject_user_id=u) then
      perform public.set_account_plan_v1(gen_random_uuid(),u,'free','test:lifecycle','fixture',0);
    end if;
  end loop;
end $$;
set local role service_role;
do $$ declare r jsonb; before_revision bigint; begin
  r:=public.billing_start_trial_v1('{"subject_user_id":"f2140000-0000-4000-8000-000000000001","operation_id":"f2141000-0000-4000-8000-000000000001"}');
  if r->>'state'<>'trial' or (r->>'classroom_limit')::int<>5 or not (r->>'can_start_paid_work')::boolean then raise exception 'Trial grant failed'; end if;
  select revision into before_revision from public.account_plans where subject_user_id='f2140000-0000-4000-8000-000000000001';
  perform public.billing_start_trial_v1('{"subject_user_id":"f2140000-0000-4000-8000-000000000001","operation_id":"f2141000-0000-4000-8000-000000000001"}');
  if before_revision<>(select revision from public.account_plans where subject_user_id='f2140000-0000-4000-8000-000000000001') then raise exception 'Trial replay rewrote plan'; end if;
  if not exists(select 1 from public.billing_trials where subject_user_id='f2140000-0000-4000-8000-000000000001' and ends_at-started_at=interval '720 hours') then raise exception 'Trial duration drift'; end if;
  if not exists(select 1 from public.effective_feature_entitlements where subject_user_id='f2140000-0000-4000-8000-000000000001' and source='trial' and expires_at is not null and quota_limit=5) then raise exception 'Trial is unbounded'; end if;
  begin
    perform public.billing_start_trial_v1(jsonb_build_object('subject_user_id','f2140000-0000-4000-8000-000000000001','operation_id',gen_random_uuid()));
    raise exception 'Second trial accepted';
  exception when object_not_in_prerequisite_state then if sqlerrm<>'billing_trial_ineligible' then raise; end if; end;
  begin
    perform public.billing_start_trial_v1(jsonb_build_object('subject_user_id','f2140000-0000-4000-8000-000000000003','operation_id',gen_random_uuid()));
    raise exception 'Student trial accepted';
  exception when object_not_in_prerequisite_state then if sqlerrm<>'billing_trial_ineligible' then raise; end if; end;
end $$;
reset role;
-- Move only transaction-local fixtures to an elapsed boundary; no trusted API accepts a clock.
with timing as materialized (select clock_timestamp() as t)
update public.billing_trials set started_at=timing.t-interval '721 hours',ends_at=timing.t-interval '1 hour' from timing
  where subject_user_id='f2140000-0000-4000-8000-000000000001';
update public.billing_account_access set starts_at=clock_timestamp()-interval '721 hours',access_ends_at=clock_timestamp()-interval '1 hour'
  where subject_user_id='f2140000-0000-4000-8000-000000000001';
set local role service_role;
do $$ declare r jsonb; revision_after bigint; begin
  r:=public.billing_get_access_status_v1('{"subject_user_id":"f2140000-0000-4000-8000-000000000001"}');
  if r->>'state'<>'free' or (r->>'can_start_paid_work')::boolean then raise exception 'Trial cutoff depends on worker'; end if;
  perform public.billing_apply_due_access_v1('{"limit":100}');
  select revision into revision_after from public.account_plans where subject_user_id='f2140000-0000-4000-8000-000000000001';
  perform public.billing_apply_due_access_v1('{"limit":100}');
  if revision_after<>(select revision from public.account_plans where subject_user_id='f2140000-0000-4000-8000-000000000001') then raise exception 'Expiry replay rewrote plan'; end if;
end $$;
reset role;
-- Fixture-only immutable catalog registration, independent of current advertised versions.
set local role service_role;
do $$ declare offering jsonb; binding jsonb; c jsonb; r jsonb; v_id uuid; p_end timestamptz:=clock_timestamp()+interval '24 hours';
  request jsonb; revision_after bigint; begin
  offering:=public.billing_register_offering_v1(jsonb_build_object('plan_key','plus','version',9214,'stripe_account','acct_lifecycle214','provider_mode','test',
    'stripe_product_id','prod_lifecycle214','stripe_price_id','price_lifecycle214','currency','usd','unit_amount',1900,'interval','month',
    'classroom_limit',7,'features','{}'::jsonb,'ai_definition',null,'availability',jsonb_build_object('is_available',true)));
  binding:=public.billing_bind_customer_v1(jsonb_build_object('subject_user_id','f2140000-0000-4000-8000-000000000002',
    'stripe_account','acct_lifecycle214','provider_mode','test','stripe_price_id','price_lifecycle214','stripe_customer_id','cus_lifecycle214','stripe_subscription_id','sub_lifecycle214','offering_version_id',offering->>'offering_version_id'));
  v_id:=(binding->>'subscription_id')::uuid;
  c:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_id,'lease_seconds',120));
  request:=jsonb_build_object('subscription_id',v_id,'lease_token',c->>'lease_token','fencing_token',c->'fencing_token',
    'expected_subscription_revision',c->'subscription_revision','expected_account_plan_revision',c->'expected_account_plan_revision',
    'outcome','paid','event_inbox_id',null,'invoice_id','in_lifecycle214first','period_start',p_end-interval '30 days','period_end',p_end,
    'reason_code',null,'provider_status','active','cancel_at_period_end',false,'obligations_cleared',false);
  r:=public.billing_finish_lifecycle_v1(request);
  if r->>'status'<>'applied' then raise exception 'First paid apply failed: %',r; end if;
  if not exists(select 1 from public.effective_feature_entitlements where subject_user_id='f2140000-0000-4000-8000-000000000002' and quota_limit=7 and expires_at=p_end) then raise exception 'Purchased version or finite expiry lost'; end if;
  select revision into revision_after from public.account_plans where subject_user_id='f2140000-0000-4000-8000-000000000002';
  c:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_id,'lease_seconds',120));
  request:=request||jsonb_build_object('lease_token',c->>'lease_token','fencing_token',c->'fencing_token','expected_subscription_revision',c->'subscription_revision','expected_account_plan_revision',c->'expected_account_plan_revision');
  r:=public.billing_finish_lifecycle_v1(request);
  if r->>'status'<>'replayed' or revision_after<>(select revision from public.account_plans where subject_user_id='f2140000-0000-4000-8000-000000000002') then raise exception 'Invoice replay changed access'; end if;
  c:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_id,'lease_seconds',120));
  request:=request||jsonb_build_object('lease_token',c->>'lease_token','fencing_token',c->'fencing_token','expected_subscription_revision',c->'subscription_revision','expected_account_plan_revision',c->'expected_account_plan_revision',
    'outcome','renewal_failed','invoice_id','in_lifecycle214renew','period_start',p_end,'period_end',p_end+interval '30 days','provider_status','past_due');
  r:=public.billing_finish_lifecycle_v1(request);
  if r->>'status'<>'applied' or not exists(select 1 from public.billing_account_access where subject_user_id='f2140000-0000-4000-8000-000000000002' and end_reason='renewal_grace' and access_ends_at=p_end+interval '168 hours') then raise exception 'Grace did not anchor to paid term'; end if;
  -- An old fenced worker cannot undo the grace transition.
  if public.billing_finish_lifecycle_v1(request)->>'status'<>'lost_claim' then raise exception 'Stale worker accepted'; end if;
end $$;
reset role;
-- Paid conversion consumes the once-only trial even when its original term expired.
set local role service_role;
do $$ declare c jsonb; binding jsonb; v_version uuid; v_sub uuid; r jsonb; v_end timestamptz:=clock_timestamp()+interval '30 days'; begin
  select id into v_version from public.stripe_billing_offering_versions where stripe_price_id='price_lifecycle214';
  binding:=public.billing_bind_customer_v1(jsonb_build_object('subject_user_id','f2140000-0000-4000-8000-000000000001',
    'stripe_account','acct_lifecycle214','provider_mode','test','stripe_price_id','price_lifecycle214',
    'stripe_customer_id','cus_lifecycle214trial','stripe_subscription_id','sub_lifecycle214trial','offering_version_id',v_version));
  v_sub:=(binding->>'subscription_id')::uuid;
  c:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_sub,'lease_seconds',120));
  r:=public.billing_finish_lifecycle_v1(jsonb_build_object('subscription_id',v_sub,'lease_token',c->>'lease_token','fencing_token',c->'fencing_token',
    'expected_subscription_revision',c->'subscription_revision','expected_account_plan_revision',c->'expected_account_plan_revision',
    'outcome','paid','invoice_id','in_lifecycle214conversion','period_start',v_end-interval '30 days','period_end',v_end,
    'provider_status','active','cancel_at_period_end',false,'obligations_cleared',false));
  if r->>'status'<>'applied' or not exists(select 1 from public.billing_trials where subject_user_id='f2140000-0000-4000-8000-000000000001' and converted_to_paid_at is not null) then raise exception 'Trial conversion failed'; end if;
  c:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_sub,'lease_seconds',120));
  r:=public.billing_finish_lifecycle_v1(jsonb_build_object('subscription_id',v_sub,'lease_token',c->>'lease_token','fencing_token',c->'fencing_token',
    'expected_subscription_revision',c->'subscription_revision','expected_account_plan_revision',c->'expected_account_plan_revision',
    'outcome','canceled','provider_status','canceled','cancel_at_period_end',true,'obligations_cleared',true));
  if r->>'status'<>'applied' or not exists(select 1 from public.billing_account_access where subject_user_id='f2140000-0000-4000-8000-000000000001' and access_ends_at=v_end and end_reason='cancellation') then raise exception 'Cancellation changed paid-through'; end if;
  if not exists(select 1 from public.stripe_billing_subscription_bindings where id=v_sub and is_current) then raise exception 'Binding retired before access ends'; end if;
end $$;
reset role;
-- Shift only this fixture's exact paid period to prove request-time expiry and later retirement.
update public.billing_account_access set starts_at=clock_timestamp()-interval '31 days',paid_period_start=clock_timestamp()-interval '31 days',
  paid_through=clock_timestamp()-interval '1 day',access_ends_at=clock_timestamp()-interval '1 day'
  where subject_user_id='f2140000-0000-4000-8000-000000000001';
set local role service_role;
do $$ declare c jsonb; v_sub uuid; r jsonb; work jsonb; begin
  r:=public.billing_get_access_status_v1('{"subject_user_id":"f2140000-0000-4000-8000-000000000001"}');
  if r->>'state'<>'free' then raise exception 'Known cancellation requires worker for cutoff'; end if;
  perform public.billing_apply_due_access_v1('{"limit":100}');
  select id into v_sub from public.stripe_billing_subscription_bindings where stripe_subscription_id='sub_lifecycle214trial';
  c:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_sub,'lease_seconds',120));
  r:=public.billing_finish_lifecycle_v1(jsonb_build_object('subscription_id',v_sub,'lease_token',c->>'lease_token','fencing_token',c->'fencing_token',
    'expected_subscription_revision',c->'subscription_revision','expected_account_plan_revision',c->'expected_account_plan_revision',
    'outcome','canceled','provider_status','canceled','cancel_at_period_end',true,'obligations_cleared',true));
  if r->>'status'<>'applied' or exists(select 1 from public.stripe_billing_subscription_bindings where id=v_sub and is_current) then raise exception 'Cleared terminal binding not retired'; end if;
  if public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_sub,'lease_seconds',120))->>'status'<>'not_found' then raise exception 'Old binding still claimable'; end if;
  work:=public.billing_list_work_v1('{"limit":50}');
  if exists(select 1 from jsonb_array_elements(work->'items') item where item->>'subscription_id'=v_sub::text) then raise exception 'Old binding monopolizes worker'; end if;
  -- No trial can be revived after paid access ends.
  begin
    perform public.billing_start_trial_v1(jsonb_build_object('subject_user_id','f2140000-0000-4000-8000-000000000001','operation_id',gen_random_uuid()));
    raise exception 'Trial eligibility reset after payment';
  exception when object_not_in_prerequisite_state then if sqlerrm<>'billing_trial_ineligible' then raise; end if; end;
end $$;
reset role;

-- Checkout completion follows current access after a lifecycle revision, not
-- the original invoice effect revision. This fixture already entered grace.
insert into public.stripe_checkout_attempts(id,subject_user_id,offering_version_id,lookup_key,request_fingerprint,
  success_url,cancel_url,status,subscription_id,reserved_plan_revision)
select 'f2142000-0000-4000-8000-000000000001',b.subject_user_id,b.offering_version_id,'lifecycle-status-fixture',repeat('a',64),
  'http://localhost:3000/billing','http://localhost:3000/billing','bound',b.id,p.revision
from public.stripe_billing_subscription_bindings b join public.account_plans p on p.subject_user_id=b.subject_user_id
where b.stripe_subscription_id='sub_lifecycle214';
set local role service_role;
do $$ declare r jsonb; begin
  r:=public.billing_get_checkout_v1('{"subject_user_id":"f2140000-0000-4000-8000-000000000002","attempt_id":"f2142000-0000-4000-8000-000000000001"}');
  if (r->>'access_confirmed')::boolean is distinct from true then raise exception 'Lifecycle revision invalidated paid checkout status'; end if;
end $$;
reset role;

-- Account-plan and entitlement revisions independently protect operator changes.
do $$ declare c jsonb; b uuid; r jsonb; before_quota bigint; begin
  select id into b from public.stripe_billing_subscription_bindings where stripe_subscription_id='sub_lifecycle214';
  c:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',b,'lease_seconds',120));
  update public.account_plans set revision=revision+1,plan_key='basic',management_source='legacy',billing_offering_version_id=null where subject_user_id='f2140000-0000-4000-8000-000000000002';
  r:=public.billing_finish_lifecycle_v1(jsonb_build_object('subscription_id',b,'lease_token',c->>'lease_token','fencing_token',c->'fencing_token',
    'expected_subscription_revision',c->'subscription_revision','expected_account_plan_revision',c->'expected_account_plan_revision','outcome','canceled','provider_status','canceled'));
  if r->>'status'<>'plan_conflict' then raise exception 'Manual plan overwrite allowed'; end if;
  r:=public.billing_get_access_status_v1('{"subject_user_id":"f2140000-0000-4000-8000-000000000002"}');
  if r->>'plan_key'<>'basic' or r->>'state'<>'unmanaged' then raise exception 'Status hides actual operator assignment'; end if;
  r:=public.billing_get_checkout_v1('{"subject_user_id":"f2140000-0000-4000-8000-000000000002","attempt_id":"f2142000-0000-4000-8000-000000000001"}');
  if (r->>'access_confirmed')::boolean is distinct from false then raise exception 'Checkout status ignores operator override'; end if;
end $$;
rollback;
