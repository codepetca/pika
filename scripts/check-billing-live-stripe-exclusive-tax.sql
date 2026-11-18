-- Rollback-only proof of the exclusive tax snapshots on an owned replay through 326.
begin;
set local statement_timeout='30s';
set local lock_timeout='3s';

do $$
declare
  project constant text:='abcdefghijklmnopqrst';
  account constant text:='acct_Tax326';
  tax_features constant jsonb:='{"billing_tax_mode":"stripe_exclusive"}';
  tax_snapshot constant jsonb:='{"tax_mode":"stripe_exclusive"}';
  teacher uuid:=gen_random_uuid(); other_teacher uuid:=gen_random_uuid();
  attempt uuid:=gen_random_uuid(); legacy_attempt uuid:=gen_random_uuid(); operation uuid:=gen_random_uuid();
  cancellation uuid:=gen_random_uuid(); closeout uuid:=gen_random_uuid();
  max_tax uuid; pro_tax uuid; max_legacy uuid; pro_legacy uuid; test_version uuid; subscription uuid; legacy_subscription uuid;
  effective_at timestamptz:=date_trunc('second',clock_timestamp())+interval '2 days';
  period_start timestamptz:=effective_at-interval '1 month';
  paid_invoice constant text:='in_Tax326Paid';
  provider_schedule constant text:='sub_sched_Tax326';
  terms record; bad_mode jsonb; reg jsonb; replay jsonb; req jsonb; result jsonb; offering jsonb; legacy_offering jsonb;
  checkout_request jsonb; claim jsonb; fence jsonb; binding jsonb; renew_request jsonb; catalog_request jsonb;
  rpc text;
begin
  foreach rpc in array array['private.billing_live_checkout_terms_valid_v1(text,text,text,bigint,integer,jsonb,jsonb)',
    'private.stripe_live_checkout_offering_v1(uuid,text)','private.billing_live_reconciliation_binding_v1(uuid,text)',
    'private.billing_live_scheduled_installation_claim_v1(uuid)',
    'private.billing_live_renewal_closeout_claim_json_v1(text,text,uuid)'] loop
    if has_function_privilege('anon',rpc,'execute') or has_function_privilege('authenticated',rpc,'execute')
      or has_function_privilege('service_role',rpc,'execute') then raise exception 'Private tax custody exposed: %',rpc; end if;
  end loop;

  rpc:='public.billing_list_live_scheduled_change_offerings_v1(text,text,jsonb)';
  if has_function_privilege('anon',rpc,'execute') or has_function_privilege('authenticated',rpc,'execute')
    or not has_function_privilege('service_role',rpc,'execute') then raise exception 'Scheduled change catalog ACL differs'; end if;

  update private.stripe_billing_settings set live_project_ref=project,live_stripe_account=account,
    classroom_new_work_cutoff_enabled=true where singleton;
  update private.stripe_billing_settings set live_payment_lifecycle_enabled=true,live_closeout_enabled=true,
    live_checkout_admission_enabled=true,live_checkout_writes_enabled=true where singleton;
  update private.stripe_billing_settings set live_scheduled_plan_change_admission_enabled=true,
    live_scheduled_plan_change_provider_writes_enabled=true,live_scheduled_closeout_enabled=true,
    live_scheduled_cancellation_admission_enabled=true,live_scheduled_cancellation_provider_writes_enabled=true where singleton;

  for terms in select * from (values ('pro','max','Max',5500,12),('plus','pro','Pro',2700,5))
    as prices(plan_key,public_plan,display_name,amount,classroom_limit) loop
    reg:=jsonb_build_object('plan_key',terms.plan_key,'version',326001,'stripe_account',account,
      'provider_mode','live','stripe_product_id','prod_Tax326'||terms.display_name,'stripe_price_id','price_Tax326'||terms.display_name,
      'currency','cad','unit_amount',terms.amount,'interval','month','classroom_limit',terms.classroom_limit,
      'features',jsonb_build_object('catalog_key','pika:repolight-2026-10-29:'||terms.public_plan||':cad:month:stripe-exclusive',
        'display_name',terms.display_name,'release_tag','repolight-2026-10-29','repolight_analysis',true)||tax_features,
      'ai_definition',null);
    result:=public.billing_register_live_checkout_offering_v1(project,account,reg);
    replay:=public.billing_register_live_checkout_offering_v1(project,account,reg);
    if result->'created' is distinct from 'true'::jsonb
      or replay is distinct from (result||'{"created":false}'::jsonb) then raise exception 'Tax registration replay changed identity'; end if;
    if terms.plan_key='pro' then max_tax:=(result->>'offering_version_id')::uuid;
    else pro_tax:=(result->>'offering_version_id')::uuid; end if;

    foreach bad_mode in array array['null'::jsonb,'"exclusive"','"STRIPE_EXCLUSIVE"','true','{"stripe_exclusive":true}'] loop
      begin
        perform public.billing_register_live_checkout_offering_v1(project,account,
          jsonb_set(reg,'{features,billing_tax_mode}',bad_mode));
        raise exception 'Invalid tax mode accepted: %',bad_mode;
      exception when invalid_parameter_value then
        if sqlerrm<>'live_checkout_offering_invalid' then raise; end if;
      end;
    end loop;
    begin
      perform public.billing_register_live_checkout_offering_v1(project,account,reg#-'{features,billing_tax_mode}');
      raise exception 'Tax catalog key accepted without its tax mode';
    exception when invalid_parameter_value then
      if sqlerrm<>'live_checkout_offering_invalid' then raise; end if;
    end;
    reg:=jsonb_set(reg,'{features,catalog_key}',to_jsonb('pika:repolight-2026-10-29:'||terms.public_plan||':cad:month'));
    begin
      perform public.billing_register_live_checkout_offering_v1(project,account,reg);
      raise exception 'Tax mode accepted without its catalog suffix';
    exception when invalid_parameter_value then
      if sqlerrm<>'live_checkout_offering_invalid' then raise; end if;
    end;
    reg:=reg#-'{features,billing_tax_mode}';
    begin
      perform public.billing_register_live_checkout_offering_v1(project,account,reg);
      raise exception 'Registration replay stripped immutable tax custody';
    exception when unique_violation then
      if sqlerrm<>'live_checkout_offering_conflict' then raise; end if;
    end;

    result:=public.billing_register_live_checkout_offering_v1(project,account,
      reg||jsonb_build_object('version',326002,
        'stripe_price_id','price_Legacy326'||terms.display_name,'availability',jsonb_build_object('is_available',true)));
    if terms.plan_key='pro' then max_legacy:=(result->>'offering_version_id')::uuid;
    else pro_legacy:=(result->>'offering_version_id')::uuid; end if;
  end loop;

  begin
    update public.stripe_billing_offering_versions set features=features-'billing_tax_mode' where id=max_tax;
    raise exception 'Immutable offering tax mode was removed';
  exception when insufficient_privilege then
    if sqlerrm<>'stripe_billing_immutable_record' then raise; end if;
  end;

  result:=public.billing_get_live_checkout_offering_v1(project,account,
    jsonb_build_object('offering_version_id',max_legacy,'stripe_account',account));
  if result->>'offering_version_id' is distinct from max_legacy::text or result ? 'tax_mode'
    or not private.billing_live_scheduled_target_valid_v1(max_legacy,pro_legacy,account)
    or private.billing_live_scheduled_target_valid_v1(max_tax,pro_legacy,account)
    or private.billing_live_scheduled_target_valid_v1(max_legacy,pro_tax,account)
    or not private.billing_live_scheduled_target_valid_v1(max_tax,pro_tax,account) then
    raise exception 'Tax mode changed legacy shape or same-mode schedule eligibility';
  end if;
  insert into public.stripe_billing_offering_versions(offering_id,version,stripe_account,provider_mode,
    stripe_product_id,stripe_price_id,currency,unit_amount,interval,classroom_limit,features)
    select offering_id,326003,stripe_account,'test','prod_Test326','price_Test326',currency,unit_amount,interval,classroom_limit,features
    from public.stripe_billing_offering_versions where id=pro_tax returning id into test_version;
  if private.stripe_live_checkout_offering_v1(test_version,account) is not null
    or private.stripe_live_checkout_offering_v1(max_tax,'acct_Foreign326') is not null
    or private.billing_live_scheduled_target_valid_v1(max_tax,test_version,account) then
    raise exception 'Live tax custody crossed the account or provider mode';
  end if;
  legacy_offering:=result;
  perform public.billing_set_live_checkout_offering_availability_v1(project,account,
    jsonb_build_object('offering_version_id',max_tax,'is_available',true));
  offering:=public.billing_get_live_checkout_offering_v1(project,account,
    jsonb_build_object('offering_version_id',max_tax,'stripe_account',account));
  if offering is distinct from result||jsonb_build_object(
    'offering_version_id',max_tax,'stripe_price_id','price_Tax326Max','tax_mode','stripe_exclusive',
    'catalog_key',(result->>'catalog_key')||':stripe-exclusive') then
    raise exception 'Tax catalog projection changed commercial terms or version identity';
  end if;

  insert into public.users(id,email,role) values(teacher,'stripe-tax-326@example.invalid','teacher'),
    (other_teacher,'stripe-tax-other-326@example.invalid','teacher');
  perform public.set_account_plan_v1(gen_random_uuid(),teacher,'free','test:tax326','fixture',
    coalesce((select revision from public.account_plans where subject_user_id=teacher),0));
  checkout_request:=jsonb_build_object('attempt_id',attempt,'subject_user_id',teacher,
    'offering',offering,'lookup_key',offering->>'catalog_key',
    'success_url','https://pika.codepet.ca/billing?checkout='||attempt||'&result=success',
    'cancel_url','https://pika.codepet.ca/billing?checkout='||attempt||'&result=cancel');
  begin
    perform public.billing_reserve_live_checkout_v1(project,account,checkout_request#-'{offering,tax_mode}');
    raise exception 'Checkout reserved a tax version without its mode';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'checkout_offering_unavailable_or_changed' then raise; end if;
  end;
  result:=public.billing_reserve_live_checkout_v1(project,account,checkout_request);
  if result->'offering' is distinct from offering or result ? 'tax_mode' then
    raise exception 'Checkout did not pin tax mode on the nested offering';
  end if;
  begin
    perform public.billing_reserve_live_checkout_v1(project,account,checkout_request#-'{offering,tax_mode}');
    raise exception 'Checkout replay changed the pinned tax mode';
  exception when unique_violation then
    if sqlerrm<>'checkout_operation_conflict' then raise; end if;
  end;
  perform public.billing_set_live_checkout_offering_availability_v1(project,account,
    jsonb_build_object('offering_version_id',max_tax,'is_available',false));
  if public.billing_reserve_live_checkout_v1(project,account,checkout_request)->'offering' is distinct from offering
    or public.billing_get_live_checkout_v1(project,account,
      jsonb_build_object('attempt_id',attempt,'subject_user_id',gen_random_uuid())) is not null then
    raise exception 'Pinned tax recovery depended on availability or crossed teacher scope';
  end if;
  claim:=public.billing_claim_live_checkout_v1(project,account,jsonb_build_object('attempt_id',attempt,'lease_seconds',120));
  if claim#>'{attempt,offering}' is distinct from offering then raise exception 'Checkout lease lost the pinned tax mode'; end if;
  fence:=jsonb_build_object('attempt_id',attempt,'lease_token',claim->'lease_token','fencing_token',claim->'fencing_token');
  perform public.billing_save_live_checkout_progress_v1(project,account,
    fence||'{"customer_id":"cus_Tax326","session_id":"cs_live_Tax326"}');
  perform public.billing_finish_live_checkout_v1(project,account,fence||'{"outcome":"bound","subscription_id":"sub_Tax326"}');
  select id into strict subscription from public.stripe_billing_subscription_bindings where subject_user_id=teacher;
  claim:=public.billing_claim_live_subscription_v1(project,account,jsonb_build_object('subscription_id',subscription,'lease_seconds',120));
  binding:=claim->'binding';
  if (binding @> (tax_snapshot||jsonb_build_object('offering_version_id',max_tax,'stripe_price_id','price_Tax326Max',
    'subject_user_id',teacher,'subscription_id',subscription,'stripe_account',account,'provider_mode','live'))) is not true
    or private.billing_live_reconciliation_binding_v1(subscription,'acct_Foreign326') is not null then
    raise exception 'Live binding did not recover the exact taxed Checkout identity';
  end if;
  result:=public.billing_finish_live_lifecycle_v1(project,account,jsonb_build_object('subscription_id',subscription,
    'lease_token',claim->'lease_token','fencing_token',claim->'fencing_token',
    'expected_subscription_revision',claim->'subscription_revision','expected_account_plan_revision',claim->'expected_account_plan_revision',
    'outcome','paid','invoice_id',paid_invoice,'period_start',period_start,'period_end',effective_at,
    'provider_status','active','cancel_at_period_end',false,'obligations_cleared',false));
  if result->>'status' is distinct from 'applied' then raise exception 'Taxed Checkout lost the existing paid writer'; end if;

  catalog_request:=jsonb_build_object('subject_user_id',teacher);
  if public.billing_list_live_scheduled_change_offerings_v1(project,account,catalog_request) is distinct from '{"items":[]}'::jsonb then
    raise exception 'Scheduled catalog exposed a legacy price for the taxed Max binding';
  end if;
  begin
    perform public.billing_list_live_scheduled_change_offerings_v1(project,'acct_Foreign326',catalog_request);
    raise exception 'Foreign Stripe account accessed the live scheduled catalog';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'billing_live_payment_lifecycle_unavailable' then raise; end if;
  end;
  begin
    perform public.billing_list_live_scheduled_change_offerings_v1(project,account,catalog_request||tax_snapshot);
    raise exception 'Scheduled catalog accepted caller-supplied tax mode';
  exception when invalid_parameter_value then
    if sqlerrm<>'billing_scheduled_change_catalog_request_invalid' then raise; end if;
  end;

  req:=jsonb_build_object('operation_id',operation,'subject_user_id',teacher);
  begin
    perform public.billing_reserve_live_scheduled_plan_change_v1(project,account,
      req||jsonb_build_object('target_offering_version_id',pro_legacy));
    raise exception 'Mixed-tax-mode schedule was quoted';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'billing_scheduled_change_ineligible' then raise; end if;
  end;
  perform public.billing_set_live_checkout_offering_availability_v1(project,account,
    jsonb_build_object('offering_version_id',pro_tax,'is_available',true));
  if public.billing_list_live_scheduled_change_offerings_v1(project,account,catalog_request)
    is distinct from jsonb_build_object('items',jsonb_build_array(public.billing_get_live_checkout_offering_v1(project,account,
      jsonb_build_object('offering_version_id',pro_tax,'stripe_account',account))))
    or public.billing_list_live_scheduled_change_offerings_v1(project,account,jsonb_build_object('subject_user_id',other_teacher))
      is distinct from '{"items":[]}'::jsonb then
    raise exception 'Scheduled catalog lost the compatible price or crossed teacher scope';
  end if;
  perform public.set_account_plan_v1(gen_random_uuid(),other_teacher,'free','test:tax326','fixture',
    coalesce((select revision from public.account_plans where subject_user_id=other_teacher),0));
  perform public.billing_reserve_live_checkout_v1(project,account,jsonb_build_object(
    'attempt_id',legacy_attempt,'subject_user_id',other_teacher,'offering',legacy_offering,
    'lookup_key',legacy_offering->>'catalog_key',
    'success_url','https://pika.codepet.ca/billing?checkout='||legacy_attempt||'&result=success',
    'cancel_url','https://pika.codepet.ca/billing?checkout='||legacy_attempt||'&result=cancel'));
  claim:=public.billing_claim_live_checkout_v1(project,account,jsonb_build_object('attempt_id',legacy_attempt,'lease_seconds',120));
  fence:=jsonb_build_object('attempt_id',legacy_attempt,'lease_token',claim->'lease_token','fencing_token',claim->'fencing_token');
  perform public.billing_save_live_checkout_progress_v1(project,account,
    fence||'{"customer_id":"cus_Legacy326","session_id":"cs_live_Legacy326"}');
  perform public.billing_finish_live_checkout_v1(project,account,fence||'{"outcome":"bound","subscription_id":"sub_Legacy326"}');
  select id into strict legacy_subscription from public.stripe_billing_subscription_bindings where subject_user_id=other_teacher;
  claim:=public.billing_claim_live_subscription_v1(project,account,jsonb_build_object('subscription_id',legacy_subscription,'lease_seconds',120));
  result:=public.billing_finish_live_lifecycle_v1(project,account,jsonb_build_object('subscription_id',legacy_subscription,
    'lease_token',claim->'lease_token','fencing_token',claim->'fencing_token',
    'expected_subscription_revision',claim->'subscription_revision','expected_account_plan_revision',claim->'expected_account_plan_revision',
    'outcome','paid','invoice_id','in_Legacy326Paid','period_start',period_start,'period_end',effective_at,
    'provider_status','active','cancel_at_period_end',false,'obligations_cleared',false));
  if result->>'status' is distinct from 'applied' or
    public.billing_list_live_scheduled_change_offerings_v1(project,account,jsonb_build_object('subject_user_id',other_teacher))
    is distinct from jsonb_build_object('items',jsonb_build_array(public.billing_get_live_checkout_offering_v1(project,account,
      jsonb_build_object('offering_version_id',pro_legacy,'stripe_account',account)))) then
    raise exception 'Legacy Max lost its Pro target when the taxed Pro price became available';
  end if;

  update public.stripe_billing_offering_availability set available_from=clock_timestamp()+interval '1 day' where offering_version_id=pro_tax;
  if public.billing_list_live_scheduled_change_offerings_v1(project,account,catalog_request) is distinct from '{"items":[]}'::jsonb then
    raise exception 'Scheduled catalog exposed an offer before its availability window';
  end if;
  update public.stripe_billing_offering_availability set available_from=null where offering_version_id=pro_tax;
  perform public.billing_reserve_live_scheduled_plan_change_v1(project,account,
    req||jsonb_build_object('target_offering_version_id',pro_tax));
  result:=public.billing_confirm_live_scheduled_plan_change_v1(project,account,req);
  if result->>'state' is distinct from 'confirmed' then raise exception 'Same-mode schedule did not confirm'; end if;
  claim:=public.billing_live_scheduled_installation_command_v1(project,account,
    jsonb_build_object('operation_id',operation,'action','claim'));
  if claim#>>'{operation,taxMode}' is distinct from 'stripe_exclusive'
    or claim#>>'{operation,source,priceId}' is distinct from 'price_Tax326Max'
    or claim#>>'{operation,target,priceId}' is distinct from 'price_Tax326Pro' then
    raise exception 'Installation payload lost the frozen tax mode or price identities';
  end if;

  -- Model the verified installation result under the same lease. The closeout
  -- test exercises only serialization; closeout admission is covered by 324.
  update private.billing_scheduled_plan_changes set state='scheduled',provider_schedule_id=provider_schedule where id=operation;
  renew_request:=jsonb_build_object('subscription_id',subscription,'lease_token',claim#>'{fence,leaseToken}');
  result:=public.billing_get_live_scheduled_renewal_v1(project,account,renew_request);
  if (result->'target_binding' @> (tax_snapshot||jsonb_build_object('offering_version_id',pro_tax,
      'stripe_price_id','price_Tax326Pro','subject_user_id',teacher,'subscription_id',subscription,'stripe_account',account))) is not true
    or public.billing_get_live_scheduled_renewal_v1(project,account,renew_request||jsonb_build_object('lease_token',gen_random_uuid())) is not null then
    raise exception 'Scheduled renewal proof lost target tax custody or was not lease scoped';
  end if;
  insert into public.billing_renewal_closeouts(id,subscription_id,invoice_id,paid_through,cutoff,
    expected_account_plan_revision,expected_access_revision,expected_entitlement_revision)
    select closeout,subscription,'in_Tax326Renewal',effective_at,effective_at+interval '168 hours',
      access.account_plan_revision,access.revision,access.entitlement_revision
    from public.billing_account_access access where access.subscription_id=subscription;
  claim:=private.billing_live_renewal_closeout_claim_json_v1(project,account,closeout);
  if claim->'binding' is distinct from binding or claim ? 'scheduled' then
    raise exception 'Ordinary closeout lost the canonical source tax mode';
  end if;
  update public.billing_renewal_closeouts set scheduled_operation_id=operation where id=closeout;
  claim:=private.billing_live_renewal_closeout_claim_json_v1(project,account,closeout);
  if claim->'binding' is distinct from binding or claim->'scheduled' is distinct from (result-'state') then
    raise exception 'Scheduled closeout lost exact source or target tax custody';
  end if;
  update private.billing_scheduled_plan_changes set target_offering_version_id=pro_legacy where id=operation;
  if public.billing_get_live_scheduled_renewal_v1(project,account,renew_request) is not null
    or private.billing_live_renewal_closeout_claim_json_v1(project,account,closeout) is not null then
    raise exception 'Mixed persisted schedule exposed a renewal or fell back to ordinary closeout';
  end if;
  update private.billing_scheduled_plan_changes set target_offering_version_id=pro_tax where id=operation;
  delete from public.billing_renewal_closeouts where id=closeout;
  update public.stripe_billing_subscription_bindings set lease_token=null,lease_expires_at=null where id=subscription;
  req:=jsonb_build_object('operation_id',cancellation,'subject_user_id',teacher,'schedule_operation_id',operation,'action','cancel');
  if public.billing_request_live_scheduled_cancellation_v1(project,account,req)->>'state' is distinct from 'cancel_pending' then
    raise exception 'Taxed installation lost the existing cancellation path';
  end if;
  claim:=public.billing_live_scheduled_cancellation_command_v1(project,account,
    jsonb_build_object('operation_id',cancellation,'action','claim'));
  if claim->'binding' is distinct from binding or claim#>>'{operation,taxMode}' is distinct from 'stripe_exclusive'
    or claim#>>'{operation,scheduleId}' is distinct from provider_schedule
    or claim#>>'{operation,target,priceId}' is distinct from 'price_Tax326Pro' then
    raise exception 'Cancellation claim lost the frozen mode or installed schedule identity';
  end if;
end;
$$;

rollback;
