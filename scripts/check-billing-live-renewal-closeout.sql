-- Rollback-only proof on an owned disposable replay through 320. No provider calls.
begin;
set local statement_timeout='30s';
set local lock_timeout='3s';
create temporary table live_closeout_cases(name text primary key,subject_id uuid,subscription_id uuid,through_at timestamptz);
create function pg_temp.live_closeout_fence(c jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object('operation_id',c->>'operation_id','subscription_id',c->>'subscription_id',
    'lease_token',c->>'lease_token','fencing_token',c->'fencing_token','subscription_revision',c->'subscription_revision',
    'expected_account_plan_revision',c->'expected_account_plan_revision','operation_revision',c->'operation_revision');
$$;
create function pg_temp.finish_live_320(p_subscription uuid,p_observation jsonb)
returns jsonb language plpgsql as $$
declare c jsonb;
begin
  update public.stripe_billing_subscription_bindings set next_reconcile_at=clock_timestamp()-interval '1 second' where id=p_subscription;
  c:=public.billing_claim_live_subscription_v1('abcdefghijklmnopqrst','acct_Live320',jsonb_build_object('subscription_id',p_subscription,'lease_seconds',120));
  if c->>'status'<>'claimed' then raise exception 'Fixture reconciliation claim failed'; end if;
  return public.billing_finish_live_lifecycle_v1('abcdefghijklmnopqrst','acct_Live320',jsonb_build_object(
    'subscription_id',p_subscription,'lease_token',c->>'lease_token','fencing_token',c->'fencing_token',
    'expected_subscription_revision',c->'subscription_revision','expected_account_plan_revision',c->'expected_account_plan_revision',
    'provider_status','active','cancel_at_period_end',false,'obligations_cleared',false)||p_observation);
end;
$$;
do $$
declare project text:='abcdefghijklmnopqrst'; account text:='acct_Live320'; fn text;
  offering jsonb; req jsonb; c jsonb; r jsonb; u uuid; attempt uuid; subscription uuid; v uuid; case_name text; through_at timestamptz;
begin
  foreach fn in array array['billing_list_live_renewal_closeouts_v1','billing_claim_live_renewal_closeout_v1',
    'billing_checkpoint_live_renewal_closeout_v1','billing_finish_live_renewal_closeout_v1'] loop
    if has_function_privilege('anon','public.'||fn||'(text,text,jsonb)','execute')
      or has_function_privilege('authenticated','public.'||fn||'(text,text,jsonb)','execute')
      or not has_function_privilege('service_role','public.'||fn||'(text,text,jsonb)','execute') then raise exception 'Live closeout ACL: %',fn; end if;
  end loop;
  if (select live_closeout_enabled from private.stripe_billing_settings where singleton)
    or has_function_privilege('service_role','private.billing_check_live_renewal_closeout_fence_v1(text,text,jsonb)','execute') then
    raise exception 'Live closeout did not default off/private';
  end if;
  update private.stripe_billing_settings set live_project_ref=project,live_stripe_account=account,classroom_new_work_cutoff_enabled=true where singleton;
  update private.stripe_billing_settings set live_payment_lifecycle_enabled=true,live_checkout_admission_enabled=true,live_checkout_writes_enabled=true where singleton;
  if to_regprocedure('public.billing_live_checkout_activation_ready_v1(text,text)') is not null then
    execute 'update private.stripe_billing_settings set live_closeout_enabled=true where singleton';
  end if;
  r:=public.billing_register_live_checkout_offering_v1(project,account,jsonb_build_object(
    'plan_key','plus','version',1,'stripe_account',account,'provider_mode','live','stripe_product_id','prod_Live320',
    'stripe_price_id','price_Live320','currency','usd','unit_amount',1900,'interval','month','classroom_limit',5,
    'features',jsonb_build_object('catalog_key','pika:repolight-2026-10-29:pro:usd:month','display_name','Pro',
      'release_tag','repolight-2026-10-29','repolight_analysis',true),'ai_definition',null,'availability',jsonb_build_object('is_available',true)));
  v:=(r->>'offering_version_id')::uuid;
  offering:=public.billing_get_live_checkout_offering_v1(project,account,jsonb_build_object('offering_version_id',v,'stripe_account',account));
  foreach case_name in array array['closed','paid','manual','entitlement','future','attention'] loop
    u:=gen_random_uuid(); attempt:=gen_random_uuid();
    insert into public.users(id,email,role) values(u,'live-closeout320-'||case_name||'@example.invalid','teacher');
    if not exists(select 1 from public.account_plans where subject_user_id=u) then
      perform public.set_account_plan_v1(gen_random_uuid(),u,'free','test:closeout','fixture',0); end if;
    perform public.billing_reserve_live_checkout_v1(project,account,jsonb_build_object(
      'attempt_id',attempt,'subject_user_id',u,'offering',offering,'lookup_key',offering->>'catalog_key',
      'success_url','https://pika.codepet.ca/billing?checkout='||attempt||'&result=success',
      'cancel_url','https://pika.codepet.ca/billing?checkout='||attempt||'&result=cancel'));
    c:=public.billing_claim_live_checkout_v1(project,account,jsonb_build_object('attempt_id',attempt,'lease_seconds',120));
    req:=jsonb_build_object('attempt_id',attempt,'lease_token',c->>'lease_token','fencing_token',c->'fencing_token');
    perform public.billing_save_live_checkout_progress_v1(project,account,req||jsonb_build_object(
      'customer_id','cus_Live320'||case_name,'session_id','cs_live_Live320'||case_name));
    perform public.billing_finish_live_checkout_v1(project,account,req||jsonb_build_object('outcome','bound','subscription_id','sub_Live320'||case_name));
    select id into subscription from public.stripe_billing_subscription_bindings where subject_user_id=u;
    through_at:=clock_timestamp()-case when case_name='future' then interval '6 days' else interval '8 days' end;
    r:=pg_temp.finish_live_320(subscription,jsonb_build_object('outcome','paid','invoice_id','in_Live320first'||case_name,
      'period_start',through_at-interval '30 days','period_end',through_at));
    if r->>'status'<>'applied' then raise exception 'Fixture paid effect failed'; end if;
    r:=pg_temp.finish_live_320(subscription,jsonb_build_object('outcome','renewal_failed','invoice_id','in_Live320renew'||case_name,
      'period_start',through_at,'period_end',through_at+interval '30 days','provider_status','past_due'));
    if r->>'status'<>'applied' then raise exception 'Fixture grace failed'; end if;
    insert into live_closeout_cases values(case_name,u,subscription,through_at);
  end loop;
  update private.stripe_billing_settings set live_closeout_enabled=false where singleton;
  if public.billing_list_live_renewal_closeouts_v1(project,account,'{"limit":1}')->'items'<>'[]'::jsonb then
    raise exception 'Disabled closeout returned work'; end if;
  update private.stripe_billing_settings set live_checkout_admission_enabled=false,live_checkout_writes_enabled=false,live_closeout_enabled=true where singleton;
end;
$$;
-- Ordinary reconciliation cannot win a new lease after due grace is observed.
do $$ declare s uuid; c jsonb; fresh jsonb; r jsonb; saved jsonb; v_stage text; failed boolean;
begin
  select subscription_id into s from live_closeout_cases where name='closed';
  update public.stripe_billing_subscription_bindings set next_reconcile_at=clock_timestamp()-interval '1 second' where id=s;
  if public.billing_claim_live_subscription_v1('abcdefghijklmnopqrst','acct_Live320',jsonb_build_object('subscription_id',s,'lease_seconds',120))->>'status'<>'busy'
    or exists(select 1 from jsonb_array_elements(public.billing_list_live_work_v1('abcdefghijklmnopqrst','acct_Live320','{"limit":100}')->'items') item
      where item->>'subscription_id'=s::text) then raise exception 'Due closeout did not own next reconciliation lease'; end if;
  c:=public.billing_claim_live_renewal_closeout_v1('abcdefghijklmnopqrst','acct_Live320',jsonb_build_object('subscription_id',s,'lease_seconds',120));
  if c->>'status'<>'claimed' or c#>>'{binding,provider_mode}'<>'live' or c ? 'scheduled' then raise exception 'Live ordinary claim differs'; end if;
  if public.billing_apply_due_live_paid_access_v1('abcdefghijklmnopqrst','acct_Live320','{"limit":100}')->>'processed'<>'0' then
    raise exception 'Already expired closeout changed revisions'; end if;
  fresh:=public.billing_checkpoint_live_renewal_closeout_v1('abcdefghijklmnopqrst','acct_Live320',pg_temp.live_closeout_fence(c)||'{"stage":"pause_requested"}');
  if fresh->>'status'<>'claimed' then raise exception 'Checkpoint failed'; end if;
  if public.billing_checkpoint_live_renewal_closeout_v1('abcdefghijklmnopqrst','acct_Live320',pg_temp.live_closeout_fence(c)||'{"stage":"pause_requested"}')->>'status'<>'lost_claim' then
    raise exception 'Stale operation fence accepted'; end if;
  c:=fresh;
  update private.stripe_billing_settings set live_closeout_enabled=false where singleton;
  if public.billing_checkpoint_live_renewal_closeout_v1('abcdefghijklmnopqrst','acct_Live320',pg_temp.live_closeout_fence(c)||'{"stage":"pause_requested"}')->>'status'<>'lost_claim' then
    raise exception 'Disabled gate permitted provider-write checkpoint'; end if;
  update private.stripe_billing_settings set live_closeout_enabled=true where singleton;
  -- An expired worker can be reclaimed without erasing its last durable stage.
  update public.stripe_billing_subscription_bindings set lease_expires_at=clock_timestamp()-interval '1 second' where id=s;
  fresh:=public.billing_claim_live_renewal_closeout_v1('abcdefghijklmnopqrst','acct_Live320',jsonb_build_object('subscription_id',s,'lease_seconds',120));
  if fresh->>'status'<>'claimed' or fresh->>'stage'<>'pause_requested' or fresh->>'lease_token'=c->>'lease_token' then
    raise exception 'Lease recovery lost durable mutation stage'; end if;
  c:=fresh;
  foreach v_stage in array array['collection_paused','void_requested','invoice_voided','cancel_requested'] loop
    c:=public.billing_checkpoint_live_renewal_closeout_v1('abcdefghijklmnopqrst','acct_Live320',pg_temp.live_closeout_fence(c)||jsonb_build_object('stage',v_stage));
    if c->>'status'<>'claimed' then raise exception 'Forward checkpoint failed'; end if;
  end loop;
  failed:=false;
  begin perform public.billing_checkpoint_live_renewal_closeout_v1('abcdefghijklmnopqrst','acct_Live320',pg_temp.live_closeout_fence(c)||'{"stage":"pause_requested"}');
  exception when invalid_parameter_value then failed:=true; end;
  if not failed then raise exception 'Mutation stage moved backward'; end if;
  saved:=pg_temp.live_closeout_fence(c);
  r:=public.billing_finish_live_renewal_closeout_v1('abcdefghijklmnopqrst','acct_Live320',saved||jsonb_build_object('outcome','closed',
    'evidence',jsonb_build_object('kind','invoice_voided','invoiceId',c->>'invoice_id','subscriptionCanceled',true,'obligationsCleared',true)));
  if r->>'status'<>'closed' or not exists(select 1 from public.stripe_billing_subscription_bindings where id=s and not is_current
    and terminal_confirmed_at is not null and obligations_cleared_at is not null)
    or not exists(select 1 from public.billing_renewal_closeouts where subscription_id=s and status='closed' and stage='closed') then
    raise exception 'Verified unpaid closure did not retire payer'; end if;
  if public.billing_finish_live_renewal_closeout_v1('abcdefghijklmnopqrst','acct_Live320',saved||'{"outcome":"deferred"}')->>'status'<>'lost_claim' then
    raise exception 'Closed operation retained lease authority'; end if;
end;
$$;
-- Collection can win the race; only its exact invoice and renewed term apply.
do $$ declare c jsonb; r jsonb; s uuid; u uuid; t timestamptz; failed boolean;
begin
  select subscription_id,subject_id,through_at into s,u,t from live_closeout_cases where name='paid';
  c:=public.billing_claim_live_renewal_closeout_v1('abcdefghijklmnopqrst','acct_Live320',jsonb_build_object('subscription_id',s,'lease_seconds',120));
  failed:=false;
  begin perform public.billing_finish_live_renewal_closeout_v1('abcdefghijklmnopqrst','acct_Live320',pg_temp.live_closeout_fence(c)||jsonb_build_object('outcome','payment_won',
    'evidence',jsonb_build_object('kind','paid','invoiceId','in_Wrong320','periodStart',to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'periodEnd',to_char((t+interval '30 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'providerStatus','active','cancelAtPeriodEnd',false,'terminalObligationsCleared',false)));
  exception when invalid_parameter_value then failed:=true; end;
  if not failed then raise exception 'Wrong paid invoice rescued closeout'; end if;
  r:=public.billing_finish_live_renewal_closeout_v1('abcdefghijklmnopqrst','acct_Live320',pg_temp.live_closeout_fence(c)||jsonb_build_object('outcome','payment_won',
    'evidence',jsonb_build_object('kind','paid','invoiceId',c->>'invoice_id','periodStart',to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'periodEnd',to_char((t+interval '30 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'providerStatus','active','cancelAtPeriodEnd',false,'terminalObligationsCleared',false)));
  if r->>'status'<>'payment_won' or not exists(select 1 from public.account_plans where subject_user_id=u and plan_key='plus')
    or not exists(select 1 from public.billing_account_access where subject_user_id=u and paid_through=t+interval '30 days'
      and expiry_applied_at is null and end_reason='renewal_pending')
    or not exists(select 1 from public.billing_renewal_closeouts where subscription_id=s and status='payment_won') then
    raise exception 'Payment-won race did not restore exact paid term'; end if;
  if private.billing_live_reconciliation_blocked_v1(s) then raise exception 'Payment-won history blocked normal reconciliation'; end if;
end;
$$;
-- Account or feature changes after claim must stop the next provider write.
do $$ declare c jsonb; s uuid; u uuid; revision bigint; case_name text; r jsonb;
begin
  foreach case_name in array array['manual','entitlement'] loop
    select subscription_id,subject_id into s,u from live_closeout_cases where name=case_name;
    c:=public.billing_claim_live_renewal_closeout_v1('abcdefghijklmnopqrst','acct_Live320',jsonb_build_object('subscription_id',s,'lease_seconds',120));
    if case_name='manual' then
      -- The public setter rejects billing-managed plans. Model privileged
      -- revision drift directly so the already-issued lease sees the change.
      update public.account_plans p set revision=p.revision+1 where p.subject_user_id=u;
    else
      select e.revision into revision from public.effective_feature_entitlements e where subject_user_id=u and feature_key='classrooms.create';
      perform public.set_effective_feature_entitlement_v1(gen_random_uuid(),u,'classrooms.create','manual',true,clock_timestamp(),null,2,
        'test:closeout','manual_grant',revision);
    end if;
    r:=public.billing_checkpoint_live_renewal_closeout_v1('abcdefghijklmnopqrst','acct_Live320',pg_temp.live_closeout_fence(c)||'{"stage":"pause_requested"}');
    if r->>'status'<>'plan_conflict' then raise exception 'Concurrent % edit escaped closeout fence',case_name; end if;
  end loop;
  select subscription_id into s from live_closeout_cases where name='future';
  if public.billing_claim_live_renewal_closeout_v1('abcdefghijklmnopqrst','acct_Live320',jsonb_build_object('subscription_id',s,'lease_seconds',120))->>'status'<>'superseded' then
    raise exception 'Closeout claimed before168-hour cutoff'; end if;
end;
$$;
-- Deferred provider failures retain their stage and stop at five attempts.
do $$ declare c jsonb; r jsonb; s uuid; i integer;
begin
  select subscription_id into s from live_closeout_cases where name='attention';
  for i in 1..5 loop
    update public.billing_renewal_closeouts set next_attempt_at=clock_timestamp()-interval '1 second' where subscription_id=s;
    c:=public.billing_claim_live_renewal_closeout_v1('abcdefghijklmnopqrst','acct_Live320',jsonb_build_object('subscription_id',s,'lease_seconds',120));
    if c->>'status'<>'claimed' then raise exception 'Deferred closeout could not reclaim'; end if;
    r:=public.billing_finish_live_renewal_closeout_v1('abcdefghijklmnopqrst','acct_Live320',pg_temp.live_closeout_fence(c)||'{"outcome":"deferred","reason":"provider_unavailable"}');
    if r->>'status'<>(case when i=5 then 'attention' else 'deferred' end) then raise exception 'Closeout retry budget differs'; end if;
  end loop;
  if not exists(select 1 from public.billing_renewal_closeouts where subscription_id=s and attempt_count=5 and status='attention' and stage='queued')
    or not private.billing_live_reconciliation_blocked_v1(s) then raise exception 'Attention released recovery ownership'; end if;
end;
$$;
rollback;
