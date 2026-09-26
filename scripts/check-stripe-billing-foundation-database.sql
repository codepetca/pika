begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $privileges$
declare
  v_rpc text;
begin
  foreach v_rpc in array array[
    'public.billing_record_event_v1(jsonb)',
    'public.billing_list_work_v1(jsonb)',
    'public.billing_claim_subscription_v1(jsonb)',
    'public.billing_finish_subscription_v1(jsonb)',
    'public.billing_fail_subscription_v1(jsonb)'
  ] loop
    if to_regprocedure(v_rpc) is null
      or has_function_privilege('anon', v_rpc, 'execute')
      or has_function_privilege('authenticated', v_rpc, 'execute')
      or not has_function_privilege('service_role', v_rpc, 'execute') then
      raise exception 'Stripe billing RPC privileges are incorrect: %', v_rpc;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.stripe_billing_event_inbox', 'select')
    or has_table_privilege('authenticated', 'public.stripe_billing_subscription_bindings', 'select')
    or has_table_privilege('service_role', 'public.stripe_billing_event_inbox', 'insert')
    or not has_table_privilege('service_role', 'public.stripe_billing_event_inbox', 'select') then
    raise exception 'Stripe billing table privileges are incorrect';
  end if;
end;
$privileges$;

-- The private, test-only gate refuses every write before fixtures opt in.
set local role service_role;
do $gate$
begin
  begin
    perform public.billing_record_event_v1(jsonb_build_object(
      'stripe_account', 'acct_b209gate', 'event_id', 'evt_b209gate',
      'payload_hash', repeat('a', 64), 'event_type', 'invoice.paid',
      'payload', jsonb_build_object('object_id', 'in_b209gate', 'customer_id', null, 'subscription_id', null),
      'received_at', clock_timestamp()
    ));
    raise exception 'Disabled billing gate accepted an event';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'stripe_billing_sandbox_disabled' then raise; end if;
  end;
end;
$gate$;
reset role;

update private.stripe_billing_settings set sandbox_enabled = true where singleton;

insert into public.users (id, email, role) values
  ('f2090000-0000-4000-8000-000000000001', 'billing-209@example.invalid', 'teacher'),
  ('f2090000-0000-4000-8000-000000000002', 'billing-new-209@example.invalid', 'teacher'),
  ('f2090000-0000-4000-8000-000000000003', 'billing-manual-209@example.invalid', 'teacher');

set local role service_role;

do $plans$
declare
  v_subject uuid;
begin
  foreach v_subject in array array[
    'f2090000-0000-4000-8000-000000000001'::uuid,
    'f2090000-0000-4000-8000-000000000002'::uuid,
    'f2090000-0000-4000-8000-000000000003'::uuid
  ] loop
    if not exists (select 1 from public.account_plans where subject_user_id=v_subject) then
      perform public.set_account_plan_v1(gen_random_uuid(), v_subject, 'free', 'test:migration-209', 'fixture_free_plan', 0);
    end if;
  end loop;
end;
$plans$;

do $catalog$
declare
  v_old jsonb;
  v_new jsonb;
begin
  v_old := public.billing_register_offering_v1(jsonb_build_object(
    'plan_key', 'plus', 'version', 1, 'stripe_account', 'acct_b209test', 'provider_mode', 'test',
    'stripe_product_id', 'prod_b209plus', 'stripe_price_id', 'price_b209plusold',
    'currency', 'cad', 'unit_amount', 2000, 'interval', 'month', 'classroom_limit', 7,
    'features', jsonb_build_object('classrooms', true), 'ai_definition', null,
    'availability', jsonb_build_object('is_available', true)
  ));
  v_new := public.billing_register_offering_v1(jsonb_build_object(
    'plan_key', 'plus', 'version', 2, 'stripe_account', 'acct_b209test', 'provider_mode', 'test',
    'stripe_product_id', 'prod_b209plus', 'stripe_price_id', 'price_b209plusnew',
    'currency', 'cad', 'unit_amount', 2500, 'interval', 'month', 'classroom_limit', 9,
    'features', jsonb_build_object('classrooms', true, 'future', true), 'ai_definition', jsonb_build_object('included', 0),
    'availability', jsonb_build_object('is_available', true)
  ));
  if v_old->>'offering_id' <> v_new->>'offering_id'
    or v_old->>'offering_version_id' = v_new->>'offering_version_id' then
    raise exception 'Offering version identity is not stable';
  end if;
  perform public.billing_bind_customer_v1(jsonb_build_object(
    'subject_user_id', 'f2090000-0000-4000-8000-000000000001', 'stripe_account', 'acct_b209test',
    'provider_mode', 'test', 'stripe_customer_id', 'cus_b209customer', 'stripe_subscription_id', 'sub_b209subscription',
    'stripe_price_id', 'price_b209plusold', 'offering_version_id', v_old->>'offering_version_id'
  ));
  perform public.billing_bind_customer_v1(jsonb_build_object(
    'subject_user_id', 'f2090000-0000-4000-8000-000000000002', 'stripe_account', 'acct_b209test',
    'provider_mode', 'test', 'stripe_customer_id', 'cus_b209new', 'stripe_subscription_id', 'sub_b209new',
    'stripe_price_id', 'price_b209plusnew', 'offering_version_id', v_new->>'offering_version_id'
  ));
end;
$catalog$;

reset role;
do $catalog_immutability$
declare v_version uuid;
begin
  select id into v_version from public.stripe_billing_offering_versions where stripe_price_id='price_b209plusnew';
  begin
    update public.stripe_billing_offering_versions set unit_amount=2600 where id=v_version;
    raise exception 'Immutable offering version accepted an update';
  exception when insufficient_privilege then
    if sqlerrm <> 'stripe_billing_immutable_record' then raise; end if;
  end;
  update public.stripe_billing_offering_availability set is_available=false where offering_version_id=v_version;
  if exists (select 1 from public.stripe_billing_offering_availability where offering_version_id=v_version and is_available) then
    raise exception 'Availability did not remain independently mutable';
  end if;
end;
$catalog_immutability$;
set local role service_role;

do $events$
declare
  v_first jsonb;
  v_duplicate jsonb;
begin
  v_first := public.billing_record_event_v1(jsonb_build_object(
    'stripe_account', 'acct_b209test', 'event_id', 'evt_b209paid', 'payload_hash', repeat('b', 64),
    'event_type', 'invoice.paid', 'payload', jsonb_build_object('object_id', 'in_b209paid', 'customer_id', 'cus_b209customer', 'subscription_id', 'sub_b209subscription'),
    'received_at', clock_timestamp()
  ));
  v_duplicate := public.billing_record_event_v1(jsonb_build_object(
    'stripe_account', 'acct_b209test', 'event_id', 'evt_b209paid', 'payload_hash', repeat('b', 64),
    'event_type', 'invoice.paid', 'payload', jsonb_build_object('object_id', 'in_b209paid', 'customer_id', 'cus_b209customer', 'subscription_id', 'sub_b209subscription'),
    'received_at', clock_timestamp()
  ));
  if v_first->>'status' <> 'accepted' or v_duplicate->>'status' <> 'duplicate'
    or v_first->>'event_inbox_id' <> v_duplicate->>'event_inbox_id' then
    raise exception 'Event inbox is not idempotent';
  end if;
  begin
    perform public.billing_record_event_v1(jsonb_build_object(
      'stripe_account', 'acct_b209test', 'event_id', 'evt_b209paid', 'payload_hash', repeat('c', 64),
      'event_type', 'invoice.paid', 'payload', jsonb_build_object('object_id', 'in_b209paid', 'customer_id', 'cus_b209customer', 'subscription_id', 'sub_b209subscription'),
      'received_at', clock_timestamp()
    ));
    raise exception 'Conflicting event was accepted';
  exception when unique_violation then
    if sqlerrm <> 'stripe_billing_event_conflict' then raise; end if;
  end;
end;
$events$;

do $new_version_paid$
declare v_subscription uuid; v_claim jsonb; v_result jsonb;
begin
  select id into v_subscription from public.stripe_billing_subscription_bindings where stripe_subscription_id='sub_b209new';
  v_claim := public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_subscription,'lease_seconds',30));
  v_result := public.billing_finish_subscription_v1(jsonb_build_object(
    'subscription_id',v_subscription,'lease_token',v_claim->>'lease_token','fencing_token',v_claim->>'fencing_token',
    'expected_subscription_revision',v_claim->>'subscription_revision','expected_account_plan_revision',v_claim->>'expected_account_plan_revision',
    'outcome','paid','event_inbox_id',null,'invoice_id','in_b209new','period_start','2026-01-01T00:00:00Z','period_end','2026-02-01T00:00:00Z','reason_code',null
  ));
  if v_result->>'status' <> 'applied' or not exists (select 1 from public.effective_feature_entitlements where subject_user_id='f2090000-0000-4000-8000-000000000002' and feature_key='classrooms.create' and quota_limit=9) then
    raise exception 'New offering version did not retain its independent purchased limit';
  end if;
end;
$new_version_paid$;

do $paid$
declare
  v_subscription uuid;
  v_event uuid;
  v_claim jsonb;
  v_lost jsonb;
  v_paid jsonb;
  v_replay_claim jsonb;
  v_replay jsonb;
  v_exception_claim jsonb;
  v_exception jsonb;
  v_manual_operation uuid := gen_random_uuid();
  v_manual jsonb;
begin
  select id into v_subscription from public.stripe_billing_subscription_bindings where stripe_subscription_id = 'sub_b209subscription';
  select id into v_event from public.stripe_billing_event_inbox where stripe_event_id = 'evt_b209paid';
  v_claim := public.billing_claim_subscription_v1(jsonb_build_object('subscription_id', v_subscription, 'lease_seconds', 30));
  if v_claim->>'status' <> 'claimed' or (v_claim->'binding'->>'classroom_limit') is not null then
    raise exception 'Claim did not return the normalized binding contract';
  end if;
  v_lost := public.billing_finish_subscription_v1(jsonb_build_object(
    'subscription_id', v_subscription, 'lease_token', v_claim->>'lease_token', 'fencing_token', (v_claim->>'fencing_token')::bigint + 1,
    'expected_subscription_revision', v_claim->>'subscription_revision', 'expected_account_plan_revision', v_claim->>'expected_account_plan_revision',
    'outcome', 'exception', 'event_inbox_id', v_event, 'invoice_id', null, 'period_start', null, 'period_end', null, 'reason_code', 'invoice_not_paid'
  ));
  if v_lost->>'status' <> 'lost_claim' then raise exception 'Stale lease fence was accepted'; end if;
  v_paid := public.billing_finish_subscription_v1(jsonb_build_object(
    'subscription_id', v_subscription, 'lease_token', v_claim->>'lease_token', 'fencing_token', v_claim->>'fencing_token',
    'expected_subscription_revision', v_claim->>'subscription_revision', 'expected_account_plan_revision', v_claim->>'expected_account_plan_revision',
    'outcome', 'paid', 'event_inbox_id', v_event, 'invoice_id', 'in_b209paid',
    'period_start', '2026-01-01T00:00:00Z', 'period_end', '2026-02-01T00:00:00Z', 'reason_code', null
  ));
  if v_paid->>'status' <> 'applied'
    or not exists (select 1 from public.account_plans where subject_user_id='f2090000-0000-4000-8000-000000000001' and plan_key='plus' and management_source='billing')
    or not exists (select 1 from public.effective_feature_entitlements where subject_user_id='f2090000-0000-4000-8000-000000000001' and feature_key='classrooms.create' and quota_limit=7)
    or not exists (select 1 from public.stripe_billing_subscription_bindings where id=v_subscription and last_period_end='2026-02-01T00:00:00Z'::timestamptz) then
    raise exception 'Paid effect did not atomically use the stored old offering';
  end if;
  v_replay_claim := public.billing_claim_subscription_v1(jsonb_build_object('subscription_id', v_subscription, 'lease_seconds', 30));
  v_replay := public.billing_finish_subscription_v1(jsonb_build_object(
    'subscription_id', v_subscription, 'lease_token', v_replay_claim->>'lease_token', 'fencing_token', v_replay_claim->>'fencing_token',
    'expected_subscription_revision', v_replay_claim->>'subscription_revision', 'expected_account_plan_revision', v_replay_claim->>'expected_account_plan_revision',
    'outcome', 'paid', 'event_inbox_id', null, 'invoice_id', 'in_b209paid',
    'period_start', '2026-01-01T00:00:00Z', 'period_end', '2026-02-01T00:00:00Z', 'reason_code', null
  ));
  if v_replay->>'status' <> 'replayed' then raise exception 'Invoice effect was not idempotent'; end if;
  v_exception_claim := public.billing_claim_subscription_v1(jsonb_build_object('subscription_id', v_subscription, 'lease_seconds', 30));
  v_exception := public.billing_finish_subscription_v1(jsonb_build_object(
    'subscription_id', v_subscription, 'lease_token', v_exception_claim->>'lease_token', 'fencing_token', v_exception_claim->>'fencing_token',
    'expected_subscription_revision', v_exception_claim->>'subscription_revision', 'expected_account_plan_revision', v_exception_claim->>'expected_account_plan_revision',
    'outcome', 'exception', 'event_inbox_id', null, 'invoice_id', null, 'period_start', null, 'period_end', null, 'reason_code', 'invoice_not_paid'
  ));
  if v_exception->>'status' <> 'applied'
    or not exists (select 1 from public.account_plans where subject_user_id='f2090000-0000-4000-8000-000000000001' and plan_key='plus' and management_source='billing')
    or not exists (select 1 from public.effective_feature_entitlements where subject_user_id='f2090000-0000-4000-8000-000000000001' and feature_key='classrooms.create' and quota_limit=7) then
    raise exception 'Unapproved payment state changed prior access';
  end if;
  begin
    perform public.set_account_plan_v1(gen_random_uuid(), 'f2090000-0000-4000-8000-000000000001', 'free', 'test:migration-209', 'manual_change', (select revision from public.account_plans where subject_user_id='f2090000-0000-4000-8000-000000000001'));
    raise exception 'Legacy writer changed billing-managed account';
  exception when insufficient_privilege then
    if sqlerrm <> 'billing_managed_account_plan' then raise; end if;
  end;
  v_manual := public.set_account_plan_v1(v_manual_operation, 'f2090000-0000-4000-8000-000000000003', 'basic', 'test:migration-209', 'manual_change', (select revision from public.account_plans where subject_user_id='f2090000-0000-4000-8000-000000000003'));
  if v_manual->>'duplicate' <> 'false' or (public.set_account_plan_v1(v_manual_operation, 'f2090000-0000-4000-8000-000000000003', 'basic', 'test:migration-209', 'manual_change', (v_manual->>'revision')::bigint - 1)->>'duplicate') <> 'true' then
    raise exception 'Legacy account plan idempotency regressed';
  end if;
end;
$paid$;

do $fencing$
declare
  v_subscription uuid;
  v_claim jsonb;
  v_request jsonb;
  v_key text;
begin
  select id into v_subscription from public.stripe_billing_subscription_bindings
  where subject_user_id='f2090000-0000-4000-8000-000000000001';
  v_claim := public.billing_claim_subscription_v1(jsonb_build_object(
    'subscription_id',v_subscription,'lease_seconds',30));
  if public.billing_claim_subscription_v1(jsonb_build_object(
    'subscription_id',v_subscription,'lease_seconds',30))->>'status' <> 'busy' then
    raise exception 'A live lease admitted another worker';
  end if;
  v_request := jsonb_build_object(
    'subscription_id',v_subscription,'lease_token',v_claim->>'lease_token',
    'fencing_token',v_claim->>'fencing_token',
    'expected_subscription_revision',v_claim->>'subscription_revision',
    'expected_account_plan_revision',v_claim->>'expected_account_plan_revision',
    'outcome','exception','reason_code','provider_unavailable');
  foreach v_key in array array['fencing_token','expected_subscription_revision','expected_account_plan_revision'] loop
    begin
      perform public.billing_finish_subscription_v1(v_request - v_key);
      raise exception 'Missing revision fence was accepted: %',v_key;
    exception when invalid_parameter_value then
      if sqlerrm <> 'stripe_billing_finish_request_invalid' then raise; end if;
    end;
  end loop;
  perform public.billing_finish_subscription_v1(v_request);
end;
$fencing$;

reset role;

-- Test expiry without sleeping. This fixture-only change rolls back with the test.
do $expired_claim$
declare v_subscription uuid; v_old jsonb; v_new jsonb; v_result jsonb;
begin
  select id into v_subscription from public.stripe_billing_subscription_bindings
  where subject_user_id='f2090000-0000-4000-8000-000000000001';
  v_old := public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_subscription,'lease_seconds',30));
  update public.stripe_billing_subscription_bindings
    set lease_expires_at=clock_timestamp()-interval '1 second' where id=v_subscription;
  v_new := public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_subscription,'lease_seconds',30));
  v_result := public.billing_finish_subscription_v1(jsonb_build_object(
    'subscription_id',v_subscription,'lease_token',v_old->>'lease_token',
    'fencing_token',v_old->>'fencing_token',
    'expected_subscription_revision',v_old->>'subscription_revision',
    'expected_account_plan_revision',v_old->>'expected_account_plan_revision',
    'outcome','exception','reason_code','provider_unavailable'));
  if v_result->>'status' <> 'lost_claim' then raise exception 'Expired worker committed after lease takeover'; end if;
  perform public.billing_finish_subscription_v1(jsonb_build_object(
    'subscription_id',v_subscription,'lease_token',v_new->>'lease_token',
    'fencing_token',v_new->>'fencing_token',
    'expected_subscription_revision',v_new->>'subscription_revision',
    'expected_account_plan_revision',v_new->>'expected_account_plan_revision',
    'outcome','exception','reason_code','provider_unavailable'));
end;
$expired_claim$;

create function pg_temp.fail_billing_audit() returns trigger language plpgsql as $$
begin raise exception 'billing_atomic_test_failure'; end;
$$;
create trigger billing_atomic_test_failure before insert on public.account_plan_audit
for each row when (new.subject_user_id='f2090000-0000-4000-8000-000000000001')
execute function pg_temp.fail_billing_audit();

set local role service_role;
do $atomic_failure$
declare v_subscription uuid; v_claim jsonb; v_plan_revision bigint; v_grant_revision bigint;
begin
  select id into v_subscription from public.stripe_billing_subscription_bindings
  where subject_user_id='f2090000-0000-4000-8000-000000000001';
  select revision into v_plan_revision from public.account_plans
  where subject_user_id='f2090000-0000-4000-8000-000000000001';
  select revision into v_grant_revision from public.effective_feature_entitlements
  where subject_user_id='f2090000-0000-4000-8000-000000000001' and feature_key='classrooms.create';
  v_claim := public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_subscription,'lease_seconds',30));
  begin
    perform public.billing_finish_subscription_v1(jsonb_build_object(
      'subscription_id',v_subscription,'lease_token',v_claim->>'lease_token',
      'fencing_token',v_claim->>'fencing_token',
      'expected_subscription_revision',v_claim->>'subscription_revision',
      'expected_account_plan_revision',v_claim->>'expected_account_plan_revision',
      'outcome','paid','invoice_id','in_b209rollback',
      'period_start','2026-02-01T00:00:00Z','period_end','2026-03-01T00:00:00Z'));
    raise exception 'Injected audit failure was not reached';
  exception when raise_exception then
    if sqlerrm <> 'billing_atomic_test_failure' then raise; end if;
  end;
  if (select revision from public.account_plans where subject_user_id='f2090000-0000-4000-8000-000000000001') <> v_plan_revision
    or (select revision from public.effective_feature_entitlements where subject_user_id='f2090000-0000-4000-8000-000000000001' and feature_key='classrooms.create') <> v_grant_revision
    or exists (select 1 from public.stripe_billing_invoice_effects where stripe_invoice_id='in_b209rollback') then
    raise exception 'Partial billing commit survived audit failure';
  end if;
end;
$atomic_failure$;
reset role;
rollback;
