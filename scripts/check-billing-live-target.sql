-- Run only on an owned disposable replay through migration 311. All fixtures roll back.
begin;
set local statement_timeout = '30s';
set local lock_timeout = '3s';

do $$
declare
  v_legacy_teacher uuid := gen_random_uuid();
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(v_role, 'private.stripe_billing_settings', 'SELECT, INSERT, UPDATE, DELETE')
      or has_column_privilege(v_role, 'private.stripe_billing_settings', 'live_stripe_account', 'SELECT, INSERT, UPDATE')
      or has_column_privilege(v_role, 'private.stripe_billing_settings', 'live_project_ref', 'SELECT, INSERT, UPDATE')
      or has_function_privilege(v_role, 'public.billing_attest_live_target_v1(text,text)', 'EXECUTE')
        is distinct from (v_role = 'service_role') then
      raise exception 'Live target authority does not match the service-only contract';
    end if;
  end loop;
  if not (select relrowsecurity from pg_catalog.pg_class
          where oid = 'private.stripe_billing_settings'::regclass) then
    raise exception 'Private settings RLS is missing';
  end if;
  if not exists (
    select 1 from private.stripe_billing_settings
    where singleton and not sandbox_enabled and live_project_ref is null and live_stripe_account is null
  ) or public.billing_attest_live_target_v1(repeat('a', 20), 'acct_Preflight311') then
    raise exception 'Migration did not leave live target attestation dormant';
  end if;

  begin
    update private.stripe_billing_settings set live_project_ref = repeat('a', 20) where singleton;
    raise exception 'An incomplete live target was accepted';
  exception when check_violation then null;
  end;
  begin
    update private.stripe_billing_settings
      set live_project_ref = 'invalid', live_stripe_account = 'acct_Preflight311' where singleton;
    raise exception 'A malformed live target was accepted';
  exception when check_violation then null;
  end;
  begin
    update private.stripe_billing_settings
      set live_project_ref = repeat('a', 20), live_stripe_account = 'acct_Preflight311', sandbox_enabled = true
      where singleton;
    raise exception 'A mixed sandbox and live target was accepted';
  exception when check_violation then null;
  end;

  insert into public.users (id, email, role)
  values (v_legacy_teacher, 'billing-live-target-311@example.invalid', 'teacher');
  if not exists (select 1 from public.account_plans where subject_user_id = v_legacy_teacher) then
    perform public.set_account_plan_v1(gen_random_uuid(), v_legacy_teacher, 'free', 'test:live-target', 'fixture', 0);
  end if;
  update private.stripe_billing_settings
    set live_project_ref = repeat('a', 20), live_stripe_account = 'acct_Preflight311' where singleton;
  begin
    update private.stripe_billing_settings set sandbox_enabled = true where singleton;
    raise exception 'A configured live target was switched to sandbox mode';
  exception when check_violation then null;
  end;
end;
$$;

set local role service_role;
do $$
begin
  if public.billing_attest_live_target_v1(repeat('a', 20), 'acct_Preflight311') is distinct from true
    or public.billing_attest_live_target_v1(repeat('b', 20), 'acct_Preflight311') is distinct from false
    or public.billing_attest_live_target_v1(repeat('a', 20), 'acct_Foreign311') is distinct from false
    or public.billing_attest_live_target_v1(null, 'acct_Preflight311') is distinct from false then
    raise exception 'Attestation did not require the exact pinned target';
  end if;

  begin
    perform public.billing_register_offering_v1('{}'::jsonb);
    raise exception 'Attestation opened the existing writer';
  exception when sqlstate '55000' then
    if sqlerrm <> 'stripe_billing_sandbox_disabled' then raise; end if;
  end;
end;
$$;
reset role;

do $$
begin
  update private.stripe_billing_settings
    set live_project_ref = null, live_stripe_account = null, sandbox_enabled = true where singleton;
  if public.billing_record_event_v1(jsonb_build_object(
    'stripe_account', 'acct_Sandbox311', 'event_id', 'evt_Proof311', 'payload_hash', repeat('a', 64),
    'event_type', 'invoice.paid', 'event_created_at', clock_timestamp(), 'received_at', clock_timestamp(),
    'payload', jsonb_build_object('object_id', 'in_Proof311')
  ))->>'status' is distinct from 'accepted' then
    raise exception 'Existing sandbox receipt flow changed';
  end if;
  update private.stripe_billing_settings
    set sandbox_enabled = false, live_project_ref = repeat('a', 20), live_stripe_account = 'acct_Preflight311'
    where singleton;
  if public.billing_attest_live_target_v1(repeat('a', 20), 'acct_Preflight311') is distinct from false then
    raise exception 'A database with retained sandbox evidence attested as live';
  end if;
end;
$$;

rollback;
