-- Rollback-only proof on an owned disposable replay through 323.
begin;
set local statement_timeout='30s';
set local lock_timeout='3s';

create function pg_temp.claim_live_scheduled_323(p_subscription uuid)
returns jsonb language plpgsql as $$
declare claim jsonb;
begin
  update public.stripe_billing_subscription_bindings set next_reconcile_at=clock_timestamp()-interval '1 second'
    where id=p_subscription;
  claim:=public.billing_claim_live_subscription_v1('abcdefghijklmnopqrst','acct_Scheduled323',
    jsonb_build_object('subscription_id',p_subscription,'lease_seconds',120));
  if claim->>'status'<>'claimed' then raise exception 'Fixture could not claim: %',claim->>'status'; end if;
  return jsonb_build_object('subscription_id',p_subscription,'lease_token',claim->>'lease_token',
    'fencing_token',claim->'fencing_token','expected_subscription_revision',claim->'subscription_revision',
    'expected_account_plan_revision',claim->'expected_account_plan_revision','event_inbox_id',null,
    'provider_status','active','cancel_at_period_end',false,'obligations_cleared',false);
end;
$$;

do $$
declare
  project text:='abcdefghijklmnopqrst'; account text:='acct_Scheduled323';
  teacher uuid:=gen_random_uuid(); attempt uuid:=gen_random_uuid(); operation uuid:=gen_random_uuid();
  source_version uuid; target_version uuid; subscription uuid;
  source_term jsonb; claim jsonb; request jsonb; target_payment jsonb; result jsonb;
  starts_at timestamptz; effective_at timestamptz; cutoff timestamptz; target_end timestamptz;
  version_record record;
begin
  if has_function_privilege('anon','public.billing_get_live_scheduled_renewal_v1(text,text,jsonb)','execute')
    or has_function_privilege('authenticated','public.billing_finish_live_scheduled_renewal_v1(text,text,jsonb)','execute')
    or not has_function_privilege('service_role','public.billing_finish_live_scheduled_renewal_v1(text,text,jsonb)','execute')
    or has_function_privilege('service_role','private.billing_finish_live_lifecycle_core_v1(text,text,jsonb,jsonb)','execute') then
    raise exception 'Live scheduled settlement ACL differs';
  end if;
  insert into public.users(id,email,role) values(teacher,'live-scheduled-323@example.invalid','teacher');
  perform public.set_account_plan_v1(gen_random_uuid(),teacher,'free','test:scheduled323','fixture',
    coalesce((select revision from public.account_plans where subject_user_id=teacher),0));
  update private.stripe_billing_settings set live_project_ref=project,live_stripe_account=account,
    classroom_new_work_cutoff_enabled=true where singleton;
  update private.stripe_billing_settings set live_payment_lifecycle_enabled=true,live_closeout_enabled=true,
    live_checkout_admission_enabled=true,live_checkout_writes_enabled=true where singleton;
  update private.repolight_settings set plan_enforcement_enabled=true,billing_access_enabled=true where singleton;

  for version_record in select * from (values
    ('pro','max','Max',3900,12,'prod_Max323','price_Max323'),
    ('plus','pro','Pro',1900,5,'prod_Pro323','price_Pro323')
  ) as versions(plan,public_plan,name,amount,classroom_limit,product,price) loop
    result:=public.billing_register_live_checkout_offering_v1(project,account,jsonb_build_object(
      'plan_key',version_record.plan,'version',323001,'stripe_account',account,'provider_mode','live',
      'stripe_product_id',version_record.product,'stripe_price_id',version_record.price,'currency','usd','interval','month',
      'unit_amount',version_record.amount,'classroom_limit',version_record.classroom_limit,'features',jsonb_build_object(
        'catalog_key','pika:repolight-2026-10-29:'||version_record.public_plan||':usd:month',
        'display_name',version_record.name,'release_tag','repolight-2026-10-29','repolight_analysis',true),
      'ai_definition',null,'availability',jsonb_build_object('is_available',true)));
    if version_record.plan='pro' then source_version:=(result->>'offering_version_id')::uuid;
    else target_version:=(result->>'offering_version_id')::uuid; end if;
  end loop;
  source_term:=public.billing_get_live_checkout_offering_v1(project,account,
    jsonb_build_object('offering_version_id',source_version,'stripe_account',account));
  perform public.billing_reserve_live_checkout_v1(project,account,jsonb_build_object(
    'attempt_id',attempt,'subject_user_id',teacher,'offering',source_term,'lookup_key',source_term->>'catalog_key',
    'success_url','https://pika.codepet.ca/billing?checkout='||attempt||'&result=success',
    'cancel_url','https://pika.codepet.ca/billing?checkout='||attempt||'&result=cancel'));
  claim:=public.billing_claim_live_checkout_v1(project,account,jsonb_build_object('attempt_id',attempt,'lease_seconds',120));
  request:=jsonb_build_object('attempt_id',attempt,'lease_token',claim->'lease_token','fencing_token',claim->'fencing_token');
  perform public.billing_save_live_checkout_progress_v1(project,account,request||jsonb_build_object(
    'customer_id','cus_Scheduled323','session_id','cs_live_Scheduled323','checkout_url','https://checkout.stripe.com/c/pay/Scheduled323'));
  perform public.billing_finish_live_checkout_v1(project,account,request||jsonb_build_object('outcome','bound','subscription_id','sub_Scheduled323'));
  select id into strict subscription from public.stripe_billing_subscription_bindings where subject_user_id=teacher;
  cutoff:=date_trunc('second',clock_timestamp())+interval '6 seconds';
  effective_at:=cutoff-interval '168 hours';
  starts_at:=effective_at-interval '1 month';
  target_end:=private.billing_scheduled_term_end_v1(effective_at,target_version);
  claim:=pg_temp.claim_live_scheduled_323(subscription);
  result:=public.billing_finish_live_lifecycle_v1(project,account,claim||jsonb_build_object(
    'outcome','paid','invoice_id','in_Max323','period_start',starts_at,'period_end',effective_at));
  if result->>'status' is distinct from 'applied' then raise exception 'Could not settle source Max term'; end if;

  -- Persist the normalized result of the separately tested installation path.
  insert into private.billing_scheduled_plan_changes(id,subject_user_id,subscription_id,source_offering_version_id,
    target_offering_version_id,paid_period_start,effective_at,quote_expires_at,last_paid_invoice_id,expected_plan_revision,
    expected_access_revision,expected_entitlement_revision,state,confirmed_at,provider_schedule_id)
  select operation,teacher,subscription,source_version,target_version,access.paid_period_start,effective_at,effective_at-interval '15 minutes',
    'in_Max323',access.account_plan_revision,access.revision,access.entitlement_revision,'scheduled',effective_at-interval '1 day','sub_sched_Live323'
  from public.billing_account_access access where subject_user_id=teacher;
  claim:=pg_temp.claim_live_scheduled_323(subscription);
  request:=jsonb_build_object('subscription_id',subscription,'lease_token',claim->'lease_token');
  result:=public.billing_get_live_scheduled_renewal_v1(project,account,request);
  if result#>>'{target_binding,offering_version_id}' is distinct from target_version::text
    or result#>>'{target_binding,provider_mode}' is distinct from 'live'
    or public.billing_get_live_scheduled_renewal_v1(project,account,request||jsonb_build_object('lease_token',gen_random_uuid())) is not null then
    raise exception 'Installed schedule proof was not scoped to the live lease and target';
  end if;
  target_payment:=jsonb_build_object('outcome','paid','invoice_id','in_Pro323','period_start',effective_at,'period_end',target_end);
  if public.billing_finish_live_lifecycle_v1(project,account,claim||target_payment)->>'status' is distinct from 'rejected' then
    raise exception 'Ordinary live writer could adopt a scheduled invoice';
  end if;
  request:=jsonb_build_object('operation_id',operation,'provider_schedule_id','sub_sched_Live323','target_offering_version_id',target_version);
  if public.billing_finish_live_scheduled_renewal_v1(project,account,claim||target_payment||request||
    '{"provider_schedule_id":"sub_sched_Wrong323"}')->>'status' is distinct from 'rejected' then
    raise exception 'Wrong schedule identity could adopt the target invoice';
  end if;
  result:=public.billing_finish_live_scheduled_renewal_v1(project,account,claim||target_payment||request||
    '{"outcome":"renewal_failed","provider_status":"past_due"}');
  if result->>'status' is distinct from 'applied'
    or not exists(select 1 from public.billing_account_access where subject_user_id=teacher
      and last_paid_invoice_id='in_Max323' and failed_renewal_invoice_id='in_Pro323'
      and offering_version_id=source_version and access_ends_at=cutoff and expiry_applied_at is null)
    or not (public.billing_get_live_access_status_v1(project,account,jsonb_build_object('subject_user_id',teacher))
      @> '{"state":"renewal_grace","plan_key":"pro","classroom_limit":12}')
    or public.get_repolight_analysis_access_v1(teacher)->'allowed' is distinct from 'true'::jsonb then
    raise exception 'Failed Pro renewal did not preserve the Max term and RepoLight in grace';
  end if;

  perform pg_sleep(greatest(0,extract(epoch from cutoff-clock_timestamp()))+0.05);
  result:=public.get_repolight_analysis_access_v1(teacher);
  if result->'allowed' is distinct from 'false'::jsonb then
    raise exception 'RepoLight was allowed after scheduled grace: %',result->>'reason';
  end if;
  result:=public.billing_apply_due_live_paid_access_v1(project,account,'{"limit":1}');
  if result->'processed' is distinct from '1'::jsonb
    or not exists(select 1 from public.account_plans where subject_user_id=teacher and plan_key='free') then
    raise exception 'Free access was not materialized after scheduled grace: %',result;
  end if;
  claim:=pg_temp.claim_live_scheduled_323(subscription);
  if public.billing_finish_live_scheduled_renewal_v1(project,account,claim||target_payment||request||
    '{"invoice_id":"in_Unexpected323"}')->>'status' is distinct from 'rejected' then
    raise exception 'A different invoice replaced the failed scheduled renewal';
  end if;
  result:=public.billing_finish_live_scheduled_renewal_v1(project,account,claim||target_payment||request);
  if result->>'status' is distinct from 'applied'
    or not exists(select 1 from private.billing_scheduled_plan_changes where id=operation
      and state='applied' and last_paid_invoice_id='in_Max323' and live_settled_invoice_id='in_Pro323')
    or not (public.billing_get_live_access_status_v1(project,account,jsonb_build_object('subject_user_id',teacher))
      @> '{"state":"paid","plan_key":"plus","classroom_limit":5}')
    or public.get_repolight_analysis_access_v1(teacher)->'allowed' is distinct from 'true'::jsonb
    or (select count(*) from public.stripe_billing_invoice_effects where subscription_id=subscription)<>2 then
    raise exception 'Verified Pro payment did not atomically adopt the target term';
  end if;
  result:=public.billing_get_live_checkout_v1(project,account,jsonb_build_object('attempt_id',attempt,'subject_user_id',teacher));
  if result->'access_confirmed' is distinct from 'true'::jsonb
    or result#>>'{offering,offering_version_id}' is distinct from source_version::text then
    raise exception 'The confirmed original Max Checkout receipt was rewritten or lost';
  end if;
  claim:=pg_temp.claim_live_scheduled_323(subscription);
  if public.billing_finish_live_lifecycle_v1(project,account,claim||target_payment)->>'status' is distinct from 'replayed' then
    raise exception 'Current Pro term could not reconcile after the scheduled change';
  end if;
end;
$$;
rollback;
