-- Rollback proof for the scoped live scheduled installation RPCs. No provider calls.
begin;
set local statement_timeout='30s';
set local lock_timeout='3s';

create function pg_temp.live_install_322(p_id uuid,p_action text,p_fence jsonb default null,p_schedule_id text default null)
returns jsonb language sql as $$
  select public.billing_live_scheduled_installation_command_v1('abcdefghijklmnopqrst','acct_Live322',
    jsonb_strip_nulls(jsonb_build_object('operation_id',p_id,'action',p_action,'fence',p_fence,'schedule_id',p_schedule_id)));
$$;

do $$
declare
  v_project text:='abcdefghijklmnopqrst'; v_account text:='acct_Live322'; v_rpc text;
  v_owner uuid:=gen_random_uuid(); v_other uuid:=gen_random_uuid(); v_sandbox_owner uuid:=gen_random_uuid();
  v_attempt uuid:=gen_random_uuid(); v_op uuid:=gen_random_uuid(); v_sandbox_op uuid:=gen_random_uuid();
  v_source uuid; v_target uuid; v_test_target uuid; v_binding uuid; v_test_binding uuid;
  v_through timestamptz:=date_trunc('second',clock_timestamp())+interval '10 days';
  v_start timestamptz:=v_through-interval '30 days';
  v_offering jsonb; v_request jsonb; v_confirmation jsonb; v_checkout_fence jsonb; v_before jsonb;
  v_claim jsonb; v_result jsonb; v_stale_fence jsonb; v_fence jsonb;
begin
  foreach v_rpc in array array['billing_reserve_live_scheduled_plan_change_v1','billing_confirm_live_scheduled_plan_change_v1',
    'billing_list_live_scheduled_installations_v1','billing_live_scheduled_installation_command_v1'] loop
    if has_function_privilege('anon','public.'||v_rpc||'(text,text,jsonb)','execute')
      or has_function_privilege('authenticated','public.'||v_rpc||'(text,text,jsonb)','execute')
      or not has_function_privilege('service_role','public.'||v_rpc||'(text,text,jsonb)','execute') then
      raise exception 'Live scheduled installation ACL differs for %',v_rpc;
    end if;
  end loop;
  if has_function_privilege('service_role','private.lock_billing_live_scheduled_settings_v1(text,text)','execute')
    or exists(select 1 from private.stripe_billing_settings where singleton
      and (live_scheduled_plan_change_admission_enabled or live_scheduled_plan_change_provider_writes_enabled)) then
    raise exception 'Live scheduled installation scope or defaults differ';
  end if;
  update private.stripe_billing_settings set live_project_ref=v_project,live_stripe_account=v_account,
    classroom_new_work_cutoff_enabled=true where singleton;
  update private.stripe_billing_settings set live_payment_lifecycle_enabled=true,live_checkout_admission_enabled=true,
    live_checkout_writes_enabled=true,live_closeout_enabled=true where singleton;
  v_result:=public.billing_register_live_checkout_offering_v1(v_project,v_account,jsonb_build_object(
    'plan_key','pro','version',322001,'stripe_account',v_account,'provider_mode','live','stripe_product_id','prod_Live322Max',
    'stripe_price_id','price_Live322Max','currency','usd','unit_amount',3900,'interval','month','classroom_limit',12,
    'features','{"catalog_key":"pika:repolight-2026-10-29:max:usd:month","display_name":"Max","release_tag":"repolight-2026-10-29","repolight_analysis":true}'::jsonb,
    'ai_definition',null,'availability',jsonb_build_object('is_available',true)));
  v_source:=(v_result->>'offering_version_id')::uuid;
  v_result:=public.billing_register_live_checkout_offering_v1(v_project,v_account,jsonb_build_object(
    'plan_key','plus','version',322001,'stripe_account',v_account,'provider_mode','live','stripe_product_id','prod_Live322Pro',
    'stripe_price_id','price_Live322Pro','currency','usd','unit_amount',1900,'interval','month','classroom_limit',5,
    'features','{"catalog_key":"pika:repolight-2026-10-29:pro:usd:month","display_name":"Pro","release_tag":"repolight-2026-10-29","repolight_analysis":true}'::jsonb,
    'ai_definition',null,'availability',jsonb_build_object('is_available',true)));
  v_target:=(v_result->>'offering_version_id')::uuid;
  insert into public.users(id,email,role) values (v_owner,'live-322-owner@example.invalid','teacher'),
    (v_other,'live-322-other@example.invalid','teacher'),(v_sandbox_owner,'live-322-sandbox@example.invalid','teacher');
  if not exists(select 1 from public.account_plans where subject_user_id=v_owner) then
    perform public.set_account_plan_v1(gen_random_uuid(),v_owner,'free','test:install322','fixture',0);
  end if;
  v_offering:=public.billing_get_live_checkout_offering_v1(v_project,v_account,
    jsonb_build_object('offering_version_id',v_source,'stripe_account',v_account));
  perform public.billing_reserve_live_checkout_v1(v_project,v_account,jsonb_build_object(
    'attempt_id',v_attempt,'subject_user_id',v_owner,'offering',v_offering,'lookup_key',v_offering->>'catalog_key',
    'success_url','https://pika.codepet.ca/billing?checkout='||v_attempt||'&result=success',
    'cancel_url','https://pika.codepet.ca/billing?checkout='||v_attempt||'&result=cancel'));
  v_claim:=public.billing_claim_live_checkout_v1(v_project,v_account,jsonb_build_object('attempt_id',v_attempt,'lease_seconds',120));
  v_checkout_fence:=jsonb_build_object('attempt_id',v_attempt,'lease_token',v_claim->>'lease_token','fencing_token',v_claim->'fencing_token');
  perform public.billing_save_live_checkout_progress_v1(v_project,v_account,v_checkout_fence||
    '{"customer_id":"cus_Live322","session_id":"cs_live_Live322"}'::jsonb);
  perform public.billing_finish_live_checkout_v1(v_project,v_account,v_checkout_fence||'{"outcome":"bound","subscription_id":"sub_Live322"}');
  select id into strict v_binding from public.stripe_billing_subscription_bindings where subject_user_id=v_owner;
  v_claim:=public.billing_claim_live_subscription_v1(v_project,v_account,jsonb_build_object('subscription_id',v_binding,'lease_seconds',120));
  v_result:=public.billing_finish_live_lifecycle_v1(v_project,v_account,jsonb_build_object('subscription_id',v_binding,
    'lease_token',v_claim->>'lease_token','fencing_token',v_claim->'fencing_token',
    'expected_subscription_revision',v_claim->'subscription_revision','expected_account_plan_revision',v_claim->'expected_account_plan_revision',
    'outcome','paid','invoice_id','in_Live322Max','period_start',v_start,'period_end',v_through,
    'provider_status','active','cancel_at_period_end',false,'obligations_cleared',false));
  if v_result->>'status' is distinct from 'applied' then raise exception 'Fixture failed to settle source Max'; end if;

  -- Deliberately seed a test-mode row under the same Stripe account text after
  -- live attestation. The scoped live functions must never operate on it.
  insert into public.stripe_billing_offering_versions(offering_id,version,stripe_account,provider_mode,
    stripe_product_id,stripe_price_id,currency,unit_amount,interval,classroom_limit,features)
    select offering_id,322002,stripe_account,'test','prod_Test322Pro','price_Test322Pro',currency,unit_amount,interval,classroom_limit,features
      from public.stripe_billing_offering_versions where id=v_target returning id into v_test_target;
  insert into public.stripe_billing_subscription_bindings(subject_user_id,stripe_account,provider_mode,
    stripe_customer_id,stripe_subscription_id,offering_version_id) values
    (v_sandbox_owner,v_account,'test','cus_Test322','sub_Test322',v_source) returning id into v_test_binding;
  insert into private.billing_scheduled_plan_changes(id,subject_user_id,subscription_id,source_offering_version_id,
    target_offering_version_id,paid_period_start,effective_at,quote_expires_at,last_paid_invoice_id,
    expected_plan_revision,expected_access_revision,expected_entitlement_revision,state,confirmed_at)
    values(v_sandbox_op,v_sandbox_owner,v_test_binding,v_source,v_test_target,v_start,v_through,clock_timestamp()+interval '15 minutes',
      'in_Test322Max',1,1,1,'confirmed',clock_timestamp());
  if public.billing_list_live_scheduled_installations_v1(v_project,v_account,'{"limit":5}') is distinct from '[]'::jsonb
    or pg_temp.live_install_322(v_sandbox_op,'claim') is not null then
    raise exception 'Live installation exposed a test row with the same account';
  end if;
  begin
    perform public.billing_list_live_scheduled_installations_v1(v_project,'acct_Foreign322','{"limit":5}');
    raise exception 'Foreign Stripe account discovered work';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform public.billing_live_scheduled_installation_command_v1('bcdefghijklmnopqrstu',v_account,
      jsonb_build_object('operation_id',v_op,'action','claim'));
    raise exception 'Foreign project claimed work';
  exception when object_not_in_prerequisite_state then null;
  end;
  v_confirmation:=jsonb_build_object('subject_user_id',v_owner,'operation_id',v_op);
  v_request:=v_confirmation||jsonb_build_object('target_offering_version_id',v_target);
  begin
    perform public.billing_reserve_live_scheduled_plan_change_v1(v_project,v_account,v_request);
    raise exception 'Default-off live admission reserved a quote';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'billing_live_scheduled_change_admission_unavailable' then raise; end if;
  end;
  update private.stripe_billing_settings set live_scheduled_plan_change_admission_enabled=true where singleton;
  begin
    perform public.billing_reserve_live_scheduled_plan_change_v1(v_project,v_account,v_request);
    raise exception 'Admission promised a quote while provider writes were paused';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'billing_live_scheduled_change_admission_unavailable' then raise; end if;
  end;
  update private.stripe_billing_settings set live_scheduled_plan_change_provider_writes_enabled=true where singleton;
  begin
    perform public.billing_reserve_live_scheduled_plan_change_v1(v_project,v_account,
      v_confirmation||jsonb_build_object('target_offering_version_id',v_test_target));
    raise exception 'A sandbox offering was accepted as a live target';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'billing_scheduled_change_ineligible' then raise; end if;
  end;
  select to_jsonb(access) into strict v_before from public.billing_account_access access where subject_user_id=v_owner;
  v_result:=public.billing_reserve_live_scheduled_plan_change_v1(v_project,v_account,v_request);
  if v_result->>'state' is distinct from 'quoted' or v_result->>'plan_key' is distinct from 'plus'
    or (v_result->>'effective_at')::timestamptz is distinct from v_through
    or v_result->>'due_now' is distinct from '0'
    or public.billing_confirm_live_scheduled_plan_change_v1(v_project,v_account,
      v_confirmation||jsonb_build_object('subject_user_id',v_other)) is not null then
    raise exception 'Live quote changed source terms or crossed teacher ownership';
  end if;
  update public.stripe_billing_subscription_bindings set lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '2 minutes'
    where id=v_binding;
  begin
    perform public.billing_confirm_live_scheduled_plan_change_v1(v_project,v_account,v_confirmation);
    raise exception 'A concurrent subscription lease did not block confirmation';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'billing_scheduled_change_busy' then raise; end if;
  end;
  update public.stripe_billing_subscription_bindings set lease_token=null,lease_expires_at=null where id=v_binding;
  update private.billing_scheduled_plan_changes set last_paid_invoice_id='in_Unrelated322' where id=v_op;
  begin
    perform public.billing_confirm_live_scheduled_plan_change_v1(v_project,v_account,v_confirmation);
    raise exception 'An unrelated source invoice confirmed a live quote';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'billing_scheduled_change_quote_stale' then raise; end if;
  end;
  update private.billing_scheduled_plan_changes set last_paid_invoice_id='in_Live322Max' where id=v_op;
  v_result:=public.billing_confirm_live_scheduled_plan_change_v1(v_project,v_account,v_confirmation);
  if v_result->>'state' is distinct from 'confirmed' then raise exception 'Live quote was not confirmed'; end if;
  update private.stripe_billing_settings set live_scheduled_plan_change_admission_enabled=false where singleton;
  if public.billing_confirm_live_scheduled_plan_change_v1(v_project,v_account,v_confirmation) is distinct from v_result
    or public.billing_list_live_scheduled_installations_v1(v_project,v_account,'{"limit":5}') is distinct from jsonb_build_array(v_op) then
    raise exception 'Admission pause hid confirmed intent';
  end if;
  perform public.billing_set_live_checkout_offering_availability_v1(v_project,v_account,
    jsonb_build_object('offering_version_id',v_target,'is_available',false));

  v_claim:=pg_temp.live_install_322(v_op,'claim');
  v_fence:=v_claim->'fence';
  if v_claim#>>'{installation,stage}' is distinct from 'confirmed'
    or v_claim#>>'{operation,providerMode}' is distinct from 'live'
    or v_claim#>>'{operation,lastPaidInvoiceId}' is distinct from 'in_Live322Max'
    or pg_temp.live_install_322(v_op,'claim') is not null
    or pg_temp.live_install_322(v_op,'authorize_write',v_fence) is not null then
    raise exception 'Live claim lost source provenance or allowed unfenced work';
  end if;
  v_claim:=pg_temp.live_install_322(v_op,'begin_attach',v_fence);
  if v_claim#>>'{installation,stage}' is distinct from 'attach_requested'
    or pg_temp.live_install_322(v_op,'authorize_write',v_fence) is not null then
    raise exception 'Live attach checkpoint did not invalidate old fence';
  end if;
  v_claim:=pg_temp.live_install_322(v_op,'authorize_write',v_claim->'fence');
  v_stale_fence:=v_claim->'fence';
  if v_stale_fence is null then raise exception 'Open write gate did not authorize attach'; end if;
  update private.stripe_billing_settings set live_scheduled_plan_change_provider_writes_enabled=false where singleton;
  if pg_temp.live_install_322(v_op,'authorize_write',v_stale_fence) is not null then
    raise exception 'Paused gate authorized attach replay';
  end if;
  update public.stripe_billing_subscription_bindings set lease_expires_at=clock_timestamp()-interval '1 second' where id=v_binding;
  if public.billing_list_live_scheduled_installations_v1(v_project,v_account,'{"limit":5}') is distinct from jsonb_build_array(v_op) then
    raise exception 'Paused pending mutation was hidden from read recovery';
  end if;
  v_claim:=pg_temp.live_install_322(v_op,'claim');
  if v_claim#>>'{installation,stage}' is distinct from 'attach_requested'
    or pg_temp.live_install_322(v_op,'record_attach',v_stale_fence,'sub_sched_Live322') is not null then
    raise exception 'Lease recovery erased stage or allowed stale result';
  end if;
  v_claim:=pg_temp.live_install_322(v_op,'record_attach',v_claim->'fence','sub_sched_Live322');
  if v_claim#>>'{installation,stage}' is distinct from 'attached'
    or pg_temp.live_install_322(v_op,'begin_configure',v_claim->'fence') is not null then
    raise exception 'Paused attach evidence was discarded or new configuration was allowed';
  end if;
  update private.stripe_billing_settings set live_scheduled_plan_change_provider_writes_enabled=true where singleton;
  v_claim:=pg_temp.live_install_322(v_op,'begin_configure',v_claim->'fence');
  if v_claim#>>'{installation,stage}' is distinct from 'configure_requested'
    or pg_temp.live_install_322(v_op,'installed',v_claim->'fence','sub_sched_Wrong322') is not null then
    raise exception 'Configuration checkpoint accepted a different schedule';
  end if;
  v_claim:=pg_temp.live_install_322(v_op,'authorize_write',v_claim->'fence');
  if v_claim is null then raise exception 'Open write gate did not authorize configure'; end if;
  update private.stripe_billing_settings set live_scheduled_plan_change_provider_writes_enabled=false where singleton;
  if pg_temp.live_install_322(v_op,'authorize_write',v_claim->'fence') is not null then
    raise exception 'Paused gate authorized configure replay';
  end if;
  if pg_temp.live_install_322(v_op,'installed',v_claim->'fence','sub_sched_Live322') is distinct from 'true'::jsonb then
    raise exception 'Paused configuration evidence could not settle installation';
  end if;
  if pg_temp.live_install_322(v_op,'installed',v_claim->'fence','sub_sched_Live322') is not null
    or not exists(select 1 from private.billing_scheduled_plan_changes
      where id=v_op and state='scheduled' and provider_schedule_id='sub_sched_Live322' and attached_schedule_id=provider_schedule_id)
    or exists(select 1 from public.stripe_billing_subscription_bindings where id=v_binding and lease_token is not null)
    or (select to_jsonb(access) from public.billing_account_access access where subject_user_id=v_owner) is distinct from v_before then
    raise exception 'Live install did not settle exact paused evidence, release its lease, and preserve Max access';
  end if;
end;
$$;

rollback;
